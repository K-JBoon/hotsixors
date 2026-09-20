// Talent-gating resolution.

import type { EffectGraph, GraphNode, AnchorIndex, Element } from "./types.ts";
import { parentChain } from "./walk.ts";
import { resolvedNumber } from "./xml.ts";
import { descendantsOf, findAll, findFirst } from "./traverse.ts";

function valuesOfDirectChildren(elements: readonly Element[], tag: string): string[] {
  const out = new Set<string>();
  for (const el of descendantsOf(elements)) {
    if (el.tag === tag && el.attrs.value !== undefined) out.add(el.attrs.value);
  }
  return [...out];
}

function blockHas(mod: Element, tag: string, predicate: (el: Element) => boolean): boolean {
  return mod.children.some((c) => c.tag === tag && predicate(c));
}

function firstEntryValue(mod: Element): string | undefined {
  const e = mod.children.find((c) => c.tag === "Entry" && c.attrs.value !== undefined);
  return e?.attrs.value;
}

export function chanceEnabledEffectIds(talentNode: GraphNode): string[] {
  const out: string[] = [];
  for (const mod of findAll(talentNode.elements, "Modifications")) {
    if (!blockHas(mod, "Catalog", (c) => c.attrs.value === "Effect")) continue;
    if (!blockHas(mod, "Field", (c) => c.attrs.value === "Chance")) continue;
    if (!blockHas(mod, "Value", (c) => c.attrs.value !== undefined && Number(c.attrs.value) === 1)) continue;
    const entry = firstEntryValue(mod);
    if (entry) out.push(entry);
  }
  return out;
}

export function bucketBehaviorIdsForTalent(talentNode: GraphNode): string[] {
  const out: string[] = [];
  for (const mod of findAll(talentNode.elements, "Modifications")) {
    if (!blockHas(mod, "Catalog", (c) => c.attrs.value === "Behavior")) continue;
    const entry = firstEntryValue(mod);
    if (entry?.startsWith("TalentBucket") && !out.includes(entry)) out.push(entry);
  }
  return out;
}

// Which talents grant which behaviors. A talent's behavior refs do not depend
// on the behavior being asked about, so they are resolved once and inverted.
// Anchors go in per Object.entries order, which is the order callers expect.
const grantIndexes = new WeakMap<EffectGraph, WeakMap<AnchorIndex, Map<string, string[]>>>();

function talentGrantIndex(graph: EffectGraph, anchorToEntry: AnchorIndex): Map<string, string[]> {
  let byIndex = grantIndexes.get(graph);
  if (!byIndex) {
    byIndex = new WeakMap();
    grantIndexes.set(graph, byIndex);
  }
  const hit = byIndex.get(anchorToEntry);
  if (hit) return hit;

  const index = new Map<string, string[]>();
  for (const [anchor, entry] of Object.entries(anchorToEntry)) {
    if (entry.kind !== "talent") continue;
    const node = graph.nodes.get(anchor);
    if (!node) continue;
    const behaviorBucketRefs = (node.refs["Abil"] ?? []).filter(
      (id) => !anchorToEntry[id] && graph.nodes.get(id)?.tag.startsWith("CBehavior"),
    );
    // behaviorRefsBehavior matches the ref itself, or any behavior it inherits
    // from, so a ref grants every id along its parent chain.
    const granted = new Set<string>();
    for (const id of [...(node.refs["BehaviorArray"] ?? []), ...behaviorBucketRefs]) {
      granted.add(id);
      if (graph.nodes.get(id)?.tag.startsWith("CBehavior")) {
        for (const ancestor of parentChain(graph, id)) granted.add(ancestor);
      }
    }
    for (const behaviorId of granted) {
      const bucket = index.get(behaviorId);
      if (bucket) bucket.push(anchor);
      else index.set(behaviorId, [anchor]);
    }
  }

  byIndex.set(anchorToEntry, index);
  return index;
}

function talentIdsGrantingBehavior(
  graph: EffectGraph,
  anchorToEntry: AnchorIndex,
  behaviorId: string,
): string[] {
  return talentGrantIndex(graph, anchorToEntry).get(behaviorId) ?? [];
}

function isTriviallyPassableValidator(
  graph: EffectGraph,
  validatorId: string,
  seen = new Set<string>(),
): boolean {
  if (seen.has(validatorId)) return false;
  seen.add(validatorId);
  const node = graph.nodes.get(validatorId);
  if (!node) return false;
  if (node.tag === "CValidatorUnitCompareBehaviorCount") {
    const valueStr = valuesOfDirectChildren(node.elements, "Value")[0] ?? "0";
    const value = resolvedNumber(graph, valueStr) ?? 0;
    const compare = (valuesOfDirectChildren(node.elements, "Compare")[0] ?? "eq").toLowerCase();
    return (compare === "eq" || compare === "lt" || compare === "lte" || compare === "max") && value === 0;
  }
  if (node.tag === "CValidatorCombine") {
    const isAnd = valuesOfDirectChildren(node.elements, "Type")[0]?.toLowerCase() === "and";
    const children = node.refs["CombineArray"] ?? [];
    return isAnd
      ? children.every((id) => isTriviallyPassableValidator(graph, id, seen))
      : children.some((id) => isTriviallyPassableValidator(graph, id, seen));
  }
  return false;
}

export function validatorTalentIds(
  graph: EffectGraph,
  anchorToEntry: AnchorIndex,
  validatorId: string,
  seen = new Set<string>(),
  strictOr = true,
): string[] {
  if (seen.has(validatorId)) return [];
  seen.add(validatorId);

  const node = graph.nodes.get(validatorId);
  if (!node) return [];
  if (node.tag === "CValidatorPlayerTalent") return valuesOfDirectChildren(node.elements, "Value");
  if (node.tag === "CValidatorUnitCompareBehaviorCount") {
    return (node.refs["Behavior"] ?? []).flatMap((behaviorId) =>
      talentIdsGrantingBehavior(graph, anchorToEntry, behaviorId)
    );
  }

  const combineChildren = node.refs["CombineArray"] ?? [];
  if (combineChildren.length === 0) return [];

  if (node.tag === "CValidatorCombine") {
    const isAnd = valuesOfDirectChildren(node.elements, "Type")[0]?.toLowerCase() === "and";
    if (!isAnd && strictOr && combineChildren.some((id) => isTriviallyPassableValidator(graph, id))) return [];
    const out = new Set<string>();
    for (const childId of combineChildren) {
      for (const tid of validatorTalentIds(graph, anchorToEntry, childId, seen, strictOr)) out.add(tid);
    }
    return [...out];
  }

  const out = new Set<string>();
  for (const childId of combineChildren) {
    for (const tid of validatorTalentIds(graph, anchorToEntry, childId, seen, strictOr)) out.add(tid);
  }
  return [...out];
}

export function talentIdsFromValidators(
  graph: EffectGraph,
  anchorToEntry: AnchorIndex,
  node: GraphNode,
): string[] {
  const out = new Set<string>();
  for (const validatorId of [
    ...(node.refs["ValidatorArray"] ?? []),
    ...(node.refs["DisableValidatorArray"] ?? []),
    ...(node.refs["LeechValidator"] ?? []),
  ]) {
    for (const tid of validatorTalentIds(graph, anchorToEntry, validatorId)) out.add(tid);
  }
  return [...out];
}

export function talentIdsFromBehaviorValidators(
  graph: EffectGraph,
  anchorToEntry: AnchorIndex,
  behaviorId: string,
): string[] {
  const out = new Set<string>();
  for (const id of parentChain(graph, behaviorId)) {
    const node = graph.nodes.get(id);
    if (!node || !node.tag.startsWith("CBehavior")) continue;
    for (const tid of talentIdsFromValidators(graph, anchorToEntry, node)) out.add(tid);
  }
  return [...out];
}

function directChanceValue(node: GraphNode): string | null {
  const el = findFirst(node.elements, "Chance");
  return el?.attrs.value ?? null;
}

export function isDormantEffectWithoutEnabler(
  graph: EffectGraph,
  node: GraphNode,
  chanceEnablers: Map<string, string[]>,
): boolean {
  if (!node.tag.startsWith("CEffect")) return false;
  const raw = directChanceValue(node);
  if (raw === null) return false;
  const n = resolvedNumber(graph, raw);
  return n === 0 && !(chanceEnablers.get(node.id)?.length);
}

export function gatingTalentIds(
  graph: EffectGraph,
  anchorToEntry: AnchorIndex,
  node: GraphNode,
  chanceEnablers: Map<string, string[]>,
): string[] {
  return [
    ...new Set([
      ...talentIdsFromValidators(graph, anchorToEntry, node),
      ...(chanceEnablers.get(node.id) ?? []),
    ]),
  ];
}
