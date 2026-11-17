// Domain reports over the replay stats tables. Each returns plain rows, so any
// page can render them its own way.

import { phases } from './bracket.js';
import { FILTER_COLUMNS, aggregate, asList, count, distinct, latest, mean, mode, rate, rowFilter, total } from './query.js';

/** Per-player score columns shown by default; any `meta.scoreColumns` entry works. */
export const STAT_COLUMNS = [
  { id: 'kills', label: 'Kills', col: 'score_SoloKill' },
  { id: 'deaths', label: 'Deaths', col: 'score_Deaths' },
  { id: 'assists', label: 'Assists', col: 'score_Assists' },
  { id: 'heroDamage', label: 'Hero dmg', col: 'score_HeroDamage' },
  { id: 'siegeDamage', label: 'Siege dmg', col: 'score_SiegeDamage' },
  { id: 'healing', label: 'Healing', col: 'score_Healing' },
  { id: 'damageTaken', label: 'Dmg taken', col: 'score_DamageTaken' },
  { id: 'xp', label: 'XP', col: 'score_ExperienceContribution' },
];

const statMeasures = (cols, stats = STAT_COLUMNS) =>
  Object.fromEntries(stats.map((s) => [s.id, mean(cols[s.col])]));
const statCols = (stats = STAT_COLUMNS) => stats.map((s) => s.col);

async function playerRows(stats, extra, filters) {
  const cols = await stats.columns('players', ['game_id', 'win', 'player', ...FILTER_COLUMNS, ...extra]);
  return { cols, where: rowFilter(cols, filters) };
}

/** Games in scope; with a player filter, only games those players played. */
async function gameCount(stats, filters) {
  if (asList(filters.player).length) {
    const { cols, where } = await playerRows(stats, [], filters);
    return total(cols.length, where, distinct(cols.game_id));
  }
  const cols = await stats.columns('games', ['game_id', ...FILTER_COLUMNS]);
  return total(cols.length, rowFilter(cols, filters), count());
}

/** Bans per hero, and the drafted games (any ban) to rate them against. */
async function banCounts(stats, filters) {
  const cols = await stats.columns('draft', ['game_id', 'kind', 'hero', ...FILTER_COLUMNS]);
  const inScope = rowFilter(cols, filters);
  const where = (i) => cols.kind[i] === 'ban' && inScope(i);
  const rows = aggregate(cols.length, { where, key: (i) => cols.hero[i], measures: { bans: distinct(cols.game_id) } });
  return { byHero: new Map(rows.map((r) => [r.key, r.bans])), games: total(cols.length, where, distinct(cols.game_id)) };
}

const banRate = (bans, hero) => (bans.games ? (bans.byHero.get(hero) ?? 0) / bans.games : null);

/** Presence: pick rate plus ban rate, the share of drafts the hero affects. */
const withPresence = (r) => ({ ...r, presence: r.pickRate == null || r.banRate == null ? null : r.pickRate + r.banRate });

export async function heroTable(stats, filters) {
  const [{ cols, where }, games, bans] = await Promise.all([
    playerRows(stats, ['hero', ...statCols()], filters),
    gameCount(stats, filters),
    banCounts(stats, filters),
  ]);
  const picked = aggregate(cols.length, {
    where,
    key: (i) => cols.hero[i],
    measures: { games: count(), winRate: rate(cols.win), ...statMeasures(cols) },
  });
  const pickedHeroes = new Set(picked.map((r) => r.key));
  const bannedOnly = [...bans.byHero.keys()].filter((h) => !pickedHeroes.has(h)).map((h) => ({ key: h, games: 0, winRate: null }));
  return [...picked, ...bannedOnly].map((r) => withPresence({
    hero: r.key,
    ...r,
    pickRate: games ? r.games / games : null,
    banRate: banRate(bans, r.key),
  }));
}

const TALENT_COLUMNS = Array.from({ length: 7 }, (_, i) => `talent${i + 1}`);

export async function heroReport(stats, hero, filters) {
  const extra = ['hero', 'map', ...TALENT_COLUMNS, 'player', 'battletag', ...statCols()];
  const [{ cols, where: inScope }, games, bans, gameRows] = await Promise.all([
    playerRows(stats, extra, filters),
    gameCount(stats, filters),
    banCounts(stats, filters),
    gameList(stats, filters, (g) => g.heroes.some((side) => side.includes(hero))),
  ]);
  const where = (i) => cols.hero[i] === hero && inScope(i);
  const summary = aggregate(cols.length, {
    where,
    key: () => hero,
    measures: { games: count(), winRate: rate(cols.win) },
  })[0] ?? { games: 0, winRate: null };

  const talents = TALENT_COLUMNS.flatMap((col, tier) =>
    aggregate(cols.length, {
      where,
      key: (i) => cols[col][i],
      measures: { picks: count(), winRate: rate(cols.win) },
    }).map((r) => ({ tier: tier + 1, talent: r.key, picks: r.picks, pickRate: summary.games ? r.picks / summary.games : null, winRate: r.winRate })),
  );

  return {
    summary: withPresence({
      ...summary,
      pickRate: games ? summary.games / games : null,
      banRate: banRate(bans, hero),
    }),
    maps: aggregate(cols.length, { where, key: (i) => cols.map[i], measures: { games: count(), winRate: rate(cols.win) } })
      .map((r) => ({ map: r.key, ...r })),
    talents,
    players: aggregate(cols.length, {
      where,
      key: (i) => cols.player[i],
      measures: { battletag: latest(cols.battletag, cols.date), games: count(), winRate: rate(cols.win), ...statMeasures(cols) },
    }).map((r) => ({ player: r.key, ...r })),
    games: gameRows,
  };
}

export async function mapTable(stats, filters) {
  const cols = await stats.columns('games', ['game_id', 'winner', 'first_pick', 'duration_s', ...FILTER_COLUMNS]);
  const firstPickWon = cols.first_pick.map((fp, i) => (fp == null ? null : fp === cols.winner[i]));
  const own = asList(filters.player).length ? await playerRows(stats, [], filters) : null;
  const ownWin = own
    ? new Map(aggregate(own.cols.length, { where: own.where, key: (i) => own.cols.map[i], measures: { games: count(), winRate: rate(own.cols.win) } }).map((r) => [r.key, r]))
    : null;
  const ownGames = own && new Set(own.cols.game_id.filter((_, i) => own.where(i)));
  const inScope = rowFilter(cols, filters);
  return aggregate(cols.length, {
    where: ownGames ? (i) => ownGames.has(cols.game_id[i]) && inScope(i) : inScope,
    key: (i) => cols.map[i],
    measures: {
      games: count(),
      duration: mean(cols.duration_s),
      firstPickWinRate: rate(firstPickWon),
      leftWinRate: rate(cols.winner, 0),
    },
  }).map((r) => ({ map: r.key, ...r, ...(ownWin ? { games: ownWin.get(r.key)?.games ?? 0, winRate: ownWin.get(r.key)?.winRate ?? null } : {}) }))
    .filter((r) => r.games > 0);
}

export async function playerTable(stats, filters) {
  const { cols, where } = await playerRows(stats, ['player', 'battletag', 'name', 'hero', 'team_name', ...statCols()], filters);
  return aggregate(cols.length, {
    where,
    key: (i) => cols.player[i],
    measures: {
      battletag: latest(cols.battletag, cols.date),
      team: latest(cols.team_name, cols.date),
      games: count(),
      winRate: rate(cols.win),
      heroes: distinct(cols.hero),
      topHero: mode(cols.hero),
      lastPlayed: latest(cols.date, cols.date),
      ...statMeasures(cols),
    },
  }).map((r) => ({ player: r.key, ...r }));
}

/** The player filter is ignored: the report is about `player`. */
export async function playerReport(stats, player, { player: _, ...filters }) {
  const { cols, where: inScope } = await playerRows(stats, ['player', 'battletag', 'hero', 'map', 'team_name', ...statCols()], filters);
  const where = (i) => cols.player[i] === player && inScope(i);
  const games = await gameList(stats, filters, (g) => g.players.has(player));
  return {
    summary: aggregate(cols.length, {
      where,
      key: () => player,
      measures: { battletag: latest(cols.battletag, cols.date), games: count(), winRate: rate(cols.win), events: distinct(cols.tournament), ...statMeasures(cols) },
    })[0] ?? null,
    heroes: aggregate(cols.length, { where, key: (i) => cols.hero[i], measures: { games: count(), winRate: rate(cols.win), ...statMeasures(cols) } })
      .map((r) => ({ hero: r.key, ...r })),
    maps: aggregate(cols.length, { where, key: (i) => cols.map[i], measures: { games: count(), winRate: rate(cols.win) } })
      .map((r) => ({ map: r.key, ...r })),
    teams: aggregate(cols.length, { where, key: (i) => cols.team_name[i], measures: { games: count(), winRate: rate(cols.win) } })
      .map((r) => ({ team: r.key, ...r })),
    games,
  };
}

export async function teamTable(stats, filters) {
  const { cols, where } = await playerRows(stats, ['team_name', 'player'], { ...filters, scope: 'tournament' });
  return aggregate(cols.length, {
    where,
    key: (i) => cols.team_name[i],
    measures: {
      games: distinct(cols.game_id),
      winRate: rate(cols.win),
      players: distinct(cols.player),
      tournaments: distinct(cols.tournament),
      lastPlayed: latest(cols.date, cols.date),
    },
  }).map((r) => ({ team: r.key, ...r }));
}

export async function teamReport(stats, team, filters) {
  const scoped = { ...filters, scope: 'tournament' };
  const { cols, where: inScope } = await playerRows(stats, ['team_name', 'player', 'battletag', 'hero', 'map'], scoped);
  const where = (i) => cols.team_name[i] === team && inScope(i);
  const [bans, games] = await Promise.all([teamBans(stats, team, scoped), gameList(stats, scoped, (g) => g.team0 === team || g.team1 === team)]);
  return {
    roster: aggregate(cols.length, { where, key: (i) => cols.player[i], measures: { battletag: latest(cols.battletag, cols.date), games: count(), winRate: rate(cols.win), topHero: mode(cols.hero) } })
      .map((r) => ({ player: r.key, ...r })),
    heroes: aggregate(cols.length, { where, key: (i) => cols.hero[i], measures: { games: count(), winRate: rate(cols.win) } })
      .map((r) => ({ hero: r.key, ...r })),
    maps: aggregate(cols.length, { where, key: (i) => cols.map[i], measures: { games: distinct(cols.game_id), winRate: rate(cols.win) } })
      .map((r) => ({ map: r.key, ...r })),
    bans,
    games,
  };
}

async function teamBans(stats, team, filters) {
  const cols = await stats.columns('draft', ['game_id', 'kind', 'hero', 'team_name', ...FILTER_COLUMNS]);
  const inScope = rowFilter(cols, filters);
  return aggregate(cols.length, {
    where: (i) => cols.kind[i] === 'ban' && cols.team_name[i] === team && inScope(i),
    key: (i) => cols.hero[i],
    measures: { bans: count() },
  }).map((r) => ({ hero: r.key, bans: r.bans }));
}

/** Tournaments with games under the filters, joined with meta.json details. */
export async function tournamentTable(stats, filters) {
  const cols = await stats.columns('games', ['game_id', ...FILTER_COLUMNS]);
  const earliest = (col) => ({
    init: () => null,
    add: (s, i) => (col[i] != null && (s == null || col[i] < s) ? col[i] : s),
    done: (s) => s,
  });
  const info = new Map(stats.meta.tournaments.map((t) => [t.name, t]));
  return aggregate(cols.length, {
    where: rowFilter(cols, { ...filters, scope: 'tournament' }),
    key: (i) => cols.tournament[i],
    measures: { games: count(), first: earliest(cols.date), last: latest(cols.date, cols.date) },
  }).map((r) => ({ ...info.get(r.key), name: r.key, games: r.games, first: r.first, last: r.last }));
}

/** The map filter is ignored: the report is about `name`. */
export async function mapReport(stats, name, { map: _, ...filters }) {
  const scoped = { ...filters, map: [name] };
  const [[summary = null], heroes, games] = await Promise.all([mapTable(stats, scoped), heroTable(stats, scoped), gameList(stats, scoped)]);
  return { summary, heroes, games };
}

/** The tournament filter is ignored: the report is about `name`. */
export async function tournamentReport(stats, name, { tournament: _, ...filters }) {
  const scoped = { ...filters, scope: 'tournament', tournament: [name] };
  const [heroes, teams, maps, games] = await Promise.all([
    heroTable(stats, scoped),
    teamTable(stats, scoped),
    mapTable(stats, scoped),
    gameList(stats, scoped),
  ]);
  const players = new Set(games.flatMap((g) => [...g.players]));
  const durations = games.map((g) => g.duration).filter((d) => d != null);
  return {
    info: stats.meta.tournaments.find((t) => t.name === name) ?? null,
    summary: {
      games: games.length,
      teams: teams.length,
      players: players.size,
      duration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    },
    heroes,
    teams,
    maps,
    phases: phases(rounds(games)),
    games,
  };
}

/** Stages in order of their first game, unknown stage last, each with its series and the series score from the games on record. */
function rounds(games) {
  const stages = new Map();
  for (const g of [...games].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))) {
    const stage = stages.get(g.stage) ?? stages.set(g.stage, new Map()).get(g.stage);
    const key = g.setId ?? g.id;
    const series = stage.get(key) ?? stage.set(key, { id: key, date: g.date, teams: [g.team0, g.team1], games: [] }).get(key);
    series.games.push(g);
  }
  const winnerOf = (g) => (g.winner === 0 ? g.team0 : g.winner === 1 ? g.team1 : null);
  return [...stages].sort(([a], [b]) => (a == null) - (b == null)).map(([stage, series]) => ({
    stage,
    series: [...series.values()].map((s) => ({
      ...s,
      wins: s.teams.map((t) => s.games.filter((g) => t != null && winnerOf(g) === t).length),
      games: s.games.sort((a, b) => (a.mapNumber ?? 0) - (b.mapNumber ?? 0)),
    })),
  }));
}

/** Filtered games, newest first, each with its players' heroes per side. */
export async function gameList(stats, filters, keep = () => true) {
  const [g, p] = await Promise.all([
    stats.columns('games', ['game_id', 'winner', 'duration_s', 'team0', 'team1', 'stage', 'set_id', 'map_number', 'first_pick', ...FILTER_COLUMNS]),
    stats.columns('players', ['game_id', 'team', 'hero', 'player']),
  ]);
  const sides = new Map();
  for (let i = 0; i < p.length; i++) {
    let entry = sides.get(p.game_id[i]);
    if (!entry) sides.set(p.game_id[i], (entry = { heroes: [[], []], players: new Set() }));
    entry.heroes[p.team[i]]?.push(p.hero[i]);
    entry.players.add(p.player[i]);
  }
  const where = rowFilter(g, filters);
  const out = [];
  for (let i = 0; i < g.length; i++) {
    if (!where(i)) continue;
    const side = sides.get(g.game_id[i]) ?? { heroes: [[], []], players: new Set() };
    if (asList(filters.player).length && !asList(filters.player).some((p) => side.players.has(p))) continue;
    const game = {
      id: g.game_id[i], date: g.date[i], map: g.map[i], patch: g.patch[i], tournament: g.tournament[i], stage: g.stage[i], setId: g.set_id[i], mapNumber: g.map_number[i], firstPick: g.first_pick[i], mode: g.game_mode[i],
      team0: g.team0[i], team1: g.team1[i], winner: g.winner[i], duration: g.duration_s[i], heroes: side.heroes, players: side.players,
    };
    if (keep(game)) out.push(game);
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/** Filter choices present in the data. `people` lists players, which costs two string columns. */
export async function facets(stats, { people: listPeople = false } = {}) {
  const cols = await stats.columns('games', FILTER_COLUMNS);
  const values = (col) => [...new Set(cols[col].filter((v) => v != null))];
  const players = listPeople ? await stats.columns('players', ['player', 'battletag', 'date']) : null;
  const people = !players ? [] : aggregate(players.length, {
    key: (i) => players.player[i],
    measures: { games: count(), battletag: latest(players.battletag, players.date) },
  }).sort((a, b) => b.games - a.games);
  const patchOrder = (a, b) => b.localeCompare(a, undefined, { numeric: true });
  return {
    maps: values('map').sort(),
    patches: values('patch').sort(patchOrder),
    modes: values('game_mode').sort(),
    /** Map name → game modes it was played in, to narrow the map list by mode. */
    mapModes: cols.map.reduce((acc, m, i) => {
      if (m != null && cols.game_mode[i] != null) (acc[m] ??= new Set()).add(cols.game_mode[i]);
      return acc;
    }, {}),
    people,
    tournaments: stats.meta.tournaments,
  };
}

const FACET_COLUMNS = { tournament: 'tournament', map: 'map', patch: 'patch', mode: 'game_mode', player: 'player' };

/** Per filter, the values left by every other filter. */
export async function available(stats, filters) {
  const cols = await stats.columns('players', ['player', ...FILTER_COLUMNS]);
  const facets = Object.entries(FACET_COLUMNS).map(([key, col]) => ({
    key, values: cols[col], where: rowFilter(cols, { ...filters, [key]: [] }), found: new Set(),
  }));
  for (let i = 0; i < cols.length; i++) {
    for (const f of facets) if (f.values[i] != null && f.where(i)) f.found.add(f.values[i]);
  }
  return Object.fromEntries(facets.map((f) => [f.key, f.found]));
}
