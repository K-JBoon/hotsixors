
import { findPath, lineWalkable } from '../pathing.js';
import { FIXED, LOOPS_PER_SECOND } from './stat-events.js';
import { TAG_RECYCLE_SPAN } from './selection.js';

export function anchor(body, loop, x, y) {
  (body.anchors ||= []).push({ loop, x, y });
}
export function anchorSnapshot(bodyAtLoop, target, loop) {
  if (!target || !target.m_snapshotPoint || target.m_tag == null) return;
  const body = bodyAtLoop(Math.floor(target.m_tag / TAG_RECYCLE_SPAN), loop);
  if (!body) return;
  anchor(body, loop, target.m_snapshotPoint.x / FIXED, target.m_snapshotPoint.y / FIXED);
}
export function median2(points) {
  if (!points.length) return null;
  const mid = (vals) => {
    vals.sort((a, b) => a - b);
    return vals[vals.length >> 1];
  };
  return { x: mid(points.map((p) => p.x)), y: mid(points.map((p) => p.y)) };
}
function pathTo(grid, x, y, target) {
  if (lineWalkable(grid, x, y, target.x, target.y)) return [[target.x, target.y]];
  return findPath(grid, x, y, target.x, target.y) || [[target.x, target.y]];
}
const JUMP_CONFIRM_LOOPS = 48; // 3s, long enough for Hearthstone-length casts
const JUMP_CONFIRM_DIST = 10; // world units
const HEARTH_CHANNEL = 104; // 6.5s channel, then the hero is on the hall
const HEARTH_EVIDENCE = [80, 208]; // loops after the cast to look for evidence in
const HEARTH_RADIUS = 22; // how near the hall a sample must land to count
function hearthLandings(player, anchors, hearthLinks, hall) {
  if (!hall || !hearthLinks || !player.casts) return [];
  const casts = player.casts.filter((c) => hearthLinks.has(c.link)).sort((a, b) => a.loop - b.loop);
  const camera = player.camera || [];
  const deaths = player.deaths || [];
  const nearHall = (s) => Math.hypot(s.x - hall.x, s.y - hall.y) < HEARTH_RADIUS;
  const out = [];
  for (let i = 0; i < casts.length; i++) {
    const c = casts[i];
    if (casts[i + 1] && casts[i + 1].loop - c.loop < HEARTH_CHANNEL) continue;
    if (deaths.some((d) => d.loop >= c.loop && d.loop <= c.loop + HEARTH_CHANNEL)) continue;
    const from = c.loop + HEARTH_EVIDENCE[0];
    const to = c.loop + HEARTH_EVIDENCE[1];
    const sawHall =
      camera.some((s) => s.loop >= from && s.loop <= to && nearHall(s)) ||
      anchors.some((a) => a.loop >= from && a.loop <= c.loop + 400 && nearHall(a));
    if (sawHall) out.push({ loop: c.loop + HEARTH_CHANNEL, x: hall.x, y: hall.y });
  }
  return out;
}
function confirmsJump(anchors, ai, jump) {
  for (let i = ai; i < anchors.length && anchors[i].loop <= jump.loop + JUMP_CONFIRM_LOOPS; i++) {
    if (anchors[i].loop < jump.loop) continue;
    return Math.hypot(anchors[i].x - jump.x, anchors[i].y - jump.y) <= JUMP_CONFIRM_DIST;
  }
  return false;
}
function advance(x, y, waypoints, budget) {
  while (budget > 0 && waypoints.length) {
    const [wx, wy] = waypoints[0];
    const dx = wx - x;
    const dy = wy - y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget) {
      x = wx;
      y = wy;
      budget -= dist;
      waypoints.shift();
    } else {
      x += (dx / dist) * budget;
      y += (dy / dist) * budget;
      budget = 0;
    }
  }
  return { x, y, arrived: !waypoints.length };
}
export function buildPositionTimeline(player, durationLoops, options = {}) {
  const {
    speed = 4.4,
    step = 8,
    walkGrid = null,
    movementLinks = null,
    hearthLinks = null,
    hall = null,
  } = options;
  const anchors = [...player.anchors].sort((a, b) => a.loop - b.loop);
  const moves = [...player.moves].sort((a, b) => a.loop - b.loop);
  if (!anchors.length) return null;
  const jumps =
    movementLinks && player.casts
      ? player.casts.filter((c) => movementLinks.has(c.link)).sort((a, b) => a.loop - b.loop)
      : [];
  const landings = hearthLandings(player, anchors, hearthLinks, hall);

  const samples = [];
  let ai = 0;
  let mi = 0;
  let ji = 0;
  let li = 0;
  let x = anchors[0].x;
  let y = anchors[0].y;
  let target = null;
  let route = null; // remaining waypoints to `target`, nearest first
  let waitingForAnchor = false; // parked until next recorded position confirms a jump
  const perStep = (speed * step) / LOOPS_PER_SECOND;

  const setTarget = (t) => {
    target = t;
    route = null;
  };

  for (let loop = 0; loop <= durationLoops; loop += step) {
    while (ai < anchors.length && anchors[ai].loop <= loop) {
      x = anchors[ai].x;
      y = anchors[ai].y;
      setTarget(null); // anchor supersedes stale movement targets
      waitingForAnchor = false;
      ai++;
    }
    while (mi < moves.length && moves[mi].loop <= loop) {
      setTarget(moves[mi]);
      waitingForAnchor = false;
      mi++;
    }
    while (ji < jumps.length && jumps[ji].loop <= loop) {
      const jump = jumps[ji];
      setTarget(null); // hero did not walk this, drop any stale move order
      if (jump.x != null && confirmsJump(anchors, ai, jump)) {
        x = jump.x;
        y = jump.y;
        waitingForAnchor = false;
      } else {
        waitingForAnchor = true;
      }
      ji++;
    }
    while (li < landings.length && landings[li].loop <= loop) {
      x = landings[li].x;
      y = landings[li].y;
      setTarget(null);
      waitingForAnchor = false;
      li++;
    }
    if (target && !waitingForAnchor) {
      if (walkGrid && !route) route = pathTo(walkGrid, x, y, target);
      const waypoints = route || [[target.x, target.y]];
      const moved = advance(x, y, waypoints, perStep);
      x = moved.x;
      y = moved.y;
      if (moved.arrived) setTarget(null);
    }
    samples.push(x, y);
  }
  return { step, samples };
}
export function minionPositionAt(m, loop) {
  if (loop < m.bornLoop || (m.diedLoop != null && loop > m.diedLoop)) return null;
  const a = m.path || m.anchors; // `path` is the marched route; `anchors` are the logged positions
  let i = 0;
  while (i + 1 < a.length && a[i + 1].loop <= loop) i++;
  const from = a[i];
  const to = a[i + 1];
  if (!to) return [from.x, from.y];
  const f = (loop - from.loop) / (to.loop - from.loop);
  return [from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f];
}
export function isAliveAt(spans, loop) {
  for (const s of spans) {
    if (loop >= s.from && (s.to == null || loop <= s.to)) return true;
  }
  return false;
}
export function isDeadAt(player, loop, durationLoops) {
  for (const d of player.deaths) {
    const end = d.respawnLoop ?? Math.min(d.loop + 16 * 60, durationLoops);
    if (loop >= d.loop && loop < end) return d;
  }
  return null;
}
