// Extracts the game data from Blizzard's CASC servers with HeroesDataParser.
// `casc-extract` writes `mods`; the parser run writes `data`, `gamestrings` and
// `images`. --ptr reads the PTR product, and exits with NO_PTR_BUILD when the
// PTR product has no build of its own. --print-build prints the build the patch
// server serves and downloads nothing.

import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { DATA_ROOT, HDP_INFO, gameBuild, gameVersion, readHdpInfo } from "./lib/paths.ts";
import { exists } from "./lib/fs.ts";
import { isMain } from "./lib/script.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

// Pinned: the output layout changes between releases.
const HDP_VERSION = "5.0.4";
const HDP_HOME = path.join(REPO_ROOT, ".hdp");
// The parser writes its CASC cache to the working directory. Keep it out of the
// data root, which every run clears, so a rerun downloads less.
const CASC_CACHE = path.join(HDP_HOME, "casc");

// `:hdp:` selects the XML, packaged maps and layout files.
// Some minimap art is not named for the minimap, so list those files.
const MINIMAP_TEXTURES = [
  "**/*minimap*.dds",
  "**/storm_objectivesdoubloonicon.dds",
  "**/storm_temp_btn-building-terran-bunker.dds",
  "**/storm_temp_war3_btnsacrificialskull.dds",
];
const CASC_FILTERS = [":hdp:", "**/*.galaxy", "**/*.aitree", ...MINIMAP_TEXTURES];

const PATCH_SERVER = "http://us.patch.battle.net:1119";
const LIVE_PRODUCT = "hero";
const PTR_PRODUCT = "herot";
// The PTR product serves the live build between test cycles. The caller reads
// this code as "nothing to build", not as a failure.
const NO_PTR_BUILD = 75;

// map adds the battleground overlays and loading screens.
const EXTRACTORS = ["hero:i", "unit:i", "map:i", "skin"];
const LOCALES = ["enUS"];

const GAMESTRING_FLAGS = [
  "--gs-replace-constant-vars",
  "--gs-replace-style-vars",
  "--gs-preserve-constant-vars",
  "--gs-preserve-style-vars",
  "--localized-text",
  "extract",
];

/** The release build for this machine. The archive unpacks to a like-named directory. */
function target(): string {
  const arch = { x64: "x64", arm64: "arm64" }[os.arch()];
  const platform = { linux: "linux", darwin: "osx" }[os.platform() as string];
  if (!arch || !platform) {
    throw new Error(`no HeroesDataParser build for ${os.platform()}/${os.arch()}`);
  }
  return `${platform}-${arch}`;
}

async function run(command: string, args: string[], cwd?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`))
    );
  });
}

/** Download and unpack the parser, or reuse an earlier unpack. */
async function ensureParser(): Promise<string> {
  const dir = path.join(HDP_HOME, HDP_VERSION, target());
  const binary = path.join(dir, "HeroesDataParser");
  if (await exists(binary)) return binary;

  const name = `HeroesDataParser.${HDP_VERSION}-scd-${target()}.tar.gz`;
  const url = `https://github.com/HeroesToolChest/HeroesDataParser/releases/download/v${HDP_VERSION}/${name}`;
  console.log(`extract-gamedata: downloading ${name}`);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed: ${response.status} ${response.statusText} for ${url}`);
  }

  // Staged beside the destination: a rename cannot cross filesystems.
  await mkdir(HDP_HOME, { recursive: true });
  const staging = await mkdtemp(path.join(HDP_HOME, "staging-"));
  try {
    const archive = path.join(staging, name);
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(archive));
    await run("tar", ["xzf", archive, "-C", staging]);
    await mkdir(path.dirname(dir), { recursive: true });
    await rm(dir, { recursive: true, force: true });
    await rename(path.join(staging, path.basename(dir)), dir);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  await chmod(binary, 0o755);
  return binary;
}

interface ProductBuild {
  build: number;
  version: string;
}

/** The build the patch server serves for a product, from the us region. */
async function productBuild(product: string): Promise<ProductBuild | undefined> {
  const response = await fetch(`${PATCH_SERVER}/${product}/versions`);
  if (!response.ok) {
    throw new Error(`${product} versions: ${response.status} ${response.statusText}`);
  }
  const lines = (await response.text()).split("\n").filter((line) => line && !line.startsWith("#"));
  const columns = lines.shift()?.split("|").map((column) => column.split("!")[0]) ?? [];
  const region = columns.indexOf("Region");
  const build = columns.indexOf("BuildId");
  const version = columns.indexOf("VersionsName");
  if (region < 0 || build < 0 || version < 0) return undefined;

  const row = lines.map((line) => line.split("|")).find((fields) => fields[region] === "us");
  if (!row || !/^\d+$/.test(row[build] ?? "")) return undefined;
  return { build: Number(row[build]), version: row[version] ?? "" };
}

/** The PTR build, or undefined while the PTR product trails or mirrors live. */
async function ptrBuild(): Promise<ProductBuild | undefined> {
  const [ptr, live] = await Promise.all([productBuild(PTR_PRODUCT), productBuild(LIVE_PRODUCT)]);
  if (!ptr) return undefined;
  if (live && ptr.build <= live.build) return undefined;
  return ptr;
}

export interface ExtractOptions {
  /**
   * Called once `casc-extract` has written `mods/`, before the parser run that
   * writes `data/`, `gamestrings/` and `images/`. The parser only reads `mods/`,
   * so work that needs nothing else can start here. See scripts/refresh.ts.
   */
  onModsReady?: () => void;
}

export async function extract({ onModsReady }: ExtractOptions = {}): Promise<void> {
  const ptr = process.argv.includes("--ptr") || process.env.HOTS_PTR === "1";
  const printBuild = process.argv.includes("--print-build");
  const source = ptr ? ["--download-ptr"] : [];

  let target: ProductBuild | undefined;
  if (ptr) {
    target = await ptrBuild().catch((e) => {
      console.error(`extract-gamedata: cannot read the PTR version: ${e}`);
      return undefined;
    });
    if (!target) {
      console.error("extract-gamedata: no PTR build to extract");
      process.exit(NO_PTR_BUILD);
    }
  }

  // --print-build names the build the patch server serves, without a download.
  if (printBuild) {
    const serving = target ?? (await productBuild(LIVE_PRODUCT));
    if (!serving) throw new Error(`${LIVE_PRODUCT}: the patch server names no build`);
    console.log(serving.build);
    return;
  }

  if (target) console.log(`extract-gamedata: PTR build ${target.version}`);

  const parser = await ensureParser();
  console.log(`extract-gamedata: ${ptr ? "PTR" : "live"} -> ${DATA_ROOT}`);

  // Remove the previous build. Its files have different names.
  await rm(DATA_ROOT, { recursive: true, force: true });
  await mkdir(DATA_ROOT, { recursive: true });

  await mkdir(CASC_CACHE, { recursive: true });
  const extract = run(parser, [
    "casc-extract",
    "online",
    ...source,
    ...CASC_FILTERS.flatMap((filter) => ["-i", filter]),
    "-o",
    DATA_ROOT,
  ], CASC_CACHE);

  // A PTR build can leave the CDN while a run reads it.
  if (ptr) {
    await extract.catch((e) => {
      console.error(`extract-gamedata: PTR extract failed: ${e}`);
      process.exit(NO_PTR_BUILD);
    });
  } else {
    await extract;
  }

  if (!(await exists(HDP_INFO))) {
    if (ptr) {
      console.log(`extract-gamedata: casc-extract wrote no ${HDP_INFO}`);
      process.exit(NO_PTR_BUILD);
    }
    throw new Error(`casc-extract wrote no ${HDP_INFO}`);
  }

  onModsReady?.();

  await run(parser, [
    "online",
    ...source,
    ...EXTRACTORS.flatMap((extractor) => ["-e", extractor]),
    ...LOCALES.flatMap((locale) => ["-l", locale]),
    ...GAMESTRING_FLAGS,
    "-o",
    DATA_ROOT,
  ], CASC_CACHE);

  const info = await readHdpInfo();
  if (target && gameBuild(info) !== target.build) {
    console.log(`extract-gamedata: extracted build ${info.Version}, not PTR ${target.version}`);
    process.exit(NO_PTR_BUILD);
  }
  console.log(`extract-gamedata: ${gameVersion(info)} (HDP ${info.HdpVersion})`);
}

// --print-build writes the build number alone, so this script logs no banner.
if (isMain(import.meta.url)) {
  extract().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
