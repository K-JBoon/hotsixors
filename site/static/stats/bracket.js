// Shapes a tournament's rounds (see reports.js `rounds`) into display phases:
// brackets, group standings, or plain series lists. Stage names come from
// Liquipedia as `<page section> / <round>`.

const GRAND_FINAL = /^grand finals?$/i;
const BRACKET_ROUND = /^(?:(upper|lower) bracket )?(?:round \d+|quarterfinals?|semifinals?|finals?)$/i;
const GROUP = /^group [a-z0-9]+$/i;
const SCHEDULE = /^(?:week|day|round) \d+$/i;

const depth = (round) => {
  const n = /round (\d+)/i.exec(round);
  if (n) return Number(n[1]);
  if (/quarter/i.test(round)) return 100;
  if (/semi/i.test(round)) return 101;
  return 102;
};

const columns = (rounds) =>
  [...rounds].sort((a, b) => depth(a.round) - depth(b.round)).map(({ round, series }) => ({ round, series: [...series] }));

const seriesWinner = (s) => (s.wins[0] > s.wins[1] ? s.teams[0] : s.wins[1] > s.wins[0] ? s.teams[1] : null);

/** Edges from each series to the next-column series its winner played; columns reordered so feeders sit together. */
function link(lines, crossings = []) {
  const edges = [];
  const pairs = [...lines.flatMap((cols) => cols.slice(0, -1).map((c, i) => [c, cols[i + 1]])), ...crossings];
  for (const [from, to] of pairs) {
    for (const s of from.series) {
      const w = seriesWinner(s);
      const target = w && to.series.find((t) => t.date >= s.date && t.teams.includes(w));
      if (target) edges.push({ from: s.id, to: target.id });
    }
  }
  for (const cols of lines) {
    for (let i = cols.length - 2; i >= 0; i--) {
      const rank = (s) => {
        const e = edges.find((x) => x.from === s.id);
        const at = e ? cols[i + 1].series.findIndex((t) => t.id === e.to) : -1;
        return at === -1 ? Infinity : at;
      };
      cols[i] = { ...cols[i], series: [...cols[i].series].sort((a, b) => rank(a) - rank(b)) };
    }
  }
  return edges;
}

/**
 * Liquipedia exports some bracket matches under a section heading instead of a round.
 * Each such series goes one column before the winner's next match in whichever line it comes first;
 * latest first, so an earlier unlabeled series can lead into a later one.
 */
function place(lines, pool) {
  for (const s of [...pool].sort((a, b) => b.date.localeCompare(a.date))) {
    const w = seriesWinner(s);
    if (!w) continue;
    const next = lines.flatMap((cols) => cols.flatMap((c, k) =>
      k > 0 ? c.series.filter((t) => t.date > s.date && t.teams.includes(w)).map((t) => ({ cols, k, date: t.date })) : []));
    const first = next.sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!first) continue;
    first.cols[first.k - 1].series.push(s);
    pool.splice(pool.indexOf(s), 1);
  }
}

const seriesLoser = (s) => (s.wins[0] > s.wins[1] ? s.teams[1] : s.wins[1] > s.wins[0] ? s.teams[0] : null);

/**
 * Shared grid columns: a lower round sits right of the earliest upper round that drops a loser into it,
 * the upper final aligns with the lower final, and grand finals come last.
 */
function align(up, low, grandCount) {
  const main = up.slice(0, up.length - grandCount);
  const dropsInto = (c) => main.flatMap((u, i) =>
    u.series.some((us) => c.series.some((ls) => ls.date > us.date && ls.teams.includes(seriesLoser(us)))) ? [i] : []);
  let prev = -1;
  const lower = low.map((c) => {
    const from = dropsInto(c);
    prev = Math.max(prev + 1, from.length ? Math.min(...from) + 1 : 0);
    return { ...c, at: prev };
  });
  const last = Math.max(main.length - 1, prev);
  const upper = up.map((c, i) => ({ ...c, at: i < main.length - 1 ? i : i === main.length - 1 ? last : last + 1 + i - main.length }));
  return { upper, lower, width: Math.max(...upper.map((c) => c.at), ...lower.map((c) => c.at)) + 1 };
}

function standings(series) {
  const rows = new Map();
  const row = (team) => rows.get(team) ?? rows.set(team, { team, won: 0, lost: 0, mapsWon: 0, mapsLost: 0 }).get(team);
  for (const s of series) {
    if (s.teams.some((t) => t == null)) continue;
    const [a, b] = s.teams.map(row);
    a.mapsWon += s.wins[0]; a.mapsLost += s.wins[1];
    b.mapsWon += s.wins[1]; b.mapsLost += s.wins[0];
    if (s.wins[0] > s.wins[1]) { a.won++; b.lost++; }
    if (s.wins[1] > s.wins[0]) { b.won++; a.lost++; }
  }
  return [...rows.values()].sort((x, y) => y.won - x.won || y.mapsWon - y.mapsLost - (x.mapsWon - x.mapsLost));
}

function shape(phase, rounds, pool) {
  if (phase == null) return pool.length ? [{ kind: 'list', name: 'Other games', rounds: [{ round: null, series: pool }] }] : [];
  const isBracket = rounds.some((r) => GRAND_FINAL.test(r.round) || /bracket|final/i.test(r.round));
  const inBracket = (r) => GRAND_FINAL.test(r.round) || (BRACKET_ROUND.test(r.round) && (isBracket || !SCHEDULE.test(r.round)));
  const bracket = rounds.filter(inBracket);
  const groups = rounds.filter((r) => !inBracket(r) && GROUP.test(r.round));
  const schedule = rounds.filter((r) => !inBracket(r) && SCHEDULE.test(r.round));
  const rest = rounds.filter((r) => !bracket.includes(r) && !groups.includes(r) && !schedule.includes(r));
  const out = [];
  if (groups.length || schedule.length) {
    out.push({
      kind: 'groups',
      name: phase || 'Group stage',
      groups: [
        ...groups.map((r) => ({ name: r.round, standings: standings(r.series), rounds: [{ round: null, series: r.series }] })),
        ...(schedule.length ? [{ name: groups.length ? 'Schedule' : null, standings: standings(schedule.flatMap((r) => r.series)), rounds: schedule }] : []),
      ],
    });
  }
  if (bracket.length) {
    const grand = bracket.filter((r) => GRAND_FINAL.test(r.round));
    const lower = bracket.filter((r) => /^lower/i.test(r.round));
    const upper = bracket.filter((r) => !grand.includes(r) && !lower.includes(r));
    const up = [...columns(upper), ...grand];
    const low = columns(lower);
    place([up, low], pool);
    const crossings = grand.length && low.length ? [[low.at(-1), grand[0]]] : [];
    const edges = link([up, low], crossings);
    out.push({ kind: 'bracket', name: phase || 'Playoffs', ...align(up, low, grand.length), edges });
  }
  if (rest.length) out.push({ kind: 'list', name: phase || 'Matches', rounds: rest });
  return out;
}

/** Phases in order of their first round; `rounds` arrive ordered with the unknown stage last. */
export function phases(rounds) {
  const byPhase = new Map();
  for (const { stage, series } of rounds) {
    const parts = stage?.split(' / ') ?? [];
    const round = parts.pop() ?? null;
    const phase = stage == null ? null : parts.join(' / ');
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase).push({ round, series });
  }
  const pool = byPhase.get(null)?.flatMap((r) => r.series) ?? [];
  return [...byPhase].flatMap(([phase, rs]) => shape(phase, rs, pool));
}
