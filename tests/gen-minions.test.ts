import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

function generateMinionsData() {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/gen-minions.ts"],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );
  return JSON.parse(readFileSync(new URL("../site/data/minions-and-mercs.json", import.meta.url), "utf-8"));
}

test("minions data includes Tomb-specific minions and Alterac Reavers", () => {
  const data = generateMinionsData();
  const variants = data.groups.find((group) => group.id === "battleground-variants");
  assert.ok(variants);

  const ids = variants.units.map((unit) => unit.id);
  assert.ok(ids.includes("RangedMinion"));
  assert.ok(ids.includes("SpectralMinion"));
  assert.ok(ids.includes("SoulPriest"));
  assert.ok(ids.includes("LostSoul"));
  assert.ok(ids.includes("ReaverMinion"));

  const alteracEntries = variants.units.filter((unit) => unit.context === "Alterac Pass");
  assert.deepEqual(alteracEntries.map((unit) => unit.id), ["ReaverMinion"]);
  assert.equal(alteracEntries.some((unit) => unit.id === "CatapultMinion"), false);
});

test("Tomb lane minions use the map's experience-globe XP override", () => {
  const data = generateMinionsData();
  const variants = data.groups.find((group) => group.id === "battleground-variants");
  assert.ok(variants);

  const tombRanged = variants.units.find((unit) => unit.id === "RangedMinion");
  assert.equal(tombRanged.killXp, 68);
  const spectral = variants.units.find((unit) => unit.id === "SpectralMinion");
  assert.equal(spectral.killXp, 68);
  const soulPriest = variants.units.find((unit) => unit.id === "SoulPriest");
  assert.equal(soulPriest.killXp, null);
});

test("minions data resolves core stats from XML", () => {
  const data = generateMinionsData();
  const standard = data.groups.find((group) => group.id === "standard-minions");
  assert.ok(standard);

  const footman = standard.units.find((unit) => unit.id === "FootmanMinion");
  assert.ok(footman);
  assert.equal(footman.hp, 990);
  assert.equal(footman.killXp, 80);
  assert.ok(footman.weapons.some((weapon) => weapon.id === "FootmanMinion" && weapon.period === 1.5));
});

test("mercenary defender XP uses map-specific overrides and veterancy scaling", () => {
  const data = generateMinionsData();
  const defenders = data.groups.find((group) => group.id === "mercenary-defenders");
  assert.ok(defenders);

  const fallenShaman = defenders.units.find((unit) => unit.id === "MercSummonerDefender");
  assert.ok(fallenShaman);
  assert.equal(fallenShaman.killXp, 450);
  assert.equal(fallenShaman.xpScalingSummary, "+6/min");

  const impaler = defenders.units.find((unit) => unit.id === "MercSiegeTrooperDefender");
  assert.ok(impaler);
  assert.equal(impaler.killXp, 90);
  assert.equal(impaler.xpScalingSummary, "+2/min");

  const siegeGiant = defenders.units.find((unit) => unit.id === "MercDefenderSiegeGiant");
  assert.ok(siegeGiant);
  assert.equal(siegeGiant.xpScalingSummary, "+2/min");

  const sentinel = defenders.units.find((unit) => unit.id === "MercDefenderSentinel");
  assert.ok(sentinel);
  assert.equal(sentinel.hp, 6500);
  assert.equal(sentinel.killXp, 530);
  assert.equal(sentinel.xpScalingSummary, "+15/min");
});

test("minions data summarizes scaling as readable minute patterns", () => {
  const data = generateMinionsData();
  const standard = data.groups.find((group) => group.id === "standard-minions");
  assert.ok(standard);

  const footman = standard.units.find((unit) => unit.id === "FootmanMinion");
  assert.ok(footman);
  assert.equal(footman.xpScalingSummary, "+2/min");
  assert.deepEqual(footman.scalingRows, [
    {
      label: "Life",
      summary: "+8/min 1-5, +12/min 6-10, +16/min 11-15, +20/min 16-20, +28/min 21+",
    },
    {
      label: "Basic damage",
      summary: "+0.1/min 1-5, +0.15/min 6-10, +0.2/min 11-15, +0.25/min 16-20, +0.35/min 21+",
    },
  ]);

  // Wizard minions grant no XP under the experience-globe system (they drop a
  // regen globe instead: libGame_gf_MinionDies in gamelib.galaxy).
  const wizard = standard.units.find((unit) => unit.id === "WizardMinion");
  assert.ok(wizard);
  assert.equal(wizard.killXp, null);
  assert.equal(wizard.xpScalingSummary, null);
});
