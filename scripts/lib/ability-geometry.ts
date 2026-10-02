// Range and area of an ability, read from the effect graph.

import type { AbilityArea } from "../types.ts";
import type { EffectGraph, Element, GraphNode } from "./effect-graph/types.ts";
import { findAll, findFirst } from "./effect-graph/traverse.ts";
import { parentChain } from "./effect-graph/walk.ts";
import { isDormantEffectWithoutEnabler } from "./effect-graph/gating.ts";
import { resolvedNumber } from "./effect-graph/xml.ts";

// Condition validators on the path; resolved to talents or traits once the hero's entries are known.
export interface GatedArea extends AbilityArea {
  gates: string[];
}

export interface AbilityGeometry {
  range: number | null;
  radius: number | null;
  width: number | null;
  areas: GatedArea[];
}

interface Visit {
  id: string;
  summon: boolean;
  gates: string[];
}

interface Shape {
  radius: number | null;
  width: number | null;
  length: number | null;
  reach: number | null;
  search: boolean;
  outcomes: Set<string>;
  // Outcomes reached through a missile or order the area sends, not on the units it finds.
  relayed: Set<string>;
  outcomeGates: string[];
}

interface FoundArea extends Shape, Visit {}

// Vector-targeted skillshots use a huge Range; the missile defines the reach.
const PLACEHOLDER_RANGE = 50;
// Larger areas are global or helper scans.
const MAX_AREA = 15;
const MAX_WALK_DEPTH = 16;
const MAX_OUTCOME_DEPTH = 7;

const WALK_FIELDS = new Set([
  "Effect",
  "EffectArray",
  "CaseEffect",
  "CaseDefault",
  "InitialEffect",
  "LaunchEffect",
  "SearchEffect",
  "ImpactEffect",
  "PeriodicEffect",
  "PeriodicEffectArray",
  "ExpireEffect",
  "FinalEffect",
  "CancelEffect",
  "SpawnEffect",
  "Behavior",
]);

const CC_ROOTS: Record<string, string> = {
  StormStun: "stun",
  StormSlowParent: "slow",
  StormRoot: "root",
  StormSilence: "silence",
  StormBlind: "blind",
  StormTimeStopParent: "time stop",
  StormDisplacement: "knockback",
};

const BUFF_ROOTS = new Set([
  "StormArmor",
  "StormSprint",
  "StormProtect",
  "StormDamageIncrease",
  "StormDamageReduction",
  "StormUnstoppableParent",
  "StormCloak",
]);

function inheritedValue(graph: EffectGraph, id: string, tag: string) {
  for (const ancestor of parentChain(graph, id)) {
    const el = graph.nodes.get(ancestor)?.elements.find((e) => e.tag === tag);
    if (el?.attrs.value) return el.attrs.value;
  }
  return null;
}

function number(graph: EffectGraph, value: string | null | undefined) {
  return value ? resolvedNumber(graph, value) : null;
}

function rounded(n: number | null) {
  return n === null ? null : Math.round(n * 100) / 100;
}

function positive(n: number | null) {
  return n !== null && n > 0 ? n : null;
}

function childNumber(graph: EffectGraph, el: Element, tag: string) {
  return positive(number(graph, findFirst(el.children, tag)?.attrs.value));
}

function directRange(graph: EffectGraph, abilId: string) {
  const range = positive(number(graph, inheritedValue(graph, abilId, "Range")));
  return range !== null && range < PLACEHOLDER_RANGE ? range : null;
}

const PASSES_AT_ZERO: Record<string, (value: number) => boolean> = {
  eq: (v) => v === 0,
  ne: (v) => v !== 0,
  lt: (v) => 0 < v,
  le: (v) => 0 <= v,
  gt: (v) => 0 > v,
  ge: (v) => 0 >= v,
};

// A talent pick or a granted behavior/token, as opposed to target state or a "does not have" check.
function isCondition(graph: EffectGraph, validatorId: string, seen = new Set<string>()): boolean {
  const node = graph.nodes.get(validatorId);
  if (!node || seen.has(validatorId)) return false;
  seen.add(validatorId);
  const value = (tag: string) => inheritedValue(graph, validatorId, tag);
  if (node.tag === "CValidatorPlayerTalent") return value("Find") === "1";
  if (node.tag === "CValidatorUnitCompareBehaviorCount" || node.tag === "CValidatorUnitCompareTokenCount") {
    if (!value(node.tag === "CValidatorUnitCompareBehaviorCount" ? "Behavior" : "TokenId")) return false;
    const passes = PASSES_AT_ZERO[(value("Compare") ?? "eq").toLowerCase()];
    return passes !== undefined && !passes(number(graph, value("Value") ?? "0") ?? 0);
  }
  if (node.tag === "CValidatorCombine" && value("Negate") !== "1" && value("Type")?.toLowerCase() === "and") {
    return (node.refs.CombineArray ?? []).some((id) => isCondition(graph, id, seen));
  }
  return false;
}

export const CHANCE_GATE = "chance:";

// Chance=0 effects run only when a talent raises their chance.
function talentGate(graph: EffectGraph, gate: string) {
  return gate.startsWith(CHANCE_GATE) || graph.nodes.get(gate)?.tag === "CValidatorPlayerTalent";
}

function ownGates(graph: EffectGraph, node: GraphNode) {
  const validators = node.elements
    .filter((e) => e.tag === "ValidatorArray")
    .flatMap((e) => (e.attrs.value && isCondition(graph, e.attrs.value) ? [e.attrs.value] : []));
  return isDormantEffectWithoutEnabler(graph, node, new Map()) ? [...validators, CHANCE_GATE + node.id] : validators;
}

function caseGates(graph: EffectGraph, node: GraphNode) {
  const out = new Map<string, string>();
  if (node.tag !== "CEffectSwitch") return out;
  for (const c of node.elements.filter((e) => e.tag === "CaseArray")) {
    if (c.attrs.Effect && c.attrs.Validator && isCondition(graph, c.attrs.Validator)) out.set(c.attrs.Effect, c.attrs.Validator);
  }
  return out;
}

// DestroyPersistent's Effect names the persistent to stop, not one to run.
function walkRefs(node: GraphNode) {
  if (node.tag === "CEffectDestroyPersistent") return [];
  return Object.entries(node.refs).filter(([field]) => WALK_FIELDS.has(field));
}

function spawnedRoots(graph: EffectGraph, node: GraphNode) {
  if (node.tag !== "CEffectCreateUnit") return [];
  const unitIds = node.elements.filter((e) => e.tag === "SpawnUnit").flatMap((e) => (e.attrs.value ? [e.attrs.value] : []));
  return unitIds.flatMap((unitId) => {
    const unit = graph.nodes.get(unitId);
    const weapons = unit?.elements.filter((e) => e.tag === "WeaponArray").flatMap((e) => (e.attrs.Link ? [e.attrs.Link] : [])) ?? [];
    return [...(unit?.refs.BehaviorArray ?? []), ...weapons.flatMap((w) => graph.nodes.get(w)?.refs.Effect ?? [])];
  });
}

function children(graph: EffectGraph, visit: Visit): Visit[] {
  const node = graph.nodes.get(visit.id);
  if (!node) return [];
  const cases = caseGates(graph, node);
  const refs = walkRefs(node).flatMap(([field, ids]) =>
    ids.map((id) => ({
      id,
      summon: visit.summon || field === "SpawnEffect",
      gates: cases.has(id) ? [...visit.gates, cases.get(id)!] : visit.gates,
    })),
  );
  const spawned = spawnedRoots(graph, node).map((id) => ({ id, summon: true, gates: visit.gates }));
  return [...refs, ...spawned];
}

const childAbilCache = new WeakMap<EffectGraph, Map<string, string[]>>();

// Abilities that name this one as ParentAbil, e.g. the execute step of a charge-up ability. Siblings share it.
function childAbils(graph: EffectGraph, abilId: string) {
  let index = childAbilCache.get(graph);
  if (!index) {
    index = new Map();
    for (const node of graph.nodes.values()) {
      const parent = node.tag.startsWith("CAbil") ? node.elements.find((e) => e.tag === "ParentAbil")?.attrs.value : undefined;
      if (parent) index.set(parent, [...(index.get(parent) ?? []), node.id]);
    }
    childAbilCache.set(graph, index);
  }
  return index.get(abilId) ?? [];
}

function revisit(seen: Map<string, number>, visit: Visit) {
  const known = seen.get(visit.id);
  if (known !== undefined && known <= visit.gates.length) return false;
  seen.set(visit.id, visit.gates.length);
  return true;
}

// Breadth-first, so the cast's own effects win over deeper sub-effects. A less-gated path revisits a node.
function walk(graph: EffectGraph, abilId: string, cursorId: string | null): Visit[] {
  const seen = new Map<string, number>([[abilId, 0]]);
  const visits: Visit[] = [];
  const parent = graph.nodes.get(abilId)?.elements.find((e) => e.tag === "ParentAbil")?.attrs.value;
  const abils = [...new Set([abilId, ...childAbils(graph, abilId), ...(parent ? childAbils(graph, parent) : [])])];
  const roots = [...abils.flatMap((id) => graph.nodes.get(id)?.refs.Effect ?? []), ...(cursorId ? [cursorId] : [])];
  let layer: Visit[] = roots.map((id) => ({ id, summon: false, gates: [] }));
  for (let depth = 0; depth < MAX_WALK_DEPTH && layer.length > 0; depth++) {
    const fresh = layer
      .filter((v) => graph.nodes.has(v.id))
      .map((v) => ({ ...v, gates: [...v.gates, ...ownGates(graph, graph.nodes.get(v.id)!)] }))
      .filter((v) => revisit(seen, v));
    visits.push(...fresh);
    layer = fresh.flatMap((v) => children(graph, v));
  }
  return visits;
}

function firstOf<T>(items: T[], pick: (item: T) => number | null) {
  return items.reduce<number | null>((found, item) => found ?? pick(item), null);
}

function projectionDistance(graph: EffectGraph, node: GraphNode, tag = "ImpactLocation") {
  const location = node.elements.find((e) => e.tag === tag);
  return location ? childNumber(graph, location, "ProjectionDistanceScale") : null;
}

// A missile launch, or an order such as a dash move.
function travels(graph: EffectGraph, id: string, depth: number): boolean {
  const node = graph.nodes.get(id);
  if (!node || depth < 0) return false;
  if (node.tag.startsWith("CEffectLaunchMissile") || node.tag === "CEffectIssueOrder") return true;
  return walkRefs(node).some(([, ids]) => ids.some((c) => travels(graph, c, depth - 1)));
}

// Missiles or dashes aimed at a point offset forward of the caster, e.g. Stitches Hook,
// or a persistent projected forward from the caster, e.g. Mei's Avalanche.
function persistentOffset(graph: EffectGraph, node: GraphNode) {
  if (node.tag !== "CEffectCreatePersistent") return null;
  const projected = projectionDistance(graph, node, "WhichLocation");
  if (projected !== null) return projected;
  const where = node.elements.find((e) => e.tag === "WhichLocation")?.attrs.Value;
  if (where !== "CasterPoint" && where !== "CasterUnit") return null;
  const offset = node.elements.find((e) => e.tag === "PeriodicOffsetArray");
  if (!offset || number(graph, offset.attrs.X ?? "0")) return null;
  const periodic = [...(node.refs.PeriodicEffect ?? []), ...(node.refs.PeriodicEffectArray ?? [])];
  if (!periodic.some((id) => travels(graph, id, 2))) return null;
  return positive(-(number(graph, offset.attrs.Y ?? "0") ?? 0));
}

function accumulatorMax(graph: EffectGraph, accumulatorId: string) {
  if (graph.nodes.get(accumulatorId)?.tag !== "CAccumulatorToken") return null;
  const token = inheritedValue(graph, accumulatorId, "TokenId");
  const max = token ? number(graph, inheritedValue(graph, token, "Max")) : null;
  const scale = number(graph, inheritedValue(graph, accumulatorId, "Scale")) ?? 1;
  const offset = number(graph, inheritedValue(graph, accumulatorId, "Offset")) ?? 0;
  return max === null ? null : offset + scale * max;
}

const PROJECTION_REF = /^Effect,([^,]+),ImpactLocation\.ProjectionDistanceScale$/;

// Accumulator-driven overrides of a missile's projection, e.g. channel-scaled charges.
function projectionOverrides(graph: EffectGraph, node: GraphNode) {
  if (node.tag !== "CEffectModifyCatalogNumeric") return [];
  return node.elements
    .filter((e) => e.tag === "CatalogModifications")
    .flatMap((mod) => {
      const target = PROJECTION_REF.exec(mod.attrs.Reference ?? "")?.[1];
      const value = findFirst(mod.children, "Value");
      const accumulated = value ? findAll(value.children, "AccumulatorArray").map((a) => accumulatorMax(graph, a.attrs.value ?? "")) : [];
      if (!target || !value || accumulated.length === 0 || accumulated.some((n) => n === null)) return [];
      const max = accumulated.reduce<number>((sum, n) => sum + (n ?? 0), number(graph, value.attrs.value) ?? 0);
      return [{ target, max }];
    });
}

const overrideCache = new WeakMap<EffectGraph, Map<string, number>>();

function overriddenProjection(graph: EffectGraph, id: string) {
  const index =
    overrideCache.get(graph) ??
    new Map(
      [...graph.nodes.values()]
        .flatMap((n) => projectionOverrides(graph, n))
        .sort((a, b) => a.max - b.max)
        .map((o) => [o.target, o.max]),
    );
  overrideCache.set(graph, index);
  return positive(index.get(id) ?? null);
}

function projectionReach(graph: EffectGraph, node: GraphNode) {
  const own = projectionOverrides(graph, node).map((o) => o.max);
  return positive(own.length ? Math.max(...own) : null) ?? overriddenProjection(graph, node.id) ?? projectionDistance(graph, node);
}

function arcOf(graph: EffectGraph, area: Element) {
  return number(graph, area.attrs.Arc ?? findFirst(area.children, "Arc")?.attrs.value);
}

function rootOf(graph: EffectGraph, id: string) {
  return parentChain(graph, id).at(-1) ?? id;
}

function outcomeOf(graph: EffectGraph, node: GraphNode) {
  const root = rootOf(graph, node.id);
  if (node.tag === "CEffectDamage" && root === "StormDamage") return "damage";
  if (node.tag === "CEffectCreateHealer" && root === "StormHealingParent") return "heal";
  if (node.tag === "CEffectIssueOrder") return "order";
  if (node.tag.startsWith("CEffectLaunchMissile")) return "missile";
  if (node.tag === "CEffectEnumArea") return "trigger";
  if (!node.tag.startsWith("CBehavior")) return null;
  if (root === "StormDot") return "damage";
  return CC_ROOTS[root] ?? (BUFF_ROOTS.has(root) ? "buff" : null);
}

// What an area does to the units it finds. When every effect needs a talent, the area inherits those gates.
function outcomesOf(graph: EffectGraph, effectId: string | undefined) {
  const found: { outcome: string; gates: string[]; relayed: boolean }[] = [];
  const seen = new Set<string>();
  let layer = effectId ? [{ id: effectId, gates: [] as string[], relayed: false }] : [];
  for (let depth = 0; depth < MAX_OUTCOME_DEPTH && layer.length > 0; depth++) {
    const fresh = layer
      .filter((v) => !seen.has(v.id) && seen.add(v.id) && graph.nodes.has(v.id))
      .map((v) => ({ ...v, node: graph.nodes.get(v.id)!, gates: [...v.gates, ...ownGates(graph, graph.nodes.get(v.id)!)] }));
    for (const { node, gates, relayed } of fresh) {
      const outcome = outcomeOf(graph, node);
      if (outcome) found.push({ outcome, gates, relayed });
    }
    // A nested area search is its own area; its effects are not this area's.
    layer = fresh.filter(({ node }) => node.tag !== "CEffectEnumArea").flatMap(({ node, gates, relayed }) => {
      const cases = caseGates(graph, node);
      const relays = relayed || ["order", "missile"].includes(outcomeOf(graph, node) ?? "");
      // FinishEffect is often cleanup, but missiles can also deliver their payload there.
      const refs = [...walkRefs(node), ["FinishEffect", node.refs.FinishEffect ?? []] as const];
      return refs.flatMap(([, ids]) =>
        ids.map((id) => ({ id, gates: cases.has(id) ? [...gates, cases.get(id)!] : gates, relayed: relays })),
      );
    });
  }
  const talentGates = (f: (typeof found)[number]) => f.gates.filter((g) => talentGate(graph, g));
  const ungated = found.filter((f) => talentGates(f).length === 0);
  const kept = ungated.length > 0 ? ungated : found;
  return {
    outcomes: new Set(kept.filter((f) => !f.relayed).map((f) => f.outcome)),
    relayed: new Set(kept.filter((f) => f.relayed).map((f) => f.outcome)),
    outcomeGates: ungated.length > 0 ? [] : [...new Set(found.flatMap(talentGates))],
  };
}

// Forward length of a cone, triangle or polygon; it counts as range, not as an area size.
function reachOf(graph: EffectGraph, area: Element, radius: number | null) {
  const arc = arcOf(graph, area);
  if (radius !== null) return arc !== null && arc < 360 ? radius : null;
  const triangle = positive(number(graph, area.attrs.TriangleHeight ?? findFirst(area.children, "TriangleHeight")?.attrs.value));
  const vertices = findAll(area.children, "VertexArray").map((v) => number(graph, v.attrs.Y ?? "0") ?? 0);
  return triangle ?? positive(vertices.length > 0 ? Math.max(...vertices) : null);
}

function shapeOf(graph: EffectGraph, node: GraphNode, area: Element): Shape | null {
  const radius = childNumber(graph, area, "Radius");
  const width = childNumber(graph, area, "RectangleWidth");
  const reach = reachOf(graph, area, radius);
  if (radius === null && width === null && reach === null) return null;
  const maxCount = area.attrs.MaxCount ?? node.elements.find((e) => e.tag === "MaxCount")?.attrs.value;
  return {
    radius: reach === null ? radius : null,
    width,
    length: childNumber(graph, area, "RectangleHeight"),
    reach,
    search: maxCount === "1",
    ...outcomesOf(graph, area.attrs.Effect),
  };
}

function shapesOf(graph: EffectGraph, id: string): Shape[] {
  const node = graph.nodes.get(id);
  if (!node) return [];
  return node.elements.filter((e) => e.tag === "AreaArray").flatMap((a) => shapeOf(graph, node, a) ?? []);
}

function inBounds(shape: Shape) {
  return [shape.radius, shape.width, shape.length, shape.reach].every((n) => (n ?? 0) <= MAX_AREA);
}

function capitalized(text: string) {
  return text[0].toUpperCase() + text.slice(1);
}

function areaLabel(area: FoundArea) {
  const { outcomes, relayed } = area;
  if (area.search) {
    if (outcomes.has("trigger")) return null;
    if (outcomes.has("damage")) return "Hitbox";
    if (outcomes.has("heal") || relayed.has("heal")) return "Heal search";
    if (relayed.has("damage")) return "Damage search";
    return outcomes.has("order") ? "Target search" : null;
  }
  const all = new Set([...outcomes, ...relayed]);
  const cc = [...all].find((o) => !["damage", "heal", "order", "missile", "buff", "trigger"].includes(o));
  if (all.has("damage")) return "Damage area";
  if (all.has("heal")) return "Heal area";
  if (all.has("buff") && [...all].every((o) => ["buff", "order", "missile", "trigger"].includes(o))) return "Buff area";
  return cc ? `${capitalized(cc)} area` : null;
}

type Size = Pick<Shape, "radius" | "width" | "length">;

export function sameArea(a: AbilityArea, b: AbilityArea) {
  return a.label === b.label && sameShape(a, b);
}

function sameShape(a: Size, b: Size) {
  return a.radius === b.radius && a.width === b.width && a.length === b.length;
}

export function abilityGeometry(graph: EffectGraph, abilId: string): AbilityGeometry {
  if (!graph.nodes.get(abilId)?.tag.startsWith("CAbil")) return { range: null, radius: null, width: null, areas: [] };
  const cursorId = inheritedValue(graph, abilId, "CursorEffect");
  const cursor = cursorId ? shapesOf(graph, cursorId)[0] : undefined;
  const visits = walk(graph, abilId, cursorId);
  const leastGated = visits.filter((v) => !visits.some((w) => w.id === v.id && w.gates.length < v.gates.length));
  const found: FoundArea[] = leastGated
    .flatMap((v) => shapesOf(graph, v.id).map((s) => ({ ...s, ...v, gates: [...v.gates, ...s.outcomeGates] })))
    .filter(inBounds);
  const own = found.filter(
    (a) => !a.summon && a.reach === null && !a.search && a.gates.length === 0 && ![null, "Buff area"].includes(areaLabel(a)),
  );
  const circle = cursor?.radius ?? (cursor?.reach != null ? null : own.find((a) => a.radius !== null)?.radius ?? null);
  const width = cursor?.width ?? own.find((a) => a.width !== null)?.width ?? null;
  const cone = cursor?.reach ?? null;
  const nodes = visits.filter((v) => !v.summon && !v.gates.some((g) => talentGate(graph, g))).flatMap((v) => graph.nodes.get(v.id) ?? []);
  const projection = firstOf(nodes, (n) => projectionReach(graph, n));
  const primary = (a: FoundArea) =>
    a.gates.length === 0 && ((a.radius !== null && a.radius === circle) || (a.width !== null && a.width === width));
  const areas = found
    .filter((a) => a.reach === null && !primary(a))
    .flatMap((a) => {
      const label = areaLabel(a);
      return label ? [{ label, radius: a.radius, width: a.width, length: a.length, source: a.id, gates: a.gates }] : [];
    })
    .filter((a, i, all) => all.findIndex((b) => sameArea(a, b) && a.gates.join() === b.gates.join()) === i);
  return {
    range: rounded(directRange(graph, abilId) ?? projection ?? cone ?? firstOf(nodes, (n) => persistentOffset(graph, n))),
    radius: circle,
    width,
    areas,
  };
}
