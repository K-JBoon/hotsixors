import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

// Classifies a catalog through the real gen script, the way gen-cross-references
// tests drive theirs.
function classify(catalog, ids) {
  const files = [{ path: "mods/heromods/test.stormmod/base.stormdata/gamedata/testdata.xml", content: `<Catalog>${catalog}</Catalog>` }];
  const script = `
    import { buildEffectGraph } from "./scripts/lib/effect-graph.ts";
    import { classifyMovement } from "./scripts/gen-replay-movement.ts";
    const graph = buildEffectGraph(${JSON.stringify(files)});
    console.log(JSON.stringify(classifyMovement(graph, ${JSON.stringify(ids)})));
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" },
  ));
}

test("a teleport that moves the caster is separated from one that moves the target", () => {
  const out = classify(
    `
      <CAbilEffectTarget id="TestBlink"><Effect value="TestBlinkTeleport"/></CAbilEffectTarget>
      <CEffectTeleport id="TestBlinkTeleport"><WhichUnit Value="Caster"/></CEffectTeleport>
      <CAbilEffectTarget id="TestYank"><Effect value="TestYankTeleport"/></CAbilEffectTarget>
      <CEffectTeleport id="TestYankTeleport"><TargetLocation Value="CasterUnit"/></CEffectTeleport>
    `,
    ["TestBlink", "TestYank"],
  );
  assert.equal(out.TestBlink, "caster-teleport");
  assert.equal(out.TestYank, "teleport");
});

test("the caster flag is inherited through parent effects", () => {
  const out = classify(
    `
      <CAbilEffectInstant id="TestHearth"><Effect value="TestHearthTeleport"/></CAbilEffectInstant>
      <CEffectTeleport id="TestTeleportBase"><WhichUnit Value="Source"/></CEffectTeleport>
      <CEffectTeleport id="TestHearthTeleport" parent="TestTeleportBase"/>
    `,
    ["TestHearth"],
  );
  assert.equal(out.TestHearth, "caster-teleport");
});

test("knockbacks read as dashes and abilities that move nothing are left out", () => {
  const out = classify(
    `
      <CAbilEffectTarget id="TestShove"><Effect value="TestShoveForce"/></CAbilEffectTarget>
      <CEffectApplyForce id="TestShoveForce"/>
      <CAbilEffectTarget id="TestBolt"><Effect value="TestBoltDamage"/></CAbilEffectTarget>
      <CEffectDamage id="TestBoltDamage"/>
    `,
    ["TestShove", "TestBolt"],
  );
  assert.equal(out.TestShove, "dash");
  assert.equal("TestBolt" in out, false);
});

test("a summoned unit's teleport does not make its summoner a blink", () => {
  const out = classify(
    `
      <CAbilEffectInstant id="TestSummon"><Effect value="TestSummonCreate"/></CAbilEffectInstant>
      <CEffectCreateUnit id="TestSummonCreate"><SpawnEffect value="TestMinionTeleport"/></CEffectCreateUnit>
      <CEffectTeleport id="TestMinionTeleport"><WhichUnit Value="Caster"/></CEffectTeleport>
    `,
    ["TestSummon"],
  );
  assert.equal("TestSummon" in out, false);
});
