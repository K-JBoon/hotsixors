import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

// Runs the real filter over a hand-made unit table, the way the movement tests
// drive their gen script.
function collect(units) {
  const script = `
    import { collectSummons } from "./scripts/gen-replay-summons.ts";
    console.log(JSON.stringify(collectSummons(${JSON.stringify(units)})));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf-8",
    })
  );
}

const summoned = (sight, portrait) => ({
  sight,
  attributes: ["Summoned"],
  portraits: portrait ? { targetInfo: portrait } : {},
});

test("a summoned unit with sight is kept, with its portrait", () => {
  const out = collect({ ZagaraHydralisk: summoned(9, "hydralisk.png") });
  assert.deepEqual(out, { ZagaraHydralisk: { sight: 9, portrait: "hydralisk.png" } });
});

test("units that are not summons, or see nothing, are dropped", () => {
  const out = collect({
    FootmanMinion: { sight: 8, attributes: [], portraits: {} },
    AbathurToxicNest: summoned(0, "nest.png"),
  });
  assert.deepEqual(out, {});
});

test("helper units that never appear as a body are dropped", () => {
  const out = collect({
    TinkerRockItTurretPlaceholderDummy: summoned(8),
    ThrallSunderingWorldbreakerPathingBlocker: summoned(3),
    TassadarForceWallArtUnitCenter: summoned(2.5),
    LeoricWraithWalkUnit: summoned(12),
    TinkerRockItTurret: summoned(8, "turret.png"),
  });
  assert.deepEqual(Object.keys(out), ["TinkerRockItTurret"]);
});

test("the shared placeholder portrait counts as no portrait", () => {
  const out = collect({ ZagaraBaneling: summoned(2, "storm_ui_ingame_hero_icon_placeholder.png") });
  assert.deepEqual(out, { ZagaraBaneling: { sight: 2 } });
});

const generated = new URL("../site/static/replay/summons.json", import.meta.url);

test("the generated table covers the summons a replay reports", { skip: !existsSync(generated) }, () => {
  const summons = JSON.parse(readFileSync(generated, "utf-8"));
  for (const id of [
    "ZagaraHydralisk",
    "ZagaraRoach",
    "ZagaraNydusWorm",
    "WitchDoctorZombieWallUnit",
    "WitchDoctorGargantuan",
    "TinkerRockItTurret",
    "AzmodanDemonWarrior",
    "NecromancerRaiseSkeleton",
    "AbathurLocustNormal",
    "JainaWaterElemental",
    "ProbiusPylon",
  ]) {
    assert.ok(summons[id], `${id} should be a summon with vision`);
    assert.ok(summons[id].sight > 0, `${id} should have a sight radius`);
  }
});
