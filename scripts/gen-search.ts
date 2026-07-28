import { readdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { FileTreeNode } from "./types.ts";
import { SITE_CONTENT_HEROES, SITE_DATA, SITE_STATIC, slugify } from "./lib/paths.ts";
import { frontmatterValue } from "./lib/frontmatter.ts";

interface SearchEntry {
  title: string;
  url: string;
  type: "Hero" | "Guide" | "Game Data" | "Reference";
  text?: string;
  path?: string;
  hero?: string;
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

  try {
    const tree = JSON.parse(await readFile(path.join(SITE_DATA, "gamedata-tree.json"), "utf-8")) as FileTreeNode;
    flattenGameDataTree(tree, entries);
  } catch {
    console.warn("gen-search: gamedata-tree.json not found; skipping game data entries");
  }

  try {
    const data = JSON.parse(await readFile(path.join(SITE_DATA, "mechanics.json"), "utf-8")) as {
      mechanics: Array<{ name: string; category: string; summary: string; primaryBehavior: string; sourceIds: string[] }>;
    };
    entries.push({
      title: "Status Effects",
      url: "/status-effects/",
      type: "Reference",
      text: data.mechanics
        .map((mechanic) => [
          mechanic.name,
          mechanic.category,
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
        text: [mechanic.category, mechanic.summary, mechanic.primaryBehavior, mechanic.sourceIds.join(" ")].join(" "),
      });
    }
  } catch {
    console.warn("gen-search: mechanics.json not found; skipping mechanics entries");
  }

  try {
    const data = JSON.parse(await readFile(path.join(SITE_DATA, "cross-references.json"), "utf-8")) as {
      mechanics: Array<{ slug: string; name: string; category: string; entries: Array<{ heroName: string; name: string }> }>;
    };
    entries.push({
      title: "Effect Index",
      url: "/effect-index/",
      type: "Reference",
      text: data.mechanics
        .map((m) => `${m.name} ${m.category} ${m.entries.map((e) => `${e.heroName} ${e.name}`).join(" ")}`)
        .join(" "),
    });
    for (const mechanic of data.mechanics) {
      entries.push({
        title: `${mechanic.name} — abilities & talents`,
        url: `/effect-index/#${mechanic.slug}`,
        type: "Reference",
        text: `${mechanic.category} ${mechanic.entries.map((e) => `${e.heroName} ${e.name}`).join(" ")}`,
      });
    }
  } catch {
    console.warn("gen-search: cross-references.json not found; skipping effect-index entries");
  }

  await writeFile(path.join(SITE_STATIC, "site-search.json"), JSON.stringify(entries, null, 2), "utf-8");
  console.log(`gen-search: wrote site-search.json with ${entries.length} entries`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
