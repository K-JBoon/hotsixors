// Builds site/data/cross-references.json from the effect graph and mechanics.

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAMEDATA_DIR,
  GAMEDATA_REPO,
  SITE_DATA,
  SITE_STATIC,
  HEROES_DATA_DIR,
  findLatestVersion,
} from "./lib/paths.ts";
import { shouldIncludeGamedataPath } from "./gen-gamedata.ts";
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

async function collectGamedataFiles(
  dir: string,
  rel: string,
  out: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await collectGamedataFiles(path.join(dir, e.name), childRel, out);
    } else if (e.name.endsWith(".xml") && shouldIncludeGamedataPath(`mods/${childRel}`)) {
      out.push(`mods/${childRel}`);
    }
  }
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
  files: { path: string; content: string }[],
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

  const relPaths: string[] = [];
  await collectGamedataFiles(GAMEDATA_DIR, "", relPaths);
  const files = await Promise.all(
    relPaths.map(async (rel) => ({
      path: rel,
      content: await readFile(path.join(GAMEDATA_REPO, rel), "utf-8"),
    })),
  );

  const generatedFrom = await findLatestVersion(HEROES_DATA_DIR);
  const result = buildCrossReferences(
    files,
    shortcodeData,
    mechanicsFile.mechanics,
    generatedFrom,
  );

  await mkdir(SITE_DATA, { recursive: true });
  await writeFile(
    path.join(SITE_DATA, "cross-references.json"),
    JSON.stringify(result, null, 2),
    "utf-8",
  );
  const counts = result.mechanics.map((m) => `${m.slug}=${m.entries.length}`).join(" ");
  console.log(`gen-cross-references: wrote cross-references.json (${counts})`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
