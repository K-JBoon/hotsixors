// Structured-tree helpers for walking GraphNode.elements.

import type { Element } from "./types.ts";

export function* descendantsOf(elements: readonly Element[]): Iterable<Element> {
  for (const el of elements) {
    yield el;
    yield* descendantsOf(el.children);
  }
}

export function findAll(elements: readonly Element[], tag: string): Element[] {
  const out: Element[] = [];
  for (const el of descendantsOf(elements)) if (el.tag === tag) out.push(el);
  return out;
}

export function findFirst(elements: readonly Element[], tag: string): Element | undefined {
  for (const el of descendantsOf(elements)) if (el.tag === tag) return el;
  return undefined;
}
