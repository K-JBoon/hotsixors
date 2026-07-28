import type { ExperienceLevel } from "../types.ts";

// Each VeterancyLevelArray entry's MinVeterancyXP is the XP needed to gain that
// level, not a cumulative total: the game's DataXPInitializeLevelXPValues trigger
// (heroeslib.galaxy) builds level totals by summing the entries in order.
export function parseLevelXpValues(behaviorXml: string, maxLevel: number): number[] {
  const curveMatch = /<CBehaviorVeterancy\b[^>]+id="HeroXPCurve"[^>]*>([\s\S]*?)<\/CBehaviorVeterancy>/i.exec(behaviorXml);
  if (!curveMatch) throw new Error("gen-experience: HeroXPCurve behavior not found in behaviordata.xml");
  const entries = [...curveMatch[1].matchAll(/<VeterancyLevelArray\b[^>]*(?:\/>|>[\s\S]*?<\/VeterancyLevelArray>)/gi)];
  if (entries.length < maxLevel) throw new Error(`gen-experience: expected at least ${maxLevel} VeterancyLevelArray entries, found ${entries.length}`);
  return entries.slice(0, maxLevel).map((entry) => {
    const value = /MinVeterancyXP="([\d.]+)"/i.exec(entry[0])?.[1];
    return value ? Number.parseFloat(value) : 0;
  });
}

const TALENT_TIER_LEVELS = [4, 7, 10, 13, 16, 20];

export function buildLevels(perLevelXp: number[]): ExperienceLevel[] {
  let cumulative = 0;
  let previousTierCumulative = 0;
  let previousTierLevel = 1;
  return perLevelXp.map((xpForLevel, index) => {
    cumulative += xpForLevel;
    const entry: ExperienceLevel = { level: index + 1, cumulativeXp: cumulative, xpForLevel };
    if (TALENT_TIER_LEVELS.includes(entry.level)) {
      entry.xpSincePreviousTalentTier = cumulative - previousTierCumulative;
      entry.previousTalentTierLevel = previousTierLevel;
      previousTierCumulative = cumulative;
      previousTierLevel = entry.level;
    }
    return entry;
  });
}
