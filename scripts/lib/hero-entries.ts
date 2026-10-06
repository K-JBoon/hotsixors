// Resolves a hero ability or talent into site data.

import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";

import type {
  AbilityArea,
  AbilityNote,
  AbilityStats,
  AnchorMap,
  Gamestrings,
  HeroAbility,
  HeroStats,
  HeroTalent,
  ShortcodeData,
  ShortcodeEntry,
} from "../types.ts";
import { GAMEDATA_DIR, HEROES_IMAGES_DIR, SITE_STATIC_IMAGES } from "./paths.ts";
import { parseAbilityStats } from "./abilityxml.ts";
import { abilityGeometry, type GatedArea } from "./ability-geometry.ts";
import { abilityTicks, type GatedTick } from "./ability-ticks.ts";
import { abilityNotes, type GatedNote } from "./ability-notes.ts";
import { scriptRange } from "./script-ranges.ts";
import type { EffectGraph } from "./effect-graph/index.ts";
import {
  PASSIVE_ABILITY_ID,
  entryNameId,
  getAbilityCostText,
  getAbilityFullDesc,
  getAbilityName,
  nameByAbilId,
  getAbilityShortDesc,
  renderGameStringMarkup,
  stripMarkup,
} from "./gamestrings.ts";

export interface HeroContext {
  slug: string;
  displayName: string;
  resourceKind: string;
}

export interface ResolvedAbility {
  nameId: string;
  buttonId: string;
  icon: string;
  abilityType: string;
  isPassive?: boolean;
  name: string;
  shortDesc: string;
  shortDescHtml: string;
  fullDesc: string;
  fullDescHtml: string;
  category: string;
  stats: AbilityStats | null;
  areas: AbilityArea[];
  notes: AbilityNote[];
}

export interface ResolvedTalent extends ResolvedAbility {
  sort: number;
  tier: string;
  abilityTalentLinkIds: string[];
}

export interface SubAbilityGroup {
  parentNameId: string;
  parentButtonId: string;
  parentAbilityType: string;
  parentLabel: string;
  abilities: ResolvedAbility[];
  isSecondary: boolean;
}

export interface HeroUnitResolved {
  heroUnitId: string;
  heroUnitName: string;
  abilities: ResolvedAbility[];
}

export interface SummonResolved {
  unitId: string;
  unitName: string;
  sourceName: string;
  portrait: string;
  invulnerable: boolean;
  stats: HeroStats & { sight: number };
  abilities: ResolvedAbility[];
}

export type ResolveEntry = (
  entry: HeroAbility | HeroTalent,
  category: string,
  ctx: HeroContext,
  type: "ability" | "talent",
  opts?: { costless?: boolean },
) => Promise<ResolvedAbility>;

// Reports whether the image was available.
export async function copyImageIfExists(src: string, dest: string): Promise<boolean> {
  try {
    await stat(src);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    return true;
  } catch {
    return false;
  }
}

// `xmlPath` is stored in Zola's path form.
function anchorXmlPathToAbsPath(xmlPath: string): string {
  return path.join(GAMEDATA_DIR, xmlPath.replace(/^mods\//, "").replace(/-xml$/, ".xml"));
}

export function createEntryResolver(
  gs: Gamestrings,
  anchorMap: AnchorMap,
  declAnchorMap: AnchorMap = {},
  graph?: EffectGraph,
) {
  const shortcodeData: ShortcodeData = {};
  const abilityDescriptions: Record<string, string> = {};
  const missingIcons = new Set<string>();
  const foundAreas = new Map<string, GatedArea[]>();
  const foundTicks = new Map<string, GatedTick[]>();
  const foundNotes = new Map<string, GatedNote[]>();
  const xmlFileCache = new Map<string, string>();

  function declAnchor(nameId: string) {
    return declAnchorMap[nameId] ?? anchorMap[nameId];
  }

  async function loadXmlForAbility(nameId: string): Promise<{ xml: string; xmlPath: string } | null> {
    const anchor = declAnchor(nameId);
    if (!anchor) return null;
    const absPath = anchorXmlPathToAbsPath(anchor.xmlPath);
    if (!xmlFileCache.has(absPath)) {
      try {
        xmlFileCache.set(absPath, await readFile(absPath, "utf-8"));
      } catch {
        return null;
      }
    }
    return { xml: xmlFileCache.get(absPath)!, xmlPath: anchor.xmlPath };
  }

  // Two heroes can share a nameId; collisions get heroSlug prefixes.
  function addShortcodeEntry(nameId: string, entry: ShortcodeEntry, fullDescHtml: string): void {
    const existing = shortcodeData[nameId];
    if (!existing) {
      shortcodeData[nameId] = entry;
      if (fullDescHtml) abilityDescriptions[nameId] = fullDescHtml;
      return;
    }
    shortcodeData[`${existing.heroSlug}:${nameId}`] = existing;
    shortcodeData[`${entry.heroSlug}:${nameId}`] = entry;
    const existingDesc = abilityDescriptions[nameId];
    if (existingDesc) abilityDescriptions[`${existing.heroSlug}:${nameId}`] = existingDesc;
    if (fullDescHtml) abilityDescriptions[`${entry.heroSlug}:${nameId}`] = fullDescHtml;
  }

  // Talents have no XML stats.
  const resolveEntry: ResolveEntry = async (entry, category, ctx, type, opts) => {
    const nameId = entryNameId(entry);

    const hasIcon = await copyImageIfExists(
      path.join(HEROES_IMAGES_DIR, "abilitytalents", entry.icon),
      path.join(SITE_STATIC_IMAGES, "abilitytalents", entry.icon)
    );
    const icon = hasIcon ? entry.icon : "";
    if (!hasIcon) missingIcons.add(entry.icon);

    const name = getAbilityName(gs, entry.linkId, nameId);
    const shortDescSource = getAbilityShortDesc(gs, entry.linkId);
    const fullDescSource = getAbilityFullDesc(gs, entry.linkId);
    const shortDesc = stripMarkup(shortDescSource);
    const fullDescHtml = renderGameStringMarkup(fullDescSource);

    const xmlData = type === "ability" ? await loadXmlForAbility(nameId) : null;
    const { areas, range, ...geometry } = graph ? abilityGeometry(graph, nameId) : { range: null, radius: null, width: null, areas: [] };
    if (areas.length > 0) foundAreas.set(nameId, areas);
    const ticks = graph ? abilityTicks(graph, nameId) : [];
    if (ticks.length > 0) foundTicks.set(nameId, ticks);
    const notes = graph ? abilityNotes(graph, nameId, (id) => nameByAbilId(gs, id)) : [];
    if (notes.length > 0) foundNotes.set(nameId, notes);
    const xmlStats = xmlData ? parseAbilityStats(xmlData.xml, nameId, xmlData.xmlPath) : null;
    const costText = opts?.costless || xmlStats?.manaCost != null ? "" : getAbilityCostText(gs, entry.linkId);
    const stats = xmlStats
      ? { ...xmlStats, ...geometry, range: scriptRange(nameId) ?? range, costKind: ctx.resourceKind, costText }
      : null;

    const anchor = declAnchor(nameId);
    addShortcodeEntry(nameId, {
      name,
      buttonId: entry.buttonId,
      icon,
      heroSlug: ctx.slug,
      heroName: ctx.displayName,
      abilityType: entry.abilityType ?? "",
      shortDesc,
      manaCost: stats ? stats.manaCost : null,
      costKind: ctx.resourceKind,
      costText,
      cooldown: stats ? (stats.chargeTimeUse ?? stats.cooldown) : null,
      xmlPath: anchor ? anchor.xmlPath : "",
      anchor: anchor ? nameId : "",
      type,
    }, fullDescHtml);

    return {
      nameId,
      buttonId: entry.buttonId,
      icon,
      abilityType: entry.abilityType,
      ...(type === "ability" && (entry as HeroAbility).abilityId === PASSIVE_ABILITY_ID
        ? { isPassive: true }
        : {}),
      name,
      shortDesc,
      shortDescHtml: renderGameStringMarkup(shortDescSource),
      fullDesc: stripMarkup(fullDescSource),
      fullDescHtml,
      category,
      stats,
      areas: [],
      notes: [],
    };
  };

  return { resolveEntry, shortcodeData, abilityDescriptions, missingIcons, foundAreas, foundTicks, foundNotes };
}
