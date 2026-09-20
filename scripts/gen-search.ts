import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import type { FileTreeNode } from "./types.ts";
import { SITE_CONTENT_HEROES, SITE_DATA, SITE_STATIC, slugify } from "./lib/paths.ts";
import { readJsonSafe, writeJson } from "./lib/fs.ts";
import { runScript } from "./lib/script.ts";
import { frontmatterValue } from "./lib/frontmatter.ts";

interface SearchEntry {
  title: string;
  url: string;
  type: "Hero" | "Guide" | "Game Data" | "Reference";
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

async function main(): Promise<void> {
  const entries: SearchEntry[] = [];

  entries.push({
    title: "Library",
    url: "/library/",
    type: "Reference",
    text: "Status Effects Effect Index Minions Mercs Structures Game Data",
  });

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
  }

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

  await writeJson(path.join(SITE_STATIC, "site-search.json"), entries, 2);
  console.log(`gen-search: wrote site-search.json with ${entries.length} entries`);
}

runScript(import.meta.url, main);
