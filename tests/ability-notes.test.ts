import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const XML = `<Catalog>
  <CTargetSortField id="TSHeroic"><Field value="Attributes[Heroic]" /><Value value="1" /></CTargetSortField>
  <CTargetSortDistance id="TSDistance" />
  <CTargetSortBehaviorCount id="TSEngaged"><Behavior value="JungleCreepPassive" /></CTargetSortBehaviorCount>
  <CTargetSortRandom id="TSRandom" />
  <CValidatorCombine default="1"><Type value="Or" /></CValidatorCombine>
  <CValidatorUnitCompareBehaviorCount default="1" id="CasterNotParent"><WhichUnit Value="Caster" /><Compare value="LE" /></CValidatorUnitCompareBehaviorCount>
  <CValidatorUnitCompareBehaviorCount default="1" id="CasterIsParent"><WhichUnit Value="Caster" /><Compare value="GT" /></CValidatorUnitCompareBehaviorCount>
  <CValidatorUnitCompareBehaviorCount id="CasterNotStunned" parent="CasterNotParent"><Categories index="Stun" value="1" /></CValidatorUnitCompareBehaviorCount>
  <CValidatorUnitCompareBehaviorCount id="CasterNotSilenced" parent="CasterNotParent"><Categories index="DebuffSilence" value="1" /></CValidatorUnitCompareBehaviorCount>
  <CValidatorUnitCompareBehaviorCount id="CasterNotStasis" parent="CasterNotParent"><Categories index="DebuffStasis" value="1" /></CValidatorUnitCompareBehaviorCount>
  <CValidatorUnitCompareBehaviorCount id="CasterIsTimeStopped" parent="CasterIsParent"><Categories index="TimeStop" value="1" /></CValidatorUnitCompareBehaviorCount>
  <CValidatorUnitFilters id="CasterNotDead"><WhichUnit Value="Caster" /><Filters value="-;Dead" /></CValidatorUnitFilters>
  <CValidatorCombine id="CasterNotDeadOrSilencedOrStunned">
    <Type value="And" />
    <CombineArray value="CasterNotStunned" /><CombineArray value="CasterNotDead" /><CombineArray value="CasterNotSilenced" />
  </CValidatorCombine>
  <CValidatorCombine id="CasterNotDeadOrSilencedOrStunnedExceptTimeStop">
    <CombineArray value="CasterNotDeadOrSilencedOrStunned" /><CombineArray value="CasterIsTimeStopped" />
  </CValidatorCombine>
  <CValidatorUnitCompareBehaviorCount id="NoLimiter"><Behavior value="Limiter" /></CValidatorUnitCompareBehaviorCount>
  <CValidatorPlayerTalent id="HasSiphon"><Find value="1" /><Value value="SiphonTalent" /></CValidatorPlayerTalent>
  <CTalent id="SiphonTalent" />

  <CAbilEffectInstant id="Barrage"><Effect value="BarrageApply" /></CAbilEffectInstant>
  <CAbilEffectInstant id="Arrow" />
  <CEffectApplyBehavior id="BarrageApply"><WhichUnit Value="Caster" /><Behavior value="BarrageBuff" /></CEffectApplyBehavior>
  <CBehaviorBuff id="BarrageBuff">
    <DisableValidatorArray value="CasterNotStasis" />
    <RemoveValidatorArray value="CasterNotDeadOrSilencedOrStunnedExceptTimeStop" />
    <Duration value="4" />
    <Period value="0.125" />
    <InitialEffect value="BarrageSearch" />
    <PeriodicEffect value="BarrageSearch" />
    <Modification>
      <AbilLinkDisableArray value="Barrage" />
      <AbilLinkDisableArray value="Arrow" />
      <AbilLinkDisableArray value="ArrowCancel" />
      <AbilLinkDisableArray value="FountainDrink" />
      <AbilLinkDisableArray value="Mount" />
      <AbilLinkDisableArray value="attack" />
      <AbilLinkDisableArray value="CaptureMacGuffin" />
      <AbilLinkDisableArray value="MapMechanicAbilityTarget" />
      <AbilLinkDisableArray value="UnknownThing" />
    </Modification>
  </CBehaviorBuff>
  <CAbilEffectInstant id="ArrowCancel" />
  <CEffectEnumArea id="BarrageSearch">
    <TargetSorts RequestCount="1"><SortArray value="TSHeroic" /><SortArray value="TSDistance" /><SortArray value="TSEngaged" /></TargetSorts>
    <AreaArray Effect="BarrageHit"><Radius value="10" /></AreaArray>
    <MaxCount value="1" />
  </CEffectEnumArea>
  <CEffectSet id="BarrageHit">
    <ValidatorArray value="NoLimiter" />
    <EffectArray value="BarrageDamage" />
    <EffectArray value="BarrageLimit" />
    <EffectArray value="SiphonSearch" />
    <EffectArray value="PartnerSearch" />
    <EffectArray value="SpiderSearch" />
  </CEffectSet>
  <CEffectEnumArea id="PartnerSearch">
    <SearchFilters value="-;Self,Ally,Neutral,Enemy" />
    <TargetSorts><SortArray value="TSDistance" /></TargetSorts>
    <AreaArray MaxCount="1" Effect="BarrageDamage"><Radius value="40" /></AreaArray>
  </CEffectEnumArea>
  <CEffectEnumArea id="SpiderSearch">
    <TargetSorts><SortArray value="TSHeroic" /></TargetSorts>
    <AreaArray MaxCount="3" Effect="SpiderSet"><Radius value="2" /></AreaArray>
  </CEffectEnumArea>
  <CEffectSet id="SpiderSet"><EffectArray value="SpiderSpawn" /><EffectArray value="SpiderOrder" /></CEffectSet>
  <CEffectCreateUnit id="SpiderSpawn"><SpawnUnit value="Spider" /></CEffectCreateUnit>
  <CEffectIssueOrder id="SpiderOrder" />
  <CEffectDamage id="BarrageDamage"><Amount value="70" /></CEffectDamage>
  <CEffectApplyBehavior id="BarrageLimit"><Behavior value="Limiter" /></CEffectApplyBehavior>
  <CBehaviorBuff id="Limiter"><Duration value="0.3125" /></CBehaviorBuff>
  <CEffectEnumArea id="SiphonSearch">
    <ValidatorArray value="HasSiphon" />
    <TargetSorts><SortArray value="TSRandom" /><SortArray value="TSHeroic" /></TargetSorts>
    <AreaArray Effect="BarrageDamage"><Radius value="6" /></AreaArray>
    <MaxCount value="2" />
  </CEffectEnumArea>

  <CValidatorUnitCompareBehaviorCount id="CasterNotRooted" parent="CasterNotParent"><Categories index="DebuffRoot" value="1" /></CValidatorUnitCompareBehaviorCount>
  <CValidatorUnitCompareBehaviorCount id="CasterNotFeared" parent="CasterNotParent"><Categories index="Fear" value="1" /></CValidatorUnitCompareBehaviorCount>
  <CValidatorUnitFilters id="CasterNotDazed"><WhichUnit Value="Caster" /><Filters value="-;Dazed" /></CValidatorUnitFilters>
  <CAbilEffectInstant id="Dash"><Effect value="DashSet" /></CAbilEffectInstant>
  <CEffectSet id="DashSet"><EffectArray value="DashApply" /><EffectArray value="DashGuardApply" /><EffectArray value="PuddleSearch" /></CEffectSet>
  <CEffectApplyBehavior id="DashApply"><WhichUnit Value="Caster" /><Behavior value="DashBuff" /></CEffectApplyBehavior>
  <CEffectApplyBehavior id="DashGuardApply"><WhichUnit Value="Caster" /><Behavior value="DashGuard" /></CEffectApplyBehavior>
  <CBehaviorBuff id="DashBuff">
    <RemoveValidatorArray value="CasterNotRooted" />
    <RemoveValidatorArray value="CasterNotDazed" />
    <Modification><MoveSpeedMaximum value="10" /></Modification>
  </CBehaviorBuff>
  <CBehaviorBuff id="DashGuard">
    <RemoveValidatorArray value="CasterNotFeared" />
    <Modification><MoveSpeedMaximum value="10" /></Modification>
  </CBehaviorBuff>
  <CEffectEnumArea id="PuddleSearch">
    <SearchFilters value="-;Enemy" />
    <AreaArray Effect="BarrageHit"><Radius value="3" /></AreaArray>
  </CEffectEnumArea>
</Catalog>`;

function run(body: string) {
  const script = `
    import { buildEffectGraph } from "./scripts/lib/effect-graph/index.ts";
    import { buildReverseRefs } from "./scripts/lib/effect-graph/walk.ts";
    import { abilityNotes } from "./scripts/lib/ability-notes.ts";
    import { assignNotes } from "./scripts/lib/area-owners.ts";
    const graph = buildEffectGraph([{ path: "x.xml", content: ${JSON.stringify(XML)} }]);
    const nameOf = (id) => ({ Arrow: "Hungering Arrow", ArrowCancel: "Cancel Hungering Arrow" })[id];
    ${body}
  `;
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf-8",
  });
  return JSON.parse(out);
}

function notes() {
  return run(`process.stdout.write(JSON.stringify(abilityNotes(graph, "Barrage", nameOf)));`) as {
    label: string;
    source: string;
    gates: string[];
  }[];
}

function labels() {
  return notes()
    .filter((n) => n.gates.length === 0)
    .map((n) => n.label);
}

test("a capped search names its sorts up to the first one it cannot name", () => {
  assert.ok(labels().includes("Hits 1 target, preferring Heroes, then the closest."));
});

test("a random first sort reads as random targets", () => {
  const siphon = notes().find((n) => n.source === "SiphonSearch");
  assert.deepEqual(siphon && { label: siphon.label, gates: siphon.gates }, { label: "Hits 2 random targets.", gates: ["HasSiphon"] });
});

test("a lockout behavior applied to the target limits each target", () => {
  assert.ok(labels().includes("Hits each target at most once per 0.3125s."));
});

test("disabled abilities group into verbs and uses, in table order; unknown ids, Cancel abilities and the casting ability dropped", () => {
  assert.ok(labels().includes("Cannot attack or Mount. Cannot use Hungering Arrow, Healing Fountains or objectives."));
});

test("a search that only finds the caster's own units gets no priority note", () => {
  assert.ok(!notes().some((n) => n.source === "PartnerSearch"));
});

test("a search that sends summons at its targets gets no priority note", () => {
  assert.ok(!notes().some((n) => n.source === "SpiderSearch"));
});

test("remove and disable validators read as end and pause conditions", () => {
  const out = labels();
  assert.ok(out.includes("Ends on death, stun or silence, except during Time Stop."));
  assert.ok(out.includes("Pauses during Stasis."));
});

test("end conditions merge over the caster buffs; an unnamed excluded filter reads as never on", () => {
  const out = run(`process.stdout.write(JSON.stringify(abilityNotes(graph, "Dash", nameOf)));`) as { label: string; source: string }[];
  assert.ok(out.some((n) => n.label === "Ends on root or fear." && n.source === "DashBuff"));
});

test("a lockout past a search for the caster's own units gets no note", () => {
  const out = run(`process.stdout.write(JSON.stringify(abilityNotes(graph, "Dash", nameOf)));`) as { label: string }[];
  assert.ok(!out.some((n) => n.label.startsWith("Hits each target")));
});

test("a talent-gated note goes to the talent card", () => {
  const out = run(`
    const entry = (nameId, name) => ({ nameId, name, icon: "", stats: null });
    const hero = { slug: "x", name: "X", abilities: [entry("Barrage", "Barrage")], talents: [entry("SiphonTalent", "Siphon")] };
    const found = new Map([["Barrage", abilityNotes(graph, "Barrage", nameOf)]]);
    const placed = assignNotes(graph, buildReverseRefs(graph), hero, found);
    process.stdout.write(JSON.stringify(Object.fromEntries([...placed].map(([k, v]) => [k, v.map((n) => n.label)]))));
  `) as Record<string, string[]>;
  assert.deepEqual(out.SiphonTalent, ["Hits 2 random targets."]);
  assert.ok(!out.Barrage.includes("Hits 2 random targets."));
});
