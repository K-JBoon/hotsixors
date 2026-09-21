import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import type { FileTreeNode } from "./types.ts";
import { SITE_CONTENT_HEROES, SITE_DATA, SITE_DATA_BATTLEGROUNDS, SITE_DATA_HEROES, SITE_STATIC, slugify } from "./lib/paths.ts";
import { readJsonSafe, writeJson } from "./lib/fs.ts";
import { runScript } from "./lib/script.ts";
import { frontmatterValue } from "./lib/frontmatter.ts";

interface SearchEntry {
  title: string;
  url: string;
  type: "Hero" | "Ability" | "Talent" | "Battleground" | "Guide" | "Game Data" | "Reference";
  text?: string;
  path?: string;
  hero?: string;
}

interface MechanicsIndex {
  mechanics: Array<{
    name: string;
    category: string;
    description: string;
    summary: string;
    primaryBehavior: string;
    sourceIds: string[];
  }>;
}

interface CrossReferencesIndex {
  mechanics: Array<{ slug: string; name: string; category: string; entries: Array<{ heroName: string; name: string }> }>;
}

interface HeroAbility {
  nameId: string;
  name: string;
  abilityType?: string;
  shortDesc?: string;
  category: string;
}

interface HeroTalent extends HeroAbility {
  tier: string;
}

interface HeroData {
  abilities: HeroAbility[];
  subAbilityGroups: Array<{ abilities: HeroAbility[] }>;
  heroUnitAbilities: Array<{ abilities: HeroAbility[] }>;
  talents: HeroTalent[];
}

interface BattlegroundData {
  slug: string;
  name: string;
  franchise: string;
  description: string;
  objectives: Array<{ title: string; description: string }>;
  summary: string[];
  mechanics: Array<{ title: string; body: string }>;
  timers: Array<{ label: string }>;
}

interface UnitGroups {
  groups: Array<{ title: string; units: Array<{ name: string; context?: string }> }>;
  timings?: Array<{ title: string; rows: Array<{ label: string; value: string }> }>;
}

// The hero page only renders cards in these categories, so only these have an
// anchor to link to. Alternate-form units drop "activable".
const ABILITY_CATEGORIES = new Set(["basic", "heroic", "trait", "activable"]);
const HERO_UNIT_ABILITY_CATEGORIES = new Set(["basic", "heroic", "trait"]);

function tierLabel(tier: string): string {
  return tier.replace(/^level/, "Level ");
}

function stripFrontmatter(content: string): string {
  return content.replace(/^\+\+\+[\s\S]*?\+\+\+\s*/, "");
}

function stripMarkdown(content: string): string {
  return stripFrontmatter(content)
    .replace(/\{\{[^}]+\}\}/g, " ")
    .replace(/[`*_#[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readMarkdownEntries(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "_index.md")
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function readJsonDir<T>(dir: string): Promise<T[]> {
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const loaded = await Promise.all(names.map((name) => readJsonSafe<T>(path.join(dir, name))));
  return loaded.flatMap((value) => (value === null ? [] : [value]));
}

function flattenGameDataTree(node: FileTreeNode, entries: SearchEntry[]): void {
  if (node.type === "file") {
    entries.push({
      title: node.name,
      url: `/gamedata/${node.path}/`,
      type: "Game Data",
      path: node.path,
      text: node.path,
    });
    return;
  }

  for (const child of node.children || []) flattenGameDataTree(child, entries);
}

/** An index another gen script writes; missing means its script did not run. */
async function optionalIndex<T>(name: string): Promise<T | null> {
  const data = await readJsonSafe<T>(path.join(SITE_DATA, name));
  if (!data) console.warn(`gen-search: ${name} not found; skipping its entries`);
  return data;
}

function unitText(data: UnitGroups | null): string {
  if (!data) return "";
  return [
    ...data.groups.flatMap((group) => [group.title, ...group.units.map((unit) => `${unit.name} ${unit.context ?? ""}`)]),
    ...(data.timings ?? []).flatMap((group) => [group.title, ...group.rows.map((row) => `${row.label} ${row.value}`)]),
  ].join(" ");
}

async function heroPageEntries(entries: SearchEntry[]): Promise<void> {
  for (const filePath of await readMarkdownEntries(SITE_CONTENT_HEROES)) {
    const content = await readFile(filePath, "utf-8");
    const title = frontmatterValue(content, "title") ?? "";
    const slug = frontmatterValue(content, "slug") || path.basename(filePath, ".md");
    entries.push({
      title,
      url: `/heroes/${slug}/`,
      type: "Hero",
      hero: title,
      text: [
        frontmatterValue(content, "description") ?? "",
        frontmatterValue(content, "role") ?? "",
        frontmatterValue(content, "franchise") ?? "",
      ].join(" "),
    });

    const hero = await readJsonSafe<HeroData>(path.join(SITE_DATA_HEROES, `${slug}.json`));
    if (!hero) continue;

    const abilities = [
      ...[...hero.abilities, ...hero.subAbilityGroups.flatMap((group) => group.abilities)]
        .filter((ability) => ABILITY_CATEGORIES.has(ability.category)),
      ...hero.heroUnitAbilities.flatMap((group) => group.abilities)
        .filter((ability) => HERO_UNIT_ABILITY_CATEGORIES.has(ability.category)),
    ];

    const seen = new Set<string>();
    for (const ability of abilities) {
      if (seen.has(ability.nameId)) continue;
      seen.add(ability.nameId);
      entries.push({
        title: ability.name,
        url: `/heroes/${slug}/#ability-${ability.nameId}`,
        type: "Ability",
        hero: title,
        text: [ability.abilityType ?? "", ability.shortDesc ?? ""].join(" ").trim(),
      });
    }

    for (const talent of hero.talents) {
      entries.push({
        title: talent.name,
        url: `/heroes/${slug}/#talent-${talent.nameId}`,
        type: "Talent",
        hero: title,
        text: [tierLabel(talent.tier), talent.abilityType ?? "", talent.shortDesc ?? ""].join(" ").trim(),
      });
    }
  }
}

async function battlegroundEntries(entries: SearchEntry[]): Promise<void> {
  const battlegrounds = await readJsonDir<BattlegroundData>(SITE_DATA_BATTLEGROUNDS);
  if (battlegrounds.length === 0) {
    console.warn("gen-search: no battleground data found; skipping its entries");
    return;
  }

  entries.push({
    title: "Battlegrounds",
    url: "/battlegrounds/",
    type: "Battleground",
    text: battlegrounds.map((bg) => bg.name).join(" "),
  });

  for (const bg of battlegrounds) {
    entries.push({
      title: bg.name,
      url: `/battlegrounds/${bg.slug}/`,
      type: "Battleground",
      text: [
        bg.franchise,
        bg.description,
        ...bg.objectives.map((objective) => `${objective.title} ${objective.description}`),
        ...bg.summary,
        ...bg.mechanics.map((mechanic) => `${mechanic.title} ${mechanic.body}`),
        ...bg.timers.map((timer) => timer.label),
      ].join(" "),
    });
  }
}

async function main(): Promise<void> {
  const entries: SearchEntry[] = [];

  entries.push({
    title: "Library",
    url: "/library/",
    type: "Reference",
    text: "Status Effects Effect Index Minions Mercs Structures Game Data",
  });

  await heroPageEntries(entries);

  const guidesDir = path.join(path.dirname(SITE_CONTENT_HEROES), "guides");
  for (const filePath of await readMarkdownEntries(guidesDir)) {
    const content = await readFile(filePath, "utf-8");
    const title = frontmatterValue(content, "title") || path.basename(filePath, ".md");
    const slug = path.basename(filePath, ".md");
    entries.push({
      title,
      url: `/guides/${slug}/`,
      type: "Guide",
      hero: frontmatterValue(content, "hero") ?? "",
      text: `${frontmatterValue(content, "description") ?? ""} ${stripMarkdown(content)}`,
    });
  }

  await battlegroundEntries(entries);

  const minions = await optionalIndex<UnitGroups>("minions-and-mercs.json");
  const structures = await optionalIndex<UnitGroups>("structures.json");
  entries.push(
    {
      title: "Minions & Mercs",
      url: "/minions-and-mercs/",
      type: "Reference",
      text: `Lane minions mercenary camps respawn timers wave interval catapults ${unitText(minions)}`,
    },
    {
      title: "Structures",
      url: "/structures/",
      type: "Reference",
      text: `Core Fort Keep Tower Gate Wall ${unitText(structures)}`,
    },
    {
      title: "Experience",
      url: "/experience/",
      type: "Reference",
      text: "XP per level kill experience underdog experience level curve",
    },
    {
      title: "Mock Draft",
      url: "/draft/",
      type: "Reference",
      text: "Practice drafts bans picks captain peer-to-peer",
    },
    {
      title: "Replay Viewer",
      url: "/replay/",
      type: "Reference",
      text: "StormReplay parser timeline in the browser",
    },
    {
      title: "Lost in the Nexus",
      url: "/lost-in-the-nexus/",
      type: "Reference",
      text: "3D battleground viewer terrain models",
    },
    {
      title: "About",
      url: "/about/",
      type: "Reference",
      text: "Build info data sources open source Discord",
    },
  );

  const tree = await optionalIndex<FileTreeNode>("gamedata-tree.json");
  if (tree) flattenGameDataTree(tree, entries);

  const data = await optionalIndex<MechanicsIndex>("mechanics.json");
  if (data) {
    entries.push({
      title: "Status Effects",
      url: "/status-effects/",
      type: "Reference",
      text: data.mechanics
        .map((mechanic) => [
          mechanic.name,
          mechanic.category,
          mechanic.description,
          mechanic.summary,
          mechanic.primaryBehavior,
          mechanic.sourceIds.join(" "),
        ].join(" "))
        .join(" "),
    });
    for (const mechanic of data.mechanics) {
      entries.push({
        title: mechanic.name,
        url: `/status-effects/#${slugify(mechanic.name)}`,
        type: "Reference",
        text: [mechanic.category, mechanic.description, mechanic.summary, mechanic.primaryBehavior, mechanic.sourceIds.join(" ")].join(" "),
      });
    }
  }

  const crossReferences = await optionalIndex<CrossReferencesIndex>("cross-references.json");
  if (crossReferences) {
    entries.push({
      title: "Effect Index",
      url: "/effect-index/",
      type: "Reference",
      text: crossReferences.mechanics
        .map((m) => `${m.name} ${m.category} ${m.entries.map((e) => `${e.heroName} ${e.name}`).join(" ")}`)
        .join(" "),
    });
    for (const mechanic of crossReferences.mechanics) {
      entries.push({
        title: `${mechanic.name} — abilities & talents`,
        url: `/effect-index/#${mechanic.slug}`,
        type: "Reference",
        text: `${mechanic.category} ${mechanic.entries.map((e) => `${e.heroName} ${e.name}`).join(" ")}`,
      });
    }
  }

  await writeJson(path.join(SITE_STATIC, "site-search.json"), entries);
  console.log(`gen-search: wrote site-search.json with ${entries.length} entries`);
}

runScript(import.meta.url, main);
