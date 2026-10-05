// Mechanic notes of an ability: how it picks targets, per-target lockouts, and what its caster buffs disable and end on.

import type { AbilityNote } from "../types.ts";
import type { EffectGraph, Element, GraphNode } from "./effect-graph/types.ts";
import { findFirst } from "./effect-graph/traverse.ts";
import { parentChain } from "./effect-graph/walk.ts";
import { inheritedValue, number, ownGates, positive, walk, walkRefs, type Visit } from "./ability-geometry.ts";
import { COMPARES, absentBehavior, inheritedValueAttr, lockout, onCaster, reached } from "./ability-ticks.ts";

export interface GatedNote extends AbilityNote {
  gates: string[];
  // Gates on the node the note comes from.
  hitGates: string[];
}

export type NameOf = (abilId: string) => string | null | undefined;

const UNIT_KINDS: Record<string, string> = {
  Heroic: "Heroes",
  Structure: "structures",
  Minion: "Minions",
  Merc: "Mercenaries",
};

// Generic abilities a buff can disable. `verb` reads "Cannot <verb>", `use` reads "Cannot use <use>". No phrase: not worth a mention.
const DISABLED_ABILS: Record<string, { verb?: string; use?: string }> = {
  attack: { verb: "attack" },
  move: { verb: "move" },
  stop: {},
  HoldFire: {},
  Taunt: {},
  LootSpray: {},
  LootYellVoiceLine: {},
  Mount: { verb: "Mount" },
  MountCabooseSmartCommandUnitInteraction: { verb: "Mount" },
  Dismount: { verb: "Dismount" },
  Hearthstone: { verb: "Hearthstone" },
  FountainDrink: { use: "Healing Fountains" },
  UseVehicle: { use: "vehicles" },
  CaptureMacGuffin: { use: "objectives" },
  CaptureMacGuffinTwo: { use: "objectives" },
  MapMechanicAbilityTarget: { use: "objectives" },
  MapMechanicAbilityTarget2: { use: "objectives" },
  MapMechanicAbilityInstant: { use: "objectives" },
  SmartCommandUnitInteraction: { use: "map interactions" },
};

// Behavior categories a caster-state validator can test.
const CATEGORY_STATES: Record<string, string> = {
  Stun: "stun",
  DebuffSilence: "silence",
  DebuffStasis: "Stasis",
  TimeStop: "Time Stop",
  DebuffRoot: "root",
  DebuffBlind: "blind",
  Polymorph: "polymorph",
  Fear: "fear",
  Sleeping: "sleep",
  Taunt: "taunt",
  MindControl: "mind control",
  PushOrPull: "displacement",
};

const FILTER_STATES: Record<string, string> = { Dead: "death", Dazed: "daze" };

const STATE_ORDER = [...Object.values(FILTER_STATES), ...Object.values(CATEGORY_STATES)];

function byStateOrder(states: string[]) {
  return [...states].sort((a, b) => STATE_ORDER.indexOf(a) - STATE_ORDER.indexOf(b));
}

function trimmed(n: number) {
  return Number(n.toFixed(4));
}

function joined(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

function inheritedElements(graph: EffectGraph, id: string, tag: string): Element[] {
  for (const ancestor of parentChain(graph, id)) {
    const found = graph.nodes.get(ancestor)?.elements.filter((e) => e.tag === tag) ?? [];
    if (found.length > 0) return found;
  }
  return [];
}

function allValues(graph: EffectGraph, id: string, tag: string) {
  return parentChain(graph, id).flatMap(
    (ancestor) => graph.nodes.get(ancestor)?.elements.filter((e) => e.tag === tag).flatMap((e) => e.attrs.value ?? []) ?? [],
  );
}

function sortPhrase(graph: EffectGraph, id: string): string | null {
  const node = graph.nodes.get(id);
  const value = (tag: string) => inheritedValue(graph, id, tag);
  const descending = value("Descending") === "1";
  switch (node?.tag) {
    case "CTargetSortField": {
      const kind = /^Attributes\[(\w+)\]$/.exec(value("Field") ?? "")?.[1];
      return kind && value("Value") === "1" && !descending ? (UNIT_KINDS[kind] ?? null) : null;
    }
    case "CTargetSortDistance": {
      const where = inheritedValueAttr(graph, id, "WhichLocation");
      const far = descending ? "the farthest" : "the closest";
      if (!where) return far;
      return where === "TargetUnitOrPoint" ? `${far} to the target point` : null;
    }
    case "CTargetSortVital":
    case "CTargetSortVitalFraction": {
      if ((value("Vital") ?? "Life") !== "Life") return null;
      return `the ${descending ? "highest" : "lowest"} health${node.tag === "CTargetSortVitalFraction" ? " %" : ""}`;
    }
    case "CTargetSortRandom":
      return "random";
  }
  return null;
}

// Sorts after one that cannot be named only break its ties; a random sort leaves no ties.
function sortPhrases(graph: EffectGraph, id: string) {
  const sorts = inheritedElements(graph, id, "TargetSorts").flatMap((el) =>
    el.children.filter((c) => c.tag === "SortArray").flatMap((c) => c.attrs.value ?? []),
  );
  const phrases: string[] = [];
  for (const sort of sorts) {
    const phrase = sortPhrase(graph, sort);
    if (!phrase) break;
    phrases.push(phrase);
    if (phrase === "random") break;
  }
  return phrases;
}

// Helper searches that find the caster's own units, e.g. a portal's partner, pick no enemy.
function findsEnemies(graph: EffectGraph, id: string) {
  const [required = [], excluded = []] = (inheritedValue(graph, id, "SearchFilters") ?? "").split(";").map((s) => s.split(","));
  return !excluded.includes("Enemy") && !required.some((f) => ["Player", "Ally", "Self"].includes(f));
}

// A search that spawns units and orders an attack picks what summons fight, not what it hits.
function sendsSummons(graph: EffectGraph, node: GraphNode) {
  const seen = new Set<string>();
  const queue = [...(node.refs.Effect ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const next = graph.nodes.get(id);
    if (!next || seen.has(id)) continue;
    seen.add(id);
    if (next.tag === "CEffectSet" || next.tag === "CEffectSwitch") queue.push(...walkRefs(next).flatMap(([, ids]) => ids));
  }
  const tags = new Set([...seen].map((id) => graph.nodes.get(id)!.tag));
  return tags.has("CEffectCreateUnit") && tags.has("CEffectIssueOrder");
}

// Larger searches pick a target rather than detect a touch.
const MAX_HITBOX = 2;

function priorityNote(graph: EffectGraph, node: GraphNode) {
  if (node.tag !== "CEffectEnumArea" || !findsEnemies(graph, node.id) || sendsSummons(graph, node)) return null;
  const areaMax = node.elements.find((e) => e.tag === "AreaArray" && e.attrs.MaxCount)?.attrs.MaxCount;
  const max = positive(number(graph, inheritedValue(graph, node.id, "MaxCount") ?? areaMax));
  const phrases = sortPhrases(graph, node.id);
  if (max === null || phrases.length === 0) return null;
  const targets = max === 1 ? "target" : "targets";
  const verb = (node.refs.Effect ?? []).some((id) => graph.nodes.get(id)?.tag === "CEffectIssueOrder") ? "Attacks" : "Hits";
  // A skillshot's hitbox hits the first unit it touches; saying so adds nothing. A wide search for the closest unit is a choice.
  const radii = node.elements.filter((e) => e.tag === "AreaArray").map((a) => number(graph, findFirst(a.children, "Radius")?.attrs.value) ?? 0);
  if (verb === "Hits" && max === 1 && phrases.join() === "the closest" && radii.every((r) => r <= MAX_HITBOX)) return null;
  if (phrases[0] === "random") return `${verb} ${max} random ${targets}.`;
  return `${verb} ${max} ${targets}, preferring ${phrases.filter((p) => p !== "random").join(", then ")}.`;
}

// Shorter lockouts only merge overlapping hits of one moment.
const MIN_LOCKOUT = 0.25;

const absenceGatesCache = new WeakMap<EffectGraph, Map<string, string[]>>();

// Nodes each behavior's absence gates.
function absenceGates(graph: EffectGraph) {
  let index = absenceGatesCache.get(graph);
  if (!index) {
    index = new Map();
    for (const node of graph.nodes.values()) {
      for (const behavior of (node.refs.ValidatorArray ?? []).flatMap((v) => absentBehavior(graph, v) ?? [])) {
        index.set(behavior, [...(index.get(behavior) ?? []), node.id]);
      }
    }
    absenceGatesCache.set(graph, index);
  }
  return index;
}

function appliesItself(graph: EffectGraph, id: string, behavior: string) {
  const node = graph.nodes.get(id);
  return node?.tag === "CEffectApplyBehavior" && node.refs.Behavior?.[0] === behavior;
}

// The lockout behavior sits on the target, so it limits each target, not the whole ability.
// An inert behavior whose absence gates only its own apply locks nothing out, e.g. a sound cooldown.
// Past a search for the caster's own units, the hits belong to those units, e.g. ignited Oil Spills.
function lockoutNote(graph: EffectGraph, node: GraphNode, path: string[]) {
  if ([...path, node.id].some((id) => graph.nodes.get(id)?.tag === "CEffectEnumArea" && !findsEnemies(graph, id))) return null;
  const absent = (node.refs.ValidatorArray ?? []).filter((v) => !onCaster(graph, v)).flatMap((v) => absentBehavior(graph, v) ?? []);
  if (absent.length === 0) return null;
  const chain = reached(graph, [node.id]).filter(({ node: n }) => n.tag !== "CEffectApplyBehavior" || !onCaster(graph, n.id));
  const locksOnly = chain.every(({ node: n }) => absent.some((b) => appliesItself(graph, n.id, b) && inert(graph, b)));
  const guards = absent.some((b) => (absenceGates(graph).get(b) ?? []).some((id) => !appliesItself(graph, id, b)));
  const lock = locksOnly && !guards ? undefined : lockout(graph, chain, absent);
  return lock && lock >= MIN_LOCKOUT ? `Hits each target at most once per ${trimmed(lock)}s.` : null;
}

// A missile that moves the hero, e.g. a dash, stops when the hero is rooted; its periodic validator ends the travel.
function carriesCaster(graph: EffectGraph, visit: Visit) {
  const validator = graph.nodes.get(visit.id)!.tag.startsWith("CEffectLaunchMissile")
    ? inheritedValue(graph, visit.id, "PeriodicValidator")
    : null;
  return validator !== null && (failingStates(graph, [validator])?.failing.includes("root") ?? false);
}

// The hero leaves the map and controls another unit, e.g. Ultimate Evolution's clone; its own buffs say nothing about that unit.
function removesCaster(graph: EffectGraph, visit: Visit) {
  const applier = visit.path.at(-1);
  return (
    parentChain(graph, visit.id).includes("StormStasisRemoved") &&
    applier !== undefined &&
    ["Caster", "Source"].includes(inheritedValueAttr(graph, applier, "WhichUnit") ?? "")
  );
}

function isCasterBuff(graph: EffectGraph, visit: Visit) {
  const applier = visit.path.at(-1);
  return (
    graph.nodes.get(visit.id)!.tag.startsWith("CBehavior") &&
    applier !== undefined &&
    graph.nodes.get(applier)?.tag === "CEffectApplyBehavior" &&
    inheritedValueAttr(graph, applier, "WhichUnit") === "Caster"
  );
}

// Abilities that apply the buff themselves are left out: their cooldown already blocks a recast.
function disabledIds(graph: EffectGraph, node: GraphNode) {
  const ids = parentChain(graph, node.id).flatMap(
    (a) =>
      graph.nodes
        .get(a)
        ?.elements.filter((e) => e.tag === "Modification")
        .flatMap((m) => m.children.filter((c) => c.tag === "AbilLinkDisableArray").flatMap((c) => c.attrs.value ?? [])) ?? [],
  );
  return ids.filter((id) => DISABLED_ABILS[id] || !walk(graph, id, null).some((v) => v.id === node.id));
}

function disabledNote(graph: EffectGraph, ids: string[], nameOf: NameOf) {
  const generic = Object.entries(DISABLED_ABILS).flatMap(([id, phrase]) => (ids.includes(id) ? [phrase] : []));
  const own = [...new Set(ids)]
    .filter((id) => !DISABLED_ABILS[id] && !id.endsWith("Cancel") && graph.nodes.get(id)?.tag.startsWith("CAbil"))
    .flatMap((id) => nameOf(id) ?? []);
  const verbs = [...new Set(generic.flatMap((g) => g.verb ?? []))];
  const uses = [...new Set([...own, ...generic.flatMap((g) => g.use ?? [])])];
  const sentences = [verbs.length > 0 ? `Cannot ${joined(verbs)}.` : "", uses.length > 0 ? `Cannot use ${joined(uses)}.` : ""];
  return sentences.filter(Boolean).join(" ") || null;
}

interface Formula {
  test: (on: Set<string>) => boolean;
  states: string[];
}

function compared(graph: EffectGraph, id: string, state: string): Formula | null {
  const passes = COMPARES[(inheritedValue(graph, id, "Compare") ?? "eq").toLowerCase()];
  const value = number(graph, inheritedValue(graph, id, "Value") ?? "0") ?? 0;
  if (!passes || passes(0, value) === passes(1, value)) return null;
  const whenOn = passes(1, value);
  return { test: (on) => on.has(state) === whenOn, states: [state] };
}

// A caster-state validator as a formula over named states. Null when any part has no name.
function formulaOf(graph: EffectGraph, id: string, seen = new Set<string>()): Formula | null {
  const node = graph.nodes.get(id);
  if (!node || seen.has(id)) return null;
  seen.add(id);
  if (node.tag === "CValidatorCombine") {
    const parts = (node.refs.CombineArray ?? []).map((c) => formulaOf(graph, c, seen));
    if (parts.length === 0 || parts.some((p) => p === null)) return null;
    const all = (inheritedValue(graph, id, "Type") ?? "Or").toLowerCase() === "and";
    const negate = inheritedValue(graph, id, "Negate") === "1";
    return {
      test: (on) => (all ? parts.every((p) => p!.test(on)) : parts.some((p) => p!.test(on))) !== negate,
      states: parts.flatMap((p) => p!.states),
    };
  }
  if (!onCaster(graph, id)) return null;
  if (node.tag === "CValidatorUnitCompareBehaviorCount" && !inheritedValue(graph, id, "Behavior")) {
    const categories = inheritedElements(graph, id, "Categories").filter((e) => e.attrs.value === "1");
    const state = categories.length === 1 ? CATEGORY_STATES[categories[0].attrs.index ?? ""] : undefined;
    return state ? compared(graph, id, state) : null;
  }
  if (node.tag === "CValidatorUnitFilters") {
    const [required = [], excluded = []] = (inheritedValue(graph, id, "Filters") ?? "")
      .split(";")
      .map((s) => s.split(",").filter((f) => f && f !== "-"));
    if (required.length + excluded.length === 0 || required.some((f) => !FILTER_STATES[f])) return null;
    const need = required.map((f) => FILTER_STATES[f]);
    // An unnamed excluded flag, e.g. Hallucination, reads as never on.
    const deny = excluded.flatMap((f) => FILTER_STATES[f] ?? []);
    return { test: (on) => need.every((s) => on.has(s)) && deny.every((s) => !on.has(s)), states: [...need, ...deny] };
  }
  return null;
}

// States that alone fail every validator in the list, and states that keep them passing next to each of those.
function failingStates(graph: EffectGraph, validators: string[]) {
  const parts = validators.map((v) => formulaOf(graph, v));
  if (parts.length === 0 || parts.some((p) => p === null)) return null;
  const test = (on: Set<string>) => parts.every((p) => p!.test(on));
  if (!test(new Set())) return null;
  const states = byStateOrder([...new Set(parts.flatMap((p) => p!.states))]);
  const failing = states.filter((s) => !test(new Set([s])));
  const except = states.filter((e) => !failing.includes(e) && failing.every((s) => test(new Set([s, e]))));
  return failing.length > 0 ? { failing, except } : null;
}

// A buff that modifies nothing and runs no effects only tracks state, e.g. for actors or a reactivation check.
function inert(graph: EffectGraph, id: string) {
  const chain = parentChain(graph, id);
  if (graph.nodes.get(chain.at(-1)!)?.parentAttr) return false;
  return !chain.some((a) => {
    const node = graph.nodes.get(a);
    return (
      node !== undefined &&
      (node.elements.some(
        (e) => e.tag === "BehaviorCategories" || (e.tag === "Modification" && (e.children.length > 0 || Object.keys(e.attrs).length > 0)),
      ) ||
        Object.keys(node.refs).some((field) => field.endsWith("Effect")))
    );
  });
}

function endValidators(graph: EffectGraph, node: GraphNode) {
  if (!node.tag.startsWith("CBehavior")) return [inheritedValue(graph, node.id, "PeriodicValidator") ?? []].flat();
  return allValues(graph, node.id, "RemoveValidatorArray");
}

function pauseValidators(graph: EffectGraph, node: GraphNode) {
  return node.tag.startsWith("CBehavior") ? allValues(graph, node.id, "DisableValidatorArray") : [];
}

// One sentence over all buffs and dash missiles: the ability ends when any of them ends. Ones with an unnamed validator
// are left out. The source is the first that ends on its own, so a buff shared by sibling abilities does not claim the note.
function endNotes(graph: EffectGraph, nodes: GraphNode[]) {
  const live = nodes.filter((n) => !inert(graph, n.id));
  const sentence = (verb: string, validatorsOf: (node: GraphNode) => string[], skip?: string) => {
    const named = live
      .map((node) => ({ node, validators: validatorsOf(node) }))
      .filter(({ validators }) => validators.every((v) => formulaOf(graph, v) !== null));
    const found = failingStates(graph, named.flatMap((n) => n.validators));
    const failing = found?.failing.filter((s) => s !== skip) ?? [];
    if (!found || failing.length === 0) return null;
    const except = found.except.length > 0 ? `, except during ${joined(found.except)}` : "";
    const source = named.find(({ validators }) => failingStates(graph, validators))?.node ?? named[0].node;
    return { label: `${verb} ${joined(failing)}${except}.`, source };
  };
  // A dead unit's buffs stop anyway, so "pauses during death" says nothing.
  return [
    sentence("Ends on", (node) => endValidators(graph, node)),
    sentence("Pauses during", (node) => pauseValidators(graph, node), "death"),
  ];
}

export function abilityNotes(graph: EffectGraph, abilId: string, nameOf: NameOf): GatedNote[] {
  if (!graph.nodes.get(abilId)?.tag.startsWith("CAbil")) return [];
  const visits = walk(graph, abilId, null);
  const leastGated = visits.filter((v) => !visits.some((w) => w.id === v.id && w.gates.length < v.gates.length));
  const note = (label: string | null, node: GraphNode, gates: string[]) =>
    label ? [{ label, source: node.id, gates, hitGates: ownGates(graph, node) }] : [];
  const buffs = [...leastGated.filter((v) => isCasterBuff(graph, v)), ...leastGated.filter((v) => carriesCaster(graph, v))];
  const removed = new Set(leastGated.filter((v) => removesCaster(graph, v)).map((v) => v.gates.join()));
  // Buff notes merge per gate set, e.g. a form or a dash with several buffs.
  const groups = [...new Set(buffs.map((v) => v.gates.join()))]
    .filter((key) => !removed.has(key))
    .map((key) => buffs.filter((v) => v.gates.join() === key));
  const notes = [
    ...groups.flatMap((group) => {
      const nodes = group.map((v) => graph.nodes.get(v.id)!);
      const disabled = disabledNote(graph, nodes.flatMap((n) => disabledIds(graph, n)), nameOf);
      const ends = endNotes(graph, nodes).flatMap((end) => (end ? note(end.label, end.source, group[0].gates) : []));
      return [...note(disabled, nodes[0], group[0].gates), ...ends];
    }),
    ...leastGated.flatMap((visit) => {
      const node = graph.nodes.get(visit.id)!;
      return [priorityNote(graph, node), lockoutNote(graph, node, visit.path)].flatMap((label) => note(label, node, visit.gates));
    }),
  ];
  return notes.filter((n, i) => notes.findIndex((m) => m.label === n.label && m.gates.join() === n.gates.join()) === i);
}
