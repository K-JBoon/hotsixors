import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { ExperienceData, UnderdogTableRow } from "./types.ts";
import { GAMEDATA_DIR, SITE_CONTENT, SITE_DATA } from "./lib/paths.ts";
import { buildLevels, parseLevelXpValues } from "./lib/experience.ts";

const MAX_LEVEL = 30;

const behaviorXmlPath = path.join(GAMEDATA_DIR, "heroesdata.stormmod/base.stormdata/gamedata/behaviordata.xml");

// Mirrors libCore_gf_DataXPGetMoreGranularBountyXPModifier in heroeslib.galaxy.
const UNDERDOG_TABLE: UnderdogTableRow[] = [
  { levelGap: 0, truncMod: 0.0, moduloMod: 1.0 },
  { levelGap: 1, truncMod: 0.1, moduloMod: 2.0 },
  { levelGap: 2, truncMod: 0.35, moduloMod: 3.0 },
  { levelGap: 3, truncMod: 0.75, moduloMod: 4.0 },
  { levelGap: 4, truncMod: 1.3, moduloMod: 5.0 },
  { levelGap: 5, truncMod: 2.0, moduloMod: 0.0 },
];

async function main() {
  console.log("gen-experience: starting");
  await mkdir(SITE_DATA, { recursive: true });
  await mkdir(SITE_CONTENT, { recursive: true });

  const behaviorXml = await readFile(behaviorXmlPath, "utf-8");
  const levels = buildLevels(parseLevelXpValues(behaviorXml, MAX_LEVEL));

  const data: ExperienceData = {
    maxLevel: MAX_LEVEL,
    levels,
    killXpFormula: { base: 50, levelOffset: 5 },
    underdogTable: UNDERDOG_TABLE,
    clamp: { min: 0.05, max: 3.0 },
  };

  await writeFile(path.join(SITE_DATA, "experience.json"), JSON.stringify(data, null, 2), "utf-8");
  await writeFile(path.join(SITE_CONTENT, "experience.md"), `+++\ntitle = "Experience"\ntemplate = "experience.html"\n+++\n`, "utf-8");
  console.log(`gen-experience: wrote ${levels.length} levels`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
