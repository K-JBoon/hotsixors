import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function geometry(xml: string, abilId: string) {
  const script = `
    import { buildEffectGraph } from "./scripts/lib/effect-graph/index.ts";
    import { abilityGeometry } from "./scripts/lib/ability-geometry.ts";
    const graph = buildEffectGraph([{ path: "x.xml", content: ${JSON.stringify(`<Catalog>${xml}</Catalog>`)} }]);
    process.stdout.write(JSON.stringify(abilityGeometry(graph, ${JSON.stringify(abilId)})));
  `;
  const out = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" },
  );
  return JSON.parse(out);
}

test("forward persistent offset that launches a missile sets range", () => {
  const g = geometry(`
    <CAbilEffectTarget id="Hook"><Effect value="HookPersistent" /><Range value="500" /><CursorEffect value="HookScan" /></CAbilEffectTarget>
    <CEffectCreatePersistent id="HookPersistent">
      <WhichLocation Value="CasterPoint" />
      <PeriodicOffsetArray Y="-12" />
      <PeriodicEffectArray value="HookLaunch" />
    </CEffectCreatePersistent>
    <CEffectLaunchMissile id="HookLaunch"><ImpactLocation Value="TargetPoint" /></CEffectLaunchMissile>
    <CEffectEnumArea id="HookScan"><AreaArray MaxCount="1"><RectangleWidth value="1.25" /><RectangleHeight value="1.25" /></AreaArray></CEffectEnumArea>
  `, "Hook");
  assert.equal(g.range, 12);
  assert.equal(g.width, 1.25);
});

test("persistent offset without a missile is ignored", () => {
  const g = geometry(`
    <CAbilEffectInstant id="Cone"><Effect value="SoundPersistent" /></CAbilEffectInstant>
    <CEffectCreatePersistent id="SoundPersistent">
      <WhichLocation Value="CasterPoint" />
      <PeriodicOffsetArray Y="-6" />
      <PeriodicEffectArray value="Sound" />
    </CEffectCreatePersistent>
    <CEffectSet id="Sound" />
  `, "Cone");
  assert.equal(g.range, null);
});

test("accumulator override of a missile projection sets max range", () => {
  const g = geometry(`
    <CAbilEffectTarget id="Charge"><Effect value="ChargeChannel" /><Range value="500" /></CAbilEffectTarget>
    <CEffectApplyBehavior id="ChargeChannel"><Behavior value="ChargeBuff" /></CEffectApplyBehavior>
    <CBehaviorBuff id="ChargeBuff"><PeriodicEffect value="ChargeUpdate" /></CBehaviorBuff>
    <CEffectModifyCatalogNumeric id="ChargeUpdate">
      <CatalogModifications Operation="Set" Reference="Effect,ChargeLaunch,ImpactLocation.ProjectionDistanceScale">
        <Value value="0"><AccumulatorArray value="ChargeAccumulator" /></Value>
      </CatalogModifications>
    </CEffectModifyCatalogNumeric>
    <CAccumulatorToken id="ChargeAccumulator"><TokenId value="ChargeToken" /><Scale value="0.5" /><Offset value="3" /></CAccumulatorToken>
    <CBehaviorTokenCounter id="ChargeToken"><Max value="24" /></CBehaviorTokenCounter>
  `, "Charge");
  assert.equal(g.range, 15);
});

test("area behind an applied behavior sets radius, talent-gated areas keep their gate", () => {
  const g = geometry(`
    <CAbilEffectTarget id="Bomb"><Effect value="BombApply" /><Range value="5.5" /></CAbilEffectTarget>
    <CEffectApplyBehavior id="BombApply"><Behavior value="BombBuff" /></CEffectApplyBehavior>
    <CBehaviorBuff id="BombBuff"><ExpireEffect value="BombSet" /></CBehaviorBuff>
    <CEffectSet id="BombSet"><EffectArray value="BombTalentSearch" /><EffectArray value="BombSearch" /></CEffectSet>
    <CEffectEnumArea id="BombTalentSearch"><ValidatorArray value="HasBombTalent" /><AreaArray Effect="BombDamage"><Radius value="6" /></AreaArray></CEffectEnumArea>
    <CEffectEnumArea id="BombSearch"><AreaArray Effect="BombDamage"><Radius value="3.3" /></AreaArray></CEffectEnumArea>
    <CEffectDamage id="BombDamage" parent="StormDamage" />
    <CEffectDamage id="StormDamage" />
    <CValidatorPlayerTalent id="HasBombTalent"><Value value="BombTalent" /><Find value="1" /></CValidatorPlayerTalent>
  `, "Bomb");
  assert.equal(g.range, 5.5);
  assert.equal(g.radius, 3.3);
  assert.deepEqual(g.areas.map((a) => [a.radius, a.gates]), [[6, ["HasBombTalent"]]]);
});

test("summoned unit areas are labeled by what they do, inert areas are dropped", () => {
  const g = geometry(`
    <CAbilEffectTarget id="Bird"><Effect value="BirdCreate" /><Range value="10" /></CAbilEffectTarget>
    <CEffectCreateUnit id="BirdCreate"><SpawnUnit value="BirdUnit" /></CEffectCreateUnit>
    <CUnit id="BirdUnit"><BehaviorArray Link="ShrubProximityDetector" /><BehaviorArray Link="BirdLife" /><WeaponArray Link="BirdWeapon" /></CUnit>
    <CBehaviorBuff id="BirdLife"><PeriodicEffect value="BirdAcquire" /></CBehaviorBuff>
    <CEffectEnumArea id="BirdAcquire"><AreaArray MaxCount="1" Effect="BirdAttackOrder"><Radius value="6" /></AreaArray></CEffectEnumArea>
    <CEffectIssueOrder id="BirdAttackOrder" />
    <CWeaponLegacy id="BirdWeapon"><Effect value="BirdSplash" /></CWeaponLegacy>
    <CEffectEnumArea id="BirdSplash"><AreaArray Effect="BirdSplashDamage"><Radius value="2" /></AreaArray></CEffectEnumArea>
    <CEffectDamage id="BirdSplashDamage" parent="StormDamage" />
    <CEffectDamage id="StormDamage" />
    <CBehaviorBuff id="ShrubProximityDetector"><PeriodicEffect value="ShrubSearch" /></CBehaviorBuff>
    <CEffectEnumArea id="ShrubSearch"><AreaArray Effect="ShrubReveal"><Radius value="3.5" /></AreaArray></CEffectEnumArea>
    <CEffectSet id="ShrubReveal" />
  `, "Bird");
  assert.equal(g.radius, null);
  assert.deepEqual(g.areas.map((a) => [a.label, a.radius]), [["Damage area", 2], ["Target search", 6]]);
});

test("destroying another ability's persistent does not walk into it", () => {
  const g = geometry(`
    <CAbilEffectTarget id="Slide"><Effect value="SlideSet" /></CAbilEffectTarget>
    <CEffectSet id="SlideSet"><EffectArray value="StopPit" /></CEffectSet>
    <CEffectDestroyPersistent id="StopPit"><Effect value="PitPersistent" /></CEffectDestroyPersistent>
    <CEffectCreatePersistent id="PitPersistent"><PeriodicEffectArray value="PitSearch" /></CEffectCreatePersistent>
    <CEffectEnumArea id="PitSearch"><AreaArray Effect="PitDamage"><Radius value="4" /></AreaArray></CEffectEnumArea>
    <CEffectDamage id="PitDamage" parent="StormDamage" />
    <CEffectDamage id="StormDamage" />
  `, "Slide");
  assert.equal(g.radius, null);
  assert.deepEqual(g.areas, []);
});

test("triangle targeting guide length counts as range", () => {
  const g = geometry(`
    <CAbilEffectTarget id="Strike"><Range value="500" /><CursorEffect value="StrikeGuide" /></CAbilEffectTarget>
    <CEffectEnumArea id="StrikeGuide"><AreaArray TriangleAngle="20" TriangleHeight="13" /></CEffectEnumArea>
  `, "Strike");
  assert.equal(g.range, 13);
  assert.equal(g.radius, null);
});

test("dash offset in a ParentAbil sibling sets range", () => {
  const g = geometry(`
    <CAbilEffectInstant id="FistCast"><Effect value="FistCharge" /></CAbilEffectInstant>
    <CAbilEffectInstant id="FistTrigger"><ParentAbil value="FistCast" /></CAbilEffectInstant>
    <CAbilEffectTarget id="FistExecute"><ParentAbil value="FistCast" /><Effect value="FistOffset" /></CAbilEffectTarget>
    <CEffectSet id="FistCharge" />
    <CEffectCreatePersistent id="FistOffset">
      <WhichLocation Value="CasterPoint" />
      <PeriodicOffsetArray Y="-4" />
      <PeriodicEffectArray value="FistMove" />
    </CEffectCreatePersistent>
    <CEffectIssueOrder id="FistMove" />
  `, "FistTrigger");
  assert.equal(g.range, 4);
});

test("persistent projected forward from the caster sets range after the targeting guide", () => {
  const g = geometry(`
    <CAbilEffectTarget id="Wall"><Effect value="WallOffset" /><Range value="500" /></CAbilEffectTarget>
    <CEffectCreatePersistent id="WallOffset">
      <WhichLocation><ProjectionSourceValue value="CasterPoint" /><ProjectionDistanceScale value="22" /></WhichLocation>
    </CEffectCreatePersistent>
  `, "Wall");
  assert.equal(g.range, 22);
});

test("a smaller circle a set fires with a larger one of the same kind is its center", () => {
  const g = geometry(`
    <CAbilEffectTarget id="Flare"><Effect value="FlareSet" /><CursorEffect value="FlareOuter" /></CAbilEffectTarget>
    <CEffectSet id="FlareSet"><EffectArray value="FlareInner" /><EffectArray value="FlareOuter" /></CEffectSet>
    <CEffectEnumArea id="FlareInner"><AreaArray Effect="FlareDamage"><Radius value="1" /></AreaArray></CEffectEnumArea>
    <CEffectEnumArea id="FlareOuter"><AreaArray Effect="FlareDamage"><Radius value="2.5" /></AreaArray></CEffectEnumArea>
    <CEffectDamage id="FlareDamage" parent="StormDamage" />
    <CEffectDamage id="StormDamage" />
  `, "Flare");
  assert.equal(g.radius, 2.5);
  assert.deepEqual(g.areas.map((a) => [a.label, a.radius]), [["Center damage area", 1]]);
});

test("with its own cursor, an area named after another ability does not set the radius", () => {
  const g = geometry(`
    <CAbilEffectTarget id="Stream"><Effect value="StreamSet" /><CursorEffect value="StreamSearch" /></CAbilEffectTarget>
    <CEffectSet id="StreamSet"><EffectArray value="StreamSearch" /><EffectArray value="SpillIgniteSearch" /></CEffectSet>
    <CEffectEnumArea id="StreamSearch">
      <AreaArray Effect="StreamDamage"><RectangleWidth value="0.85" /><RectangleHeight value="1.75" /></AreaArray>
    </CEffectEnumArea>
    <CEffectEnumArea id="SpillIgniteSearch"><AreaArray Effect="StreamDamage"><Radius value="1.5" /></AreaArray></CEffectEnumArea>
    <CEffectDamage id="StreamDamage" parent="StormDamage" />
    <CEffectDamage id="StormDamage" />
    <CAbilEffectTarget id="Spill" />
  `, "Stream");
  assert.equal(g.width, 0.85);
  assert.equal(g.radius, null);
});

test("a state check on the cast's own effect is what it targets, not a gate; a talent check there stays", () => {
  const g = geometry(`
    <CAbilEffectTarget id="Strike"><Effect value="StrikeSet" /></CAbilEffectTarget>
    <CEffectSet id="StrikeSet">
      <ValidatorArray value="TargetMarked" /><ValidatorArray value="HasStrikeTalent" />
      <EffectArray value="StrikeSearch" />
    </CEffectSet>
    <CEffectEnumArea id="StrikeSearch"><AreaArray Effect="StrikeDamage"><Radius value="4" /></AreaArray></CEffectEnumArea>
    <CEffectDamage id="StrikeDamage" parent="StormDamage" />
    <CEffectDamage id="StormDamage" />
    <CValidatorUnitCompareBehaviorCount id="TargetMarked"><Compare value="GT" /><Behavior value="Marked" /></CValidatorUnitCompareBehaviorCount>
    <CValidatorPlayerTalent id="HasStrikeTalent"><Find value="1" /><Value value="StrikeTalent" /></CValidatorPlayerTalent>
  `, "Strike");
  assert.deepEqual(g.areas.map((a) => [a.radius, a.gates]), [[4, ["HasStrikeTalent"]]]);
});
