import { writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_DATA, gameVersion, readHdpInfo } from "./lib/paths.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

interface SourceVersion {
  name: string;
  url: string;
  game_version: string;
  source_version: string;
  note?: string;
}

interface BuildInfo {
  build_date: string;
  build_date_display: string;
  game_version: string;
  is_ptr: boolean;
  sources: SourceVersion[];
}

function buildDate(): Date {
  const explicitDate = process.env.HOTSIXORS_BUILD_DATE ?? process.env.BUILD_DATE;
  if (explicitDate) {
    const parsed = new Date(explicitDate);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid build date: ${explicitDate}`);
    }
    return parsed;
  }

  if (process.env.SOURCE_DATE_EPOCH) {
    const epochSeconds = Number(process.env.SOURCE_DATE_EPOCH);
    if (!Number.isFinite(epochSeconds)) {
      throw new Error(`Invalid SOURCE_DATE_EPOCH: ${process.env.SOURCE_DATE_EPOCH}`);
    }
    return new Date(epochSeconds * 1000);
  }

  return new Date();
}

function formatBuildDate(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

async function main(): Promise<void> {
  console.log("gen-build-info: starting");

  const date = buildDate();
  const info = await readHdpInfo();
  const version = gameVersion(info);

  const buildInfo: BuildInfo = {
    build_date: date.toISOString(),
    build_date_display: formatBuildDate(date),
    game_version: version,
    is_ptr: info.IsPtr,
    sources: [
      {
        name: "Heroes of the Storm",
        url: "https://heroesofthestorm.blizzard.com",
        game_version: version,
        source_version: `extracted ${info.ExtractedDate.slice(0, 10)}`,
        note: info.IsPtr ? "Public Test Realm build: unreleased and subject to change" : undefined,
      },
      {
        name: "HeroesDataParser",
        url: "https://github.com/HeroesToolChest/HeroesDataParser",
        game_version: version,
        source_version: `v${info.HdpVersion}`,
      },
    ],
  };

  await mkdir(SITE_DATA, { recursive: true });
  await writeFile(path.join(SITE_DATA, "build-info.json"), JSON.stringify(buildInfo, null, 2) + "\n", "utf-8");

  console.log(`gen-build-info: wrote build-info.json for ${version}`);
}

if (path.resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
