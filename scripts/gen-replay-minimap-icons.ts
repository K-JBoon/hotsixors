// Builds the replay viewer's unit type -> minimap icon lookup and converts the
// game's DDS icon art to PNG.

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  GAMEDATA_DIR,
  SITE_STATIC,
  SITE_STATIC_IMAGES,
} from "./lib/paths.ts";
import { displayPath, walkFiles, writeBinary, writeJson } from "./lib/fs.ts";
import { runScript } from "./lib/script.ts";
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

// The data names the icons by file name only, and they sit in more than one
// mod. Index the extracted textures by name.
async function indexDdsFiles(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for await (const file of walkFiles(dir)) {
    const name = path.basename(file.abs).toLowerCase();
    if (name.endsWith(".dds")) out.set(name, file.abs);
  }
  return out;
}

async function main(): Promise<void> {
  const [heroData, unitData] = await Promise.all([
    loadDataFile<Record<string, HeroEntry>>("herodata"),
    loadDataFile<Record<string, UnitEntry>>("unitdata"),
  ]);
  const icons = collectMinimapIcons(heroData.items, unitData.items);

  const iconDir = path.join(SITE_STATIC_IMAGES, "minimapicons");
  const sources = await indexDdsFiles(GAMEDATA_DIR);
  const converted = new Map<string, boolean>();
  for (const [unit, file] of Object.entries(icons)) {
    if (!converted.has(file)) {
      const source = sources.get(file.replace(/\.png$/, ".dds").toLowerCase());
      try {
        if (!source) throw new Error(`no extracted texture for ${file}`);
        await writeBinary(path.join(iconDir, file), encodePngAlpha(decodeDds(await readFile(source))));
        converted.set(file, true);
      } catch {
        converted.set(file, false);
      }
    }
    if (!converted.get(file)) delete icons[unit];
  }

  const dest = path.join(SITE_STATIC, "replay", "minimap-icons.json");
  await writeJson(dest, icons);
  const written = [...converted.values()].filter(Boolean).length;
  const unresolved = [...converted].filter(([, ok]) => !ok).map(([file]) => file);
  if (unresolved.length > 0) {
    console.warn(
      `gen-replay-minimap-icons: ${unresolved.length} icon(s) not extracted, widen MINIMAP_TEXTURES in ` +
        `scripts/extract-gamedata.ts: ${unresolved.sort().join(", ")}`
    );
  }
  console.log(
    `gen-replay-minimap-icons: ${Object.keys(icons).length} unit types, ${written} icons -> ${displayPath(dest)}`
  );
}

runScript(import.meta.url, main);
