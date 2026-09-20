import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import type { DraftHero, DraftBattleground, DraftDataFile } from "./types.ts";
import { SITE_CONTENT_HEROES, SITE_DATA_BATTLEGROUNDS, SITE_STATIC } from "./lib/paths.ts";
import { displayPath, exists, readJson, writeJson } from "./lib/fs.ts";
import { runScript } from "./lib/script.ts";
import { frontmatterValue } from "./lib/frontmatter.ts";

const OUTPUT_DIR = path.join(SITE_STATIC, "draft");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "draft-data.json");
const MAP_BACKGROUNDS_DIR = path.join(OUTPUT_DIR, "maps");
const EXTRA_DRAFT_BATTLEGROUNDS: Array<Pick<DraftBattleground, "slug" | "name">> = [
  { slug: "braxis-holdout", name: "Braxis Holdout" },
];

function extractPortrait(frontmatter: string): string | null {
  const m = frontmatter.match(/draftScreen\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

/** The map background the draft tool shows, when one was rendered. */
async function mapBackground(slug: string): Promise<{ background?: string }> {
  const file = path.join(MAP_BACKGROUNDS_DIR, `${slug}.webp`);
  return await exists(file) ? { background: `/draft/maps/${slug}.webp` } : {};
}

async function readHeroes(): Promise<DraftHero[]> {
  const files = (await readdir(SITE_CONTENT_HEROES))
    .filter(f => f.endsWith(".md") && f !== "_index.md");
  const out: DraftHero[] = [];
  for (const file of files) {
    const text = await readFile(path.join(SITE_CONTENT_HEROES, file), "utf8");
    const fm = text.split("+++")[1] ?? "";
    const id = frontmatterValue(fm, "hero_id");
    const slug = frontmatterValue(fm, "slug");
    const name = frontmatterValue(fm, "hero_name");
    const franchise = frontmatterValue(fm, "franchise");
    const role = frontmatterValue(fm, "in_game_role");
    const portrait = extractPortrait(fm);
    if (!id || !slug || !name || !franchise || !portrait || !role) {
      throw new Error(`Hero ${file} is missing required front-matter fields`);
    }
    out.push({ id, slug, name, role, portrait, franchise });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return out;
}

async function readBattlegrounds(): Promise<DraftBattleground[]> {
  const files = (await readdir(SITE_DATA_BATTLEGROUNDS)).filter(f => f.endsWith(".json"));
  const out: DraftBattleground[] = [];
  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    const data = await readJson<{ name?: string }>(path.join(SITE_DATA_BATTLEGROUNDS, file));
    out.push({ slug, name: data.name ?? slug, ...(await mapBackground(slug)) });
  }
  for (const bg of EXTRA_DRAFT_BATTLEGROUNDS) {
    if (out.some(existing => existing.slug === bg.slug)) continue;
    out.push({ ...bg, ...(await mapBackground(bg.slug)) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return out;
}

async function main(): Promise<void> {
  const [heroes, battlegrounds] = await Promise.all([readHeroes(), readBattlegrounds()]);
  await writeJson(OUTPUT_FILE, { heroes, battlegrounds } satisfies DraftDataFile);
  console.log(`gen-draft-data: ${heroes.length} heroes, ${battlegrounds.length} battlegrounds -> ${displayPath(OUTPUT_FILE)}`);
}

runScript(import.meta.url, main);
