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
