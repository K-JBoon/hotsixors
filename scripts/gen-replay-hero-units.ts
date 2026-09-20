// Builds the replay viewer's unit type -> hero lookup. Unit types are the only
// hero identity in a replay that is not localized.

import * as path from "node:path";
import { SITE_STATIC } from "./lib/paths.ts";
import { displayPath, writeJson } from "./lib/fs.ts";
import { runScript } from "./lib/script.ts";
import { loadDataFile } from "./lib/heroes-data.ts";

interface HeroEntry {
  unitId?: string;
  hyperlinkId?: string;
  heroUnits?: Record<string, unknown>;
}

/** Maps every unit type a hero can be on the map to that hero's id. */
export function collectHeroUnits(heroes: Record<string, HeroEntry>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of Object.keys(heroes).sort()) {
    const hero = heroes[id];
    const heroId = hero.hyperlinkId;
    if (!heroId) continue;
    for (const unit of [hero.unitId, ...Object.keys(hero.heroUnits ?? {})]) {
      if (unit) out[unit] = heroId;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const heroData = await loadDataFile<Record<string, HeroEntry>>("herodata");
  const heroUnits = collectHeroUnits(heroData.items);

  const dest = path.join(SITE_STATIC, "replay", "hero-units.json");
  await writeJson(dest, heroUnits);
  console.log(`gen-replay-hero-units: ${Object.keys(heroUnits).length} unit types -> ${displayPath(dest)}`);
}

runScript(import.meta.url, main);
