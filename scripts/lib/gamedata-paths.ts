// Which files under `mods/` the site publishes and the effect graph reads.
// Four gen scripts walk the same tree, so the filter lives apart from them.

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { DATA_ROOT, GAMEDATA_DIR } from "./paths.ts";
import { walkFiles } from "./fs.ts";

export const SUPPORTED_EXTS = new Set([".xml", ".galaxy", ".aitree"]);

const INCLUDED_GAMEDATA_PREFIXES = [
  "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/",
  "mods/heroesdata.stormmod/base.stormdata/gamedata/maps/",
  "mods/heroesdata.stormmod/base.stormdata/triggerlibs/",
  "mods/heroesdata.stormmod/base.stormdata/ai/",
];
const INCLUDED_GAMEDATA_FILES = new Set([
  "mods/heroesdata.stormmod/base.stormdata/gamedata/behaviordata.xml",
  "mods/heroesdata.stormmod/base.stormdata/gamedata/effectdata.xml",
  "mods/heroesdata.stormmod/base.stormdata/gamedata/abildata.xml",
  "mods/heroesdata.stormmod/base.stormdata/gamedata/talentdata.xml",
  "mods/heroesdata.stormmod/base.stormdata/gamedata/validatordata.xml",
]);
const EXCLUDED_GAMEDATA_FILES = new Set(["characterdata.xml", "gamedata.xml", "librarylist.xml", "preload.xml"]);
const EXCLUDED_GAMEDATA_SEGMENTS = [
  "actordata",
  "announcerdata",
  "announcerpackdata",
  "bannerdata",
  "boostdata",
  "bystanderdata",
  "colorspecdata",
  "colorstyledata",
  "conversationdata",
  "critterdata",
  "decorationdata",
  "doodadautodata",
  "emoticondata",
  "emoticonpackdata",
  "footprintdata",
  "genericcursordata",
  "genericglazedata",
  "genericmaterialimpactdata",
  "hittestdata",
  "lightdata",
  "modeldata",
  "mountdata",
  "pingdata",
  "portraitpackdata",
  "rewarddata",
  "scoreresultdata",
  "scorevaluedata",
  "skindata",
  "sound",
  "sounddata",
  "soundexclusivitydata",
  "soundmixsnapshotdata",
  "soundtrackdata",
  "spraydata",
  "terraindata",
  "texturedata",
  "vodata",
  "vodefinitiondata",
  "voicelinedata",
  "voiceoverdata",
];

function normalizedPath(relPath: string): string {
  return relPath.toLowerCase().replaceAll("\\", "/");
}

function isExcludedGamedataPath(relPath: string): boolean {
  return normalizedPath(relPath)
    .split("/")
    .some((segment) => EXCLUDED_GAMEDATA_SEGMENTS.some((excluded) => segment.includes(excluded)));
}

function isIncludedGamedataDomain(relPath: string): boolean {
  const candidate = normalizedPath(relPath);
  if (INCLUDED_GAMEDATA_FILES.has(candidate)) return true;
  if (INCLUDED_GAMEDATA_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return true;
  if (/^mods\/heromods\/[^/]+\/base\.stormdata\/(?:gamedata\/|ai\/|[^/]+\.galaxy$)/.test(candidate)) return true;
  if (/^mods\/heroesmapmods\/battlegroundmapmods\/[^/]+\/base\.stormdata\/(?:gamedata\/|ai\/|[^/]+\.galaxy$)/.test(candidate)) return true;
  return false;
}

export function shouldIncludeGamedataPath(relPath: string): boolean {
  const ext = path.extname(relPath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) return false;
  if (!isIncludedGamedataDomain(relPath)) return false;
  if (EXCLUDED_GAMEDATA_FILES.has(path.basename(relPath).toLowerCase())) return false;

  return !isExcludedGamedataPath(relPath);
}

export function shouldDescendIntoGamedataPath(relPath: string): boolean {
  if (isExcludedGamedataPath(relPath)) return false;

  const candidate = normalizedPath(relPath);
  const candidatePrefix = `${candidate}/`;
  if (INCLUDED_GAMEDATA_PREFIXES.some((prefix) =>
    prefix.startsWith(candidatePrefix) || candidate.startsWith(prefix)
  )) return true;

  if (/^mods\/heromods(?:\/[^/]+(?:\/base\.stormdata(?:\/(?:gamedata|ai).*)?)?)?$/.test(candidate)) return true;
  if (/^mods\/heroesmapmods(?:\/battlegroundmapmods(?:\/[^/]+(?:\/base\.stormdata(?:\/(?:gamedata|ai).*)?)?)?)?$/.test(candidate)) return true;
  return false;
}

// Locale-specific stormdata directories (e.g. enus.stormdata) repeat the base
// data in another language.
const LOCALE_CODES = new Set(["dede", "enus", "eses", "esmx", "frfr", "itit", "kokr", "plpl", "ptbr", "ruru", "zhcn", "zhtw"]);

export function isLocaleDir(name: string): boolean {
  const m = name.match(/^([a-z]{4})\.stormdata$/i);
  return m ? LOCALE_CODES.has(m[1].toLowerCase()) : false;
}

export interface GamedataFile {
  path: string;
  content: string;
}

/** Every published XML catalog, as the effect graph builder wants it. */
export async function loadGamedataXmlFiles(): Promise<GamedataFile[]> {
  const relPaths: string[] = [];
  for await (const file of walkFiles(GAMEDATA_DIR)) {
    const rel = `mods/${file.rel}`;
    if (file.rel.endsWith(".xml") && shouldIncludeGamedataPath(rel)) relPaths.push(rel);
  }
  return Promise.all(
    relPaths.map(async (rel) => ({ path: rel, content: await readFile(path.join(DATA_ROOT, rel), "utf-8") })),
  );
}
