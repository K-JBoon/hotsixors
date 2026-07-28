
export const HARD = 1;
export const SOFT = 2;

const TAU = Math.PI * 2;
const STEP = 0.5;
export function buildVisionGrid(rgba, width, height) {
  const cells = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    const cy = height - 1 - py;
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4;
      cells[cy * width + px] = rgba[i] > 127 ? HARD : rgba[i + 1] > 127 ? SOFT : 0;
    }
  }
  return { width, height, cells, patch: labelPatches(cells, width, height) };
}
function labelPatches(cells, width, height) {
  const patch = new Int32Array(width * height);
  const stack = [];
  let next = 0;
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] !== SOFT || patch[start] !== 0) continue;
    next++;
    patch[start] = next;
    stack.push(start);
    while (stack.length) {
      const at = stack.pop();
      const x = at % width;
      const y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (cells[n] !== SOFT || patch[n] !== 0) continue;
          patch[n] = next;
          stack.push(n);
        }
      }
    }
  }
  return patch;
}
export function brushPatchAt(grid, x, y) {
  const i = cellIndex(grid, x, y);
  return i < 0 ? 0 : grid.patch[i];
}

function cellIndex(grid, x, y) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return -1;
  return cy * grid.width + cx;
}
function blocks(grid, x, y, ownPatch, flying) {
  const i = cellIndex(grid, x, y);
  if (i < 0) return true;
  const cell = grid.cells[i];
  if (cell === HARD) return !flying;
  return cell === SOFT && grid.patch[i] !== ownPatch;
}

export function patchAt(grid, x, y) {
  const i = cellIndex(grid, x, y);
  return i < 0 ? 0 : grid.patch[i];
}
export function pointInShapes(shapes, x, y) {
  let inside = false;
  for (const s of shapes) {
    if (shapeHas(s, x, y)) inside = !s.negative;
  }
  return inside;
}
function shapeHas(s, x, y) {
  if (s.kind === 'rect') return x >= s.x && y >= s.y && x <= s.x + s.w && y <= s.y + s.h;
  if (s.kind === 'circle') return Math.hypot(x - s.x, y - s.y) <= s.r;
  const dx = x - s.x;
  const dy = y - s.y;
  return Math.abs(dx + dy) <= (s.w / 2) * Math.SQRT2 && Math.abs(dx - dy) <= (s.h / 2) * Math.SQRT2;
}
export function rayCount(radius) {
  return Math.max(32, Math.min(160, Math.round(radius * 10)));
}
export function castVisibility(grid, x, y, radius, rays = rayCount(radius), flying = false) {
  const poly = new Float64Array(rays * 2);
  const ownPatch = grid ? patchAt(grid, x, y) : 0;
  for (let i = 0; i < rays; i++) {
    const angle = (i / rays) * TAU;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let reach = radius;
    if (grid) {
      let open = !blocks(grid, x, y, ownPatch, flying);
      for (let t = STEP; t <= radius; t += STEP) {
        if (!blocks(grid, x + dx * t, y + dy * t, ownPatch, flying)) {
          open = true;
        } else if (open) {
          reach = t - STEP;
          break;
        }
      }
    }
    poly[i * 2] = x + dx * reach;
    poly[i * 2 + 1] = y + dy * reach;
  }
  return poly;
}
