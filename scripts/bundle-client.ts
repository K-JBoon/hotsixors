import { rm } from "node:fs/promises";
import * as path from "node:path";
import { build, type BuildOptions, type Metafile } from "esbuild";
import * as sass from "sass";
import { SITE_DATA, SITE_SASS, SITE_STATIC } from "./lib/paths.ts";
import { writeText } from "./lib/fs.ts";

const OUT_DIR = path.join(SITE_STATIC, "bundle");
const MANIFEST = path.join(SITE_DATA, "bundles.json");
const SOURCES = path.join(SITE_DATA, "bundle-sources.json");

/** Entry scripts the templates load, by their path under site/static. */
const MODULE_ENTRIES = ["hotsixors.js", "replay/replay-ui.js", "draft/draft.js"];
const CLASSIC_ENTRIES = ["level-slider.js", "underdog-calc.js"];

/** Sheets compiled from site/sass, by their name in both directories. */
const SASS_ENTRIES = ["main", "gamedata"];

/** Stylesheets the templates load, hashed so they cache under /bundle/ too. */
const STYLE_ENTRIES = [
  ...SASS_ENTRIES.map((name) => `${name}.css`),
  "replay/replay.css",
  "draft/draft.css",
  "lost-in-the-nexus/viewer.css",
];

const shared: BuildOptions = {
  outdir: OUT_DIR,
  outbase: SITE_STATIC,
  bundle: true,
  target: "es2022",
  minify: true,
  // `node:` imports are the Node-only test paths inside the replay modules;
  // trystero is fetched from a CDN at runtime.
  external: ["node:*", "https://*", "/fonts/*"],
  // Hashed names let the whole bundle directory be cached immutably.
  entryNames: "[dir]/[name]-[hash]",
  metafile: true,
  logLevel: "warning",
};

await rm(OUT_DIR, { recursive: true, force: true });

for (const name of SASS_ENTRIES) {
  const { css } = sass.compile(path.join(SITE_SASS, `${name}.scss`), { loadPaths: [SITE_SASS] });
  await writeText(path.join(SITE_STATIC, `${name}.css`), css);
}

const results = await Promise.all([
  build({
    ...shared,
    entryPoints: MODULE_ENTRIES.map((entry) => path.join(SITE_STATIC, entry)),
    format: "esm",
    splitting: true,
  }),
  build({
    ...shared,
    entryPoints: CLASSIC_ENTRIES.map((entry) => path.join(SITE_STATIC, entry)),
    format: "iife",
  }),
  build({
    ...shared,
    entryPoints: STYLE_ENTRIES.map((entry) => path.join(SITE_STATIC, entry)),
  }),
]);

const manifest: Record<string, string> = {};
const sources = new Set<string>();
const sizes: Array<[string, number]> = [];

for (const { metafile } of results as Array<{ metafile: Metafile }>) {
  for (const [file, meta] of Object.entries(metafile.outputs)) {
    const published = path.relative(SITE_STATIC, path.resolve(file));
    sizes.push([published, meta.bytes]);
    if (meta.entryPoint) {
      manifest[path.relative(SITE_STATIC, path.resolve(meta.entryPoint))] = published;
    }
  }
  for (const input of Object.keys(metafile.inputs)) {
    const rel = path.relative(SITE_STATIC, path.resolve(input));
    // Every bundled module is dead weight in the deployed site.
    if (!rel.startsWith("..")) sources.add(rel);
  }
}

await writeText(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
await writeText(SOURCES, JSON.stringify([...sources].sort(), null, 2) + "\n");

for (const [file, bytes] of sizes.sort((a, b) => b[1] - a[1])) {
  console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB  ${file}`);
}
