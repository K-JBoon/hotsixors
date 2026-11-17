// Column-oriented access to the replay stats tables plus a small group-by.
// Shared by the stats pages and Node scripts.

import { asyncBufferFromUrl, cachedAsyncBuffer, parquetMetadataAsync, parquetRead } from 'hyparquet';

const statsByBase = new Map();

/** `base` holds meta.json and the Parquet files it names. */
export function openStats(base) {
  if (!statsByBase.has(base)) statsByBase.set(base, load(base.replace(/\/$/, '')));
  return statsByBase.get(base);
}

async function load(base) {
  const response = await fetch(`${base}/meta.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`stats meta: HTTP ${response.status}`);
  const meta = await response.json();
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, openTable(`${base}/${meta.files[name]}`));
    return tables.get(name);
  };
  const json = new Map();
  return {
    meta,
    /** A JSON side file named in meta.files, e.g. `talents`. */
    json: (name) => {
      if (!json.has(name)) json.set(name, fetch(`${base}/${meta.files[name]}`).then((r) => (r.ok ? r.json() : {})));
      return json.get(name);
    },
    /** `{ length, [column]: values[] }` for the requested columns of a table. */
    columns: async (name, cols) => (await table(name)).columns(cols),
    names: async (name) => (await table(name)).names,
  };
}

async function openTable(url) {
  const file = cachedAsyncBuffer(await asyncBufferFromUrl({ url }));
  const metadata = await parquetMetadataAsync(file);
  const length = Number(metadata.num_rows);
  const names = metadata.schema.slice(1).map((s) => s.name);
  const cache = new Map();
  return {
    names,
    async columns(cols) {
      const missing = [...new Set(cols)].filter((c) => !cache.has(c) && names.includes(c));
      if (missing.length) {
        const rows = new Promise((resolve, reject) => {
          parquetRead({ file, metadata, columns: missing, onComplete: resolve }).catch(reject);
        });
        missing.forEach((c, i) => cache.set(c, rows.then((r) => r.map((row) => row[i]))));
      }
      const out = { length };
      for (const c of cols) out[c] = cache.has(c) ? await cache.get(c) : new Array(length).fill(null);
      return out;
    },
  };
}

/** In-memory tables with the same interface as openStats, e.g. from local replays. */
export function memoryStats(tables, meta) {
  const byName = Object.fromEntries(
    ['games', 'players', 'draft'].map((name) => [name, Object.fromEntries(tables[name].map((c) => [c.name, c.data]))]),
  );
  return {
    meta,
    json: async (name) => meta.json?.[name] ?? {},
    names: async (name) => Object.keys(byName[name]),
    columns: async (name, cols) => {
      const table = byName[name];
      const length = Object.values(table)[0]?.length ?? 0;
      const out = { length };
      for (const c of cols) out[c] = table[c] ?? new Array(length).fill(null);
      return out;
    },
  };
}

/** Columns a filter reads, so callers can fetch them with the rest. */
export const FILTER_COLUMNS = ['tournament', 'map', 'patch', 'date', 'game_mode', 'strict'];

/** Filter value as a list: arrays pass through, empty values become []. */
export const asList = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);

export const minorOf = (patch) => patch?.split('.').slice(0, 2).join('.');

/**
 * Row predicate over common dimensions. `scope` is `tournament` (Liquipedia
 * matched games) or `all`; list fields match any listed value and accept a
 * single value too. A two-part patch such as `2.55` matches every 2.55.x.
 * `player` applies only to tables that have a player column.
 */
export function rowFilter(cols, { scope = 'tournament', tournament, map, patch, mode: gameMode, player, from, to, strict } = {}) {
  const set = (v) => (asList(v).length ? new Set(asList(v)) : null);
  const [tournaments, maps, patches, modes, players] = [tournament, map, patch, gameMode, player].map(set);
  return (i) =>
    (scope !== 'tournament' || cols.tournament[i] != null) &&
    (strict !== '1' || cols.strict[i]) &&
    (!modes || modes.has(cols.game_mode[i])) &&
    (!players || !cols.player || players.has(cols.player[i])) &&
    (!tournaments || tournaments.has(cols.tournament[i])) &&
    (!maps || maps.has(cols.map[i])) &&
    (!patches || patches.has(cols.patch[i]) || patches.has(minorOf(cols.patch[i]))) &&
    (!from || (cols.date[i] ?? '') >= from) &&
    (!to || (cols.date[i] ?? '') <= `${to}￿`);
}

/** Measures: `{ init(), add(state, i), done(state) }` over column arrays. */
export const count = () => ({ init: () => 0, add: (s) => s + 1, done: (s) => s });
/** Rows where `col` is not null. */
export const present = (col) => ({ init: () => 0, add: (s, i) => (col[i] == null ? s : s + 1), done: (s) => s });
export const sum = (col) => ({ init: () => 0, add: (s, i) => s + (Number(col[i]) || 0), done: (s) => s });
export const mean = (col) => ({
  init: () => [0, 0],
  add: (s, i) => (col[i] == null ? s : [s[0] + Number(col[i]), s[1] + 1]),
  done: ([total, n]) => (n ? total / n : null),
});
export const rate = (col, value = true) => ({
  init: () => [0, 0],
  add: (s, i) => (col[i] == null ? s : [s[0] + (col[i] === value ? 1 : 0), s[1] + 1]),
  done: ([hits, n]) => (n ? hits / n : null),
});
export const distinct = (col) => ({
  init: () => new Set(),
  add: (s, i) => (col[i] == null ? s : s.add(col[i])),
  done: (s) => s.size,
});
/** `scale` × sum(num) / sum(den). */
export const ratio = (num, den, scale = 1) => ({
  init: () => [0, 0],
  add: (s, i) => (num[i] == null || den[i] == null ? s : [s[0] + Number(num[i]), s[1] + Number(den[i])]),
  done: ([n, d]) => (d ? (n / d) * scale : null),
});
/** Most frequent value of `col` in the group. */
export const mode = (col) => ({
  init: () => new Map(),
  add: (s, i) => (col[i] == null ? s : s.set(col[i], (s.get(col[i]) ?? 0) + 1)),
  done: (s) => [...s].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
});
/** Value of `col` on the row where `order` is largest, e.g. latest name by date. */
export const latest = (col, order) => ({
  init: () => [null, ''],
  add: (s, i) => ((order[i] ?? '') >= s[1] ? [col[i], order[i] ?? ''] : s),
  done: (s) => s[0],
});

/**
 * Groups row indices by `key(i)` (skipping null keys) and reduces each group
 * with the given measures. Returns `[{ key, ...measures }]`.
 */
export function aggregate(length, { where = () => true, key, measures }) {
  const groups = new Map();
  const entries = Object.entries(measures);
  for (let i = 0; i < length; i++) {
    if (!where(i)) continue;
    const k = key(i);
    if (k == null) continue;
    let state = groups.get(k);
    if (!state) groups.set(k, (state = entries.map(([, m]) => m.init())));
    for (let j = 0; j < entries.length; j++) state[j] = entries[j][1].add(state[j], i);
  }
  return [...groups].map(([k, state]) => ({
    key: k,
    ...Object.fromEntries(entries.map(([name, m], j) => [name, m.done(state[j])])),
  }));
}

/** Total of a measure over the filtered rows, e.g. distinct games. */
export function total(length, where, measure) {
  return aggregate(length, { where, key: () => 0, measures: { v: measure } })[0]?.v ?? 0;
}
