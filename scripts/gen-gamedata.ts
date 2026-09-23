import { readdir, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import type { AnchorMap, FileTreeNode } from "./types.ts";
import {
  GAMEDATA_DIR,
  SITE_CONTENT_GAMEDATA,
  SITE_DATA,
  SITE_STATIC,
  gamedataPathToContentPath,
} from "./lib/paths.ts";
import { writeJson, writeText } from "./lib/fs.ts";
import { frontmatter } from "./lib/frontmatter.ts";
import { runScript } from "./lib/script.ts";
import {
  isReferenceGamedataPath,
  shouldDescendIntoGamedataPath,
  shouldIncludeGamedataPath,
} from "./lib/gamedata-paths.ts";
import { sanitizeGamedataUrl } from "./lib/galaxy-source.ts";
import { escapeHtml } from "./lib/gamestrings.ts";
import { buildXrefSidecars, scanXrefFile, type ScannedFile } from "./lib/gamedata-xref.ts";

interface XrefScans {
  primary: ScannedFile[];
  reference: ScannedFile[];
}

export function renderGamedataHtml(
  content: string,
  anchors: Map<number, string[]>,
  lang: string,
  urlPath?: string
): string {
  const lines = content.split(/\r?\n/);
  const renderedLines = lines.map((line, index) => {
    const lineNumber = index + 1;
    const lineAnchors = anchors.get(lineNumber) ?? [];
    const attrs = lineAnchors.length > 0 ? ` id="${escapeHtml(lineAnchors[0])}"` : "";
    const hiddenAnchors = lineAnchors.slice(1)
      .map((id) => `<span id="${escapeHtml(id)}" class="line-anchor"></span>`)
      .join("");
    return `<span class="line"${attrs}>${hiddenAnchors}${escapeHtml(line)}</span>`;
  });

  const xrefAttr = urlPath ? ` data-xref-path="${escapeHtml(urlPath)}"` : "";
  return `<pre class="gamedata-code" data-lang="${escapeHtml(lang)}"${xrefAttr}><code>${renderedLines.join("\n")}</code></pre>`;
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

// Ability and talent ids also name a CButton and sometimes a unit, so the
// anchor for the CAbil or CTalent declaration is tracked apart from the
// first-wins generic map.
function extractDeclAnchors(lines: string[]): Map<string, number> {
  const result = new Map<string, number>();
  const declRe = /<(CAbil\w*|CTalent)\b[^>]*\bid="([^"]+)"/g;
  for (let i = 0; i < lines.length; i++) {
    declRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(lines[i])) !== null) {
      if (!result.has(m[2])) result.set(m[2], i + 1);
    }
  }
  return result;
}

// GameStrings keys, like Button/Tooltip/AnaSleepDart, anchor their line.
export function extractStringAnchors(lines: string[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  lines.forEach((line, i) => {
    const key = line.replace(/^\uFEFF/, "").match(/^([^=\s]+)=/)?.[1];
    if (key) result.set(i + 1, [key]);
  });
  return result;
}

// aitree and DocumentInfo are XML, and the client highlighter keys off the lang.
function gamedataLang(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === ".aitree" || path.basename(relPath).toLowerCase() === "documentinfo") return "xml";
  return ext.slice(1);
}

// One id names records in several catalogs (a talent and its button), so each
// record line also gets a "<Class>.<id>" anchor that picks the record. An
// id-less class default gets "<Class>.default".
export function extractRecordAnchors(lines: string[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  const recordRe = /^\s*<(C[A-Z]\w*)\b([^>]*)>/;
  lines.forEach((line, i) => {
    const m = line.match(recordRe);
    const name = m && (m[2].match(/\bid="([^"]+)"/)?.[1] ?? (/\bdefault="1"/.test(m[2]) ? "default" : null));
    if (name) result.set(i + 1, [`${m[1]}.${name}`]);
  });
  return result;
}

async function processFile(
  absPath: string,
  relPath: string,
  anchorMap: AnchorMap,
  declAnchorMap: AnchorMap,
  scans: XrefScans
): Promise<void> {
  const ext = path.extname(absPath).toLowerCase();
  const lang = gamedataLang(relPath);
  const content = await readFile(absPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const anchors = ext === ".txt" ? extractStringAnchors(lines) : extractAnchors(lines);
  // Reference files redeclare ids that the hero files own, so they stay out of
  // the id maps and rank last as xref targets.
  const reference = isReferenceGamedataPath(relPath);

  const urlRelPath = sanitizeGamedataUrl(relPath);

  if (ext === ".xml") (reference ? scans.reference : scans.primary).push({ path: urlRelPath, scan: scanXrefFile(content) });

  // aitree ids are node hashes local to their tree, and string keys aren't
  // record ids, so both stay out of the global id lookup.
  const hasRecordIds = ext !== ".aitree" && ext !== ".txt";
  if (hasRecordIds && !reference) {
    for (const [lineNumber, ids] of anchors) {
      for (const id of ids) {
        if (!anchorMap[id]) {
          anchorMap[id] = { xmlPath: urlRelPath, line: lineNumber };
        }
      }
    }
  }

  if (ext === ".xml" && !reference) {
    for (const [id, lineNumber] of extractDeclAnchors(lines)) {
      if (!declAnchorMap[id]) {
        declAnchorMap[id] = { xmlPath: urlRelPath, line: lineNumber };
      }
    }
  }

  const lineAnchors = new Map(anchors);
  if (ext === ".xml") {
    for (const [lineNumber, ids] of extractRecordAnchors(lines)) {
      lineAnchors.set(lineNumber, [...(anchors.get(lineNumber) ?? []), ...ids]);
    }
  }

  const html = renderGamedataHtml(content, lineAnchors, lang, ext === ".xml" ? urlRelPath : undefined);

  const slug = path.basename(relPath);
  const parentDir = path.dirname(relPath);
  const zolaPath = "gamedata/" + urlRelPath;
  const allIds: string[] = [];
  // aitree node hashes and string keys would add thousands of ids per page.
  if (hasRecordIds) {
    for (const ids of anchors.values()) allIds.push(...ids);
  }

  const page = frontmatter(
    {
      title: slug,
      path: zolaPath,
      template: "gamedata/single.html",
      in_search_index: false,
      description: `${relPath} from the Heroes of the Storm game files.`,
    },
    {
      file_path: relPath,
      url_path: urlRelPath,
      file_ext: ext.slice(1) || lang,
      parent_dir: parentDir,
      anchor_ids: allIds,
      noindex: true,
    },
  );
  await writeText(gamedataPathToContentPath(relPath), `${page}\n${html}`);
}

async function walkDir(
  dir: string,
  relBase: string,
  anchorMap: AnchorMap,
  declAnchorMap: AnchorMap,
  tree: FileTreeNode,
  scans: XrefScans
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (!shouldDescendIntoGamedataPath(relPath)) continue;
      const childNode: FileTreeNode = { name: entry.name, path: relPath, type: "dir", children: [] };
      tree.children!.push(childNode);
      await walkDir(absPath, relPath, anchorMap, declAnchorMap, childNode, scans);

      await writeText(path.join(SITE_CONTENT_GAMEDATA, relPath, "_index.md"), sectionPage(entry.name, relPath));
    } else if (entry.isFile()) {
      if (shouldIncludeGamedataPath(relPath)) {
        console.log(`  Processing ${relPath}`);
        const fileNode: FileTreeNode = {
          name: entry.name,
          path: sanitizeGamedataUrl(relPath),
          type: "file",
          lang: gamedataLang(relPath),
        };
        tree.children!.push(fileNode);
        await processFile(absPath, relPath, anchorMap, declAnchorMap, scans);
      }
    }
  }
}

/** Zola section page for one game data directory. */
function sectionPage(title: string, dirPath: string): string {
  const description = dirPath
    ? `Heroes of the Storm game data files in ${dirPath}.`
    : "Browse the Heroes of the Storm game files: XML data, Galaxy scripts and game strings.";
  return frontmatter({ title, template: "gamedata/list.html", description }, { dir_path: dirPath, noindex: true });
}

function pruneEmptyDirs(node: FileTreeNode): boolean {
  if (node.type === "file") return true;
  if (!node.children) return false;
  node.children = node.children.filter((child) => pruneEmptyDirs(child));
  return node.children.length > 0;
}

async function writeXrefSidecars(scannedFiles: ScannedFile[]): Promise<void> {
  const outDir = path.join(SITE_STATIC, "gamedata-xref");
  await rm(outDir, { recursive: true, force: true });
  const sidecars = buildXrefSidecars(scannedFiles);
  let bytes = 0;
  for (const [urlPath, { sidecar, incoming }] of sidecars) {
    const outPath = path.join(outDir, `${urlPath}.json`);
    for (const [file, payload] of [[outPath, sidecar], [outPath.replace(/\.json$/, ".refs.json"), incoming]] as const) {
      bytes += JSON.stringify(payload).length;
      await writeJson(file, payload);
    }
  }
  console.log(`gen-gamedata: wrote ${sidecars.size} xref sidecars (${(bytes / 1e6).toFixed(1)} MB)`);
}

async function main(): Promise<void> {
  await rm(SITE_CONTENT_GAMEDATA, { recursive: true, force: true });

  const anchorMap: AnchorMap = {};
  const declAnchorMap: AnchorMap = {};
  const tree: FileTreeNode = { name: "mods", path: "mods", type: "dir", children: [] };
  const scans: XrefScans = { primary: [], reference: [] };

  await walkDir(GAMEDATA_DIR, "mods", anchorMap, declAnchorMap, tree, scans);

  await writeXrefSidecars([...scans.primary, ...scans.reference]);

  pruneEmptyDirs(tree);

  await writeJson(path.join(SITE_DATA, "anchor-map.json"), anchorMap, 2);
  await writeJson(path.join(SITE_DATA, "decl-anchor-map.json"), declAnchorMap, 2);
  await writeJson(path.join(SITE_DATA, "gamedata-tree.json"), tree, 2);
  await writeJson(path.join(SITE_STATIC, "gamedata-tree.json"), tree);

  await writeText(path.join(SITE_CONTENT_GAMEDATA, "_index.md"), sectionPage("Game Data", ""));
  // walkDir starts inside mods/, so it never writes that directory's own
  // section the way it does for every directory below it.
  await writeText(path.join(SITE_CONTENT_GAMEDATA, "mods", "_index.md"), sectionPage("mods", "mods"));

  console.log(`gen-gamedata: wrote anchor-map.json with ${Object.keys(anchorMap).length} entries`);
  console.log("gen-gamedata: done");
}

runScript(import.meta.url, main);
