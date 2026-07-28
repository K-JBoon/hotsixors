// Orchestrates the per-mechanic application discovery: gathers source behavior
// ids, finds effects that apply them, resolves owners, runs the auxiliary scans
// (damage MMA, CEffectSwitch upgrade), then collapses to one entry per (hero, name).

import type {
  EffectGraph,
  Element,
  GraphNode,
  ReverseRef,
  AbilTalentEntry,
  MechanicLike,
  MechanicApplications,
  AnchorIndex,
  Polarity,
} from "./types.ts";
import { findAll, findFirst } from "./traverse.ts";
import { buildReverseRefs, effectsApplyingBehavior, containingEffectRefs, behaviorRefsBehaviorWithoutExcludedDescendants, targetBehaviorOf, rootAbilityAnchorIds } from "./walk.ts";
import {
  armorModBehaviorIds,
  positiveStatBehaviorIds,
  positiveLifestealEffectIds,
  positiveLifestealBehaviorIds,
  positiveHealingBuffIds,
  damageEffectKind,
  damageEffectAmount,
  accumulatorAttrPolarity,
} from "./polarity.ts";
import {
  bucketBehaviorIdsForTalent,
  chanceEnabledEffectIds,
  gatingTalentIds,
  talentIdsFromBehaviorValidators,
  validatorTalentIds,
} from "./gating.ts";
import {
  behaviorNameMatchesTalent,
  entryForNamedId,
  hasIdBoundary,
  resolveEffectOwners,
} from "./owners.ts";
import { behaviorMatchesMechanicKind, nodePassesMechanicFilter } from "./filter.ts";
import {
  excludedBehaviorDescendantsForMechanic,
  excludedAppliedBehaviorDescendantsForMechanic,
  excludedEntryIdsForMechanic,
  ignoreSpawnSetupRefsForMechanic,
  isCancelEntry,
} from "./exclusions.ts";
import { resolvedNumber } from "./xml.ts";

function behaviorIdsForMechanic(graph: EffectGraph, mechanic: MechanicLike): string[] {
  const sourceBehaviors = (mechanic.sourceIds ?? []).filter((id) =>
    graph.nodes.get(id)?.tag.startsWith("CBehavior")
  );
  const ids = [mechanic.primaryBehavior, ...sourceBehaviors].filter((id) => id && !id.startsWith("lib"));
  return [...new Set(ids)];
}

function isSharedStormApplyEffect(graph: EffectGraph, effectId: string): boolean {
  return effectId.startsWith("Storm") && (targetBehaviorOf(graph, effectId)?.startsWith("Storm") ?? true);
}

// Per-talent indices used during application discovery.
interface TalentSidecars {
  // effect id -> talents that flip that effect's Chance to 1.
  chanceEnablers: Map<string, string[]>;
  // TalentBucket* behavior id -> talents that enable that bucket.
  bucketEnablers: Map<string, string[]>;
  talentNodes: { anchor: string; entry: AbilTalentEntry; node: GraphNode }[];
}

function buildTalentSidecars(graph: EffectGraph, anchorToEntry: AnchorIndex): TalentSidecars {
  const talentNodes = Object.entries(anchorToEntry)
    .filter(([, entry]) => entry.kind === "talent")
    .map(([anchor, entry]) => ({ anchor, entry, node: graph.nodes.get(anchor) }))
    .filter((item): item is { anchor: string; entry: AbilTalentEntry; node: GraphNode } => Boolean(item.node));

  const chanceEnablers = new Map<string, string[]>();
  const bucketEnablers = new Map<string, string[]>();
  for (const { anchor, node } of talentNodes) {
    for (const effId of chanceEnabledEffectIds(node)) {
      const arr = chanceEnablers.get(effId) ?? [];
      if (!arr.includes(anchor)) arr.push(anchor);
      chanceEnablers.set(effId, arr);
    }
    for (const bucketId of bucketBehaviorIdsForTalent(node)) {
      const arr = bucketEnablers.get(bucketId) ?? [];
      if (!arr.includes(anchor)) arr.push(anchor);
      bucketEnablers.set(bucketId, arr);
    }
  }
  return { chanceEnablers, bucketEnablers, talentNodes };
}

function talentOwnersForBehavior(
  graph: EffectGraph,
  anchorToEntry: AnchorIndex,
  talentNodes: TalentSidecars["talentNodes"],
  sourceBehaviorIds: string[],
  excludedBehaviorDescendants: string[],
  mechanic: MechanicLike,
): AbilTalentEntry[] {
  return talentNodes
    .filter(({ node }) => {
      const behaviorBucketRefs = (node.refs["Abil"] ?? []).filter(
        (id) => !anchorToEntry[id] && graph.nodes.get(id)?.tag.startsWith("CBehavior"),
      );
      const talentBehaviorRefs = [...(node.refs["BehaviorArray"] ?? []), ...behaviorBucketRefs];
      return talentBehaviorRefs.some(
        (id) =>
          sourceBehaviorIds.some((sourceId) =>
            behaviorRefsBehaviorWithoutExcludedDescendants(graph, id, sourceId, excludedBehaviorDescendants)
          )
          && behaviorMatchesMechanicKind(graph, id, mechanic),
      );
    })
    .map(({ entry }) => entry);
}

const addEntry = (entries: Map<string, AbilTalentEntry>, entry: AbilTalentEntry | undefined): void => {
  if (entry && !entries.has(entry.nameId)) entries.set(entry.nameId, entry);
};

// Lifesteal effects (CEffectDamage with LeechFraction>0) are gated at the effect level,
// not at a buff. They are credited to the talent named by their LeechValidator (or, as a
// fallback, their ValidatorArray/DisableValidatorArray); failing that, hero-weapon damage
// effects pick up their hero's trait as the implicit lifesteal source.
function lifestealDirectEffectEntries(
  graph: EffectGraph,
  anchorToEntry: AnchorIndex,
  directEffectIds: Set<string>,
): AbilTalentEntry[] {
  const out: AbilTalentEntry[] = [];
  for (const eid of directEffectIds) {
    const effectNode = graph.nodes.get(eid);
    // LeechValidator gates the lifesteal fraction specifically; ValidatorArray gates the
    // whole effect. Prefer the leech-specific one when present.
    const leechValidatorRefs = effectNode?.refs["LeechValidator"] ?? [];
    const leechGateRefs = leechValidatorRefs.length > 0
      ? leechValidatorRefs
      : [...(effectNode?.refs["ValidatorArray"] ?? []), ...(effectNode?.refs["DisableValidatorArray"] ?? [])];
    const leechTalentIds = effectNode
      ? [...new Set(leechGateRefs.flatMap((vid) => validatorTalentIds(graph, anchorToEntry, vid, new Set(), false)))]
      : [];
    if (leechTalentIds.length > 0) {
      for (const tid of leechTalentIds) {
        const e = anchorToEntry[tid];
        if (e) out.push(e);
      }
      continue;
    }
    if (/HeroWeaponDamage(?:Hero)?$/i.test(eid) && !/(?:FocusFire|Remorseless|Cleaver|Ricochet)/i.test(eid)) {
      for (const entry of Object.values(anchorToEntry)) {
        if (entry.kind === "ability" && entry.abilityType === "Trait" && hasIdBoundary(eid, entry.nameId.replace(/Reload$/i, ""))) {
          out.push(entry);
        }
      }
    }
  }
  return out;
}

// HotS gamedata only ever uses MultiplicativeModifierArray self-closing, so an
// element with children is not one of these.
function selfClosingMmas(elements: readonly Element[]): Element[] {
  return findAll(elements, "MultiplicativeModifierArray").filter((el) => el.children.length === 0);
}

function selfClosingCaseArrays(elements: readonly Element[]): Element[] {
  return findAll(elements, "CaseArray").filter((el) => el.children.length === 0);
}

function mmaSignature(attrs: Record<string, string>): string | null {
  if (attrs.Accumulator) return `acc:${attrs.Accumulator}`;
  if (attrs.index !== undefined && attrs.Modifier !== undefined) return `idx:${attrs.index}:${attrs.Modifier}`;
  return null;
}

// Damage modifiers expressed as <MultiplicativeModifierArray> attributes on CEffectDamage
// (and CEffectSwitch upgrades to higher-damage cases). Talent-validator-gated MMAs and
// hero-wide trait MMAs each contribute talent/owner entries to the mechanic.
function damageMmaApplications(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  anchorToEntry: AnchorIndex,
  chanceEnablers: Map<string, string[]>,
  bucketEnablers: Map<string, string[]>,
  mechanic: MechanicLike,
  ignoreSpawnSetupRefs: boolean,
): AbilTalentEntry[] {
  if (mechanic.statModifier !== "damage" || mechanic.statPolarity !== "increase") return [];

  const out: AbilTalentEntry[] = [];

  // Count MMA signatures to separate hero-wide traits from single-ability bonuses.
  const traitMmaSigCount = new Map<string, number>();
  for (const [, n] of graph.nodes) {
    if (n.tag !== "CEffectDamage") continue;
    for (const mma of selfClosingMmas(n.elements)) {
      if (mma.attrs.Validator !== "TargetIsHero") continue;
      const sig = mmaSignature(mma.attrs);
      if (sig) traitMmaSigCount.set(sig, (traitMmaSigCount.get(sig) ?? 0) + 1);
    }
  }
  const isHeroWideTraitMma = (a: Record<string, string>): boolean => {
    if (a.Validator !== "TargetIsHero") return false;
    const sig = mmaSignature(a);
    return sig !== null && (traitMmaSigCount.get(sig) ?? 0) >= 3;
  };

  // Pre-compute validator damage kinds and root abilities.
  const validatorDamageKinds = new Map<string, Set<string>>();
  const validatorRootAbilities = new Map<string, Set<string>>();
  for (const [, node] of graph.nodes) {
    if (node.tag !== "CEffectDamage") continue;
    const kind = damageEffectKind(graph, node.id);
    if (!kind) continue;
    let rootAbilities: Set<string> | null = null;
    for (const mma of selfClosingMmas(node.elements)) {
      const validator = mma.attrs.Validator;
      const modifierStr = mma.attrs.Modifier;
      if (!validator || modifierStr === undefined) continue;
      const modifier = resolvedNumber(graph, modifierStr);
      if (modifier === null || modifier <= 0) continue;
      const kinds = validatorDamageKinds.get(validator) ?? new Set<string>();
      kinds.add(kind);
      validatorDamageKinds.set(validator, kinds);
      if (!rootAbilities) rootAbilities = rootAbilityAnchorIds(reverseRefs, anchorToEntry, node.id);
      const set = validatorRootAbilities.get(validator) ?? new Set<string>();
      for (const r of rootAbilities) set.add(r);
      validatorRootAbilities.set(validator, set);
    }
  }

  for (const [, node] of graph.nodes) {
    if (node.tag !== "CEffectDamage") continue;
    const kind = damageEffectKind(graph, node.id);
    if (!kind) continue;
    if (mechanic.statDamageKind !== "general" && kind !== mechanic.statDamageKind) continue;
    for (const mma of selfClosingMmas(node.elements)) {
      const validator = mma.attrs.Validator;
      const modifierStr = mma.attrs.Modifier;
      const accumulatorId = mma.attrs.Accumulator;

      // Polarity comes from Modifier, or from the referenced Accumulator's sign.
      const modifier = modifierStr !== undefined ? resolvedNumber(graph, modifierStr) : null;
      let polarity: Polarity | null = null;
      if (modifier !== null && modifier !== 0) {
        polarity = modifier > 0 ? "increase" : "decrease";
      } else if (accumulatorId) {
        polarity = accumulatorAttrPolarity(graph, accumulatorId);
      }
      if (!polarity || polarity !== mechanic.statPolarity) continue;

      // Skip validators covering multiple kinds when processing a specific mechanic.
      if (mechanic.statDamageKind !== "general" && validator) {
        const allKinds = validatorDamageKinds.get(validator);
        if (allKinds && allKinds.size > 1) continue;
      }
      if (validator) {
        const talentIds = validatorTalentIds(graph, anchorToEntry, validator);
        if (talentIds.length > 0) {
          const roots = validatorRootAbilities.get(validator);
          if (roots && roots.size === 1) continue;
          for (const talentId of talentIds) {
            const e = anchorToEntry[talentId];
            if (e) out.push(e);
          }
          continue;
        }
      }
      if (isHeroWideTraitMma(mma.attrs)) {
        for (const entry of resolveEffectOwners(graph, reverseRefs, anchorToEntry, chanceEnablers, node.id, { ignoreSpawnSetupRefs, bucketEnablers })) {
          out.push(entry);
        }
      }
    }
  }

  // A CEffectSwitch can act as a talent-gated damage upgrade: when a CaseArray
  // gated by a talent validator points at a damage effect that deals strictly
  // more than the CaseDefault's damage effect, the talent is a damage-increase.
  // Example: Murky's "...And A Shark Too!" swaps OctoGrabPokeDamage (1) for
  // OctoGrabPokeMasteryDamage (137) via TargetHasOctoGrabMasteryCarry.
  for (const [, node] of graph.nodes) {
    if (node.tag !== "CEffectSwitch") continue;
    const defaultEl = findFirst(node.elements, "CaseDefault");
    const defaultEffectId = defaultEl?.attrs.value;
    if (!defaultEffectId) continue;
    const defaultNode = graph.nodes.get(defaultEffectId);
    if (!defaultNode || defaultNode.tag !== "CEffectDamage") continue;
    const defaultKind = damageEffectKind(graph, defaultEffectId);
    if (!defaultKind) continue;
    if (mechanic.statDamageKind !== "general" && defaultKind !== mechanic.statDamageKind) continue;
    const defaultAmount = damageEffectAmount(graph, defaultEffectId);
    if (defaultAmount === null) continue;
    for (const ca of selfClosingCaseArrays(node.elements)) {
      const validator = ca.attrs.Validator;
      const caseEffectId = ca.attrs.Effect;
      if (!validator || !caseEffectId) continue;
      const caseNode = graph.nodes.get(caseEffectId);
      if (!caseNode || caseNode.tag !== "CEffectDamage") continue;
      if (damageEffectKind(graph, caseEffectId) !== defaultKind) continue;
      const caseAmount = damageEffectAmount(graph, caseEffectId);
      if (caseAmount === null || caseAmount <= defaultAmount) continue;
      const talentIds = validatorTalentIds(graph, anchorToEntry, validator);
      if (talentIds.length === 0) continue;
      const roots = rootAbilityAnchorIds(reverseRefs, anchorToEntry, caseEffectId);
      if (roots.size === 1) continue;
      for (const talentId of talentIds) {
        const e = anchorToEntry[talentId];
        if (e) out.push(e);
      }
    }
  }

  return out;
}

// Collapse entries that surface the same ability under different ids: a heroic, its
// level-10 pick talent, and its level-20 "Glyph of …" sub-ability are all the same thing
// to a reader. Keep one per (hero, display name): prefer an ability over a talent, then
// the shortest id (the base, not a "…GlyphOf…" variant).
function collapseEntries(
  byNameId: Map<string, AbilTalentEntry>,
  excludedEntryIds: Set<string>,
): AbilTalentEntry[] {
  const byHeroName = new Map<string, AbilTalentEntry>();
  for (const entry of byNameId.values()) {
    if (excludedEntryIds.has(entry.nameId)) continue;
    if (isCancelEntry(entry)) continue;
    const k = `${entry.heroSlug} ${entry.name}`;
    const cur = byHeroName.get(k);
    const better =
      !cur
      || (entry.kind === "ability" && cur.kind !== "ability")
      || (entry.kind === cur.kind && entry.nameId.length < cur.nameId.length);
    if (better) byHeroName.set(k, entry);
  }
  return [...byHeroName.values()].sort(
    (a, b) =>
      a.heroName.localeCompare(b.heroName)
      || (a.kind === b.kind ? 0 : a.kind === "ability" ? -1 : 1)
      || a.name.localeCompare(b.name),
  );
}

// For each mechanic: find the CEffectApplyBehavior effects resolving to its primary
// behavior or explicit behavior source ids, then walk each effect up the reference graph
// to the ability/talent that owns it (see resolveEffectOwners: talent-gated paths are
// credited to the gating talent, not to the base ability). Talent-granted BehaviorArray
// buffs are included directly for mechanics such as Healing Increase.
export function findMechanicApplications(
  graph: EffectGraph,
  anchorToEntry: AnchorIndex,
  mechanics: MechanicLike[],
): MechanicApplications[] {
  const reverseRefs = buildReverseRefs(graph);
  const { chanceEnablers, bucketEnablers, talentNodes } = buildTalentSidecars(graph, anchorToEntry);

  return mechanics.map((mech) => {
    const byNameId = new Map<string, AbilTalentEntry>();
    const healingBehaviorIds = mech.slug === "healing-increase" ? positiveHealingBuffIds(graph) : [];
    const lifestealBehaviorIds = mech.statModifier === "lifesteal" ? positiveLifestealBehaviorIds(graph, mech.statDamageKind) : [];
    const statBehaviorIds = positiveStatBehaviorIds(graph, mech);
    const armorBehaviorIds = armorModBehaviorIds(graph, mech);
    const behaviorIds = [...new Set([
      ...behaviorIdsForMechanic(graph, mech),
      ...healingBehaviorIds,
      ...lifestealBehaviorIds,
      ...statBehaviorIds,
      ...armorBehaviorIds,
    ])];
    const excludedBehaviorDescendants = excludedBehaviorDescendantsForMechanic(mech);
    const excludedAppliedBehaviorDescendants = [
      ...excludedBehaviorDescendants,
      ...excludedAppliedBehaviorDescendantsForMechanic(mech),
    ];
    const excludedEntryIds = new Set(excludedEntryIdsForMechanic(mech));
    const ignoreSpawnSetupRefs = ignoreSpawnSetupRefsForMechanic(mech);

    const effectIds = new Set<string>();
    const directEffectIds = new Set<string>();
    if (mech.statModifier === "lifesteal") {
      for (const effectId of positiveLifestealEffectIds(graph, mech.statDamageKind)) directEffectIds.add(effectId);
    }
    for (const behaviorId of behaviorIds) {
      for (const effectId of effectsApplyingBehavior(graph, behaviorId, { excludeBehaviorDescendants: excludedAppliedBehaviorDescendants })) {
        if (!nodePassesMechanicFilter(graph, effectId, mech)) continue;
        effectIds.add(effectId);
      }
      for (const entry of talentOwnersForBehavior(graph, anchorToEntry, talentNodes, behaviorIds, excludedBehaviorDescendants, mech)) {
        addEntry(byNameId, entry);
      }
    }
    if (mech.statModifier === "lifesteal") {
      for (const behaviorId of lifestealBehaviorIds) {
        addEntry(byNameId, entryForNamedId(anchorToEntry, behaviorId) ?? undefined);
      }
      for (const entry of lifestealDirectEffectEntries(graph, anchorToEntry, directEffectIds)) {
        addEntry(byNameId, entry);
      }
    }
    for (const eid of effectIds) {
      if (isSharedStormApplyEffect(graph, eid)) continue;
      const owners = resolveEffectOwners(graph, reverseRefs, anchorToEntry, chanceEnablers, eid, { ignoreSpawnSetupRefs, bucketEnablers });
      for (const entry of owners) addEntry(byNameId, entry);
      if (owners.length === 0 && containingEffectRefs(reverseRefs, eid).length > 0) {
        const effectNode = graph.nodes.get(eid);
        const targetBehaviorId = targetBehaviorOf(graph, eid);
        const fallbackTalentIds = [
          ...new Set([
            ...(effectNode ? gatingTalentIds(graph, anchorToEntry, effectNode, chanceEnablers) : []),
            ...(targetBehaviorId ? talentIdsFromBehaviorValidators(graph, anchorToEntry, targetBehaviorId) : []),
          ]),
        ];
        for (const talentId of fallbackTalentIds) addEntry(byNameId, anchorToEntry[talentId]);
      }
    }
    if (mech.slug === "healing-increase") {
      for (const behaviorId of healingBehaviorIds) {
        for (const { anchor, entry } of talentNodes) {
          if (behaviorNameMatchesTalent(behaviorId, anchor)) addEntry(byNameId, entry);
        }
      }
    }
    for (const entry of damageMmaApplications(graph, reverseRefs, anchorToEntry, chanceEnablers, bucketEnablers, mech, ignoreSpawnSetupRefs)) {
      addEntry(byNameId, entry);
    }

    return {
      slug: mech.slug,
      name: mech.name,
      category: mech.category,
      entries: collapseEntries(byNameId, excludedEntryIds),
    };
  });
}
