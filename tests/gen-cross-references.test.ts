import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function runJoin(body) {
  const script = `
    import { buildCrossReferences } from "./scripts/gen-cross-references.ts";
    console.log(JSON.stringify((() => { ${body} })()));
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" },
  ));
}

test("buildCrossReferences joins graph + shortcode-data + mechanics into the output shape", () => {
  const files = [{
    path: "mods/heromods/muradin.stormmod/base.stormdata/gamedata/muradindata.xml",
    content: `
      <Catalog>
        <CEffectApplyBehavior id="MuradinStormBoltStunApply"><Behavior value="StormStun"/></CEffectApplyBehavior>
        <CBehaviorBuff id="StormStun"/>
        <CAbilEffectTarget id="MuradinStormBolt"><Effect value="MuradinStormBoltDamageSet"/></CAbilEffectTarget>
        <CEffectSet id="MuradinStormBoltDamageSet"><EffectArray value="MuradinStormBoltStunApply"/></CEffectSet>
      </Catalog>`,
  }];
  const shortcodeData = {
    MuradinStormBolt: { name: "Stormbolt", icon: "i.png", heroSlug: "muradin", heroName: "Muradin", xmlPath: "x", anchor: "MuradinStormBolt", type: "ability" },
    MuradinUnrelated: { name: "Unrelated", icon: "j.png", heroSlug: "muradin", heroName: "Muradin", xmlPath: "x", anchor: "MuradinUnrelated", type: "talent" },
  };
  const mechanics = [{ slug: "stunned", name: "Stunned", category: "Crowd Control", primaryBehavior: "StormStun", sourceIds: ["StormStun"] }];
  const out = runJoin(`
    return buildCrossReferences(${JSON.stringify(files)}, ${JSON.stringify(shortcodeData)}, ${JSON.stringify(mechanics)}, "9.9.9.99999");
  `);
  assert.equal(out.generatedFrom, "9.9.9.99999");
  assert.equal(out.mechanics.length, 1);
  assert.equal(out.mechanics[0].slug, "stunned");
  assert.deepEqual(out.mechanics[0].entries.map((e) => e.nameId), ["MuradinStormBolt"]);
  assert.equal(out.mechanics[0].entries[0].kind, "ability");
});

test("buildCrossReferences expands shared generic talent anchors to every hero copy", () => {
  const files = [{
    path: "mods/heroesdata.stormmod/base.stormdata/gamedata/shared.xml",
    content: `
      <Catalog>
        <CTalent id="GenericTalentImposingPresence"><Abil value="TalentImposingPresence"/></CTalent>
        <CAbilEffectInstant id="TalentImposingPresence"><Effect value="TalentImposingPresenceSearch"/></CAbilEffectInstant>
        <CEffectEnumArea id="TalentImposingPresenceSearch"><AreaArray Effect="TalentImposingPresenceApply"/></CEffectEnumArea>
        <CEffectApplyBehavior id="TalentImposingPresenceApply"><Behavior value="TalentImposingPresenceSlow"/></CEffectApplyBehavior>
        <CBehaviorBuff id="TalentImposingPresenceSlow" parent="StormSlowParent"/>
        <CBehaviorBuff id="StormSlowParent"/>
      </Catalog>`,
  }];
  const shortcodeData = {
    GenericTalentImposingPresence: { name: "Imposing Presence", icon: "i.png", heroSlug: "etc", heroName: "E.T.C.", xmlPath: "x", anchor: "GenericTalentImposingPresence", type: "talent" },
    "muradin:GenericTalentImposingPresence": { name: "Imposing Presence", icon: "i.png", heroSlug: "muradin", heroName: "Muradin", xmlPath: "x", anchor: "GenericTalentImposingPresence", type: "talent" },
  };
  const mechanics = [{ slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] }];
  const out = runJoin(`
    return buildCrossReferences(${JSON.stringify(files)}, ${JSON.stringify(shortcodeData)}, ${JSON.stringify(mechanics)}, "9.9.9.99999");
  `);
  assert.deepEqual(out.mechanics[0].entries.map((e) => `${e.heroName}:${e.nameId}`), [
    "E.T.C.:GenericTalentImposingPresence",
    "Muradin:GenericTalentImposingPresence",
  ]);
});

test("buildCrossReferences pairs amount and duration per behavior into instances", () => {
  const files = [{
    path: "chen.xml",
    content: `
      <Catalog>
        <CBehaviorBuff id="StormSlowParent"/>
        <CAbilEffectTarget id="ChenKegSmash"><Effect value="ChenKegSmashSet"/></CAbilEffectTarget>
        <CEffectSet id="ChenKegSmashSet"><EffectArray value="ChenSlowApply"/><EffectArray value="ChenBogApply"/></CEffectSet>
        <CEffectApplyBehavior id="ChenSlowApply"><Behavior value="ChenSlow"/></CEffectApplyBehavior>
        <CEffectApplyBehavior id="ChenBogApply"><Behavior value="ChenBog"/></CEffectApplyBehavior>
        <CBehaviorBuff id="ChenSlow" parent="StormSlowParent"><Duration value="1.25"/><Modification><UnifiedMoveSpeedFactor value="-0.1"/></Modification></CBehaviorBuff>
        <CBehaviorBuff id="ChenBog" parent="StormSlowParent"><Duration value="1.75"/><Modification><UnifiedMoveSpeedFactor value="-0.4"/></Modification></CBehaviorBuff>
        <CAbilEffectTarget id="ChenOther"><Effect value="ChenPermApply"/></CAbilEffectTarget>
        <CEffectApplyBehavior id="ChenPermApply"><Behavior value="ChenPerm"/></CEffectApplyBehavior>
        <CBehaviorBuff id="ChenPerm" parent="StormSlowParent"/>
      </Catalog>`,
  }];
  const shortcodeData = {
    ChenKegSmash: { name: "Keg Smash", icon: "k.png", heroSlug: "chen", heroName: "Chen", xmlPath: "x", anchor: "ChenKegSmash", type: "ability" },
    ChenOther: { name: "Other", icon: "o.png", heroSlug: "chen", heroName: "Chen", xmlPath: "x", anchor: "ChenOther", type: "ability" },
  };
  const mechanics = [{ slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] }];
  const out = runJoin(`
    return buildCrossReferences(${JSON.stringify(files)}, ${JSON.stringify(shortcodeData)}, ${JSON.stringify(mechanics)}, "x");
  `);
  const slowed = out.mechanics[0];
  assert.equal(slowed.amountUnit, "%");
  assert.equal(slowed.hasDuration, true);
  assert.deepEqual(slowed.entries.map((e) => [e.name, e.instances]), [
    ["Keg Smash", [{ amount: 10, unit: "%", duration: 1.25 }, { amount: 40, unit: "%", duration: 1.75 }]],
    ["Other", [{}]],
  ]);
  assert.equal(slowed.entries[0].values, undefined);
});

test("buildCrossReferences ranges stacking amounts up to one caster's stack cap", () => {
  const files = [{
    path: "hero.xml",
    content: `
      <Catalog>
        <CBehaviorBuff id="StormSlowParent"/>
        <CBehaviorBuff id="StormArmor"/>
        <CAbilEffectTarget id="HeroQ"><Effect value="HeroQSet"/></CAbilEffectTarget>
        <CEffectSet id="HeroQSet">
          <EffectArray value="HeroSlowApply"/><EffectArray value="HeroCappedApply"/>
          <EffectArray value="HeroBlockApply"/><EffectArray value="HeroArmorApply"/>
        </CEffectSet>
        <CEffectApplyBehavior id="HeroSlowApply"><Behavior value="HeroSlow"/></CEffectApplyBehavior>
        <CEffectApplyBehavior id="HeroCappedApply"><Behavior value="HeroCapped"/></CEffectApplyBehavior>
        <CEffectApplyBehavior id="HeroBlockApply"><Behavior value="HeroBlock"/></CEffectApplyBehavior>
        <CEffectApplyBehavior id="HeroArmorApply"><Behavior value="HeroArmor"/></CEffectApplyBehavior>
        <CBehaviorBuff id="HeroSlow" parent="StormSlowParent"><MaxStackCount value="8"/><Modification><UnifiedMoveSpeedFactor value="-0.05"/></Modification></CBehaviorBuff>
        <CBehaviorBuff id="HeroCapped" parent="StormSlowParent"><MaxStackCount value="10"/><MaxStackCountPerCaster value="1"/><Modification><UnifiedMoveSpeedFactor value="-0.3"/></Modification></CBehaviorBuff>
        <CBehaviorBuff id="HeroBlock" parent="StormArmor"><MaxStackCount value="2"/><ArmorModification><AllArmorBonus value="75"/></ArmorModification></CBehaviorBuff>
        <CBehaviorBuff id="HeroArmor" parent="StormArmor"><MaxStackCount value="48"/><ArmorModification StackCount="48"><AllArmorBonus value="0.625"/></ArmorModification></CBehaviorBuff>
      </Catalog>`,
  }];
  const shortcodeData = {
    HeroQ: { name: "Q", icon: "q.png", heroSlug: "hero", heroName: "Hero", xmlPath: "x", anchor: "HeroQ", type: "ability" },
  };
  const mechanics = [
    { slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] },
    { slug: "armor", name: "Armor", category: "Defensive Buffs", primaryBehavior: "StormArmor", sourceIds: ["StormArmor"], armorPolarity: "increase", armorDamageKind: "regular" },
  ];
  const out = runJoin(`
    return buildCrossReferences(${JSON.stringify(files)}, ${JSON.stringify(shortcodeData)}, ${JSON.stringify(mechanics)}, "x");
  `);
  const amounts = Object.fromEntries(out.mechanics.map((m) => [m.slug, m.entries[0].instances.map((i) => [i.amount, i.maxAmount ?? null])]));
  assert.deepEqual(amounts, {
    slowed: [[5, 40], [30, null]],
    armor: [[0.625, 30], [75, null]],
  });
});

test("buildCrossReferences ranges accumulator-scaled amounts to the accumulator's bounds", () => {
  const files = [{
    path: "hero.xml",
    content: `
      <Catalog>
        <CBehaviorBuff id="StormSlowParent"/>
        <CAccumulatorVitals default="1" id="BaseVitalAccumulator"><ApplicationRule value="Multiply"/></CAccumulatorVitals>
        <CAbilEffectTarget id="HeroQ"><Effect value="HeroQSet"/></CAbilEffectTarget>
        <CEffectSet id="HeroQSet">
          <EffectArray value="HeroStackApply"/><EffectArray value="HeroDecayApply"/><EffectArray value="HeroVitalApply"/>
        </CEffectSet>
        <CEffectApplyBehavior id="HeroStackApply"><Behavior value="HeroStackSlow"/></CEffectApplyBehavior>
        <CEffectApplyBehavior id="HeroDecayApply"><Behavior value="HeroDecaySlow"/></CEffectApplyBehavior>
        <CEffectApplyBehavior id="HeroVitalApply"><Behavior value="HeroVitalSlow"/></CEffectApplyBehavior>
        <CBehaviorTokenCounter id="HeroToken"><Max value="5"/></CBehaviorTokenCounter>
        <CAccumulatorToken id="HeroTokenAcc">
          <MinAccumulation value="-0.4"/><MaxAccumulation value="0"/><ApplicationRule value="Add"/>
          <TokenId value="HeroToken"/><Scale value="-0.08"/><Offset value="0.08"/>
        </CAccumulatorToken>
        <CAccumulatorTimed id="HeroTimedAcc"><MinAccumulation value="0"/><MaxAccumulation value="0.75"/><ApplicationRule value="Add"/></CAccumulatorTimed>
        <CAccumulatorVitals id="HeroVitalAcc" parent="BaseVitalAccumulator"><MaxAccumulation value="0"/><Ratio value="2"/></CAccumulatorVitals>
        <CBehaviorBuff id="HeroStackSlow" parent="StormSlowParent">
          <Modification><UnifiedMoveSpeedFactor value="-0.08"><AccumulatorArray value="HeroTokenAcc"/></UnifiedMoveSpeedFactor></Modification>
        </CBehaviorBuff>
        <CBehaviorBuff id="HeroDecaySlow" parent="StormSlowParent">
          <Modification><UnifiedMoveSpeedFactor value="-0.75"><AccumulatorArray value="HeroTimedAcc"/></UnifiedMoveSpeedFactor></Modification>
        </CBehaviorBuff>
        <CBehaviorBuff id="HeroVitalSlow" parent="StormSlowParent">
          <Modification><UnifiedMoveSpeedFactor value="-0.1"><AccumulatorArray value="HeroVitalAcc"/></UnifiedMoveSpeedFactor></Modification>
        </CBehaviorBuff>
        <CTalent id="HeroVitalTalent">
          <Abil value="HeroQ"/>
          <AbilityModificationArray><Modifications>
            <Type value="FlatModification"/><Catalog value="Accumulator"/><Entry value="HeroVitalAcc"/>
            <Field value="MaxAccumulation"/><Value value="2"/>
          </Modifications></AbilityModificationArray>
        </CTalent>
      </Catalog>`,
  }];
  const shortcodeData = {
    HeroQ: { name: "Q", icon: "q.png", heroSlug: "hero", heroName: "Hero", xmlPath: "x", anchor: "HeroQ", type: "ability" },
    HeroVitalTalent: { name: "Vital", icon: "v.png", heroSlug: "hero", heroName: "Hero", xmlPath: "x", anchor: "HeroVitalTalent", type: "talent" },
  };
  const mechanics = [{ slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] }];
  const out = runJoin(`
    return buildCrossReferences(${JSON.stringify(files)}, ${JSON.stringify(shortcodeData)}, ${JSON.stringify(mechanics)}, "x");
  `);
  const rows = Object.fromEntries(out.mechanics[0].entries.map((e) => [e.name, e.instances.map((i) => [i.amount, i.maxAmount ?? null, i.scales ?? null])]));
  assert.deepEqual(rows, {
    Q: [[0, 75, null], [8, 40, null], [10, null, null]],
    Vital: [[10, 30, null]],
  });
});

test("buildCrossReferences sets per-hero talent tier on each copy", () => {
  const files = [{
    path: "mods/heroesdata.stormmod/base.stormdata/gamedata/shared.xml",
    content: `
      <Catalog>
        <CTalent id="GenericTalentImposingPresence"><Abil value="TalentImposingPresence"/></CTalent>
        <CAbilEffectInstant id="TalentImposingPresence"><Effect value="TalentImposingPresenceApply"/></CAbilEffectInstant>
        <CEffectApplyBehavior id="TalentImposingPresenceApply"><Behavior value="TalentImposingPresenceSlow"/></CEffectApplyBehavior>
        <CBehaviorBuff id="TalentImposingPresenceSlow" parent="StormSlowParent"/>
        <CBehaviorBuff id="StormSlowParent"/>
      </Catalog>`,
  }];
  const shortcodeData = {
    GenericTalentImposingPresence: { name: "Imposing Presence", icon: "i.png", heroSlug: "etc", heroName: "E.T.C.", xmlPath: "x", anchor: "GenericTalentImposingPresence", type: "talent" },
    "muradin:GenericTalentImposingPresence": { name: "Imposing Presence", icon: "i.png", heroSlug: "muradin", heroName: "Muradin", xmlPath: "x", anchor: "GenericTalentImposingPresence", type: "talent" },
  };
  const mechanics = [{ slug: "slowed", name: "Slowed", category: "Crowd Control", primaryBehavior: "StormSlowParent", sourceIds: [] }];
  const heroes = {
    etc: { talentTiers: { GenericTalentImposingPresence: "level4" } },
    muradin: { talentTiers: { GenericTalentImposingPresence: "level7" } },
  };
  const out = runJoin(`
    return buildCrossReferences(${JSON.stringify(files)}, ${JSON.stringify(shortcodeData)}, ${JSON.stringify(mechanics)}, "9.9.9.99999", ${JSON.stringify(heroes)});
  `);
  assert.deepEqual(out.mechanics[0].entries.map((e) => `${e.heroSlug}:${e.talentTier}`), [
    "etc:level4",
    "muradin:level7",
  ]);
});

test("buildCrossReferences links mechanics whose behavior carries another's categories", () => {
  const files = [{
    path: "mods/heroesdata.stormmod/base.stormdata/gamedata/behaviordata.xml",
    content: `
      <Catalog>
        <CBehaviorBuff id="StormProtect"><BehaviorCategories index="Protected" value="1"/></CBehaviorBuff>
        <CBehaviorBuff id="StormShield" parent="StormProtect"><BehaviorCategories index="Protected" value="0"/></CBehaviorBuff>
        <CBehaviorBuff id="StormSilence"><BehaviorCategories index="DebuffSilence" value="1"/></CBehaviorBuff>
        <CBehaviorBuff id="StormPolymorph" parent="StormSilence"><BehaviorCategories index="Polymorph" value="1"/></CBehaviorBuff>
      </Catalog>`,
  }];
  const mechanic = (slug, primaryBehavior) => ({ slug, name: slug, category: "c", primaryBehavior, sourceIds: [] });
  const mechanics = [
    mechanic("protected", "StormProtect"),
    mechanic("shield", "StormShield"),
    mechanic("silenced", "StormSilence"),
    mechanic("polymorphed", "StormPolymorph"),
  ];
  const out = runJoin(`
    return buildCrossReferences(${JSON.stringify(files)}, {}, ${JSON.stringify(mechanics)}, "9.9.9.99999");
  `);
  const bySlug = Object.fromEntries(out.mechanics.map((m) => [m.slug, m]));
  assert.deepEqual(bySlug.polymorphed.includes.map((r) => r.slug), ["silenced"]);
  assert.deepEqual(bySlug.silenced.includedIn.map((r) => r.slug), ["polymorphed"]);
  assert.deepEqual(bySlug.shield.includes, []);
  assert.deepEqual(bySlug.protected.includedIn, []);
});
