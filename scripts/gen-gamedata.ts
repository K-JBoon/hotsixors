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
  SUPPORTED_EXTS,
  isLocaleDir,
  shouldDescendIntoGamedataPath,
  shouldIncludeGamedataPath,
} from "./lib/gamedata-paths.ts";
import { sanitizeGamedataUrl } from "./lib/galaxy-source.ts";
import { escapeHtml } from "./lib/gamestrings.ts";
import { buildXrefSidecars, scanXrefFile, type ScannedFile } from "./lib/gamedata-xref.ts";

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

async function processFile(
  absPath: string,
  relPath: string,
  anchorMap: AnchorMap,
  declAnchorMap: AnchorMap,
  scannedFiles: ScannedFile[]
): Promise<void> {
  const ext = path.extname(absPath).toLowerCase();
  // aitree is XML, and the client highlighter keys off the lang.
  const lang = ext === ".aitree" ? "xml" : ext.slice(1);
  const content = await readFile(absPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const anchors = extractAnchors(lines);

  const urlRelPath = sanitizeGamedataUrl(relPath);

  if (ext === ".xml") scannedFiles.push({ path: urlRelPath, scan: scanXrefFile(content) });

  // aitree ids are node hashes local to their tree, so they stay out of the
  // global id lookup.
  if (ext !== ".aitree") {
    for (const [lineNumber, ids] of anchors) {
      for (const id of ids) {
        if (!anchorMap[id]) {
          anchorMap[id] = { xmlPath: urlRelPath, line: lineNumber };
        }
      }
    }
  }

  if (ext === ".xml") {
    for (const [id, lineNumber] of extractDeclAnchors(lines)) {
      if (!declAnchorMap[id]) {
        declAnchorMap[id] = { xmlPath: urlRelPath, line: lineNumber };
      }
    }
  }

  const html = renderGamedataHtml(content, anchors, lang, ext === ".xml" ? urlRelPath : undefined);

  const slug = path.basename(relPath);
  const parentDir = path.dirname(relPath);
  const zolaPath = "gamedata/" + urlRelPath;
  const allIds: string[] = [];
  // aitree node hashes would add thousands of ids per page.
  if (ext !== ".aitree") {
    for (const ids of anchors.values()) allIds.push(...ids);
  }

  const page = frontmatter(
    { title: slug, path: zolaPath, template: "gamedata/single.html", in_search_index: false },
    {
      file_path: relPath,
      url_path: urlRelPath,
      file_ext: ext.slice(1),
      parent_dir: parentDir,
      anchor_ids: allIds,
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
  scannedFiles: ScannedFile[]
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
      await walkDir(absPath, relPath, anchorMap, declAnchorMap, childNode, scannedFiles);

      await writeText(path.join(SITE_CONTENT_GAMEDATA, relPath, "_index.md"), sectionPage(entry.name, relPath));
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
        await processFile(absPath, relPath, anchorMap, declAnchorMap, scannedFiles);
      }
    }
  }
}

/** Zola section page for one game data directory. */
function sectionPage(title: string, dirPath: string): string {
  return frontmatter({ title, template: "gamedata/list.html" }, { dir_path: dirPath });
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
  const scannedFiles: ScannedFile[] = [];

  await walkDir(GAMEDATA_DIR, "mods", anchorMap, declAnchorMap, tree, scannedFiles);

  await writeXrefSidecars(scannedFiles);

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
