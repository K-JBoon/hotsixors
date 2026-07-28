const LANE_TOLERANCE = 12;
const MAX_DETOUR = 2.5;
const MAX_INSERTED = 24;
export function buildLanePaths(lanes) {
  return (lanes || [])
    .filter((points) => points && points.length >= 2)
    .map((points) => {
      const cum = [0];
      for (let i = 1; i < points.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
      }
      return { points, cum, length: cum[cum.length - 1] };
    });
}
export function nearestLane(paths, x, y) {
  let best = { index: -1, dist: Infinity };
  paths.forEach((path, index) => {
    const { dist } = project(path, x, y);
    if (dist < best.dist) best = { index, dist };
  });
  return best;
}
function project(path, x, y) {
  const { points, cum } = path;
  let best = { dist: Infinity, at: 0 };
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const span = dx * dx + dy * dy;
    const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / span));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const dist = Math.hypot(x - px, y - py);
    if (dist < best.dist) best = { dist, at: cum[i - 1] + Math.hypot(px - ax, py - ay) };
  }
  return best;
}

function pointAt(path, at) {
  const { points, cum } = path;
  if (at <= 0) return points[0];
  if (at >= cum[cum.length - 1]) return points[points.length - 1];
  let i = 1;
  while (i < cum.length - 1 && cum[i] < at) i++;
  const span = cum[i] - cum[i - 1];
  const t = span === 0 ? 0 : (at - cum[i - 1]) / span;
  return [
    points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
    points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
  ];
}
function fitLane(paths, from, to) {
  const straight = Math.hypot(to.x - from.x, to.y - from.y);
  let best = null;
  for (const path of paths) {
    const a = project(path, from.x, from.y);
    const b = project(path, to.x, to.y);
    if (a.dist > LANE_TOLERANCE || b.dist > LANE_TOLERANCE) continue;
    const along = Math.abs(b.at - a.at);
    if (along < straight - 1 || along > straight * MAX_DETOUR + 4) continue;
    const fit = a.dist + b.dist;
    if (!best || fit < best.fit) best = { path, from: a.at, to: b.at, fit };
  }
  return best;
}
export function routeUnitsAlongLanes(units, paths) {
  if (!paths.length) return;
  for (const unit of units) {
    if (!unit.anchors || unit.anchors.length < 2) continue;
    const routed = [unit.anchors[0]];
    for (let i = 1; i < unit.anchors.length; i++) {
      const from = unit.anchors[i - 1];
      const to = unit.anchors[i];
      const lane = fitLane(paths, from, to);
      if (lane) {
        const { path } = lane;
        const span = lane.to - lane.from;
        const offsetAt = (anchor, at) => {
          const on = pointAt(path, at);
          return [anchor.x - on[0], anchor.y - on[1]];
        };
        const fromOff = offsetAt(from, lane.from);
        const toOff = offsetAt(to, lane.to);
        const between = [];
        for (let w = 0; w < path.cum.length; w++) {
          const at = path.cum[w];
          if (at > Math.min(lane.from, lane.to) && at < Math.max(lane.from, lane.to)) between.push(w);
        }
        if (span < 0) between.reverse();
        const stride = Math.ceil(between.length / MAX_INSERTED);
        for (const w of between.filter((_, i) => i % stride === 0)) {
          const f = (path.cum[w] - lane.from) / span;
          routed.push({
            loop: from.loop + (to.loop - from.loop) * f,
            x: path.points[w][0] + fromOff[0] * (1 - f) + toOff[0] * f,
            y: path.points[w][1] + fromOff[1] * (1 - f) + toOff[1] * f,
            via: true,
          });
        }
      }
      routed.push(to);
    }
    unit.anchors = routed;
  }
}
