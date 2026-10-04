// Mechanic notes of an ability: how it picks targets, per-target lockouts, and what its caster buffs disable and end on.

import type { AbilityNote } from "../types.ts";
import type { EffectGraph, Element, GraphNode } from "./effect-graph/types.ts";
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

const FILTER_STATES: Record<string, string> = { Dead: "death" };

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

function priorityNote(graph: EffectGraph, node: GraphNode) {
  if (node.tag !== "CEffectEnumArea" || !findsEnemies(graph, node.id) || sendsSummons(graph, node)) return null;
  const areaMax = node.elements.find((e) => e.tag === "AreaArray" && e.attrs.MaxCount)?.attrs.MaxCount;
  const max = positive(number(graph, inheritedValue(graph, node.id, "MaxCount") ?? areaMax));
  const phrases = sortPhrases(graph, node.id);
  if (max === null || phrases.length === 0) return null;
  const targets = max === 1 ? "target" : "targets";
  const verb = (node.refs.Effect ?? []).some((id) => graph.nodes.get(id)?.tag === "CEffectIssueOrder") ? "Attacks" : "Hits";
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
function lockoutNote(graph: EffectGraph, node: GraphNode) {
  const absent = (node.refs.ValidatorArray ?? []).filter((v) => !onCaster(graph, v)).flatMap((v) => absentBehavior(graph, v) ?? []);
  if (absent.length === 0) return null;
  const chain = reached(graph, [node.id]).filter(({ node: n }) => n.tag !== "CEffectApplyBehavior" || !onCaster(graph, n.id));
  const locksOnly = chain.every(({ node: n }) => absent.some((b) => appliesItself(graph, n.id, b) && inert(graph, b)));
  const guards = absent.some((b) => (absenceGates(graph).get(b) ?? []).some((id) => !appliesItself(graph, id, b)));
  const lock = locksOnly && !guards ? undefined : lockout(graph, chain, absent);
  return lock && lock >= MIN_LOCKOUT ? `Hits each target at most once per ${trimmed(lock)}s.` : null;
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
    const [required, excluded] = (inheritedValue(graph, id, "Filters") ?? "").split(";").map((s) => s.split(",").filter((f) => f && f !== "-"));
    const flags = [...(required ?? []), ...(excluded ?? [])];
    if (flags.length === 0 || flags.some((f) => !FILTER_STATES[f])) return null;
    const need = (required ?? []).map((f) => FILTER_STATES[f]);
    const deny = (excluded ?? []).map((f) => FILTER_STATES[f]);
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

function endNotes(graph: EffectGraph, node: GraphNode) {
  if (inert(graph, node.id)) return [];
  const sentence = (verb: string, validators: string[], skip?: string) => {
    const found = failingStates(graph, validators);
    const failing = found?.failing.filter((s) => s !== skip) ?? [];
    if (!found || failing.length === 0) return null;
    const except = found.except.length > 0 ? `, except during ${joined(found.except)}` : "";
    return `${verb} ${joined(failing)}${except}.`;
  };
  // A dead unit's buffs stop anyway, so "pauses during death" says nothing.
  return [
    sentence("Ends on", allValues(graph, node.id, "RemoveValidatorArray")),
    sentence("Pauses during", allValues(graph, node.id, "DisableValidatorArray"), "death"),
  ];
}

export function abilityNotes(graph: EffectGraph, abilId: string, nameOf: NameOf): GatedNote[] {
  if (!graph.nodes.get(abilId)?.tag.startsWith("CAbil")) return [];
  const visits = walk(graph, abilId, null);
  const leastGated = visits.filter((v) => !visits.some((w) => w.id === v.id && w.gates.length < v.gates.length));
  const note = (label: string | null, node: GraphNode, gates: string[]) =>
    label ? [{ label, source: node.id, gates, hitGates: ownGates(graph, node) }] : [];
  const buffs = leastGated.filter((v) => isCasterBuff(graph, v));
  // One disabled-abilities note per gate set, merged over the buffs, e.g. a form with several buffs.
  const disabled = [...new Set(buffs.map((v) => v.gates.join()))].flatMap((key) => {
    const group = buffs.filter((v) => v.gates.join() === key);
    const ids = group.flatMap((v) => disabledIds(graph, graph.nodes.get(v.id)!));
    return note(disabledNote(graph, ids, nameOf), graph.nodes.get(group[0].id)!, group[0].gates);
  });
  const notes = [
    ...disabled,
    ...leastGated.flatMap((visit) => {
      const node = graph.nodes.get(visit.id)!;
      const ends = buffs.includes(visit) ? endNotes(graph, node) : [];
      return [priorityNote(graph, node), lockoutNote(graph, node), ...ends].flatMap((label) => note(label, node, visit.gates));
    }),
  ];
  return notes.filter((n, i) => notes.findIndex((m) => m.label === n.label && m.gates.join() === n.gates.join()) === i);
}
