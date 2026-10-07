import { readFile, readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import type {
  AbilityStats,
  AnchorMap,
  Gamestrings,
  HeroData,
  HeroLifeData,
  HeroResourceData,
  HeroShieldData,
  HeroStats,
  HeroUnitData,
  HeroUnitStats,
  HeroStatsWeaponTiming,
  HeroWeaponData,
} from "./types.ts";
import {
  HEROES_IMAGES_DIR,
  CASC_PORTRAITS_DIR,
  GAMEDATA_DIR,
  SITE_CONTENT_HEROES,
  SITE_STATIC_IMAGES,
  SITE_STATIC,
  SITE_DATA,
  gameVersion,
  readHdpInfo,
} from "./lib/paths.ts";
import { readJsonSafe, writeJson, writeText } from "./lib/fs.ts";
import {
  buildCatalogIndex,
  loadWeaponCatalogFiles,
  readBuffModification,
  readWeaponDamageMultiplier,
  readWeaponTiming,
  type BuffModification,
} from "./lib/weapon-timing.ts";
import { frontmatter } from "./lib/frontmatter.ts";
import { findHeroSelectExtras, withHeroSelectExtras } from "./lib/hero-select-extras.ts";
import { gatedBy } from "./lib/ability-phases.ts";
import { runScript } from "./lib/script.ts";
import { loadDataFile, loadGamestrings } from "./lib/heroes-data.ts";
import { buildEffectGraph, type EffectGraph } from "./lib/effect-graph/index.ts";
import { buildReverseRefs } from "./lib/effect-graph/walk.ts";
import { createDeadGates, createReachability } from "./lib/ability-reachability.ts";
import { heroSummons, type Summon, type SummonEntry } from "./lib/hero-summons.ts";
import { assignAreas, assignNotes, assignTicks } from "./lib/area-owners.ts";
import { tickNote } from "./lib/ability-ticks.ts";
import { loadGamedataXmlFiles } from "./lib/gamedata-paths.ts";
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
  type SummonResolved,
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

// Heroes with stats blocks beside the main unit: one per hero unit, plus one per buff form of the main unit.
// `unitBuffs` maps a hero unit to the buff that is always on it in that form.
// `icons` maps a form label to the ability icon shown when the form has no portrait of its own.
interface HeroForms {
  main: string;
  unitBuffs?: Record<string, string>;
  buffForms?: Record<string, string>;
  icons?: Record<string, string>;
}

const HERO_FORMS: Record<string, HeroForms> = {
  "DVa": { main: "Mech Form" },
  "Alexstrasza": {
    main: "Normal Form",
    unitBuffs: { HeroAlexstraszaDragon: "AlexstraszaDragonqueenHealthIncrease" },
    icons: { "Dragon Form": "storm_ui_icon_alexstrasza_dragon_queen.png" },
  },
  "Rexxar": { main: "Rexxar" },
  "Greymane": {
    main: "Human Form",
    buffForms: { "Worgen Form": "GreymaneWorgenForm" },
    icons: { "Worgen Form": "storm_ui_icon_greymane_curseoftheworgen.png" },
  },
};

const HERO_UNIT_ABILITY_CARD_SKIP_IDS = new Set(["LostVikings"]);

// Friendly labels for summoned unit IDs.
const SUMMON_LABEL_OVERRIDES: Record<string, string> = {
  "GallEyeOfKilroggPlacedUnit": "Eye of Kilrogg",
  "GazloweXplodiumChargeArkReaktorRockItTurret": "Rock-It! Turret",
  "NecromancerRaiseSkeleton": "Skeletal Warrior",
  "NecromancerRaiseSkeletonBonePrisonTalentJailor": "Skeletal Warrior",
  "RexxarUnleashTheBoarsUnit": "Boar",
  "VarianBannerOfDalaran": "Banner of Dalaran",
  "WitchDoctorCorpseSpider": "Corpse Spider",
  "WitchDoctorZombieWallDeadRushTalentUnit": "Dead Rush Zombie",
  "XalatathVoidConvergencePortalUnit": "Void Portal",
  "XalatathVoidConvergenceRiftInvasionPortalUnit": "Void Portal",
};

// Summons the game flags Untargetable, so the stored life is a placeholder.
const SUMMON_INVULNERABLE_IDS = new Set(["RexxarUnleashTheBoarsUnit"]);

// Summoned stand-ins for the hero itself.
const SUMMON_EXCLUDE_IDS = new Set(["LeoricWraithWalkUnit"]);

// Summons the Galaxy script spawns, keyed by herodata key.
const SCRIPT_SUMMONS: Record<string, Summon[]> = {
  Raynor: [{ unitId: "RaynorRaynorsBanshee", sourceId: "RaynorRaynorsRaidersDummy" }],
};

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
  isMelee?: boolean;
  scalingLinkIds?: string[];
  speed?: number;
  radius?: number;
  life?: HeroLifeData;
  shield?: HeroShieldData;
  energy?: HeroResourceData;
  energyType?: string;
  energyTone?: string;
  weapons?: HeroWeaponData[];
}

// In-game resource bar colors. Heroes not listed use the mana blue.
const RESOURCE_TONES: Record<string, string> = {
  Auriel: "yellow",
  Barbarian: "orange",
  Chen: "yellow",
  Deathwing: "orange",
  DVa: "pink",
  Hogger: "red",
  Junkrat: "orange",
  Medic: "yellow",
  Tinker: "orange",
  Valeera: "yellow",
  Zarya: "magenta",
};

export function withResourceType(gs: Gamestrings, heroName: string, hero: HeroData): HeroData {
  const energyType = gs.hero.energyType?.[heroName];
  const energyTone = RESOURCE_TONES[heroName];
  const heroUnits = hero.heroUnits && Object.fromEntries(
    Object.entries(hero.heroUnits).map(([id, unit]) => [id, { ...unit, energyType: gs.unit.energyType?.[id] ?? energyType, energyTone }]),
  );
  return { ...hero, energyType, energyTone, heroUnits };
}

export interface CatalogLookup {
  weaponTiming: (weaponId: string) => HeroStatsWeaponTiming | null;
  weaponDamageMultiplier: (weaponId: string) => number;
  buff: (behaviorId: string) => BuffModification | null;
}

const NO_CATALOG: CatalogLookup = { weaponTiming: () => null, weaponDamageMultiplier: () => 1, buff: () => null };

// Ranged heroes list a close-range fallback weapon first.
export function primaryWeapon(hero: HeroStatsSource): HeroWeaponData | undefined {
  const enabled = (hero.weapons ?? []).filter((w) => !w.isDisabled);
  if (hero.isMelee !== false) return enabled[0];
  return enabled.reduce<HeroWeaponData | undefined>((best, w) => (!best || w.range > best.range ? w : best), undefined);
}

const toPct = (scale: number): number => Number((scale * 100).toFixed(2));

export function buildHeroStats(hero: HeroStatsSource, catalog: CatalogLookup = NO_CATALOG): HeroStats | null {
  if (!hero.life) return null;
  const life = {
    amount: hero.life.amount,
    scale: hero.life.scale ?? 0,
    scalePct: toPct(hero.life.scale ?? 0),
    regenRate: hero.life.regenRate,
    regenScale: hero.life.regenScale ?? 0,
  };
  const shield = hero.shield ? {
    amount: hero.shield.amount,
    scale: hero.shield.scale ?? 0,
    scalePct: toPct(hero.shield.scale ?? 0),
    regenRate: hero.shield.regenRate,
    regenScale: hero.shield.regenScale ?? 0,
    regenDelay: hero.shield.regenDelay ?? 0,
  } : null;

  let resource: HeroStats["resource"] = null;
  const r = hero.energy;
  if (r && typeof r.amount === "number") {
    // Mana that grows per level comes with a scaling link containing "Mana".
    const flatPerLevel = (hero.scalingLinkIds ?? []).some((id) => id.includes("Mana"));
    resource = {
      kind: hero.energyType ?? (flatPerLevel ? "Mana" : "Energy"),
      tone: hero.energyTone ?? null,
      flatPerLevel,
      amount: r.amount,
      regenRate: r.regenRate ?? null,
    };
  }

  let weapon: HeroStats["weapon"] = null;
  const w = primaryWeapon(hero);
  if (w) {
    weapon = {
      damage: w.damage * catalog.weaponDamageMultiplier(w.nameId),
      damageScale: w.damageScale ?? 0,
      damageScalePct: toPct(w.damageScale ?? 0),
      range: w.range,
      period: w.period,
      attackSpeed: w.period > 0 ? 1 / w.period : 0,
      timing: catalog.weaponTiming(w.nameId),
    };
  }

  return { life, shield, resource, weapon, speed: hero.speed ?? 0, radius: hero.radius ?? 0 };
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

function withBuff(unit: HeroStatsSource, buff: BuffModification | null): HeroStatsSource {
  if (!buff) return unit;
  const toggle = (w: HeroWeaponData): HeroWeaponData =>
    buff.weaponEnable.includes(w.nameId) ? { ...w, isDisabled: false }
    : buff.weaponDisable.includes(w.nameId) ? { ...w, isDisabled: true }
    : w;
  return {
    ...unit,
    life: unit.life && { ...unit.life, amount: unit.life.amount + buff.lifeMax },
    weapons: unit.weapons?.map(toggle),
  };
}

// Image paths under images/.
export function heroPortrait(hero: Pick<HeroData, "portraits">): string {
  const file = hero.portraits?.target ?? hero.portraits?.targetInfo;
  return file ? `heroportraits/${file}` : "";
}

const formIcon = (icons: Record<string, string>, label: string): string =>
  icons[label] ? `abilitytalents/${icons[label]}` : "";

// Hero unit art is a party frame, or target info panel art extracted from CASC into CASC_PORTRAITS_DIR.
// A unit that reuses the hero's own portrait file has no art of its own.
function unitPortraitFile(hero: HeroData, unitData: HeroUnitData): string {
  const file = unitData.portraits?.targetInfo ?? "";
  if (!file || file === hero.portraits?.targetInfo) return "";
  return /partyframe|targetinfopanel_unit_hero_/.test(file) ? file : "";
}

function heroUnitPortrait(hero: HeroData, unitData: HeroUnitData, label: string, icons: Record<string, string>): string {
  const file = unitPortraitFile(hero, unitData);
  return file ? `heroportraits/${file}` : formIcon(icons, label) || heroPortrait(hero);
}

function heroUnitStatsList(
  hero: HeroData,
  gs: Gamestrings,
  catalog: CatalogLookup,
  forms: Pick<HeroForms, "unitBuffs" | "icons"> = {},
): HeroUnitStats[] {
  return (Object.entries(hero.heroUnits ?? {}) as [string, HeroUnitData][]).flatMap(([unitId, unitData]) => {
    const buffId = forms.unitBuffs?.[unitId];
    const stats = buildHeroStats(withBuff(unitData, buffId ? catalog.buff(buffId) : null), catalog);
    const unitName = HERO_UNIT_LABEL_OVERRIDES[unitId] ?? getUnitName(gs, unitId);
    const portrait = heroUnitPortrait(hero, unitData, unitName, forms.icons ?? {});
    return stats ? [{ unitId, unitName, portrait, stats }] : [];
  });
}

function buffFormStats(hero: HeroData, label: string, behaviorId: string, catalog: CatalogLookup, icons: Record<string, string>): HeroUnitStats[] {
  const buff = catalog.buff(behaviorId);
  const stats = buff && buildHeroStats(withBuff(hero, buff), catalog);
  return stats ? [{ unitId: hero.unitId, unitName: label, portrait: formIcon(icons, label) || heroPortrait(hero), stats }] : [];
}

export function buildHeroUnitStats(
  hero: HeroData,
  gs: Gamestrings,
  stats: HeroStats | null = buildHeroStats(hero),
  catalog: CatalogLookup = NO_CATALOG,
): HeroUnitStats[] {
  if (shouldPreferHeroUnitStats(stats, hero)) return heroUnitStatsList(hero, gs, catalog);
  const forms = HERO_FORMS[hero.hyperlinkId];
  if (!stats || !forms) return [];
  return [
    { unitId: hero.unitId, unitName: forms.main, portrait: heroPortrait(hero), stats },
    ...heroUnitStatsList(hero, gs, catalog, forms),
    ...Object.entries(forms.buffForms ?? {}).flatMap(([label, behaviorId]) => buffFormStats(hero, label, behaviorId, catalog, forms.icons ?? {})),
  ];
}

export function shouldRenderHeroUnitAbilityCards(hero: Pick<HeroData, "hyperlinkId">): boolean {
  return !HERO_UNIT_ABILITY_CARD_SKIP_IDS.has(hero.hyperlinkId);
}

// Portraits are keyed by variation and may hold one filename or a list.
async function copyPortraits(hero: HeroData): Promise<void> {
  const unitFiles = Object.values(hero.heroUnits ?? {}).map((u) => u.portraits?.targetInfo ?? "");
  const files = [...Object.values(hero.portraits ?? {}).flat(), ...unitFiles].filter((f): f is string => typeof f === "string" && f !== "");
  for (const f of new Set(files)) {
    const dest = path.join(SITE_STATIC_IMAGES, "heroportraits", f);
    await copyImageIfExists(path.join(HEROES_IMAGES_DIR, "heroportraits", f), dest)
      || await copyImageIfExists(path.join(CASC_PORTRAITS_DIR, f), dest);
  }
}

// Runs after copyPortraits; drops portraits whose file is missing.
async function keepExistingPortraits(unitStats: HeroUnitStats[]): Promise<HeroUnitStats[]> {
  return Promise.all(unitStats.map(async (unit) => {
    const exists = unit.portrait && await stat(path.join(SITE_STATIC_IMAGES, unit.portrait)).then(() => true, () => false);
    return exists ? unit : { ...unit, portrait: "" };
  }));
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
  resolve: ResolveEntry,
  isUnreachable: (abilityId: string, buttonId: string) => boolean,
  graph: EffectGraph,
): Promise<{ groups: SubAbilityGroup[]; phases: AbilityPhase[] }> {
  const groups: SubAbilityGroup[] = [];
  const phases: AbilityPhase[] = [];
  for (const [parentKey, categories] of Object.entries(hero.subAbilities ?? {})) {
    const { parentNameId, parentButtonId, parentAbilityType } = parseSubAbilityParentKey(parentKey);
    // Dismount is the only thing under Mount, and it says nothing.
    if (parentNameId === "Mount") continue;

    const parentLabel = SUB_ABILITY_LABEL_OVERRIDES[parentNameId] ?? getAbilityName(gs, parentKey, parentNameId);
    const abilities: ResolvedAbility[] = [];
    for (const [category, entries] of Object.entries(categories)) {
      for (const ab of entries) {
        if (SUB_ABILITY_EXCLUDE_IDS.has(entryNameId(ab)) || isUnreachable(ab.abilityId, ab.buttonId)) continue;
        const gate = gatedBy(graph, parentKey.split("|")[0], ab.abilityId);
        if (gate === "disabled") continue;
        const resolved = await resolve(ab, categorySlug(category), ctx, "ability", { costless: gate === "free" });
        if (gate === "phase" && ab.buttonId === parentButtonId) phases.push({ parentNameId, ability: resolved });
        else abilities.push(resolved);
      }
    }
    if (!abilities.length) continue;
    const isSecondary = abilities.every((ab) => isSecondaryAbility(ab.nameId, parentNameId));
    groups.push({ parentNameId, parentButtonId, parentAbilityType, parentLabel, abilities, isSecondary });
  }
  return { groups, phases };
}

interface AbilityPhase {
  parentNameId: string;
  ability: ResolvedAbility;
}

function uniqueByJson<T>(items: T[]): T[] {
  return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
}

function fillStats(parent: AbilityStats, phase: AbilityStats): AbilityStats {
  const filled = Object.entries(parent).map(([key, value]) => [key, value ?? phase[key as keyof AbilityStats]]);
  return { ...Object.fromEntries(filled), sources: { ...phase.sources, ...parent.sources } } as AbilityStats;
}

// A same-button follow-up cast (channel release) folds into its parent card.
// Stats fold before area placement, so placement sees the sizes the card shows.
function withPhaseStats(parent: ResolvedAbility, phase: ResolvedAbility): ResolvedAbility {
  const stats = parent.stats && phase.stats ? fillStats(parent.stats, phase.stats) : parent.stats ?? phase.stats;
  return { ...parent, stats };
}

function withPhaseDetails(parent: ResolvedAbility, phase: ResolvedAbility): ResolvedAbility {
  return {
    ...parent,
    areas: uniqueByJson([...parent.areas, ...phase.areas]),
    notes: uniqueByJson([...parent.notes, ...phase.notes]),
  };
}

function mergePhases(
  abilities: ResolvedAbility[],
  phases: AbilityPhase[],
  merge: (parent: ResolvedAbility, phase: ResolvedAbility) => ResolvedAbility,
): ResolvedAbility[] {
  return abilities.map((ab) =>
    phases.filter((p) => p.parentNameId === ab.nameId).reduce((acc, p) => merge(acc, p.ability), ab)
  );
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

type SummonUnitData = HeroUnitData & { attributes?: string[] };

// Abilities first, so a talent that reworks an ability does not claim its base summon.
function summonEntries(hero: HeroData): SummonEntry[] {
  const abilities = [
    ...Object.values(hero.abilities ?? {}).flat(),
    ...Object.values(hero.subAbilities ?? {}).flatMap((categories) => Object.values(categories).flat()),
    ...Object.values(hero.heroUnits ?? {}).flatMap((unit) => Object.values(unit.abilities ?? {}).flat()),
  ];
  const talents = Object.values(hero.talents ?? {}).flat();
  return [...abilities, ...talents].map((entry) => ({
    id: entryNameId(entry),
    abilityId: entry.abilityId,
    buttonId: entry.buttonId,
  }));
}

// 1 life with no damaging weapon marks an invulnerable effect carrier. Weapons that hit through effects read 0 damage.
export function summonStats(unit: SummonUnitData, catalog: CatalogLookup = NO_CATALOG): HeroStats | null {
  if (!(unit.attributes ?? []).includes("Summoned")) return null;
  const weapons = (unit.weapons ?? []).filter((w) => !w.isDisabled && w.damage > 0);
  if ((unit.life?.amount ?? 0) <= 1 && !weapons.length) return null;
  return buildHeroStats({ ...unit, isMelee: false, weapons }, catalog);
}

const PLACEHOLDER_PORTRAIT = "storm_ui_ingame_hero_icon_placeholder.png";

// Image path under images/: the target info portrait, else the summoning ability's icon.
async function summonPortrait(unit: SummonUnitData, source: ResolvedAbility | undefined): Promise<string> {
  const file = unit.portraits?.targetInfo;
  const copied = file && file !== PLACEHOLDER_PORTRAIT && await copyImageIfExists(
    path.join(HEROES_IMAGES_DIR, "unitportraits", file),
    path.join(SITE_STATIC_IMAGES, "unitportraits", file),
  );
  if (copied) return `unitportraits/${file}`;
  return source?.icon ? `abilitytalents/${source.icon}` : "";
}

async function resolveSummons(
  summons: Summon[],
  units: Record<string, SummonUnitData>,
  sources: Map<string, ResolvedAbility>,
  gs: Gamestrings,
  ctx: HeroContext,
  resolve: ResolveEntry,
  catalog: CatalogLookup,
): Promise<SummonResolved[]> {
  const out: SummonResolved[] = [];
  for (const { unitId, sourceId } of summons) {
    const unit = units[unitId];
    const stats = unit && !SUMMON_EXCLUDE_IDS.has(unitId) ? summonStats(unit, catalog) : null;
    if (!stats) continue;
    const abilities: ResolvedAbility[] = [];
    for (const [category, entries] of Object.entries(unit.abilities ?? {})) {
      for (const ab of entries) {
        if (ab.abilityType === "Hidden" || !gs.ability.fullText[ab.linkId]) continue;
        abilities.push(await resolve(ab, categorySlug(category), ctx, "ability"));
      }
    }
    const source = sources.get(sourceId);
    out.push({
      unitId,
      unitName: SUMMON_LABEL_OVERRIDES[unitId] ?? getUnitName(gs, unitId),
      sourceName: source?.name ?? splitCamelCase(sourceId),
      portrait: await summonPortrait(unit, source),
      invulnerable: SUMMON_INVULNERABLE_IDS.has(unitId),
      stats: { ...stats, sight: unit.sight ?? 0 },
      abilities,
    });
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
      meta_description: `${displayName} talents, abilities and stats in Heroes of the Storm (HotS).`,
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
  const parsedHeroData = (await loadDataFile<Record<string, HeroData>>("herodata")).items;
  const parsedGs = (await loadGamestrings<Gamestrings>()).items;
  const unitData = (await loadDataFile<Record<string, SummonUnitData>>("unitdata")).items;

  const anchorMap = await readJsonSafe<AnchorMap>(path.join(SITE_DATA, "anchor-map.json"));
  const declAnchorMap = await readJsonSafe<AnchorMap>(path.join(SITE_DATA, "decl-anchor-map.json"));
  if (!anchorMap || !declAnchorMap) {
    console.warn("gen-heroes: anchor-map.json not found, XML links will be omitted");
  }

  const SITE_DATA_HEROES = path.join(SITE_DATA, "heroes");

  const catalogFiles = await loadWeaponCatalogFiles();
  const catalogIndex = buildCatalogIndex(catalogFiles);
  const extras = await findHeroSelectExtras(catalogFiles, parsedHeroData, parsedGs, catalogIndex);
  const { heroData, gs } = withHeroSelectExtras(parsedHeroData, parsedGs, extras);
  const catalog: CatalogLookup = {
    weaponTiming: (id) => readWeaponTiming(catalogIndex, id),
    weaponDamageMultiplier: (id) => readWeaponDamageMultiplier(catalogIndex, id),
    buff: (id) => readBuffModification(catalogIndex, id),
  };

  const graph = buildEffectGraph(await loadGamedataXmlFiles());
  const reverseRefs = buildReverseRefs(graph);
  const offeredTalents = new Set(
    Object.values(heroData).flatMap((hero) => Object.values(hero.talents ?? {}).flat().map((t) => t.talentId)),
  );
  const isUnreachable = createReachability(graph, reverseRefs, offeredTalents);
  const { isDeadCondition } = createDeadGates(graph, reverseRefs, offeredTalents);
  const { resolveEntry, shortcodeData, abilityDescriptions, missingIcons, foundAreas, foundTicks, foundNotes } =
    createEntryResolver(gs, anchorMap ?? {}, declAnchorMap ?? {}, graph);

  for (const [heroName, rawHero] of Object.entries(heroData)) {
    const hero = withResourceType(gs, heroName, rawHero);
    const slug = heroPageSlug(heroName, hero);
    const displayName = heroPageDisplayName(gs, heroName, hero.hyperlinkId);
    const ctx: HeroContext = { slug, displayName, resourceKind: hero.energyType ?? "Mana" };

    await copyPortraits(hero);
    const resolvedAbilities = await resolveAbilities(hero, ctx, resolveEntry);
    const talents = await resolveTalents(hero, ctx, resolveEntry);
    const { groups: subAbilityGroups, phases } = await resolveSubAbilityGroups(hero, gs, ctx, resolveEntry, isUnreachable, graph);
    const abilities = mergePhases(resolvedAbilities, phases, withPhaseStats);
    const heroUnitAbilities = await resolveHeroUnits(hero, gs, ctx, resolveEntry);

    const kitEntries = [
      ...abilities,
      ...subAbilityGroups.flatMap((g) => g.abilities),
      ...phases.map((p) => p.ability),
      ...heroUnitAbilities.flatMap((u) => u.abilities),
    ];
    const sources = new Map<string, ResolvedAbility>([...kitEntries, ...talents].map((e) => [e.nameId, e]));
    const summons = await resolveSummons(
      [
        ...heroSummons(graph, summonEntries(hero), offeredTalents, isDeadCondition),
        ...(SCRIPT_SUMMONS[heroName] ?? []),
      ],
      unitData,
      sources,
      gs,
      ctx,
      resolveEntry,
      catalog,
    );

    const abilityEntries = [...kitEntries, ...summons.flatMap((s) => s.abilities)];
    const heroEntries = { slug, name: displayName, abilities: abilityEntries, talents };
    const areas = assignAreas(graph, reverseRefs, heroEntries, foundAreas);
    const ticks = assignTicks(graph, reverseRefs, heroEntries, foundTicks);
    const notes = assignNotes(graph, reverseRefs, heroEntries, foundNotes);
    for (const entry of [...abilityEntries, ...talents]) {
      entry.areas = areas.get(entry.nameId) ?? [];
      entry.notes = [...(ticks.get(entry.nameId) ?? []).map(tickNote), ...(notes.get(entry.nameId) ?? [])];
    }

    await writeText(path.join(SITE_CONTENT_HEROES, `${slug}.md`), heroPage(hero, heroName, slug, displayName, gs));
    console.log(`gen-heroes: wrote ${slug}.md`);

    const stats = buildHeroStats(hero, catalog);
    const unitStats = await keepExistingPortraits(buildHeroUnitStats(hero, gs, stats, catalog));
    await writeJson(
      path.join(SITE_DATA_HEROES, `${slug}.json`),
      { stats, portrait: heroPortrait(hero), unitStats, abilities: mergePhases(abilities, phases, withPhaseDetails), subAbilityGroups, heroUnitAbilities, summons, talents },
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
