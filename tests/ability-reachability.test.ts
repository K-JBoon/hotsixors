import assert from "node:assert/strict";
import test from "node:test";
import { buildEffectGraph } from "../scripts/lib/effect-graph/index.ts";
import { buildReverseRefs } from "../scripts/lib/effect-graph/walk.ts";
import { createReachability } from "../scripts/lib/ability-reachability.ts";

const XML = `<Catalog>
  <CTalent id="DoubleTalent" />
  <CValidatorPlayerTalent id="HasDouble"><Find value="1" /><Value value="DoubleTalent" /></CValidatorPlayerTalent>
  <CValidatorPlayerTalent id="LacksDouble"><Value value="DoubleTalent" /></CValidatorPlayerTalent>
  <CBehaviorBuff id="FreeCast" />
  <CBehaviorBuff id="LiveCast" />
  <CEffectApplyBehavior id="ApplyFreeCast"><ValidatorArray value="HasDouble" /><Behavior value="FreeCast" /></CEffectApplyBehavior>
  <CEffectApplyBehavior id="ApplyLiveCast"><ValidatorArray value="LacksDouble" /><Behavior value="LiveCast" /></CEffectApplyBehavior>
  <CRequirementCountBehavior id="CountFreeCast"><Count Link="FreeCast" State="CompleteOnlyAtUnit" /></CRequirementCountBehavior>
  <CRequirementCountBehavior id="CountLiveCast"><Count Link="LiveCast" State="CompleteOnlyAtUnit" /></CRequirementCountBehavior>
  <CRequirementEq id="EqFreeCast1"><OperandArray index="0" value="CountFreeCast" /><OperandArray index="1" value="1" /></CRequirementEq>
  <CRequirementEq id="EqFreeCast0"><OperandArray index="0" value="CountFreeCast" /><OperandArray index="1" value="0" /></CRequirementEq>
  <CRequirementEq id="EqLiveCast1"><OperandArray index="0" value="CountLiveCast" /><OperandArray index="1" value="1" /></CRequirementEq>
  <CRequirementAnd id="AndFreeCast"><OperandArray value="EqFreeCast1" /></CRequirementAnd>
  <CRequirementOr id="OrEither"><OperandArray value="EqFreeCast1" /><OperandArray value="EqLiveCast1" /></CRequirementOr>
  <CRequirement id="ShowFreeCast"><NodeArray index="Show" Link="AndFreeCast" /></CRequirement>
  <CRequirement id="UseNoFreeCast"><NodeArray index="Use" Link="EqFreeCast0" /></CRequirement>
  <CRequirement id="ShowEither"><NodeArray index="Show" Link="OrEither" /></CRequirement>
  <CAbilEffectTarget id="Double"><CmdButtonArray index="Execute" DefaultButtonFace="Double" Requirements="ShowFreeCast" /></CAbilEffectTarget>
  <CAbilEffectTarget id="Plain"><CmdButtonArray index="Execute" DefaultButtonFace="Plain" Requirements="UseNoFreeCast" /></CAbilEffectTarget>
  <CAbilEffectTarget id="Either"><CmdButtonArray index="Execute" DefaultButtonFace="Either" Requirements="ShowEither" /></CAbilEffectTarget>
  <CAbilEffectTarget id="DoubleChild" parent="Double" />
</Catalog>`;

function reachability(offered: string[]) {
  const graph = buildEffectGraph([{ path: "test.xml", content: XML }]);
  return createReachability(graph, buildReverseRefs(graph), new Set(offered));
}

test("button gated on a behavior only an unoffered talent applies is unreachable", () => {
  const isUnreachable = reachability([]);
  assert.equal(isUnreachable("Double", "Double"), true);
  assert.equal(isUnreachable("DoubleChild", "Double"), true);
});

test("same button is reachable once a talent tree offers the talent", () => {
  assert.equal(reachability(["DoubleTalent"])("Double", "Double"), false);
});

test("requirements that pass at zero count or have a live branch stay reachable", () => {
  const isUnreachable = reachability([]);
  assert.equal(isUnreachable("Plain", "Plain"), false);
  assert.equal(isUnreachable("Either", "Either"), false);
  assert.equal(isUnreachable("Missing", "Missing"), false);
});
