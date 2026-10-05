import assert from "node:assert/strict";
import test from "node:test";
import { buildEffectGraph } from "../scripts/lib/effect-graph/index.ts";
import { buildReverseRefs } from "../scripts/lib/effect-graph/walk.ts";
import { createDeadGates } from "../scripts/lib/ability-reachability.ts";
import { heroSummons, type SummonEntry } from "../scripts/lib/hero-summons.ts";
import { summonStats } from "../scripts/gen-heroes.ts";

const XML = `<Catalog>
  <CTalent id="StrainTalent" />
  <CTalent id="OldTalent" />
  <CValidatorPlayerTalent id="HasStrain"><Find value="1" /><Value value="StrainTalent" /></CValidatorPlayerTalent>
  <CValidatorPlayerTalent id="HasOld"><Find value="1" /><Value value="OldTalent" /></CValidatorPlayerTalent>
  <CEffectCreateUnit id="CreateNormal"><SpawnUnit value="Normal" /></CEffectCreateUnit>
  <CEffectCreateUnit id="CreateStrain"><ValidatorArray value="HasStrain" /><SpawnUnit value="StrainUnit" /></CEffectCreateUnit>
  <CEffectCreateUnit id="CreateOld"><ValidatorArray value="HasOld" /><SpawnUnit value="OldUnit" /></CEffectCreateUnit>
  <CEffectSet id="SpawnSet">
    <EffectArray value="CreateNormal" />
    <EffectArray value="CreateStrain" />
    <EffectArray value="CreateOld" />
    <EffectArray value="CreateMerged" />
    <EffectArray value="ApplySplitReady" />
    <EffectArray value="CreateSplit" />
  </CEffectSet>
  <CAbilEffectInstant id="Spawn">
    <Effect value="SpawnSet" />
    <ProducedUnitArray value="OldUnit" />
    <ProducedUnitArray value="Trained" />
  </CAbilEffectInstant>
  <CEffectSet id="DeepOuter"><EffectArray value="DeepInner" /></CEffectSet>
  <CEffectSet id="DeepInner"><EffectArray value="CreateNormal" /></CEffectSet>
  <CAbilEffectInstant id="Deep"><Effect value="DeepOuter" /></CAbilEffectInstant>
  <CBehaviorBuff id="MergedStrain" />
  <CTalent id="MergedStrain"><BehaviorArray value="MergedStrain" /></CTalent>
  <CValidatorPlayerTalent id="HasMergedTalent"><Find value="1" /><Value value="MergedStrain" /></CValidatorPlayerTalent>
  <CEffectApplyBehavior id="ApplyMerged"><ValidatorArray value="HasMergedTalent" /><Behavior value="MergedStrain" /></CEffectApplyBehavior>
  <CValidatorUnitCompareBehaviorCount id="HasMerged"><Value value="1" /><Behavior value="MergedStrain" /></CValidatorUnitCompareBehaviorCount>
  <CEffectCreateUnit id="CreateMerged"><ValidatorArray value="HasMerged" /><SpawnUnit value="MergedUnit" /></CEffectCreateUnit>
  <CTalent id="GoneTalent" />
  <CValidatorPlayerTalent id="HasGone"><Find value="1" /><Value value="GoneTalent" /></CValidatorPlayerTalent>
  <CBehaviorBuff id="SplitReady"><DisableValidatorArray value="HasGone" /></CBehaviorBuff>
  <CEffectApplyBehavior id="ApplySplitReady"><Behavior value="SplitReady" /></CEffectApplyBehavior>
  <CValidatorUnitCompareBehaviorCount id="HasSplitReady"><Value value="1" /><Behavior value="SplitReady" /></CValidatorUnitCompareBehaviorCount>
  <CEffectCreateUnit id="CreateSplit"><ValidatorArray value="HasSplitReady" /><SpawnUnit value="SplitUnit" /></CEffectCreateUnit>
  <CEffectCreateUnit id="HeroHostCreateBeetle"><SpawnUnit value="Beetle" /></CEffectCreateUnit>
  <CEffectCreateUnit id="SummonTumorCreateUnit"><SpawnUnit value="Tumor" /></CEffectCreateUnit>
  <CAbilEffectInstant id="HeroStab"><Effect value="HeroHostCreateBeetle" /></CAbilEffectInstant>
  <CAbilEffectInstant id="HeroSummonTumor"><Effect value="SummonTumorCreateUnit" /></CAbilEffectInstant>
</Catalog>`;

function summons(entries: SummonEntry[], offered: string[]) {
  const graph = buildEffectGraph([{ path: "test.xml", content: XML }]);
  const talents = new Set(offered);
  const { isDeadCondition } = createDeadGates(graph, buildReverseRefs(graph), talents);
  return Object.fromEntries(heroSummons(graph, entries, talents, isDeadCondition).map((s) => [s.unitId, s.sourceId]));
}

const SPAWN = { id: "Spawn", abilityId: "Spawn", buttonId: "Spawn" };
const DEEP = { id: "Deep", abilityId: "Deep", buttonId: "Deep" };

test("an ungated spawn goes to the ability, a talent-gated one to the offered talent", () => {
  const found = summons([SPAWN], ["StrainTalent"]);
  assert.equal(found.Normal, "Spawn");
  assert.equal(found.StrainUnit, "StrainTalent");
});

test("a spawn behind an unoffered talent is dropped, even when the ability lists it as produced", () => {
  const found = summons([SPAWN], []);
  assert.equal(found.OldUnit, undefined);
  assert.equal(found.StrainUnit, undefined);
});

test("a unit only the produced list names falls back to the ability", () => {
  assert.equal(summons([SPAWN], []).Trained, "Spawn");
});

test("the shallowest spawn wins over entry order", () => {
  assert.equal(summons([DEEP, SPAWN], []).Normal, "Spawn");
});

test("a spawn goes to the entry its effect is named after, even one whose walk misses it", () => {
  const stab = { id: "HeroStab", abilityId: "HeroStab", buttonId: "HeroStab" };
  const trait = { id: "HeroHostVisual", abilityId: "HeroHostVisual", buttonId: "HeroHostTrait" };
  assert.equal(summons([stab, trait], []).Beetle, "HeroHostVisual");
});

test("one shared generic word does not move a spawn", () => {
  const tumor = { id: "HeroSummonTumor", abilityId: "HeroSummonTumor", buttonId: "HeroSummonTumor" };
  const mount = { id: "Mount", abilityId: "Mount", buttonId: "SummonMount" };
  assert.equal(summons([tumor, mount], []).Tumor, "HeroSummonTumor");
});

test("a spawn gated on a behavior an unoffered talent's disable validator switches off is dropped", () => {
  assert.equal(summons([SPAWN], []).SplitUnit, undefined);
  assert.equal(summons([SPAWN], ["GoneTalent"]).SplitUnit, "Spawn");
});

test("a behavior count gate resolves to a talent merged into the behavior's id", () => {
  assert.equal(summons([SPAWN], ["MergedStrain"]).MergedUnit, "MergedStrain");
  assert.equal(summons([SPAWN], []).MergedUnit, undefined);
});

const life = (amount: number) => ({ amount, scale: 0, regenRate: 0 });
const weapon = (damage: number) => ({ nameId: "W", range: 1, period: 1, damage });

test("summon stats skip invulnerable effect carriers and effect-driven weapons", () => {
  const summoned = ["Summoned"];
  assert.equal(summonStats({ attributes: summoned, life: life(1) }), null);
  assert.equal(summonStats({ attributes: summoned, life: life(1), weapons: [weapon(0)] }), null);
  assert.equal(summonStats({ life: life(500) }), null);
  assert.equal(summonStats({ attributes: summoned, life: life(1), weapons: [weapon(20)] })?.weapon?.damage, 20);
  assert.equal(summonStats({ attributes: summoned, life: life(300), weapons: [weapon(0)] })?.weapon, null);
});
