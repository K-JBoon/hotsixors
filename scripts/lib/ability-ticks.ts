// Periodic hits of an ability: what one hit does, how often, and how many times.

import type { AbilityNote, AbilityTick } from "../types.ts";
import type { EffectGraph, GraphNode } from "./effect-graph/types.ts";
import { findFirst } from "./effect-graph/traverse.ts";
import { effectsApplyingBehavior, parentChain } from "./effect-graph/walk.ts";
import { chanceEnabledEffectIds } from "./effect-graph/gating.ts";
import {
  CHANCE_GATE,
  CC_ROOTS,
  caseGates,
  inheritedValue,
  isCondition,
  number,
  ownGates,
  positive,
  rootOf,
  walk,
  walkRefs,
  type Visit,
} from "./ability-geometry.ts";

export interface GatedTick extends AbilityTick {
  gates: string[];
  // Gates inside the source, on the hit itself.
  hitGates: string[];
  // The count holds only while this ability reapplies the source.
  refreshed: boolean;
}

// Period k waits periods[k % length], then fires effects[k % length].
interface Source {
  id: string;
  periods: number[];
  effects: string[];
  delay: number;
  initial: string[];
  // Persistent PeriodCount.
  ownHits: number | null;
  // Behavior Duration; a period that ends on expiry still hits.
  ownLength: number | null;
  limits: string[];
}

interface Bound {
  at: number;
  inclusive: boolean;
  refreshed?: boolean;
}

interface Payload {
  label: string;
  amount: number | null;
  gates: string[];
  // Behaviors the path needs absent.
  absent: string[];
  // Behaviors or tokens the path needs two or more of.
  stacks: string[];
  node: string;
}

const MAX_PAYLOAD_DEPTH = 8;
const MAX_HITS = 1000;
// Hits sampled to find the rate of a source with no known end.
const SAMPLE_HITS = 64;
const EPSILON = 1e-6;

const TARGET_KINDS: Record<string, string> = {
  Structure: "structures",
  Heroic: "Heroes",
  Minion: "minions",
};

// Nearest match up the parent chain wins.
const BEHAVIOR_LABELS: Record<string, string> = {
  StormSleep: "sleep",
  StormShield: "shield",
  StormEvasion: "evasion",
  StormProtect: "protected",
  StormInvulnerable: "invulnerable",
  StormUnstoppableParent: "unstoppable",
  StormArmor: "armor",
  StormSprint: "move speed",
  StormDamageIncrease: "damage increase",
  StormDamageReduction: "damage reduction",
  StormCloak: "stealth",
};

function trimmed(n: number) {
  return Number(n.toFixed(4));
}

function firstArray(graph: EffectGraph, id: string, tag: string) {
  for (const ancestor of parentChain(graph, id)) {
    const values = graph.nodes.get(ancestor)?.elements.filter((e) => e.tag === tag).flatMap((e) => e.attrs.value ?? []) ?? [];
    if (values.length > 0) return values;
  }
  return [];
}

function allValues(graph: EffectGraph, id: string, tag: string) {
  return parentChain(graph, id).flatMap(
    (ancestor) => graph.nodes.get(ancestor)?.elements.filter((e) => e.tag === tag).flatMap((e) => e.attrs.value ?? []) ?? [],
  );
}

function hasFlag(graph: EffectGraph, id: string, flag: string) {
  for (const ancestor of parentChain(graph, id)) {
    const el = graph.nodes.get(ancestor)?.elements.find((e) => e.tag === "Flags" && e.attrs.index === flag);
    if (el) return el.attrs.value === "1";
  }
  return false;
}

// UseDuration on the apply effect overrides the behavior's own Duration.
export function appliedDuration(graph: EffectGraph, behaviorId: string, applierId: string | undefined) {
  const from = applierId && hasFlag(graph, applierId, "UseDuration") ? applierId : behaviorId;
  return positive(number(graph, inheritedValue(graph, from, "Duration")));
}

// Effects past a missile's launch, not its impact, ride the missile and scan its path.
function ridesMissile(graph: EffectGraph, id: string, path: string[]) {
  const chain = [...path, id];
  const launch = chain.map((p) => graph.nodes.get(p)?.tag.startsWith("CEffectLaunchMissile")).lastIndexOf(true);
  return launch >= 0 && !(graph.nodes.get(chain[launch])?.refs.ImpactEffect ?? []).includes(chain[launch + 1]);
}

// Periods aimed at different offsets sweep an area, e.g. a thrown axe's path.
function sweeps(graph: EffectGraph, id: string) {
  const offsets = parentChain(graph, id)
    .map((a) => graph.nodes.get(a)?.elements.filter((e) => e.tag === "PeriodicOffsetArray") ?? [])
    .find((list) => list.length > 0);
  return new Set((offsets ?? []).map((e) => `${e.attrs.X ?? 0},${e.attrs.Y ?? 0}`)).size > 1;
}

// A source that moves its target, rides a missile, or sweeps an area is not a repeated hit.
function scans(graph: EffectGraph, id: string, path: string[]) {
  return rootOf(graph, id) === "StormDisplacement" || ridesMissile(graph, id, path) || sweeps(graph, id);
}

function sourceOf(graph: EffectGraph, id: string, path: string[]): Source | null {
  const node = graph.nodes.get(id);
  if (!node || scans(graph, id, path)) return null;
  const initial = inheritedValue(graph, id, "InitialEffect");
  if (node.tag.startsWith("CBehavior")) {
    const period = positive(number(graph, inheritedValue(graph, id, "Period")));
    const periodic = inheritedValue(graph, id, "PeriodicEffect");
    if (period === null || !periodic) return null;
    return {
      id,
      periods: [period],
      effects: [periodic],
      delay: 0,
      initial: initial ? [initial] : [],
      ownHits: null,
      ownLength: appliedDuration(graph, id, path.at(-1)),
      limits: allValues(graph, id, "RemoveValidatorArray"),
    };
  }
  if (node.tag !== "CEffectCreatePersistent") return null;
  const periods = firstArray(graph, id, "PeriodicPeriodArray").map((v) => number(graph, v) ?? 0);
  const effects = firstArray(graph, id, "PeriodicEffectArray");
  const hits = number(graph, inheritedValue(graph, id, "PeriodCount")) ?? 1;
  if (hits < 2 || effects.length === 0 || !periods.some((p) => p > 0)) return null;
  return {
    id,
    periods,
    effects,
    delay: number(graph, inheritedValue(graph, id, "InitialDelay")) ?? 0,
    initial: initial ? [initial] : [],
    ownHits: hits,
    ownLength: null,
    limits: allValues(graph, id, "PeriodicValidator"),
  };
}

function armorBonus(graph: EffectGraph, id: string) {
  for (const ancestor of parentChain(graph, id)) {
    const mod = graph.nodes.get(ancestor)?.elements.find((e) => e.tag === "ArmorModification");
    const bonus = mod ? findFirst(mod.children, "AllArmorBonus")?.attrs.value : undefined;
    if (bonus) return number(graph, bonus);
  }
  return null;
}

// A switch case on the walk that picks by target type, e.g. a separate DoT for structures.
function targetKind(graph: EffectGraph, chain: string[]) {
  for (const [i, id] of chain.slice(0, -1).entries()) {
    const node = graph.nodes.get(id);
    if (node?.tag !== "CEffectSwitch") continue;
    const validator = node.elements.find((e) => e.tag === "CaseArray" && e.attrs.Effect === chain[i + 1])?.attrs.Validator;
    if (!validator || graph.nodes.get(validator)?.tag !== "CValidatorUnitFilters" || onCaster(graph, validator)) continue;
    const required = (inheritedValue(graph, validator, "Filters") ?? "").split(";")[0].split(",").filter((f) => f && f !== "-");
    if (required.length === 1 && TARGET_KINDS[required[0]]) return TARGET_KINDS[required[0]];
  }
  return null;
}

function behaviorLabel(graph: EffectGraph, id: string, duration: number | null) {
  const root = rootOf(graph, id);
  const named = parentChain(graph, id).find((a) => BEHAVIOR_LABELS[a]);
  const kind = root === "StormDisplacement" ? undefined : named ? BEHAVIOR_LABELS[named] : CC_ROOTS[root];
  if (!kind) return null;
  const armor = root === "StormArmor" ? armorBonus(graph, id) : null;
  const what = armor ? `${armor > 0 ? "+" : ""}${trimmed(armor)} armor` : kind;
  return duration === null ? what : `${trimmed(duration)}s ${what}`;
}

// Amounts below 1 are dummy hits that only trigger procs.
function amounted(amount: number | null, label: string) {
  if (amount !== null && amount > 0 && amount < 1) return null;
  return { label, amount: amount ? trimmed(amount) : null };
}

function vitalFraction(graph: EffectGraph, id: string, tag: string) {
  return parentChain(graph, id).some((a) => graph.nodes.get(a)?.elements.some((e) => e.tag === tag && number(graph, e.attrs.value) !== null && number(graph, e.attrs.value)! > 0));
}

function damageKind(graph: EffectGraph, id: string) {
  if (vitalFraction(graph, id, "VitalFractionMax")) return "max health damage";
  if (vitalFraction(graph, id, "VitalFractionCurrent")) return "current health damage";
  return "damage";
}

function payloadOf(graph: EffectGraph, node: GraphNode): { label: string; amount: number | null } | null {
  const root = rootOf(graph, node.id);
  const value = (tag: string) => number(graph, inheritedValue(graph, node.id, tag));
  if (node.tag === "CEffectDamage" && root === "StormDamage") return amounted(value("Amount"), damageKind(graph, node.id));
  if (node.tag === "CEffectCreateHealer" && root === "StormHealingParent") return amounted(value("RechargeVitalRate"), "heal");
  const behavior = node.tag === "CEffectApplyBehavior" ? node.refs.Behavior?.[0] : undefined;
  const label = behavior ? behaviorLabel(graph, behavior, appliedDuration(graph, behavior, node.id)) : null;
  return label ? { label, amount: null } : null;
}

function same(a: { label: string; amount: number | null }, b: { label: string; amount: number | null }) {
  return a.label === b.label && a.amount === b.amount;
}

function sameGated(a: { label: string; amount: number | null; gates: string[] }, b: { label: string; amount: number | null; gates: string[] }) {
  return same(a, b) && a.gates.join() === b.gates.join();
}

// A nested source that fires each of its effects once is a delayed effect, not a ticker.
function repeats(graph: EffectGraph, id: string) {
  const source = sourceOf(graph, id, []);
  return source !== null && (source.ownHits === null || source.ownHits > new Set(source.effects).size);
}

// Stops at applied behaviors and nested tickers; those tick on their own.
export function reached(graph: EffectGraph, roots: string[]) {
  const out: { node: GraphNode; gates: string[]; checks: string[] }[] = [];
  const seen = new Set<string>();
  let layer = roots.map((id) => ({ id, gates: [] as string[], checks: [] as string[] }));
  for (let depth = 0; depth < MAX_PAYLOAD_DEPTH && layer.length > 0; depth++) {
    const fresh = layer
      .filter((v) => !seen.has(v.id) && seen.add(v.id) && graph.nodes.has(v.id))
      .map((v) => {
        const node = graph.nodes.get(v.id)!;
        return { node, gates: [...v.gates, ...ownGates(graph, node)], checks: [...v.checks, ...(node.refs.ValidatorArray ?? [])] };
      });
    out.push(...fresh);
    layer = fresh
      .filter(({ node }) => node.tag !== "CEffectApplyBehavior" && !repeats(graph, node.id))
      .flatMap(({ node, gates, checks }) => {
        const cases = caseGates(graph, node);
        return walkRefs(node)
          .filter(([field]) => field !== "Behavior")
          .flatMap(([, ids]) =>
            ids.map((id) => ({
              id,
              gates: cases.has(id) ? [...gates, cases.get(id)!] : gates,
              checks: cases.has(id) ? [...checks, cases.get(id)!] : checks,
            })),
          );
      });
  }
  return out;
}

function payloadsOf(graph: EffectGraph, roots: string[]): Payload[] {
  const found = reached(graph, roots).flatMap(({ node, gates, checks }) => {
    const payload = payloadOf(graph, node);
    const absent = checks.flatMap((v) => absentBehavior(graph, v) ?? []);
    return payload ? [{ ...payload, gates, absent, stacks: checks.flatMap((v) => stackGate(graph, v) ?? []), node: node.id }] : [];
  });
  return found.filter((p, i) => found.findIndex((q) => sameGated(q, p)) === i);
}

function marks(graph: EffectGraph, id: string) {
  return parentChain(graph, id).some((a) => graph.nodes.get(a)?.elements.some((e) => e.tag === "Marker"));
}

function checksMarkers(graph: EffectGraph, node: GraphNode) {
  return (node.refs.ValidatorArray ?? []).some((v) => graph.nodes.get(v)?.tag === "CValidatorUnitCompareMarkerCount");
}

// A marker at or above the source spans every period, so a marker check hits each unit once.
// A set or persistent below the source with its own marker starts a fresh one per period.
function hitsOnce(graph: EffectGraph, source: Source, path: string[]) {
  const chain = reached(graph, source.effects);
  return (
    [...path, source.id].some((id) => marks(graph, id)) &&
    chain.some(({ node }) => checksMarkers(graph, node)) &&
    !chain.some(({ node }) => ["CEffectSet", "CEffectCreatePersistent"].includes(node.tag) && marks(graph, node.id))
  );
}

export const COMPARES: Record<string, (count: number, value: number) => boolean> = {
  eq: (c, v) => c === v,
  ne: (c, v) => c !== v,
  lt: (c, v) => c < v,
  le: (c, v) => c <= v,
  gt: (c, v) => c > v,
  ge: (c, v) => c >= v,
};

// The behavior a validator needs absent; Compare and Value default to eq 0.
export function absentBehavior(graph: EffectGraph, validatorId: string) {
  if (graph.nodes.get(validatorId)?.tag !== "CValidatorUnitCompareBehaviorCount") return null;
  const passes = COMPARES[(inheritedValue(graph, validatorId, "Compare") ?? "eq").toLowerCase()];
  const value = number(graph, inheritedValue(graph, validatorId, "Value") ?? "0") ?? 0;
  return passes && passes(0, value) && !passes(1, value) ? inheritedValue(graph, validatorId, "Behavior") : null;
}

// The behavior or token a validator needs two or more of.
function stackGate(graph: EffectGraph, validatorId: string) {
  const tag = graph.nodes.get(validatorId)?.tag;
  if (tag !== "CValidatorUnitCompareBehaviorCount" && tag !== "CValidatorUnitCompareTokenCount") return null;
  const passes = COMPARES[(inheritedValue(graph, validatorId, "Compare") ?? "eq").toLowerCase()];
  const value = number(graph, inheritedValue(graph, validatorId, "Value") ?? "0") ?? 0;
  if (!passes || passes(0, value) || passes(1, value) || !passes(Math.max(2, value), value)) return null;
  return inheritedValue(graph, validatorId, tag === "CValidatorUnitCompareTokenCount" ? "TokenId" : "Behavior");
}

// A hit that needs stacks the same chain adds is a counter, e.g. every third hit, not every period.
function counted(graph: EffectGraph, chain: { node: GraphNode }[], stacks: string[]) {
  return chain.some(
    ({ node }) =>
      (node.tag === "CEffectApplyBehavior" && stacks.includes(node.refs.Behavior?.[0] ?? "")) ||
      (node.tag === "CEffectModifyTokenCount" && stacks.includes(inheritedValue(graph, node.id, "TokenId") ?? "")),
  );
}

// A hit that needs a behavior absent while the same chain applies it is locked out for that behavior's duration.
// Undefined: no lockout. Null: locked out for good.
export function lockout(graph: EffectGraph, chain: { node: GraphNode }[], absent: string[]) {
  const durations = chain
    .filter(({ node }) => node.tag === "CEffectApplyBehavior" && absent.includes(node.refs.Behavior?.[0] ?? ""))
    .map(({ node }) => appliedDuration(graph, node.refs.Behavior![0], node.id));
  if (durations.length === 0) return undefined;
  return durations.includes(null) ? null : Math.max(...(durations as number[]));
}

function stopped(graph: EffectGraph, node: GraphNode) {
  if (!["CEffectDestroyPersistent", "CEffectRemoveBehavior"].includes(node.tag)) return [];
  return [...(node.refs.Effect ?? []), ...(node.refs.Behavior ?? []), inheritedValue(graph, node.id, "BehaviorLink") ?? []].flat();
}

// Whether these effects stop the source, directly or through the final effect of a behavior they stop.
function stops(graph: EffectGraph, sourceId: string, roots: string[], depth = 2): boolean {
  const ended = reached(graph, roots).flatMap(({ node }) => stopped(graph, node));
  if (ended.includes(sourceId)) return true;
  if (depth === 0) return false;
  const finals = ended.flatMap((id) => (graph.nodes.get(id)?.tag.startsWith("CBehavior") ? (inheritedValue(graph, id, "FinalEffect") ?? []) : []));
  return finals.length > 0 && stops(graph, sourceId, finals, depth - 1);
}

function suicides(graph: EffectGraph, roots: string[]) {
  return reached(graph, roots).some(({ node }) => parentChain(graph, node.id).includes("StormSuicideParent"));
}

// A behavior put on the source's own unit that kills it when it ends, e.g. a short suicide delay.
function doomsSelf(graph: EffectGraph, node: GraphNode) {
  if (node.tag !== "CEffectApplyBehavior" || inheritedValueAttr(graph, node.id, "WhichUnit") !== "Source") return false;
  const behavior = node.refs.Behavior?.[0];
  const ends = behavior ? ["FinalEffect", "ExpireEffect"].flatMap((tag) => inheritedValue(graph, behavior, tag) ?? []) : [];
  return ends.length > 0 && suicides(graph, ends);
}

// A trigger that kills or stops itself on its first hit.
function endsItself(graph: EffectGraph, sourceId: string, roots: string[]) {
  return suicides(graph, roots) || reached(graph, roots).some(({ node }) => doomsSelf(graph, node)) || stops(graph, sourceId, roots);
}

export function onCaster(graph: EffectGraph, id: string) {
  return ["Caster", "Source"].includes(inheritedValueAttr(graph, id, "WhichUnit") ?? "");
}

function capped(graph: EffectGraph, node: GraphNode) {
  return inheritedValue(graph, node.id, "MaxCount") !== null || node.elements.some((e) => e.tag === "AreaArray" && e.attrs.MaxCount);
}

function appliesToTarget(graph: EffectGraph, node: GraphNode) {
  return node.tag === "CEffectApplyBehavior" && !onCaster(graph, node.id);
}

export function inheritedValueAttr(graph: EffectGraph, id: string, tag: string) {
  for (const ancestor of parentChain(graph, id)) {
    const el = graph.nodes.get(ancestor)?.elements.find((e) => e.tag === tag);
    if (el?.attrs.Value) return el.attrs.Value;
  }
  return null;
}

// A behavior above the source limits it only when its end stops the source, e.g. a channel controller.
function endsWith(graph: EffectGraph, behaviorId: string, sourceId: string) {
  const ends = ["FinalEffect", "ExpireEffect"].flatMap((tag) => inheritedValue(graph, behaviorId, tag) ?? []);
  return ends.length > 0 && stops(graph, sourceId, ends);
}

// Behaviors a validator needs present, e.g. a channel that keeps a persistent alive.
function requiredBehaviors(graph: EffectGraph, validatorId: string, seen = new Set<string>()): string[] {
  const node = graph.nodes.get(validatorId);
  if (!node || seen.has(validatorId) || !isCondition(graph, validatorId)) return [];
  seen.add(validatorId);
  if (node.tag === "CValidatorUnitCompareBehaviorCount") return node.refs.Behavior ?? [];
  return (node.refs.CombineArray ?? []).flatMap((id) => requiredBehaviors(graph, id, seen));
}

const referrersCache = new WeakMap<EffectGraph, Map<string, string[]>>();

// Non-validator records that link to each id, through any ref field.
function referrers(graph: EffectGraph) {
  let index = referrersCache.get(graph);
  if (!index) {
    index = new Map();
    for (const node of graph.nodes.values()) {
      if (node.tag.startsWith("CValidator")) continue;
      for (const id of new Set(Object.values(node.refs).flat())) {
        if (id !== node.id) index.set(id, [...(index.get(id) ?? []), node.id]);
      }
    }
    referrersCache.set(graph, index);
  }
  return index;
}

// A gate on a behavior granted only by apply effects that nothing runs can never pass, e.g. a leftover talent path.
// A behavior nothing links to may come from map script, so it stays.
function deadGate(graph: EffectGraph, validatorId: string) {
  const index = referrers(graph);
  return requiredBehaviors(graph, validatorId).some((b) => {
    const grants = index.get(b) ?? [];
    return grants.length > 0 && grants.every((id) => graph.nodes.get(id)?.tag === "CEffectApplyBehavior" && !index.has(id));
  });
}

// Prefer the least-gated apply effect on this ability's walk.
function durationOnWalk(graph: EffectGraph, behaviorId: string, visits: Map<string, Visit>) {
  const appliers = effectsApplyingBehavior(graph, behaviorId, { includeBehaviorDescendants: false })
    .flatMap((id) => visits.get(id) ?? [])
    .sort((a, b) => a.gates.length - b.gates.length);
  return appliedDuration(graph, behaviorId, appliers[0]?.id);
}

// A behavior on a summoned unit, or put there by its spawn effect, ends when the unit's timed life does.
function summonLifetimes(graph: EffectGraph, spawnerId: string | undefined) {
  const spawner = spawnerId ? graph.nodes.get(spawnerId) : undefined;
  if (spawner?.tag !== "CEffectCreateUnit") return [];
  const units = spawner.elements.filter((e) => e.tag === "SpawnUnit").flatMap((e) => e.attrs.value ?? []);
  return units
    .flatMap((u) => graph.nodes.get(u)?.refs.BehaviorArray ?? [])
    .filter((b) => parentChain(graph, b).includes("StormTimedLife"))
    .map((b) => appliedDuration(graph, b, undefined));
}

// A damage modifier that holds while a behavior the same cast applies lasts, e.g. reduced hits during a volley.
// The apply effect must need no gate the tick itself does not have. A modifier tied to the source holds for every hit.
function modifierWindow(graph: EffectGraph, damageId: string, visits: Map<string, Visit>, gates: string[], sourceId: string) {
  if (graph.nodes.get(damageId)?.tag !== "CEffectDamage") return null;
  const amount = number(graph, inheritedValue(graph, damageId, "Amount"));
  const modifiers = parentChain(graph, damageId).flatMap(
    (a) => graph.nodes.get(a)?.elements.filter((e) => e.tag === "MultiplicativeModifierArray" && e.attrs.Validator && e.attrs.Modifier) ?? [],
  );
  for (const mod of modifiers) {
    for (const behavior of requiredBehaviors(graph, mod.attrs.Validator)) {
      const applied = effectsApplyingBehavior(graph, behavior, { includeBehaviorDescendants: false }).some(
        (id) => visits.get(id)?.gates.every((g) => gates.includes(g)) ?? false,
      );
      const until = behavior === sourceId ? Infinity : applied ? durationOnWalk(graph, behavior, visits) : null;
      const modifier = number(graph, mod.attrs.Modifier) ?? 0;
      if (until !== null && amount && modifier !== 0) {
        return { until, label: modifier < 0 ? "reduced damage" : "increased damage", amount: trimmed(amount * (1 + modifier)) };
      }
    }
  }
  return null;
}

function firstPeriod(source: Source) {
  return source.delay + source.periods[0];
}

// A single-stack behavior that the nearest ticker above it reapplies before it expires, with no lockout, stays on
// until the last reapply plus its own length. A refresh keeps the period timer.
function refreshedLength(graph: EffectGraph, source: Source, visit: Visit, visits: Map<string, Visit>) {
  const length = source.ownLength;
  const stacks = number(graph, inheritedValue(graph, source.id, "MaxStackCount")) ?? 1;
  if (length === null || stacks > 1) return null;
  const outer = [...visit.path]
    .reverse()
    .map((id) => visits.get(id))
    .find((v) => v !== undefined && sourceOf(graph, v.id, v.path) !== null);
  if (!outer) return null;
  const applier = sourceOf(graph, outer.id, outer.path)!;
  const chain = reached(graph, applier.effects);
  const apply = chain.find(({ node }) => node.id === visit.path.at(-1));
  if (!apply || Math.max(...applier.periods) >= length - EPSILON) return null;
  if (lockout(graph, chain, apply.checks.flatMap((v) => absentBehavior(graph, v) ?? [])) !== undefined) return null;
  if (endsItself(graph, applier.id, applier.effects) || hitsOnce(graph, applier, outer.path)) return null;
  const bound = boundOf(graph, applier, outer, visits);
  if (applier.ownHits === null && bound === null) return null;
  const atStart = reached(graph, applier.initial).some(({ node }) => node.id === apply.node.id);
  const times = [...(atStart ? [0] : []), ...schedule(applier, bound).map((h) => h.at)];
  return times.length === 0 ? null : trimmed(times.at(-1)! - times[0] + length);
}

// The earliest end: own length (inclusive), behaviors above whose end stops it, behaviors a validator needs,
// or the timed life of a summoned host (exclusive).
function boundOf(graph: EffectGraph, source: Source, visit: Visit, visits: Map<string, Visit>): Bound | null {
  const ancestors = visit.path.flatMap((id, i) =>
    graph.nodes.get(id)?.tag.startsWith("CBehavior") && endsWith(graph, id, source.id) ? [appliedDuration(graph, id, visit.path[i - 1])] : [],
  );
  const required = source.limits.flatMap((v) => requiredBehaviors(graph, v)).map((b) => durationOnWalk(graph, b, visits));
  const host = summonLifetimes(graph, [...visit.path].reverse().find((id) => graph.nodes.get(id)?.tag === "CEffectCreateUnit"));
  // A limit that ends before the first hit is not this source's.
  const outside = [...ancestors, ...required, ...host].flatMap((n) => (n !== null && n > firstPeriod(source) + EPSILON ? [n] : []));
  const end = outside.length > 0 ? Math.min(...outside) : null;
  // A behavior that expires before its first period only ticks while something keeps reapplying it.
  const refreshed = refreshedLength(graph, source, visit, visits);
  const own = refreshed ?? (source.ownLength !== null && source.ownLength >= firstPeriod(source) - EPSILON ? source.ownLength : null);
  if (end !== null && (own === null || end <= own)) return { at: end, inclusive: false };
  return own === null ? null : { at: own, inclusive: true, refreshed: refreshed !== null };
}

// Behaviors whose end ends the source: itself, a behavior above it whose end stops it, or one its validator needs.
function lifetimeBehaviors(graph: EffectGraph, source: Source, visit: Visit) {
  const ancestors = visit.path.filter((id) => graph.nodes.get(id)?.tag.startsWith("CBehavior") && endsWith(graph, id, source.id));
  return [source.id, ...ancestors, ...source.limits.flatMap((v) => requiredBehaviors(graph, v))];
}

const chanceTalentCache = new WeakMap<EffectGraph, Map<string, string[]>>();

// Talents behind a gate: the talent a validator checks, or the talents that turn on a Chance 0 effect.
function gateTalents(graph: EffectGraph, gate: string) {
  let index = chanceTalentCache.get(graph);
  if (!index) {
    index = new Map();
    for (const node of graph.nodes.values()) {
      if (node.tag !== "CTalent") continue;
      for (const effect of chanceEnabledEffectIds(node)) index.set(effect, [...(index.get(effect) ?? []), node.id]);
    }
    chanceTalentCache.set(graph, index);
  }
  if (gate.startsWith(CHANCE_GATE)) return index.get(gate.slice(CHANCE_GATE.length)) ?? [];
  return graph.nodes.get(gate)?.tag === "CValidatorPlayerTalent" ? [inheritedValue(graph, gate, "Value") ?? ""] : [];
}

// An effect on the walk that lengthens the source's lifetime whenever the tick itself exists, e.g. a talent that
// extends a channel on each hit. The count then depends on the fight.
function extended(graph: EffectGraph, source: Source, visit: Visit, visits: Visit[], gates: string[]) {
  const lifetime = lifetimeBehaviors(graph, source, visit);
  const talents = new Set(gates.flatMap((g) => gateTalents(graph, g)));
  return visits.some((v) => {
    const node = graph.nodes.get(v.id);
    if (node?.tag !== "CEffectModifyBehaviorBuffDuration" || !lifetime.includes(node.refs.Behavior?.[0] ?? "")) return false;
    if ((number(graph, inheritedValue(graph, v.id, "Value")) ?? 0) <= 0) return false;
    return v.gates.every((g) => gates.includes(g) || (gateTalents(graph, g).length > 0 && gateTalents(graph, g).every((x) => talents.has(x))));
  });
}

function schedule(source: Source, bound: Bound | null) {
  const out: { at: number; effect: string }[] = [];
  const cap = source.ownHits ?? (bound ? MAX_HITS : SAMPLE_HITS);
  let at = source.delay;
  for (let k = 0; k < cap; k++) {
    at += source.periods[k % source.periods.length];
    if (bound && (bound.inclusive ? at > bound.at + EPSILON : at >= bound.at - EPSILON)) break;
    out.push({ at: trimmed(at), effect: source.effects[k % source.effects.length] });
  }
  return out;
}

// Drops hits that land inside the lockout of the previous one.
function spaced(times: number[], lock: number | undefined) {
  if (lock === undefined) return times;
  return times.reduce<number[]>((kept, at) => (kept.length === 0 || at - kept.at(-1)! >= lock - EPSILON ? [...kept, at] : kept), []);
}

interface Hits {
  label: string;
  amount: number | null;
  amountMax?: number;
  gates: string[];
  times: number[];
  node: string;
}

// Uneven hit times, e.g. a burst then a pause, have no single rate.
function even({ times }: Hits) {
  return times.every((at, i) => i < 2 || Math.abs(at - times[i - 1] - (times[1] - times[0])) < 0.001);
}

function tickOf(source: Source, visit: Visit, hits: Hits, known: boolean, refreshed: boolean): GatedTick {
  const { times } = hits;
  const period = trimmed((times.at(-1)! - times[0]) / (times.length - 1));
  return {
    label: hits.label,
    amount: hits.amount,
    ...(hits.amountMax === undefined ? {} : { amountMax: hits.amountMax }),
    period,
    rate: trimmed(1 / period),
    firstAt: times[0],
    count: known ? times.length : null,
    source: source.id,
    gates: [...visit.gates, ...hits.gates],
    hitGates: hits.gates,
    refreshed: known && refreshed,
  };
}

// Single hits of one kind at even steps are one ramping tick, e.g. poison that grows each second.
function ramps(singles: Hits[]): Hits[] {
  const kind = (h: Hits) => `${h.label}|${h.gates.join()}`;
  const groups = new Map<string, Hits[]>();
  for (const h of singles.filter((s) => s.amount !== null)) groups.set(kind(h), [...(groups.get(kind(h)) ?? []), h]);
  return [...groups.values()].flatMap((group) => {
    if (group.length < 2) return [];
    const sorted = [...group].sort((a, b) => a.times[0] - b.times[0]);
    const [first, last] = [sorted[0].amount!, sorted.at(-1)!.amount!];
    const times = sorted.map((h) => h.times[0]);
    if (first === last) return [{ ...sorted[0], times }];
    const label = `${first < last ? "growing" : "shrinking"} ${sorted[0].label}`;
    return [{ ...sorted[0], label, amount: Math.min(first, last), amountMax: Math.max(first, last), times }];
  });
}

export function abilityTicks(graph: EffectGraph, abilId: string): GatedTick[] {
  if (!graph.nodes.get(abilId)?.tag.startsWith("CAbil")) return [];
  const visits = walk(graph, abilId, null);
  const leastGated = visits.filter((v) => !visits.some((w) => w.id === v.id && w.gates.length < v.gates.length));
  const byId = new Map(leastGated.map((v) => [v.id, v] as const).reverse());
  const ticks = leastGated.flatMap((visit) => {
    const source = sourceOf(graph, visit.id, visit.path);
    if (!source || endsItself(graph, source.id, source.effects) || hitsOnce(graph, source, visit.path)) return [];
    const bound = boundOf(graph, source, visit, byId);
    const kind = targetKind(graph, [...visit.path, visit.id]);
    const bounded = source.ownHits !== null || bound !== null;
    const known = (gates: string[]) => bounded && !extended(graph, source, visit, leastGated, gates);
    const plan = schedule(source, bound);
    const chain = reached(graph, source.effects);
    // Behind a capped search, a lockout on the target caps each target, not the shots; the notes state the cap.
    const searched = chain.some(({ node }) => node.tag === "CEffectEnumArea" && capped(graph, node));
    const initial = payloadsOf(graph, source.initial);
    const byEffect = new Map([...new Set(source.effects)].map((e) => [e, payloadsOf(graph, [e])]));
    const payloads = [...byEffect.values()].flat();
    const all = payloads
      .filter((p, i) => payloads.findIndex((q) => sameGated(q, p)) === i)
      .flatMap((payload): Hits[] => {
        const lock = lockout(graph, searched ? chain.filter(({ node }) => !appliesToTarget(graph, node)) : chain, payload.absent);
        if (lock === null || payload.gates.some((g) => deadGate(graph, g)) || counted(graph, chain, payload.stacks)) return [];
        const fires = (effect: string) => byEffect.get(effect)!.some((q) => sameGated(q, payload));
        const firing = plan.filter((h) => fires(h.effect));
        // Different effects that each fire once are segments of one sweep, e.g. a sword swung through several areas.
        const segments = new Set(firing.map((h) => h.effect));
        if (segments.size > 1 && segments.size === firing.length) return [];
        const periodic = firing.map((h) => h.at);
        const atStart = initial.some((p) => same(p, payload));
        const times = spaced(atStart && periodic[0] !== 0 ? [0, ...periodic] : periodic, lock);
        const base = { label: payload.label, amount: payload.amount, gates: payload.gates, node: payload.node };
        const window = modifierWindow(graph, payload.node, byId, [...visit.gates, ...payload.gates], source.id);
        if (!window) return [{ ...base, times }];
        return [
          { ...base, label: window.label, amount: window.amount, times: times.filter((at) => at < window.until - EPSILON) },
          { ...base, times: times.filter((at) => at >= window.until - EPSILON) },
        ].filter((h) => h.times.length > 0);
      });
    const repeated = all.filter((h) => h.times.length > 1);
    return [...repeated, ...ramps(all.filter((h) => h.times.length === 1))]
      .filter(even)
      .map((h) => (kind ? { ...h, label: `${h.label} (${kind})` } : h))
      .map((h) => ({ node: h.node, tick: tickOf(source, visit, h, known([...visit.gates, ...h.gates]), bound?.refreshed ?? false) }));
  });
  // One effect on one schedule is one mechanic, e.g. a DoT a second talent swaps for a stronger copy.
  const sameHit = (a: (typeof ticks)[number], b: (typeof ticks)[number]) =>
    a.node === b.node && a.tick.period === b.tick.period && a.tick.firstAt === b.tick.firstAt && a.tick.count === b.tick.count;
  const looser = (a: GatedTick, b: GatedTick) => a.gates.length < b.gates.length && a.gates.every((g) => b.gates.includes(g));
  const kept = ticks.filter((t) => !ticks.some((u) => sameHit(u, t) && looser(u.tick, t.tick))).map((t) => t.tick);
  return kept.filter((t, i) => kept.findIndex((u) => u.source === t.source && sameGated(u, t)) === i);
}

export function tickNote({ label, rate, count, firstAt, source }: AbilityTick): AbilityNote {
  const total = count ? ` (×${count})` : "";
  const first = firstAt > 0 ? `, first at ${firstAt}s` : "";
  return { label: `${label[0].toUpperCase()}${label.slice(1)} tickrate: ${rate.toFixed(1)} per second${total}${first}`, source };
}
