// Builds the replay viewer's unit type -> minimap icon lookup and converts the
// game's DDS icon art to PNG.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  HEROES_DATA_DIR,
  MINIMAP_ICONS_DIR,
  SITE_STATIC,
  SITE_STATIC_IMAGES,
  findLatestVersion,
} from "./lib/paths.ts";
import { loadDataFile } from "./lib/heroes-data.ts";
import { decodeDds } from "./lib/dds.ts";
import { encodePngAlpha } from "./lib/png.ts";

interface Portraits {
  minimap?: string;
}

interface HeroEntry {
  unitId?: string;
  portraits?: Portraits;
  heroUnits?: Record<string, { portraits?: Portraits }>;
}

interface UnitEntry {
  portraits?: Portraits;
}

/** Maps every unit type that has minimap art to that art's file name. */
export function collectMinimapIcons(
  heroes: Record<string, HeroEntry>,
  units: Record<string, UnitEntry>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of Object.keys(units).sort()) {
    const icon = units[id]?.portraits?.minimap;
    if (icon) out[id] = icon;
  }
  for (const id of Object.keys(heroes).sort()) {
    const hero = heroes[id]!;
    if (hero.unitId && hero.portraits?.minimap) out[hero.unitId] = hero.portraits.minimap;
    for (const [unit, entry] of Object.entries(hero.heroUnits ?? {})) {
      const icon = entry && typeof entry === "object" ? entry.portraits?.minimap : undefined;
      if (icon) out[unit] = icon;
    }
  }
  return out;
}

async function main(): Promise<void> {
  console.log("gen-replay-minimap-icons: starting");
  const version = await findLatestVersion(HEROES_DATA_DIR);
  const [heroData, unitData] = await Promise.all([
    loadDataFile<Record<string, HeroEntry>>("herodata", version),
    loadDataFile<Record<string, UnitEntry>>("unitdata", version),
  ]);
  const icons = collectMinimapIcons(heroData.items, unitData.items);

  const iconDir = path.join(SITE_STATIC_IMAGES, "minimapicons");
  await mkdir(iconDir, { recursive: true });
  const converted = new Map<string, boolean>();
  for (const [unit, file] of Object.entries(icons)) {
    if (!converted.has(file)) {
      const source = path.join(MINIMAP_ICONS_DIR, file.replace(/\.png$/, ".dds"));
      try {
        const png = encodePngAlpha(decodeDds(await readFile(source)));
        await writeFile(path.join(iconDir, file), png);
        converted.set(file, true);
      } catch {
        converted.set(file, false);
      }
    }
    if (!converted.get(file)) delete icons[unit];
  }

  const dest = path.join(SITE_STATIC, "replay", "minimap-icons.json");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(icons), "utf-8");
  const written = [...converted.values()].filter(Boolean).length;
  console.log(
    `gen-replay-minimap-icons: ${Object.keys(icons).length} unit types, ${written} icons -> ${path.relative(process.cwd(), dest)}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
