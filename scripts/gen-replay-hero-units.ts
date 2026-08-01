// Builds the replay viewer's unit type -> hero lookup. Unit types are the only
// hero identity in a replay that is not localized.

import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { HEROES_DATA_DIR, SITE_STATIC, findLatestVersion } from "./lib/paths.ts";
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
  console.log("gen-replay-hero-units: starting");
  const version = await findLatestVersion(HEROES_DATA_DIR);
  const heroData = await loadDataFile<Record<string, HeroEntry>>("herodata", version);
  const heroUnits = collectHeroUnits(heroData.items);

  const dest = path.join(SITE_STATIC, "replay", "hero-units.json");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(heroUnits), "utf-8");
  console.log(
    `gen-replay-hero-units: ${Object.keys(heroUnits).length} unit types -> ${path.relative(process.cwd(), dest)}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
