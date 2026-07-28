import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnchorMap, FileTreeNode } from "./types.ts";
import {
  GAMEDATA_DIR,
  SITE_CONTENT_GAMEDATA,
  SITE_DATA,
  SITE_STATIC,
  gamedataPathToContentPath,
} from "./lib/paths.ts";
import { sanitizeGamedataUrl } from "./lib/galaxy-source.ts";
import { escapeHtml } from "./lib/gamestrings.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

const SUPPORTED_EXTS = new Set([".xml", ".galaxy"]);
const INCLUDED_GAMEDATA_PREFIXES = [
  "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/",
  "mods/heroesdata.stormmod/base.stormdata/gamedata/maps/",
  "mods/heroesdata.stormmod/base.stormdata/triggerlibs/",
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

function normalizedSegments(relPath: string): string[] {
  return relPath.toLowerCase().split(/[\\/]+/);
}

function normalizedPath(relPath: string): string {
  return relPath.toLowerCase().replaceAll("\\", "/");
}

function isExcludedGamedataPath(relPath: string): boolean {
  const segments = normalizedSegments(relPath);
  return segments.some((segment) =>
    EXCLUDED_GAMEDATA_SEGMENTS.some((excluded) => segment.includes(excluded))
  );
}

function isIncludedGamedataDomain(relPath: string): boolean {
  const candidate = normalizedPath(relPath);
  if (INCLUDED_GAMEDATA_FILES.has(candidate)) return true;
  if (INCLUDED_GAMEDATA_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return true;
  if (/^mods\/heromods\/[^/]+\/base\.stormdata\/(?:gamedata\/|[^/]+\.galaxy$)/.test(candidate)) return true;
  if (/^mods\/heroesmapmods\/battlegroundmapmods\/[^/]+\/base\.stormdata\/(?:gamedata\/|[^/]+\.galaxy$)/.test(candidate)) return true;
  return false;
}

export function shouldIncludeGamedataPath(relPath: string): boolean {
  const ext = path.extname(relPath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) return false;
  if (!isIncludedGamedataDomain(relPath)) return false;
  if (EXCLUDED_GAMEDATA_FILES.has(path.basename(relPath).toLowerCase())) return false;

  return !isExcludedGamedataPath(relPath);
}

function shouldDescendIntoGamedataPath(relPath: string): boolean {
  if (isExcludedGamedataPath(relPath)) return false;

  const candidate = normalizedPath(relPath);
  const candidatePrefix = `${candidate}/`;
  if (INCLUDED_GAMEDATA_PREFIXES.some((prefix) =>
    prefix.startsWith(candidatePrefix) || candidate.startsWith(prefix)
  )) return true;

  if (/^mods\/heromods(?:\/[^/]+(?:\/base\.stormdata(?:\/gamedata.*)?)?)?$/.test(candidate)) return true;
  if (/^mods\/heroesmapmods(?:\/battlegroundmapmods(?:\/[^/]+(?:\/base\.stormdata(?:\/gamedata.*)?)?)?)?$/.test(candidate)) return true;
  return false;
}

// Skip locale-specific stormdata directories (e.g. enus.stormdata, dede.stormdata)
const LOCALE_CODES = new Set(["dede", "enus", "eses", "esmx", "frfr", "itit", "kokr", "plpl", "ptbr", "ruru", "zhcn", "zhtw"]);
function isLocaleDir(name: string): boolean {
  const m = name.match(/^([a-z]{4})\.stormdata$/i);
  return m ? LOCALE_CODES.has(m[1].toLowerCase()) : false;
}

export function renderGamedataHtml(content: string, anchors: Map<number, string[]>, lang: string): string {
  const lines = content.split("\n");
  const renderedLines = lines.map((line, index) => {
    const lineNumber = index + 1;
    const lineAnchors = anchors.get(lineNumber) ?? [];
    const attrs = lineAnchors.length > 0 ? ` id="${escapeHtml(lineAnchors[0])}"` : "";
    const hiddenAnchors = lineAnchors.slice(1)
      .map((id) => `<span id="${escapeHtml(id)}" class="line-anchor"></span>`)
      .join("");
    return `<span class="line"${attrs}>${hiddenAnchors}${escapeHtml(line)}</span>`;
  });

  return `<pre class="gamedata-code" data-lang="${escapeHtml(lang)}"><code>${renderedLines.join("\n")}</code></pre>`;
}

function extractAnchors(lines: string[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  const xmlIdRe = /\bid="([^"]+)"/g;
  const galaxyFunctionRe = /^\s*(?:bool|void|int|fixed|string|text|unit|point|region|timer|trigger|unitgroup|playergroup|bank|actor|abilcmd|order|wave|sound|revealer)\s+([A-Za-z_]\w*)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const ids: string[] = [];
    let m: RegExpExecArray | null;
    xmlIdRe.lastIndex = 0;
    while ((m = xmlIdRe.exec(lines[i])) !== null) {
      ids.push(m[1]);
    }
    const functionMatch = lines[i].match(galaxyFunctionRe);
    if (functionMatch) ids.push(functionMatch[1]);
    if (ids.length > 0) result.set(i + 1, ids);
  }
  return result;
}

async function processFile(
  absPath: string,
  relPath: string,
  anchorMap: AnchorMap
): Promise<void> {
  const ext = path.extname(absPath).toLowerCase();
  const lang = ext.slice(1);
  const content = await readFile(absPath, "utf-8");
  const lines = content.split("\n");
  const anchors = extractAnchors(lines);

  const urlRelPath = sanitizeGamedataUrl(relPath);

  for (const [lineNumber, ids] of anchors) {
    for (const id of ids) {
      if (!anchorMap[id]) {
        anchorMap[id] = { xmlPath: urlRelPath, line: lineNumber };
      }
    }
  }

  const html = renderGamedataHtml(content, anchors, lang);

  const slug = path.basename(relPath);
  const parentDir = path.dirname(relPath);
  const zolaPath = "gamedata/" + urlRelPath;
  const allIds: string[] = [];
  for (const ids of anchors.values()) allIds.push(...ids);

  const frontmatter = `+++
title = ${JSON.stringify(slug)}
path = ${JSON.stringify(zolaPath)}
template = "gamedata/single.html"
in_search_index = false

[extra]
file_path = ${JSON.stringify(relPath)}
url_path = ${JSON.stringify(urlRelPath)}
file_ext = ${JSON.stringify(ext.slice(1))}
parent_dir = ${JSON.stringify(parentDir)}
anchor_ids = [${allIds.map((id) => JSON.stringify(id)).join(", ")}]
+++

`;

  const pageContent = frontmatter + html;
  const outPath = gamedataPathToContentPath(relPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, pageContent, "utf-8");
}

async function walkDir(
  dir: string,
  relBase: string,
  anchorMap: AnchorMap,
  tree: FileTreeNode
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (isLocaleDir(entry.name)) continue;
      if (!shouldDescendIntoGamedataPath(relPath)) continue;
      const childNode: FileTreeNode = { name: entry.name, path: relPath, type: "dir", children: [] };
      tree.children!.push(childNode);
      await walkDir(absPath, relPath, anchorMap, childNode);

      const sectionPath = path.join(SITE_CONTENT_GAMEDATA, relPath, "_index.md");
      await mkdir(path.dirname(sectionPath), { recursive: true });
      await writeFile(
        sectionPath,
        `+++\ntitle = ${JSON.stringify(entry.name)}\ntemplate = "gamedata/list.html"\n\n[extra]\ndir_path = ${JSON.stringify(relPath)}\n+++\n`,
        "utf-8"
      );
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTS.has(ext) && shouldIncludeGamedataPath(relPath)) {
        console.log(`  Processing ${relPath}`);
        const fileNode: FileTreeNode = {
          name: entry.name,
          path: sanitizeGamedataUrl(relPath),
          type: "file",
          lang: ext.slice(1),
        };
        tree.children!.push(fileNode);
        await processFile(absPath, relPath, anchorMap);
      }
    }
  }
}

function pruneEmptyDirs(node: FileTreeNode): boolean {
  if (node.type === "file") return true;
  if (!node.children) return false;
  node.children = node.children.filter((child) => pruneEmptyDirs(child));
  return node.children.length > 0;
}

async function main(): Promise<void> {
  console.log("gen-gamedata: starting");
  await rm(SITE_CONTENT_GAMEDATA, { recursive: true, force: true });
  await mkdir(SITE_CONTENT_GAMEDATA, { recursive: true });
  await mkdir(SITE_DATA, { recursive: true });

  const anchorMap: AnchorMap = {};
  const tree: FileTreeNode = { name: "mods", path: "mods", type: "dir", children: [] };

  await walkDir(GAMEDATA_DIR, "mods", anchorMap, tree);

  pruneEmptyDirs(tree);

  await writeFile(
    path.join(SITE_DATA, "anchor-map.json"),
    JSON.stringify(anchorMap, null, 2),
    "utf-8"
  );

  await writeFile(
    path.join(SITE_DATA, "gamedata-tree.json"),
    JSON.stringify(tree, null, 2),
    "utf-8"
  );

  await mkdir(SITE_STATIC, { recursive: true });
  await writeFile(
    path.join(SITE_STATIC, "gamedata-tree.json"),
    JSON.stringify(tree),
    "utf-8"
  );

  // Build compact id-lookup.json for client-side click-to-definition
  // Deduplicates file paths into an indexed array to minimise size
  const idLookupFiles: string[] = [];
  const idLookupFilesIndex: Record<string, number> = {};
  const idLookupIds: Record<string, [number, number]> = {};
  for (const [elemId, info] of Object.entries(anchorMap)) {
    const xmlPath = info.xmlPath;
    if (!(xmlPath in idLookupFilesIndex)) {
      idLookupFilesIndex[xmlPath] = idLookupFiles.length;
      idLookupFiles.push(xmlPath);
    }
    idLookupIds[elemId] = [idLookupFilesIndex[xmlPath], info.line];
  }
  await writeFile(
    path.join(SITE_STATIC, "id-lookup.json"),
    JSON.stringify({ files: idLookupFiles, ids: idLookupIds }),
    "utf-8"
  );
  console.log(`gen-gamedata: wrote id-lookup.json with ${idLookupFiles.length} files and ${Object.keys(idLookupIds).length} IDs`);

  await writeFile(
    path.join(SITE_CONTENT_GAMEDATA, "_index.md"),
    `+++\ntitle = "Game Data"\ntemplate = "gamedata/list.html"\n\n[extra]\ndir_path = ""\n+++\n`,
    "utf-8"
  );

  console.log(`gen-gamedata: wrote anchor-map.json with ${Object.keys(anchorMap).length} entries`);
  console.log("gen-gamedata: done");
}

if (path.resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
