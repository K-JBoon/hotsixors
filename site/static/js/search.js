
export function normalizeSearchValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}
let cachedQuery;
let cachedAliases;
let cachedTerms = null;

export function createSearchTerms(query, aliases = {}) {
  if (cachedTerms && query === cachedQuery && aliases === cachedAliases) return cachedTerms.slice();

  const terms = buildSearchTerms(query, aliases);
  cachedQuery = query;
  cachedAliases = aliases;
  cachedTerms = terms;
  return terms.slice();
}

function buildSearchTerms(query, aliases) {
  const base = normalizeSearchValue(query);
  if (!base) return [];

  const terms = new Set([base]);
  const alias = aliases[base];
  if (alias) terms.add(normalizeSearchValue(alias));

  for (const [knownName, internalName] of Object.entries(aliases)) {
    const normalizedKnown = normalizeSearchValue(knownName);
    const normalizedInternal = normalizeSearchValue(internalName);
    if (base === normalizedKnown) terms.add(normalizedInternal);
    if (base === normalizedInternal) terms.add(normalizedKnown);
  }

  return [...terms].filter(Boolean);
}

export function matchesSearchEntry(entry, query, aliases = {}) {
  const terms = createSearchTerms(query, aliases);
  if (terms.length === 0) return true;

  const haystack = normalizeSearchValue([
    entry.title,
    entry.name,
    entry.path,
    entry.url,
    entry.type,
    entry.hero,
    entry.text,
  ].filter(Boolean).join(" "));

  return terms.some((term) => haystack.includes(term));
}

export function searchSiteIndex(index, query, aliases = {}, limit = 12) {
  const terms = createSearchTerms(query, aliases);
  if (terms.length === 0) return [];

  return index
    .map((entry) => {
      const title = normalizeSearchValue(entry.title || entry.name || "");
      const path = normalizeSearchValue(entry.path || entry.url || "");
      const type = normalizeSearchValue(entry.type || "");
      const hero = normalizeSearchValue(entry.hero || "");
      const text = normalizeSearchValue(entry.text || "");
      let score = 0;

      for (const term of terms) {
        if (title === term) score += 100;
        else if (title.includes(term)) score += 70;
        if (hero.includes(term)) score += 55;
        if (type.includes(term)) score += 25;
        if (path.includes(term)) score += 20;
        if (text.includes(term)) score += 10;
      }

      return { ...entry, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)))
    .slice(0, limit);
}

export function selectGridSearchState(entries, query, aliases = {}) {
  const hasQuery = createSearchTerms(query, aliases).length > 0;

  return entries.map((entry) => ({
    id: entry.id,
    matches: !hasQuery || matchesSearchEntry(entry, query, aliases),
  }));
}

export function orderSelectGridSearchEntries(entries, query, aliases = {}) {
  const hasQuery = createSearchTerms(query, aliases).length > 0;
  if (!hasQuery) return [...entries];

  return [...entries]
    .map((entry, index) => ({
      ...entry,
      matches: matchesSearchEntry(entry, query, aliases),
      index,
    }))
    .sort((a, b) => Number(b.matches) - Number(a.matches) || a.index - b.index);
}

export function updateSelectGridSearchQuery(query, event) {
  const current = String(query || "");
  const key = String(event?.key || "");

  if (key === "Escape") return "";
  if (key === "Backspace") return current.slice(0, -1);
  if (event?.ctrlKey || event?.metaKey || event?.altKey) return current;
  if (key.length === 1) return current + key;

  return current;
}
