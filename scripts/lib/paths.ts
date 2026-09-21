import * as path from "node:path";
import { readFile } from "node:fs/promises";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

// scripts/extract-gamedata.ts writes this root in HeroesDataParser's layout.
export const DATA_ROOT = process.env.HOTS_DATA_ROOT
  ? path.resolve(process.env.HOTS_DATA_ROOT)
  : path.join(REPO_ROOT, ".gamedata");

export const GAMEDATA_DIR = path.join(DATA_ROOT, "mods");
export const HEROES_DATA_DIR = path.join(DATA_ROOT, "data");
export const GAMESTRINGS_DIR = path.join(DATA_ROOT, "gamestrings");
export const HEROES_IMAGES_DIR = path.join(DATA_ROOT, "images");
export const HDP_INFO = path.join(GAMEDATA_DIR, "hdp.info");
// Packaged maps and mods, named by content hash.
export const DEPOTCACHE_DIR = path.join(GAMEDATA_DIR, "core.stormmod/base.stormdata/depotcache");

export const HEROPROTOCOL_VERSIONS = path.join(REPO_ROOT, "submodules/heroprotocol/heroprotocol/versions");
export const ABILLINK_STORE = path.join(REPO_ROOT, "data/replay-abillinks");
export const SITE_CONTENT = path.join(REPO_ROOT, "site/content");
export const SITE_CONTENT_HEROES = path.join(REPO_ROOT, "site/content/heroes");
export const SITE_CONTENT_BATTLEGROUNDS = path.join(REPO_ROOT, "site/content/battlegrounds");
export const SITE_DATA_BATTLEGROUNDS = path.join(REPO_ROOT, "site/data/battlegrounds");
export const SITE_DATA_HEROES = path.join(REPO_ROOT, "site/data/heroes");
export const SITE_CONTENT_GAMEDATA = path.join(REPO_ROOT, "site/content/gamedata");
export const SITE_STATIC_IMAGES = path.join(REPO_ROOT, "site/static/images");
export const SITE_STATIC = path.join(REPO_ROOT, "site/static");
export const SITE_SASS = path.join(REPO_ROOT, "site/sass");
/** Unsubset webfonts; `gen-fonts.ts` instances them into site/static/fonts. */
export const FONT_SOURCES = path.join(REPO_ROOT, "data/fonts");
export const SITE_STATIC_REPLAY = path.join(REPO_ROOT, "site/static/replay");
export const SITE_DATA = path.join(REPO_ROOT, "site/data");

/** `mods/hdp.info`, written by `heroesdataparser casc-extract`. */
export interface HdpInfo {
  Version: string;
  IsPtr: boolean;
  HdpVersion: string;
  ExtractedDate: string;
}

function parseHdpInfo(raw: string): HdpInfo {
  const info = JSON.parse(raw) as HdpInfo;
  if (!/^\d+(\.\d+)+$/.test(info.Version ?? "")) {
    throw new Error(`${HDP_INFO}: unusable version "${info.Version}"`);
  }
  return info;
}

const missing = () =>
  new Error(`No extracted game data at ${DATA_ROOT}. Run \`npm run extract\` first.`);

export async function readHdpInfo(): Promise<HdpInfo> {
  try {
    return parseHdpInfo(await readFile(HDP_INFO, "utf-8"));
  } catch (e) {
    throw (e as NodeJS.ErrnoException).code === "ENOENT" ? missing() : e;
  }
}

/** Version, with the `_ptr` suffix a PTR extract carries. */
export function gameVersion(info: HdpInfo): string {
  return info.IsPtr ? `${info.Version}_ptr` : info.Version;
}

/** Build number, e.g. 2.55.17.98025 -> 98025. A replay names the same build. */
export function gameBuild(info: HdpInfo): number {
  const build = /\.(\d+)$/.exec(info.Version);
  if (!build) throw new Error(`cannot read build from game version ${info.Version}`);
  return Number(build[1]);
}

export function gamedataPathToContentPath(relPath: string): string {
  return path.join(SITE_CONTENT_GAMEDATA, relPath + ".md");
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
