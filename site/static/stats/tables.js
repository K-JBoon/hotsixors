// Flattens replay summaries into long-format tables. Every row carries the
// common filter dimensions (date, patch, mode, map, tournament) so most
// queries need a single table. Shared by gen-replay-stats and the browser.

const TALENT_TIERS = 7;
const SCORE_PREFIX = 'score_';

function tableBuilder(schema) {
  const columns = Object.entries(schema).map(([name, type]) => ({ name, type, data: [] }));
  return {
    push(row) {
      for (const c of columns) c.data.push(row[c.name] ?? null);
    },
    columns,
  };
}

const patchOf = (version) => version?.split('.').slice(0, 3).join('.') ?? null;

export function skipReason(s) {
  if (s.error) return s.error;
  if (s.players?.length !== 10) return `${s.players?.length ?? 0} players`;
  if (s.winner == null) return 'no winner';
  return null;
}

/**
 * `resolve` maps raw identities (see makeResolver). `eventOf(summary, heroOf)`
 * optionally returns `{ tournament, stage, setId, mapNumber, teams: [team0, team1] }`.
 */
export function buildTables(summaries, resolve, eventOf = () => null) {
  const skipped = [];
  const usable = summaries.filter((s) => {
    const reason = skipReason(s);
    if (reason) skipped.push({ id: s.id, reason });
    return !reason;
  });
  const scoreKeys = new Set();
  for (const s of usable) for (const p of s.players) for (const key of Object.keys(p.score)) scoreKeys.add(key);
  const scoreColumns = [...scoreKeys].sort();

  const common = {
    game_id: 'STRING', date: 'STRING', patch: 'STRING', build: 'INT32', game_mode: 'STRING', map: 'STRING', tournament: 'STRING',
  };
  const games = tableBuilder({
    ...common, duration_s: 'INT32', winner: 'INT32', first_pick: 'INT32', stage: 'STRING', set_id: 'STRING',
    map_number: 'INT32', team0: 'STRING', team1: 'STRING',
  });
  const players = tableBuilder({
    ...common, team: 'INT32', slot: 'INT32', player: 'STRING', battletag: 'STRING', name: 'STRING', hero: 'STRING',
    win: 'BOOLEAN', team_name: 'STRING', opponent: 'STRING', duration_s: 'INT32',
    ...Object.fromEntries(Array.from({ length: TALENT_TIERS }, (_, i) => [`talent${i + 1}`, 'STRING'])),
    ...Object.fromEntries(scoreColumns.map((k) => [SCORE_PREFIX + k, 'DOUBLE'])),
  });
  const draft = tableBuilder({
    ...common, order: 'INT32', kind: 'STRING', team: 'INT32', hero: 'STRING', win: 'BOOLEAN', team_name: 'STRING',
  });

  const perEvent = new Map();
  for (const s of usable) {
    const map = resolve.map(s.mapTitle, s.mapHashes);
    const heroOf = (p) => resolve.heroFromUnit(p.heroUnit) ?? resolve.heroFromCHero(p.heroPick) ?? resolve.heroFromCHero(p.heroLobby);
    const event = eventOf(s, heroOf);
    const teamNames = event?.teams ?? [null, null];
    const base = {
      game_id: s.id, date: s.date, patch: patchOf(s.version), build: s.build, game_mode: s.gameMode ?? null,
      map: map?.name ?? s.mapTitle, tournament: event?.tournament ?? null,
    };

    games.push({
      ...base, duration_s: s.durationS, winner: s.winner, first_pick: s.firstPick, stage: event?.stage,
      set_id: event?.setId, map_number: event?.mapNumber, team0: teamNames[0], team1: teamNames[1],
    });
    for (const p of s.players) {
      players.push({
        ...base, team: p.team, slot: p.slot, player: p.toon, battletag: p.battletag, name: p.name,
        hero: heroOf(p) ?? p.heroName, win: p.win, team_name: teamNames[p.team], opponent: teamNames[1 - p.team],
        duration_s: s.durationS,
        ...Object.fromEntries(p.talents.slice(0, TALENT_TIERS).map((id, i) => [`talent${i + 1}`, id])),
        ...Object.fromEntries(Object.entries(p.score).map(([k, v]) => [SCORE_PREFIX + k, v])),
      });
    }
    s.draft.forEach((d, order) => {
      if (!d.hero || d.hero === 'NONE') return;
      draft.push({
        ...base, order, kind: d.kind, team: d.team, hero: resolve.heroFromCHero(d.hero) ?? d.hero,
        win: d.team == null ? null : d.team === s.winner, team_name: d.team == null ? null : teamNames[d.team],
      });
    });

    if (event) {
      const agg = perEvent.get(event.tournament) ?? { games: 0, first: null, last: null };
      agg.games++;
      if (s.date && (!agg.first || s.date < agg.first)) agg.first = s.date;
      if (s.date && (!agg.last || s.date > agg.last)) agg.last = s.date;
      perEvent.set(event.tournament, agg);
    }
  }

  return {
    games: games.columns,
    players: players.columns,
    draft: draft.columns,
    scoreColumns: scoreColumns.map((k) => SCORE_PREFIX + k),
    events: perEvent,
    skipped,
  };
}
