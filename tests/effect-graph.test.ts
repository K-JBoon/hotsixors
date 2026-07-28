import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function runGraph(files, body) {
  const script = `
    import * as G from "./scripts/lib/effect-graph.ts";
    const files = ${JSON.stringify(files)};
    const out = (() => { ${body} })();
    console.log(JSON.stringify(out));
  `;
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );
  return JSON.parse(output);
}

const STORM_XML = {
  path: "mods/heroesdata.stormmod/base.stormdata/gamedata/behaviordata.xml",
  content: `
    <Catalog>
      <CBehaviorBuff default="1" id="StormStunParent" />
      <CBehaviorBuff default="1" id="StormStun" parent="StormStunParent" />
      <CEffectApplyBehavior default="1" id="StormStunApply"><Behavior value="StormStun" /></CEffectApplyBehavior>
      <CEffectApplyBehavior default="1" id="StormSlowApply"><Behavior value="StormSlowParent" /></CEffectApplyBehavior>
      <CBehaviorBuff default="1" id="StormSlowParent" />
    </Catalog>`,
};

const HERO_XML = {
  path: "mods/heromods/diablo.stormmod/base.stormdata/gamedata/diablodata.xml",
  content: `
    <Catalog>
      <CAbilEffectTarget id="DiabloOverpower">
        <Effect value="DiabloOverpowerCastSet" />
      </CAbilEffectTarget>
      <CEffectSet id="DiabloOverpowerCastSet">
        <EffectArray value="DiabloOverpowerDamage" />
        <EffectArray value="DiabloOverpowerStunApply" />
      </CEffectSet>
      <CEffectDamage id="DiabloOverpowerDamage" />
      <CEffectApplyBehavior id="DiabloOverpowerStunApply" parent="StormStunApply">
        <Behavior value="DiabloOverpowerStun" />
      </CEffectApplyBehavior>
      <CBehaviorBuff id="DiabloOverpowerStun" parent="StormStun" />
      <CTalent id="DiabloDevilsDueOverpower"><Abil value="DiabloOverpower" /></CTalent>
    </Catalog>`,
};

test("effectsApplyingBehavior resolves direct, effect-parent-chain, and behavior-parent-chain references", () => {
  const ids = runGraph([STORM_XML, HERO_XML], `
    const g = G.buildEffectGraph(files);
    return G.effectsApplyingBehavior(g, "StormStun").sort();
  `);
  assert.deepEqual(ids, ["DiabloOverpowerStunApply", "StormStunApply"]);
});

test("effectsApplyingBehavior matches behavior-parent chain (StormSlowParent)", () => {
  const ids = runGraph([STORM_XML, HERO_XML], `
    const g = G.buildEffectGraph(files);
    return G.effectsApplyingBehavior(g, "StormSlowParent").sort();
  `);
  assert.deepEqual(ids, ["StormSlowApply"]);
});

test("findMechanicApplications attributes an apply-effect to its named owner only", () => {
  const result = runGraph([STORM_XML, HERO_XML], `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      DiabloOverpower: { kind: "ability", nameId: "DiabloOverpower", heroSlug: "diablo", heroName: "Diablo", name: "Overpower", icon: "x.png" },
      DiabloDevilsDueOverpower: { kind: "talent", nameId: "DiabloDevilsDueOverpower", heroSlug: "diablo", heroName: "Diablo", name: "Devil's Due", icon: "y.png" },
    };
    const mechanics = [{ slug: "stunned", name: "Stunned", category: "Crowd Control", primaryBehavior: "StormStun", sourceIds: ["StormStun"] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "stunned");
  assert.equal(result[0].category, "Crowd Control");
  // DiabloOverpowerStunApply is named after the ability; the talent variant
  // DiabloDevilsDueOverpower is not the named owner of any apply-effect here.
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["DiabloOverpower"]);
});

test("findMechanicApplications keeps hero-specific Storm-prefixed apply effects", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="MuradinStormBolt"><Effect value="MuradinStormBoltInitialSet" /></CAbilEffectTarget>
      <CEffectSet id="MuradinStormBoltInitialSet"><EffectArray value="StormBoltLaunchMissile" /></CEffectSet>
      <CEffectLaunchMissile id="StormBoltLaunchMissile"><SearchEffect value="StormBoltMissileScan" /></CEffectLaunchMissile>
      <CEffectEnumArea id="StormBoltMissileScan"><AreaArray Effect="StormBoltImpactSet" /></CEffectEnumArea>
      <CEffectSet id="StormBoltImpactSet"><EffectArray value="StormBoltApplyBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="StormBoltApplyBehavior"><Behavior value="MuradinStormboltStun" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MuradinStormboltStun" parent="StormStun" />
      <CBehaviorBuff id="StormStun" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      MuradinStormBolt: { kind: "ability", nameId: "MuradinStormBolt", heroSlug: "muradin", heroName: "Muradin", name: "Storm Bolt", icon: "i.png" },
    };
    const mechanics = [{ slug: "stunned", name: "Stunned", category: "Crowd Control", primaryBehavior: "StormStun", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["MuradinStormBolt"]);
});

test("findMechanicApplications credits ownerless weapon effect paths to validator-gating talents", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CUnit id="HeroMuradin"><Effect value="MuradinHeroWeaponImpactSet" /></CUnit>
      <CEffectSet id="MuradinHeroWeaponImpactSet"><EffectArray value="SkullcrackerSwitch" /></CEffectSet>
      <CEffectSwitch id="SkullcrackerSwitch">
        <CaseArray Validator="Has3StackSkullcracker" Effect="SkullcrackerProcSet" />
        <CaseDefault value="SkullcrackerApplyBehavior" />
        <ValidatorArray value="HasSkullcracker" />
      </CEffectSwitch>
      <CEffectSet id="SkullcrackerProcSet"><EffectArray value="SkullcrackerApplyStunBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="SkullcrackerApplyBehavior"><Behavior value="SkullcrackerStack" /></CEffectApplyBehavior>
      <CEffectApplyBehavior id="SkullcrackerApplyStunBehavior"><Behavior value="SkullcrackerStun" /></CEffectApplyBehavior>
      <CBehaviorBuff id="SkullcrackerStun" parent="StormStun" />
      <CBehaviorBuff id="StormStun" />
      <CBehaviorBuff id="MuradinSkullcracker" />
      <CBehaviorBuff id="SkullcrackerStack" />
      <CValidatorUnitCompareBehaviorCount id="HasSkullcracker"><Behavior value="MuradinSkullcracker" /></CValidatorUnitCompareBehaviorCount>
      <CValidatorUnitCompareBehaviorCount id="Has3StackSkullcracker"><Behavior value="SkullcrackerStack" /></CValidatorUnitCompareBehaviorCount>
      <CTalent id="MuradinCombatStyleSkullcracker"><BehaviorArray value="MuradinSkullcracker" /></CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      MuradinCombatStyleSkullcracker: { kind: "talent", nameId: "MuradinCombatStyleSkullcracker", heroSlug: "muradin", heroName: "Muradin", name: "Skull Cracker", icon: "j.png" },
    };
    const mechanics = [{ slug: "stunned", name: "Stunned", category: "Crowd Control", primaryBehavior: "StormStun", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["MuradinCombatStyleSkullcracker"]);
});

test("findMechanicApplications prefers the talent that enables a gated ability effect", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="AnduinChastise"><Effect value="AnduinChastiseImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="AnduinChastiseImpactSet"><EffectArray value="AnduinChastiseCensureTalentApplyStun" /></CEffectSet>
      <CEffectApplyBehavior id="AnduinChastiseCensureTalentApplyStun"><Behavior value="AnduinChastiseCensureTalentStun" /></CEffectApplyBehavior>
      <CBehaviorBuff id="AnduinChastiseCensureTalentStun" parent="StormStun" />
      <CBehaviorBuff id="StormStun" />
      <CTalent id="AnduinCensure">
        <Abil value="AnduinChastise" />
        <AbilityModificationArray>
          <Modifications>
            <Catalog value="Effect" />
            <Entry value="AnduinChastiseCensureTalentApplyStun" />
            <Field value="Chance" />
            <Value value="1.000000" />
          </Modifications>
        </AbilityModificationArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      AnduinChastise: { kind: "ability", nameId: "AnduinChastise", heroSlug: "anduin", heroName: "Anduin", name: "Chastise", icon: "i.png" },
      AnduinCensure: { kind: "talent", nameId: "AnduinCensure", heroSlug: "anduin", heroName: "Anduin", name: "Censure", icon: "j.png" },
    };
    const mechanics = [{ slug: "stunned", name: "Stunned", category: "Crowd Control", primaryBehavior: "StormStun", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["AnduinCensure"]);
});

test("findMechanicApplications follows behavior CancelEffect controllers back to the owning ability and talent gate", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="RexxarUnleashTheBoars"><Effect value="RexxarUnleashTheBoarsInitialSet" /></CAbilEffectTarget>
      <CEffectSet id="RexxarUnleashTheBoarsInitialSet"><EffectArray value="RexxarUnleashTheBoarsCreateUnitSet" /></CEffectSet>
      <CEffectSet id="RexxarUnleashTheBoarsCreateUnitSet"><EffectArray value="RexxarUnleashTheBoarsCreateUnit" /></CEffectSet>
      <CEffectCreateUnit id="RexxarUnleashTheBoarsCreateUnit"><SpawnEffect value="RexxarUnleashTheBoarsSpawnSet" /></CEffectCreateUnit>
      <CEffectSet id="RexxarUnleashTheBoarsSpawnSet"><EffectArray value="RexxarUnleashTheBoarsApplyDamageController" /></CEffectSet>
      <CEffectApplyBehavior id="RexxarUnleashTheBoarsApplyDamageController"><Behavior value="RexxarUnleashTheBoardsDamageController" /></CEffectApplyBehavior>
      <CBehaviorBuff id="RexxarUnleashTheBoardsDamageController"><CancelEffect value="RexxarUnleashTheBoarsEnumTrackedUnit" /></CBehaviorBuff>
      <CEffectEnumTrackedUnits id="RexxarUnleashTheBoarsEnumTrackedUnit"><Effect value="RexxarUnleashTheBoarsImpactSet" /></CEffectEnumTrackedUnits>
      <CEffectSet id="RexxarUnleashTheBoarsImpactSet">
        <EffectArray value="RexxarUnleashTheBoarsApplySlowBehavior" />
        <EffectArray value="RexxarUnleashTheBoarsKillCommandApplyRootBehavior" />
      </CEffectSet>
      <CEffectApplyBehavior id="RexxarUnleashTheBoarsApplySlowBehavior"><Behavior value="RexxarUnleashTheBoarsSlow" /></CEffectApplyBehavior>
      <CBehaviorBuff id="RexxarUnleashTheBoarsSlow" parent="StormSlowParent" />
      <CBehaviorBuff id="StormSlowParent" />
      <CEffectApplyBehavior id="RexxarUnleashTheBoarsKillCommandApplyRootBehavior">
        <Chance value="0" />
        <Behavior value="RexxarUnleashTheBoarsKillCommandRoot" />
      </CEffectApplyBehavior>
      <CActorModel id="RexxarUnleashTheBoarsKillCommandRoot" parent="StormModelRoot"><Behavior value="RexxarUnleashTheBoarsKillCommandRoot" /></CActorModel>
      <CBehaviorBuff id="RexxarUnleashTheBoarsKillCommandRoot" parent="StormRoot" />
      <CBehaviorBuff id="StormRoot" />
      <CTalent id="RexxarUnleashTheBoarsKillCommand">
        <Abil value="RexxarUnleashTheBoars" />
        <AbilityModificationArray>
          <Modifications>
            <Catalog value="Effect" />
            <Entry value="RexxarUnleashTheBoarsKillCommandApplyRootBehavior" />
            <Field value="Chance" />
            <Value value="1.000000" />
          </Modifications>
        </AbilityModificationArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      RexxarUnleashTheBoars: { kind: "ability", nameId: "RexxarUnleashTheBoars", heroSlug: "rexxar", heroName: "Rexxar", name: "Unleash the Boars", icon: "i.png" },
      RexxarUnleashTheBoarsKillCommand: { kind: "talent", nameId: "RexxarUnleashTheBoarsKillCommand", heroSlug: "rexxar", heroName: "Rexxar", name: "Kill Command", icon: "j.png" },
    };
    const mechanics = [
      { slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] },
      { slug: "rooted", name: "Rooted", category: "Crowd Control", primaryBehavior: "StormRoot", sourceIds: [] },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result.find((m) => m.slug === "slowed").entries.map((e) => e.nameId), ["RexxarUnleashTheBoars"]);
  assert.deepEqual(result.find((m) => m.slug === "rooted").entries.map((e) => e.nameId), ["RexxarUnleashTheBoarsKillCommand"]);
});

test("findMechanicApplications ignores Target Effect backrefs when walking owners", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="XulSpectralScythe"><Effect value="XulSpectralScytheSet" /><CursorEffect value="XulSpectralScytheScan" /></CAbilEffectTarget>
      <CEffectEnumArea id="XulSpectralScytheScan"><AreaArray Effect="XulSpectralScytheImpactSet" /></CEffectEnumArea>
      <CEffectSet id="XulSpectralScytheImpactSet"><EffectArray value="XulSpectralScytheSkeletonSpawnSwitch" /></CEffectSet>
      <CEffectSwitch id="XulSpectralScytheSkeletonSpawnSwitch"><CaseDefault value="XulSpectralScytheSkeletonSpawn" /></CEffectSwitch>
      <CEffectCreatePersistent id="XulSpectralScytheSkeletonSpawn"><PeriodicEffectArray value="XulCreateSkeletonUnit" /></CEffectCreatePersistent>
      <CEffectCreateUnit id="XulCreateSkeletonUnit"><SpawnEffect value="XulSkeletonSpawnSet" /></CEffectCreateUnit>
      <CEffectSet id="XulSkeletonSpawnSet"><EffectArray value="XulSkeletonApplyTimedLife" /></CEffectSet>
      <CEffectApplyBehavior id="XulSkeletonApplyTimedLife"><Behavior value="XulSkeletonTimedLife" /></CEffectApplyBehavior>
      <CBehaviorBuff id="XulSkeletonTimedLife"><InitialEffect value="XulBonePrisonIssueOrder" /></CBehaviorBuff>
      <CEffectIssueOrder id="XulBonePrisonIssueOrder"><Target Effect="XulBonePrisonImpactSet" Value="TargetUnit" /></CEffectIssueOrder>

      <CAbilEffectTarget id="XulBonePrison"><Effect value="XulBonePrisonInitialSet" /></CAbilEffectTarget>
      <CEffectSet id="XulBonePrisonInitialSet"><EffectArray value="XulBonePrisonDelay" /></CEffectSet>
      <CEffectCreatePersistent id="XulBonePrisonDelay"><PeriodicEffectArray value="XulBonePrisonImpactSet" /></CEffectCreatePersistent>
      <CEffectSet id="XulBonePrisonImpactSet"><EffectArray value="XulBonePrisonApplyRoot" /></CEffectSet>
      <CEffectApplyBehavior id="XulBonePrisonApplyRoot"><Behavior value="XulBonePrisonRoot" /></CEffectApplyBehavior>
      <CBehaviorBuff id="XulBonePrisonRoot" parent="StormRoot" />
      <CBehaviorBuff id="StormRoot" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      XulSpectralScythe: { kind: "ability", nameId: "XulSpectralScythe", heroSlug: "xul", heroName: "Xul", name: "Spectral Scythe", icon: "i.png" },
      XulBonePrison: { kind: "ability", nameId: "XulBonePrison", heroSlug: "xul", heroName: "Xul", name: "Bone Prison", icon: "j.png" },
    };
    const mechanics = [{ slug: "rooted", name: "Rooted", category: "Crowd Control", primaryBehavior: "StormRoot", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["XulBonePrison"]);
});

test("findMechanicApplications does not credit spawned-unit birth statuses to the summoning ability", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="XulSkeletalMages"><Effect value="XulSkeletalMagesSpawnPersistent" /></CAbilEffectTarget>
      <CEffectCreatePersistent id="XulSkeletalMagesSpawnPersistent"><PeriodicEffectArray value="XulSkeletalMagesCreateUnit" /></CEffectCreatePersistent>
      <CEffectCreateUnit id="XulSkeletalMagesCreateUnit"><SpawnEffect value="XulSkeletalMagesSpawnSet" /></CEffectCreateUnit>
      <CEffectSet id="XulSkeletalMagesSpawnSet"><EffectArray value="XulSkeletalMagesApplyPreBirth" /></CEffectSet>
      <CEffectApplyBehavior id="XulSkeletalMagesApplyPreBirth"><Behavior value="XulSkeletalMagesPreBirth" /></CEffectApplyBehavior>
      <CBehaviorBuff id="XulSkeletalMagesPreBirth" parent="StormStasisRemoved" />
      <CBehaviorBuff id="StormStasisRemoved" parent="StormStasis" />
      <CBehaviorBuff id="StormStasis" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      XulSkeletalMages: { kind: "ability", nameId: "XulSkeletalMages", heroSlug: "xul", heroName: "Xul", name: "Skeletal Mages", icon: "i.png" },
    };
    const mechanics = [{ slug: "stasis", name: "Stasis", category: "Protection", primaryBehavior: "StormStasis", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries, []);
});

test("findMechanicApplications ignores talent-enabled effects that are not called by gameplay effects", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CEffectApplyBehavior id="DVaBoostersGetOnThePointTalentApplySlow"><Behavior value="DVaBoostersGetOnThePointTalentSlow" /></CEffectApplyBehavior>
      <CBehaviorBuff id="DVaBoostersGetOnThePointTalentSlow" parent="StormSlowParent" />
      <CBehaviorBuff id="StormSlowParent" />
      <CTalent id="DvaGetOnThePoint">
        <AbilityModificationArray>
          <Modifications>
            <Catalog value="Effect" />
            <Entry value="DVaBoostersGetOnThePointTalentApplySlow" />
            <Field value="Chance" />
            <Value value="1.000000" />
          </Modifications>
        </AbilityModificationArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      DvaGetOnThePoint: { kind: "talent", nameId: "DvaGetOnThePoint", heroSlug: "dva", heroName: "D.Va", name: "Get On The Point!", icon: "i.png" },
    };
    const mechanics = [{ slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries, []);
});

test("findMechanicApplications prefers talents from direct talent validators", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="LeoricEntomb"><Effect value="LeoricEntombBuriedAliveImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="LeoricEntombBuriedAliveImpactSet"><EffectArray value="LeoricEntombBuriedAliveApplySilenceBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="LeoricEntombBuriedAliveApplySilenceBehavior">
        <ValidatorArray value="HasLeoricMasteryBuriedAlive" />
        <Behavior value="LeoricEntombBuriedAliveSilenceDebuff" />
      </CEffectApplyBehavior>
      <CBehaviorBuff id="LeoricEntombBuriedAliveSilenceDebuff" parent="StormSilence" />
      <CBehaviorBuff id="StormSilence" />
      <CValidatorPlayerTalent id="HasLeoricMasteryBuriedAlive"><Value value="LeoricMasteryBuriedAliveEntomb" /></CValidatorPlayerTalent>
      <CTalent id="LeoricMasteryBuriedAliveEntomb"><Abil value="LeoricEntomb" /></CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      LeoricEntomb: { kind: "ability", nameId: "LeoricEntomb", heroSlug: "leoric", heroName: "Leoric", name: "Entomb", icon: "i.png" },
      LeoricMasteryBuriedAliveEntomb: { kind: "talent", nameId: "LeoricMasteryBuriedAliveEntomb", heroSlug: "leoric", heroName: "Leoric", name: "Buried Alive", icon: "j.png" },
    };
    const mechanics = [{ slug: "silenced", name: "Silenced", category: "Crowd Control", primaryBehavior: "StormSilence", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["LeoricMasteryBuriedAliveEntomb"]);
});

test("findMechanicApplications credits locally talent-named effects to that talent", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="DVaBoostersOn"><Effect value="DVaBoostersImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="DVaBoostersImpactSet">
        <EffectArray value="DVaBoostersImpactDamage" />
        <EffectArray value="DVaBoostersHitTheNitrousTalentApplyStun" />
      </CEffectSet>
      <CEffectDamage id="DVaBoostersImpactDamage" />
      <CEffectApplyBehavior id="DVaBoostersHitTheNitrousTalentApplyStun">
        <ValidatorArray value="DVaBoostersHitTheNitrousIsActive" />
        <Behavior value="DVaBoostersHitTheNitrousTalentStun" />
      </CEffectApplyBehavior>
      <CBehaviorBuff id="DVaBoostersHitTheNitrousTalentStun" parent="StormStun" />
      <CBehaviorBuff id="StormStun" />
      <CValidatorUnitCompareTokenCount id="DVaBoostersHitTheNitrousIsActive" />
      <CTalent id="DVaBoostersHitTheNitrous"><Abil value="DVaBoostersOn" /></CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      DVaBoostersOn: { kind: "ability", nameId: "DVaBoostersOn", buttonId: "DVaMechBoosters", heroSlug: "dva", heroName: "D.Va", name: "Boosters", icon: "i.png", abilityType: "Q" },
      DVaBoostersHitTheNitrous: { kind: "talent", nameId: "DVaBoostersHitTheNitrous", buttonId: "DVaBoostersHitTheNitrous", heroSlug: "dva", heroName: "D.Va", name: "Hit the Nitrous", icon: "j.png" },
    };
    const mechanics = [{ slug: "stunned", name: "Stunned", category: "Crowd Control", primaryBehavior: "StormStun", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["DVaBoostersHitTheNitrous"]);
});

test("findMechanicApplications prefers talents from validator-gated containing effects", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="DehakaEssenceCollection"><Effect value="DehakaEssenceCollectionEssenceClawsTalentSet" /></CAbilEffectTarget>
      <CEffectSet id="DehakaEssenceCollectionEssenceClawsTalentSet">
        <ValidatorArray value="DehakaHasEssenceClawsTalent" />
        <EffectArray value="DehakaEssenceCollectionEssenceClawsTalentApplySlow" />
      </CEffectSet>
      <CEffectApplyBehavior id="DehakaEssenceCollectionEssenceClawsTalentApplySlow"><Behavior value="DehakaEssenceCollectionEssenceClawsTalentSlow" /></CEffectApplyBehavior>
      <CBehaviorBuff id="DehakaEssenceCollectionEssenceClawsTalentSlow" parent="StormSlowParent" />
      <CBehaviorBuff id="StormSlowParent" />
      <CValidatorPlayerTalent id="DehakaHasEssenceClawsTalent"><Value value="DehakaEssenceClaws" /></CValidatorPlayerTalent>
      <CTalent id="DehakaEssenceClaws"><Abil value="DehakaEssenceCollection" /></CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      DehakaEssenceCollection: { kind: "ability", nameId: "DehakaEssenceCollection", heroSlug: "dehaka", heroName: "Dehaka", name: "Essence Collection", icon: "i.png" },
      DehakaEssenceClaws: { kind: "talent", nameId: "DehakaEssenceClaws", heroSlug: "dehaka", heroName: "Dehaka", name: "Essence Claws", icon: "j.png" },
    };
    const mechanics = [{ slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["DehakaEssenceClaws"]);
});

test("findMechanicApplications prefers talents from behavior-count validators satisfied by talent buffs", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="DehakaDarkSwarm"><Effect value="DehakaDarkSwarmImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="DehakaDarkSwarmImpactSet">
        <EffectArray value="DehakaDarkSwarmFerociousStalkerSlowApplyBehavior" />
      </CEffectSet>
      <CEffectApplyBehavior id="DehakaDarkSwarmFerociousStalkerSlowApplyBehavior">
        <ValidatorArray value="DehakaHasFerociousStalkerBehavior" />
        <Behavior value="DehakaDarkSwarmFerociousStalkerSlow" />
      </CEffectApplyBehavior>
      <CValidatorUnitCompareBehaviorCount id="DehakaHasFerociousStalkerBehavior">
        <WhichUnit Value="Caster" />
        <Value value="1" />
        <Behavior value="DehakaFerociousStalker" />
      </CValidatorUnitCompareBehaviorCount>
      <CBehaviorBuff id="DehakaDarkSwarmFerociousStalkerSlow" parent="StormSlowParent" />
      <CBehaviorBuff id="DehakaFerociousStalker" />
      <CBehaviorBuff id="StormSlowParent" />
      <CTalent id="DehakaBrushstalkerFerociousStalker">
        <Abil value="DehakaDarkSwarm" />
        <RankArray><BehaviorArray value="DehakaFerociousStalker" /></RankArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      DehakaDarkSwarm: { kind: "ability", nameId: "DehakaDarkSwarm", heroSlug: "dehaka", heroName: "Dehaka", name: "Dark Swarm", icon: "i.png" },
      DehakaBrushstalkerFerociousStalker: { kind: "talent", nameId: "DehakaBrushstalkerFerociousStalker", heroSlug: "dehaka", heroName: "Dehaka", name: "Ferocious Stalker", icon: "j.png" },
    };
    const mechanics = [{ slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["DehakaBrushstalkerFerociousStalker"]);
});

test("findMechanicApplications prefers talents from behavior-level disable validators", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="StitchesSlam"><Effect value="StitchesSlamImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="StitchesSlamImpactSet"><EffectArray value="StitchesSlamVileCleaverTalentVileGasApplySet" /></CEffectSet>
      <CEffectSet id="StitchesSlamVileCleaverTalentVileGasApplySet">
        <Chance value="0" />
        <EffectArray value="StitchesVileGasApplySet" />
      </CEffectSet>
      <CEffectSet id="StitchesVileGasApplySet"><EffectArray value="StitchesVileGasPutrefactionApplySwitch" /></CEffectSet>
      <CEffectSwitch id="StitchesVileGasPutrefactionApplySwitch">
        <CaseDefault value="StitchesVileGasApplyPutrefactionTalentDebuff" />
      </CEffectSwitch>
      <CEffectApplyBehavior id="StitchesVileGasApplyPutrefactionTalentDebuff"><Behavior value="StitchesVileGasPutrefactionTalentDebuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="StitchesVileGasPutrefactionTalentDebuff" parent="StormHealReduction">
        <DisableValidatorArray value="StitchesHasPutrefactionTalent" />
      </CBehaviorBuff>
      <CBehaviorBuff id="StormHealReduction" />
      <CValidatorPlayerTalent id="StitchesHasPutrefactionTalent"><Value value="StitchesPutrefaction" /></CValidatorPlayerTalent>
      <CTalent id="StitchesPutrefaction" />
      <CTalent id="StitchesVileCleaver">
        <Abil value="StitchesSlam" />
        <AbilityModificationArray>
          <Modifications>
            <Catalog value="Effect" />
            <Entry value="StitchesSlamVileCleaverTalentVileGasApplySet" />
            <Field value="Chance" />
            <Value value="1.000000" />
          </Modifications>
        </AbilityModificationArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      StitchesSlam: { kind: "ability", nameId: "StitchesSlam", heroSlug: "stitches", heroName: "Stitches", name: "Slam", icon: "i.png" },
      StitchesPutrefaction: { kind: "talent", nameId: "StitchesPutrefaction", heroSlug: "stitches", heroName: "Stitches", name: "Putrefaction", icon: "j.png" },
      StitchesVileCleaver: { kind: "talent", nameId: "StitchesVileCleaver", heroSlug: "stitches", heroName: "Stitches", name: "Vile Cleaver", icon: "k.png" },
    };
    const mechanics = [{ slug: "healing-reduction", name: "Healing Reduction", category: "Other", primaryBehavior: "StormHealReduction", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["StitchesPutrefaction"]);
});

test("findMechanicApplications prefers talents that enable a containing effect chain", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="DehakaBurrow"><Effect value="DehakaBurrowNumbingEruptionTalentCreatePersistent" /></CAbilEffectTarget>
      <CEffectCreatePersistent id="DehakaBurrowNumbingEruptionTalentCreatePersistent">
        <PeriodicEffectArray value="DehakaBurrowApplyNumbingEruptionTalentSlow" />
      </CEffectCreatePersistent>
      <CEffectApplyBehavior id="DehakaBurrowApplyNumbingEruptionTalentSlow"><Behavior value="DehakaBurrowTalentNumbingEruptionSlow" /></CEffectApplyBehavior>
      <CBehaviorBuff id="DehakaBurrowTalentNumbingEruptionSlow" parent="StormSlowParent" />
      <CBehaviorBuff id="StormSlowParent" />
      <CTalent id="DehakaBurrowTalentLurkerStrain">
        <Abil value="DehakaBurrow" />
        <AbilityModificationArray>
          <Modifications>
            <Catalog value="Effect" />
            <Entry value="DehakaBurrowNumbingEruptionTalentCreatePersistent" />
            <Field value="Chance" />
            <Value value="1.000000" />
          </Modifications>
        </AbilityModificationArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      DehakaBurrow: { kind: "ability", nameId: "DehakaBurrow", heroSlug: "dehaka", heroName: "Dehaka", name: "Burrow", icon: "i.png" },
      DehakaBurrowTalentLurkerStrain: { kind: "talent", nameId: "DehakaBurrowTalentLurkerStrain", heroSlug: "dehaka", heroName: "Dehaka", name: "Lurker Strain", icon: "j.png" },
    };
    const mechanics = [{ slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["DehakaBurrowTalentLurkerStrain"]);
});

test("findMechanicApplications excludes Stasis applications from Invulnerable", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="MeiOWAvalanche"><Effect value="MeiOWAvalancheStasisApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="MeiOWAvalancheStasisApplyBehavior"><Behavior value="MeiOWAvalancheStasis" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MeiOWAvalancheStasis" parent="StormStasisRemoved" />
      <CBehaviorBuff id="StormStasisRemoved" parent="StormStasisIceBlock" />
      <CBehaviorBuff id="StormStasisIceBlock" parent="StormStasis" />
      <CBehaviorBuff id="StormStasis" parent="StormInvulnerable" />
      <CBehaviorBuff id="StormInvulnerable" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      MeiOWAvalanche: { kind: "talent", nameId: "MeiOWAvalanche", heroSlug: "mei", heroName: "Mei", name: "Avalanche", icon: "i.png" },
    };
    const mechanics = [
      { slug: "invulnerable", name: "Invulnerable", category: "Protection", primaryBehavior: "StormInvulnerable", sourceIds: [] },
      { slug: "stasis", name: "Stasis", category: "Protection", primaryBehavior: "StormStasis", sourceIds: [] },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries, []);
  assert.deepEqual(result[1].entries.map((e) => e.nameId), ["MeiOWAvalanche"]);
});

test("findMechanicApplications keeps Ice Block-style stasis under Invulnerable", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CTalent id="GenericTalentIceBlock"><Abil value="TalentBucketIceBlock" /></CTalent>
      <CBehaviorBuff id="TalentBucketIceBlock" parent="StormStasisIceBlock" />
      <CBehaviorBuff id="StormStasisIceBlock" parent="StormStasis" />
      <CBehaviorBuff id="StormStasis" parent="StormInvulnerable" />
      <CBehaviorBuff id="StormInvulnerable" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      GenericTalentIceBlock: { kind: "talent", nameId: "GenericTalentIceBlock", heroSlug: "nazeebo", heroName: "Nazeebo", name: "Ice Block", icon: "i.png" },
    };
    const mechanics = [{ slug: "invulnerable", name: "Invulnerable", category: "Protection", primaryBehavior: "StormInvulnerable", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["GenericTalentIceBlock"]);
});

test("findMechanicApplications separates shield descendants from protected", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="TassadarPlasmaShield"><Effect value="TassadarPlasmaShieldApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="TassadarPlasmaShieldApplyBehavior"><Behavior value="TassadarPlasmaShieldBuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="TassadarPlasmaShieldBuff" parent="StormShield" />
      <CBehaviorBuff id="StormShield" parent="StormProtect" />
      <CBehaviorBuff id="StormProtect" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      TassadarPlasmaShield: { kind: "ability", nameId: "TassadarPlasmaShield", heroSlug: "tassadar", heroName: "Tassadar", name: "Plasma Shield", icon: "i.png" },
    };
    const mechanics = [
      { slug: "protected", name: "Protected", category: "Protection", primaryBehavior: "StormProtect", sourceIds: [] },
      { slug: "shield", name: "Shield", category: "Protection", primaryBehavior: "StormShield", sourceIds: [] },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries, []);
  assert.deepEqual(result[1].entries.map((e) => e.nameId), ["TassadarPlasmaShield"]);
});

test("findMechanicApplications separates talent-granted shields from protected", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CTalent id="GenericTalentStormShield"><Abil value="TalentBucketStormShield" /></CTalent>
      <CBehaviorBuff id="TalentBucketStormShield" parent="StormShield" />
      <CBehaviorBuff id="StormShield" parent="StormProtect" />
      <CBehaviorBuff id="StormProtect" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      GenericTalentStormShield: { kind: "talent", nameId: "GenericTalentStormShield", heroSlug: "kharazim", heroName: "Kharazim", name: "Storm Shield", icon: "i.png" },
    };
    const mechanics = [
      { slug: "protected", name: "Protected", category: "Protection", primaryBehavior: "StormProtect", sourceIds: [] },
      { slug: "shield", name: "Shield", category: "Protection", primaryBehavior: "StormShield", sourceIds: [] },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries, []);
  assert.deepEqual(result[1].entries.map((e) => e.nameId), ["GenericTalentStormShield"]);
});

test("findMechanicApplications splits true protected from evasion, stagger, spell absorb, and shields", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="MedivhForceOfWill"><Effect value="MedivhForceOfWillApplyBuff" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="MedivhForceOfWillApplyBuff"><Behavior value="MedivhForceOfWillBuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MedivhForceOfWillBuff" parent="StormProtect"><DamageResponse Handled="MedivhForceOfWillDamageHandledSet" /></CBehaviorBuff>

      <CAbilEffectInstant id="GenjiDeflect"><Effect value="GenjiDeflectProtectedApplyBehavior" /></CAbilEffectInstant>
      <CEffectApplyBehavior id="GenjiDeflectProtectedApplyBehavior"><Behavior value="GenjiDeflectProtected" /></CEffectApplyBehavior>
      <CBehaviorBuff id="GenjiDeflectProtected" parent="StormProtect"><DamageResponse Priority="95" /></CBehaviorBuff>

      <CAbilEffectInstant id="XulShade"><Effect value="XulShadeApplyEvasion" /></CAbilEffectInstant>
      <CEffectApplyBehavior id="XulShadeApplyEvasion"><Behavior value="XulShadeEvasion" /></CEffectApplyBehavior>
      <CBehaviorBuff id="XulShadeEvasion" parent="StormEvasion" />

      <CAbilEffectInstant id="ChenElusiveBrawler"><Effect value="ChenElusiveBrawlerApply" /></CAbilEffectInstant>
      <CEffectApplyBehavior id="ChenElusiveBrawlerApply"><Behavior value="ChenElusiveBrawlerBuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="ChenElusiveBrawlerBuff" parent="StormEvasion"><DamageResponse Handled="ChenElusiveBrawlerDummySet" /></CBehaviorBuff>

      <CAbilEffectInstant id="ChenFortifyingBrew"><Effect value="ChenStaggerApplyProtectedBuff" /></CAbilEffectInstant>
      <CEffectApplyBehavior id="ChenStaggerApplyProtectedBuff"><Behavior value="ChenStaggerProtectedBuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="ChenStaggerProtectedBuff" parent="StormProtect">
        <BehaviorCategories index="Protected" value="0" />
        <DamageResponse Handled="ChenStaggerDamageResponseSet" />
      </CBehaviorBuff>

      <CAbilEffectInstant id="ArthasAntiMagicShell"><Effect value="ArthasAntiMagicShellApplySpellShieldBehavior" /></CAbilEffectInstant>
      <CEffectApplyBehavior id="ArthasAntiMagicShellApplySpellShieldBehavior"><Behavior value="ArthasAntiMagicShellCaster" /></CEffectApplyBehavior>
      <CBehaviorBuff id="ArthasAntiMagicShellCaster" parent="StormProtect">
        <BehaviorCategories index="Protected" value="0" />
        <DamageResponse>
          <Kind index="Splash" value="0" />
          <Kind index="Basic" value="0" />
        </DamageResponse>
      </CBehaviorBuff>

      <CAbilEffectInstant id="FirebatEnduranceStimpack"><Effect value="FirebatEnduranceStimpackApplyBehavior" /></CAbilEffectInstant>
      <CEffectApplyBehavior id="FirebatEnduranceStimpackApplyBehavior"><Behavior value="FirebatEnduranceStimpackBehavior" /></CEffectApplyBehavior>
      <CBehaviorBuff id="FirebatEnduranceStimpackBehavior" parent="StormShield"><DamageResponse ModifyLimit="590" /></CBehaviorBuff>

      <CTalent id="AbathurNetworkedCarapace"><Abil value="TalentBucketNetworkedCarapace" /></CTalent>
      <CBehaviorBuff id="TalentBucketNetworkedCarapace" parent="StormShield" />

      <CBehaviorBuff id="StormShield" parent="StormProtect">
        <BehaviorCategories index="Protected" value="0" />
        <DamageResponse ModifyLimit="1" />
      </CBehaviorBuff>
      <CBehaviorBuff id="StormEvasion" parent="StormProtect">
        <BehaviorCategories index="Protected" value="0" />
        <BehaviorCategories index="Evasion" value="1" />
        <DamageResponse><Kind index="Ability" value="0" /></DamageResponse>
      </CBehaviorBuff>
      <CBehaviorBuff id="StormProtect">
        <BehaviorCategories index="Protected" value="1" />
        <DamageResponse Chance="1" Priority="94" ModifyFraction="0" />
      </CBehaviorBuff>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      MedivhForceOfWill: { kind: "ability", nameId: "MedivhForceOfWill", heroSlug: "medivh", heroName: "Medivh", name: "Force of Will", icon: "i.png" },
      GenjiDeflect: { kind: "ability", nameId: "GenjiDeflect", heroSlug: "genji", heroName: "Genji", name: "Deflect", icon: "i.png" },
      XulShade: { kind: "ability", nameId: "XulShade", heroSlug: "xul", heroName: "Xul", name: "Shade", icon: "i.png" },
      ChenElusiveBrawler: { kind: "ability", nameId: "ChenElusiveBrawler", heroSlug: "chen", heroName: "Chen", name: "Elusive Brawler", icon: "i.png" },
      ChenFortifyingBrew: { kind: "ability", nameId: "ChenFortifyingBrew", heroSlug: "chen", heroName: "Chen", name: "Fortifying Brew", icon: "i.png" },
      ArthasAntiMagicShell: { kind: "ability", nameId: "ArthasAntiMagicShell", heroSlug: "arthas", heroName: "Arthas", name: "Anti-Magic Shell", icon: "i.png" },
      FirebatEnduranceStimpack: { kind: "ability", nameId: "FirebatEnduranceStimpack", heroSlug: "blaze", heroName: "Blaze", name: "Endurance Stimpack", icon: "i.png" },
      AbathurNetworkedCarapace: { kind: "talent", nameId: "AbathurNetworkedCarapace", heroSlug: "abathur", heroName: "Abathur", name: "Networked Carapace", icon: "i.png" },
    };
    const mechanics = [
      { slug: "protected", name: "Protected", category: "Protection", primaryBehavior: "StormProtect", sourceIds: [] },
      { slug: "shield", name: "Shield", category: "Protection", primaryBehavior: "StormShield", sourceIds: [] },
      { slug: "evasion", name: "Evasion", category: "Protection", primaryBehavior: "StormEvasion", sourceIds: [] },
      { slug: "stagger", name: "Stagger", category: "Protection", primaryBehavior: "StormProtect", sourceIds: [] },
      { slug: "spell-absorb", name: "Spell Absorb", category: "Protection", primaryBehavior: "StormProtect", sourceIds: [] },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result.find((m) => m.slug === "protected").entries.map((e) => e.nameId), ["GenjiDeflect", "MedivhForceOfWill"]);
  assert.deepEqual(result.find((m) => m.slug === "shield").entries.map((e) => e.nameId), ["AbathurNetworkedCarapace", "FirebatEnduranceStimpack"]);
  assert.deepEqual(result.find((m) => m.slug === "evasion").entries.map((e) => e.nameId), ["ChenElusiveBrawler", "XulShade"]);
  assert.deepEqual(result.find((m) => m.slug === "stagger").entries.map((e) => e.nameId), ["ChenFortifyingBrew"]);
  assert.deepEqual(result.find((m) => m.slug === "spell-absorb").entries.map((e) => e.nameId), ["ArthasAntiMagicShell"]);
});

test("findMechanicApplications includes sleep descendants under stunned and sleeping", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="AnaSleepDart"><Effect value="AnaSleepDartApplySleep" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="AnaSleepDartApplySleep"><Behavior value="AnaSleepDartSleep" /></CEffectApplyBehavior>
      <CBehaviorBuff id="AnaSleepDartSleep" parent="StormSleep" />
      <CBehaviorBuff id="StormSleep" parent="StormStun" />
      <CBehaviorBuff id="StormStun" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      AnaSleepDart: { kind: "ability", nameId: "AnaSleepDart", heroSlug: "ana", heroName: "Ana", name: "Sleep Dart", icon: "i.png" },
    };
    const mechanics = [
      { slug: "stunned", name: "Stunned", category: "Crowd Control", primaryBehavior: "StormStun", sourceIds: [] },
      { slug: "sleeping", name: "Sleeping", category: "Crowd Control", primaryBehavior: "StormSleep", sourceIds: [] },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["AnaSleepDart"]);
  assert.deepEqual(result[1].entries.map((e) => e.nameId), ["AnaSleepDart"]);
});

test("findMechanicApplications does not treat talent Abil references as direct status grants", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="AnaSleepDart"><Effect value="AnaSleepDartImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="AnaSleepDartImpactSet">
        <EffectArray value="AnaSleepDartApplyBehavior" />
        <EffectArray value="AnaOverdoseApplySet" />
        <EffectArray value="AnaSleepDartNightTerrorsDamage" />
        <EffectArray value="AnaSleepDartSlumberShellsApplySlowBehavior" />
      </CEffectSet>
      <CEffectApplyBehavior id="AnaSleepDartApplyBehavior"><Behavior value="AnaSleepDartSleep" /></CEffectApplyBehavior>
      <CBehaviorBuff id="AnaSleepDart" parent="StormSleep" />
      <CBehaviorBuff id="AnaSleepDartSleep" parent="StormSleep" />
      <CBehaviorBuff id="StormSleep" />
      <CEffectSet id="AnaOverdoseApplySet"><Chance value="0" /></CEffectSet>
      <CEffectDamage id="AnaSleepDartNightTerrorsDamage"><Chance value="0" /></CEffectDamage>
      <CEffectApplyBehavior id="AnaSleepDartSlumberShellsApplySlowBehavior"><Chance value="0" /><Behavior value="AnaSleepDartSlow" /></CEffectApplyBehavior>
      <CBehaviorBuff id="AnaSleepDartSlow" parent="StormSlowParent" />
      <CBehaviorBuff id="StormSlowParent" />
      <CTalent id="AnaOverdose">
        <Abil value="AnaSleepDart" />
        <AbilityModificationArray><Modifications><Catalog value="Effect" /><Entry value="AnaOverdoseApplySet" /><Field value="Chance" /><Value value="1.000000" /></Modifications></AbilityModificationArray>
      </CTalent>
      <CTalent id="AnaSleepDartNightTerrors">
        <Abil value="AnaSleepDart" />
        <AbilityModificationArray><Modifications><Catalog value="Effect" /><Entry value="AnaSleepDartNightTerrorsDamage" /><Field value="Chance" /><Value value="1.000000" /></Modifications></AbilityModificationArray>
      </CTalent>
      <CTalent id="AnaSleepingDartSlumberShells">
        <Abil value="AnaSleepDart" />
        <AbilityModificationArray><Modifications><Catalog value="Effect" /><Entry value="AnaSleepDartSlumberShellsApplySlowBehavior" /><Field value="Chance" /><Value value="1.000000" /></Modifications></AbilityModificationArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      AnaSleepDart: { kind: "ability", nameId: "AnaSleepDart", heroSlug: "ana", heroName: "Ana", name: "Sleep Dart", icon: "i.png" },
      AnaOverdose: { kind: "talent", nameId: "AnaOverdose", heroSlug: "ana", heroName: "Ana", name: "Overdose", icon: "j.png" },
      AnaSleepDartNightTerrors: { kind: "talent", nameId: "AnaSleepDartNightTerrors", heroSlug: "ana", heroName: "Ana", name: "Night Terrors", icon: "k.png" },
      AnaSleepingDartSlumberShells: { kind: "talent", nameId: "AnaSleepingDartSlumberShells", heroSlug: "ana", heroName: "Ana", name: "Slumber Shells", icon: "l.png" },
    };
    const mechanics = [
      { slug: "sleeping", name: "Sleeping", category: "Crowd Control", primaryBehavior: "StormSleep", sourceIds: [] },
      { slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["AnaSleepDart"]);
  assert.deepEqual(result[1].entries.map((e) => e.nameId), ["AnaSleepingDartSlumberShells"]);
});

test("findMechanicApplications follows behavior lifecycle effects and credits validator-gated talents", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="MalfurionEntanglingRoots"><Effect value="MalfurionEntanglingRootsApplyRoot" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="MalfurionEntanglingRootsApplyRoot"><Behavior value="EntanglingRootsRoot" /></CEffectApplyBehavior>
      <CBehaviorBuff id="EntanglingRootsRoot"><ExpireEffect value="MalfurionEntanglingRootsFinalSet" /></CBehaviorBuff>
      <CEffectSet id="MalfurionEntanglingRootsFinalSet"><EffectArray value="EntanglingRootsEmeraldDreamsApplySleepBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="EntanglingRootsEmeraldDreamsApplySleepBehavior">
        <ValidatorArray value="MalfurionHasEntanglingRootsEmeraldDreamsTalent" />
        <Behavior value="MalfurionEntanglingRootsEmeraldDreamsSleepBehavior" />
      </CEffectApplyBehavior>
      <CBehaviorBuff id="MalfurionEntanglingRootsEmeraldDreamsSleepBehavior" parent="StormSleep" />
      <CBehaviorBuff id="StormSleep" />
      <CValidatorPlayerTalent id="MalfurionHasEntanglingRootsEmeraldDreamsTalent"><Find value="1" /><Value value="MalfurionEntanglingRootsEmeraldDreams" /></CValidatorPlayerTalent>
      <CTalent id="MalfurionEntanglingRootsEmeraldDreams"><Abil value="MalfurionEntanglingRoots" /></CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      MalfurionEntanglingRoots: { kind: "ability", nameId: "MalfurionEntanglingRoots", heroSlug: "malfurion", heroName: "Malfurion", name: "Entangling Roots", icon: "i.png" },
      MalfurionEntanglingRootsEmeraldDreams: { kind: "talent", nameId: "MalfurionEntanglingRootsEmeraldDreams", heroSlug: "malfurion", heroName: "Malfurion", name: "Emerald Dreams", icon: "j.png" },
    };
    const mechanics = [{ slug: "sleeping", name: "Sleeping", category: "Crowd Control", primaryBehavior: "StormSleep", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["MalfurionEntanglingRootsEmeraldDreams"]);
});

test("findMechanicApplications follows chance-enabled behavior lifecycle chains", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="MalGanisCarrionSwarm"><Effect value="MalGanisCarrionSwarmApplyCaster" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="MalGanisCarrionSwarmApplyCaster"><Behavior value="MalGanisCarrionSwarmCaster" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MalGanisCarrionSwarmCaster"><ExpireEffect value="MalGanisCarrionSwarmSeekerSwarmSearch" /></CBehaviorBuff>
      <CEffectEnumArea id="MalGanisCarrionSwarmSeekerSwarmSearch">
        <Chance value="0" />
        <AreaArray Effect="MalGanisCarrionSwarmSeekerSwarmImpactSet" />
      </CEffectEnumArea>
      <CEffectSet id="MalGanisCarrionSwarmSeekerSwarmImpactSet"><EffectArray value="MalGanisCarrionSwarmSeekerSwarmApplySleepBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="MalGanisCarrionSwarmSeekerSwarmApplySleepBehavior"><Behavior value="MalGanisCarrionSwarmSeekerSwarmSleep" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MalGanisCarrionSwarmSeekerSwarmSleep" parent="StormSleep" />
      <CBehaviorBuff id="StormSleep" />
      <CTalent id="MalGanisCarrionSwarmSeekerSwarm">
        <Abil value="MalGanisCarrionSwarm" />
        <AbilityModificationArray><Modifications><Catalog value="Effect" /><Entry value="MalGanisCarrionSwarmSeekerSwarmSearch" /><Field value="Chance" /><Value value="1.000000" /></Modifications></AbilityModificationArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      MalGanisCarrionSwarm: { kind: "ability", nameId: "MalGanisCarrionSwarm", heroSlug: "malganis", heroName: "Mal'Ganis", name: "Carrion Swarm", icon: "i.png" },
      MalGanisCarrionSwarmSeekerSwarm: { kind: "talent", nameId: "MalGanisCarrionSwarmSeekerSwarm", heroSlug: "malganis", heroName: "Mal'Ganis", name: "Seeker Swarm", icon: "j.png" },
    };
    const mechanics = [{ slug: "sleeping", name: "Sleeping", category: "Crowd Control", primaryBehavior: "StormSleep", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["MalGanisCarrionSwarmSeekerSwarm"]);
});

test("findMechanicApplications credits directly chance-enabled apply-effects to their talent", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CWeaponLegacy id="HeroNova"><Effect value="RangedAttackNovaImpactSet" /></CWeaponLegacy>
      <CEffectSet id="RangedAttackNovaImpactSet">
        <EffectArray value="NovaAntiArmorShellsApplyArmorDebuff" />
      </CEffectSet>
      <CEffectApplyBehavior id="NovaAntiArmorShellsApplyArmorDebuff">
        <Chance value="0" />
        <Behavior value="NovaAntiArmorShellsArmorDebuff" />
      </CEffectApplyBehavior>
      <CBehaviorBuff id="NovaAntiArmorShellsArmorDebuff" parent="StormArmor">
        <ArmorModification><AllArmorBonus value="-10" /></ArmorModification>
      </CBehaviorBuff>
      <CBehaviorBuff id="StormArmor" />
      <CTalent id="NovaCombatStyleAntiArmorShells">
        <AbilityModificationArray>
          <Modifications>
            <Catalog value="Effect" />
            <Entry value="NovaAntiArmorShellsApplyArmorDebuff" />
            <Field value="Chance" />
            <Value value="1.000000" />
          </Modifications>
        </AbilityModificationArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      NovaCombatStyleAntiArmorShells: { kind: "talent", nameId: "NovaCombatStyleAntiArmorShells", heroSlug: "nova", heroName: "Nova", name: "Anti-Armor Shells", icon: "i.png" },
    };
    const mechanics = [{ slug: "vulnerable", name: "Armor Reduction", category: "Armor", primaryBehavior: "StormArmor", sourceIds: [], armorPolarity: "decrease", armorDamageKind: "regular" }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["NovaCombatStyleAntiArmorShells"]);
});

test("findMechanicApplications does not credit dormant sibling effects enabled elsewhere", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectInstant id="LiLiBlindingWind"><Effect value="BlindingWindInitialSet" /></CAbilEffectInstant>
      <CEffectSet id="BlindingWindInitialSet">
        <EffectArray value="BlindingWindSearchArea" />
      </CEffectSet>
      <CEffectEnumArea id="BlindingWindSearchArea"><AreaArray Effect="LiliBlindingWindLaunchSet" /></CEffectEnumArea>
      <CEffectSet id="LiliBlindingWindLaunchSet"><EffectArray value="BlindingWindImpactSet" /></CEffectSet>
      <CEffectSet id="BlindingWindImpactSet"><EffectArray value="BlindingWindApplyBehaviorBlind" /></CEffectSet>
      <CEffectApplyBehavior id="BlindingWindApplyBehaviorBlind"><Behavior value="LiLiBlindingWindBlindBuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="LiLiBlindingWindBlindBuff" parent="StormBlind" />
      <CBehaviorBuff id="StormBlind" />

      <CAbilEffectTarget id="LiLiCloudSerpent"><Effect value="CloudSerpentCastSet" /></CAbilEffectTarget>
      <CEffectSet id="CloudSerpentCastSet"><EffectArray value="LiLiCloudSerpentApplyTurretSerpentBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="LiLiCloudSerpentApplyTurretSerpentBehavior"><Behavior value="LiLiCloudSerpentTurretSerpentOwnerBehavior" /></CEffectApplyBehavior>
      <CBehaviorBuff id="LiLiCloudSerpentTurretSerpentOwnerBehavior">
        <InitialEffect value="LiLiBlindingWindWindSerpentTalentSearchArea" />
      </CBehaviorBuff>
      <CEffectEnumArea id="LiLiBlindingWindWindSerpentTalentSearchArea">
        <Chance value="0" />
        <ValidatorArray value="LiLiHasWindSerpentTalent" />
        <AreaArray Effect="LiliBlindingWindLaunchSet" />
      </CEffectEnumArea>
      <CValidatorPlayerTalent id="LiLiHasWindSerpentTalent"><Value value="LiLiWindSerpent" /></CValidatorPlayerTalent>
      <CTalent id="LiLiWindSerpent">
        <Abil value="LiLiCloudSerpent" />
        <AbilityModificationArray>
          <Modifications>
            <Catalog value="Effect" />
            <Entry value="LiLiCloudSerpentWindSerpentTalentApplyBuff" />
            <Field value="Chance" />
            <Value value="1.000000" />
          </Modifications>
        </AbilityModificationArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      LiLiBlindingWind: { kind: "ability", nameId: "LiLiBlindingWind", heroSlug: "lili", heroName: "Li Li", name: "Blinding Wind", icon: "i.png" },
      LiLiCloudSerpent: { kind: "ability", nameId: "LiLiCloudSerpent", heroSlug: "lili", heroName: "Li Li", name: "Cloud Serpent", icon: "k.png" },
      LiLiWindSerpent: { kind: "talent", nameId: "LiLiWindSerpent", heroSlug: "lili", heroName: "Li Li", name: "Wind Serpent", icon: "j.png" },
    };
    const mechanics = [{ slug: "blinded", name: "Blinded", category: "Crowd Control", primaryBehavior: "StormBlind", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["LiLiBlindingWind"]);
});

test("findMechanicApplications does not credit chance-enabled duplicate branches when the base ability owns the same effect", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="HoggerEzThroDynamite"><Effect value="HoggerEzThroDynamiteDirectHitSet" /></CAbilEffectTarget>
      <CEffectSet id="HoggerEzThroDynamiteDirectHitSet">
        <EffectArray value="HoggerEzThroDynamiteApplySlow" />
      </CEffectSet>
      <CEffectCreatePersistent id="HoggerEzThroDynamiteDenseBlastingPowderTalentOffsetPersistent">
        <Chance value="0" />
        <PeriodicEffectArray value="HoggerEzThroDynamiteDenseBlastingPowderTalentDirectHitSet" />
      </CEffectCreatePersistent>
      <CEffectSet id="HoggerEzThroDynamiteDenseBlastingPowderTalentDirectHitSet">
        <EffectArray value="HoggerEzThroDynamiteApplySlow" />
      </CEffectSet>
      <CEffectApplyBehavior id="HoggerEzThroDynamiteApplySlow"><Behavior value="HoggerEzThroDynamiteSlow" /></CEffectApplyBehavior>
      <CBehaviorBuff id="HoggerEzThroDynamiteSlow" parent="StormSlowParent" />
      <CBehaviorBuff id="StormSlowParent" />
      <CTalent id="HoggerDenseBlastingPowder">
        <Abil value="HoggerEzThroDynamite" />
        <AbilityModificationArray>
          <Modifications>
            <Catalog value="Effect" />
            <Entry value="HoggerEzThroDynamiteDenseBlastingPowderTalentOffsetPersistent" />
            <Field value="Chance" />
            <Value value="1.000000" />
          </Modifications>
        </AbilityModificationArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      HoggerEzThroDynamite: { kind: "ability", nameId: "HoggerEzThroDynamite", heroSlug: "hogger", heroName: "Hogger", name: "Ez-Thro Dynamite", icon: "i.png" },
      HoggerDenseBlastingPowder: { kind: "talent", nameId: "HoggerDenseBlastingPowder", heroSlug: "hogger", heroName: "Hogger", name: "Dense Blasting Powder", icon: "j.png" },
    };
    const mechanics = [{ slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["HoggerEzThroDynamite"]);
});

test("findMechanicApplications does not duplicate a base heroic through its pick talent", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="DehakaIsolation"><Effect value="DehakaIsolationSet" /></CAbilEffectTarget>
      <CEffectSet id="DehakaIsolationSet"><EffectArray value="DehakaIsolationApplyBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="DehakaIsolationApplyBehavior"><Behavior value="DehakaIsolationSilence" /></CEffectApplyBehavior>
      <CBehaviorBuff id="DehakaIsolationSilence" parent="StormSilence" />
      <CBehaviorBuff id="StormSilence" />
      <CTalent id="DehakaHeroicAbilityIsolation">
        <Abil value="DehakaIsolation" />
        <RankArray><BehaviorArray value="Ultimate1Unlocked" /></RankArray>
      </CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      DehakaIsolation: { kind: "ability", nameId: "DehakaIsolation", heroSlug: "dehaka", heroName: "Dehaka", name: "Isolation", icon: "i.png" },
      DehakaHeroicAbilityIsolation: { kind: "talent", nameId: "DehakaHeroicAbilityIsolation", heroSlug: "dehaka", heroName: "Dehaka", name: "Isolation", icon: "j.png" },
    };
    const mechanics = [{ slug: "silenced", name: "Silenced", category: "Crowd Control", primaryBehavior: "StormSilence", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["DehakaIsolation"]);
});

test("findMechanicApplications splits positive armor from armor reduction by polarity", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="AbathurToxicNest"><Effect value="AbathurToxicNestImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="AbathurToxicNestImpactSet"><EffectArray value="AbathurToxicNestArmorDebuffApplyBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="AbathurToxicNestArmorDebuffApplyBehavior">
        <ValidatorArray value="HasAbathurMasteryEnvenomedNestsToxicNest" />
        <Behavior value="AbathurToxicNestArmorDebuff" />
      </CEffectApplyBehavior>
      <CBehaviorBuff id="AbathurToxicNestArmorDebuff" parent="StormArmor"><BehaviorCategories index="DebuffVulnerable" value="1" /><ArmorModification><AllArmorBonus value="-10" /></ArmorModification></CBehaviorBuff>
      <CAbilEffectTarget id="JohannaIronSkin"><Effect value="JohannaIronSkinApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="JohannaIronSkinApplyBehavior"><Behavior value="JohannaIronSkinArmor" /></CEffectApplyBehavior>
      <CBehaviorBuff id="JohannaIronSkinArmor" parent="StormArmor"><ArmorModification><AllArmorBonus value="50" /></ArmorModification></CBehaviorBuff>
      <CAbilEffectTarget id="ValeeraCombatReadiness"><Effect value="ValeeraCombatReadinessApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="ValeeraCombatReadinessApplyBehavior"><Behavior value="ValeeraCombatReadinessArmor" /></CEffectApplyBehavior>
      <CBehaviorBuff id="ValeeraCombatReadinessArmor" parent="StormArmor"><ArmorModification><ArmorSet index="Hero"><ArmorMitigationTable index="Basic" value="75" /></ArmorSet></ArmorModification></CBehaviorBuff>
      <CAbilEffectTarget id="AnubarakHardenCarapace"><Effect value="AnubarakHardenCarapaceApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="AnubarakHardenCarapaceApplyBehavior"><Behavior value="AnubarakHardenCarapaceSpellArmor" /></CEffectApplyBehavior>
      <CBehaviorBuff id="AnubarakHardenCarapaceSpellArmor" parent="StormArmor"><ArmorModification><ArmorSet index="Hero"><ArmorMitigationTable index="Ability" value="40" /></ArmorSet></ArmorModification></CBehaviorBuff>
      <CAbilEffectTarget id="CassiaChargedStrikes"><Effect value="CassiaChargedStrikesApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="CassiaChargedStrikesApplyBehavior"><Behavior value="CassiaChargedStrikesPhysicalVulnerable" /></CEffectApplyBehavior>
      <CBehaviorBuff id="CassiaChargedStrikesPhysicalVulnerable" parent="StormArmor"><ArmorModification><ArmorSet index="Hero"><ArmorMitigationTable index="Basic" value="-15" /></ArmorSet></ArmorModification></CBehaviorBuff>
      <CAbilEffectTarget id="JainaArcaneIntellect"><Effect value="JainaArcaneIntellectApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="JainaArcaneIntellectApplyBehavior"><Behavior value="JainaArcaneIntellectMagicalVulnerable" /></CEffectApplyBehavior>
      <CBehaviorBuff id="JainaArcaneIntellectMagicalVulnerable" parent="StormArmor"><ArmorModification><ArmorSet index="Hero"><ArmorMitigationTable index="Ability" value="-20" /></ArmorSet></ArmorModification></CBehaviorBuff>
      <CBehaviorBuff id="StormArmor" />
      <CValidatorPlayerTalent id="HasAbathurMasteryEnvenomedNestsToxicNest"><Find value="1" /><Value value="AbathurMasteryEnvenomedNestsToxicNest" /></CValidatorPlayerTalent>
      <CTalent id="AbathurMasteryEnvenomedNestsToxicNest"><Abil value="AbathurToxicNest" /></CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      AbathurToxicNest: { kind: "ability", nameId: "AbathurToxicNest", heroSlug: "abathur", heroName: "Abathur", name: "Toxic Nest", icon: "i.png" },
      AbathurMasteryEnvenomedNestsToxicNest: { kind: "talent", nameId: "AbathurMasteryEnvenomedNestsToxicNest", heroSlug: "abathur", heroName: "Abathur", name: "Envenomed Nest", icon: "j.png" },
      JohannaIronSkin: { kind: "ability", nameId: "JohannaIronSkin", heroSlug: "johanna", heroName: "Johanna", name: "Iron Skin", icon: "k.png" },
      ValeeraCombatReadiness: { kind: "ability", nameId: "ValeeraCombatReadiness", heroSlug: "valeera", heroName: "Valeera", name: "Combat Readiness", icon: "l.png" },
      AnubarakHardenCarapace: { kind: "ability", nameId: "AnubarakHardenCarapace", heroSlug: "anubarak", heroName: "Anub'arak", name: "Harden Carapace", icon: "m.png" },
      CassiaChargedStrikes: { kind: "ability", nameId: "CassiaChargedStrikes", heroSlug: "cassia", heroName: "Cassia", name: "Charged Strikes", icon: "n.png" },
      JainaArcaneIntellect: { kind: "ability", nameId: "JainaArcaneIntellect", heroSlug: "jaina", heroName: "Jaina", name: "Arcane Intellect", icon: "o.png" },
    };
    const mechanics = [
      { slug: "armor", name: "Armor", category: "Armor", primaryBehavior: "StormArmor", sourceIds: [], armorPolarity: "increase", armorDamageKind: "regular" },
      { slug: "physical-armor", name: "Physical Armor", category: "Armor", primaryBehavior: "StormArmor", sourceIds: [], armorPolarity: "increase", armorDamageKind: "physical" },
      { slug: "magical-armor", name: "Magical Armor", category: "Armor", primaryBehavior: "StormArmor", sourceIds: [], armorPolarity: "increase", armorDamageKind: "magical" },
      { slug: "vulnerable", name: "Armor Reduction", category: "Armor", primaryBehavior: "StormArmor", sourceIds: [], armorPolarity: "decrease", armorDamageKind: "regular" },
      { slug: "physical-vulnerable", name: "Physical Armor Reduction", category: "Armor", primaryBehavior: "StormArmor", sourceIds: [], armorPolarity: "decrease", armorDamageKind: "physical" },
      { slug: "magical-vulnerable", name: "Magical Armor Reduction", category: "Armor", primaryBehavior: "StormArmor", sourceIds: [], armorPolarity: "decrease", armorDamageKind: "magical" },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["JohannaIronSkin"]);
  assert.deepEqual(result[1].entries.map((e) => e.nameId), ["ValeeraCombatReadiness"]);
  assert.deepEqual(result[2].entries.map((e) => e.nameId), ["AnubarakHardenCarapace"]);
  assert.deepEqual(result[3].entries.map((e) => e.nameId), ["AbathurMasteryEnvenomedNestsToxicNest"]);
  assert.deepEqual(result[4].entries.map((e) => e.nameId), ["CassiaChargedStrikes"]);
  assert.deepEqual(result[5].entries.map((e) => e.nameId), ["JainaArcaneIntellect"]);
});

test("findMechanicApplications includes explicit source behaviors and talent-granted buffs", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="AnaBioticGrenade"><Effect value="AnaBioticGrenadeAllyBuffApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="AnaBioticGrenadeAllyBuffApplyBehavior"><Behavior value="AnaBioticGrenadeAllyBuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="AnaBioticGrenadeAllyBuff" />
      <CTalent id="StitchesPatchworkCreation">
        <RankArray><BehaviorArray value="StitchesPatchworkCreationCarry" /></RankArray>
      </CTalent>
      <CBehaviorBuff id="StitchesPatchworkCreationCarry" />
      <CBehaviorBuff id="TalentBucketAmplifiedHealing" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      AnaBioticGrenade: { kind: "ability", nameId: "AnaBioticGrenade", heroSlug: "ana", heroName: "Ana", name: "Biotic Grenade", icon: "i.png" },
      StitchesPatchworkCreation: { kind: "talent", nameId: "StitchesPatchworkCreation", heroSlug: "stitches", heroName: "Stitches", name: "Patchwork Creation", icon: "j.png" },
    };
    const mechanics = [{ slug: "healing-increase", name: "Healing Increase", category: "Other", primaryBehavior: "TalentBucketAmplifiedHealing", sourceIds: ["TalentBucketAmplifiedHealing", "AnaBioticGrenadeAllyBuff", "StitchesPatchworkCreationCarry"] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["AnaBioticGrenade", "StitchesPatchworkCreation"]);
});

test("findMechanicApplications detects positive healing-received buffs", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <const id="$PositiveHealing" value="0.5" />
      <const id="$NegativeHealing" value="-0.4" />
      <CAbilEffectTarget id="VarianBannerOfDalaran"><Effect value="VarianBannerOfDalaranCreateUnit" /></CAbilEffectTarget>
      <CEffectCreateUnit id="VarianBannerOfDalaranCreateUnit"><SpawnEffect value="VarianBannerOfDalaranApplyTimedLifeDelayPersistent" /></CEffectCreateUnit>
      <CEffectCreatePersistent id="VarianBannerOfDalaranApplyTimedLifeDelayPersistent"><InitialEffect value="VarianBannerOfDalaranApplyTimedLife" /></CEffectCreatePersistent>
      <CEffectApplyBehavior id="VarianBannerOfDalaranApplyTimedLife"><Behavior value="VarianBannerOfDalaranTimedLife" /></CEffectApplyBehavior>
      <CBehaviorBuff id="VarianBannerOfDalaranTimedLife"><InitialEffect value="VarianBannerOfDalaranSearch" /></CBehaviorBuff>
      <CEffectEnumArea id="VarianBannerOfDalaranSearch"><AreaArray Effect="VarianBannerOfDalaranApplySet" /></CEffectEnumArea>
      <CEffectSet id="VarianBannerOfDalaranApplySet"><EffectArray value="VarianGloryToTheAllianceApplyAmplifiedHealing" /></CEffectSet>
      <CEffectApplyBehavior id="VarianGloryToTheAllianceApplyAmplifiedHealing">
        <ValidatorArray value="VarianBannersHasGloryToTheAlliance" />
        <Behavior value="VarianGloryToTheAllianceAmplifiedHealing" />
      </CEffectApplyBehavior>
      <CBehaviorBuff id="VarianGloryToTheAllianceAmplifiedHealing"><Modification><HealTakenAdditiveMultiplier index="Life" value="$PositiveHealing" /></Modification></CBehaviorBuff>
      <CBehaviorBuff id="VarianMortalStrikeDebuff"><Modification><HealTakenAdditiveMultiplier index="Life" value="$NegativeHealing" /></Modification></CBehaviorBuff>
      <CTalent id="HoggerHoggersJoggers"><RankArray><BehaviorArray value="HoggerHoggersJoggersCarry" /></RankArray></CTalent>
      <CBehaviorBuff id="HoggerHoggersJoggersCarry"><Modification><HealTakenAdditiveMultiplier index="Life" value="0.1" /></Modification></CBehaviorBuff>
      <CTalent id="LiLiBlessingsOfYulon"><Abil value="LiLiCloudSerpent" /></CTalent>
      <CBehaviorBuff id="LiLiCloudSerpentBlessingsOfYulonTalentBuff"><Modification><HealTakenAdditiveMultiplier index="Life" value="0.1" /></Modification></CBehaviorBuff>
      <CValidatorPlayerTalent id="VarianBannersHasGloryToTheAlliance"><Find value="1" /><Value value="VarianBannersGloryToTheAlliance" /></CValidatorPlayerTalent>
      <CTalent id="VarianBannersGloryToTheAlliance"><Abil value="VarianBannerOfDalaran" /></CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      VarianBannerOfDalaran: { kind: "ability", nameId: "VarianBannerOfDalaran", heroSlug: "varian", heroName: "Varian", name: "Banner of Dalaran", icon: "i.png" },
      VarianBannersGloryToTheAlliance: { kind: "talent", nameId: "VarianBannersGloryToTheAlliance", heroSlug: "varian", heroName: "Varian", name: "Glory to the Alliance", icon: "j.png" },
      HoggerHoggersJoggers: { kind: "talent", nameId: "HoggerHoggersJoggers", heroSlug: "hogger", heroName: "Hogger", name: "Hogger's Joggers", icon: "k.png" },
      LiLiBlessingsOfYulon: { kind: "talent", nameId: "LiLiBlessingsOfYulon", heroSlug: "li-li", heroName: "Li Li", name: "Blessings Of Yu'lon", icon: "l.png" },
    };
    const mechanics = [{ slug: "healing-increase", name: "Healing Increase", category: "Other", primaryBehavior: "TalentBucketAmplifiedHealing", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["HoggerHoggersJoggers", "LiLiBlessingsOfYulon", "VarianBannersGloryToTheAlliance"]);
});

test("findMechanicApplications detects attack speed modifiers by polarity", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="AlarakLightningSurge"><Effect value="AlarakLightningSurgeApplyAttackSpeed" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="AlarakLightningSurgeApplyAttackSpeed"><Behavior value="AlarakLightningSurgeAttackSpeedBuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="AlarakLightningSurgeAttackSpeedBuff"><Modification><AdditiveAttackSpeedFactor value="0.4" /></Modification></CBehaviorBuff>
      <CAbilEffectTarget id="MuradinThunderclap"><Effect value="MuradinThunderclapApplyAttackSpeedSlow" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="MuradinThunderclapApplyAttackSpeedSlow"><Behavior value="MuradinThunderclapAttackSpeedDebuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MuradinThunderclapAttackSpeedDebuff"><Modification><AdditiveAttackSpeedFactor value="-0.35" /></Modification></CBehaviorBuff>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      AlarakLightningSurge: { kind: "ability", nameId: "AlarakLightningSurge", heroSlug: "alarak", heroName: "Alarak", name: "Lightning Surge", icon: "i.png" },
      MuradinThunderclap: { kind: "ability", nameId: "MuradinThunderclap", heroSlug: "muradin", heroName: "Muradin", name: "Thunder Clap", icon: "j.png" },
    };
    const mechanics = [
      { slug: "attack-speed-increase", name: "Attack Speed Increase", category: "Offense", primaryBehavior: "", sourceIds: [], statModifier: "attack-speed", statPolarity: "increase" },
      { slug: "attack-speed-slow", name: "Attack Speed Slow", category: "Offense", primaryBehavior: "", sourceIds: [], statModifier: "attack-speed", statPolarity: "decrease" },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result.find((m) => m.slug === "attack-speed-increase").entries.map((e) => e.nameId), ["AlarakLightningSurge"]);
  assert.deepEqual(result.find((m) => m.slug === "attack-speed-slow").entries.map((e) => e.nameId), ["MuradinThunderclap"]);
});

test("findMechanicApplications credits shared active abilities to their generic talent", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CTalent id="GenericTalentImposingPresence">
        <Abil value="TalentImposingPresence" />
        <RankArray>
          <BehaviorArray value="TalentImposingPresenceCarry" />
          <BehaviorArray value="ImposingPresenceItem" />
        </RankArray>
      </CTalent>
      <CAbilEffectInstant id="TalentImposingPresence"><Effect value="TalentImposingPresenceActivatedSearch" /></CAbilEffectInstant>
      <CEffectEnumArea id="TalentImposingPresenceActivatedSearch"><AreaArray Effect="TalentImposingPresenceApplyBehaviorsSet" /></CEffectEnumArea>
      <CEffectSet id="TalentImposingPresenceApplyBehaviorsSet">
        <EffectArray value="TalentImposingPresenceApplyActivatedDebuff" />
        <EffectArray value="TalentImposingPresenceApplyActivatedSlowDebuff" />
      </CEffectSet>
      <CEffectApplyBehavior id="TalentImposingPresenceApplyActivatedSlowDebuff"><Behavior value="TalentImposingPresenceActivatedDebuffSlow" /></CEffectApplyBehavior>
      <CEffectApplyBehavior id="TalentImposingPresenceApplyActivatedDebuff"><Behavior value="TalentImposingPresenceActivatedDebuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="TalentImposingPresenceActivatedDebuffSlow" parent="StormSlowParent"><Modification><UnifiedMoveSpeedFactor value="-0.2" /></Modification></CBehaviorBuff>
      <CBehaviorBuff id="TalentImposingPresenceActivatedDebuff"><Modification><AdditiveAttackSpeedFactor value="-0.5" /></Modification></CBehaviorBuff>
      <CBehaviorBuff id="TalentImposingPresenceCarry" />
      <CBehaviorAbility id="ImposingPresenceItem" />
      <CBehaviorBuff id="StormSlowParent" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      GenericTalentImposingPresence: { kind: "talent", nameId: "GenericTalentImposingPresence", heroSlug: "muradin", heroName: "Muradin", name: "Imposing Presence", icon: "i.png" },
    };
    const mechanics = [
      { slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] },
      { slug: "attack-speed-slow", name: "Attack Speed Slow", category: "Offense", primaryBehavior: "", sourceIds: [], statModifier: "attack-speed", statPolarity: "decrease" },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result.find((m) => m.slug === "slowed").entries.map((e) => e.nameId), ["GenericTalentImposingPresence"]);
  assert.deepEqual(result.find((m) => m.slug === "attack-speed-slow").entries.map((e) => e.nameId), ["GenericTalentImposingPresence"]);
});

test("findMechanicApplications follows DamageResponse Handled effects back to talent carry buffs", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CTalent id="GenericTalentImposingPresence"><RankArray><BehaviorArray value="TalentImposingPresenceCarry" /></RankArray></CTalent>
      <CBehaviorBuff id="TalentImposingPresenceCarry">
        <DamageResponse><Handled value="TalentImposingPresenceApplyDamageResponseBehavior" /></DamageResponse>
      </CBehaviorBuff>
      <CEffectApplyBehavior id="TalentImposingPresenceApplyDamageResponseBehavior"><Behavior value="TalentImposingPresenceDamageResponseDebuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="TalentImposingPresenceDamageResponseDebuff"><Modification><AdditiveAttackSpeedFactor value="-0.2" /></Modification></CBehaviorBuff>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      GenericTalentImposingPresence: { kind: "talent", nameId: "GenericTalentImposingPresence", heroSlug: "muradin", heroName: "Muradin", name: "Imposing Presence", icon: "i.png" },
    };
    const mechanics = [{ slug: "attack-speed-slow", name: "Attack Speed Slow", category: "Offense", primaryBehavior: "", sourceIds: [], statModifier: "attack-speed", statPolarity: "decrease" }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["GenericTalentImposingPresence"]);
});

test("findMechanicApplications keeps behavior identity when an active ability shares the same id", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CTalent id="GenericTalentIceBlock"><Abil value="TalentBucketIceBlock" /></CTalent>
      <CAbilBehavior id="TalentBucketIceBlock"><BehaviorArray value="TalentBucketIceBlock" /></CAbilBehavior>
      <CBehaviorBuff id="TalentBucketIceBlock" parent="StormStasisIceBlock" />
      <CBehaviorBuff id="StormStasisIceBlock" parent="StormStasis" />
      <CBehaviorBuff id="StormStasis" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      GenericTalentIceBlock: { kind: "talent", nameId: "GenericTalentIceBlock", heroSlug: "nazeebo", heroName: "Nazeebo", name: "Ice Block", icon: "i.png" },
    };
    const mechanics = [{ slug: "stasis", name: "Stasis", category: "Defense", primaryBehavior: "StormStasis", sourceIds: ["StormStasisIceBlock"] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["GenericTalentIceBlock"]);
});

test("findMechanicApplications promotes behavior parent chain when an ability shares the id with its own parent", () => {
  // Mirrors Leoric March of the Black King: CAbilEffectTarget id="X" parent="StormSkillshotDashParent"
  // collides with CBehaviorBuff id="X" parent="StormUnstoppableParent". The behavior's parent must win,
  // otherwise the unstoppable mechanic walk loses the chain entirely.
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="MarchAbility" parent="StormSkillshotDashParent"><Effect value="MarchApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="MarchApplyBehavior"><Behavior value="MarchBehavior" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MarchBehavior" parent="StormUnstoppableParent" />
      <CBehaviorBuff id="StormUnstoppableParent" />
      <CAbilEffectTarget id="StormSkillshotDashParent" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      MarchAbility: { kind: "ability", nameId: "MarchAbility", heroSlug: "leoric", heroName: "Leoric", name: "March", icon: "i.png", abilityType: "Heroic" },
    };
    const mechanics = [{ slug: "unstoppable", name: "Unstoppable", category: "Defense", primaryBehavior: "StormUnstoppableParent", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["MarchAbility"]);
  // And the same when the id is shared between the ability and the behavior themselves (the Leoric case).
  const files2 = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="March" parent="StormSkillshotDashParent"><Effect value="MarchApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="MarchApplyBehavior"><Behavior value="March" /></CEffectApplyBehavior>
      <CBehaviorBuff id="March" parent="StormUnstoppableParent" />
      <CBehaviorBuff id="StormUnstoppableParent" />
      <CAbilEffectTarget id="StormSkillshotDashParent" />
    </Catalog>`,
  }];
  const result2 = runGraph(files2, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      March: { kind: "ability", nameId: "March", heroSlug: "leoric", heroName: "Leoric", name: "March", icon: "i.png", abilityType: "Heroic" },
    };
    const mechanics = [{ slug: "unstoppable", name: "Unstoppable", category: "Defense", primaryBehavior: "StormUnstoppableParent", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result2[0].entries.map((e) => e.nameId), ["March"]);
});

test("findMechanicApplications follows behavior ability buttons to active apply effects", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CBehaviorAbility id="ImprovedIceBlock"><Buttons AbilCmd="JainaIceBlockActivate,Execute" /></CBehaviorAbility>
      <CAbilEffectInstant id="JainaIceBlockActivate"><Effect value="JainaImprovedIceBlockCastSet" /></CAbilEffectInstant>
      <CEffectSet id="JainaImprovedIceBlockCastSet"><EffectArray value="JainaImprovedIceBlockApplyBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="JainaImprovedIceBlockApplyBehavior"><Behavior value="JainaImprovedIceBlock" /></CEffectApplyBehavior>
      <CBehaviorBuff id="JainaImprovedIceBlock" parent="StormStasisIceBlock" />
      <CBehaviorBuff id="StormStasisIceBlock" parent="StormStasis" />
      <CBehaviorBuff id="StormStasis" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      ImprovedIceBlock: { kind: "ability", nameId: "ImprovedIceBlock", heroSlug: "jaina", heroName: "Jaina", name: "Improved Ice Block", icon: "j.png" },
    };
    const mechanics = [{ slug: "stasis", name: "Stasis", category: "Defense", primaryBehavior: "StormStasis", sourceIds: ["StormStasisIceBlock"] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["ImprovedIceBlock"]);
});

test("findMechanicApplications splits damage modifiers by damage kind and polarity", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="ZuljinHeadhunter"><Effect value="ZuljinHeadhunterApplyCarry" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="ZuljinHeadhunterApplyCarry"><Behavior value="ZuljinHeadhunterCarry" /></CEffectApplyBehavior>
      <CBehaviorBuff id="ZuljinHeadhunterCarry">
        <Modification>
          <DamageDealtScaled index="Basic" value="0"><AccumulatorArray value="ZuljinHeadhunterDamageAccumulator" /></DamageDealtScaled>
          <DamageDealtScaled index="Ability" value="0"><AccumulatorArray value="ZuljinHeadhunterDamageAccumulator" /></DamageDealtScaled>
        </Modification>
      </CBehaviorBuff>
      <CAccumulatorToken id="ZuljinHeadhunterDamageAccumulator"><Scale value="0.025" /></CAccumulatorToken>
      <CAbilEffectTarget id="TyrandeSentinel"><Effect value="TyrandeSentinelApplyHarshMoonlight" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="TyrandeSentinelApplyHarshMoonlight"><ValidatorArray value="TyrandeHasHarshMoonlightTalent" /><Behavior value="TyrandeSentinelHarshMoonlightTalentDamageReduction" /></CEffectApplyBehavior>
      <CBehaviorBuff id="TyrandeSentinelHarshMoonlightTalentDamageReduction"><Modification><DamageDealtFraction index="Basic" value="-0.4" /><DamageDealtFraction index="Ability" value="-0.4" /></Modification></CBehaviorBuff>
      <CAbilEffectTarget id="FirebatIgnite"><Effect value="FirebatIgniteApplyMeltdown" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="FirebatIgniteApplyMeltdown"><Behavior value="FirebatIgniteMeltdownDebuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="FirebatIgniteMeltdownDebuff">
        <Modification>
          <DamageDealtFraction index="Basic" value="0"><AccumulatorArray value="FirebatIgniteMeltdownDamageAccumulator" /></DamageDealtFraction>
          <DamageDealtFraction index="Ability" value="0"><AccumulatorArray value="FirebatIgniteMeltdownDamageAccumulator" /></DamageDealtFraction>
        </Modification>
      </CBehaviorBuff>
      <CAccumulatorToken id="FirebatIgniteMeltdownDamageAccumulator"><Scale value="-0.08" /></CAccumulatorToken>
      <CAbilEffectTarget id="MuradinGiveEmTheAxe"><Effect value="MuradinGiveEmTheAxeExecutionerApply" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="MuradinGiveEmTheAxeExecutionerApply"><Behavior value="MuradinGiveEmTheAxeExecutionerBuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MuradinGiveEmTheAxeExecutionerBuff"><Modification><DamageDealtFraction index="Basic" value="0.5" /><DamageDealtFraction index="Splash" value="0.5" /></Modification></CBehaviorBuff>
      <CAbilEffectTarget id="AnaMindNumbingAgent"><Effect value="AnaMindNumbingAgentApply" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="AnaMindNumbingAgentApply"><Behavior value="AnaMindNumbingAgentDebuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="AnaMindNumbingAgentDebuff"><Modification><DamageDealtFraction index="Ability" value="-0.5" /></Modification></CBehaviorBuff>
      <CValidatorPlayerTalent id="TyrandeHasHarshMoonlightTalent"><Find value="1" /><Value value="TyrandeHarshMoonlight" /></CValidatorPlayerTalent>
      <CTalent id="TyrandeHarshMoonlight"><Abil value="TyrandeSentinel" /></CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      ZuljinHeadhunter: { kind: "talent", nameId: "ZuljinHeadhunter", heroSlug: "zuljin", heroName: "Zul'jin", name: "Headhunter", icon: "i.png" },
      TyrandeSentinel: { kind: "ability", nameId: "TyrandeSentinel", heroSlug: "tyrande", heroName: "Tyrande", name: "Sentinel", icon: "j.png" },
      TyrandeHarshMoonlight: { kind: "talent", nameId: "TyrandeHarshMoonlight", heroSlug: "tyrande", heroName: "Tyrande", name: "Harsh Moonlight", icon: "k.png" },
      FirebatIgnite: { kind: "talent", nameId: "FirebatIgnite", heroSlug: "blaze", heroName: "Blaze", name: "Meltdown", icon: "n.png" },
      MuradinGiveEmTheAxe: { kind: "talent", nameId: "MuradinGiveEmTheAxe", heroSlug: "muradin", heroName: "Muradin", name: "Give 'em the Axe!", icon: "l.png" },
      AnaMindNumbingAgent: { kind: "talent", nameId: "AnaMindNumbingAgent", heroSlug: "ana", heroName: "Ana", name: "Mind-Numbing Agent", icon: "m.png" },
    };
    const mechanics = [
      { slug: "damage-increase", name: "Damage Increase", category: "Offense", primaryBehavior: "", sourceIds: [], statModifier: "damage", statPolarity: "increase", statDamageKind: "general" },
      { slug: "damage-reduction", name: "Damage Reduction", category: "Offense", primaryBehavior: "", sourceIds: [], statModifier: "damage", statPolarity: "decrease", statDamageKind: "general" },
      { slug: "physical-damage-increase", name: "Physical Damage Increase", category: "Offense", primaryBehavior: "", sourceIds: [], statModifier: "damage", statPolarity: "increase", statDamageKind: "physical" },
      { slug: "spell-power-reduction", name: "Spell Power Reduction", category: "Offense", primaryBehavior: "", sourceIds: [], statModifier: "damage", statPolarity: "decrease", statDamageKind: "spell" },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result.find((m) => m.slug === "damage-increase").entries.map((e) => e.nameId), ["ZuljinHeadhunter"]);
  assert.deepEqual(result.find((m) => m.slug === "damage-reduction").entries.map((e) => e.nameId), ["FirebatIgnite", "TyrandeHarshMoonlight"]);
  assert.deepEqual(result.find((m) => m.slug === "physical-damage-increase").entries.map((e) => e.nameId), ["MuradinGiveEmTheAxe"]);
  assert.deepEqual(result.find((m) => m.slug === "spell-power-reduction").entries.map((e) => e.nameId), ["AnaMindNumbingAgent"]);
});

test("findMechanicApplications classifies lifesteal by effect parent and validator gates", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="TracerHeroWeapon"><Effect value="TracerHeroWeaponDamageHero" /></CAbilEffectTarget>
      <CEffectDamage id="TracerHeroWeaponDamageHero" parent="StormWeapon">
        <LeechFraction index="Life" value="0.1" />
      </CEffectDamage>
      <CEffectDamage id="TracerHeroWeaponFocusFireMasteryDamageHero" parent="StormWeapon">
        <LeechFraction index="Life" value="0.1" />
      </CEffectDamage>
      <CAbilEffectTarget id="MephistoSkullMissile"><Effect value="MephistoSkullMissileDamage" /></CAbilEffectTarget>
      <CEffectDamage id="MephistoSkullMissileDamage" parent="StormSpell">
        <LeechFraction index="Life" value="0.7" />
        <LeechValidator index="Life" value="MephistoSkullMissileHatefulMendingCombine" />
      </CEffectDamage>
      <CAbilEffectTarget id="ButchersBrand"><Effect value="ButchersBrandApplyLifeLeech" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="ButchersBrandApplyLifeLeech"><Behavior value="ButchersBrandLifestealBehavior" /></CEffectApplyBehavior>
      <CBehaviorBuff id="ButchersBrandLifestealBehavior"><Modification><VitalDamageLeechArray index="Life"><KindArray index="Basic" value="0.75" /></VitalDamageLeechArray></Modification></CBehaviorBuff>
      <CTalent id="IllidanCombatStyleHuntersOnslaught"><RankArray><BehaviorArray Link="IllidanHuntersOnslaughtLifeLeech" /></RankArray></CTalent>
      <CBehaviorBuff id="IllidanHuntersOnslaughtLifeLeech"><Modification><VitalDamageLeechArray index="Life"><KindArray index="Ability" value="0.35" /></VitalDamageLeechArray></Modification></CBehaviorBuff>
      <CAbilEffectTarget id="HoggerHeroWeapon"><Effect value="HoggerHeroWeaponDamage" /></CAbilEffectTarget>
      <CEffectDamage id="HoggerHeroWeaponDamage" parent="StormWeapon">
        <LeechFraction index="Life" value="0.33" />
        <LeechValidator index="Life" value="HoggerBloodthirstProcCombine" />
      </CEffectDamage>
      <CAbilEffectTarget id="AmbiguousLeech"><Effect value="AmbiguousLeechDamage" /></CAbilEffectTarget>
      <CEffectDamage id="AmbiguousLeechDamage"><LeechFraction index="Life" value="0.2" /></CEffectDamage>
      <CEffectDamage id="StormWeapon" />
      <CEffectDamage id="StormSpell" />
      <CValidatorCombine id="MephistoSkullMissileHatefulMendingCombine"><CombineArray value="MephistoHasHatefulMending" /></CValidatorCombine>
      <CValidatorPlayerTalent id="MephistoHasHatefulMending"><Find value="1" /><Value value="MephistoHatefulMending" /></CValidatorPlayerTalent>
      <CValidatorCombine id="HoggerBloodthirstProcCombine"><CombineArray value="HoggerHasBloodthirstTalent" /></CValidatorCombine>
      <CValidatorPlayerTalent id="HoggerHasBloodthirstTalent"><Find value="1" /><Value value="HoggerBloodthirst" /></CValidatorPlayerTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      TracerReload: { kind: "ability", nameId: "TracerReload", heroSlug: "tracer", heroName: "Tracer", name: "Reload", icon: "i.png", abilityType: "Trait" },
      TracerFocusFire: { kind: "talent", nameId: "TracerFocusFire", heroSlug: "tracer", heroName: "Tracer", name: "Focus Fire", icon: "j.png" },
      MephistoSkullMissile: { kind: "ability", nameId: "MephistoSkullMissile", heroSlug: "mephisto", heroName: "Mephisto", name: "Skull Missile", icon: "k.png" },
      MephistoHatefulMending: { kind: "talent", nameId: "MephistoHatefulMending", heroSlug: "mephisto", heroName: "Mephisto", name: "Hateful Mending", icon: "l.png" },
      ButchersBrand: { kind: "ability", nameId: "ButchersBrand", heroSlug: "the-butcher", heroName: "The Butcher", name: "Butcher's Brand", icon: "n.png", abilityType: "W" },
      IllidanCombatStyleHuntersOnslaught: { kind: "talent", nameId: "IllidanCombatStyleHuntersOnslaught", heroSlug: "illidan", heroName: "Illidan", name: "Hunter's Onslaught", icon: "o.png" },
      HoggerBloodthirst: { kind: "talent", nameId: "HoggerBloodthirst", heroSlug: "hogger", heroName: "Hogger", name: "Bloodthirst", icon: "p.png" },
      AmbiguousLeech: { kind: "ability", nameId: "AmbiguousLeech", heroSlug: "x", heroName: "Hero", name: "Ambiguous", icon: "m.png" },
    };
    const mechanics = [
      { slug: "physical-lifesteal", name: "Physical Lifesteal", category: "Offense", primaryBehavior: "", sourceIds: [], statModifier: "lifesteal", statDamageKind: "physical" },
      { slug: "spell-lifesteal", name: "Spell Lifesteal", category: "Offense", primaryBehavior: "", sourceIds: [], statModifier: "lifesteal", statDamageKind: "spell" },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result.find((m) => m.slug === "physical-lifesteal").entries.map((e) => e.nameId), ["HoggerBloodthirst", "ButchersBrand", "TracerReload"]);
  assert.deepEqual(result.find((m) => m.slug === "spell-lifesteal").entries.map((e) => e.nameId), ["IllidanCombatStyleHuntersOnslaught", "MephistoHatefulMending"]);
});

test("findMechanicApplications filters Hogger missile time-stop controllers", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="HoggerHoggWild"><Effect value="HoggerHoggWildApplyMissileTimeStopController" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="HoggerHoggWildApplyMissileTimeStopController"><Behavior value="HoggerHoggWildMissileTimeStopController" /></CEffectApplyBehavior>
      <CBehaviorBuff id="HoggerHoggWildMissileTimeStopController" parent="StormTimeStopParent" />
      <CAbilEffectTarget id="LeoricWraithWalk"><Effect value="HeroGenericTimeStopApplyBehavior" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="HeroGenericTimeStopApplyBehavior"><Behavior value="HeroGenericTimeStop" /></CEffectApplyBehavior>
      <CBehaviorBuff id="HeroGenericTimeStop" parent="StormTimeStopParent" />
      <CAbilEffectTarget id="MedivhLeyLineSeal"><Effect value="MedivhLeyLineSealApplyTimeStop" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="MedivhLeyLineSealApplyTimeStop"><Behavior value="MedivhLeyLineSealTimeStop" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MedivhLeyLineSealTimeStop" parent="StormTimeStopParent" />
      <CAbilEffectTarget id="MedivhLeyLineSealMedivhCheats"><Effect value="MedivhLeyLineSealApplyTimeStop" /></CAbilEffectTarget>
      <CAbilEffectTarget id="ChromieTimeTrap"><Effect value="ChromieTimeTrapApplyTimeStop" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="ChromieTimeTrapApplyTimeStop"><Behavior value="ChromieTimeTrapTimeStop" /></CEffectApplyBehavior>
      <CBehaviorBuff id="ChromieTimeTrapTimeStop" parent="StormTimeStopParent" />
      <CAbilEffectInstant id="ChromieTimeTrapDetonate"><Effect value="ChromieTimeTrapApplyTimeStop" /></CAbilEffectInstant>
      <CBehaviorBuff id="StormTimeStopParent" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      HoggerHoggWild: { kind: "ability", nameId: "HoggerHoggWild", heroSlug: "hogger", heroName: "Hogger", name: "Hogg Wild", icon: "i.png" },
      LeoricWraithWalk: { kind: "ability", nameId: "LeoricWraithWalk", heroSlug: "leoric", heroName: "Leoric", name: "Wraith Walk", icon: "k.png" },
      MedivhLeyLineSeal: { kind: "ability", nameId: "MedivhLeyLineSeal", heroSlug: "medivh", heroName: "Medivh", name: "Ley Line Seal", icon: "j.png" },
      MedivhLeyLineSealMedivhCheats: { kind: "ability", nameId: "MedivhLeyLineSealMedivhCheats", heroSlug: "medivh", heroName: "Medivh", name: "Redirect Ley Line Seal", icon: "l.png" },
      ChromieTimeTrap: { kind: "ability", nameId: "ChromieTimeTrap", heroSlug: "chromie", heroName: "Chromie", name: "Time Trap", icon: "m.png" },
      ChromieTimeTrapDetonate: { kind: "ability", nameId: "ChromieTimeTrapDetonate", heroSlug: "chromie", heroName: "Chromie", name: "Detonate Time Trap", icon: "n.png" },
    };
    const mechanics = [{ slug: "time-stop", name: "Time Stop", category: "Crowd Control", primaryBehavior: "StormTimeStopParent", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["ChromieTimeTrap", "MedivhLeyLineSeal"]);
});

test("findMechanicApplications filters known implementation-detail entries", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="IllidanDive"><Effect value="IllidanDiveImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="IllidanDiveImpactSet"><EffectArray value="IllidanDiveFlipApplyStunBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="IllidanDiveFlipApplyStunBehavior"><Behavior value="IllidanDiveSlow" /></CEffectApplyBehavior>
      <CBehaviorBuff id="IllidanDiveSlow" parent="StormSlowParent" />
      <CBehaviorBuff id="StormSlowParent" />
      <CTalent id="IllidanMasteryFriendOrFoeDive"><Abil value="IllidanDive" /></CTalent>

      <CAbilEffectTarget id="HoggerEzThroDynamite"><Effect value="HoggerEzThroDynamiteImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="HoggerEzThroDynamiteImpactSet"><EffectArray value="HoggerEzThroDynamiteApplySlow" /></CEffectSet>
      <CEffectApplyBehavior id="HoggerEzThroDynamiteApplySlow" parent="StormSlowApply"><Behavior value="HoggerEzThroDynamiteSlow" /></CEffectApplyBehavior>
      <CBehaviorBuff id="HoggerEzThroDynamiteSlow" parent="StormSlowParent" />
      <CTalent id="HoggerSecretStash"><Abil value="HoggerHoardapult" /></CTalent>

      <CAbilEffectTarget id="LeoricSkeletalSwingTargetedReady"><Effect value="LeoricSkeletalSwingSwingImpactSwitch" /></CAbilEffectTarget>
      <CEffectSwitch id="LeoricSkeletalSwingSwingImpactSwitch">
        <CaseArray Validator="LeoricHasUndying" Effect="LeoricUndyingApplySlow" />
        <CaseDefault value="LeoricSkeletalSwingSwingImpactSet" />
      </CEffectSwitch>
      <CEffectSet id="LeoricSkeletalSwingSwingImpactSet"><EffectArray value="LeoricSkeletalSwingApplySlow" /></CEffectSet>
      <CEffectApplyBehavior id="LeoricSkeletalSwingApplySlow" parent="StormSlowApply"><Behavior value="LeoricSkeletalSwingSlow" /></CEffectApplyBehavior>
      <CEffectApplyBehavior id="LeoricUndyingApplySlow" parent="StormSlowApply"><Behavior value="LeoricUndyingSlow" /></CEffectApplyBehavior>
      <CBehaviorBuff id="LeoricSkeletalSwingSlow" parent="StormSlowParent" />
      <CBehaviorBuff id="LeoricUndyingSlow" parent="StormSlowParent" />

      <CAbilEffectTarget id="ZaryaExpulsionZone"><Effect value="ZaryaExpulsionZoneImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="ZaryaExpulsionZoneImpactSet"><EffectArray value="ZaryaExpulsionZoneSlowApplyBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="ZaryaExpulsionZoneSlowApplyBehavior" parent="StormSlowApply"><Behavior value="ZaryaExpulsionZoneSlow" /></CEffectApplyBehavior>
      <CBehaviorBuff id="ZaryaExpulsionZoneSlow" parent="StormSlowParent" />
      <CTalent id="ZaryaExpulsionZoneClearOut"><Abil value="ZaryaExpulsionZone" /></CTalent>

      <CAbilEffectTarget id="SylvanasWailingArrow"><Effect value="SylvanasWailingArrowImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="SylvanasWailingArrowImpactSet"><EffectArray value="StylvanasBlackArrowsMercMinionOrStructureStunApplyBehavior" /></CEffectSet>
      <CEffectApplyBehavior id="StylvanasBlackArrowsMercMinionOrStructureStunApplyBehavior"><Behavior value="SylvanasBlackArrowsMercMinionOrStructureStunBehavior" /></CEffectApplyBehavior>
      <CBehaviorBuff id="SylvanasBlackArrowsMercMinionOrStructureStunBehavior" parent="StormStun" />
      <CBehaviorBuff id="StormStun" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      IllidanDive: { kind: "ability", nameId: "IllidanDive", heroSlug: "illidan", heroName: "Illidan", name: "Dive", icon: "i.png" },
      IllidanMasteryFriendOrFoeDive: { kind: "talent", nameId: "IllidanMasteryFriendOrFoeDive", heroSlug: "illidan", heroName: "Illidan", name: "Friend or Foe", icon: "j.png" },
      HoggerEzThroDynamite: { kind: "ability", nameId: "HoggerEzThroDynamite", heroSlug: "hogger", heroName: "Hogger", name: "Ez-Thro Dynamite", icon: "h.png" },
      HoggerSecretStash: { kind: "talent", nameId: "HoggerSecretStash", heroSlug: "hogger", heroName: "Hogger", name: "Secret Stash", icon: "s.png" },
      LeoricSkeletalSwingTargetedReady: { kind: "ability", nameId: "LeoricSkeletalSwingTargetedReady", buttonId: "LeoricSkeletalSwing", heroSlug: "leoric", heroName: "Leoric", name: "Skeletal Swing", icon: "l.png", abilityType: "Q" },
      LeoricUndyingTrait: { kind: "ability", nameId: "LeoricUndyingTrait", buttonId: "LeoricUndyingTrait", heroSlug: "leoric", heroName: "Leoric", name: "Undying", icon: "m.png", abilityType: "Trait" },
      SylvanasWailingArrow: { kind: "ability", nameId: "SylvanasWailingArrow", heroSlug: "sylvanas", heroName: "Sylvanas", name: "Wailing Arrow", icon: "k.png" },
      ZaryaExpulsionZone: { kind: "ability", nameId: "ZaryaExpulsionZone", heroSlug: "zarya", heroName: "Zarya", name: "Expulsion Zone", icon: "z.png" },
      ZaryaExpulsionZoneClearOut: { kind: "talent", nameId: "ZaryaExpulsionZoneClearOut", heroSlug: "zarya", heroName: "Zarya", name: "Clear Out", icon: "c.png" },
    };
    const mechanics = [
      { slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] },
      { slug: "stunned", name: "Stunned", category: "Crowd Control", primaryBehavior: "StormStun", sourceIds: [] },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result.find((m) => m.slug === "slowed").entries.map((e) => e.nameId), [
    "HoggerEzThroDynamite",
    "IllidanDive",
    "LeoricSkeletalSwingTargetedReady",
    "ZaryaExpulsionZone",
  ]);
  assert.deepEqual(result.find((m) => m.slug === "stunned").entries.map((e) => e.nameId), []);
});

test("findMechanicApplications hides cancel ability entries", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="L90ETCMoshPit"><Effect value="L90ETCMoshPitApplyStunBehavior" /></CAbilEffectTarget>
      <CAbilEffectInstant id="L90ETCMoshPitCancel"><Effect value="L90ETCMoshPitApplyStunBehavior" /></CAbilEffectInstant>
      <CAbilEffectInstant id="CancelSanctification"><Effect value="TyraelSanctificationApplyUnstoppable" /></CAbilEffectInstant>
      <CEffectApplyBehavior id="L90ETCMoshPitApplyStunBehavior"><Behavior value="L90ETCMoshPitStun" /></CEffectApplyBehavior>
      <CBehaviorBuff id="L90ETCMoshPitStun" parent="StormStun" />
      <CBehaviorBuff id="StormStun" />
      <CEffectApplyBehavior id="TyraelSanctificationApplyUnstoppable"><Behavior value="TyraelSanctificationUnstoppable" /></CEffectApplyBehavior>
      <CBehaviorBuff id="TyraelSanctificationUnstoppable" parent="StormUnstoppableParent" />
      <CBehaviorBuff id="StormUnstoppableParent" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      L90ETCMoshPit: { kind: "ability", nameId: "L90ETCMoshPit", heroSlug: "etc", heroName: "E.T.C.", name: "Mosh Pit", icon: "i.png" },
      L90ETCMoshPitCancel: { kind: "ability", nameId: "L90ETCMoshPitCancel", heroSlug: "etc", heroName: "E.T.C.", name: "Mosh Pit Cancel", icon: "j.png" },
      CancelSanctification: { kind: "ability", nameId: "CancelSanctification", heroSlug: "tyrael", heroName: "Tyrael", name: "Cancel Sanctification", icon: "k.png" },
    };
    const mechanics = [
      { slug: "stunned", name: "Stunned", category: "Crowd Control", primaryBehavior: "StormStun", sourceIds: [] },
      { slug: "unstoppable", name: "Unstoppable", category: "Protection", primaryBehavior: "StormUnstoppableParent", sourceIds: [] },
    ];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result.find((m) => m.slug === "stunned").entries.map((e) => e.nameId), ["L90ETCMoshPit"]);
  assert.deepEqual(result.find((m) => m.slug === "unstoppable").entries.map((e) => e.nameId), []);
});

test("findMechanicApplications attributes packaged passive effects to their source", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="MalthaelDeathShroud"><Effect value="MalthaelDeathShroudImpactSet" /></CAbilEffectTarget>
      <CAbilEffectTarget id="MalthaelWraithStrike"><Effect value="MalthaelWraithStrikeImpactSet" /></CAbilEffectTarget>
      <CEffectSet id="MalthaelDeathShroudImpactSet"><EffectArray value="MalthaelReapersMarkApplySet" /></CEffectSet>
      <CEffectSet id="MalthaelWraithStrikeImpactSet"><EffectArray value="MalthaelReapersMarkApplySet" /></CEffectSet>
      <CEffectSet id="MalthaelReapersMarkApplySet">
        <EffectArray value="MalthaelReapersMarkApplyDebuffBehavior" />
        <EffectArray value="MalthaelReapersMarkApplyRevealBehavior" />
      </CEffectSet>
      <CEffectApplyBehavior id="MalthaelReapersMarkApplyDebuffBehavior"><Behavior value="MalthaelReapersMarkDebuff" /></CEffectApplyBehavior>
      <CEffectApplyBehavior id="MalthaelReapersMarkApplyRevealBehavior"><Behavior value="MalthaelReapersMarkReveal" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MalthaelReapersMarkDebuff" />
      <CBehaviorBuff id="MalthaelReapersMarkReveal" parent="StormReveal" />
      <CBehaviorBuff id="StormReveal" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      MalthaelDeathShroud: { kind: "ability", nameId: "MalthaelDeathShroud", heroSlug: "malthael", heroName: "Malthael", name: "Death Shroud", icon: "i.png" },
      MalthaelWraithStrike: { kind: "ability", nameId: "MalthaelWraithStrike", heroSlug: "malthael", heroName: "Malthael", name: "Wraith Strike", icon: "j.png" },
      MalthaelReapersMark: { kind: "ability", nameId: "MalthaelReapersMark", heroSlug: "malthael", heroName: "Malthael", name: "Reaper's Mark", icon: "k.png", abilityType: "Trait" },
    };
    const mechanics = [{ slug: "revealed", name: "Revealed", category: "Stealth and Vision", primaryBehavior: "StormReveal", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["MalthaelReapersMark"]);
});

test("findMechanicApplications does not attribute Malthael Touch of Death to Reaper's Mark", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectInstant id="MalthaelTouchOfDeath"><Effect value="MalthaelReapersMarkTouchOfDeathInitialSet" /></CAbilEffectInstant>
      <CEffectSet id="MalthaelReapersMarkTouchOfDeathInitialSet"><EffectArray value="MalthaelReapersMarkTouchOfDeathUnitTrackerEnum" /></CEffectSet>
      <CEffectEnumTrackedUnits id="MalthaelReapersMarkTouchOfDeathUnitTrackerEnum"><Effect value="MalthaelReapersMarkTouchOfDeathApplyBehavior" /></CEffectEnumTrackedUnits>
      <CEffectApplyBehavior id="MalthaelReapersMarkTouchOfDeathApplyBehavior"><Behavior value="MalthaelReapersMarkTouchOfDeathDebuff" /></CEffectApplyBehavior>
      <CBehaviorBuff id="MalthaelReapersMarkTouchOfDeathDebuff" parent="StormHealReduction">
        <Modification>
          <HealTakenAdditiveMultiplier index="Life" value="-0.5" />
          <VitalRegenMultiplier index="Life" value="-0.5" />
        </Modification>
      </CBehaviorBuff>
      <CBehaviorBuff id="StormHealReduction" />
      <CTalent id="MalthaelTouchOfDeath"><Abil value="MalthaelTouchOfDeath" /></CTalent>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      MalthaelTouchOfDeath: { kind: "talent", nameId: "MalthaelTouchOfDeath", buttonId: "MalthaelTouchOfDeath", heroSlug: "malthael", heroName: "Malthael", name: "Touch of Death", icon: "i.png", abilityType: "Active" },
      MalthaelReapersMark: { kind: "ability", nameId: "MalthaelReapersMark", buttonId: "MalthaelReapersMark", heroSlug: "malthael", heroName: "Malthael", name: "Reaper's Mark", icon: "k.png", abilityType: "Trait" },
    };
    const mechanics = [{ slug: "healing-reduction", name: "Healing Reduction", category: "Other", primaryBehavior: "StormHealReduction", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["MalthaelTouchOfDeath"]);
});

test("findMechanicApplications attributes trait packages by display-name alias", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectInstant id="RockstarDummy"><Effect value="RockstarDummyEffect" /></CAbilEffectInstant>
      <CAbilEffectTarget id="L90ETCFaceMelt"><Effect value="ETCAbilityCastSupplementalSet" /></CAbilEffectTarget>
      <CAbilEffectTarget id="L90ETCGuitarSolo"><Effect value="ETCAbilityCastSupplementalSet" /></CAbilEffectTarget>
      <CEffectSet id="ETCAbilityCastSupplementalSet"><EffectArray value="ETCRockstarApplyArmorBuff" /></CEffectSet>
      <CEffectApplyBehavior id="ETCRockstarApplyArmorBuff"><Behavior value="ETCRockstarArmor" /></CEffectApplyBehavior>
      <CBehaviorBuff id="ETCRockstarArmor" parent="StormArmor"><ArmorModification><AllArmorBonus value="25" /></ArmorModification></CBehaviorBuff>
      <CBehaviorBuff id="StormArmor" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      RockstarDummy: { kind: "ability", nameId: "RockstarDummy", buttonId: "L90ETCRockstar", heroSlug: "etc", heroName: "E.T.C.", name: "Rockstar", icon: "k.png", abilityType: "Trait" },
      L90ETCFaceMelt: { kind: "ability", nameId: "L90ETCFaceMelt", heroSlug: "etc", heroName: "E.T.C.", name: "Face Melt", icon: "i.png", abilityType: "W" },
      L90ETCGuitarSolo: { kind: "ability", nameId: "L90ETCGuitarSolo", heroSlug: "etc", heroName: "E.T.C.", name: "Guitar Solo", icon: "j.png", abilityType: "E" },
    };
    const mechanics = [{ slug: "armor", name: "Armor", category: "Armor", primaryBehavior: "StormArmor", sourceIds: [], armorPolarity: "increase" }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["RockstarDummy"]);
});

test("findMechanicApplications drops generically-named apply-effects with no matching anchor", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CEffectApplyBehavior id="StormSlowApply"><Behavior value="StormSlowParent" /></CEffectApplyBehavior>
      <CBehaviorBuff id="StormSlowParent" />
      <CAbilEffectTarget id="SomeHeroFoo"><Effect value="StormSlowApply" /></CAbilEffectTarget>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      SomeHeroFoo: { kind: "ability", nameId: "SomeHeroFoo", heroSlug: "h", heroName: "Hero", name: "Foo", icon: "i.png" },
    };
    const mechanics = [{ slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  assert.deepEqual(result[0].entries, []);
});

test("findMechanicApplications picks the reachable owner instead of guessing by prefix", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CAbilEffectTarget id="MuradinStormBolt"><Effect value="MuradinStormBoltStunApply" /></CAbilEffectTarget>
      <CEffectApplyBehavior id="MuradinStormBoltStunApply"><Behavior value="StormStun" /></CEffectApplyBehavior>
      <CEffectApplyBehavior id="MuradindataStunApply"><Behavior value="StormStun" /></CEffectApplyBehavior>
      <CBehaviorBuff id="StormStun" />
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const anchorToEntry = {
      MuradinStormBolt: { kind: "ability", nameId: "MuradinStormBolt", heroSlug: "muradin", heroName: "Muradin", name: "Bolt", icon: "i.png" },
      MuradinStorm: { kind: "ability", nameId: "MuradinStorm", heroSlug: "muradin", heroName: "Muradin", name: "Storm", icon: "j.png" },
      Muradin: { kind: "ability", nameId: "Muradin", heroSlug: "muradin", heroName: "Muradin", name: "Muradin", icon: "k.png" },
    };
    const mechanics = [{ slug: "stunned", name: "Stunned", category: "Crowd Control", primaryBehavior: "StormStun", sourceIds: [] }];
    return G.findMechanicApplications(g, anchorToEntry, mechanics);
  `);
  // MuradinStormBoltStunApply is reachable from MuradinStormBolt; MuradindataStunApply is not reachable from any anchor.
  assert.deepEqual(result[0].entries.map((e) => e.nameId), ["MuradinStormBolt"]);
});

test("buildEffectGraph ignores dangling references without throwing", () => {
  const ids = runGraph([HERO_XML], `
    const g = G.buildEffectGraph(files);
    return G.effectsApplyingBehavior(g, "StormStun").sort();
  `);
  assert.deepEqual(ids, []);
});

test("computeMechanicMembership: direct source ids are members", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CBehaviorBuff id="StormSlowParent"/>
      <CEffectApplyBehavior id="StormSlowApply"><Behavior value="StormSlowParent"/></CEffectApplyBehavior>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const mechanics = [{
      slug: "slowed", name: "Slowed", category: "Crowd Control",
      primaryBehavior: "StormSlowParent",
      sourceIds: ["StormSlowParent", "StormSlowApply"],
    }];
    const m = G.computeMechanicMembership(g, mechanics);
    return Object.fromEntries(m);
  `);
  assert.deepEqual(result["StormSlowParent"], ["slowed"]);
  assert.deepEqual(result["StormSlowApply"], ["slowed"]);
});

test("computeMechanicMembership: forward referrers via REF_FIELDS become members", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CBehaviorBuff id="StormSlowParent"/>
      <CEffectApplyBehavior id="StormSlowApply"><Behavior value="StormSlowParent"/></CEffectApplyBehavior>
      <CEffectApplyBehavior id="HeroSlowApply"><Behavior value="StormSlowParent"/></CEffectApplyBehavior>
      <CAbilEffectInstant id="HeroSkill"><Effect value="HeroSlowApply"/></CAbilEffectInstant>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const mechanics = [{
      slug: "slowed", name: "Slowed", category: "Crowd Control",
      primaryBehavior: "StormSlowParent",
      sourceIds: ["StormSlowParent", "StormSlowApply"],
    }];
    const m = G.computeMechanicMembership(g, mechanics);
    return Object.fromEntries(m);
  `);
  assert.deepEqual(result["HeroSlowApply"], ["slowed"]);
  assert.deepEqual(result["HeroSkill"], ["slowed"]);
});

test("computeMechanicMembership: a node belonging to multiple mechanics gets multiple slugs", () => {
  const files = [{
    path: "x.xml",
    content: `<Catalog>
      <CBehaviorBuff id="StormSlowParent"/>
      <CBehaviorBuff id="StormBlind"/>
      <CEffectApplyBehavior id="A"><Behavior value="StormSlowParent"/></CEffectApplyBehavior>
      <CEffectApplyBehavior id="B"><Behavior value="StormBlind"/></CEffectApplyBehavior>
      <CEffectSet id="Combo"><EffectArray value="A"/><EffectArray value="B"/></CEffectSet>
    </Catalog>`,
  }];
  const result = runGraph(files, `
    const g = G.buildEffectGraph(files);
    const mechanics = [
      { slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: ["StormSlowParent"] },
      { slug: "blinded", name: "Blinded", category: "Crowd Control", primaryBehavior: "StormBlind", sourceIds: ["StormBlind"] },
    ];
    const m = G.computeMechanicMembership(g, mechanics);
    return Object.fromEntries(m);
  `);
  const combo = result["Combo"] ?? [];
  assert.equal(combo.length, 2);
  assert.ok(combo.includes("slowed"));
  assert.ok(combo.includes("blinded"));
});
