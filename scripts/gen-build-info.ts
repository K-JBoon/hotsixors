import { execFile } from "node:child_process";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  GAMEDATA_REPO,
  HEROES_DATA_DIR,
  HEROES_DATA_REPO,
  HEROES_IMAGES_REPO,
  SITE_DATA,
  compareVersions,
  findLatestVersion,
} from "./lib/paths.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const execFileAsync = promisify(execFile);

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

async function gitDescribe(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "describe", "--tags", "--always", "--dirty"]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

async function latestGamedataVersion(): Promise<string> {
  const xsdDir = path.join(GAMEDATA_REPO, "xsd");
  const entries = await readdir(xsdDir);
  const versions = entries
    .filter((entry) => /^\d/.test(entry) && entry.endsWith(".xsd"))
    .map((entry) => entry.replace(/\.xsd$/, ""))
    .sort(compareVersions);

  if (versions.length === 0) {
    throw new Error("No game versions found in HeroesOfTheStorm_Gamedata/xsd");
  }

  return versions[versions.length - 1];
}

async function main(): Promise<void> {
  console.log("gen-build-info: starting");

  const date = buildDate();
  const [
    heroesDataGameVersion,
    gamedataGameVersion,
    heroesDataSourceVersion,
    heroesImagesSourceVersion,
    gamedataSourceVersion,
  ] = await Promise.all([
    findLatestVersion(HEROES_DATA_DIR),
    latestGamedataVersion(),
    gitDescribe(HEROES_DATA_REPO),
    gitDescribe(HEROES_IMAGES_REPO),
    gitDescribe(GAMEDATA_REPO),
  ]);

  const buildInfo: BuildInfo = {
    build_date: date.toISOString(),
    build_date_display: formatBuildDate(date),
    sources: [
      {
        name: "heroes-data2",
        url: "https://github.com/HeroesToolChest/heroes-data2",
        game_version: heroesDataGameVersion,
        source_version: heroesDataSourceVersion,
      },
      {
        name: "heroes-images",
        url: "https://github.com/HeroesToolChest/heroes-images",
        game_version: heroesDataGameVersion,
        source_version: heroesImagesSourceVersion,
      },
      {
        name: "HeroesOfTheStorm_Gamedata",
        url: "https://github.com/jamiephan/HeroesOfTheStorm_Gamedata",
        game_version: gamedataGameVersion,
        source_version: gamedataSourceVersion,
      },
    ],
  };

  await mkdir(SITE_DATA, { recursive: true });
  await writeFile(path.join(SITE_DATA, "build-info.json"), JSON.stringify(buildInfo, null, 2) + "\n", "utf-8");

  console.log("gen-build-info: wrote build-info.json");
}

if (path.resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
