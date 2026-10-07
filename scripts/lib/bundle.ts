import { rm } from "node:fs/promises";
import * as path from "node:path";
import { context, type BuildOptions, type BuildResult, type Metafile } from "esbuild";
import { SITE_CSS, SITE_DATA, SITE_STATIC } from "./paths.ts";
import { writeText } from "./fs.ts";

const OUT_DIR = path.join(SITE_STATIC, "bundle");
const MANIFEST = path.join(SITE_DATA, "bundles.json");
const SOURCES = path.join(SITE_DATA, "bundle-sources.json");

/** Entry scripts the templates load, by their path under site/static. */
const MODULE_ENTRIES = ["hotsixors.js", "replay/replay-ui.js", "draft/draft.js"];
const CLASSIC_ENTRIES = ["level-slider.js", "underdog-calc.js"];

/** Sheets under site/css, published as `<name>.css`. */
const SITE_ENTRIES = ["main.css", "gamedata.css"];

/** Plain stylesheets the templates load, by their path under site/static. */
const STYLE_ENTRIES = [
  "replay/replay.css",
  "draft/draft.css",
  "lost-in-the-nexus/viewer.css",
  "lost-in-the-nexus/nexus-game.css",
];

const CSS_TARGET = ["chrome111", "firefox113", "safari16.2"];

type Built = BuildResult & { metafile: Metafile };

/** The bundles.json key: the path the source would have under site/static. */
function manifestKey(entryPoint: string): string {
  const file = path.resolve(entryPoint);
  return path.dirname(file) === SITE_CSS ? path.basename(file) : path.relative(SITE_STATIC, file);
}

async function writeManifests(results: Built[]): Promise<Array<[string, number]>> {
  const manifest: Record<string, string> = {};
  const sources = new Set<string>();
  const sizes: Array<[string, number]> = [];

  for (const { metafile } of results) {
    for (const [file, meta] of Object.entries(metafile.outputs)) {
      const published = path.relative(SITE_STATIC, path.resolve(file));
      sizes.push([published, meta.bytes]);
      if (meta.entryPoint) {
        manifest[manifestKey(meta.entryPoint)] = published;
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
  return sizes.sort((a, b) => b[1] - a[1]);
}

export interface BundleOptions {
  /**
   * Rebuild on every source change and drop the content hash from the output
   * names: `zola serve` reads bundles.json once, so only stable names survive a
   * rebuild. Returns once the first build is on disk.
   */
  watch?: boolean;
}

export async function bundleClient({ watch: watchMode = false }: BundleOptions = {}): Promise<void> {
  await rm(OUT_DIR, { recursive: true, force: true });

  const shared: BuildOptions = {
    outdir: OUT_DIR,
    outbase: SITE_STATIC,
    bundle: true,
    target: "es2022",
    minify: !watchMode,
    // `node:` imports are the Node-only test paths inside the replay modules;
    // trystero is fetched from a CDN at runtime.
    external: ["node:*", "https://*", "/fonts/*"],
    // Hashed names let the whole bundle directory be cached immutably.
    entryNames: watchMode ? "[dir]/[name]" : "[dir]/[name]-[hash]",
    metafile: true,
    logLevel: "warning",
  };

  const contexts = await Promise.all([
    context({
      ...shared,
      entryPoints: MODULE_ENTRIES.map((entry) => path.join(SITE_STATIC, entry)),
      format: "esm",
      splitting: true,
    }),
    context({
      ...shared,
      entryPoints: CLASSIC_ENTRIES.map((entry) => path.join(SITE_STATIC, entry)),
      format: "iife",
    }),
    context({
      ...shared,
      // Browser targets make esbuild flatten nesting.
      target: CSS_TARGET,
      entryPoints: [
        ...SITE_ENTRIES.map((entry) => ({ in: path.join(SITE_CSS, entry), out: entry.replace(/\.css$/, "") })),
        ...STYLE_ENTRIES.map((entry) => ({ in: path.join(SITE_STATIC, entry), out: entry.replace(/\.css$/, "") })),
      ],
    }),
  ]);

  const sizes = await writeManifests((await Promise.all(contexts.map((ctx) => ctx.rebuild()))) as Built[]);

  if (watchMode) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    return;
  }

  await Promise.all(contexts.map((ctx) => ctx.dispose()));
  for (const [file, bytes] of sizes) {
    console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB  ${file}`);
  }
}
