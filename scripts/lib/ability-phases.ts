// Abils whose button only shows while the caster holds a behavior another abil
// applied: a channel release, or a buffed variant. The applying abil pays the cost.

import { effectsApplyingBehavior } from "./effect-graph/index.ts";
import { findAll, findFirst } from "./effect-graph/traverse.ts";
import { parentChain } from "./effect-graph/walk.ts";
import type { EffectGraph, GraphNode } from "./effect-graph/types.ts";

const BEHAVIOR_VALIDATORS = new Set(["CValidatorUnitHasBehavior", "CValidatorUnitCompareBehaviorCount"]);

function abilNode(graph: EffectGraph, id: string): GraphNode | null {
  const node = graph.nodes.get(id);
  return node?.tag.startsWith("CAbil") ? node : null;
}

function casterBehaviors(graph: EffectGraph, validatorId: string, seen = new Set<string>()): string[] {
  const validator = graph.nodes.get(validatorId);
  if (!validator || seen.has(validatorId)) return [];
  seen.add(validatorId);
  if (validator.tag === "CValidatorCombine") {
    return findAll(validator.elements, "CombineArray").flatMap((c) => casterBehaviors(graph, c.attrs.value ?? "", seen));
  }
  if (!BEHAVIOR_VALIDATORS.has(validator.tag)) return [];
  const unit = findFirst(validator.elements, "WhichUnit")?.attrs.Value;
  const behavior = findFirst(validator.elements, "Behavior")?.attrs.value;
  return behavior && (!unit || unit === "Caster") ? [behavior] : [];
}

function showBehaviors(graph: EffectGraph, abilId: string): string[] {
  const abil = abilNode(graph, abilId);
  const validators = abil ? findAll(abil.elements, "CmdButtonArray").map((e) => e.attrs.ShowValidator).filter(Boolean) : [];
  return validators.flatMap((id) => casterBehaviors(graph, id));
}

function effectTree(graph: EffectGraph, abilId: string): Set<string> {
  const seen = new Set<string>();
  const queue = [abilId];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = graph.nodes.get(id);
    if (!node || (id !== abilId && !node.tag.startsWith("CEffect"))) continue;
    queue.push(...Object.values(node.refs).flat());
  }
  return seen;
}

function hasEnergyCost(abil: GraphNode): boolean {
  return findAll(abil.elements, "Vital").some((v) => v.attrs.index === "Energy");
}

// A timed disable is a lead-in, e.g. Twisting Nether's first second.
function timed(graph: EffectGraph, behaviorId: string): boolean {
  return parentChain(graph, behaviorId).some((id) => graph.nodes.get(id)?.elements.some((e) => e.tag === "Duration"));
}

const disablersCache = new WeakMap<EffectGraph, Map<string, string[]>>();

function disablingBehaviors(graph: EffectGraph, abilId: string): string[] {
  let index = disablersCache.get(graph);
  if (!index) {
    index = new Map();
    for (const node of graph.nodes.values()) {
      if (!node.tag.startsWith("CBehavior") || timed(graph, node.id)) continue;
      for (const e of findAll(node.elements, "AbilLinkDisableArray")) {
        if (e.attrs.value) index.set(e.attrs.value, [...(index.get(e.attrs.value) ?? []), node.id]);
      }
    }
    disablersCache.set(graph, index);
  }
  return index.get(abilId) ?? [];
}

/** How `abilId` relates to `parentAbilId`: a phase it pays for, a free variant it unlocks, or one it disables. */
export function gatedBy(graph: EffectGraph, parentAbilId: string, abilId: string): "phase" | "free" | "disabled" | null {
  const parent = abilNode(graph, parentAbilId);
  if (!parent || abilId === parentAbilId) return null;
  const tree = effectTree(graph, parentAbilId);
  const applied = (behaviors: string[]) => behaviors.some((b) => effectsApplyingBehavior(graph, b).some((id) => tree.has(id)));
  if (applied(disablingBehaviors(graph, abilId))) return "disabled";
  if (!applied(showBehaviors(graph, abilId))) return null;
  return hasEnergyCost(parent) ? "phase" : "free";
}
