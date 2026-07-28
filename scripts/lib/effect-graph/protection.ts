// Protection-kind taxonomy.

import type { EffectGraph, MechanicLike, ProtectionKind } from "./types.ts";
import { parentChain } from "./walk.ts";
import { descendantsOf, findAll } from "./traverse.ts";

function behaviorCategoryValueInNode(graph: EffectGraph, nodeId: string, category: string): boolean | null {
  const node = graph.nodes.get(nodeId);
  if (!node) return null;
  for (const el of descendantsOf(node.elements)) {
    if (el.tag === "BehaviorCategories" && el.attrs.index === category && el.attrs.value !== undefined) {
      return el.attrs.value !== "0";
    }
  }
  return null;
}

function behaviorHasCategory(graph: EffectGraph, behaviorId: string, category: string): boolean {
  for (const id of parentChain(graph, behaviorId)) {
    const v = behaviorCategoryValueInNode(graph, id, category);
    if (v !== null) return v;
  }
  return false;
}

function behaviorClearsCategory(graph: EffectGraph, behaviorId: string, category: string): boolean {
  for (const id of parentChain(graph, behaviorId)) {
    const v = behaviorCategoryValueInNode(graph, id, category);
    if (v !== null) return !v;
  }
  return false;
}

function behaviorHasDamageResponseModifyLimit(graph: EffectGraph, behaviorId: string): boolean {
  for (const id of parentChain(graph, behaviorId)) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    for (const dr of findAll(node.elements, "DamageResponse")) {
      if (dr.attrs.ModifyLimit !== undefined) return true;
    }
  }
  return false;
}

function behaviorRestrictsDamageKinds(graph: EffectGraph, behaviorId: string): boolean {
  for (const id of parentChain(graph, behaviorId)) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    for (const dr of findAll(node.elements, "DamageResponse")) {
      for (const kind of findAll(dr.children, "Kind")) {
        const idx = kind.attrs.index;
        if ((idx === "Ability" || idx === "Basic" || idx === "Splash") && kind.attrs.value === "0") return true;
      }
    }
  }
  return false;
}

export function protectionKindOfBehavior(graph: EffectGraph, behaviorId: string): ProtectionKind | null {
  const chain = parentChain(graph, behaviorId);
  if (!chain.includes("StormProtect")) return null;
  if (chain.includes("StormShield") || behaviorHasDamageResponseModifyLimit(graph, behaviorId)) return "shield";
  if (chain.includes("StormEvasion") || behaviorHasCategory(graph, behaviorId, "Evasion")) return "evasion";
  const ownNode = graph.nodes.get(behaviorId);
  const hasStaggerInBody = ownNode
    ? [...descendantsOf(ownNode.elements)].some((el) =>
      /Stagger/i.test(el.tag) ||
      Object.entries(el.attrs).some(([k, v]) => /Stagger/i.test(k) || /Stagger/i.test(v)))
    : false;
  if (/\bStagger\b/i.test(behaviorId) || hasStaggerInBody) return "stagger";
  if (behaviorRestrictsDamageKinds(graph, behaviorId)) return "spell-absorb";
  if (behaviorClearsCategory(graph, behaviorId, "Protected")) return "other";
  return "protected";
}

export function protectionKindForMechanic(mechanic: MechanicLike): ProtectionKind | null {
  switch (mechanic.slug) {
    case "protected": return "protected";
    case "shield": return "shield";
    case "evasion": return "evasion";
    case "stagger": return "stagger";
    case "spell-absorb": return "spell-absorb";
    default: return null;
  }
}
