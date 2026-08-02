import * as path from "node:path";
import { readdir, readFile } from "node:fs/promises";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

export const HEROES_DATA_DIR = path.join(REPO_ROOT, "submodules/heroes-data2/heroesdata");
export const HEROES_IMAGES_DIR = path.join(REPO_ROOT, "submodules/heroes-images/heroesimages");
export const GAMEDATA_DIR = path.join(REPO_ROOT, "submodules/HeroesOfTheStorm_Gamedata/mods");
export const HEROES_DATA_REPO = path.join(REPO_ROOT, "submodules/heroes-data2");
export const HEROES_IMAGES_REPO = path.join(REPO_ROOT, "submodules/heroes-images");
export const GAMEDATA_REPO = path.join(REPO_ROOT, "submodules/HeroesOfTheStorm_Gamedata");
export const HEROPROTOCOL_VERSIONS = path.join(REPO_ROOT, "submodules/heroprotocol/heroprotocol/versions");
export const S2MA_MAPS_DIR = path.join(REPO_ROOT, "submodules/HeroesOfTheStorm_S2MA/maps");
export const ABILLINK_STORE = path.join(REPO_ROOT, "data/replay-abillinks");
export const MINIMAP_ICONS_DIR = path.join(REPO_ROOT, "data/minimapicons");
export const SITE_CONTENT = path.join(REPO_ROOT, "site/content");
export const SITE_CONTENT_HEROES = path.join(REPO_ROOT, "site/content/heroes");
export const SITE_CONTENT_BATTLEGROUNDS = path.join(REPO_ROOT, "site/content/battlegrounds");
export const SITE_DATA_BATTLEGROUNDS = path.join(REPO_ROOT, "site/data/battlegrounds");
export const SITE_CONTENT_GAMEDATA = path.join(REPO_ROOT, "site/content/gamedata");
export const SITE_STATIC_IMAGES = path.join(REPO_ROOT, "site/static/images");
export const SITE_STATIC = path.join(REPO_ROOT, "site/static");
export const SITE_STATIC_REPLAY = path.join(REPO_ROOT, "site/static/replay");
export const SITE_DATA = path.join(REPO_ROOT, "site/data");

export function compareVersions(a: string, b: string): number {
  // Strip optional _ptr suffix.
  const isPtrA = a.endsWith("_ptr");
  const isPtrB = b.endsWith("_ptr");
  const cleanA = isPtrA ? a.slice(0, -4) : a;
  const cleanB = isPtrB ? b.slice(0, -4) : b;
  const partsA = cleanA.split(".").map(Number);
  const partsB = cleanB.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // Same numeric version: release sorts after ptr.
  return Number(isPtrA) - Number(isPtrB);
}

// Find the newest heroes-data version.
export async function findLatestVersion(heroesDataDir: string): Promise<string> {
  try {
    const index = JSON.parse(await readFile(path.join(heroesDataDir, ".version.json"), "utf-8"));
    if (typeof index.latest === "string" && index.latest.length > 0) return index.latest;
  } catch {
    // Fall through to a directory scan.
  }
  const entries = await readdir(heroesDataDir);
  const versions = entries.filter((e) => /^\d/.test(e)).sort(compareVersions);
  if (versions.length === 0) throw new Error("No version directories found in heroes-data");
  return versions[versions.length - 1];
}

// Game version from the gamedata schema files.
export async function latestGamedataVersion(): Promise<string> {
  const entries = await readdir(path.join(GAMEDATA_REPO, "xsd"));
  const versions = entries
    .filter((entry) => /^\d/.test(entry) && entry.endsWith(".xsd"))
    .map((entry) => entry.replace(/\.xsd$/, ""))
    .sort(compareVersions);
  if (versions.length === 0) throw new Error("No game versions found in HeroesOfTheStorm_Gamedata/xsd");
  return versions[versions.length - 1];
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
