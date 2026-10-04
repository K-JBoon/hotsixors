import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const XML = `<Catalog>
  <CEffectDamage id="StormDamage" />
  <CBehaviorBuff id="StormStun" />
  <CAbilEffectInstant id="Pulse"><Effect value="PulseApply" /></CAbilEffectInstant>
  <CEffectApplyBehavior id="PulseApply"><Behavior value="PulseAura" /></CEffectApplyBehavior>
  <CBehaviorBuff id="PulseAura">
    <Duration value="4" />
    <Period value="1" />
    <PeriodicEffect value="PulseSwitch" />
  </CBehaviorBuff>
  <CEffectSwitch id="PulseSwitch">
    <CaseArray Validator="HasBigPulse" Effect="PulseBigDamage" />
    <CaseArray Validator="HasSamePulse" Effect="PulseSameDamage" />
    <CaseArray Validator="CasterHasEmpowered" Effect="PulseEmpoweredDamage" />
    <CaseArray Validator="HasGonePulse" Effect="PulseGoneDamage" />
    <CaseDefault value="PulseSet" />
  </CEffectSwitch>
  <CEffectSet id="PulseSet"><EffectArray value="PulseDamage" /><EffectArray value="PulseStunApply" /><EffectArray value="PulseOrphanStunApply" /></CEffectSet>
  <CEffectDamage id="PulseDamage" parent="StormDamage"><Amount value="10" /></CEffectDamage>
  <CEffectDamage id="PulseBigDamage" parent="StormDamage"><Amount value="20" /></CEffectDamage>
  <CEffectDamage id="PulseSameDamage" parent="StormDamage"><Amount value="10" /></CEffectDamage>
  <CEffectDamage id="PulseEmpoweredDamage" parent="StormDamage"><Amount value="15" /></CEffectDamage>
  <CEffectDamage id="PulseGoneDamage" parent="StormDamage"><ValidatorArray value="CasterHasEmpowered" /><Amount value="30" /></CEffectDamage>
  <CEffectApplyBehavior id="PulseStunApply"><Chance value="0" /><Behavior value="PulseStun" /></CEffectApplyBehavior>
  <CEffectApplyBehavior id="PulseOrphanStunApply"><Chance value="0" /><Behavior value="PulseOrphanStun" /></CEffectApplyBehavior>
  <CBehaviorBuff id="PulseStun" parent="StormStun"><Duration value="0.5" /></CBehaviorBuff>
  <CBehaviorBuff id="PulseOrphanStun" parent="StormStun"><Duration value="0.25" /></CBehaviorBuff>
  <CValidatorPlayerTalent id="HasBigPulse"><Find value="1" /><Value value="BigPulseTalent" /></CValidatorPlayerTalent>
  <CValidatorPlayerTalent id="HasSamePulse"><Find value="1" /><Value value="SamePulseTalent" /></CValidatorPlayerTalent>
  <CValidatorPlayerTalent id="HasGonePulse"><Find value="1" /><Value value="GonePulseTalent" /></CValidatorPlayerTalent>
  <CTalent id="BigPulseTalent" />
  <CTalent id="GonePulseTalent" />
  <CTalent id="SamePulseTalent" />
  <CTalent id="StunPulseTalent">
    <AbilityModificationArray>
      <Modifications>
        <Catalog value="Effect" />
        <Entry value="PulseStunApply" />
        <Field value="Chance" />
        <Value value="1" />
      </Modifications>
    </AbilityModificationArray>
  </CTalent>
  <CValidatorUnitCompareBehaviorCount id="CasterHasEmpowered">
    <WhichUnit Value="Caster" /><Compare value="GE" /><Value value="1" /><Behavior value="Empowered" />
  </CValidatorUnitCompareBehaviorCount>
  <CAbilEffectInstant id="Empower"><Effect value="EmpowerApply" /></CAbilEffectInstant>
  <CEffectApplyBehavior id="EmpowerApply"><Behavior value="Empowered" /></CEffectApplyBehavior>
  <CBehaviorBuff id="Empowered" />
  <CAbilEffectInstant id="Rend"><Effect value="RendSet" /></CAbilEffectInstant>
  <CEffectSet id="RendSet"><EffectArray value="RendMarkSet" /><EffectArray value="RendSwitch" /></CEffectSet>
  <CEffectSet id="RendMarkSet"><ValidatorArray value="HasCenter" /><EffectArray value="RendMarkApply" /></CEffectSet>
  <CEffectApplyBehavior id="RendMarkApply"><Behavior value="RendCenterMarker" /></CEffectApplyBehavior>
  <CBehaviorBuff id="RendCenterMarker"><Duration value="0.5" /></CBehaviorBuff>
  <CEffectSwitch id="RendSwitch">
    <ValidatorArray value="HasRend" />
    <CaseArray Validator="HasRendCenterMarker" Effect="RendCenterDotApply" />
    <CaseDefault value="RendDotApply" />
  </CEffectSwitch>
  <CEffectApplyBehavior id="RendDotApply"><Behavior value="RendTalentDot" /></CEffectApplyBehavior>
  <CEffectApplyBehavior id="RendCenterDotApply"><Behavior value="RendTalentCenterTalentDot" /></CEffectApplyBehavior>
  <CBehaviorBuff id="RendTalentDot"><Duration value="3" /><Period value="1" /><PeriodicEffect value="RendDamage" /></CBehaviorBuff>
  <CBehaviorBuff id="RendTalentCenterTalentDot"><Duration value="3" /><Period value="1" /><PeriodicEffect value="RendCenterDamage" /></CBehaviorBuff>
  <CEffectDamage id="RendDamage" parent="StormDamage"><Amount value="10" /></CEffectDamage>
  <CEffectDamage id="RendCenterDamage" parent="StormDamage"><Amount value="14" /></CEffectDamage>
  <CValidatorUnitCompareBehaviorCount id="HasRendCenterMarker">
    <Compare value="GE" /><Value value="1" /><Behavior value="RendCenterMarker" />
  </CValidatorUnitCompareBehaviorCount>
  <CValidatorPlayerTalent id="HasRend"><Find value="1" /><Value value="RendTalent" /></CValidatorPlayerTalent>
  <CValidatorPlayerTalent id="HasCenter"><Find value="1" /><Value value="CenterTalent" /></CValidatorPlayerTalent>
  <CTalent id="RendTalent" />
  <CTalent id="CenterTalent" />
</Catalog>`;

function placed(centerTier = "level16") {
  const script = `
    import { buildEffectGraph } from "./scripts/lib/effect-graph/index.ts";
    import { buildReverseRefs } from "./scripts/lib/effect-graph/walk.ts";
    import { abilityTicks } from "./scripts/lib/ability-ticks.ts";
    import { assignTicks } from "./scripts/lib/area-owners.ts";
    const graph = buildEffectGraph([{ path: "x.xml", content: ${JSON.stringify(XML)} }]);
    const entry = (nameId, name, tier) => ({ nameId, name, icon: "", tier, stats: null });
    const hero = {
      slug: "x",
      name: "X",
      abilities: [entry("Pulse", "Pulse"), entry("Empower", "Empower"), entry("Rend", "Rend")],
      talents: [
        entry("BigPulseTalent", "Big Pulse"),
        entry("SamePulseTalent", "Same Pulse"),
        entry("StunPulseTalent", "Stun Pulse"),
        entry("RendTalent", "Rend Talent", "level4"),
        entry("CenterTalent", "Center", ${JSON.stringify(centerTier)}),
      ],
    };
    const found = new Map(["Pulse", "Rend"].map((id) => [id, abilityTicks(graph, id)]));
    const out = assignTicks(graph, buildReverseRefs(graph), hero, found);
    const shown = (t) => (t.amount === null ? t.label : \`\${t.label} \${t.amount}\`);
    process.stdout.write(JSON.stringify(Object.fromEntries([...out].map(([k, v]) => [k, v.map(shown)]))));
  `;
  const out = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" },
  );
  return JSON.parse(out) as Record<string, string[]>;
}

test("ungated and state-gated ticks stay on the ability, the state as prefix", () => {
  assert.deepEqual(placed().Pulse.sort(), ["Empower: damage 15", "damage 10"]);
});

test("a talent-gated tick moves to its talent", () => {
  assert.deepEqual(placed().BigPulseTalent, ["damage 20"]);
});

test("a talent variant equal to the base tick is dropped", () => {
  assert.equal(placed().SamePulseTalent, undefined);
});

test("a Chance 0 tick goes to the talent that enables it, or is dropped", () => {
  const out = placed();
  assert.deepEqual(out.StunPulseTalent, ["0.5s stun"]);
  assert.ok(!Object.values(out).flat().includes("0.25s stun"));
});

test("a tick gated on a talent the hero cannot pick is dropped, even with a state prefix", () => {
  assert.ok(!Object.values(placed()).flat().some((label) => label.endsWith(" 30")));
});

test("a tick that needs a second talent names it", () => {
  const out = placed();
  assert.deepEqual(out.RendTalent, ["damage (Center) 14", "damage 10"]);
  assert.deepEqual(out.CenterTalent, ["damage (Rend Talent) 14"]);
});

test("a tick that needs two talents of one tier is dropped", () => {
  const out = placed("level4");
  assert.deepEqual(out.RendTalent, ["damage 10"]);
  assert.equal(out.CenterTalent, undefined);
});
