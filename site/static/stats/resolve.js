import { findMap } from '../replay/map-lookup.js';

/**
 * Raw replay identities to site ids. `cheroToSlug` maps CHero ids (draft
 * events), `heroIdToSlug` maps hero-units.json values, `mapsData` is
 * replay/maps.json.
 */
export function makeResolver({ cheroToSlug, heroIdToSlug, heroUnits, mapsData }) {
  const nameOf = new Map(Object.entries(mapsData).map(([name, entry]) => [entry, name]));
  return {
    heroFromCHero: (id) => (id ? cheroToSlug.get(id) ?? heroIdToSlug.get(id) ?? null : null),
    heroFromUnit: (unit) => {
      const heroId = unit ? heroUnits[unit] : undefined;
      return heroId ? heroIdToSlug.get(heroId) ?? null : null;
    },
    map: (title, hashes) => {
      const entry = findMap(mapsData, title, hashes);
      return entry ? { name: nameOf.get(entry), slug: entry.slug } : null;
    },
  };
}

const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url}: HTTP ${r.status}`))));

/** Browser resolver from the site's static JSON. */
export async function loadSiteResolver() {
  const [draft, aliases, heroUnits, mapsData] = await Promise.all([
    getJson('/draft/draft-data.json'),
    getJson('/hero-aliases.json'),
    getJson('/replay/hero-units.json'),
    getJson('/replay/maps.json'),
  ]);
  const heroIdToSlug = new Map(draft.heroes.map((h) => [h.id, h.slug]));
  const bySlug = new Map(draft.heroes.map((h) => [h.slug, h.slug]));
  for (const [slug, names] of Object.entries(aliases)) for (const n of names) bySlug.set(n, slug);
  const cheroToSlug = { get: (id) => bySlug.get(id.toLowerCase()) };
  return makeResolver({ cheroToSlug, heroIdToSlug, heroUnits, mapsData });
}
