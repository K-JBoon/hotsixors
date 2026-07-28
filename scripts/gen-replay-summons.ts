// Builds the replay viewer's summoned-unit table.

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { HEROES_DATA_DIR, HEROES_IMAGES_DIR, SITE_STATIC, SITE_STATIC_IMAGES, findLatestVersion } from "./lib/paths.ts";
import { loadDataFile } from "./lib/heroes-data.ts";

interface UnitEntry {
  sight?: number;
  attributes?: string[];
  portraits?: { targetInfo?: string };
}

export interface SummonEntry {
  sight: number;
  portrait?: string;
}

// Summoned units that never appear as map bodies.
const NOT_A_BODY_RE =
  /Dummy|Placeholder|Collision|Pathing|Cursor|Track(ing|er)|ArtUnit|ArtEndUnit|Location|PlayAgain|WraithWalk/;

// Placeholder portrait used when a summon has no unique art.
const PLACEHOLDER_PORTRAIT = "storm_ui_ingame_hero_icon_placeholder.png";

export function collectSummons(units: Record<string, UnitEntry>): Record<string, SummonEntry> {
  const out: Record<string, SummonEntry> = {};
  for (const id of Object.keys(units).sort()) {
    const unit = units[id];
    const sight = unit.sight ?? 0;
    if (sight <= 0 || !(unit.attributes ?? []).includes("Summoned")) continue;
    if (NOT_A_BODY_RE.test(id)) continue;
    const portrait = unit.portraits?.targetInfo;
    out[id] = portrait && portrait !== PLACEHOLDER_PORTRAIT ? { sight, portrait } : { sight };
  }
  return out;
}

async function main(): Promise<void> {
  console.log("gen-replay-summons: starting");
  const version = await findLatestVersion(HEROES_DATA_DIR);
  const unitData = await loadDataFile<Record<string, UnitEntry>>("unitdata", version);
  const summons = collectSummons(unitData.items);

  const portraitDir = path.join(SITE_STATIC_IMAGES, "unitportraits");
  await mkdir(portraitDir, { recursive: true });
  let copied = 0;
  for (const id of Object.keys(summons)) {
    const file = summons[id].portrait;
    if (!file) continue;
    try {
      await copyFile(path.join(HEROES_IMAGES_DIR, "unitportraits", file), path.join(portraitDir, file));
      copied++;
    } catch {
      delete summons[id].portrait;
    }
  }

  const dest = path.join(SITE_STATIC, "replay", "summons.json");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(summons), "utf-8");
  console.log(
    `gen-replay-summons: ${Object.keys(summons).length} summoned units with vision, ${copied} portraits -> ${path.relative(process.cwd(), dest)}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
