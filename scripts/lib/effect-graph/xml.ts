import type { EffectGraph } from "./types.ts";

// Resolves a literal number string or a `<const .../>` reference.
export function resolvedNumber(graph: EffectGraph, value: string): number | null {
  const resolved = graph.consts.get(value) ?? value;
  const n = Number(resolved);
  return Number.isFinite(n) ? n : null;
}
