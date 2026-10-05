// Units a hero's kit summons, each credited to the ability or talent that summons it.

import { CHANCE_GATE, walk } from "./ability-geometry.ts";
import { chanceEnabledEffectIds, validatorTalentIds } from "./effect-graph/gating.ts";
import type { AbilTalentEntry, AnchorIndex, EffectGraph, GraphNode } from "./effect-graph/types.ts";

export interface SummonEntry {
  id: string;
  abilityId: string;
  buttonId: string;
}

export interface Summon {
  unitId: string;
  sourceId: string;
}

interface Credit {
  sourceId: string;
  gated: boolean;
  depth: number;
}

const values = (node: GraphNode, tag: string, attr = "value"): string[] =>
  node.elements.flatMap((e) => (e.tag === tag && e.attrs[attr] ? [e.attrs[attr]] : []));

// Build and train abilities list their units in InfoArray.
const producedUnits = (node: GraphNode): string[] => [
  ...values(node, "ProducedUnitArray"),
  ...values(node, "InfoArray", "Unit"),
];

function chanceTalentIndex(graph: EffectGraph): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const node of graph.nodes.values()) {
    if (node.tag !== "CTalent") continue;
    for (const effect of chanceEnabledEffectIds(node)) index.set(effect, [...(index.get(effect) ?? []), node.id]);
  }
  return index;
}

const better = (a: Credit, b: Credit) => (a.gated !== b.gated ? !a.gated : a.depth < b.depth);

const words = (id: string) => id.match(/[A-Z][a-z]*|\d+|[a-z]+/g) ?? [];

function sharedWords(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

// The entry named most like the spawn effect, e.g. the trait for AnubarakScarabHostCreateBeetle, which every ability reaches.
// One shared word is a generic one such as Summon.
function namedOwner(entries: SummonEntry[], effectId: string, reached: SummonEntry): SummonEntry {
  const target = words(effectId);
  const score = (e: SummonEntry) => Math.max(...[e.id, e.abilityId, e.buttonId].map((id) => sharedWords(words(id), target)));
  return entries.reduce((best, e) => (score(e) > Math.max(score(best), 1) ? e : best), reached);
}

// Entries go in priority order. An ungated spawn beats a talent-gated one, then the shallowest spawn wins.
// Units only an ability's produced list names are a fallback, as that list keeps units of removed talents.
export function heroSummons(
  graph: EffectGraph,
  entries: SummonEntry[],
  offered: ReadonlySet<string>,
  isDeadCondition: (validatorId: string) => boolean,
): Summon[] {
  const chanceTalents = chanceTalentIndex(graph);
  // Talent anchors let a behavior count gate resolve to the talent that grants the behavior.
  const anchors: AnchorIndex = Object.fromEntries(
    [...offered].map((id) => [id, { kind: "talent", nameId: id } as AbilTalentEntry]),
  );
  const gateTalents = (gate: string) =>
    gate.startsWith(CHANCE_GATE)
      ? chanceTalents.get(gate.slice(CHANCE_GATE.length)) ?? []
      : validatorTalentIds(graph, anchors, gate);
  const isDead = (gate: string) =>
    gate.startsWith(CHANCE_GATE) ? !gateTalents(gate).some((id) => offered.has(id)) : isDeadCondition(gate);

  const found = new Map<string, Credit>();
  const spawned = new Set<string>();
  const credit = (unitId: string, next: Credit) => {
    const known = found.get(unitId);
    if (!known || better(next, known)) found.set(unitId, next);
  };

  for (const entry of entries) {
    if (!graph.nodes.has(entry.abilityId)) continue;
    for (const visit of walk(graph, entry.abilityId, null)) {
      const node = graph.nodes.get(visit.id)!;
      if (node.tag !== "CEffectCreateUnit") continue;
      const units = values(node, "SpawnUnit");
      units.forEach((u) => spawned.add(u));
      if (visit.gates.some(isDead)) continue;
      const talent = visit.gates.flatMap(gateTalents).find((id) => offered.has(id));
      const sourceId = talent ?? namedOwner(entries, visit.id, entry).id;
      for (const unitId of units) credit(unitId, { sourceId, gated: Boolean(talent), depth: visit.path.length });
    }
  }

  for (const entry of entries) {
    const abil = graph.nodes.get(entry.abilityId);
    for (const unitId of abil ? producedUnits(abil) : []) {
      if (!spawned.has(unitId)) credit(unitId, { sourceId: entry.id, gated: false, depth: 0 });
    }
  }

  return [...found].map(([unitId, { sourceId }]) => ({ unitId, sourceId }));
}
