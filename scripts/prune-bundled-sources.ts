import { rm, readdir, rmdir } from "node:fs/promises";
import * as path from "node:path";
import { SITE_DATA, SITE_STATIC } from "./lib/paths.ts";
import { readJson } from "./lib/fs.ts";

const PUBLIC_DIR = path.join(SITE_STATIC, "..", "public");
const MANIFEST = path.join(SITE_DATA, "bundle-sources.json");

const sources = await readJson<string[]>(MANIFEST);

// The test entry re-exports every client module; nothing on the site loads it.
sources.push("js/index.js");

for (const rel of sources) {
  await rm(path.join(PUBLIC_DIR, rel), { force: true });
}

// Directories the bundle emptied would otherwise ship as stubs.
const dirs = [...new Set(sources.map((rel) => path.dirname(rel)))]
  .filter((dir) => dir !== ".")
  .sort((a, b) => b.length - a.length);

for (const dir of dirs) {
  const full = path.join(PUBLIC_DIR, dir);
  try {
    if ((await readdir(full)).length === 0) await rmdir(full);
  } catch {
    // Already gone, or not a directory in this build.
  }
}

console.log(`Pruned ${sources.length} bundled source files from site/public`);
