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

// In-game role classification. The upstream data only carries legacy roles.
const IN_GAME_ROLE: Record<string, string> = {
  // Tank
  Anubarak: "Tank", Arthas: "Tank", Blaze: "Tank", Chogall: "Tank",
  Diablo: "Tank", ETC: "Tank", Garrosh: "Tank", Johanna: "Tank",
  MalGanis: "Tank", Mei: "Tank", Muradin: "Tank", Stitches: "Tank",
  Tyrael: "Tank",
  // Bruiser
  Artanis: "Bruiser", Chen: "Bruiser", DVa: "Bruiser", Deathwing: "Bruiser",
  Dehaka: "Bruiser", Gazlowe: "Bruiser", Hogger: "Bruiser", Imperius: "Bruiser",
  Leoric: "Bruiser", Malthael: "Bruiser", Ragnaros: "Bruiser", Rexxar: "Bruiser",
  Sonya: "Bruiser", Thrall: "Bruiser", Varian: "Bruiser", Xul: "Bruiser",
  Yrel: "Bruiser",
  // Melee Assassin
  Alarak: "Melee Assassin", Illidan: "Melee Assassin", Kerrigan: "Melee Assassin",
  Maiev: "Melee Assassin", Murky: "Melee Assassin", Qhira: "Melee Assassin",
  Samuro: "Melee Assassin", TheButcher: "Melee Assassin",
  Valeera: "Melee Assassin", Zeratul: "Melee Assassin",
  // Ranged Assassin
  Azmodan: "Ranged Assassin", Cassia: "Ranged Assassin", Chromie: "Ranged Assassin",
  Falstad: "Ranged Assassin", Fenix: "Ranged Assassin", Gall: "Ranged Assassin",
  Genji: "Ranged Assassin", Greymane: "Ranged Assassin", Guldan: "Ranged Assassin",
  Hanzo: "Ranged Assassin", Jaina: "Ranged Assassin", Junkrat: "Ranged Assassin",
  Kaelthas: "Ranged Assassin", KelThuzad: "Ranged Assassin",
  LiMing: "Ranged Assassin", Lunara: "Ranged Assassin", Mephisto: "Ranged Assassin",
  Nazeebo: "Ranged Assassin", Nova: "Ranged Assassin", Orphea: "Ranged Assassin",
  Probius: "Ranged Assassin", Raynor: "Ranged Assassin",
  SgtHammer: "Ranged Assassin", Sylvanas: "Ranged Assassin",
  Tracer: "Ranged Assassin", Tychus: "Ranged Assassin", Valla: "Ranged Assassin",
  Zagara: "Ranged Assassin", Zuljin: "Ranged Assassin",
  // Healer
  Alexstrasza: "Healer", Ana: "Healer", Anduin: "Healer", Auriel: "Healer",
  Brightwing: "Healer", Deckard: "Healer", Kharazim: "Healer", LiLi: "Healer",
  LtMorales: "Healer", Lucio: "Healer", Malfurion: "Healer", Rehgar: "Healer",
  Stukov: "Healer", Tyrande: "Healer", Uther: "Healer", Whitemane: "Healer",
  // Support
  Abathur: "Support", LostVikings: "Support", Medivh: "Support",
  Tassadar: "Support", Zarya: "Support",
};

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
    const portrait = extractPortrait(fm);
    if (!id || !slug || !name || !franchise || !portrait) {
      throw new Error(`Hero ${file} is missing required front-matter fields`);
    }
    const role = IN_GAME_ROLE[id];
    if (!role) {
      throw new Error(`Hero ${id} (${file}) is missing from the IN_GAME_ROLE map`);
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
