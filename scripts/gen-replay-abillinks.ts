// Rebuilds the ability catalog that a replay's SCmdEvent.m_abil.m_abilLink
// indexes into, from gamedata XML. Output: { "<abilLink>": "<AbilityId>" }.
//
// Reverse-engineered construction rules:
//
//  1. Mod order: core.stormmod, heroes.stormmod, heroesdata.stormmod, then each
//     <Path> in heroesdata's includes.xml, in listed order.
//  2. File order within a mod: implicit per-catalog files (gamedata/<Catalog>Data.xml
//     not listed in GameData.xml) alphabetically, then GameData.xml's <Catalog>
//     list in order.
//  3. A slot is claimed at an id's first *mention*, not its declaration:
//     <AbilArray Link>, <AbilLinkEnable/DisableArray value>, <ParentAbil value>,
//     <LayoutButtons AbilCmd>, <EffectArray Reference="Abil,X">, <CActorRange
//     abil>. Kits scatter as a result: MuradinStormBolt=182, named by
//     heroesdata/unitdata.xml, while the rest of muradindata sits at ~493.
//  4. Index 0 is null. Each id-less class default (<CAbilEffectTarget default="1"/>)
//     reserves one slot per class on first use.
//  5. Re-declaring an existing id claims nothing.
//  6. Non-links: <Charge>/<Cooldown>/<Marker> Link="Abil/X" (pool name),
//     <CActorQuad abil> (area guide visual), dotted Terms="Abil.X.Event".
//  7. Late-resolved fields (<CActorSplat abil>, SubmenuAbilState) claim nothing
//     at the reference site; a dangling id named there reserves a slot at the
//     end of its document.
//
// TODO: SAMURO_CLONE_SLOTS should get figured out eventually (see comment below)

import { readFile, readdir, stat, mkdir, writeFile, copyFile } from "node:fs/promises";
import * as path from "node:path";
import { ABILLINK_STORE, GAMEDATA_DIR, SITE_STATIC, latestGamedataVersion } from "./lib/paths.ts";

const CORE_MODS = ["core.stormmod", "heroes.stormmod", "heroesdata.stormmod"];
const INCLUDES = path.join(GAMEDATA_DIR, "heroesdata.stormmod/base.stormdata/includes.xml");

const dirCache = new Map<string, string[]>();
async function resolveCI(root: string, parts: string[]): Promise<string | null> {
  let cur = root;
  for (const part of parts) {
    if (!dirCache.has(cur)) {
      try {
        dirCache.set(cur, await readdir(cur));
      } catch {
        dirCache.set(cur, []);
      }
    }
    const hit = dirCache.get(cur)!.find((e) => e.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Implicit per-catalog files (abildata.xml, behaviordata.xml, …) load ahead of
// everything GameData.xml lists, in catalog-enum order: alphabetical for every
// name HotS uses. A heromod's own <hero>data.xml shares that directory but is
// not a catalog file; being listed in GameData.xml is the discriminator.
async function implicitFiles(gamedataDir: string, listed: Set<string>): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(gamedataDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^[a-z0-9]+data\.xml$/.test(n))
    .map((n) => path.join(gamedataDir, n))
    .filter((f) => !listed.has(f.toLowerCase()))
    .sort();
}

async function modFiles(modDir: string): Promise<string[]> {
  const base = path.join(modDir, "base.stormdata");
  const gameDataXml = path.join(base, "gamedata.xml");
  const catalogs: string[] = [];
  if (await exists(gameDataXml)) {
    const xml = await readFile(gameDataXml, "utf-8");
    for (const m of xml.matchAll(/<Catalog\s+path="([^"]+)"/gi)) {
      const abs = await resolveCI(base, m[1].replace(/\\/g, "/").split("/"));
      if (abs) catalogs.push(abs);
    }
  }
  const listed = new Set(catalogs.map((f) => f.toLowerCase()));
  const files = await implicitFiles(path.join(base, "gamedata"), listed);
  const seen = new Set(files.map((f) => f.toLowerCase()));
  for (const f of catalogs) {
    if (seen.has(f.toLowerCase())) continue;
    files.push(f);
    seen.add(f.toLowerCase());
  }
  return files;
}

async function modOrder(): Promise<string[]> {
  const order = CORE_MODS.map((m) => path.join(GAMEDATA_DIR, m));
  const xml = await readFile(INCLUDES, "utf-8");
  for (const m of xml.matchAll(/<Path\s+value="([^"]+)"/gi)) {
    const rel = m[1].replace(/\\/g, "/").replace(/^Mods\//i, "").split("/");
    const abs = await resolveCI(GAMEDATA_DIR, rel);
    if (abs) order.push(abs);
  }
  return order;
}

const TAG = /<(\/?)([A-Za-z0-9_]+)((?:\s+[\w:.]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const ATTR = /([\w:.]+)\s*=\s*"([^"]*)"/g;
const ID_CHARS = /^[A-Za-z0-9_]+$/;
const LOOKS_LIKE_ID = /^[A-Za-z][A-Za-z0-9_]{2,}$/;

// Ability-link fields. STRICT_LINK reserves for an id nothing declares; the
// looser ABIL_NAME path takes declared ids only, so <AbilityCategories
// index="Mount"> cannot pass itself off as a link.
const STRICT_LINK =
  /^(Abil|Ability|AbilLink|AbilArray|AbilCmd|ParentAbil|AbilLinkEnableArray|AbilLinkDisableArray|AbilityLink|AbilityCommand)$/i;
const ABIL_NAME = /Abil/i;

// <Charge>/<Cooldown>/<Marker> Link="Abil/X" names a shared pool, not an
// ability: as an attribute or as a nested <Link value="Abil/X"/>. Honouring it
// claims the slot at the pool's first user rather than the ability's own
// declaration, scrambling the block. SamuroCriticalStrike is 807, not 800; same
// defect hit Abathur, Anub'arak, Auriel and Gall.
const SHARING_KEY = /^(Charge|Cooldown|Marker)$/;

// Resolved after the document's ability catalog is built: nothing is claimed at
// the reference site, but a dangling id named there reserves at end of document.
// butcherdata.xml has exactly two, both naming buttons rather than abilities:
// CActorSplat abil="LambToTheSlaughter" and SubmenuAbilState="ButcherFreshMeat",
// which take links 292/293, immediately before ChenStagger=294.
function isLateField(elName: string, attrName: string): boolean {
  return (attrName.toLowerCase() === "abil" && elName === "CActorSplat") || attrName === "SubmenuAbilState";
}

interface Mention {
  kind: "decl" | "ref";
  id: string | null;
  cls?: string;
  late?: boolean;
}

function idsInValue(
  elName: string,
  attrName: string,
  value: string,
  known: Set<string>,
  sharing: boolean
): string[] {
  const out: string[] = [];
  const push = (s: string | undefined) => {
    if (s && ID_CHARS.test(s) && known.has(s)) out.push(s);
  };
  const pushAny = (s: string | undefined) => {
    if (s && LOOKS_LIKE_ID.test(s)) out.push(s);
  };

  // Prefixed catalog reference, valid in any field: Reference="Abil,X,Range".
  // The dotted actor-event form Terms="Abil.X.SourceCastStart" claims nothing:
  // honouring it shifts every link from 126 up by 3.
  for (const m of value.matchAll(/\bAbil(?:Cmd)?,([A-Za-z0-9_]+)/g)) push(m[1]);
  // "Abil/X" is also the sharing-pool namespace: see SHARING_KEY.
  if (!sharing) for (const m of value.matchAll(/\bAbil\/([A-Za-z0-9_]+)/g)) push(m[1]);

  const comma = value.indexOf(",");
  // <CActorQuad abil> reserves nothing: its two dangling ids
  // (SylvanasBlackArrow, TyraelSanctification) would each add a slot and
  // over-shift Tassadar/Tyrael. <CActorSplat abil> reserves late (isLateField).
  // <CActorRange abil> reserves in place even when dangling
  // (ItemShamansBlessing, FaerieDragon*).
  const actorQuadAbil = attrName === "abil" && elName === "CActorQuad";
  if (isLateField(elName, attrName)) {
    pushAny(comma > 0 ? value.slice(0, comma) : value);
  } else if ((STRICT_LINK.test(elName) || STRICT_LINK.test(attrName)) && !actorQuadAbil) {
    pushAny(value);
    if (comma > 0) pushAny(value.slice(0, comma));
  } else if (ABIL_NAME.test(elName) || ABIL_NAME.test(attrName)) {
    push(value);
    if (comma > 0) push(value.slice(0, comma));
  }
  return out;
}

function scanMentions(xml: string, known: Set<string>): Mention[] {
  const out: Mention[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  const open: string[] = []; // enclosing elements, so <Charge><Link/></Charge> is recognised
  while ((m = TAG.exec(xml))) {
    const el = m[2];
    if (m[1]) {
      while (open.length && open.pop() !== el);
      continue;
    }
    const sharing = SHARING_KEY.test(el) || open.some((e) => SHARING_KEY.test(e));
    if (m[4] !== "/") open.push(el);
    const attrs: [string, string][] = [];
    for (const a of m[3].matchAll(ATTR)) attrs.push([a[1], a[2]]);
    if (/^CAbil[A-Za-z]*$/.test(el)) {
      out.push({ kind: "decl", id: attrs.find(([k]) => k === "id")?.[1] ?? null, cls: el });
    }
    for (const [k, v] of attrs) {
      if (k === "id" && /^CAbil/.test(el)) continue;
      if (k === "parent") continue; // template inheritance, not a game link
      if (k === "index") continue; // array/enum key, never a link
      const late = isLateField(el, k);
      for (const id of idsInValue(el, k, v, known, sharing)) out.push({ kind: "ref", id, late });
    }
  }
  return out;
}

export interface CatalogEntry {
  id: string | null;
  cls: string | null;
  file: string;
  kind: "null" | "classdefault" | "decl" | "ref" | "placeholder";
}

// TODO: Haven't figured this one out yet.
//
// samurodata.xml declares 15 CAbil; the live catalog holds 23
// there. A replayed pinned 15 to 797-811 (IllusionMaster=800,
// ImageSelfCast=803, MirrorImageTargeted=804, CriticalStrike=807, Windwalk=808)
// and ChoSurgingFistCast=821 pins Cho'Gall to 820, leaving 812-819: past every
// samurodata declaration.
//
// We reserve 8 slots to line up heroes that come after Samuro again
const SAMURO_MOD = /samuro\.stormmod/i;
const SAMURO_CLONE_SLOTS = 8;

// Every gamedata file the engine loads, in load order.
export async function catalogFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const mod of await modOrder()) for (const f of await modFiles(mod)) files.push(f);
  return files;
}

export async function buildAbilCatalog(): Promise<{ entries: CatalogEntry[]; pos: Map<string, number> }> {
  const files = await catalogFiles();

  // Pass 1: collect declared ids so pass 2 can tell a reference from a literal.
  const known = new Set<string>();
  const texts = new Map<string, string>();
  for (const f of files) {
    let xml: string;
    try {
      xml = await readFile(f, "utf-8");
    } catch {
      continue;
    }
    texts.set(f, xml);
    for (const m of xml.matchAll(/<CAbil[A-Za-z]*\b[^>]*?\bid="([^"]+)"/g)) known.add(m[1]);
  }

  // Pass 2: walk in load order, claiming a slot at each id's first mention.
  const entries: CatalogEntry[] = [{ id: null, cls: null, file: "(reserved)", kind: "null" }];
  const pos = new Map<string, number>();
  const classDefaulted = new Set<string>();
  let sawSamuro = false;
  let clonesEmitted = false;
  for (const f of files) {
    const xml = texts.get(f);
    if (!xml || !/Abil/i.test(xml)) continue;
    const inSamuro = SAMURO_MOD.test(f);
    if (inSamuro) sawSamuro = true;
    // Samuro's underived reservations land at the first ability-bearing file
    // past the mod, ahead of anything ChoGall claims.
    if (sawSamuro && !inSamuro && !clonesEmitted) {
      clonesEmitted = true;
      for (let i = 0; i < SAMURO_CLONE_SLOTS; i++)
        entries.push({ id: null, cls: null, file: "(samuro-clone-placeholder)", kind: "placeholder" });
    }
    const rel = path.relative(GAMEDATA_DIR, f);
    const lateDangling: string[] = [];
    for (const men of scanMentions(xml, known)) {
      if (men.late && men.kind === "ref" && men.id) {
        if (!known.has(men.id) && !pos.has(men.id) && !lateDangling.includes(men.id)) lateDangling.push(men.id);
        continue;
      }
      if (men.kind === "decl" && !men.id) {
        if (classDefaulted.has(men.cls!)) continue;
        classDefaulted.add(men.cls!);
        entries.push({ id: null, cls: men.cls!, file: rel, kind: "classdefault" });
        continue;
      }
      if (pos.has(men.id!)) continue;
      pos.set(men.id!, entries.length);
      entries.push({ id: men.id, cls: men.cls ?? null, file: rel, kind: men.kind });
    }
    for (const id of lateDangling) {
      if (pos.has(id)) continue;
      pos.set(id, entries.length);
      entries.push({ id, cls: null, file: rel, kind: "ref" });
    }
  }
  return { entries, pos };
}

// Build number of the checked-out gamedata, e.g. 2.55.17.97605 -> 97605.
// Replays name the same build in their header.
async function gamedataBuild(): Promise<number> {
  const version = await latestGamedataVersion();
  const build = /\.(\d+)$/.exec(version);
  if (!build) throw new Error(`cannot read build from gamedata version ${version}`);
  return Number(build[1]);
}

async function storedBuilds(): Promise<number[]> {
  let files: string[] = [];
  try {
    files = await readdir(ABILLINK_STORE);
  } catch {
    return [];
  }
  return files
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => Number(f.slice(0, -5)))
    .sort((a, b) => a - b);
}

async function main() {
  console.log("gen-replay-abillinks: starting");
  const build = await gamedataBuild();
  await mkdir(ABILLINK_STORE, { recursive: true });
  const storePath = path.join(ABILLINK_STORE, `${build}.json`);

  if (!(await exists(storePath)) || process.env.ABILLINK_FORCE) {
    const { entries, pos } = await buildAbilCatalog();
    const out: Record<string, string> = {};
    for (const [id, index] of pos) out[String(index)] = id;
    await writeFile(storePath, JSON.stringify(out), "utf-8");
    console.log(`gen-replay-abillinks: build ${build}, ${entries.length} catalog slots, ${pos.size} named abilities`);
  } else {
    console.log(`gen-replay-abillinks: build ${build} already in ${path.relative(process.cwd(), ABILLINK_STORE)}`);
  }

  // Every stored build ships: a replay decodes against the catalog of its own
  // build, or the closest older one.
  const destDir = path.join(SITE_STATIC, "replay", "abillinks");
  await mkdir(destDir, { recursive: true });
  const builds = await storedBuilds();
  for (const b of builds) await copyFile(path.join(ABILLINK_STORE, `${b}.json`), path.join(destDir, `${b}.json`));
  await writeFile(path.join(destDir, "index.json"), JSON.stringify({ builds }), "utf-8");
  console.log(`gen-replay-abillinks: ${builds.length} build(s) -> ${path.relative(process.cwd(), destDir)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
