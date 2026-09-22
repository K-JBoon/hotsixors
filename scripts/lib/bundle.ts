import { rm } from "node:fs/promises";
import { watch } from "node:fs";
import * as path from "node:path";
import { context, type BuildOptions, type BuildResult, type Metafile } from "esbuild";
import * as sass from "sass";
import { SITE_DATA, SITE_SASS, SITE_STATIC } from "./paths.ts";
import { writeText } from "./fs.ts";

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

type Built = BuildResult & { metafile: Metafile };

async function compileSass(): Promise<void> {
  for (const name of SASS_ENTRIES) {
    const { css } = sass.compile(path.join(SITE_SASS, `${name}.scss`), { loadPaths: [SITE_SASS] });
    await writeText(path.join(SITE_STATIC, `${name}.css`), css);
  }
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
  return sizes.sort((a, b) => b[1] - a[1]);
}

/** Recompile the sheets whenever anything under site/sass changes. */
function watchSass(): void {
  let pending: NodeJS.Timeout | undefined;
  watch(SITE_SASS, { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      compileSass().catch((e: unknown) => console.error(`sass: ${(e as Error).message}`));
    }, 50);
  });
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
  await compileSass();

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
      entryPoints: STYLE_ENTRIES.map((entry) => path.join(SITE_STATIC, entry)),
    }),
  ]);

  const sizes = await writeManifests((await Promise.all(contexts.map((ctx) => ctx.rebuild()))) as Built[]);

  if (watchMode) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    watchSass();
    return;
  }

  await Promise.all(contexts.map((ctx) => ctx.dispose()));
  for (const [file, bytes] of sizes) {
    console.log(`${(bytes / 1024).toFixed(1).padStart(8)} KB  ${file}`);
  }
}
