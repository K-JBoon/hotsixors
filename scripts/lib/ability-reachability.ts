// Abilities no player can cast. A button whose requirement needs a behavior
// that only unoffered talents grant stays hidden or disabled for good.

import type { AnchorIndex, EffectGraph, GraphNode, ReverseRef } from "./effect-graph/types.ts";
import { validatorTalentIds } from "./effect-graph/gating.ts";
import { effectsApplyingBehavior, parentChain } from "./effect-graph/walk.ts";
import { resolvedNumber } from "./effect-graph/xml.ts";

// null: depends on game state.
type Value = number | boolean | null;

const NO_ANCHORS: AnchorIndex = {};

const COMPARE: Record<string, (a: number, b: number) => boolean> = {
  CRequirementEq: (a, b) => a === b,
  CRequirementNE: (a, b) => a !== b,
  CRequirementGT: (a, b) => a > b,
  CRequirementGTE: (a, b) => a >= b,
  CRequirementLT: (a, b) => a < b,
  CRequirementLTE: (a, b) => a <= b,
};

const toBool = (v: Value): boolean | null => (v === null ? null : typeof v === "boolean" ? v : v !== 0);
const toNum = (v: Value): number | null => (v === null ? null : typeof v === "number" ? v : Number(v));

function and(values: Value[]): Value {
  const bools = values.map(toBool);
  if (bools.includes(false)) return false;
  return bools.includes(null) ? null : true;
}

function or(values: Value[]): Value {
  const bools = values.map(toBool);
  if (bools.includes(true)) return true;
  return bools.includes(null) || !bools.length ? null : false;
}

const directValues = (node: GraphNode, tag: string, attr = "value"): string[] =>
  node.elements.filter((el) => el.tag === tag && el.attrs[attr]).map((el) => el.attrs[attr]);

export function createDeadGates(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  offered: ReadonlySet<string>,
) {
  const deadBehaviors = new Map<string, boolean>();

  const needsMissingTalent = (validatorId: string): boolean => {
    const talents = validatorTalentIds(graph, NO_ANCHORS, validatorId);
    return talents.length > 0 && talents.every((id) => !offered.has(id));
  };

  const isDeadEffect = (effectId: string): boolean => {
    const node = graph.nodes.get(effectId);
    return Boolean(node && directValues(node, "ValidatorArray").some(needsMissingTalent));
  };

  // A ref from the behavior's own id is a same-id talent merged into its node.
  const isDeadGrant = (behaviorId: string) => ({ node }: ReverseRef): boolean =>
    node.tag.startsWith("CValidator") || ((node.tag === "CTalent" || node.id === behaviorId) && !offered.has(node.id));

  const isDeadBehavior = (behaviorId: string): boolean => {
    const hit = deadBehaviors.get(behaviorId);
    if (hit !== undefined) return hit;
    const node = graph.nodes.get(behaviorId);
    // Disable and remove validators switch the behavior off while they fail.
    const selfGated = Boolean(
      node && ["DisableValidatorArray", "RemoveValidatorArray"].some((tag) => directValues(node, tag).some(needsMissingTalent)),
    );
    const appliers = effectsApplyingBehavior(graph, behaviorId, { includeBehaviorDescendants: false });
    const others = (reverseRefs.get(behaviorId) ?? []).filter(({ node }) => !appliers.includes(node.id));
    const dead = selfGated || (appliers.length > 0 && appliers.every(isDeadEffect) && others.every(isDeadGrant(behaviorId)));
    deadBehaviors.set(behaviorId, dead);
    return dead;
  };

  // A condition, i.e. one that fails with nothing present, on unoffered talents or on behaviors only they grant.
  const isDeadCondition = (validatorId: string): boolean => {
    const node = graph.nodes.get(validatorId);
    if (node?.tag !== "CValidatorUnitCompareBehaviorCount") return needsMissingTalent(validatorId);
    const behaviors = node.refs.Behavior ?? [];
    return behaviors.length > 0 && behaviors.every(isDeadBehavior);
  };

  return { isDeadBehavior, isDeadCondition };
}

export function createReachability(
  graph: EffectGraph,
  reverseRefs: Map<string, ReverseRef[]>,
  offered: ReadonlySet<string>,
) {
  const { isDeadBehavior } = createDeadGates(graph, reverseRefs, offered);

  const requirementValue = (id: string, seen: Set<string>): Value => {
    const node = graph.nodes.get(id);
    if (!node) return resolvedNumber(graph, id);
    if (seen.has(id)) return null;
    seen.add(id);
    const operands = () => directValues(node, "OperandArray").map((op) => requirementValue(op, seen));
    switch (node.tag) {
      case "CRequirementConst":
        return resolvedNumber(graph, directValues(node, "Value")[0] ?? "");
      case "CRequirementCountBehavior": {
        const behavior = directValues(node, "Count", "Link")[0];
        return behavior && isDeadBehavior(behavior) ? 0 : null;
      }
      case "CRequirementAnd":
        return and(operands());
      case "CRequirementOr":
        return or(operands());
      case "CRequirementNot": {
        const v = toBool(operands()[0] ?? null);
        return v === null ? null : !v;
      }
    }
    const compare = COMPARE[node.tag];
    if (!compare) return null;
    const [a = null, b = null] = operands().map(toNum);
    return a === null || b === null ? null : compare(a, b);
  };

  // Use or Show never passing means the button never works.
  const neverPasses = (requirementId: string): boolean => {
    const node = graph.nodes.get(requirementId);
    if (node?.tag !== "CRequirement") return false;
    return directValues(node, "NodeArray", "Link").some((link) => toBool(requirementValue(link, new Set())) === false);
  };

  return function isUnreachableAbility(abilityId: string, buttonId: string): boolean {
    for (const id of parentChain(graph, abilityId)) {
      const node = graph.nodes.get(id);
      if (!node?.tag.startsWith("CAbil")) continue;
      const button = node.elements.find(
        (el) => el.tag === "CmdButtonArray" && el.attrs.DefaultButtonFace === buttonId && el.attrs.Requirements !== undefined,
      );
      if (button) return neverPasses(button.attrs.Requirements);
    }
    return false;
  };
}
