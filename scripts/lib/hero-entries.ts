// Resolves a hero ability or talent into site data.

import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";

import type {
  AbilityStats,
  AnchorMap,
  Gamestrings,
  HeroAbility,
  HeroTalent,
  ShortcodeData,
  ShortcodeEntry,
} from "../types.ts";
import { GAMEDATA_DIR, HEROES_IMAGES_DIR, SITE_STATIC_IMAGES } from "./paths.ts";
import { parseAbilityStats } from "./abilityxml.ts";
import {
  PASSIVE_ABILITY_ID,
  entryNameId,
  getAbilityFullDesc,
  getAbilityName,
  getAbilityShortDesc,
  renderGameStringMarkup,
  stripMarkup,
} from "./gamestrings.ts";

export interface HeroContext {
  slug: string;
  displayName: string;
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

export type ResolveEntry = (
  entry: HeroAbility | HeroTalent,
  category: string,
  ctx: HeroContext,
  type: "ability" | "talent"
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

export function createEntryResolver(gs: Gamestrings, anchorMap: AnchorMap) {
  const shortcodeData: ShortcodeData = {};
  const abilityDescriptions: Record<string, string> = {};
  const missingIcons = new Set<string>();
  const xmlFileCache = new Map<string, string>();

  async function loadXmlForAbility(nameId: string): Promise<{ xml: string; xmlPath: string } | null> {
    const anchor = anchorMap[nameId];
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
  const resolveEntry: ResolveEntry = async (entry, category, ctx, type) => {
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
    const stats = xmlData ? parseAbilityStats(xmlData.xml, nameId, xmlData.xmlPath) : null;

    const anchor = anchorMap[nameId];
    addShortcodeEntry(nameId, {
      name,
      buttonId: entry.buttonId,
      icon,
      heroSlug: ctx.slug,
      heroName: ctx.displayName,
      abilityType: entry.abilityType ?? "",
      shortDesc,
      manaCost: stats ? stats.manaCost : null,
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
    };
  };

  return { resolveEntry, shortcodeData, abilityDescriptions, missingIcons };
}
