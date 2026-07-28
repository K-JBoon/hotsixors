// BFS from each mechanic's source ids along forward referrers.

import type { EffectGraph, MechanicLike } from "./types.ts";
import { nodePassesMechanicFilter } from "./filter.ts";

export function computeMechanicMembership(
  graph: EffectGraph,
  mechanics: MechanicLike[],
  maxDepth = 6,
): Map<string, string[]> {
  // referrers[id] = node ids that forward-reference id via REF_FIELDS.
  const referrers = new Map<string, Set<string>>();
  for (const node of graph.nodes.values()) {
    for (const ids of Object.values(node.refs)) {
      for (const to of ids) {
        let s = referrers.get(to);
        if (!s) { s = new Set(); referrers.set(to, s); }
        s.add(node.id);
      }
    }
  }

  const result = new Map<string, Set<string>>();
  const add = (id: string, slug: string): void => {
    let s = result.get(id);
    if (!s) { s = new Set(); result.set(id, s); }
    s.add(slug);
  };

  for (const mech of mechanics) {
    const seen = new Set<string>();
    const queue: Array<[string, number]> = [];
    for (const src of mech.sourceIds) {
      if (graph.nodes.has(src) && !seen.has(src)) {
        queue.push([src, 0]);
        seen.add(src);
      }
    }
    while (queue.length > 0) {
      const [id, depth] = queue.shift()!;
      if (!nodePassesMechanicFilter(graph, id, mech)) continue;
      add(id, mech.slug);
      if (depth >= maxDepth) continue;
      for (const referrer of referrers.get(id) ?? []) {
        if (seen.has(referrer)) continue;
        seen.add(referrer);
        queue.push([referrer, depth + 1]);
      }
    }
  }

  const out = new Map<string, string[]>();
  for (const [id, set] of result) out.set(id, [...set]);
  return out;
}
