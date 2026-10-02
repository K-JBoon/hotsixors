import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const XML = `<Catalog>
  <CAbilEffectTarget id="Strike"><Effect value="StrikeSwitch" /></CAbilEffectTarget>
  <CEffectSwitch id="StrikeSwitch">
    <CaseArray Validator="CasterHasEmpowered" Effect="StrikeEmpoweredSearch" />
    <CaseArray Validator="HasBigStrike" Effect="StrikeBigSearch" />
    <CaseArray Validator="HasHeavyStrike" Effect="StrikeHeavySearch" />
    <CaseArray Validator="TargetMarked" Effect="StrikeMarkedSearch" />
    <CaseDefault value="StrikeSearch" />
  </CEffectSwitch>
  <CEffectEnumArea id="StrikeSearch"><AreaArray Effect="StrikeDamage"><Radius value="2" /></AreaArray></CEffectEnumArea>
  <CEffectEnumArea id="StrikeEmpoweredSearch"><AreaArray Effect="StrikeDamage"><Radius value="3" /></AreaArray></CEffectEnumArea>
  <CEffectEnumArea id="StrikeBigSearch"><AreaArray Effect="StrikeDamage"><Radius value="4" /></AreaArray></CEffectEnumArea>
  <CEffectEnumArea id="StrikeHeavySearch"><AreaArray Effect="StrikeDamage"><Radius value="2" /></AreaArray></CEffectEnumArea>
  <CEffectEnumArea id="StrikeMarkedSearch"><AreaArray Effect="StrikeDamage"><Radius value="5" /></AreaArray></CEffectEnumArea>
  <CEffectDamage id="StrikeDamage" parent="StormDamage" />
  <CEffectDamage id="StormDamage" />
  <CValidatorUnitCompareBehaviorCount id="CasterHasEmpowered">
    <WhichUnit Value="Caster" /><Compare value="GE" /><Value value="1" /><Behavior value="Empowered" />
  </CValidatorUnitCompareBehaviorCount>
  <CValidatorPlayerTalent id="HasBigStrike"><Find value="1" /><Value value="BigStrikeTalent" /></CValidatorPlayerTalent>
  <CTalent id="BigStrikeTalent" />
  <CValidatorPlayerTalent id="HasHeavyStrike"><Find value="1" /><Value value="HeavyStrikeTalent" /></CValidatorPlayerTalent>
  <CTalent id="HeavyStrikeTalent" />
  <CValidatorUnitCompareBehaviorCount id="TargetMarked"><Compare value="GT" /><Behavior value="Marked" /></CValidatorUnitCompareBehaviorCount>
  <CAbilEffectTarget id="Mark"><Effect value="MarkApply" /></CAbilEffectTarget>
  <CEffectApplyBehavior id="MarkApply"><Behavior value="Marked" /></CEffectApplyBehavior>
  <CBehaviorBuff id="Marked" />
  <CAbilEffectInstant id="Empower"><Effect value="EmpowerApply" /></CAbilEffectInstant>
  <CEffectApplyBehavior id="EmpowerApply"><Behavior value="Empowered" /></CEffectApplyBehavior>
  <CBehaviorBuff id="Empowered" />
</Catalog>`;

function placed() {
  const script = `
    import { buildEffectGraph } from "./scripts/lib/effect-graph/index.ts";
    import { buildReverseRefs } from "./scripts/lib/effect-graph/walk.ts";
    import { abilityGeometry } from "./scripts/lib/ability-geometry.ts";
    import { assignAreas } from "./scripts/lib/area-owners.ts";
    const graph = buildEffectGraph([{ path: "x.xml", content: ${JSON.stringify(XML)} }]);
    const { areas, ...stats } = abilityGeometry(graph, "Strike");
    const entry = (nameId, name, s = null) => ({ nameId, name, icon: "", stats: s });
    const hero = {
      slug: "x",
      name: "X",
      abilities: [entry("Strike", "Strike", stats), entry("Empower", "Empower"), entry("Mark", "Mark")],
      talents: [entry("BigStrikeTalent", "Big Strike"), entry("HeavyStrikeTalent", "Heavy Strike")],
    };
    const out = assignAreas(graph, buildReverseRefs(graph), hero, new Map([["Strike", areas]]));
    process.stdout.write(JSON.stringify({ radius: stats.radius, placed: Object.fromEntries(out) }));
  `;
  const out = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" },
  );
  return JSON.parse(out);
}

test("state-gated variants stay on the ability with the state as prefix, talent variants move", () => {
  const { radius, placed: p } = placed();
  assert.equal(radius, 2);
  assert.deepEqual(p.Strike.map((a) => [a.label, a.radius]), [["Empower: damage area", 3], ["On Mark target: damage area", 5]]);
  assert.deepEqual(p.BigStrikeTalent.map((a) => [a.label, a.radius]), [["Damage area", 4]]);
});

test("talent variants that keep the ability's size are dropped", () => {
  assert.equal(placed().placed.HeavyStrikeTalent, undefined);
});
