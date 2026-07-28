import assert from "node:assert/strict";
import test from "node:test";
import { buildLevels, parseLevelXpValues } from "../scripts/lib/experience.ts";

test("buildLevels treats HeroXPCurve entries as per-level XP and accumulates", () => {
  const levels = buildLevels([0, 2010, 2154, 2154]);
  assert.deepEqual(levels, [
    { level: 1, cumulativeXp: 0, xpForLevel: 0 },
    { level: 2, cumulativeXp: 2010, xpForLevel: 2010 },
    { level: 3, cumulativeXp: 4164, xpForLevel: 2154 },
    { level: 4, cumulativeXp: 6318, xpForLevel: 2154, xpSincePreviousTalentTier: 6318, previousTalentTierLevel: 1 },
  ]);
});

test("talent tier levels carry XP-since-previous-tier deltas", () => {
  const levels = buildLevels(Array.from({ length: 20 }, (_, i) => (i === 0 ? 0 : 1000)));
  const tiers = levels.filter((l) => l.xpSincePreviousTalentTier != null);
  assert.deepEqual(tiers.map((l) => l.level), [4, 7, 10, 13, 16, 20]);
  assert.deepEqual(tiers.map((l) => l.xpSincePreviousTalentTier), [3000, 3000, 3000, 3000, 3000, 4000]);
  assert.deepEqual(tiers.map((l) => l.previousTalentTierLevel), [1, 4, 7, 10, 13, 16]);
  assert.equal(levels[4].xpSincePreviousTalentTier, undefined);
});

test("parseLevelXpValues reads MinVeterancyXP per entry, empty entry is 0", () => {
  const xml = `
    <CBehaviorVeterancy default="1" id="HeroXPCurve">
      <VeterancyLevelArray />
      <VeterancyLevelArray MinVeterancyXP="2010" />
      <VeterancyLevelArray MinVeterancyXP="2154" />
    </CBehaviorVeterancy>`;
  assert.deepEqual(parseLevelXpValues(xml, 3), [0, 2010, 2154]);
});

test("real curve: every level past 1 requires XP and cumulative strictly increases", () => {
  // Mirrors the shape of the live HeroXPCurve data: flat spans of identical
  // per-level costs must still produce strictly increasing cumulative totals.
  const perLevel = [0, 2010, 2154, 2154, 2154, 2154, 3303];
  const levels = buildLevels(perLevel);
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i].xpForLevel > 0, `level ${levels[i].level} xpForLevel is ${levels[i].xpForLevel}`);
    assert.ok(levels[i].cumulativeXp > levels[i - 1].cumulativeXp, `level ${levels[i].level} cumulative did not increase`);
  }
});
