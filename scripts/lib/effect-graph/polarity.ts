// Signed-number polarity detectors.

import type {
  EffectGraph,
  Element,
  Polarity,
  ArmorDamageKind,
  StatDamageKind,
  MechanicLike,
} from "./types.ts";
import { parentChain } from "./walk.ts";
import { resolvedNumber } from "./xml.ts";
import { descendantsOf, findAll, findFirst } from "./traverse.ts";

function unambiguousPolarity(sawPositive: boolean, sawNegative: boolean): Polarity | null {
  if (sawPositive && !sawNegative) return "increase";
  if (sawNegative && !sawPositive) return "decrease";
  return null;
}

function* chainNodeElements(graph: EffectGraph, behaviorId: string): Iterable<readonly Element[]> {
  for (const id of parentChain(graph, behaviorId)) {
    const node = graph.nodes.get(id);
    if (node) yield node.elements;
  }
}

function signedModifierPolarity(n: number, accumulator: Polarity | null = null): Polarity | null {
  if (n < 0) return "decrease";
  if (n > 0) return "increase";
  if (n === 0 && accumulator) return accumulator;
  return null;
}

// CAccumulator* <Scale value="X"/> sign.
export function accumulatorAttrPolarity(graph: EffectGraph, accumulatorId: string): Polarity | null {
  for (const id of parentChain(graph, accumulatorId)) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const scale = findFirst(node.elements, "Scale");
    if (!scale?.attrs.value) continue;
    const n = resolvedNumber(graph, scale.attrs.value);
    if (n === null) continue;
    if (n > 0) return "increase";
    if (n < 0) return "decrease";
  }
  return null;
}

// <AccumulatorArray value="..."/> children of `container`.
function accumulatorArrayPolarity(graph: EffectGraph, container: Element | undefined): Polarity | null {
  if (!container) return null;
  let sawPositive = false;
  let sawNegative = false;
  for (const a of findAll(container.children, "AccumulatorArray")) {
    if (!a.attrs.value) continue;
    const p = accumulatorAttrPolarity(graph, a.attrs.value);
    if (p === "increase") sawPositive = true;
    else if (p === "decrease") sawNegative = true;
  }
  return unambiguousPolarity(sawPositive, sawNegative);
}

// Whether a buff inheriting from StormArmor adds or removes armor.
export function armorBuffPolarity(graph: EffectGraph, behaviorId: string): Polarity {
  let sawPositive = false;
  let sawNegative = false;
  let alignment: Polarity | null = null;
  for (const elements of chainNodeElements(graph, behaviorId)) {
    for (const el of descendantsOf(elements)) {
      if (el.tag === "BehaviorCategories" && el.attrs.value === "1") {
        if (el.attrs.index === "DebuffVulnerable") return "decrease";
        if (el.attrs.index === "BuffResistant") return "increase";
      }
      if (el.tag === "ArmorModification") {
        for (const v of descendantsOf(el.children)) {
          if (v.tag !== "AllArmorBonus" && v.tag !== "ArmorMitigationTable") continue;
          const n = Number(v.attrs.value);
          if (Number.isFinite(n)) {
            if (n < 0) sawNegative = true;
            else if (n > 0) sawPositive = true;
          }
        }
      }
      if (alignment === null && el.tag === "Alignment") {
        if (el.attrs.value === "Negative") alignment = "decrease";
        else if (el.attrs.value === "Positive") alignment = "increase";
      }
    }
  }
  return unambiguousPolarity(sawPositive, sawNegative) ?? alignment ?? "increase";
}

export function armorBuffDamageKind(
  graph: EffectGraph,
  behaviorId: string,
  polarity: Polarity,
): ArmorDamageKind {
  let sawAllArmor = false;
  const damageKinds = new Set<string>();
  const signMatches = (n: number) => polarity === "increase" ? n > 0 : n < 0;

  for (const elements of chainNodeElements(graph, behaviorId)) {
    for (const mod of findAll(elements, "ArmorModification")) {
      for (const bonus of findAll(mod.children, "AllArmorBonus")) {
        if (!bonus.attrs.value) continue;
        const n = resolvedNumber(graph, bonus.attrs.value);
        if (n !== null && signMatches(n)) sawAllArmor = true;
      }
      for (const armor of findAll(mod.children, "ArmorMitigationTable")) {
        if (!armor.attrs.value || !armor.attrs.index) continue;
        const n = resolvedNumber(graph, armor.attrs.value);
        if (n !== null && signMatches(n)) damageKinds.add(armor.attrs.index);
      }
    }
  }

  if (!sawAllArmor && damageKinds.size === 1) {
    if (damageKinds.has("Basic")) return "physical";
    if (damageKinds.has("Ability")) return "magical";
  }
  return "regular";
}

export function attackSpeedModifierPolarity(graph: EffectGraph, behaviorId: string): Polarity | null {
  let sawPositive = false;
  let sawNegative = false;
  for (const elements of chainNodeElements(graph, behaviorId)) {
    for (const el of findAll(elements, "AdditiveAttackSpeedFactor")) {
      if (!el.attrs.value) continue;
      const n = resolvedNumber(graph, el.attrs.value);
      if (n === null) continue;
      const p = signedModifierPolarity(n, accumulatorArrayPolarity(graph, el));
      if (p === "increase") sawPositive = true;
      else if (p === "decrease") sawNegative = true;
    }
  }
  return unambiguousPolarity(sawPositive, sawNegative);
}

export function damageModifierSignal(
  graph: EffectGraph,
  behaviorId: string,
): { polarity: Polarity; kind: StatDamageKind } | null {
  const byKind = new Map<string, Set<Polarity>>();
  for (const elements of chainNodeElements(graph, behaviorId)) {
    for (const el of descendantsOf(elements)) {
      if (el.tag !== "DamageDealtFraction" && el.tag !== "DamageDealtScaled") continue;
      const index = el.attrs.index;
      if (!index || !el.attrs.value) continue;
      const n = resolvedNumber(graph, el.attrs.value);
      if (n === null) continue;
      const p = signedModifierPolarity(n, accumulatorArrayPolarity(graph, el));
      if (!p) continue;
      const polarities = byKind.get(index) ?? new Set<Polarity>();
      polarities.add(p);
      byKind.set(index, polarities);
    }
  }

  const allPolarities = new Set([...byKind.values()].flatMap((v) => [...v]));
  if (allPolarities.size !== 1) return null;
  const polarity = [...allPolarities][0];
  const kinds = new Set(byKind.keys());
  const hasPhysical = kinds.has("Basic") || kinds.has("Splash");
  const hasSpell = kinds.has("Ability");
  if (hasPhysical && hasSpell) return { polarity, kind: "general" };
  if (hasPhysical && !hasSpell) return { polarity, kind: "physical" };
  if (hasSpell && !hasPhysical) return { polarity, kind: "spell" };
  if (kinds.size > 1) return { polarity, kind: "general" };
  return null;
}

function healingBuffPolarity(graph: EffectGraph, behaviorId: string): Polarity | null {
  let sawPositive = false;
  let sawNegative = false;
  for (const elements of chainNodeElements(graph, behaviorId)) {
    for (const el of findAll(elements, "HealTakenAdditiveMultiplier")) {
      if (!el.attrs.value) continue;
      const n = resolvedNumber(graph, el.attrs.value);
      if (n === null) continue;
      if (n < 0) sawNegative = true;
      else if (n > 0) sawPositive = true;
    }
  }
  return unambiguousPolarity(sawPositive, sawNegative);
}

export function damageEffectAmount(graph: EffectGraph, effectId: string): number | null {
  for (const elements of chainNodeElements(graph, effectId)) {
    const el = findFirst(elements, "Amount");
    if (!el?.attrs.value) continue;
    const n = resolvedNumber(graph, el.attrs.value);
    if (n !== null) return n;
  }
  return null;
}

export function damageEffectKind(graph: EffectGraph, effectId: string): StatDamageKind | null {
  const chain = parentChain(graph, effectId);
  if (chain.includes("StormSummonedUnitWeapon")) return null;
  if (chain.includes("StormWeapon")) return "physical";
  if (chain.includes("StormSpell")) return "spell";
  for (const id of chain) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const kindEl = findFirst(node.elements, "Kind");
    if (!kindEl?.attrs.value) continue;
    const v = kindEl.attrs.value;
    if (v === "Basic" || v === "Weapon" || v === "Melee" || v === "Ranged") return "physical";
    if (v === "Ability" || v === "Spell") return "spell";
  }
  return null;
}

export function lifestealBehaviorMatchesKind(
  graph: EffectGraph,
  behaviorId: string,
  damageKind: StatDamageKind | undefined,
): boolean {
  if (!damageKind || damageKind === "general") return false;
  const wantedKind = damageKind === "physical" ? "Basic" : "Ability";
  for (const elements of chainNodeElements(graph, behaviorId)) {
    for (const leech of findAll(elements, "VitalDamageLeechArray")) {
      if (leech.attrs.index !== "Life") continue;
      for (const ka of findAll(leech.children, "KindArray")) {
        if (ka.attrs.index !== wantedKind || !ka.attrs.value) continue;
        const n = resolvedNumber(graph, ka.attrs.value);
        if (n !== null && n > 0) return true;
      }
    }
  }
  return false;
}

// Behaviors whose body declares an <ArmorModification> matching mechanic polarity/kind.
export function armorModBehaviorIds(graph: EffectGraph, mechanic: MechanicLike): string[] {
  if (!mechanic.armorPolarity) return [];
  const out: string[] = [];
  for (const node of graph.nodes.values()) {
    if (!node.tag.startsWith("CBehavior")) continue;
    const hasArmorMod = parentChain(graph, node.id).some((id) => {
      const n = graph.nodes.get(id);
      return n ? findFirst(n.elements, "ArmorModification") !== undefined : false;
    });
    if (!hasArmorMod) continue;
    if (armorBuffPolarity(graph, node.id) !== mechanic.armorPolarity) continue;
    if (
      mechanic.armorDamageKind
      && armorBuffDamageKind(graph, node.id, mechanic.armorPolarity) !== mechanic.armorDamageKind
    ) continue;
    out.push(node.id);
  }
  return out;
}

export function positiveStatBehaviorIds(graph: EffectGraph, mechanic: MechanicLike): string[] {
  if (!mechanic.statModifier || mechanic.statModifier === "lifesteal") return [];
  const out: string[] = [];
  for (const node of graph.nodes.values()) {
    if (!node.tag.startsWith("CBehavior")) continue;
    if (mechanic.statModifier === "attack-speed") {
      if (attackSpeedModifierPolarity(graph, node.id) === mechanic.statPolarity) out.push(node.id);
      continue;
    }
    if (mechanic.statModifier === "damage") {
      const signal = damageModifierSignal(graph, node.id);
      if (signal && signal.polarity === mechanic.statPolarity && signal.kind === mechanic.statDamageKind) {
        out.push(node.id);
      }
    }
  }
  return out;
}

export function positiveLifestealEffectIds(graph: EffectGraph, damageKind: StatDamageKind | undefined): string[] {
  if (!damageKind || damageKind === "general") return [];
  const out: string[] = [];
  for (const node of graph.nodes.values()) {
    if (node.tag !== "CEffectDamage") continue;
    if (damageEffectKind(graph, node.id) !== damageKind) continue;
    let hasPositiveLifeLeech = false;
    for (const el of findAll(node.elements, "LeechFraction")) {
      if (el.attrs.index !== "Life" || !el.attrs.value) continue;
      const n = resolvedNumber(graph, el.attrs.value);
      if (n !== null && n > 0) hasPositiveLifeLeech = true;
    }
    if (hasPositiveLifeLeech) out.push(node.id);
  }
  return out;
}

export function positiveLifestealBehaviorIds(graph: EffectGraph, damageKind: StatDamageKind | undefined): string[] {
  const out: string[] = [];
  for (const node of graph.nodes.values()) {
    if (!node.tag.startsWith("CBehavior")) continue;
    if (lifestealBehaviorMatchesKind(graph, node.id, damageKind)) out.push(node.id);
  }
  return out;
}

export function positiveHealingBuffIds(graph: EffectGraph): string[] {
  const out: string[] = [];
  for (const node of graph.nodes.values()) {
    if (!node.tag.startsWith("CBehavior")) continue;
    if (healingBuffPolarity(graph, node.id) === "increase") out.push(node.id);
  }
  return out;
}
