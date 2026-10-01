
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

function aliasValues(value) {
  return (Array.isArray(value) ? value : [value]).map(normalizeSearchValue).filter(Boolean);
}

function buildSearchTerms(query, aliases) {
  const base = normalizeSearchValue(query);
  if (!base) return [];

  const terms = new Set([base]);

  for (const [knownName, internalNames] of Object.entries(aliases)) {
    const normalizedKnown = normalizeSearchValue(knownName);
    const values = aliasValues(internalNames);
    if (normalizedKnown.includes(base)) for (const value of values) terms.add(value);
    if (values.some((value) => value.includes(base))) terms.add(normalizedKnown);
  }

  return [...terms].filter(Boolean);
}

// Entry objects outlive a keystroke, so their normalized form is built once.
const haystacks = new WeakMap();

function entryHaystack(entry) {
  let haystack = haystacks.get(entry);
  if (haystack === undefined) {
    haystack = normalizeSearchValue([
      entry.title,
      entry.name,
      entry.path,
      entry.url,
      entry.type,
      entry.hero,
      entry.text,
      entry.desc,
    ].filter(Boolean).join(" "));
    haystacks.set(entry, haystack);
  }
  return haystack;
}

export function matchesSearchEntry(entry, query, aliases = {}) {
  const terms = createSearchTerms(query, aliases);
  if (terms.length === 0) return true;

  const haystack = entryHaystack(entry);
  return terms.some((term) => haystack.includes(term));
}

const scoreFields = new WeakMap();

// Apostrophes join, so "Mal'Ganis" stays one word.
function searchWords(value) {
  return String(value || "").split(/[^a-z0-9'&]+/i).map(normalizeSearchValue).filter(Boolean);
}

function nameField(value) {
  return { full: normalizeSearchValue(value), words: searchWords(value) };
}

// "exact", "prefix" of the name or one of its words, "inner" for any other substring.
function nameMatch({ full, words }, term) {
  if (full === term) return "exact";
  if (full.startsWith(term) || words.some((word) => word.startsWith(term))) return "prefix";
  return full.includes(term) ? "inner" : null;
}

function entryScoreFields(entry) {
  let fields = scoreFields.get(entry);
  if (fields === undefined) {
    fields = {
      title: nameField(entry.title || entry.name || ""),
      path: normalizeSearchValue(entry.path || entry.url || ""),
      type: normalizeSearchValue(entry.type || ""),
      hero: nameField(entry.hero || ""),
      text: normalizeSearchValue(entry.text || ""),
      desc: normalizeSearchValue(entry.desc || ""),
    };
    scoreFields.set(entry, fields);
  }
  return fields;
}

// Keyed by normalized type; raw XML files are rarely the intended target.
const TYPE_WEIGHT = { gamedata: 0.25 };

export function searchSiteIndex(index, query, aliases = {}, limit = 12) {
  const terms = createSearchTerms(query, aliases);
  if (terms.length === 0) return [];

  // Scored in place: only the entries that survive are materialized.
  const hits = [];
  for (const entry of index) {
    const { title, path, type, hero, text, desc } = entryScoreFields(entry);
    let score = 0;

    for (const term of terms) {
      const titleMatch = nameMatch(title, term);
      if (titleMatch === "exact") score += 100;
      else if (titleMatch === "prefix") score += 70;
      else if (titleMatch === "inner") score += 20;
      const heroMatch = nameMatch(hero, term);
      if (heroMatch === "exact" || heroMatch === "prefix") score += 55;
      else if (heroMatch === "inner") score += 10;
      if (type.includes(term)) score += 25;
      if (path.includes(term)) score += 20;
      if (text.includes(term)) score += 10;
      if (desc.includes(term)) score += 10;
    }

    if (score > 0) hits.push({ ...entry, score: score * (TYPE_WEIGHT[type] ?? 1) });
  }

  return hits
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
