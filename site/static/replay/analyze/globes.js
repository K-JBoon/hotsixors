import { tagOf } from './registry.js';

const NEUTRAL_OWNER = 15;
const AI_TEAM = { 11: 0, 12: 1, 13: 0, 14: 1 };
const GLOBE_TYPES = new Set(['RegenGlobe', 'RegenGlobeNeutral']);
// RegenGlobePickedUp lags the globe's death by up to ~17 loops.
const PICKUP_LAG = 20;

export const newGlobeLog = () => ({ byTag: new Map(), all: [] });

export function globeBorn(log, ev, name) {
  if (!GLOBE_TYPES.has(name)) return;
  const g = {
    type: name,
    bornLoop: ev._gameloop,
    x: ev.m_x,
    y: ev.m_y,
    owners: [ev.m_controlPlayerId],
    diedLoop: null,
    dx: null,
    dy: null,
  };
  log.byTag.set(tagOf(ev), g);
  log.all.push(g);
}

// At expiry the death can precede the 15 -> 11/12 change in the same loop.
export function globeOwnerChanged(log, ev) {
  const g = log.byTag.get(tagOf(ev));
  if (g && (g.diedLoop == null || g.diedLoop === ev._gameloop)) g.owners.push(ev.m_controlPlayerId);
}

export function globeDied(log, ev) {
  const g = log.byTag.get(tagOf(ev));
  if (!g || g.diedLoop != null) return;
  g.diedLoop = ev._gameloop;
  g.dx = ev.m_x;
  g.dy = ev.m_y;
}

const linkKey = (loop, x, y, owner) => `${loop}:${x}:${y}:${owner}`;

function childrenByParent(all) {
  const parents = new Map();
  for (const g of all) {
    if (g.type !== 'RegenGlobe' || g.diedLoop == null) continue;
    const key = linkKey(g.diedLoop, g.dx, g.dy, g.owners[0]);
    parents.set(key, [...(parents.get(key) || []), g]);
  }
  const children = new Map();
  for (const n of all) {
    if (n.type !== 'RegenGlobeNeutral' || !(n.owners[0] in AI_TEAM)) continue;
    const key = linkKey(n.bornLoop, n.x, n.y, n.owners[0]);
    const parent = (parents.get(key) || []).find((g) => !children.has(g));
    if (parent) children.set(parent, n);
  }
  return children;
}

// null: expired, undefined: unresolved owner sequence.
function neutralPicker(n) {
  const last = n.owners.at(-1);
  if (n.owners.at(-2) === NEUTRAL_OWNER && last in AI_TEAM) return AI_TEAM[last];
  return last === NEUTRAL_OWNER ? null : undefined;
}

function ended(start, end, pickedBy, outcomeOf) {
  if (end.diedLoop == null || pickedBy === undefined) return null;
  return {
    bornLoop: start.bornLoop,
    endLoop: end.diedLoop,
    outcome: outcomeOf(pickedBy),
    pickedBy,
    x: end.dx,
    y: end.dy,
  };
}

function teamDrop(g, child) {
  const team = AI_TEAM[g.owners[0]];
  const pickedBy = child ? neutralPicker(child) : team;
  const outcomeOf = (by) => (by == null ? 'expired' : by === team ? 'own' : 'opponent');
  const e = ended(g, child || g, pickedBy, outcomeOf);
  return e && { team, ...e };
}

const mapDrop = (n) => ended(n, n, neutralPicker(n), (by) => (by == null ? 'expired' : 'picked'));

const eventsAfter = (events, end) => events.filter((e) => e.loop >= end && e.loop <= end + PICKUP_LAG);

// The hero who touches a globe gets the first pickup event; the rest are allies healed in its radius.
function toucherOf(hits) {
  const first = Math.min(...hits.map((e) => e.loop));
  const ids = [...new Set(hits.filter((e) => e.loop === first).map((e) => e.playerId))];
  return ids.length === 1 ? { toucher: ids[0] } : { toucher: null, tied: ids };
}

// A take with no pickup event from the taker's team is the game clearing globes at the end.
function withToucher(eventsByTeam) {
  return (g) => {
    if (!g) return null;
    if (g.pickedBy == null) return g;
    const hits = eventsAfter(eventsByTeam[g.pickedBy] || [], g.endLoop);
    return hits.length ? { ...g, ...toucherOf(hits) } : null;
  };
}

const pickupEvents = (players, team) =>
  players.filter((p) => p.team === team).flatMap((p) => (p.globes || []).map((loop) => ({ loop, playerId: p.playerId })));

export function buildGlobes(log, players) {
  const children = childrenByParent(log.all);
  const resolve = withToucher([0, 1].map((team) => pickupEvents(players, team)));
  const globes = log.all
    .filter((g) => g.type === 'RegenGlobe' && g.owners[0] in AI_TEAM)
    .map((g) => resolve(teamDrop(g, children.get(g))))
    .filter(Boolean);
  const mapGlobes = log.all
    .filter((g) => g.type === 'RegenGlobeNeutral' && !(g.owners[0] in AI_TEAM))
    .map((g) => resolve(mapDrop(g)))
    .filter(Boolean);
  return { globes, mapGlobes };
}
