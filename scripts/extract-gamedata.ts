// Extracts the game data from Blizzard's CASC servers with HeroesDataParser.
// `casc-extract` writes `mods`; the parser run writes `data`, `gamestrings` and
// `images`. --ptr reads the PTR product.

import { spawn } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { DATA_ROOT, HDP_INFO, gameVersion, readHdpInfo } from "./lib/paths.ts";

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
const CASC_FILTERS = [":hdp:", "**/*.galaxy", ...MINIMAP_TEXTURES];

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

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
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

async function main(): Promise<void> {
  const ptr = process.argv.includes("--ptr") || process.env.HOTS_PTR === "1";
  const source = ptr ? ["--download-ptr"] : [];

  const parser = await ensureParser();
  console.log(`extract-gamedata: ${ptr ? "PTR" : "live"} -> ${DATA_ROOT}`);

  // Remove the previous build. Its files have different names.
  await rm(DATA_ROOT, { recursive: true, force: true });
  await mkdir(DATA_ROOT, { recursive: true });

  await mkdir(CASC_CACHE, { recursive: true });
  await run(parser, [
    "casc-extract",
    "online",
    ...source,
    ...CASC_FILTERS.flatMap((filter) => ["-i", filter]),
    "-o",
    DATA_ROOT,
  ], CASC_CACHE);

  if (!(await exists(HDP_INFO))) {
    throw new Error(`casc-extract wrote no ${HDP_INFO}`);
  }

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
  console.log(`extract-gamedata: ${gameVersion(info)} (HDP ${info.HdpVersion})`);
}

if (path.resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
