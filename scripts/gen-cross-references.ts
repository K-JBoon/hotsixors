// Builds site/data/cross-references.json from the effect graph and mechanics.

import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { SITE_DATA, SITE_DATA_HEROES, SITE_STATIC, gameVersion, readHdpInfo } from "./lib/paths.ts";
import { loadGamedataXmlFiles, type GamedataFile } from "./lib/gamedata-paths.ts";
import { writeJson } from "./lib/fs.ts";
import { runScript } from "./lib/script.ts";
import {
  buildEffectGraph,
  findMechanicApplications,
  mechanicComposition,
  type MechanicLike,
  type AbilTalentEntry,
  type EffectValue,
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

export interface HeroFacts {
  talentTiers: Record<string, string>;
}

// One application: amount and duration read from the same behavior.
export interface EffectInstance {
  amount?: number;
  // Amount at full stacks from one caster.
  maxAmount?: number;
  unit?: EffectValue["unit"];
  duration?: number;
  scales?: true;
  modifies?: string;
}

// Always one instance or more, so the overview renders a table row per application.
export interface CrossReferenceEntry extends Omit<AbilTalentEntry, "values"> {
  instances: EffectInstance[];
}

export interface CrossReferenceMechanic extends Omit<MechanicApplications, "entries"> {
  entries: CrossReferenceEntry[];
  amountUnit?: EffectValue["unit"];
  hasDuration?: true;
}

export interface CrossReferencesFile {
  generatedFrom: string;
  mechanics: CrossReferenceMechanic[];
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
        byHeroName.set(`${item.heroSlug}\u0000${item.name}\u0000${item.kind}`, entry.values ? { ...item, values: entry.values } : item);
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

function withHeroFacts<T extends Omit<AbilTalentEntry, "values">>(entry: T, heroes: Record<string, HeroFacts>): T {
  const hero = heroes[entry.heroSlug];
  if (!hero) return entry;
  const talentTier = entry.kind === "talent" ? hero.talentTiers[entry.nameId] : undefined;
  return talentTier ? { ...entry, talentTier } : entry;
}

// Pure join: testable without the filesystem.
export function buildCrossReferences(
  files: GamedataFile[],
  shortcodeData: ShortcodeData,
  mechanics: MechanicLike[],
  generatedFrom: string,
  heroes: Record<string, HeroFacts> = {},
): CrossReferencesFile {
  const graph = buildEffectGraph(files);
  const composition = mechanicComposition(graph, mechanics);
  const applications = expandSharedAnchorEntries(findMechanicApplications(graph, anchorIndex(shortcodeData), mechanics), shortcodeData);
  const names = new Map(applications.flatMap((m) => m.entries.map((e) => [`${e.heroSlug}\u0000${e.nameId}`, e.name])));
  return {
    generatedFrom,
    mechanics: applications.map((m) => {
      const entries = m.entries.map(({ values, ...e }): CrossReferenceEntry => {
        const instances = instancesOf(values ?? [], (nameId) => names.get(`${e.heroSlug}\u0000${nameId}`) ?? nameId);
        return { ...withHeroFacts(e, heroes), instances: instances.length > 0 ? instances : [{}] };
      });
      const all = entries.flatMap((e) => e.instances);
      const amountUnit = all.find((i) => i.amount !== undefined)?.unit;
      return {
        ...m,
        entries,
        ...(amountUnit && { amountUnit }),
        ...(all.some((i) => i.duration !== undefined) && { hasDuration: true as const }),
        ...composition.get(m.slug),
      };
    }),
  };
}

function instancesOf(values: EffectValue[], modifiesName: (nameId: string) => string): EffectInstance[] {
  const bySource = new Map<string, EffectValue[]>();
  for (const v of values) {
    const key = `${v.source}\u0000${v.via ?? ""}\u0000${v.modifies ?? ""}`;
    bySource.set(key, [...(bySource.get(key) ?? []), v]);
  }
  const instances = [...bySource.values()].flatMap((group) => {
    const amounts = group.filter((v) => v.stat === "amount");
    const durations = group.filter((v) => v.stat === "duration");
    const modifies = group[0].modifies;
    return (amounts.length ? amounts : [undefined]).flatMap((a) =>
      (durations.length ? durations : [undefined]).map((d): EffectInstance => ({
        ...(a && { amount: a.value, unit: a.unit }),
        ...(a && (a.max !== undefined || a.stacks) && { maxAmount: Math.round((a.max ?? a.value) * (a.stacks ?? 1) * 1000) / 1000 }),
        ...(d && { duration: d.value }),
        ...((a?.scales || d?.scales) && { scales: true as const }),
        ...(modifies && { modifies: modifiesName(modifies) }),
      })),
    );
  });
  return [...new Map(instances.map((i) => [JSON.stringify(i), i])).values()];
}

async function readHeroFacts(): Promise<Record<string, HeroFacts>> {
  const names = (await readdir(SITE_DATA_HEROES)).filter((n) => n.endsWith(".json"));
  const entries = await Promise.all(names.map(async (name): Promise<[string, HeroFacts]> => {
    const slug = path.basename(name, ".json");
    const data = JSON.parse(await readFile(path.join(SITE_DATA_HEROES, name), "utf-8")) as { talents?: { nameId: string; tier: string }[] };
    return [slug, { talentTiers: Object.fromEntries((data.talents ?? []).map((t) => [t.nameId, t.tier])) }];
  }));
  return Object.fromEntries(entries);
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
    await readHeroFacts(),
  );

  await writeJson(path.join(SITE_DATA, "cross-references.json"), result, 2);
  const counts = result.mechanics.map((m) => `${m.slug}=${m.entries.length}`).join(" ");
  console.log(`gen-cross-references: wrote cross-references.json (${counts})`);
}

runScript(import.meta.url, main);
