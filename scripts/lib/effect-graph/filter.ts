// Mechanic-matching predicates.

import type { EffectGraph, MechanicLike } from "./types.ts";
import { targetBehaviorOf } from "./walk.ts";
import {
  armorBuffPolarity,
  armorBuffDamageKind,
  attackSpeedModifierPolarity,
  damageModifierSignal,
  lifestealBehaviorMatchesKind,
} from "./polarity.ts";
import { protectionKindForMechanic, protectionKindOfBehavior } from "./protection.ts";

export function behaviorMatchesMechanicKind(
  graph: EffectGraph,
  behaviorId: string,
  mechanic: MechanicLike,
): boolean {
  const protectionKind = protectionKindForMechanic(mechanic);
  if (protectionKind !== null) return protectionKindOfBehavior(graph, behaviorId) === protectionKind;
  if (mechanic.armorPolarity) {
    if (armorBuffPolarity(graph, behaviorId) !== mechanic.armorPolarity) return false;
    if (mechanic.armorDamageKind) {
      return armorBuffDamageKind(graph, behaviorId, mechanic.armorPolarity) === mechanic.armorDamageKind;
    }
  }
  if (mechanic.statModifier === "attack-speed") {
    return attackSpeedModifierPolarity(graph, behaviorId) === mechanic.statPolarity;
  }
  if (mechanic.statModifier === "damage") {
    const signal = damageModifierSignal(graph, behaviorId);
    return Boolean(
      signal
      && signal.polarity === mechanic.statPolarity
      && signal.kind === mechanic.statDamageKind,
    );
  }
  if (mechanic.statModifier === "lifesteal") {
    return lifestealBehaviorMatchesKind(graph, behaviorId, mechanic.statDamageKind);
  }
  return true;
}

// Encapsulates the filters that gate whether a node belongs to a mechanic.
export function nodePassesMechanicFilter(
  graph: EffectGraph,
  nodeId: string,
  mech: MechanicLike,
): boolean {
  const armorPolarity = mech.armorPolarity ?? null;
  const armorDamageKind = mech.armorDamageKind ?? null;
  const protectionKind = protectionKindForMechanic(mech);
  const needsStatBuff = mech.statModifier && mech.statModifier !== "lifesteal";
  if (armorPolarity === null && protectionKind === null && !needsStatBuff) return true;
  const buffId = targetBehaviorOf(graph, nodeId);
  if (!buffId) return false;
  if (armorPolarity !== null) {
    if (armorBuffPolarity(graph, buffId) !== armorPolarity) return false;
    if (armorDamageKind !== null && armorBuffDamageKind(graph, buffId, armorPolarity) !== armorDamageKind) return false;
  }
  if (protectionKind !== null && protectionKindOfBehavior(graph, buffId) !== protectionKind) return false;
  if (needsStatBuff && !behaviorMatchesMechanicKind(graph, buffId, mech)) return false;
  return true;
}
