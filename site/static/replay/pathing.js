export function buildWalkGrid(rgba, width, height) {
  const blocked = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    const cy = height - 1 - py;
    for (let px = 0; px < width; px++) {
      blocked[cy * width + px] = rgba[(py * width + px) * 4 + 2] > 127 ? 1 : 0;
    }
  }
  return { width, height, blocked };
}

function isBlocked(grid, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return true;
  return grid.blocked[cy * grid.width + cx] === 1;
}
export function lineWalkable(grid, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist / 0.5);
  if (steps === 0) return !isBlocked(grid, Math.floor(x0), Math.floor(y0));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (isBlocked(grid, Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) return false;
  }
  return true;
}
function nearestWalkable(grid, x, y, maxRadius = 6) {
  let cx = Math.floor(x);
  let cy = Math.floor(y);
  if (!isBlocked(grid, cx, cy)) return [x, y];
  for (let r = 1; r <= maxRadius; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        if (!isBlocked(grid, cx + ox, cy + oy)) return [cx + ox + 0.5, cy + oy + 0.5];
      }
    }
  }
  return null;
}

const SQRT2 = Math.SQRT2;
const MAX_EXPANSIONS = 30000;
export function findPath(grid, fromX, fromY, toX, toY, snapRadius = 6) {
  const start = nearestWalkable(grid, fromX, fromY, snapRadius);
  const goal = nearestWalkable(grid, toX, toY, snapRadius);
  if (!start || !goal) return null;

  const { width, height } = grid;
  const startIdx = Math.floor(start[1]) * width + Math.floor(start[0]);
  const goalIdx = Math.floor(goal[1]) * width + Math.floor(goal[0]);
  if (startIdx === goalIdx) return [[toX, toY]];

  const gScore = new Float32Array(width * height).fill(Infinity);
  const cameFrom = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  const gx = goalIdx % width;
  const gy = (goalIdx - gx) / width;
  const h = (x, y) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx < dy ? dx * (SQRT2 - 1) + dy : dy * (SQRT2 - 1) + dx;
  };
  const heap = [[h(startIdx % width, (startIdx - (startIdx % width)) / width), startIdx]];
  gScore[startIdx] = 0;
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < heap.length && heap[l][0] < heap[small][0]) small = l;
        if (r < heap.length && heap[r][0] < heap[small][0]) small = r;
        if (small === i) break;
        [heap[small], heap[i]] = [heap[i], heap[small]];
        i = small;
      }
    }
    return top;
  };

  let expansions = 0;
  let found = false;
  while (heap.length) {
    const [, current] = pop();
    if (current === goalIdx) {
      found = true;
      break;
    }
    if (closed[current]) continue;
    closed[current] = 1;
    if (++expansions > MAX_EXPANSIONS) break;
    const cx = current % width;
    const cy = (current - cx) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (isBlocked(grid, nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (isBlocked(grid, cx + dx, cy) || isBlocked(grid, cx, cy + dy))) continue;
        const n = ny * width + nx;
        if (closed[n]) continue;
        const step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
        const g = gScore[current] + step;
        if (g >= gScore[n]) continue;
        gScore[n] = g;
        cameFrom[n] = current;
        push([g + h(nx, ny), n]);
      }
    }
  }
  if (!found) return null;

  const cells = [];
  for (let at = goalIdx; at !== -1; at = cameFrom[at]) {
    cells.push(at);
    if (at === startIdx) break;
  }
  cells.reverse();
  const points = cells.map((c) => [(c % width) + 0.5, Math.floor(c / width) + 0.5]);
  points[points.length - 1] = [toX, toY];
  const out = [];
  let anchorX = fromX;
  let anchorY = fromY;
  for (let i = 0; i < points.length; i++) {
    const next = points[i + 1];
    if (!next) {
      out.push(points[i]);
      break;
    }
    if (!lineWalkable(grid, anchorX, anchorY, next[0], next[1])) {
      out.push(points[i]);
      anchorX = points[i][0];
      anchorY = points[i][1];
    }
  }
  return out;
}
const MAX_TERRAIN_DETOUR = 3;
const UNIT_SNAP_RADIUS = 30;
export function routeUnitsThroughTerrain(units, grid) {
  for (const unit of units) {
    if (!unit.anchors || unit.anchors.length < 2) continue;
    const routed = [unit.anchors[0]];
    for (let i = 1; i < unit.anchors.length; i++) {
      const from = unit.anchors[i - 1];
      const to = unit.anchors[i];
      const straight = Math.hypot(to.x - from.x, to.y - from.y);
      if (straight > 0.5 && !lineWalkable(grid, from.x, from.y, to.x, to.y)) {
        const way = findPath(grid, from.x, from.y, to.x, to.y, UNIT_SNAP_RADIUS);
        const cum = [0];
        let px = from.x;
        let py = from.y;
        for (const [wx, wy] of way || []) {
          cum.push(cum[cum.length - 1] + Math.hypot(wx - px, wy - py));
          px = wx;
          py = wy;
        }
        const total = cum[cum.length - 1];
        if (way && way.length > 1 && total <= straight * MAX_TERRAIN_DETOUR + 4) {
          for (let w = 0; w < way.length - 1; w++) {
            routed.push({
              loop: from.loop + (to.loop - from.loop) * (cum[w + 1] / total),
              x: way[w][0],
              y: way[w][1],
              via: true,
            });
          }
        }
      }
      routed.push(to);
    }
    unit.anchors = routed;
  }
}
