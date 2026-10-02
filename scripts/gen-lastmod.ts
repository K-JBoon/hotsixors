// Writes site/data/lastmod.json, the sitemap's <lastmod> per URL path. A
// committed content file dates from its last commit; a generated one from the
// game data extract. A section takes the newest date of itself and its pages.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { SITE_CONTENT, SITE_DATA, readHdpInfo } from "./lib/paths.ts";
import { walkFiles, writeJson } from "./lib/fs.ts";
import { runScript } from "./lib/script.ts";

interface ContentFile {
  rel: string;
  url: string;
}

/** Last commit date per path, from `git log --format=%x00%cs --name-only`, newest first. */
export function commitDates(log: string): Map<string, string> {
  const dates = new Map<string, string>();
  for (const commit of log.split("\0").slice(1)) {
    const [date, ...files] = commit.split("\n").filter(Boolean);
    for (const file of files) if (!dates.has(file)) dates.set(file, date);
  }
  return dates;
}

/** URL path Zola gives the content file at `rel`, below site/content. */
export function contentUrl(rel: string, source: string): string {
  const front = (source.match(/^\+\+\+\n([\s\S]*?)\n\+\+\+/)?.[1] ?? "").split(/^\[/m)[0];
  const field = (name: string) => front.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"))?.[1];
  const explicit = field("path");
  if (explicit) return `/${explicit.replace(/^\/+|\/+$/g, "")}/`;
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel, ".md");
  const parts = [...(dir === "." ? [] : [dir]), ...(base === "_index" ? [] : [field("slug") ?? base])];
  return parts.length ? `/${parts.join("/")}/` : "/";
}

export function lastmodByUrl(
  files: ContentFile[],
  committed: Map<string, string>,
  generated: string,
): Record<string, string> {
  const own = (file: ContentFile) => committed.get(file.rel) ?? generated;
  const newest = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a));
  const pagesIn = (dir: string) =>
    files.filter((f) => !f.rel.endsWith("_index.md") && path.posix.dirname(f.rel) === dir);
  const dateOf = (file: ContentFile) =>
    file.rel.endsWith("_index.md")
      ? newest([own(file), ...pagesIn(path.posix.dirname(file.rel)).map(own)])
      : own(file);
  return Object.fromEntries(
    files.map((f) => [f.url, dateOf(f)] as const).sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function main(): Promise<void> {
  const { stdout } = await promisify(execFile)(
    "git",
    ["log", "--format=%x00%cs", "--name-only", "--relative", "--", "."],
    { cwd: SITE_CONTENT, maxBuffer: 64 * 1024 * 1024 },
  );
  const files: ContentFile[] = [];
  for await (const { abs, rel } of walkFiles(SITE_CONTENT)) {
    if (rel.endsWith(".md")) files.push({ rel, url: contentUrl(rel, await readFile(abs, "utf-8")) });
  }
  const generated = (await readHdpInfo()).ExtractedDate.slice(0, 10);
  await writeJson(path.join(SITE_DATA, "lastmod.json"), lastmodByUrl(files, commitDates(stdout), generated));
  console.log(`gen-lastmod: dated ${files.length} content files`);
}

runScript(import.meta.url, main);
