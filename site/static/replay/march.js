
import { LOOPS_PER_SECOND } from './analyze/stat-events.js';
import { isDeadAt } from './analyze/timeline.js';

const STEP = 8; // loops per tick
const CELL = 16;
const DEFAULT_RANGE = 1.5;
const STAND_OFF = 1;
const ACQUIRE_MARGIN = 2.5;
const MIN_ACQUIRE = 5.5;
const LEASH = 4;
const ON_ROUTE = 0.15;
const SIMPLIFY = 0.25;
const MAX_FOOTPRINT = 5; // widest structure radius, so the cell scan cannot miss one

const NO_AGGRO_RE = /Wall|Moonwell/;

function typeOf(unit) {
  return unit.type || unit.unitType;
}
function teamAt(unit, loop) {
  if (!unit.owners) return unit.team;
  let team = unit.owners[0].team;
  for (const o of unit.owners) {
    if (o.loop > loop) break;
    team = o.team;
  }
  return team;
}
function pointAlong(pts, cum, at) {
  if (at <= 0) return pts[0];
  const total = cum[cum.length - 1];
  if (at >= total) return pts[pts.length - 1];
  let i = 1;
  while (i < cum.length - 1 && cum[i] < at) i++;
  const span = cum[i] - cum[i - 1];
  const f = span === 0 ? 0 : (at - cum[i - 1]) / span;
  return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
}

function newPlan(unit, speed, range) {
  const pts = (unit.anchors || []).filter((a) => a && a.loop != null);
  if (pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const hard = [];
  for (let i = 0; i < pts.length; i++) {
    if (!pts[i].via) hard.push(i);
  }
  if (hard.length < 2) return null;
  return {
    unit,
    pts,
    cum,
    hard,
    hi: 1,
    at: 0,
    x: pts[0].x,
    y: pts[0].y,
    from: pts[0].loop,
    to: pts[pts.length - 1].loop,
    perLoop: speed / LOOPS_PER_SECOND,
    range,
    acquire: Math.max(range + ACQUIRE_MARGIN, MIN_ACQUIRE),
    team: unit.team,
    path: [],
    live: false,
  };
}

function record(plan, loop, keep) {
  const path = plan.path;
  const point = { loop, x: plan.x, y: plan.y };
  if (path.length && path[path.length - 1].loop >= loop) return;
  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  if (last && prev && !last.keep) {
    const span = point.loop - prev.loop;
    const f = span === 0 ? 0 : (last.loop - prev.loop) / span;
    const gx = prev.x + (point.x - prev.x) * f;
    const gy = prev.y + (point.y - prev.y) * f;
    if (Math.hypot(gx - last.x, gy - last.y) < SIMPLIFY) path.pop();
  }
  if (keep) point.keep = true;
  path.push(point);
}

function newGrid() {
  return new Map();
}
function cellKey(x, y) {
  return Math.floor(x / CELL) * 4096 + Math.floor(y / CELL);
}
function insert(grid, x, y, team, ref, r = 0) {
  const key = cellKey(x, y);
  const bucket = grid.get(key);
  const entry = { x, y, team, ref, r };
  if (bucket) bucket.push(entry);
  else grid.set(key, [entry]);
}
function nearestEnemy(grids, x, y, team, radius, reach) {
  let best = null;
  let bestDist = radius;
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  const span = Math.ceil((radius + MAX_FOOTPRINT) / CELL);
  for (let ox = -span; ox <= span; ox++) {
    for (let oy = -span; oy <= span; oy++) {
      const key = (cx + ox) * 4096 + (cy + oy);
      for (const grid of grids) {
        const bucket = grid.get(key);
        if (!bucket) continue;
        for (const e of bucket) {
          if (e.team === team || e.team == null || team == null) continue;
          if (e.ref === reach.self) continue;
          const dist = Math.hypot(e.x - x, e.y - y) - e.r;
          if (dist >= bestDist) continue;
          if (Math.hypot(e.x - reach.x, e.y - reach.y) - e.r > reach.limit) continue;
          bestDist = dist;
          best = e;
        }
      }
    }
  }
  return best;
}

function structureGrid(model) {
  const grid = newGrid();
  for (const s of model.structures || []) {
    if (NO_AGGRO_RE.test(s.type)) continue;
    insert(grid, s.x, s.y, s.team, s, s.shape ? s.shape.r : 0);
  }
  return grid;
}
function structuresAlive(grid, loop) {
  const live = newGrid();
  for (const [key, bucket] of grid) {
    const kept = bucket.filter((e) => e.ref.bornLoop <= loop && (e.ref.diedLoop == null || e.ref.diedLoop > loop));
    if (kept.length) live.set(key, kept);
  }
  return live;
}

function timelinePos(body, loop) {
  const t = body.timeline;
  if (!t) return null;
  const i = Math.min(Math.floor(loop / t.step), t.samples.length / 2 - 1);
  if (i < 0) return null;
  return [t.samples[i * 2], t.samples[i * 2 + 1]];
}

function bystanderGrid(model, loop) {
  const grid = newGrid();
  for (const p of model.players || []) {
    if (isDeadAt(p, loop, model.durationLoops)) continue;
    const pos = timelinePos(p, loop);
    if (pos) insert(grid, pos[0], pos[1], p.team, p);
  }
  for (const c of model.companions || []) {
    if (!c.timeline) continue;
    if (c.bornLoop > loop || (c.diedLoop != null && c.diedLoop <= loop)) continue;
    const pos = timelinePos(c, loop);
    if (pos) insert(grid, pos[0], pos[1], c.team, c);
  }
  return grid;
}

function stepUnit(plan, loop, grids) {
  const { pts, cum, hard } = plan;
  while (plan.hi < hard.length && pts[hard[plan.hi]].loop <= loop) {
    const p = pts[hard[plan.hi]];
    plan.x = p.x;
    plan.y = p.y;
    plan.at = cum[hard[plan.hi]];
    plan.hi++;
    record(plan, p.loop, true);
  }
  if (plan.hi >= hard.length) return false;

  const deadline = pts[hard[plan.hi]];
  const route = pointAlong(pts, cum, plan.at);
  const strayed = Math.hypot(plan.x - route.x, plan.y - route.y);
  const need = (strayed + cum[hard[plan.hi]] - plan.at) / plan.perLoop;
  const mayFight = deadline.loop - loop > need + STEP;

  let budget = plan.perLoop * STEP;
  const target = mayFight
    ? nearestEnemy(grids, plan.x, plan.y, plan.team, plan.acquire, {
        x: route.x,
        y: route.y,
        limit: plan.range + LEASH,
        self: plan.unit,
      })
    : null;

  if (target) {
    const dist = Math.hypot(target.x - plan.x, target.y - plan.y);
    const close = Math.min(budget, Math.max(0, dist - plan.range - STAND_OFF - target.r));
    if (close > 0 && dist > 0) {
      plan.x += ((target.x - plan.x) / dist) * close;
      plan.y += ((target.y - plan.y) / dist) * close;
    }
    return true;
  }

  if (strayed > ON_ROUTE) {
    const back = Math.min(budget, strayed);
    plan.x += ((route.x - plan.x) / strayed) * back;
    plan.y += ((route.y - plan.y) / strayed) * back;
    budget -= back;
  } else {
    plan.x = route.x;
    plan.y = route.y;
  }
  if (budget > 0) {
    plan.at = Math.min(plan.at + budget, cum[cum.length - 1]);
    const next = pointAlong(pts, cum, plan.at);
    plan.x = next.x;
    plan.y = next.y;
  }
  return true;
}

export function marchUnits(units, speeds, world = {}) {
  if (!speeds) return;
  const ranges = world.ranges || {};
  const model = world.model || null;
  const plans = [];
  for (const unit of units) {
    if (!unit.anchors) continue;
    const type = typeOf(unit);
    const speed = speeds[type];
    if (!speed) continue;
    const plan = newPlan(unit, speed, ranges[type] ?? DEFAULT_RANGE);
    if (plan) plans.push(plan);
    else unit.path = unit.anchors;
  }
  if (!plans.length) return;

  const pending = [...plans].sort((a, b) => a.from - b.from);
  const structures = model ? structureGrid(model) : newGrid();
  let next = 0;
  const live = new Set();
  const start = pending[0].from;
  const end = plans.reduce((max, p) => Math.max(max, p.to), start);

  for (let loop = start; loop <= end + STEP; loop += STEP) {
    while (next < pending.length && pending[next].from <= loop) {
      const plan = pending[next++];
      plan.team = teamAt(plan.unit, plan.from);
      record(plan, plan.from, true);
      live.add(plan);
    }
    const mobiles = newGrid();
    for (const plan of live) insert(mobiles, plan.x, plan.y, plan.team, plan.unit);
    const grids = [mobiles, structuresAlive(structures, loop), model ? bystanderGrid(model, loop) : newGrid()];
    for (const plan of live) {
      if (!stepUnit(plan, loop, grids)) {
        live.delete(plan);
        continue;
      }
      record(plan, loop);
    }
  }
  for (const plan of plans) {
    const last = plan.pts[plan.pts.length - 1];
    const tail = plan.path[plan.path.length - 1];
    if (!tail || tail.loop < last.loop) plan.path.push({ loop: last.loop, x: last.x, y: last.y });
    plan.unit.path = plan.path;
  }
}
