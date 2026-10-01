// Range and area of an ability, read from the effect graph.

import type { EffectGraph, Element } from "./effect-graph/types.ts";
import { findFirst } from "./effect-graph/traverse.ts";
import { parentChain } from "./effect-graph/walk.ts";
import { resolvedNumber } from "./effect-graph/xml.ts";

export interface AbilityGeometry {
  range: number | null;
  radius: number | null;
}

// Vector-targeted skillshots use a huge Range; the missile defines the reach.
const PLACEHOLDER_RANGE = 50;
const MAX_WALK_DEPTH = 6;

const WALK_FIELDS = new Set([
  "Effect",
  "EffectArray",
  "CaseEffect",
  "CaseDefault",
  "InitialEffect",
  "LaunchEffect",
  "ImpactEffect",
  "PeriodicEffect",
  "PeriodicEffectArray",
]);

function inheritedValue(graph: EffectGraph, id: string, tag: string) {
  for (const ancestor of parentChain(graph, id)) {
    const el = graph.nodes.get(ancestor)?.elements.find((e) => e.tag === tag);
    if (el?.attrs.value) return el.attrs.value;
  }
  return null;
}

function number(graph: EffectGraph, value: string | null | undefined) {
  return value ? resolvedNumber(graph, value) : null;
}

function positive(n: number | null) {
  return n !== null && n > 0 ? n : null;
}

function directRange(graph: EffectGraph, abilId: string) {
  const range = positive(number(graph, inheritedValue(graph, abilId, "Range")));
  return range !== null && range < PLACEHOLDER_RANGE ? range : null;
}

function projectionDistance(graph: EffectGraph, id: string) {
  const location = graph.nodes.get(id)?.elements.find((e) => e.tag === "ImpactLocation");
  return location ? positive(number(graph, findFirst(location.children, "ProjectionDistanceScale")?.attrs.value)) : null;
}

// Breadth-first, so the cast's own missile wins over talent sub-effects.
function missileReach(graph: EffectGraph, abilId: string) {
  const seen = new Set<string>([abilId]);
  let layer = graph.nodes.get(abilId)?.refs.Effect ?? [];
  for (let depth = 0; depth < MAX_WALK_DEPTH && layer.length > 0; depth++) {
    const next: string[] = [];
    for (const id of layer) {
      if (seen.has(id)) continue;
      seen.add(id);
      const reach = projectionDistance(graph, id);
      if (reach !== null) return reach;
      for (const [field, ids] of Object.entries(graph.nodes.get(id)?.refs ?? {})) {
        if (WALK_FIELDS.has(field)) next.push(...ids);
      }
    }
    layer = next;
  }
  return null;
}

function arcOf(graph: EffectGraph, area: Element) {
  return number(graph, area.attrs.Arc ?? findFirst(area.children, "Arc")?.attrs.value);
}

// The targeting guide. A cone's radius is its length, so it counts as range.
function cursorArea(graph: EffectGraph, abilId: string) {
  const cursorId = inheritedValue(graph, abilId, "CursorEffect");
  const node = cursorId ? graph.nodes.get(cursorId) : undefined;
  for (const area of node?.elements.filter((e) => e.tag === "AreaArray") ?? []) {
    const radius = positive(number(graph, findFirst(area.children, "Radius")?.attrs.value));
    if (radius === null) continue;
    const arc = arcOf(graph, area);
    return { radius, cone: arc !== null && arc < 360 };
  }
  return null;
}

export function abilityGeometry(graph: EffectGraph, abilId: string): AbilityGeometry {
  if (!graph.nodes.get(abilId)?.tag.startsWith("CAbil")) return { range: null, radius: null };
  const area = cursorArea(graph, abilId);
  const cone = area?.cone ? area.radius : null;
  return {
    range: directRange(graph, abilId) ?? missileReach(graph, abilId) ?? cone,
    radius: area && !area.cone ? area.radius : null,
  };
}
