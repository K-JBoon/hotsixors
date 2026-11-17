import { splitColumn, tableOf, queryColumns } from './model.js';

const TABLES = ['players', 'games', 'draft'];

/** `{ players, games, draft }` column names of a stats source, the `names` input of validateQuery. */
export const tableNames = async (stats) =>
  Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await stats.names(t)])));

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

const product = (lists) => lists.reduce((n, l) => n * l.length, 1);

/** Row indices into each table, one entry per view row. `base: null` means identity; -1 means no joined row. */
const expand = async (stats, from, joins) => {
  const expanding = joins.filter((j) => PARTNERS[j]);
  if (!joins.length) return { length: (await stats.columns(from, [])).length, index: { base: null } };
  const { length: n, game_id } = await stats.columns(from, ['game_id']);
  const games = joins.includes('game') ? await gameRows(stats) : null;
  const gameOf = (i) => games.get(game_id[i]) ?? -1;
  if (!expanding.length) return { length: n, index: { base: null, game: Int32Array.from({ length: n }, (_, i) => gameOf(i)) } };

  const { byGame, team } = await playersByGame(stats);
  const lists = (i) =>
    expanding.map((j) => {
      const rows = (byGame.get(game_id[i]) ?? []).filter(PARTNERS[j](team, i));
      return rows.length ? rows : [-1];
    });
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

/**
 * Joined view of `q.from` with `q.joins`. `game` is a one-to-one lookup;
 * `teammate` and `opponent` add one view row per matching player, or one row
 * of nulls when the game has none. `column(ref)` returns values per view row
 * for refs in `refs`.
 */
export async function joinView(stats, q, refs = queryColumns(q)) {
  const byJoin = Map.groupBy(refs.map(splitColumn), (r) => r.join);
  const [{ length, index }, loaded] = await Promise.all([
    expand(stats, q.from, q.joins),
    Promise.all(
      [...byJoin].map(async ([join, rs]) => [join, await stats.columns(tableOf(q.from, join), rs.map((r) => r.col))]),
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
