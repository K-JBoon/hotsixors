import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { tickNote } from "../scripts/lib/ability-ticks.ts";

const ROOTS = `
  <CEffectDamage id="StormDamage" />
  <CEffectDamage id="StormSpell" parent="StormDamage" />
  <CEffectCreateHealer id="StormHealingParent" />
  <CBehaviorBuff id="StormStun" />
  <CBehaviorBuff id="StormSlowParent" />
  <CBehaviorBuff id="StormArmor" />
  <CBehaviorBuff id="StormDisplacement" />
  <CEffectDamage id="StormSuicideParent" />
  <CEffectDamage id="StormSuicide" parent="StormSuicideParent" />
`;

function ticks(xml: string, abilId: string) {
  const script = `
    import { buildEffectGraph } from "./scripts/lib/effect-graph/index.ts";
    import { abilityTicks } from "./scripts/lib/ability-ticks.ts";
    const graph = buildEffectGraph([{ path: "x.xml", content: ${JSON.stringify(`<Catalog>${ROOTS}${xml}</Catalog>`)} }]);
    process.stdout.write(JSON.stringify(abilityTicks(graph, ${JSON.stringify(abilId)})));
  `;
  const out = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" },
  );
  return JSON.parse(out) as {
    label: string;
    amount: number | null;
    amountMax?: number;
    period: number;
    rate: number;
    firstAt: number;
    count: number | null;
    lasts?: number;
    gates: string[];
  }[];
}

const amountText = (t: ReturnType<typeof ticks>[number]) =>
  t.amount === null ? "" : `${t.amount}${t.amountMax === undefined ? "" : ` to ${t.amountMax}`} `;
const brief = (t: ReturnType<typeof ticks>[number]) => `${amountText(t)}${t.label} @${t.period} x${t.count} from ${t.firstAt}`;

const DISINTEGRATE = `
  <CAbilEffectTarget id="Beam"><Effect value="BeamStart" /></CAbilEffectTarget>
  <CEffectApplyBehavior id="BeamStart"><Behavior value="BeamController" /></CEffectApplyBehavior>
  <CBehaviorBuff id="BeamController">
    <Duration value="2.5" />
    <InitialEffect value="BeamActiveApply" />
    <FinalEffect value="BeamActiveRemove" />
  </CBehaviorBuff>
  <CEffectRemoveBehavior id="BeamActiveRemove"><BehaviorLink value="BeamActive" /></CEffectRemoveBehavior>
  <CEffectApplyBehavior id="BeamActiveApply"><Behavior value="BeamActive" /></CEffectApplyBehavior>
  <CBehaviorBuff id="BeamActive">
    <Duration value="10" />
    <Period value="0.0625" />
    <InitialEffect value="BeamPersistents" />
    <PeriodicEffect value="BeamPersistents" />
  </CBehaviorBuff>
  <CEffectSet id="BeamPersistents"><Marker><MatchFlags index="Id" value="1" /></Marker><EffectArray value="BeamOffset" /></CEffectSet>
  <CEffectCreatePersistent id="BeamOffset">
    <PeriodCount value="1" />
    <PeriodicEffectArray value="BeamSearch" />
    <PeriodicPeriodArray value="0" />
  </CEffectCreatePersistent>
  <CEffectEnumArea id="BeamSearch"><AreaArray Effect="BeamDamageSet"><RectangleWidth value="1" /><RectangleHeight value="16" /></AreaArray></CEffectEnumArea>
  <CEffectSet id="BeamDamageSet"><ValidatorArray value="noMarkers" /><EffectArray value="BeamDamageSwitch" /></CEffectSet>
  <CValidatorUnitCompareMarkerCount id="noMarkers" />
  <CEffectSwitch id="BeamDamageSwitch">
    <CaseArray Validator="HasBigBeam" Effect="BeamBigDamage" />
    <CaseDefault value="BeamDamage" />
  </CEffectSwitch>
  <CEffectDamage id="BeamDamage" parent="StormSpell"><Amount value="12" /></CEffectDamage>
  <CEffectDamage id="BeamBigDamage" parent="StormSpell"><Amount value="11" /></CEffectDamage>
  <CValidatorPlayerTalent id="HasBigBeam"><Find value="1" /><Value value="BigBeam" /></CValidatorPlayerTalent>
`;

test("behavior tick: interval, payload, t=0 hit, count capped by the behavior above whose end removes it", () => {
  const out = ticks(DISINTEGRATE, "Beam");
  assert.deepEqual(out.map(brief).sort(), ["11 damage @0.0625 x40 from 0", "12 damage @0.0625 x40 from 0"]);
  assert.equal(out.find((t) => t.amount === 12)!.rate, 16);
});

test("talent case of a payload becomes its own gated tick", () => {
  const out = ticks(DISINTEGRATE, "Beam");
  assert.deepEqual(out.find((t) => t.amount === 12)!.gates, []);
  assert.deepEqual(out.find((t) => t.amount === 11)!.gates, ["HasBigBeam"]);
});

const MOSH = `
  <CAbilEffectInstant id="Mosh"><Effect value="MoshCast" /></CAbilEffectInstant>
  <CEffectSet id="MoshCast"><EffectArray value="MoshChannelApply" /><EffectArray value="MoshPersistent" /></CEffectSet>
  <CEffectApplyBehavior id="MoshChannelApply">
    <WhichUnit Value="Caster" />
    <Behavior value="MoshChannel" />
    <Flags index="UseDuration" value="1" />
    <Duration value="4" />
  </CEffectApplyBehavior>
  <CBehaviorBuff id="MoshChannel"><Duration value="2" /></CBehaviorBuff>
  <CEffectCreatePersistent id="MoshPersistent">
    <InitialEffect value="MoshSearch" />
    <PeriodCount value="48" />
    <PeriodicEffectArray value="MoshSearch" />
    <PeriodicPeriodArray value="0.125" />
    <PeriodicValidator value="HasMoshChannel" />
  </CEffectCreatePersistent>
  <CValidatorUnitCompareBehaviorCount id="HasMoshChannel">
    <WhichUnit Value="Source" /><Value value="1" /><Behavior value="MoshChannel" />
  </CValidatorUnitCompareBehaviorCount>
  <CEffectEnumArea id="MoshSearch"><AreaArray Effect="MoshApplySet"><Radius value="4" /></AreaArray></CEffectEnumArea>
  <CEffectSet id="MoshApplySet"><EffectArray value="MoshStunApply" /><EffectArray value="MoshRevealApply" /></CEffectSet>
  <CEffectApplyBehavior id="MoshStunApply"><Behavior value="MoshStun" /></CEffectApplyBehavior>
  <CEffectApplyBehavior id="MoshRevealApply"><Behavior value="MoshReveal" /></CEffectApplyBehavior>
  <CBehaviorBuff id="MoshStun" parent="StormStun"><Duration value="0.5" /></CBehaviorBuff>
  <CBehaviorBuff id="MoshReveal"><Duration value="1" /></CBehaviorBuff>
`;

test("persistent tick: validator limit uses the UseDuration override, payload duration from parent chain", () => {
  assert.deepEqual(ticks(MOSH, "Mosh").map(brief), ["0.5s stun @0.125 x32 from 0"]);
});

test("persistent without an initial hit starts after one period", () => {
  const xml = MOSH.replace('<InitialEffect value="MoshSearch" />', "");
  assert.deepEqual(ticks(xml, "Mosh").map(brief), ["0.5s stun @0.125 x31 from 0.125"]);
});

const STAGED = (effects: string, periods: string, count: number) => `
  <CAbilEffectInstant id="Stage"><Effect value="StagePersistent" /></CAbilEffectInstant>
  <CEffectCreatePersistent id="StagePersistent">
    <PeriodCount value="${count}" />
    ${effects}
    ${periods}
  </CEffectCreatePersistent>
  <CEffectDamage id="StageDamage" parent="StormSpell"><Amount value="92" /></CEffectDamage>
  <CEffectSet id="StageNothing" />
`;

test("periodic effect array cycles: one damage entry of eight fires once per cycle", () => {
  const effects = '<PeriodicEffectArray value="StageNothing" />'.repeat(7) + '<PeriodicEffectArray value="StageDamage" />';
  const xml = STAGED(effects, '<PeriodicPeriodArray value="0.125" />', 48);
  assert.deepEqual(ticks(xml, "Stage").map(brief), ["92 damage @1 x6 from 1"]);
});

test("period array entries are per period: a delayed single hit is not a tick", () => {
  const effects = '<PeriodicEffectArray value="StageNothing" /><PeriodicEffectArray value="StageDamage" />';
  const xml = STAGED(effects, '<PeriodicPeriodArray value="2" /><PeriodicPeriodArray value="0.25" />', 2);
  assert.deepEqual(ticks(xml, "Stage"), []);
});

test("single hits of one kind at even steps form one ramping tick", () => {
  const xml = `
    <CAbilEffectInstant id="Ring"><Effect value="RingPersistent" /></CAbilEffectInstant>
    <CEffectCreatePersistent id="RingPersistent">
      <PeriodCount value="3" />
      <PeriodicEffectArray value="RingDamage1" /><PeriodicEffectArray value="RingDamage2" /><PeriodicEffectArray value="RingDamage3" />
      <PeriodicPeriodArray value="1" />
    </CEffectCreatePersistent>
    <CEffectDamage id="RingDamage1" parent="StormSpell"><Amount value="20" /></CEffectDamage>
    <CEffectDamage id="RingDamage2" parent="StormSpell"><Amount value="40" /></CEffectDamage>
    <CEffectDamage id="RingDamage3" parent="StormSpell"><Amount value="60" /></CEffectDamage>
  `;
  assert.deepEqual(ticks(xml, "Ring").map(brief), ["20 to 60 growing damage @1 x3 from 1"]);
});

test("DoT expiring on its own still hits on the last period; heal and armor payloads", () => {
  const xml = `
    <CAbilEffectTarget id="Grow"><Effect value="GrowApply" /></CAbilEffectTarget>
    <CEffectApplyBehavior id="GrowApply"><Behavior value="GrowHoT" /></CEffectApplyBehavior>
    <CBehaviorBuff id="GrowHoT">
      <Duration value="20" />
      <Period value="1" />
      <PeriodicEffect value="GrowSet" />
    </CBehaviorBuff>
    <CEffectSet id="GrowSet"><EffectArray value="GrowHeal" /><EffectArray value="GrowArmorApply" /></CEffectSet>
    <CEffectCreateHealer id="GrowHeal" parent="StormHealingParent"><RechargeVitalRate value="19" /></CEffectCreateHealer>
    <CEffectApplyBehavior id="GrowArmorApply"><Behavior value="GrowArmor" /></CEffectApplyBehavior>
    <CBehaviorBuff id="GrowArmor" parent="StormArmor">
      <Duration value="2" />
      <ArmorModification><AllArmorBonus value="10" /></ArmorModification>
    </CBehaviorBuff>
  `;
  assert.deepEqual(ticks(xml, "Grow").map(brief).sort(), ["19 heal @1 x20 from 1", "2s +10 armor @1 x20 from 1"]);
});

test("a behavior a RemoveValidatorArray needs limits the count", () => {
  const xml = `
    <CAbilEffectInstant id="Aura"><Effect value="AuraSet" /></CAbilEffectInstant>
    <CEffectSet id="AuraSet"><EffectArray value="AuraLimitApply" /><EffectArray value="AuraApply" /></CEffectSet>
    <CEffectApplyBehavior id="AuraLimitApply"><Behavior value="AuraLimit" /></CEffectApplyBehavior>
    <CBehaviorBuff id="AuraLimit"><Duration value="3" /></CBehaviorBuff>
    <CEffectApplyBehavior id="AuraApply"><Behavior value="AuraPulse" /></CEffectApplyBehavior>
    <CBehaviorBuff id="AuraPulse">
      <Period value="0.5" />
      <PeriodicEffect value="AuraDamage" />
      <RemoveValidatorArray value="HasAuraLimit" />
    </CBehaviorBuff>
    <CValidatorUnitCompareBehaviorCount id="HasAuraLimit">
      <Compare value="GE" /><Value value="1" /><Behavior value="AuraLimit" />
    </CValidatorUnitCompareBehaviorCount>
    <CEffectDamage id="AuraDamage" parent="StormSpell"><Amount value="5" /></CEffectDamage>
  `;
  assert.deepEqual(ticks(xml, "Aura").map(brief), ["5 damage @0.5 x5 from 0.5"]);
});

test("a tick with no limit has no count", () => {
  const xml = `
    <CAbilEffectInstant id="Halo"><Effect value="HaloApply" /></CAbilEffectInstant>
    <CEffectApplyBehavior id="HaloApply"><Behavior value="HaloAura" /></CEffectApplyBehavior>
    <CBehaviorBuff id="HaloAura"><Period value="1" /><PeriodicEffect value="HaloDamage" /></CBehaviorBuff>
    <CEffectDamage id="HaloDamage" parent="StormSpell"><Amount value="12" /></CEffectDamage>
  `;
  assert.deepEqual(ticks(xml, "Halo").map(brief), ["12 damage @1 xnull from 1"]);
});

test("knockback movers, missile scans and self-ending triggers are not ticks", () => {
  const xml = `
    <CAbilEffectTarget id="Push"><Effect value="PushApply" /></CAbilEffectTarget>
    <CEffectApplyBehavior id="PushApply"><Behavior value="PushMover" /></CEffectApplyBehavior>
    <CBehaviorBuff id="PushMover" parent="StormDisplacement">
      <Duration value="0.5" /><Period value="0.0625" /><PeriodicEffect value="PushDamage" />
    </CBehaviorBuff>
    <CEffectDamage id="PushDamage" parent="StormSpell"><Amount value="50" /></CEffectDamage>

    <CAbilEffectTarget id="Orb"><Effect value="OrbLaunch" /></CAbilEffectTarget>
    <CEffectLaunchMissile id="OrbLaunch"><LaunchEffect value="OrbScan" /><ImpactEffect value="OrbBlast" /></CEffectLaunchMissile>
    <CEffectCreatePersistent id="OrbScan">
      <WhichLocation Value="SourceUnit" />
      <PeriodCount value="100" /><PeriodicEffectArray value="PushDamage" /><PeriodicPeriodArray value="0.0625" />
    </CEffectCreatePersistent>
    <CEffectCreatePersistent id="OrbBlast">
      <PeriodCount value="4" /><PeriodicEffectArray value="PushDamage" /><PeriodicPeriodArray value="0.5" />
    </CEffectCreatePersistent>

    <CAbilEffectInstant id="Nest"><Effect value="NestApply" /></CAbilEffectInstant>
    <CEffectApplyBehavior id="NestApply"><Behavior value="NestWatch" /></CEffectApplyBehavior>
    <CBehaviorBuff id="NestWatch"><Duration value="90" /><Period value="0.0625" /><PeriodicEffect value="NestTrigger" /></CBehaviorBuff>
    <CEffectSet id="NestTrigger"><EffectArray value="PushDamage" /><EffectArray value="StormSuicide" /></CEffectSet>
  `;
  assert.deepEqual(ticks(xml, "Push"), []);
  assert.deepEqual(ticks(xml, "Orb").map(brief), ["50 damage @0.5 x4 from 0.5"]);
  assert.deepEqual(ticks(xml, "Nest"), []);
});

test("a marker above the source with a marker check hits each unit once", () => {
  const xml = `
    <CAbilEffectInstant id="Wave"><Effect value="WavePersistent" /></CAbilEffectInstant>
    <CEffectCreatePersistent id="WavePersistent">
      <Marker><MatchFlags index="Id" value="1" /></Marker>
      <PeriodCount value="20" /><PeriodicEffectArray value="WaveSearch" /><PeriodicPeriodArray value="0.0625" />
    </CEffectCreatePersistent>
    <CEffectEnumArea id="WaveSearch"><AreaArray Effect="WaveDamage"><Radius value="3" /></AreaArray></CEffectEnumArea>
    <CEffectDamage id="WaveDamage" parent="StormSpell"><ValidatorArray value="noMarkers" /><Amount value="80" /></CEffectDamage>
    <CValidatorUnitCompareMarkerCount id="noMarkers" />
  `;
  assert.deepEqual(ticks(xml, "Wave"), []);
});

test("a charge that removes its own behavior on impact, directly or through a final effect, is not a tick", () => {
  const xml = `
    <CAbilEffectTarget id="Charge"><Effect value="ChargeSet" /></CAbilEffectTarget>
    <CEffectSet id="ChargeSet"><EffectArray value="ChargeApply" /><EffectArray value="FinishApply" /></CEffectSet>
    <CEffectApplyBehavior id="ChargeApply"><Behavior value="Charging" /></CEffectApplyBehavior>
    <CBehaviorBuff id="Charging">
      <Duration value="2.5" /><Period value="0.0625" /><PeriodicEffect value="ChargeScan" />
      <FinalEffect value="ChargeCleanup" />
    </CBehaviorBuff>
    <CEffectEnumArea id="ChargeScan"><AreaArray Effect="ChargeImpact"><Radius value="2" /></AreaArray></CEffectEnumArea>
    <CEffectSet id="ChargeImpact"><EffectArray value="ChargeDamage" /><EffectArray value="ChargeStop" /></CEffectSet>
    <CEffectDamage id="ChargeDamage" parent="StormSpell"><Amount value="119" /></CEffectDamage>
    <CEffectRemoveBehavior id="ChargeStop"><BehaviorLink value="Charging" /></CEffectRemoveBehavior>
    <CEffectApplyBehavior id="FinishApply"><Behavior value="Finishing" /></CEffectApplyBehavior>
    <CBehaviorBuff id="Finishing"><Duration value="0.5" /><Period value="0.0625" /><PeriodicEffect value="ChargeScan" /></CBehaviorBuff>
    <CEffectRemoveBehavior id="ChargeCleanup"><BehaviorLink value="Finishing" /></CEffectRemoveBehavior>
  `;
  assert.deepEqual(ticks(xml, "Charge"), []);
});

const LOCKOUT = (limit: string) => `
  <CAbilEffectInstant id="VolleyCast"><Effect value="VolleyApply" /></CAbilEffectInstant>
  <CEffectApplyBehavior id="VolleyApply"><Behavior value="Volley" /></CEffectApplyBehavior>
  <CBehaviorBuff id="Volley"><Duration value="4" /><Period value="0.125" /><PeriodicEffect value="VolleyShot" /></CBehaviorBuff>
  <CEffectSet id="VolleyShot">
    <ValidatorArray value="NoVolleyLimiter" />
    <EffectArray value="VolleyDamage" />
    <EffectArray value="VolleyLimiterApply" />
  </CEffectSet>
  <CValidatorUnitCompareBehaviorCount id="NoVolleyLimiter"><Behavior value="VolleyLimiter" /></CValidatorUnitCompareBehaviorCount>
  <CEffectApplyBehavior id="VolleyLimiterApply"><Behavior value="VolleyLimiter" /></CEffectApplyBehavior>
  <CBehaviorBuff id="VolleyLimiter"><Duration value="${limit}" /></CBehaviorBuff>
  <CEffectDamage id="VolleyDamage" parent="StormSpell"><Amount value="70" /></CEffectDamage>
`;

test("a lockout behavior the hit applies spaces the hits", () => {
  assert.deepEqual(ticks(LOCKOUT("0.3125"), "VolleyCast").map(brief), ["70 damage @0.375 x11 from 0.125"]);
});

test("behind a search, a lockout on the target does not space the hits", () => {
  const xml = LOCKOUT("0.3125")
    .replace('<PeriodicEffect value="VolleyShot" />', '<PeriodicEffect value="VolleySearch" />')
    .concat('<CEffectEnumArea id="VolleySearch"><AreaArray Effect="VolleyShot"><Radius value="10" /></AreaArray><MaxCount value="1" /></CEffectEnumArea>');
  assert.deepEqual(ticks(xml, "VolleyCast").map(brief), ["70 damage @0.125 x32 from 0.125"]);
});

test("a lockout that outlasts the source leaves one hit, so it is not a tick", () => {
  assert.deepEqual(ticks(LOCKOUT("5"), "VolleyCast"), []);
});

const DEAD = (grant: string) => `
  <CAbilEffectInstant id="BurnCast"><Effect value="BurnApply" /></CAbilEffectInstant>
  <CEffectApplyBehavior id="BurnApply"><Behavior value="Burn" /></CEffectApplyBehavior>
  <CBehaviorBuff id="Burn"><Duration value="3" /><Period value="1" /><PeriodicEffect value="BurnSwitch" /></CBehaviorBuff>
  <CEffectSwitch id="BurnSwitch">
    <CaseArray Validator="HasHotter" Effect="BurnHotDamage" />
    <CaseDefault value="BurnDamage" />
  </CEffectSwitch>
  <CEffectDamage id="BurnDamage" parent="StormSpell"><Amount value="10" /></CEffectDamage>
  <CEffectDamage id="BurnHotDamage" parent="StormSpell"><Amount value="20" /></CEffectDamage>
  <CValidatorUnitCompareBehaviorCount id="HasHotter"><Value value="1" /><Behavior value="Hotter" /></CValidatorUnitCompareBehaviorCount>
  <CBehaviorBuff id="Hotter" />
  ${grant}
`;

test("a gate on a behavior only granted by unused apply effects is dead", () => {
  const orphan = `<CEffectApplyBehavior id="HotterApply"><Behavior value="Hotter" /></CEffectApplyBehavior>`;
  assert.deepEqual(ticks(DEAD(orphan), "BurnCast").map(brief), ["10 damage @1 x3 from 1"]);
});

test("a gate on a behavior a talent grants directly stays", () => {
  const talent = `<CTalent id="HotterTalent"><BehaviorArray value="Hotter" /></CTalent>`;
  assert.deepEqual(ticks(DEAD(talent), "BurnCast").map(brief).sort(), ["10 damage @1 x3 from 1", "20 damage @1 x3 from 1"]);
});

test("a behavior above the source that does not stop it is no limit", () => {
  const xml = DISINTEGRATE.replace('<FinalEffect value="BeamActiveRemove" />', "");
  assert.deepEqual(ticks(xml, "Beam").find((t) => t.amount === 12)!.count, 161);
});

test("different search effects that each fire once are one sweep, not a tick", () => {
  const xml = `
    <CAbilEffectInstant id="Sweep"><Effect value="SweepPersistent" /></CAbilEffectInstant>
    <CEffectCreatePersistent id="SweepPersistent">
      <PeriodCount value="3" />
      <PeriodicEffectArray value="SweepArea1" /><PeriodicEffectArray value="SweepArea2" /><PeriodicEffectArray value="SweepArea3" />
      <PeriodicPeriodArray value="0.0625" />
    </CEffectCreatePersistent>
    <CEffectEnumArea id="SweepArea1"><AreaArray Effect="SweepDamage"><Radius value="1" /></AreaArray></CEffectEnumArea>
    <CEffectEnumArea id="SweepArea2"><AreaArray Effect="SweepDamage"><Radius value="2" /></AreaArray></CEffectEnumArea>
    <CEffectEnumArea id="SweepArea3"><AreaArray Effect="SweepDamage"><Radius value="3" /></AreaArray></CEffectEnumArea>
    <CEffectDamage id="SweepDamage" parent="StormSpell"><Amount value="30" /></CEffectDamage>
  `;
  assert.deepEqual(ticks(xml, "Sweep"), []);
});

test("periods aimed at different offsets are not a repeated hit", () => {
  const xml = `
    <CAbilEffectInstant id="Axe"><Effect value="AxePersistent" /></CAbilEffectInstant>
    <CEffectCreatePersistent id="AxePersistent">
      <PeriodCount value="2" />
      <PeriodicEffectArray value="AxeDamage" />
      <PeriodicOffsetArray Y="-10" /><PeriodicOffsetArray Y="-5" />
      <PeriodicPeriodArray value="0.625" />
    </CEffectCreatePersistent>
    <CEffectDamage id="AxeDamage" parent="StormSpell"><Amount value="100" /></CEffectDamage>
  `;
  assert.deepEqual(ticks(xml, "Axe"), []);
});

test("a hit gated on stacks the same chain adds is a counter, not a tick", () => {
  const xml = `
    <CAbilEffectInstant id="Nova"><Effect value="NovaApply" /></CAbilEffectInstant>
    <CEffectApplyBehavior id="NovaApply"><Behavior value="NovaPulse" /></CEffectApplyBehavior>
    <CBehaviorBuff id="NovaPulse"><Duration value="3" /><Period value="0.25" /><PeriodicEffect value="NovaSet" /></CBehaviorBuff>
    <CEffectSet id="NovaSet"><EffectArray value="NovaDamage" /><EffectArray value="NovaSparkSwitch" /></CEffectSet>
    <CEffectDamage id="NovaDamage" parent="StormSpell"><Amount value="43" /></CEffectDamage>
    <CEffectSwitch id="NovaSparkSwitch">
      <CaseArray Validator="HasTwoSparks" Effect="NovaSparkDamage" />
      <CaseDefault value="NovaSparkApply" />
    </CEffectSwitch>
    <CValidatorUnitCompareBehaviorCount id="HasTwoSparks"><Compare value="GE" /><Value value="2" /><Behavior value="NovaSpark" /></CValidatorUnitCompareBehaviorCount>
    <CEffectApplyBehavior id="NovaSparkApply"><Behavior value="NovaSpark" /></CEffectApplyBehavior>
    <CBehaviorBuff id="NovaSpark"><Duration value="5" /></CBehaviorBuff>
    <CEffectDamage id="NovaSparkDamage" parent="StormSpell"><Amount value="65" /></CEffectDamage>
  `;
  assert.deepEqual(ticks(xml, "Nova").map(brief), ["43 damage @0.25 x12 from 0.25"]);
});

const VOLLEY = (dotId: string) => `
  <CAbilEffectTarget id="Dash"><Effect value="DashSet" /></CAbilEffectTarget>
  <CEffectSet id="DashSet"><EffectArray value="DashCasterApply" /><EffectArray value="DashVolley" /></CEffectSet>
  <CEffectApplyBehavior id="DashCasterApply"><WhichUnit Value="Caster" /><Behavior value="DashCaster" /></CEffectApplyBehavior>
  <CBehaviorBuff id="DashCaster"><Duration value="1" /></CBehaviorBuff>
  <CEffectCreatePersistent id="DashVolley">
    <InitialDelay value="0.1875" />
    <PeriodCount value="12" />
    ${'<PeriodicEffectArray value="DashHit" /><PeriodicEffectArray value="" />'.repeat(5)}<PeriodicEffectArray value="DashHit" />
    <PeriodicPeriodArray value="0.125" />${'<PeriodicPeriodArray value="0.0625" />'.repeat(10)}
  </CEffectCreatePersistent>
  <CEffectDamage id="DashHit" parent="StormSpell">
    <Amount value="64" />
    <MultiplicativeModifierArray index="Volley" Validator="HasReducer" Modifier="-0.55" />
  </CEffectDamage>
  <CValidatorUnitCompareBehaviorCount id="HasReducer"><WhichUnit Value="Caster" /><Value value="1" /><Behavior value="${dotId}" /></CValidatorUnitCompareBehaviorCount>
`;

test("a damage modifier tied to a behavior the cast applies holds only while it lasts", () => {
  assert.deepEqual(ticks(VOLLEY("DashCaster"), "Dash").map(brief), ["28.8 reduced damage @0.125 x6 from 0.3125"]);
});

test("a damage modifier tied to the source itself holds for every hit", () => {
  const xml = `
    <CAbilEffectTarget id="Rend"><Effect value="RendApply" /></CAbilEffectTarget>
    <CEffectApplyBehavior id="RendApply"><Behavior value="RendDoT" /></CEffectApplyBehavior>
    <CBehaviorBuff id="RendDoT"><Duration value="3" /><Period value="1" /><PeriodicEffect value="RendDamage" /></CBehaviorBuff>
    <CEffectDamage id="RendDamage" parent="StormSpell">
      <Amount value="20" />
      <MultiplicativeModifierArray index="Self" Validator="HasRend" Modifier="0.5" />
    </CEffectDamage>
    <CValidatorUnitCompareBehaviorCount id="HasRend"><Value value="1" /><Behavior value="RendDoT" /></CValidatorUnitCompareBehaviorCount>
  `;
  assert.deepEqual(ticks(xml, "Rend").map(brief), ["30 increased damage @1 x3 from 1"]);
});

test("a gated copy of a source that runs the same effect on the same schedule is the same tick", () => {
  const xml = `
    <CAbilEffectTarget id="Rend"><Effect value="RendSwitch" /></CAbilEffectTarget>
    <CEffectSwitch id="RendSwitch">
      <CaseArray Validator="HasBig" Effect="RendBigApply" />
      <CaseDefault value="RendApply" />
    </CEffectSwitch>
    <CEffectApplyBehavior id="RendApply"><Behavior value="RendDoT" /></CEffectApplyBehavior>
    <CEffectApplyBehavior id="RendBigApply"><Behavior value="RendBigDoT" /></CEffectApplyBehavior>
    <CBehaviorBuff id="RendDoT"><Duration value="3" /><Period value="1" /><PeriodicEffect value="RendDamage" /></CBehaviorBuff>
    <CBehaviorBuff id="RendBigDoT"><Duration value="3" /><Period value="1" /><PeriodicEffect value="RendDamage" /></CBehaviorBuff>
    <CEffectDamage id="RendDamage" parent="StormSpell">
      <Amount value="20" />
      <MultiplicativeModifierArray index="Big" Validator="HasBigDoT" Modifier="0.5" />
    </CEffectDamage>
    <CValidatorUnitCompareBehaviorCount id="HasBigDoT"><Value value="1" /><Behavior value="RendBigDoT" /></CValidatorUnitCompareBehaviorCount>
    <CValidatorPlayerTalent id="HasBig"><Find value="1" /><Value value="BigTalent" /></CValidatorPlayerTalent>
  `;
  assert.deepEqual(ticks(xml, "Rend").map(brief), ["20 damage @1 x3 from 1"]);
});

test("a talent that extends the lifetime on hit drops the count of ticks that need it, not of the base tick", () => {
  const xml = `
    <CAbilEffectInstant id="BarrageCast"><Effect value="BarrageApply" /></CAbilEffectInstant>
    <CEffectApplyBehavior id="BarrageApply"><Behavior value="Barrage" /></CEffectApplyBehavior>
    <CBehaviorBuff id="Barrage"><Duration value="4" /><Period value="0.5" /><PeriodicEffect value="BarrageSet" /></CBehaviorBuff>
    <CEffectSet id="BarrageSet">
      <EffectArray value="BarrageDamage" />
      <EffectArray value="BarrageBoltDamage" />
      <EffectArray value="BarrageExtend" />
    </CEffectSet>
    <CEffectDamage id="BarrageDamage" parent="StormSpell"><Amount value="70" /></CEffectDamage>
    <CEffectDamage id="BarrageBoltDamage" parent="StormSpell"><ValidatorArray value="HasSiphon" /><Amount value="34" /></CEffectDamage>
    <CEffectModifyBehaviorBuffDuration id="BarrageExtend">
      <ValidatorArray value="HasSiphon" /><Behavior value="Barrage" /><Value value="0.125" />
    </CEffectModifyBehaviorBuffDuration>
    <CValidatorPlayerTalent id="HasSiphon"><Find value="1" /><Value value="SiphonTalent" /></CValidatorPlayerTalent>
    <CTalent id="SiphonTalent" />
  `;
  assert.deepEqual(ticks(xml, "BarrageCast").map(brief).sort(), ["34 damage @0.5 xnull from 0.5", "70 damage @0.5 x8 from 0.5"]);
});

const BREATH = (search: string) => `
  <CAbilEffectInstant id="Breath"><Effect value="BreathApplyController" /></CAbilEffectInstant>
  <CEffectApplyBehavior id="BreathApplyController"><WhichUnit Value="Caster" /><Behavior value="BreathController" /></CEffectApplyBehavior>
  <CBehaviorBuff id="BreathController">
    <Duration value="4" />
    <InitialEffect value="BreathApplyActive" />
    <FinalEffect value="BreathRemoveActive" />
  </CBehaviorBuff>
  <CEffectApplyBehavior id="BreathApplyActive"><WhichUnit Value="Caster" /><Behavior value="BreathActive" /></CEffectApplyBehavior>
  <CEffectRemoveBehavior id="BreathRemoveActive"><WhichUnit Value="Caster" /><BehaviorLink value="BreathActive" /></CEffectRemoveBehavior>
  <CBehaviorBuff id="BreathActive">
    <Duration value="12" />
    <Period value="0.1875" />
    <InitialEffect value="BreathSearch" />
    <PeriodicEffect value="BreathSearch" />
  </CBehaviorBuff>
  ${search}
  <CEffectApplyBehavior id="BreathApplyTarget"><Behavior value="BreathTarget" /></CEffectApplyBehavior>
  <CBehaviorBuff id="BreathTarget">
    <Duration value="0.4375" />
    <Period value="0.2812" />
    <InitialEffect value="BreathDamage" />
    <PeriodicEffect value="BreathDamage" />
  </CBehaviorBuff>
  <CEffectDamage id="BreathDamage" parent="StormSpell"><Amount value="50" /></CEffectDamage>
`;

test("a behavior its ticker reapplies before expiry lasts until the last reapply plus its duration", () => {
  const search = `<CEffectEnumArea id="BreathSearch"><AreaArray Effect="BreathApplyTarget"><Radius value="3" /></AreaArray></CEffectEnumArea>`;
  const out = ticks(BREATH(search), "Breath");
  assert.deepEqual(out.map(brief), ["50 damage @0.2812 x16 from 0"]);
  assert.equal((out[0] as unknown as { refreshed: boolean }).refreshed, true);
});

test("a reapply behind a lockout does not refresh the behavior", () => {
  const search = `
    <CEffectEnumArea id="BreathSearch"><ValidatorArray value="NoCooldown" /><AreaArray Effect="BreathImpact"><Radius value="3" /></AreaArray></CEffectEnumArea>
    <CEffectSet id="BreathImpact"><EffectArray value="BreathApplyTarget" /><EffectArray value="BreathApplyCooldown" /></CEffectSet>
    <CEffectApplyBehavior id="BreathApplyCooldown"><WhichUnit Value="Caster" /><Behavior value="BreathCooldown" /></CEffectApplyBehavior>
    <CBehaviorBuff id="BreathCooldown"><Duration value="2" /></CBehaviorBuff>
    <CValidatorUnitCompareBehaviorCount id="NoCooldown"><WhichUnit Value="Caster" /><Behavior value="BreathCooldown" /></CValidatorUnitCompareBehaviorCount>
  `;
  assert.deepEqual(ticks(BREATH(search), "Breath").map(brief), ["50 damage @0.2812 x2 from 0"]);
});

test("a switch case that picks by target type names the target kind", () => {
  const xml = `
    <CAbilEffectInstant id="Barbs"><Effect value="BarbsSwitch" /></CAbilEffectInstant>
    <CEffectSwitch id="BarbsSwitch">
      <CaseArray Validator="IsStructure" Effect="BarbsStructureApply" />
      <CaseDefault value="BarbsApply" />
    </CEffectSwitch>
    <CValidatorUnitFilters id="IsStructure"><Filters value="Structure;-" /></CValidatorUnitFilters>
    <CEffectApplyBehavior id="BarbsApply"><Behavior value="BarbsDot" /></CEffectApplyBehavior>
    <CEffectApplyBehavior id="BarbsStructureApply"><Behavior value="BarbsStructureDot" /></CEffectApplyBehavior>
    <CBehaviorBuff id="BarbsDot"><Duration value="3" /><Period value="1" /><PeriodicEffect value="BarbsDamage" /></CBehaviorBuff>
    <CBehaviorBuff id="BarbsStructureDot"><Duration value="2" /><Period value="1" /><PeriodicEffect value="BarbsDamage" /></CBehaviorBuff>
    <CEffectDamage id="BarbsDamage" parent="StormSpell"><Amount value="21" /></CEffectDamage>
  `;
  assert.deepEqual(ticks(xml, "Barbs").map(brief).sort(), ["21 damage (structures) @1 x2 from 1", "21 damage @1 x3 from 1"]);
});

test("an ability that shares an effect's id is not run, and a case for bosses is not the normal hit", () => {
  const xml = `
    <CAbilEffectInstant id="Strike"><Effect value="StrikeStart" /></CAbilEffectInstant>
    <CEffectSet id="StrikeStart"><EffectArray value="StrikeGuardApply" /><EffectArray value="StrikePersistent" /></CEffectSet>
    <CEffectApplyBehavior id="StrikeGuardApply"><WhichUnit Value="Caster" /><Behavior value="StrikeGuard" /></CEffectApplyBehavior>
    <CBehaviorBuff id="StrikeGuard" parent="StormStun"><Duration value="2" /></CBehaviorBuff>
    <CEffectCreatePersistent id="StrikePersistent">
      <PeriodCount value="3" /><PeriodicEffectArray value="StrikeHit" /><PeriodicPeriodArray value="0.25" />
    </CEffectCreatePersistent>
    <CEffectSet id="StrikeHit"><EffectArray value="Strike" /><EffectArray value="StrikeSwitch" /></CEffectSet>
    <CEffectApplyBehavior id="Strike"><WhichUnit Value="Caster" /><Behavior value="StrikeActive" /></CEffectApplyBehavior>
    <CBehaviorBuff id="StrikeActive" />
    <CEffectSwitch id="StrikeSwitch"><CaseArray Validator="IsBoss" Effect="StrikeFlat" /><CaseDefault value="StrikeDamage" /></CEffectSwitch>
    <CValidatorUnitType id="IsBoss"><Value value="Boss" /></CValidatorUnitType>
    <CEffectDamage id="StrikeFlat" parent="StormSpell"><Amount value="256" /></CEffectDamage>
    <CEffectDamage id="StrikeDamage" parent="StormSpell"><Amount value="70" /></CEffectDamage>
  `;
  assert.deepEqual(ticks(xml, "Strike").map(brief), ["70 damage @0.25 x3 from 0.25"]);
});

test("a status an area renews before it ends holds while in the area", () => {
  const xml = `
    <CAbilEffectInstant id="Puddle"><Effect value="PuddlePersistent" /></CAbilEffectInstant>
    <CEffectCreatePersistent id="PuddlePersistent">
      <PeriodCount value="4" /><PeriodicEffectArray value="PuddleSearch" /><PeriodicPeriodArray value="0.125" />
    </CEffectCreatePersistent>
    <CEffectEnumArea id="PuddleSearch"><AreaArray Effect="PuddleSlowApply"><Radius value="1.5" /></AreaArray></CEffectEnumArea>
    <CEffectApplyBehavior id="PuddleSlowApply"><Behavior value="PuddleSlow" /></CEffectApplyBehavior>
    <CBehaviorBuff id="PuddleSlow" parent="StormSlowParent"><Duration value="0.1875" /></CBehaviorBuff>
  `;
  const [tick] = ticks(xml, "Puddle");
  assert.equal(tick.lasts, 0.1875);
  assert.equal(tickNote({ ...tick, source: "PuddlePersistent" }).label, "Slow holds while in the area, lingers 0.1875s after leaving");
});

test("a status with no length of its own lasts as long as the timed marker it needs", () => {
  const xml = `
    <CAbilEffectInstant id="Calm"><Effect value="CalmPersistent" /></CAbilEffectInstant>
    <CEffectCreatePersistent id="CalmPersistent">
      <PeriodCount value="4" /><PeriodicEffectArray value="CalmSearch" /><PeriodicPeriodArray value="0.5" />
    </CEffectCreatePersistent>
    <CEffectEnumArea id="CalmSearch"><AreaArray Effect="CalmSet"><Radius value="6.5" /></AreaArray></CEffectEnumArea>
    <CEffectSet id="CalmSet"><EffectArray value="CalmMarkerApply" /><EffectArray value="CalmArmorApply" /></CEffectSet>
    <CEffectApplyBehavior id="CalmMarkerApply"><Behavior value="CalmMarker" /></CEffectApplyBehavior>
    <CBehaviorBuff id="CalmMarker"><Duration value="0.5" /></CBehaviorBuff>
    <CEffectApplyBehavior id="CalmArmorApply"><Behavior value="CalmArmor" /></CEffectApplyBehavior>
    <CBehaviorBuff id="CalmArmor" parent="StormArmor">
      <RemoveValidatorArray value="HasCalmMarker" />
      <ArmorModification><AllArmorBonus value="10" /></ArmorModification>
    </CBehaviorBuff>
    <CValidatorUnitCompareBehaviorCount id="HasCalmMarker"><Value value="1" /><Behavior value="CalmMarker" /></CValidatorUnitCompareBehaviorCount>
  `;
  const [tick] = ticks(xml, "Calm");
  assert.equal(tickNote({ ...tick, source: "CalmPersistent" }).label, "+10 armor holds while in the area, lingers 0.5s after leaving");
});
