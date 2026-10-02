// Places each ability area on the card it belongs to: the ability, a trait state it depends on, or a talent.

import type { AbilityArea } from "../types.ts";
import type { AbilTalentEntry, AnchorIndex, EffectGraph, ReverseRef } from "./effect-graph/types.ts";
import { chanceEnabledEffectIds, talentIdsFromValidators, validatorTalentIds } from "./effect-graph/gating.ts";
import { resolveEffectOwners } from "./effect-graph/owners.ts";
import { effectsApplyingBehavior, parentChain, rootAbilityAnchorIds } from "./effect-graph/walk.ts";
import { CHANCE_GATE, sameArea, type GatedArea } from "./ability-geometry.ts";

export interface AreaEntry {
  nameId: string;
  name: string;
  icon: string;
  abilityType?: string;
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

function gateOwners(graph: EffectGraph, reverseRefs: Map<string, ReverseRef[]>, index: AnchorIndex, validatorId: string) {
  if (validatorId.startsWith(CHANCE_GATE)) return chanceTalents(graph, index, validatorId.slice(CHANCE_GATE.length));
  const talents = validatorTalentIds(graph, index, validatorId).flatMap((id) => index[id] ?? []);
  if (talents.length > 0) return talents;
  const appliers = checkedBehaviors(graph, validatorId).flatMap((b) => effectsApplyingBehavior(graph, b));
  const applierTalents = appliers.map((e) => {
    const node = graph.nodes.get(e);
    return node ? talentIdsFromValidators(graph, index, node) : [];
  });
  if (appliers.length > 0 && applierTalents.every((t) => t.length > 0)) {
    return [...new Set(applierTalents.flat())].flatMap((id) => index[id] ?? []);
  }
  const anchors = appliers.flatMap((e) => [...rootAbilityAnchorIds(reverseRefs, index, e)]);
  return [...new Set(anchors)].flatMap((id) => index[id] ?? []);
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

function placeArea(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  index: AnchorIndex,
  owner: AreaEntry,
  area: GatedArea,
): Placement[] {
  const base = strip(area);
  const place = (nameId: string, placed: AbilityArea, variant = false) => ({ nameId, area: placed, owner: owner.nameId, variant });
  const gates = area.gates.map((g) => ({
    conditions: gateOwners(graph, reverseRefs, index, g),
    onTarget: !g.startsWith(CHANCE_GATE) && checksTarget(graph, g),
  }));
  const talentEntries = gates.flatMap((g) => g.conditions).filter((c) => c.kind === "talent");
  const talents = [...new Set(namedOwners(talentEntries, area.source).map((c) => c.nameId))];
  const stateGate = gates.find((g) => g.conditions.some((c) => c.kind === "ability" && c.nameId !== owner.nameId));
  const state = stateGate?.conditions.find((c) => c.kind === "ability" && c.nameId !== owner.nameId);
  const prefix = state && (stateGate!.onTarget ? `On ${state.name} target` : state.name);
  const labeled = prefix ? { ...base, label: `${prefix}: ${lowerFirst(base.label)}` } : base;
  if (talents.length > 0) return talents.map((nameId) => place(nameId, labeled, true));
  if (area.gates.some((g) => g.startsWith(CHANCE_GATE))) return [];
  if (prefix) return [place(owner.nameId, labeled)];
  if (area.gates.length === 0) {
    const owners: AbilTalentEntry[] = resolveEffectOwners(graph, reverseRefs, index, new Map(), area.source);
    if (owners.length > 0 && !owners.some((o) => o.nameId === owner.nameId)) {
      return namedOwners(owners, area.source).map((o) => place(o.nameId, base));
    }
  }
  const repeatsStat = [owner.stats?.radius, owner.stats?.width].some((n) => n != null && (n === base.radius || n === base.width));
  return base.label === "Buff area" || repeatsStat ? [] : [place(owner.nameId, base)];
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
    (found.get(owner.nameId) ?? []).flatMap((area) => placeArea(graph, reverseRefs, index, owner, area)),
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
