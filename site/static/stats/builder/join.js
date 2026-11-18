import { splitColumn, tableOf, queryColumns, DERIVED_JOINS, DERIVED_COLUMNS, isDerivedColumn, derivedColumnsOf } from './model.js';

const TABLES = ['players', 'games', 'draft', 'levels'];

/** Column names per table and per derived join, the `names` input of validateQuery. */
export const tableNames = async (stats) => ({
  ...Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, [...(await stats.names(t)), ...derivedColumnsOf(t)]]))),
  ...Object.fromEntries(Object.entries(DERIVED_JOINS).map(([j, d]) => [j, d.columns])),
});

const caches = new WeakMap();

const memo = (stats, key, make) => {
  if (!caches.has(stats)) caches.set(stats, new Map());
  const cache = caches.get(stats);
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const gameRows = (stats) =>
  memo(stats, 'games', async () => {
    const { length, game_id } = await stats.columns('games', ['game_id']);
    const rows = new Map();
    for (let i = 0; i < length; i++) rows.set(game_id[i], i);
    return rows;
  });

const playersByGame = (stats) =>
  memo(stats, 'players', async () => {
    const { length, game_id, team } = await stats.columns('players', ['game_id', 'team']);
    const byGame = new Map();
    for (let i = 0; i < length; i++) {
      const rows = byGame.get(game_id[i]);
      if (rows) rows.push(i);
      else byGame.set(game_id[i], [i]);
    }
    return { byGame, team };
  });

const PARTNERS = {
  teammate: (team, i) => (j) => j !== i && team[j] === team[i],
  opponent: (team, i) => (j) => team[j] !== team[i],
};

/** Rows of a derived join for every base row; base row `i` owns rows `offsets[i]` to `offsets[i + 1]`. */
const derivedRows = (stats, from, join) =>
  memo(stats, `derived:${from}:${join}`, async () => {
    const { columns, reads, rows } = DERIVED_JOINS[join];
    const source = await stats.columns(from, reads);
    const offsets = new Int32Array(source.length + 1);
    const table = Object.fromEntries(columns.map((c) => [c, []]));
    for (let i = 0; i < source.length; i++) {
      const out = rows(Object.fromEntries(reads.map((c) => [c, source[c][i]])));
      for (const row of out) for (const c of columns) table[c].push(row[c]);
      offsets[i + 1] = offsets[i] + out.length;
    }
    return { offsets, table: { length: offsets[source.length], ...table } };
  });

const range = (from, to) => Array.from({ length: to - from }, (_, k) => from + k);

const product = (lists) => lists.reduce((n, l) => n * l.length, 1);

const rowLists = async (stats, from, game_id, expanding) => {
  const partners = expanding.some((j) => PARTNERS[j]) ? await playersByGame(stats) : null;
  const derived = new Map(
    await Promise.all(expanding.filter((j) => DERIVED_JOINS[j]).map(async (j) => [j, (await derivedRows(stats, from, j)).offsets])),
  );
  const list = (j, i) => {
    if (derived.has(j)) return range(derived.get(j)[i], derived.get(j)[i + 1]);
    return (partners.byGame.get(game_id[i]) ?? []).filter(PARTNERS[j](partners.team, i));
  };
  return (i) =>
    expanding.map((j) => {
      const rows = list(j, i);
      return rows.length ? rows : [-1];
    });
};

/** Row indices into each table, one entry per view row. `base: null` means identity; -1 means no joined row. */
const expand = async (stats, from, joins) => {
  const expanding = joins.filter((j) => PARTNERS[j] || DERIVED_JOINS[j]);
  if (!joins.length) return { length: (await stats.columns(from, [])).length, index: { base: null } };
  const { length: n, game_id } = await stats.columns(from, ['game_id']);
  const games = joins.includes('game') ? await gameRows(stats) : null;
  const gameOf = (i) => games.get(game_id[i]) ?? -1;
  if (!expanding.length) return { length: n, index: { base: null, game: Int32Array.from({ length: n }, (_, i) => gameOf(i)) } };

  const lists = await rowLists(stats, from, game_id, expanding);
  let length = 0;
  for (let i = 0; i < n; i++) length += product(lists(i));

  const index = Object.fromEntries(['base', ...joins].map((k) => [k, new Int32Array(length)]));
  for (let i = 0, r = 0; i < n; i++) {
    const ls = lists(i);
    const g = games ? gameOf(i) : -1;
    for (let c = 0, combos = product(ls); c < combos; c++, r++) {
      index.base[r] = i;
      if (games) index.game[r] = g;
      for (let k = 0, rest = c; k < ls.length; k++) {
        index[expanding[k]][r] = ls[k][rest % ls[k].length];
        rest = Math.floor(rest / ls[k].length);
      }
    }
  }
  return { length, index };
};

const pick = (cols, source, i) => Object.fromEntries(cols.map((c) => [c, i < 0 ? null : source[c][i]]));

const derivedColumn = (stats, table, col) =>
  memo(stats, `column:${table}:${col}`, async () => {
    const { reads, game, value, column } = DERIVED_COLUMNS[col];
    if (column) return column(await stats.columns(table, reads));
    const [rows, games, gameIndex] = await Promise.all([
      stats.columns(table, ['game_id', ...reads]),
      stats.columns('games', game),
      gameRows(stats),
    ]);
    return Array.from({ length: rows.length }, (_, i) =>
      value(pick(reads, rows, i), pick(game, games, gameIndex.get(rows.game_id[i]) ?? -1)),
    );
  });

const tableColumns = async (stats, table, cols) => {
  const derived = cols.filter((c) => isDerivedColumn(table, c));
  const [stored, values] = await Promise.all([
    stats.columns(table, cols.filter((c) => !isDerivedColumn(table, c))),
    Promise.all(derived.map((c) => derivedColumn(stats, table, c))),
  ]);
  return { ...stored, ...Object.fromEntries(derived.map((c, k) => [c, values[k]])) };
};

const joinColumns = async (stats, from, join, cols) =>
  DERIVED_JOINS[join] ? (await derivedRows(stats, from, join)).table : tableColumns(stats, tableOf(from, join), cols);

/**
 * Joined view of `q.from` with `q.joins`. `game` is a one-to-one lookup;
 * `teammate` and `opponent` add one view row per matching player, or one row
 * of nulls when the game has none. A derived join adds the rows its `rows`
 * builds from the base row. `column(ref)` returns values per view row
 * for refs in `refs`.
 */
export async function joinView(stats, q, refs = queryColumns(q)) {
  const byJoin = Map.groupBy(refs.map(splitColumn), (r) => r.join);
  const [{ length, index }, loaded] = await Promise.all([
    expand(stats, q.from, q.joins),
    Promise.all(
      [...byJoin].map(async ([join, rs]) => [join, await joinColumns(stats, q.from, join, rs.map((r) => r.col))]),
    ).then((entries) => new Map(entries)),
  ]);
  const cache = new Map();
  const build = (ref) => {
    const { join, col } = splitColumn(ref);
    const values = loaded.get(join)?.[col];
    if (!values) throw new Error(`column ${ref} was not loaded`);
    const rows = join ? index[join] : index.base;
    if (!rows) return values;
    const out = new Array(length);
    for (let r = 0; r < length; r++) out[r] = rows[r] < 0 ? null : values[rows[r]];
    return out;
  };
  return {
    length,
    index,
    column: (ref) => {
      if (!cache.has(ref)) cache.set(ref, build(ref));
      return cache.get(ref);
    },
  };
}
