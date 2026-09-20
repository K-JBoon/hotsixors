import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import type {
  AnchorMap,
  Gamestrings,
  HeroData,
  HeroLifeData,
  HeroResourceData,
  HeroStats,
  HeroUnitData,
  HeroUnitStats,
  HeroWeaponData,
} from "./types.ts";
import {
  HEROES_IMAGES_DIR,
  GAMEDATA_DIR,
  SITE_CONTENT_HEROES,
  SITE_STATIC_IMAGES,
  SITE_STATIC,
  SITE_DATA,
  gameVersion,
  readHdpInfo,
} from "./lib/paths.ts";
import { readJsonSafe, writeJson, writeText } from "./lib/fs.ts";
import { frontmatter } from "./lib/frontmatter.ts";
import { runScript } from "./lib/script.ts";
import { loadDataFile, loadGamestrings } from "./lib/heroes-data.ts";
import {
  entryNameId,
  getAbilityName,
  getHeroDescription,
  getRoleFromPlaystyles,
  getUnitName,
  splitCamelCase,
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

function heroPage(hero: HeroData, heroName: string, slug: string, displayName: string, gs: Gamestrings): string {
  return frontmatter(
    {
      title: displayName,
      slug,
      template: "heroes/single.html",
      description: getHeroDescription(gs, heroName, hero.variationSkinIds ?? []),
    },
    {
      hero_name: displayName,
      hero_id: hero.hyperlinkId,
      internal_name: heroName,
      unit_id: hero.unitId,
      franchise: hero.franchise ?? "",
      role: getRoleFromPlaystyles(hero.playstyles ?? []),
      in_game_role: gs.hero.expandedRole?.[heroName] ?? "",
      rarity: hero.rarity ?? "",
      release_date: hero.releaseDate ?? "",
      ratings: hero.ratings ?? {},
      portraits: hero.portraits ?? {},
    },
  );
}

const GAMEDATA_HEROES_DIR = path.join(GAMEDATA_DIR, "heroesdata.stormmod/base.stormdata/gamedata/heroes");

function addAlias(aliases: Record<string, string[]>, name: string, internalName: string): void {
  if (name === internalName) return;
  const values = aliases[name] ??= [];
  if (!values.includes(internalName)) values.push(internalName);
}

// Display name -> the heromods directory name, for the heroes whose two differ
// ("brightwing" -> "faeriedragon").
function buildHeroAliases(heroData: Record<string, HeroData>): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const [heroName, hero] of Object.entries(heroData)) {
    addAlias(aliases, heroPageSlug(heroName, hero), heroName.toLowerCase());
  }
  return aliases;
}

// CHero id -> the gamedata directory name, which sometimes keeps an older
// internal id ("greymane" lives in "genndata").
async function addGamedataAliases(aliases: Record<string, string[]>): Promise<void> {
  const dirs = await readdir(GAMEDATA_HEROES_DIR, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory() || !dir.name.endsWith("data")) continue;
    const base = dir.name.slice(0, -"data".length);
    let xml: string;
    try {
      xml = await readFile(path.join(GAMEDATA_HEROES_DIR, dir.name, `${dir.name}.xml`), "utf-8");
    } catch {
      continue;
    }
    const heroId = xml.match(/<CHero id="([^"]+)"/)?.[1];
    if (heroId) addAlias(aliases, heroId.toLowerCase(), base);
  }
}

async function main(): Promise<void> {
  console.log(`gen-heroes: using version ${gameVersion(await readHdpInfo())}`);
  const heroData = (await loadDataFile<Record<string, HeroData>>("herodata")).items;
  const gs = (await loadGamestrings<Gamestrings>()).items;

  const anchorMap = await readJsonSafe<AnchorMap>(path.join(SITE_DATA, "anchor-map.json"));
  const declAnchorMap = await readJsonSafe<AnchorMap>(path.join(SITE_DATA, "decl-anchor-map.json"));
  if (!anchorMap || !declAnchorMap) {
    console.warn("gen-heroes: anchor-map.json not found, XML links will be omitted");
  }

  const SITE_DATA_HEROES = path.join(SITE_DATA, "heroes");

  const { resolveEntry, shortcodeData, abilityDescriptions, missingIcons } =
    createEntryResolver(gs, anchorMap ?? {}, declAnchorMap ?? {});

  for (const [heroName, hero] of Object.entries(heroData)) {
    const slug = heroPageSlug(heroName, hero);
    const displayName = heroPageDisplayName(gs, heroName, hero.hyperlinkId);
    const ctx: HeroContext = { slug, displayName };

    await copyPortraits(hero);
    const abilities = await resolveAbilities(hero, ctx, resolveEntry);
    const talents = await resolveTalents(hero, ctx, resolveEntry);
    const subAbilityGroups = await resolveSubAbilityGroups(hero, gs, ctx, resolveEntry);
    const heroUnitAbilities = await resolveHeroUnits(hero, gs, ctx, resolveEntry);

    await writeText(path.join(SITE_CONTENT_HEROES, `${slug}.md`), heroPage(hero, heroName, slug, displayName, gs));
    console.log(`gen-heroes: wrote ${slug}.md`);

    const stats = buildHeroStats(hero);
    const unitStats = buildHeroUnitStats(hero, gs, stats);
    await writeJson(
      path.join(SITE_DATA_HEROES, `${slug}.json`),
      { stats, unitStats, abilities, subAbilityGroups, heroUnitAbilities, talents },
      2,
    );
    console.log(`gen-heroes: wrote data/heroes/${slug}.json`);
  }

  await writeJson(path.join(SITE_STATIC, "shortcode-data.json"), shortcodeData, 2);
  console.log(`gen-heroes: wrote shortcode-data.json with ${Object.keys(shortcodeData).length} entries`);

  await writeJson(path.join(SITE_STATIC, "ability-descriptions.json"), abilityDescriptions);
  console.log(
    `gen-heroes: wrote ability-descriptions.json with ${Object.keys(abilityDescriptions).length} entries`
  );

  if (missingIcons.size > 0) {
    console.warn(
      `gen-heroes: ${missingIcons.size} icon(s) referenced by heroes-data are missing from heroes-images ` +
      `and were omitted: ${[...missingIcons].sort().join(", ")}`
    );
  }

  const heroAliases = buildHeroAliases(heroData);
  await addGamedataAliases(heroAliases);
  await writeJson(path.join(SITE_STATIC, "hero-aliases.json"), heroAliases, 2);
  console.log(`gen-heroes: wrote hero-aliases.json with ${Object.keys(heroAliases).length} entries`);
  console.log("gen-heroes: done");
}

runScript(import.meta.url, main);
