// Duration and amount of what an entry applies, read from its matched sources.

import type { AbilTalentEntry, EffectGraph, Element, EffectValue, GraphNode, MatchSource, MechanicLike } from "./types.ts";
import { parentChain } from "./walk.ts";
import { resolvedNumber } from "./xml.ts";
import { findAll } from "./traverse.ts";

function inheritedValue(graph: EffectGraph, id: string, tag: string): string | null {
  for (const ancestor of parentChain(graph, id)) {
    const el = graph.nodes.get(ancestor)?.elements.find((e) => e.tag === tag);
    if (el?.attrs.value) return el.attrs.value;
  }
  return null;
}

function hasFlag(graph: EffectGraph, id: string, flag: string): boolean {
  for (const ancestor of parentChain(graph, id)) {
    const el = graph.nodes.get(ancestor)?.elements.find((e) => e.tag === "Flags" && e.attrs.index === flag);
    if (el) return el.attrs.value === "1";
  }
  return false;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// UseDuration on the apply effect overrides the behavior's own Duration.
export function appliedDuration(graph: EffectGraph, behaviorId: string, applierId?: string): number | null {
  const from = applierId && hasFlag(graph, applierId, "UseDuration") ? applierId : behaviorId;
  const raw = inheritedValue(graph, from, "Duration");
  const n = raw ? resolvedNumber(graph, raw) : null;
  return n !== null && n > 0 ? round(n) : null;
}

interface Field {
  value: number;
  accumulators: string[];
}

// The nearest declaration per tag+index wins, like catalog inheritance.
function chainFields(graph: EffectGraph, id: string, tag: string): Map<string, Field> {
  const out = new Map<string, Field>();
  for (const ancestor of parentChain(graph, id)) {
    const node = graph.nodes.get(ancestor);
    if (!node) continue;
    for (const el of findAll(node.elements, tag)) {
      const key = el.attrs.index ?? "";
      if (out.has(key) || el.attrs.value === undefined) continue;
      const n = resolvedNumber(graph, el.attrs.value);
      if (n === null) continue;
      out.set(key, { value: n, accumulators: accumulatorIds(el) });
    }
  }
  return out;
}

const accumulatorIds = (el: Element) =>
  findAll(el.children, "AccumulatorArray").map((a) => a.attrs.value).filter((v): v is string => Boolean(v));

// Core base accumulators hold engine defaults, not caps.
const BASE_ACCUMULATOR = /^Base\w*Accumulator$/;
// Token counter Max meaning "no limit".
const UNLIMITED_TOKENS = 65535;

function accumulatorField(graph: EffectGraph, id: string, tag: string): number | null {
  for (const ancestor of parentChain(graph, id)) {
    if (BASE_ACCUMULATOR.test(ancestor)) continue;
    const el = graph.nodes.get(ancestor)?.elements.find((e) => e.tag === tag);
    if (el?.attrs.value !== undefined) return resolvedNumber(graph, el.attrs.value);
  }
  return null;
}

// Signed accumulation at full stacks (or missing life), clamped to Min/MaxAccumulation.
// Null when nothing in the data bounds it.
export function accumulatorEndpoint(graph: EffectGraph, id: string, maxDelta = 0): number | null {
  const node = graph.nodes.get(id);
  if (!node) return null;
  const declaredMax = accumulatorField(graph, id, "MaxAccumulation");
  const max = declaredMax !== null ? declaredMax + maxDelta : null;
  const min = accumulatorField(graph, id, "MinAccumulation");
  const scale = accumulatorField(graph, id, "Scale") ?? 1;
  let full: number | null = null;
  if (node.tag === "CAccumulatorToken") {
    const token = inheritedValue(graph, id, "TokenId");
    const tokenMax = token ? accumulatorField(graph, token, "Max") : null;
    full = tokenMax !== null && tokenMax < UNLIMITED_TOKENS ? (accumulatorField(graph, id, "Offset") ?? 0) + scale * tokenMax : null;
  } else if (node.tag === "CAccumulatorVitals") {
    full = accumulatorField(graph, id, "Ratio") ?? 1;
  }
  if (full !== null) return Math.min(Math.max(full, min ?? -Infinity), max ?? Infinity);
  return scale < 0 ? min : max;
}

// Core defaults: typed accumulators multiply, the untyped base adds.
const MULTIPLY_BY_DEFAULT = new Set(["CAccumulatorVitals", "CAccumulatorToken", "CAccumulatorTimed", "CAccumulatorDistanceUnitTraveled"]);

function isMultiply(graph: EffectGraph, id: string): boolean {
  const rule = inheritedValue(graph, id, "ApplicationRule");
  return rule ? rule === "Multiply" : MULTIPLY_BY_DEFAULT.has(graph.nodes.get(id)?.tag ?? "");
}

// Field value with every accumulator at its endpoint; null when one is unbounded.
// A damage-modifier accumulator supplies the modifier itself, so it always adds.
function accumulatedValue(graph: EffectGraph, raw: number, accumulators: string[], maxDeltas: Map<string, number>, additive: boolean): number | null {
  let out = raw;
  for (const id of accumulators) {
    const end = accumulatorEndpoint(graph, id, maxDeltas.get(id) ?? 0);
    if (end === null) return null;
    out = !additive && isMultiply(graph, id) ? out * (1 + end) : out + end;
  }
  return out;
}

const percent = (n: number) => round(Math.abs(n) * 100);

function amount(value: number, unit: EffectValue["unit"], source: string, accumulators: string[] = []): EffectValue {
  return { stat: "amount", value, unit, source, ...(accumulators.length > 0 && { scales: true, accumulators }) };
}

function signMatches(n: number, polarity: MechanicLike["statPolarity"]): boolean {
  return polarity === "decrease" ? n < 0 : n > 0;
}

function pickFields(fields: Map<string, Field>, keys: string[], polarity: MechanicLike["statPolarity"]): Field[] {
  return [...fields.entries()]
    .filter(([key, f]) => (keys.length === 0 || keys.includes(key)) && (f.value !== 0 || f.accumulators.length > 0) && (f.value === 0 || signMatches(f.value, polarity)))
    .map(([, f]) => f);
}

const strongest = (fields: Field[]) =>
  fields.length === 0 ? null : fields.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));

function armorAmount(graph: EffectGraph, mech: MechanicLike, id: string): EffectValue[] {
  const polarity = mech.armorPolarity;
  const all = pickFields(chainFields(graph, id, "AllArmorBonus"), [], polarity);
  const table = chainFields(graph, id, "ArmorMitigationTable");
  const keys = mech.armorDamageKind === "physical" ? ["Basic"] : mech.armorDamageKind === "magical" ? ["Ability"] : [];
  const field = strongest(all) ?? strongest(pickFields(table, keys, polarity));
  return field ? [amount(round(Math.abs(field.value)), "armor", id, field.accumulators)] : [];
}

const DAMAGE_KEYS: Record<string, string[]> = { general: [], physical: ["Basic", "Splash"], spell: ["Ability"] };

function behaviorAmounts(graph: EffectGraph, mech: MechanicLike, id: string): EffectValue[] {
  const one = (fields: Field[]) => {
    const f = strongest(fields);
    return f ? [amount(percent(f.value), "%", id, f.accumulators)] : [];
  };
  if (mech.primaryBehavior === "StormSlowParent") {
    return one(pickFields(chainFields(graph, id, "UnifiedMoveSpeedFactor"), [], "decrease"));
  }
  if (mech.armorPolarity) return armorAmount(graph, mech, id);
  if (mech.statModifier === "attack-speed") {
    return one(pickFields(chainFields(graph, id, "AdditiveAttackSpeedFactor"), [], mech.statPolarity));
  }
  if (mech.statModifier === "damage") {
    return one(pickFields(chainFields(graph, id, "DamageDealtFraction"), DAMAGE_KEYS[mech.statDamageKind ?? "general"], mech.statPolarity));
  }
  if (mech.statModifier === "lifesteal") {
    const kind = mech.statDamageKind === "physical" ? "Basic" : "Ability";
    const fields = parentChain(graph, id)
      .flatMap((a) => findAll(graph.nodes.get(a)?.elements ?? [], "VitalDamageLeechArray"))
      .filter((leech) => leech.attrs.index === "Life")
      .flatMap((leech) => findAll(leech.children, "KindArray"))
      .filter((ka) => ka.attrs.index === kind && ka.attrs.value)
      .map((ka) => ({ value: resolvedNumber(graph, ka.attrs.value) ?? 0, accumulators: accumulatorIds(ka) }));
    return one(pickFields(new Map(fields.map((f, i) => [String(i), f])), [], "increase"));
  }
  if (mech.slug === "healing-increase") {
    return one(pickFields(chainFields(graph, id, "HealTakenAdditiveMultiplier"), [], "increase"));
  }
  if (mech.slug === "healing-reduction") {
    return one(pickFields(chainFields(graph, id, "HealTakenAdditiveMultiplier"), [], "decrease"));
  }
  return [];
}

function effectAmounts(graph: EffectGraph, mech: MechanicLike, id: string): EffectValue[] {
  if (mech.statModifier !== "lifesteal") return [];
  const leech = chainFields(graph, id, "LeechFraction").get("Life");
  return leech && leech.value > 0 ? [amount(percent(leech.value), "%", id, leech.accumulators)] : [];
}

function inheritedAttr(graph: EffectGraph, id: string, tag: string, attr: string): string | null {
  for (const ancestor of parentChain(graph, id)) {
    const el = graph.nodes.get(ancestor)?.elements.find((e) => e.tag === tag && e.attrs[attr] !== undefined);
    if (el) return el.attrs[attr];
  }
  return null;
}

// ArmorModification applies once unless its StackCount says otherwise; block charges rely on this.
function stackCap(graph: EffectGraph, id: string, armor: boolean): number {
  const num = (raw: string | null) => (raw ? resolvedNumber(graph, raw) : null);
  const caps = [
    num(inheritedValue(graph, id, "MaxStackCount")) ?? 1,
    num(inheritedValue(graph, id, "MaxStackCountPerCaster")),
    armor ? num(inheritedAttr(graph, id, "ArmorModification", "StackCount")) ?? 1 : null,
  ].filter((n): n is number => n !== null && n > 0);
  return Math.min(...caps);
}

// Ranges an amount over its accumulators; an unbounded one keeps the "+" marker instead.
export function withAccumulatorMax(
  graph: EffectGraph,
  mech: MechanicLike,
  v: EffectValue,
  maxDeltas = new Map<string, number>(),
  additive = false,
): EffectValue {
  if (v.stat !== "amount" || !v.accumulators?.length) return v;
  const unitScale = v.unit === "%" ? 100 : 1;
  const end = accumulatedValue(graph, (mechanicSign(mech) * v.value) / unitScale, v.accumulators, maxDeltas, additive);
  if (end === null) return { ...v, scales: true };
  const { scales: _, max: __, ...rest } = v;
  const [lo, hi] = [v.value, round(Math.abs(end) * unitScale)].sort((a, b) => a - b);
  return hi !== lo ? { ...rest, value: lo, max: hi } : { ...rest, value: lo };
}

const withStacks = (graph: EffectGraph, mech: MechanicLike, id: string) => (v: EffectValue): EffectValue => {
  const stacks = stackCap(graph, id, Boolean(mech.armorPolarity));
  return stacks > 1 ? { ...v, stacks } : v;
};

export function sourceValues(graph: EffectGraph, mech: MechanicLike, source: MatchSource): EffectValue[] {
  if (source.modifier !== undefined && source.effect) {
    const value = amount(percent(source.modifier), "%", source.effect, source.accumulator ? [source.accumulator] : []);
    return [withAccumulatorMax(graph, mech, source.modifier === 0 ? { ...value, scales: true } : value, undefined, true)];
  }
  if (source.behavior && graph.nodes.get(source.behavior)?.tag.startsWith("CBehavior")) {
    const duration = appliedDuration(graph, source.behavior, source.effect);
    const via = source.effect && hasFlag(graph, source.effect, "UseDuration") ? source.effect : undefined;
    const durationValue: EffectValue = { stat: "duration", value: duration ?? 0, unit: "s", source: source.behavior, ...(via && { via }) };
    return [
      ...(duration !== null ? [durationValue] : []),
      ...behaviorAmounts(graph, mech, source.behavior)
        .map((v) => withAccumulatorMax(graph, mech, v))
        .map(withStacks(graph, mech, source.behavior)),
    ];
  }
  return source.effect ? effectAmounts(graph, mech, source.effect).map((v) => withAccumulatorMax(graph, mech, v)) : [];
}

const valueKey = (v: EffectValue) => `${v.stat}\u0000${v.value}\u0000${v.source}\u0000${v.via ?? ""}\u0000${v.modifies ?? ""}`;

export function uniqueValues(values: EffectValue[]): EffectValue[] {
  return [...new Map(values.map((v) => [valueKey(v), v])).values()].sort(
    (a, b) => a.stat.localeCompare(b.stat) || a.value - b.value || a.source.localeCompare(b.source),
  );
}

interface FlatModification {
  behavior: string;
  field: string;
  delta: number;
}

function flatModifications(graph: EffectGraph, talent: GraphNode, catalog: string): FlatModification[] {
  return findAll(talent.elements, "Modifications").flatMap((mod) => {
    const attr = (tag: string) => mod.children.find((c) => c.tag === tag)?.attrs.value;
    const delta = resolvedNumber(graph, attr("Value") ?? "");
    const behavior = attr("Entry");
    const field = attr("Field");
    if (attr("Type") !== "FlatModification" || attr("Catalog") !== catalog) return [];
    return behavior && field && delta ? [{ behavior, field, delta }] : [];
  });
}

// A talent raising an accumulator's cap widens the range of every amount it scales.
function accumulatorModifiedValues(graph: EffectGraph, mech: MechanicLike, talent: GraphNode, entries: AbilTalentEntry[]): EffectValue[] {
  const maxDeltas = new Map(
    flatModifications(graph, talent, "Accumulator")
      .filter(({ field }) => field === "MaxAccumulation")
      .map(({ behavior, delta }) => [behavior, delta]),
  );
  if (maxDeltas.size === 0) return [];
  return entries.flatMap((entry) =>
    (entry.values ?? [])
      .filter((v) => !v.modifies && v.accumulators?.some((id) => maxDeltas.has(id)))
      .map((v) => ({ ...withAccumulatorMax(graph, mech, v, maxDeltas), modifies: entry.nameId }))
      .filter((v) => v.max !== undefined),
  );
}

function modifiedStat(mech: MechanicLike, field: string): EffectValue["stat"] | null {
  if (field === "Duration") return "duration";
  if (field === "Modification.UnifiedMoveSpeedFactor") return mech.primaryBehavior === "StormSlowParent" ? "amount" : null;
  if (field === "Modification.AdditiveAttackSpeedFactor") return mech.statModifier === "attack-speed" ? "amount" : null;
  if (field === "ArmorModification.AllArmorBonus") return mech.armorPolarity ? "amount" : null;
  const damage = /^Modification\.DamageDealtFraction\[(\w+)\]$/.exec(field);
  if (damage && mech.statModifier === "damage") {
    const keys = DAMAGE_KEYS[mech.statDamageKind ?? "general"];
    return keys.length === 0 || keys.includes(damage[1]) ? "amount" : null;
  }
  return null;
}

function mechanicSign(mech: MechanicLike): number {
  if (mech.primaryBehavior === "StormSlowParent") return -1;
  return (mech.armorPolarity ?? mech.statPolarity) === "decrease" ? -1 : 1;
}

function applyDelta(mech: MechanicLike, base: EffectValue, delta: number): number | null {
  if (base.stat === "duration") return base.value + delta > 0 ? round(base.value + delta) : null;
  const scale = base.unit === "%" ? 100 : 1;
  const raw = (mechanicSign(mech) * base.value) / scale + delta;
  return Math.sign(raw) === mechanicSign(mech) ? round(Math.abs(raw) * scale) : null;
}

// A talent that edits a behavior an entry reads gets that value, changed, credited to it.
export function talentModifiedValues(
  graph: EffectGraph,
  mech: MechanicLike,
  talent: GraphNode,
  entries: AbilTalentEntry[],
): EffectValue[] {
  const deltas = new Map<string, Map<EffectValue["stat"], number>>();
  for (const { behavior, field, delta } of flatModifications(graph, talent, "Behavior")) {
    const stat = modifiedStat(mech, field);
    if (!stat) continue;
    const byStat = deltas.get(behavior) ?? new Map();
    byStat.set(stat, (byStat.get(stat) ?? 0) + delta);
    deltas.set(behavior, byStat);
  }
  // Unchanged stats of the same behavior are copied, so amount and duration stay paired.
  const behaviorEdits = [...deltas.entries()].flatMap(([behavior, byStat]) =>
    entries.flatMap((entry) => {
      const base = (entry.values ?? []).filter((v) => v.source === behavior && !v.modifies);
      const changed = base.map((v) => {
        const delta = v.via ? undefined : byStat.get(v.stat);
        const value = delta === undefined ? v.value : applyDelta(mech, v, delta);
        return value === null ? null : { ...v, value, modifies: entry.nameId, changed: delta !== undefined };
      });
      if (changed.some((v) => v === null) || !changed.some((v) => v?.changed)) return [];
      return changed.map((v) => {
        const { changed: _, ...value } = v!;
        return value;
      });
    }),
  );
  return [...behaviorEdits, ...accumulatorModifiedValues(graph, mech, talent, entries)];
}
