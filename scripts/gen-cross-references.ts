// Builds site/data/cross-references.json from the effect graph and mechanics.

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { SITE_DATA, SITE_STATIC, gameVersion, readHdpInfo } from "./lib/paths.ts";
import { loadGamedataXmlFiles, type GamedataFile } from "./lib/gamedata-paths.ts";
import { writeJson } from "./lib/fs.ts";
import { runScript } from "./lib/script.ts";
import {
  buildEffectGraph,
  findMechanicApplications,
  type MechanicLike,
  type AbilTalentEntry,
  type MechanicApplications,
} from "./lib/effect-graph.ts";
import type { ShortcodeData } from "./types.ts";

interface MechanicsFile {
  mechanics: Array<{
    slug: string;
    name: string;
    category: string;
    primaryBehavior: string;
    sourceIds: string[];
    armorPolarity?: "increase" | "decrease";
    armorDamageKind?: "regular" | "physical" | "magical";
    statModifier?: "attack-speed" | "damage" | "lifesteal";
    statPolarity?: "increase" | "decrease";
    statDamageKind?: "general" | "physical" | "spell";
  }>;
}

export interface CrossReferencesFile {
  generatedFrom: string;
  mechanics: MechanicApplications[];
}

function anchorIndex(sc: ShortcodeData): Record<string, AbilTalentEntry> {
  const idx: Record<string, AbilTalentEntry> = {};
  for (const [key, e] of Object.entries(sc)) {
    const anchor = e.anchor || key.replace(/^[^:]+:/, "");
    // Prefer abilities over talents for the same anchor.
    const existing = idx[anchor];
    if (!existing || (e.type === "ability" && existing.kind !== "ability")) {
      idx[anchor] = shortcodeEntryToAbilTalentEntry(key, e);
    }
  }
  return idx;
}

function shortcodeNameId(key: string, e: ShortcodeData[string]): string {
  return e.anchor || key.replace(/^[^:]+:/, "");
}

function shortcodeEntryToAbilTalentEntry(key: string, e: ShortcodeData[string]): AbilTalentEntry {
  return {
    kind: e.type,
    nameId: shortcodeNameId(key, e),
    buttonId: e.buttonId,
    heroSlug: e.heroSlug,
    heroName: e.heroName,
    name: e.name,
    icon: e.icon,
    abilityType: e.abilityType || undefined,
  };
}

function entriesByAnchor(sc: ShortcodeData): Map<string, AbilTalentEntry[]> {
  const out = new Map<string, AbilTalentEntry[]>();
  for (const [key, e] of Object.entries(sc)) {
    const anchor = e.anchor || key.replace(/^[^:]+:/, "");
    const entries = out.get(anchor) ?? [];
    const entry = shortcodeEntryToAbilTalentEntry(key, e);
    if (!entries.some((existing) => existing.heroSlug === entry.heroSlug && existing.nameId === entry.nameId)) {
      entries.push(entry);
    }
    out.set(anchor, entries);
  }
  return out;
}

function expandSharedAnchorEntries(applications: MechanicApplications[], sc: ShortcodeData): MechanicApplications[] {
  const variants = entriesByAnchor(sc);
  return applications.map((mechanic) => {
    const byHeroName = new Map<string, AbilTalentEntry>();
    for (const entry of mechanic.entries) {
      const expanded = variants.get(entry.nameId) ?? [entry];
      for (const item of expanded) {
        byHeroName.set(`${item.heroSlug}\u0000${item.name}\u0000${item.kind}`, item);
      }
    }
    const entries = [...byHeroName.values()].sort(
      (a, b) =>
        a.heroName.localeCompare(b.heroName) ||
        (a.kind === b.kind ? 0 : a.kind === "ability" ? -1 : 1) ||
        a.name.localeCompare(b.name),
    );
    return { ...mechanic, entries };
  });
}

// Pure join: testable without the filesystem.
export function buildCrossReferences(
  files: GamedataFile[],
  shortcodeData: ShortcodeData,
  mechanics: MechanicLike[],
  generatedFrom: string,
): CrossReferencesFile {
  const graph = buildEffectGraph(files);
  return {
    generatedFrom,
    mechanics: expandSharedAnchorEntries(findMechanicApplications(graph, anchorIndex(shortcodeData), mechanics), shortcodeData),
  };
}

async function main(): Promise<void> {
  const shortcodeData = JSON.parse(
    await readFile(path.join(SITE_STATIC, "shortcode-data.json"), "utf-8"),
  ) as ShortcodeData;
  const mechanicsFile = JSON.parse(
    await readFile(path.join(SITE_DATA, "mechanics.json"), "utf-8"),
  ) as MechanicsFile;

  const result = buildCrossReferences(
    await loadGamedataXmlFiles(),
    shortcodeData,
    mechanicsFile.mechanics,
    gameVersion(await readHdpInfo()),
  );

  await writeJson(path.join(SITE_DATA, "cross-references.json"), result, 2);
  const counts = result.mechanics.map((m) => `${m.slug}=${m.entries.length}`).join(" ");
  console.log(`gen-cross-references: wrote cross-references.json (${counts})`);
}

runScript(import.meta.url, main);
