// Mechanic A includes mechanic B when A's primary behavior resolves every BehaviorCategory
// of B's. Cleanses and immunities match by category, so this is what the game sees.

import type { EffectGraph, MechanicLike, MechanicRef } from "./types.ts";
import { parentChain } from "./walk.ts";
import { findAll } from "./traverse.ts";

export function behaviorCategories(graph: EffectGraph, behaviorId: string): Set<string> {
  const resolved = new Map<string, boolean>();
  for (const id of parentChain(graph, behaviorId)) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    for (const el of findAll(node.elements, "BehaviorCategories")) {
      const { index, value } = el.attrs;
      if (index && value !== undefined && !resolved.has(index)) resolved.set(index, value !== "0");
    }
  }
  return new Set([...resolved].filter(([, on]) => on).map(([index]) => index));
}

export interface MechanicComposition {
  includes: MechanicRef[];
  includedIn: MechanicRef[];
}

export function mechanicComposition(
  graph: EffectGraph,
  mechanics: readonly MechanicLike[],
): Map<string, MechanicComposition> {
  const withBehavior = mechanics.filter((m) => m.primaryBehavior);
  const categories = new Map(withBehavior.map((m) => [m.slug, behaviorCategories(graph, m.primaryBehavior)]));
  const ref = (m: MechanicLike): MechanicRef => ({ slug: m.slug, name: m.name });
  const includes = (a: MechanicLike, b: MechanicLike): boolean => {
    const inner = categories.get(b.slug)!;
    const outer = categories.get(a.slug)!;
    return a.primaryBehavior !== b.primaryBehavior && inner.size > 0 && [...inner].every((c) => outer.has(c));
  };
  return new Map(
    mechanics.map((m) => [
      m.slug,
      categories.has(m.slug)
        ? {
            includes: withBehavior.filter((other) => includes(m, other)).map(ref),
            includedIn: withBehavior.filter((other) => includes(other, m)).map(ref),
          }
        : { includes: [], includedIn: [] },
    ]),
  );
}
