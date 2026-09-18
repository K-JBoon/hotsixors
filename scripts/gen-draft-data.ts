import { access, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import type { DraftHero, DraftBattleground, DraftDataFile } from "./types.ts";
import { SITE_CONTENT_HEROES, SITE_DATA_BATTLEGROUNDS, SITE_STATIC } from "./lib/paths.ts";
import { frontmatterValue } from "./lib/frontmatter.ts";

const OUTPUT_DIR = path.join(SITE_STATIC, "draft");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "draft-data.json");
const MAP_BACKGROUNDS_DIR = path.join(OUTPUT_DIR, "maps");
const EXTRA_DRAFT_BATTLEGROUNDS: Array<Pick<DraftBattleground, "slug" | "name">> = [
  { slug: "braxis-holdout", name: "Braxis Holdout" },
];

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function extractPortrait(frontmatter: string): string | null {
  const m = frontmatter.match(/draftScreen\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
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
    const data = JSON.parse(await readFile(path.join(SITE_DATA_BATTLEGROUNDS, file), "utf8"));
    const name = typeof data.name === "string" ? data.name : slug;
    const backgroundFile = path.join(MAP_BACKGROUNDS_DIR, `${slug}.webp`);
    const background = await fileExists(backgroundFile) ? `/draft/maps/${slug}.webp` : undefined;
    out.push({ slug, name, ...(background ? { background } : {}) });
  }
  for (const bg of EXTRA_DRAFT_BATTLEGROUNDS) {
    if (out.some(existing => existing.slug === bg.slug)) continue;
    const backgroundFile = path.join(MAP_BACKGROUNDS_DIR, `${bg.slug}.webp`);
    const background = await fileExists(backgroundFile) ? `/draft/maps/${bg.slug}.webp` : undefined;
    out.push({ ...bg, ...(background ? { background } : {}) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return out;
}

async function main(): Promise<void> {
  const [heroes, battlegrounds] = await Promise.all([readHeroes(), readBattlegrounds()]);
  const output: DraftDataFile = { heroes, battlegrounds };
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(output));
  console.log(`gen-draft-data: ${heroes.length} heroes, ${battlegrounds.length} battlegrounds → ${OUTPUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
