import { rm } from "node:fs/promises";
import { readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  context,
  type BuildOptions,
  type BuildResult,
  type Metafile,
  type PartialMessage,
  type Plugin,
} from "esbuild";
import * as sass from "sass";
import { SITE_DATA, SITE_SASS, SITE_STATIC } from "./paths.ts";
import { writeText } from "./fs.ts";

const OUT_DIR = path.join(SITE_STATIC, "bundle");
const MANIFEST = path.join(SITE_DATA, "bundles.json");
const SOURCES = path.join(SITE_DATA, "bundle-sources.json");

/** Entry scripts the templates load, by their path under site/static. */
const MODULE_ENTRIES = ["hotsixors.js", "replay/replay-ui.js", "draft/draft.js"];
const CLASSIC_ENTRIES = ["level-slider.js", "underdog-calc.js"];

/** Sheets under site/sass, published as `<name>.css`. */
const SASS_ENTRIES = ["main", "gamedata"];

/** Plain stylesheets the templates load, by their path under site/static. */
const STYLE_ENTRIES = ["replay/replay.css", "draft/draft.css", "lost-in-the-nexus/viewer.css"];

type Built = BuildResult & { metafile: Metafile };

const sassFiles = (): string[] =>
  readdirSync(SITE_SASS)
    .filter((file) => file.endsWith(".scss"))
    .map((file) => path.join(SITE_SASS, file));

function sassMessage(error: unknown): PartialMessage {
  if (!(error instanceof sass.Exception)) return { text: String(error) };
  const { url, start, context } = error.span;
  return {
    text: error.sassMessage,
    location: url && {
      file: fileURLToPath(url),
      line: start.line + 1,
      column: start.column,
      lineText: context?.split("\n")[0],
    },
  };
}

/** Compiles .scss in esbuild so its watcher tracks every partial the sheet loads. */
function sassPlugin(): Plugin {
  const lastGood = new Map<string, string>();
  return {
    name: "sass",
    setup(build) {
      build.onLoad({ filter: /\.scss$/ }, ({ path: file }) => {
        try {
          const { css, loadedUrls } = sass.compile(file, { loadPaths: [SITE_SASS] });
          lastGood.set(file, css);
          return { contents: css, loader: "css", watchFiles: loadedUrls.map((url) => fileURLToPath(url)) };
        } catch (error) {
          // A failed compile reports no imports, so watch every sheet until one fixes it.
          const watched = { watchFiles: sassFiles(), watchDirs: [SITE_SASS] };
          const stale = lastGood.get(file);
          // A failed rebuild deletes its outputs, so keep serving the last good sheet.
          return stale === undefined
            ? { errors: [sassMessage(error)], ...watched }
            : { contents: stale, loader: "css" as const, warnings: [sassMessage(error)], ...watched };
        }
      });
    },
  };
}

/** The bundles.json key: the path the source would have under site/static. */
function manifestKey(entryPoint: string): string {
  const file = path.resolve(entryPoint);
  return path.dirname(file) === SITE_SASS
    ? `${path.basename(file, ".scss")}.css`
    : path.relative(SITE_STATIC, file);
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
      entryPoints: [
        ...SASS_ENTRIES.map((name) => ({ in: path.join(SITE_SASS, `${name}.scss`), out: name })),
        ...STYLE_ENTRIES.map((entry) => ({ in: path.join(SITE_STATIC, entry), out: entry.replace(/\.css$/, "") })),
      ],
      plugins: [sassPlugin()],
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
