import { readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { HeroData, HeroUnitData, HeroAbility, HeroTalent, AnchorMap, ShortcodeData, ShortcodeEntry, AbilityStats, HeroStats, HeroUnitStats, HeroResourceData, HeroLifeData, HeroWeaponData } from "./types.ts";
import type { Gamestrings } from "./types.ts";
import {
  HEROES_DATA_DIR,
  HEROES_IMAGES_DIR,
  GAMEDATA_DIR,
  SITE_CONTENT_HEROES,
  SITE_STATIC_IMAGES,
  SITE_STATIC,
  SITE_DATA,
  findLatestVersion,
} from "./lib/paths.ts";
import { loadDataFile, loadGamestrings } from "./lib/heroes-data.ts";
import { parseAbilityStats } from "./lib/abilityxml.ts";
import {
  PASSIVE_ABILITY_ID,
  entryNameId,
  getAbilityName,
  getAbilityShortDesc,
  getAbilityFullDesc,
  getHeroDescription,
  getUnitName,
  renderGameStringMarkup,
  getRoleFromPlaystyles,
  splitCamelCase,
  stripMarkup,
} from "./lib/gamestrings.ts";
import {
  copyImageIfExists,
  createEntryResolver,
  type HeroContext,
  type HeroUnitResolved,
  type ResolveEntry,
  type ResolvedAbility,
  type ResolvedTalent,
  type SubAbilityGroup,
} from "./lib/hero-entries.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

// Friendly labels for sub-ability group parent IDs.
const SUB_ABILITY_LABEL_OVERRIDES: Record<string, string> = {
  "ValeeraStealth": "Stealthed",
};

// Sub-abilities present in the data files but not reachable in game.
const SUB_ABILITY_EXCLUDE_IDS = new Set<string>([
  "CancelSanctification",
  "L90ETCMoshPitCancel",
]);

// Friendly labels for hero unit IDs.
const HERO_UNIT_LABEL_OVERRIDES: Record<string, string> = {
  "RagnarosBigRag": "Molten Core",
  "HeroDVaPilot": "Pilot Form",
  "HeroAlexstraszaDragon": "Dragon Form",
};

const HERO_UNIT_ABILITY_CARD_SKIP_IDS = new Set(["LostVikings"]);

// Maps hyperlinkId values that need special formatting.
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "TheButcher": "The Butcher",
  "Chogall": "Cho'gall",
  "LtMorales": "Lt. Morales",
  "LiMing": "Li Ming",
  "ETC": "E.T.C.",
  "Chogallgall": "Gall",
};

// `heroKey` is the herodata item key; localized names use it, overrides use hyperlinkId.
export function heroDisplayName(gs: Gamestrings, heroKey: string, hyperlinkId: string): string {
  if (DISPLAY_NAME_OVERRIDES[hyperlinkId]) return DISPLAY_NAME_OVERRIDES[hyperlinkId];
  return gs.hero?.name?.[heroKey] ?? splitCamelCase(hyperlinkId);
}

export function heroPageSlug(heroName: string, hero: Pick<HeroData, "hyperlinkId">): string {
  if (heroName === "Cho" && hero.hyperlinkId === "Chogall") return "cho";
  return hero.hyperlinkId.toLowerCase();
}

export function heroPageDisplayName(gs: Gamestrings, heroName: string, hyperlinkId: string): string {
  if (heroName === "Cho" && hyperlinkId === "Chogall") return "Cho";
  return heroDisplayName(gs, heroName, hyperlinkId);
}

// A sub-ability group is keyed by the granting ability or talent link id.
export function parseSubAbilityParentKey(parentKey: string): { parentNameId: string; parentButtonId: string; parentAbilityType: string } {
  const [parentId, parentButtonId, parentAbilityType] = parentKey.split("|");
  return {
    parentNameId: entryNameId({ abilityId: parentId, buttonId: parentButtonId }),
    parentButtonId,
    parentAbilityType,
  };
}

// herodata uses PascalCase; templates and generated JSON use lowercase.
function categorySlug(category: string): string {
  return category.toLowerCase();
}

function tierSlug(tier: string): string {
  return tier.toLowerCase();
}

/** Convert a plain object to a TOML inline table string. */
function toTomlInlineTable(obj: object): string {
  const pairs = Object.entries(obj as Record<string, unknown>).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
  return `{${pairs.join(", ")}}`;
}

interface HeroStatsSource {
  scalingLinkIds?: string[];
  speed?: number;
  life?: HeroLifeData;
  energy?: HeroResourceData;
  weapons?: HeroWeaponData[];
}

// Detects which resource pool the hero uses.
const RESOURCE_KINDS: Array<{ field: keyof HeroStatsSource; label: string }> = [
  { field: "energy", label: "Energy" },
];

export function buildHeroStats(hero: HeroStatsSource): HeroStats | null {
  if (!hero.life) return null;
  const life = {
    amount: hero.life.amount,
    scale: hero.life.scale ?? 0,
    regenRate: hero.life.regenRate,
    regenScale: hero.life.regenScale ?? 0,
  };

  let resource: HeroStats["resource"] = null;
  for (const { field, label } of RESOURCE_KINDS) {
    const r = hero[field] as HeroResourceData | undefined;
    if (r && typeof r.amount === "number") {
      // Casters are signalled by a scaling link containing "Mana".
      let kind = label;
      if (field === "energy") {
        kind = (hero.scalingLinkIds ?? []).some((id) => id.includes("Mana")) ? "Mana" : "Energy";
      }
      resource = { kind, amount: r.amount, regenRate: r.regenRate ?? null };
      break;
    }
  }

  let weapon: HeroStats["weapon"] = null;
  const w = hero.weapons?.[0];
  if (w) {
    weapon = {
      damage: w.damage,
      damageScale: w.damageScale ?? 0,
      range: w.range,
      period: w.period,
      attackSpeed: w.period > 0 ? 1 / w.period : 0,
    };
  }

  return { life, resource, weapon, speed: hero.speed ?? 0 };
}

function shouldPreferHeroUnitStats(stats: HeroStats | null, hero: HeroData): boolean {
  return Boolean(
    stats &&
    stats.life.amount <= 1 &&
    stats.life.regenRate === 0 &&
    !stats.weapon &&
    Object.keys(hero.heroUnits ?? {}).length
  );
}

export function buildHeroUnitStats(hero: HeroData, gs: Gamestrings, stats: HeroStats | null = buildHeroStats(hero)): HeroUnitStats[] {
  if (!shouldPreferHeroUnitStats(stats, hero)) return [];

  const units: HeroUnitStats[] = [];
  for (const [unitId, unitData] of Object.entries(hero.heroUnits ?? {}) as [string, HeroUnitData][]) {
    const unitStats = buildHeroStats(unitData);
    if (!unitStats) continue;
    units.push({
      unitId,
      unitName: HERO_UNIT_LABEL_OVERRIDES[unitId] ?? getUnitName(gs, unitId),
      stats: unitStats,
    });
  }
  return units;
}

export function shouldRenderHeroUnitAbilityCards(hero: Pick<HeroData, "hyperlinkId">): boolean {
  return !HERO_UNIT_ABILITY_CARD_SKIP_IDS.has(hero.hyperlinkId);
}

// Portraits are keyed by variation and may hold one filename or a list.
async function copyPortraits(hero: HeroData): Promise<void> {
  for (const val of Object.values(hero.portraits ?? {})) {
    const filenames: string[] = Array.isArray(val) ? val : typeof val === "string" ? [val] : [];
    for (const f of filenames) {
      await copyImageIfExists(
        path.join(HEROES_IMAGES_DIR, "heroportraits", f),
        path.join(SITE_STATIC_IMAGES, "heroportraits", f)
      );
    }
  }
}

async function resolveAbilities(hero: HeroData, ctx: HeroContext, resolve: ResolveEntry): Promise<ResolvedAbility[]> {
  const out: ResolvedAbility[] = [];
  for (const [category, abilities] of Object.entries(hero.abilities ?? {})) {
    for (const ab of abilities) out.push(await resolve(ab, categorySlug(category), ctx, "ability"));
  }
  return out;
}

async function resolveTalents(hero: HeroData, ctx: HeroContext, resolve: ResolveEntry): Promise<ResolvedTalent[]> {
  const out: ResolvedTalent[] = [];
  for (const [tier, talents] of Object.entries(hero.talents ?? {})) {
    for (const tal of talents) {
      const resolved = await resolve(tal, "talent", ctx, "talent");
      out.push({
        ...resolved,
        tier: tierSlug(tier),
        sort: tal.sort ?? 0,
        abilityTalentLinkIds: (tal.tooltipAbilityLinkIds ?? []).map((linkId) => linkId.split("|")[0]),
      });
    }
  }
  return out;
}

// A group whose every member only cancels, retargets or ends the parent is not
// a kit of its own, so the page can fold it away.
function isSecondaryAbility(nameId: string, parentNameId: string): boolean {
  return /cancel|retarget|off$/i.test(nameId) || nameId === parentNameId;
}

async function resolveSubAbilityGroups(
  hero: HeroData,
  gs: Gamestrings,
  ctx: HeroContext,
  resolve: ResolveEntry
): Promise<SubAbilityGroup[]> {
  const out: SubAbilityGroup[] = [];
  for (const [parentKey, categories] of Object.entries(hero.subAbilities ?? {})) {
    const { parentNameId, parentButtonId, parentAbilityType } = parseSubAbilityParentKey(parentKey);
    // Dismount is the only thing under Mount, and it says nothing.
    if (parentNameId === "Mount") continue;

    const parentLabel = SUB_ABILITY_LABEL_OVERRIDES[parentNameId] ?? getAbilityName(gs, parentKey, parentNameId);
    const abilities: ResolvedAbility[] = [];
    for (const [category, entries] of Object.entries(categories)) {
      for (const ab of entries) {
        if (SUB_ABILITY_EXCLUDE_IDS.has(entryNameId(ab))) continue;
        abilities.push(await resolve(ab, categorySlug(category), ctx, "ability"));
      }
    }
    if (!abilities.length) continue;
    const isSecondary = abilities.every((ab) => isSecondaryAbility(ab.nameId, parentNameId));
    out.push({ parentNameId, parentButtonId, parentAbilityType, parentLabel, abilities, isSecondary });
  }
  return out;
}

// Every hero unit's abilities are resolved so they land in shortcode-data (the
// replay viewer looks up cast ids there). The skip list only suppresses the
// ability cards on the hero page.
async function resolveHeroUnits(
  hero: HeroData,
  gs: Gamestrings,
  ctx: HeroContext,
  resolve: ResolveEntry
): Promise<HeroUnitResolved[]> {
  const out: HeroUnitResolved[] = [];
  const renderCards = shouldRenderHeroUnitAbilityCards(hero);
  for (const [unitId, unitData] of Object.entries(hero.heroUnits ?? {}) as [string, HeroUnitData][]) {
    const abilities: ResolvedAbility[] = [];
    for (const [category, entries] of Object.entries(unitData.abilities ?? {})) {
      for (const ab of entries) abilities.push(await resolve(ab, categorySlug(category), ctx, "ability"));
    }
    if (renderCards && abilities.length > 0) {
      out.push({
        heroUnitId: unitId,
        heroUnitName: HERO_UNIT_LABEL_OVERRIDES[unitId] ?? getUnitName(gs, unitId),
        abilities,
      });
    }
  }
  return out;
}

function heroPageToml(hero: HeroData, heroName: string, slug: string, displayName: string, gs: Gamestrings): string {
  const role = getRoleFromPlaystyles(hero.playstyles ?? []);
  const description = getHeroDescription(gs, heroName, hero.variationSkinIds ?? []);
  return `+++
title = ${JSON.stringify(displayName)}
slug = ${JSON.stringify(slug)}
template = "heroes/single.html"
description = ${JSON.stringify(description)}

[extra]
hero_name = ${JSON.stringify(displayName)}
hero_id = ${JSON.stringify(hero.hyperlinkId)}
internal_name = ${JSON.stringify(heroName)}
unit_id = ${JSON.stringify(hero.unitId)}
franchise = ${JSON.stringify(hero.franchise ?? "")}
role = ${JSON.stringify(role)}
rarity = ${JSON.stringify(hero.rarity ?? "")}
release_date = ${JSON.stringify(hero.releaseDate ?? "")}
ratings = ${toTomlInlineTable(hero.ratings ?? {})}
portraits = ${toTomlInlineTable(hero.portraits ?? {})}
+++
`;
}

// Display name -> the heromods directory name, for the heroes whose two differ
// ("brightwing" -> "faeriedragon").
function buildHeroAliases(heroData: Record<string, HeroData>): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const [heroName, hero] of Object.entries(heroData)) {
    const slug = heroPageSlug(heroName, hero);
    const keyLower = heroName.toLowerCase();
    if (keyLower !== slug) aliases[slug] = keyLower;
  }
  return aliases;
}

async function main(): Promise<void> {
  console.log("gen-heroes: starting");

  const version = await findLatestVersion(HEROES_DATA_DIR);
  console.log(`gen-heroes: using version ${version}`);
  const heroData = (await loadDataFile<Record<string, HeroData>>("herodata", version)).items;
  const gs = (await loadGamestrings<Gamestrings>(version)).items;

  let anchorMap: AnchorMap = {};
  try {
    anchorMap = JSON.parse(await readFile(path.join(SITE_DATA, "anchor-map.json"), "utf-8"));
  } catch {
    console.warn("gen-heroes: anchor-map.json not found — XML links will be omitted");
  }

  const SITE_DATA_HEROES = path.join(SITE_DATA, "heroes");
  for (const dir of [
    SITE_CONTENT_HEROES,
    SITE_DATA_HEROES,
    path.join(SITE_STATIC_IMAGES, "abilitytalents"),
    path.join(SITE_STATIC_IMAGES, "heroportraits"),
  ]) {
    await mkdir(dir, { recursive: true });
  }

  const { resolveEntry, shortcodeData, missingIcons } = createEntryResolver(gs, anchorMap);

  for (const [heroName, hero] of Object.entries(heroData)) {
    const slug = heroPageSlug(heroName, hero);
    const displayName = heroPageDisplayName(gs, heroName, hero.hyperlinkId);
    const ctx: HeroContext = { slug, displayName };

    await copyPortraits(hero);
    const abilities = await resolveAbilities(hero, ctx, resolveEntry);
    const talents = await resolveTalents(hero, ctx, resolveEntry);
    const subAbilityGroups = await resolveSubAbilityGroups(hero, gs, ctx, resolveEntry);
    const heroUnitAbilities = await resolveHeroUnits(hero, gs, ctx, resolveEntry);

    await writeFile(path.join(SITE_CONTENT_HEROES, `${slug}.md`), heroPageToml(hero, heroName, slug, displayName, gs), "utf-8");
    console.log(`gen-heroes: wrote ${slug}.md`);

    const stats = buildHeroStats(hero);
    const unitStats = buildHeroUnitStats(hero, gs, stats);
    await writeFile(
      path.join(SITE_DATA_HEROES, `${slug}.json`),
      JSON.stringify({ stats, unitStats, abilities, subAbilityGroups, heroUnitAbilities, talents }, null, 2),
      "utf-8"
    );
    console.log(`gen-heroes: wrote data/heroes/${slug}.json`);
  }

  await writeFile(path.join(SITE_STATIC, "shortcode-data.json"), JSON.stringify(shortcodeData, null, 2), "utf-8");
  console.log(`gen-heroes: wrote shortcode-data.json with ${Object.keys(shortcodeData).length} entries`);

  if (missingIcons.size > 0) {
    console.warn(
      `gen-heroes: ${missingIcons.size} icon(s) referenced by heroes-data are missing from heroes-images ` +
      `and were omitted: ${[...missingIcons].sort().join(", ")}`
    );
  }

  const heroAliases = buildHeroAliases(heroData);
  await writeFile(path.join(SITE_STATIC, "hero-aliases.json"), JSON.stringify(heroAliases, null, 2), "utf-8");
  console.log(`gen-heroes: wrote hero-aliases.json with ${Object.keys(heroAliases).length} entries`);
  console.log("gen-heroes: done");
}

if (path.resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
