// Places each ability area, tick and note on the card it belongs to: the ability, a trait state it depends on, or a talent.

import type { AbilityArea, AbilityNote, AbilityTick } from "../types.ts";
import type { AbilTalentEntry, AnchorIndex, EffectGraph, GraphNode, ReverseRef } from "./effect-graph/types.ts";
import { chanceEnabledEffectIds, talentIdsFromValidators, validatorTalentIds } from "./effect-graph/gating.ts";
import { hasIdBoundary, resolveEffectOwners } from "./effect-graph/owners.ts";
import { effectsApplyingBehavior, parentChain, rootAbilityAnchorIds } from "./effect-graph/walk.ts";
import { CHANCE_GATE, isCondition, sameArea, type GatedArea } from "./ability-geometry.ts";
import type { GatedTick } from "./ability-ticks.ts";
import type { GatedNote } from "./ability-notes.ts";

export interface AreaEntry {
  nameId: string;
  name: string;
  icon: string;
  abilityType?: string;
  tier?: string;
  stats: { radius: number | null; width: number | null } | null;
}

interface Hero {
  slug: string;
  name: string;
  abilities: AreaEntry[];
  talents: AreaEntry[];
}

function anchorIndex(hero: Hero): AnchorIndex {
  const entry = (kind: "ability" | "talent") => (e: AreaEntry) =>
    [e.nameId, { kind, nameId: e.nameId, heroSlug: hero.slug, heroName: hero.name, name: e.name, icon: e.icon, abilityType: e.abilityType }] as const;
  return Object.fromEntries([...hero.abilities.map(entry("ability")), ...hero.talents.map(entry("talent"))]);
}

function checkedBehaviors(graph: EffectGraph, validatorId: string, seen = new Set<string>()): string[] {
  const node = graph.nodes.get(validatorId);
  if (!node || seen.has(validatorId)) return [];
  seen.add(validatorId);
  return [...(node.refs.Behavior ?? []), ...(node.refs.CombineArray ?? []).flatMap((id) => checkedBehaviors(graph, id, seen))];
}

function chanceTalents(graph: EffectGraph, index: AnchorIndex, effectId: string) {
  return Object.values(index).filter((e) => {
    const node = e.kind === "talent" ? graph.nodes.get(e.nameId) : undefined;
    return node !== undefined && chanceEnabledEffectIds(node).includes(effectId);
  });
}

// Talents an effect needs: the first talent check or talent active on every path up to an ability, or a state check
// a talent grants, e.g. a buff a talent's active ability puts on the hero. Empty when a path has none.
function upstreamTalents(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  index: AnchorIndex,
  ownerId: string,
  effectId: string,
  checked: Set<string>,
) {
  const stateTalents = (node: GraphNode) =>
    (node.refs.ValidatorArray ?? [])
      .filter((v) => !checked.has(v) && checked.add(v) && isCondition(graph, v))
      .flatMap((v) => gateOwners(graph, reverseRefs, index, ownerId, v, checked))
      .flatMap((c) => (c.kind === "talent" ? [c.nameId] : []));
  const found = new Set<string>();
  const seen = new Set<string>();
  const queue = [effectId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = graph.nodes.get(id);
    const own = index[id]?.kind === "talent" ? [id] : node ? talentIdsFromValidators(graph, index, node) : [];
    const talents = own.length > 0 || !node ? own : stateTalents(node);
    if (talents.length > 0) {
      talents.forEach((t) => found.add(t));
      continue;
    }
    if (index[id]?.kind === "ability") return [];
    queue.push(...(reverseRefs.get(id) ?? []).filter((r) => !r.node.tag.startsWith("CValidator")).map((r) => r.node.id));
  }
  return [...found];
}

// A marker the owner itself applies names no other ability; the talents above its apply effects then gate it.
function gateOwners(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  index: AnchorIndex,
  ownerId: string,
  validatorId: string,
  checked = new Set([validatorId]),
): AbilTalentEntry[] {
  if (validatorId.startsWith(CHANCE_GATE)) return chanceTalents(graph, index, validatorId.slice(CHANCE_GATE.length));
  const talents = validatorTalentIds(graph, index, validatorId).flatMap((id) => index[id] ?? []);
  if (talents.length > 0) return talents;
  const appliers = checkedBehaviors(graph, validatorId).flatMap((b) => effectsApplyingBehavior(graph, b));
  const applierTalents = appliers.map((e) => {
    const node = graph.nodes.get(e);
    return node ? talentIdsFromValidators(graph, index, node) : [];
  });
  const named = (ids: string[]) => [...new Set(ids)].flatMap((id) => index[id] ?? []);
  if (appliers.length > 0 && applierTalents.every((t) => t.length > 0)) return named(applierTalents.flat());
  const anchors = named(appliers.flatMap((e) => [...rootAbilityAnchorIds(reverseRefs, index, e)]));
  if (anchors.some((a) => a.nameId !== ownerId)) return anchors;
  const upstream = appliers.map((e) => upstreamTalents(graph, reverseRefs, index, ownerId, e, checked));
  return appliers.length > 0 && upstream.every((t) => t.length > 0) ? named(upstream.flat()) : anchors;
}

// Unit validators default to the target; caster and source checks are the hero's own state.
function checksTarget(graph: EffectGraph, validatorId: string, seen = new Set<string>()): boolean {
  const node = graph.nodes.get(validatorId);
  if (!node || seen.has(validatorId)) return false;
  seen.add(validatorId);
  if (node.tag === "CValidatorCombine") return (node.refs.CombineArray ?? []).some((id) => checksTarget(graph, id, seen));
  if (!node.tag.startsWith("CValidatorUnit")) return false;
  const which = parentChain(graph, validatorId)
    .map((id) => graph.nodes.get(id)?.elements.find((e) => e.tag === "WhichUnit"))
    .find((e) => e !== undefined);
  return !["Caster", "Source"].includes(which?.attrs.Value ?? "");
}

function commonPrefix(ids: string[]) {
  return ids.reduce((prefix, id) => {
    let i = 0;
    while (i < prefix.length && prefix[i] === id[i]) i++;
    return prefix.slice(0, i);
  });
}

// Several owners share an effect; keep those named in the area's record, e.g. Transcendence.
function namedOwners(owners: AbilTalentEntry[], source: string) {
  if (owners.length < 2) return owners;
  const prefix = commonPrefix(owners.map((o) => o.nameId));
  const named = owners.filter((o) => {
    const name = o.nameId.slice(prefix.length);
    return name.length > 0 && source.includes(name);
  });
  return named.length > 0 ? named : owners;
}

// Whether a record id names a talent past the hero prefix they share.
function names(source: string, nameId: string) {
  const rest = nameId.slice(commonPrefix([nameId, source]).length);
  return rest === "" || source.includes(rest);
}

function lowerFirst(text: string) {
  return text[0].toLowerCase() + text.slice(1);
}

interface Placement {
  nameId: string;
  area: AbilityArea;
  owner: string;
  variant: boolean;
}

function strip({ gates: _gates, ...area }: GatedArea): AbilityArea {
  return area;
}

interface Target {
  nameId: string;
  prefix: string | undefined;
  // Other talents the item also needs.
  also: string | undefined;
  requires: string[];
  variant: boolean;
  // Ungated and kept on its own ability.
  plain: boolean;
}

// A talent check on a talent the hero cannot pick never passes, e.g. a talent removed from the tree.
function unpickable(graph: EffectGraph, index: AnchorIndex, validatorId: string) {
  if (graph.nodes.get(validatorId)?.tag !== "CValidatorPlayerTalent") return false;
  const talents = validatorTalentIds(graph, index, validatorId);
  return talents.length > 0 && talents.every((id) => !index[id]);
}

function gatedTargets(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  index: AnchorIndex,
  owner: AreaEntry,
  gateIds: string[],
  source: string,
  hitGates: string[] = [],
  place?: Place,
): Target[] {
  if (gateIds.some((g) => unpickable(graph, index, g))) return [];
  const gates = gateIds.map((g) => ({
    conditions: gateOwners(graph, reverseRefs, index, owner.nameId, g),
    onTarget: !g.startsWith(CHANCE_GATE) && checksTarget(graph, g),
  }));
  const talentEntries = gates.flatMap((g) => g.conditions).filter((c) => c.kind === "talent");
  const talents = [...new Set(namedOwners(talentEntries, source).map((c) => c.nameId))];
  const stateGate = gates.find((g) => g.conditions.some((c) => c.kind === "ability" && c.nameId !== owner.nameId));
  const state = stateGate?.conditions.find((c) => c.kind === "ability" && c.nameId !== owner.nameId);
  const prefix = state && (stateGate!.onTarget ? `On ${state.name} target` : state.name);
  // A talent on the path to the source may be one route of several; it binds only when the hit or the source names it.
  const required = gates.flatMap((g, i) => {
    const list = g.conditions.filter((c) => c.kind === "talent");
    return list.length === 1 && (hitGates.includes(gateIds[i]) || names(source, list[0].nameId)) ? list : [];
  });
  const also = (nameId: string) => {
    const names = [...new Set(required.filter((c) => c.nameId !== nameId).map((c) => c.name))];
    return names.length > 0 ? names.join(", ") : undefined;
  };
  const requires = (nameId: string) => [...new Set([nameId, ...required.map((c) => c.nameId)])];
  const target = (nameId: string, variant = false, plain = false) => ({ nameId, prefix, also: also(nameId), requires: requires(nameId), variant, plain });
  if (talents.length > 0) return talents.map((nameId) => target(nameId, true));
  if (gateIds.some((g) => g.startsWith(CHANCE_GATE))) return [];
  if (prefix) return [target(owner.nameId)];
  if (gateIds.length === 0) {
    const owners: AbilTalentEntry[] = resolveEffectOwners(graph, reverseRefs, index, new Map(), source);
    if (owners.length > 0 && !owners.some((o) => o.nameId === owner.nameId)) {
      // Of several owners, those whose own walk finds the record hold it.
      const finders = owners.filter((o) => place?.finds(o.nameId));
      return namedOwners(finders.length > 0 ? finders : owners, source).map((o) => target(o.nameId));
    }
    if (place?.elsewhere) return [target(place.elsewhere.nameId)];
  }
  return [target(owner.nameId, false, true)];
}

// The ability whose id starts the record id, the longest one.
function namedAbility(hero: Hero, source: string) {
  return hero.abilities.filter((e) => hasIdBoundary(source, e.nameId)).sort((a, b) => b.nameId.length - a.nameId.length)[0];
}

// A shared mechanic named after another ability that does not reach it itself, e.g. a bleed every ability applies.
// An owner or talent the record names more closely keeps it.
function namedElsewhere(hero: Hero, found: Map<string, { source: string }[]>, owner: AreaEntry, source: string) {
  const named = namedAbility(hero, source);
  if (!named || commonPrefix([owner.nameId, source]).length >= named.nameId.length) return undefined;
  if (hero.talents.some((t) => t.nameId !== named.nameId && names(source, t.nameId))) return undefined;
  return (found.get(named.nameId) ?? []).some((x) => x.source === source) ? undefined : named;
}

interface Place {
  elsewhere: AreaEntry | undefined;
  finds: (nameId: string) => boolean;
}

function placeOf(hero: Hero, found: Map<string, { source: string }[]>, owner: AreaEntry, source: string): Place {
  return {
    elsewhere: namedElsewhere(hero, found, owner, source),
    finds: (nameId) => (found.get(nameId) ?? []).some((x) => x.source === source),
  };
}

function prefixed<T extends { label: string }>(item: T, prefix: string | undefined): T {
  return prefix ? { ...item, label: `${prefix}: ${lowerFirst(item.label)}` } : item;
}

function placeArea(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  index: AnchorIndex,
  owner: AreaEntry,
  area: GatedArea,
  place: Place,
): Placement[] {
  const base = strip(area);
  const repeatsStat = [owner.stats?.radius, owner.stats?.width].some((n) => n != null && (n === base.radius || n === base.width));
  // Moved to the ability it is named after, a circle of that ability's radius adds nothing.
  const { elsewhere } = place;
  const repeatsHome = elsewhere?.stats?.radius != null && elsewhere.stats.radius === base.radius;
  return gatedTargets(graph, reverseRefs, index, owner, area.gates, area.source, [], place)
    .filter((t) => !t.plain || !(base.label === "Buff area" || repeatsStat))
    .filter((t) => t.nameId !== elsewhere?.nameId || !repeatsHome)
    .map((t) => ({ nameId: t.nameId, area: prefixed(base, t.prefix), owner: owner.nameId, variant: t.variant }));
}

// Area lists keyed by entry nameId. Areas start on the ability whose walk found them.
export function assignAreas(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  hero: Hero,
  found: Map<string, GatedArea[]>,
): Map<string, AbilityArea[]> {
  const index = anchorIndex(hero);
  const placements = hero.abilities.flatMap((owner) =>
    (found.get(owner.nameId) ?? []).flatMap((area) =>
      placeArea(graph, reverseRefs, index, owner, area, placeOf(hero, found, owner, area.source)),
    ),
  );
  // A talent variant that keeps a size its ability already shows does not change the area.
  const ownerSizes = (owner: string) => {
    const stats = hero.abilities.find((e) => e.nameId === owner)?.stats;
    const kept = placements.filter((p) => p.nameId === owner && p.owner === owner).map((p) => p.area);
    return new Set([stats?.radius, stats?.width, ...kept.flatMap((a) => [a.radius, a.width])].filter((n) => n != null));
  };
  const changing = placements.filter(
    (p) => !p.variant || ![p.area.radius, p.area.width].some((n) => n !== null && ownerSizes(p.owner).has(n)),
  );
  const out = new Map<string, AbilityArea[]>();
  for (const { nameId, area } of changing) {
    const list = out.get(nameId) ?? [];
    if (!list.some((b) => sameArea(b, area))) list.push(area);
    out.set(nameId, list);
  }
  return new Map([...out].map(([nameId, list]) => [nameId, mergeSteps(list)]));
}

// Talents of one tier exclude each other.
function pickable(hero: Hero) {
  const tiers = new Map(hero.talents.map((t) => [t.nameId, t.tier]));
  return (t: Target) => {
    const picked = t.requires.flatMap((id) => tiers.get(id) ?? []);
    return new Set(picked).size === picked.length;
  };
}

function sameTick(a: AbilityTick, b: AbilityTick) {
  return (
    a.label === b.label &&
    a.amount === b.amount &&
    a.amountMax === b.amountMax &&
    a.period === b.period &&
    a.count === b.count &&
    a.firstAt === b.firstAt
  );
}

// Tick lists keyed by entry nameId, placed like areas.
export function assignTicks(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  hero: Hero,
  found: Map<string, GatedTick[]>,
): Map<string, AbilityTick[]> {
  const index = anchorIndex(hero);
  const possible = pickable(hero);
  // A gate with no talent or state to name would leave a bare variant next to the base tick.
  const placements = hero.abilities.flatMap((owner) =>
    (found.get(owner.nameId) ?? []).flatMap(({ gates, hitGates, refreshed, ...tick }) =>
      gatedTargets(graph, reverseRefs, index, owner, gates, tick.source, hitGates, placeOf(hero, found, owner, tick.source))
        .filter((t) => !(t.plain && gates.length > 0) && possible(t))
        .map((t) => ({
          nameId: t.nameId,
          tick: prefixed(tick, t.prefix),
          raw: tick,
          prefix: t.prefix,
          also: t.also,
          own: !refreshed || t.nameId === owner.nameId,
          variant: t.variant,
          owner: owner.nameId,
        })),
    ),
  );
  // A state-prefixed copy of a tick another card shows plainly repeats it, e.g. a trait's mark that abilities reapply.
  const repeated = (p: (typeof placements)[number]) =>
    p.prefix !== undefined &&
    !p.variant &&
    placements.some((q) => q.prefix === undefined && q.tick.source === p.tick.source && sameTick(q.raw, p.raw));
  const changing = placements.filter(
    (p) => !repeated(p) && (!p.variant || !placements.some((q) => q.nameId === p.owner && !q.variant && sameTick(q.tick, p.tick))),
  );
  type Placed = { tick: AbilityTick; also: string | undefined; own: boolean };
  const out = new Map<string, Placed[]>();
  for (const { nameId, tick, also, own } of changing) {
    const list = out.get(nameId) ?? [];
    const found = list.find((t) => sameTick(t.tick, tick));
    if (found) found.own ||= own;
    else list.push({ tick, also, own });
    out.set(nameId, list);
  }
  const recount = (u: AbilityTick, t: AbilityTick) => sameTick({ ...u, count: t.count }, t);
  // The same hit seen through a path with no known lifetime adds nothing, and neither does another ability
  // that reapplies it.
  const counted = (list: Placed[]) =>
    list
      .filter(({ tick: t }) => t.count !== null || !list.some(({ tick: u }) => u.count !== null && recount(u, t)))
      .filter(({ tick: t, own }) => own || !list.some(({ tick: u, own: o }) => o && u.count !== t.count && recount(u, t)))
      .map(({ tick, also }) => (also ? { ...tick, label: `${tick.label} (${also})` } : tick));
  return new Map([...out].map(([nameId, list]) => [nameId, counted(list)]));
}

// Note lists keyed by entry nameId, placed like ticks.
export function assignNotes(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  hero: Hero,
  found: Map<string, GatedNote[]>,
): Map<string, AbilityNote[]> {
  const index = anchorIndex(hero);
  const possible = pickable(hero);
  const placements = hero.abilities.flatMap((owner) =>
    (found.get(owner.nameId) ?? []).flatMap(({ gates, hitGates, ...note }) =>
      gatedTargets(graph, reverseRefs, index, owner, gates, note.source, hitGates, placeOf(hero, found, owner, note.source))
        .filter((t) => !(t.plain && gates.length > 0) && possible(t))
        .map((t) => ({
          nameId: t.nameId,
          note: prefixed(t.also ? { ...note, label: `${note.label} (${t.also})` } : note, t.prefix),
          raw: note.label,
          prefix: t.prefix,
          owner: owner.nameId,
          variant: t.variant,
        })),
    ),
  );
  // A state-prefixed copy of a note another card shows plainly repeats it, e.g. a talent reaching Shade of Mephisto's buff.
  const repeated = (p: (typeof placements)[number]) =>
    p.prefix !== undefined && placements.some((q) => q.prefix === undefined && q.note.source === p.note.source && q.raw === p.raw);
  const out = new Map<string, AbilityNote[]>();
  for (const p of placements) {
    if (repeated(p)) continue;
    if (p.variant && placements.some((q) => q.nameId === p.owner && !q.variant && q.note.label === p.note.label)) continue;
    const list = out.get(p.nameId) ?? [];
    if (!list.some((n) => n.label === p.note.label)) list.push(p.note);
    out.set(p.nameId, list);
  }
  return out;
}

// Same-label circles of one entry are steps of a growing area.
function mergeSteps(areas: AbilityArea[]): AbilityArea[] {
  const circles = (a: AbilityArea) => areas.filter((b) => b.label === a.label && b.width === null && b.radius !== null);
  return areas.flatMap((a) => {
    const steps = circles(a);
    if (a.width !== null || steps.length < 2) return [a];
    if (steps[0] !== a) return [];
    const radii = steps.map((s) => s.radius!);
    return [{ ...a, radius: Math.min(...radii), radiusMax: Math.max(...radii) }];
  });
}
