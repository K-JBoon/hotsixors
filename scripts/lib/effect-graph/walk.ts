// Graph traversal primitives.

import type { EffectGraph, GraphNode, ReverseRef, AnchorIndex } from "./types.ts";

// A graph never changes once built, so the walks below are pure in it. Every
// mechanic re-walks the same chains, so they are worth keeping.
interface GraphCache {
  parentChains: Map<string, string[]>;
  targetBehaviors: Map<string, string | null>;
  applyEffects?: ApplyEffectIndex;
}

const caches = new WeakMap<EffectGraph, GraphCache>();

function cacheFor(graph: EffectGraph): GraphCache {
  let cache = caches.get(graph);
  if (!cache) {
    cache = { parentChains: new Map(), targetBehaviors: new Map() };
    caches.set(graph, cache);
  }
  return cache;
}

// The id itself, then each ancestor reachable via parent="...".
// The result is shared between callers; treat it as read-only.
export function parentChain(graph: EffectGraph, id: string): string[] {
  const cache = cacheFor(graph).parentChains;
  const hit = cache.get(id);
  if (hit) return hit;

  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    const node = graph.nodes.get(cur);
    const next = node?.parentAttr ?? null;
    cur = next && graph.nodes.has(next) ? next : null;
  }
  cache.set(id, out);
  return out;
}

// The behavior id this CEffectApplyBehavior applies.
export function targetBehaviorOf(graph: EffectGraph, effectId: string): string | null {
  const cache = cacheFor(graph).targetBehaviors;
  const hit = cache.get(effectId);
  if (hit !== undefined) return hit;

  let out: string | null = null;
  for (const id of parentChain(graph, effectId)) {
    const b = graph.nodes.get(id)?.refs["Behavior"]?.[0];
    if (b) {
      out = b;
      break;
    }
  }
  cache.set(effectId, out);
  return out;
}

export function buildReverseRefs(graph: EffectGraph): Map<string, ReverseRef[]> {
  const refs = new Map<string, ReverseRef[]>();
  for (const node of graph.nodes.values()) {
    for (const [field, values] of Object.entries(node.refs)) {
      for (const id of values) {
        const nodes = refs.get(id) ?? [];
        nodes.push({ node, field });
        refs.set(id, nodes);
      }
    }
  }
  return refs;
}

function isEffectNode(node: GraphNode): boolean {
  return node.tag.startsWith("CEffect") || node.tag.startsWith("CAbil") || node.tag.startsWith("CBehavior");
}

export function containingEffectRefs(
  reverseRefs: Map<string, ReverseRef[]>,
  effectId: string,
): ReverseRef[] {
  return (reverseRefs.get(effectId) ?? []).filter((ref) => isEffectNode(ref.node));
}

export function isSpawnSetupRef(ref: ReverseRef): boolean {
  return ref.field === "SpawnEffect" && ref.node.tag === "CEffectCreateUnit";
}

// A behavior is "spawn-installed" if reached via SpawnEffect from CEffectCreateUnit.
export function isSpawnInstalledBehavior(
  reverseRefs: Map<string, ReverseRef[]>,
  behaviorId: string,
): boolean {
  for (const ref of reverseRefs.get(behaviorId) ?? []) {
    if (ref.node.tag !== "CEffectApplyBehavior") continue;
    for (const upRef of reverseRefs.get(ref.node.id) ?? []) {
      if (isSpawnSetupRef(upRef)) return true;
    }
  }
  return false;
}

// Fields by which an ability/talent points at the root of its own effect tree.
const ABILITY_ROOT_EFFECT_FIELDS = ["Effect", "PrepEffect", "InitialEffect", "FinalEffect"];

// The ability/talent anchors that own `effectId` as the root of their effect tree.
export function rootOwners(
  reverseRefs: Map<string, ReverseRef[]>,
  anchorToEntry: AnchorIndex,
  effectId: string,
): GraphNode[] {
  return (reverseRefs.get(effectId) ?? [])
    .filter(({ node }) =>
      anchorToEntry[node.id]
      && ABILITY_ROOT_EFFECT_FIELDS.some((f) => (node.refs[f] ?? []).includes(effectId))
    )
    .map(({ node }) => node);
}

// The ability anchor ids whose effect tree contains `effectId`.
export function rootAbilityAnchorIds(
  reverseRefs: Map<string, ReverseRef[]>,
  anchorToEntry: AnchorIndex,
  effectId: string,
): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const queue: string[] = [effectId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const ref of reverseRefs.get(id) ?? []) {
      const entry = anchorToEntry[ref.node.id];
      if (entry?.kind === "ability") {
        out.add(ref.node.id);
        continue;
      }
      if (isEffectNode(ref.node)) queue.push(ref.node.id);
    }
  }
  return out;
}

// Every CEffectApplyBehavior that can resolve to a given behavior, with the
// chains that decide whether it really does. This narrows a query to a handful
// of candidates instead of walking all ~60k nodes once per behavior. Buckets
// are filled in graph order, which is the order callers rely on.
interface ApplyEffect {
  id: string;
  target: string | null;
  targetChain: readonly string[];
}

type ApplyEffectIndex = Map<string, ApplyEffect[]>;

function applyEffectIndex(graph: EffectGraph): ApplyEffectIndex {
  const cache = cacheFor(graph);
  if (cache.applyEffects) return cache.applyEffects;

  const byBehavior: ApplyEffectIndex = new Map();
  for (const node of graph.nodes.values()) {
    if (node.tag !== "CEffectApplyBehavior") continue;
    const target = targetBehaviorOf(graph, node.id);
    const targetChain = target ? parentChain(graph, target) : [];
    const effect: ApplyEffect = { id: node.id, target, targetChain };
    // Either chain can be the one that names the behavior being looked up.
    for (const behaviorId of new Set([...parentChain(graph, node.id), ...targetChain])) {
      const bucket = byBehavior.get(behaviorId);
      if (bucket) bucket.push(effect);
      else byBehavior.set(behaviorId, [effect]);
    }
  }

  cache.applyEffects = byBehavior;
  return byBehavior;
}

// All CEffectApplyBehavior ids whose applied behavior resolves to behaviorId.
export function effectsApplyingBehavior(
  graph: EffectGraph,
  behaviorId: string,
  options: { excludeBehaviorDescendants?: string[]; includeBehaviorDescendants?: boolean } = {},
): string[] {
  const includeBehaviorDescendants = options.includeBehaviorDescendants ?? true;
  const excludedBehaviorDescendants = options.excludeBehaviorDescendants ?? [];
  const out: string[] = [];
  for (const effect of applyEffectIndex(graph).get(behaviorId) ?? []) {
    if (parentChain(graph, effect.id).includes(behaviorId)) {
      out.push(effect.id);
      continue;
    }
    if (!effect.target) continue;
    const chain = effect.targetChain;
    if (excludedBehaviorDescendants.some((id) => chain.includes(id))) continue;
    if (effect.target === behaviorId || (includeBehaviorDescendants && chain.includes(behaviorId))) {
      out.push(effect.id);
    }
  }
  return out;
}

export function behaviorRefsBehavior(graph: EffectGraph, behaviorId: string, sourceBehaviorId: string): boolean {
  if (behaviorId === sourceBehaviorId) return true;
  const node = graph.nodes.get(behaviorId);
  if (!node || !node.tag.startsWith("CBehavior")) return false;
  return parentChain(graph, behaviorId).includes(sourceBehaviorId);
}

export function behaviorRefsBehaviorWithoutExcludedDescendants(
  graph: EffectGraph,
  behaviorId: string,
  sourceBehaviorId: string,
  excludedBehaviorDescendants: string[],
): boolean {
  const chain = parentChain(graph, behaviorId);
  if (excludedBehaviorDescendants.some((id) => chain.includes(id))) return false;
  return behaviorId === sourceBehaviorId || chain.includes(sourceBehaviorId);
}
