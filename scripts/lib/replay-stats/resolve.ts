// Node resolver: hero ids from the generated hero pages, maps from maps.json.

import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { frontmatterValue } from "../frontmatter.ts";
import { readJson } from "../fs.ts";
import { SITE_CONTENT_HEROES, SITE_STATIC_REPLAY } from "../paths.ts";
import { makeResolver } from "../../../site/static/stats/resolve.js";

export type Resolver = ReturnType<typeof makeResolver>;

export async function loadResolver(): Promise<Resolver> {
  const cheroToSlug = new Map<string, string>();
  const heroIdToSlug = new Map<string, string>();
  const files = (await readdir(SITE_CONTENT_HEROES)).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  if (files.length === 0) throw new Error(`${SITE_CONTENT_HEROES} has no hero pages; run npm run gen first`);
  for (const file of files) {
    const source = await readFile(path.join(SITE_CONTENT_HEROES, file), "utf-8");
    const slug = frontmatterValue(source, "slug") ?? path.basename(file, ".md");
    const internal = frontmatterValue(source, "internal_name");
    const heroId = frontmatterValue(source, "hero_id");
    if (internal) cheroToSlug.set(internal, slug);
    if (heroId) heroIdToSlug.set(heroId, slug);
  }
  return makeResolver({
    cheroToSlug,
    heroIdToSlug,
    heroUnits: await readJson(path.join(SITE_STATIC_REPLAY, "hero-units.json")),
    mapsData: await readJson(path.join(SITE_STATIC_REPLAY, "maps.json")),
  });
}
