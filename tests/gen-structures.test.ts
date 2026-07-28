import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

function generateStructuresData() {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/gen-structures.ts"],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );
  return JSON.parse(readFileSync(new URL("../site/data/structures.json", import.meta.url), "utf-8"));
}

test("structures data includes player-facing structure groups", () => {
  const data = generateStructuresData();
  const groupIds = data.groups.map((group) => group.id);

  assert.deepEqual(groupIds, [
    "core",
    "forts-and-keeps",
    "towers",
    "healing-fountains",
    "gates",
    "walls",
  ]);

  const allIds = data.groups.flatMap((group) => group.units.map((unit) => unit.id));
  assert.ok(allIds.includes("KingsCore"));
  assert.ok(allIds.includes("TownTownHallL2"));
  assert.ok(allIds.includes("TownTownHallL3"));
  assert.ok(allIds.includes("TownCannonTowerL2"));
  assert.ok(allIds.includes("TownMoonwellL2"));
  assert.ok(allIds.includes("TownGateL2"));
  assert.ok(allIds.includes("TownWallL2Parent"));
  assert.ok(data.groups.every((group) => group.units.every((unit) => !("context" in unit))));
});

test("structures data resolves core stats from XML", () => {
  const data = generateStructuresData();
  const coreGroup = data.groups.find((group) => group.id === "core");
  assert.ok(coreGroup);

  const core = coreGroup.units.find((unit) => unit.id === "KingsCore");
  assert.ok(core);
  assert.equal(core.hp, 14000);
  assert.equal(core.shields, 7000);
  assert.match(core.scaling, /Life \+400 per minute/);
  assert.match(core.scaling, /Shields \+200 per minute/);
  assert.deepEqual(core.scalingRows, [
    { label: "Life", summary: "+400/min" },
    { label: "Shields", summary: "+200/min" },
  ]);
  assert.ok(core.weapons.some((weapon) => weapon.id === "KingsCore" && weapon.damage === 220 && weapon.period === 1));
});

test("structures data resolves fort and tower stats from XML", () => {
  const data = generateStructuresData();
  const forts = data.groups.find((group) => group.id === "forts-and-keeps");
  const towers = data.groups.find((group) => group.id === "towers");
  assert.ok(forts);
  assert.ok(towers);

  const fort = forts.units.find((unit) => unit.id === "TownTownHallL2");
  const fortTower = towers.units.find((unit) => unit.id === "TownCannonTowerL2");
  assert.ok(fort);
  assert.ok(fortTower);
  assert.equal(fort.hp, 17380);
  assert.ok(fort.weapons.some((weapon) => weapon.id === "TownHallL2Weapon" && weapon.damage === 375 && weapon.range === 8));
  assert.equal(fortTower.hp, 4850);
  assert.equal(fortTower.killXp, 125);
  assert.ok(fortTower.weapons.some((weapon) => weapon.id === "GuardTowerL2Weapon" && weapon.damage === 250 && weapon.range === 7.75));
});
