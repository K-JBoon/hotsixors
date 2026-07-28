
import { nearestLane } from '../lanes.js';
const STRUCTURE_KINDS = [
  { re: /Core/, name: 'Core', lane: false },
  { re: /TownHallL3/, name: 'Keep' },
  { re: /TownHall/, name: 'Fort' },
  { re: /CannonTower/, name: 'Tower' },
  { re: /Moonwell/, name: 'Healing Fountain' },
];
const LANE_NAMES = { 2: ['Top', 'Bottom'], 3: ['Top', 'Mid', 'Bottom'] };
const LANE_STRUCTURE_DIST = 25;
export function nameStructures(model, lanePaths) {
  const names = LANE_NAMES[lanePaths.length] || [];
  const laneName = [];
  lanePaths
    .map((path, index) => ({
      index,
      y: path.points.reduce((sum, [, py]) => sum + py, 0) / path.points.length,
    }))
    .sort((a, b) => b.y - a.y)
    .forEach((lane, rank) => {
      laneName[lane.index] = names[rank] || '';
    });

  for (const s of model.structures) {
    const kind = STRUCTURE_KINDS.find((k) => k.re.test(s.type));
    if (!kind) continue;
    s.kind = kind.name;
    let prefix = '';
    if (kind.lane !== false && lanePaths.length) {
      const near = nearestLane(lanePaths, s.x, s.y);
      if (near.index >= 0 && near.dist <= LANE_STRUCTURE_DIST) prefix = laneName[near.index];
    }
    s.label = prefix ? `${prefix} ${kind.name}` : kind.name;
  }
}

const STRUCTURE_CLASSES = [
  { re: /Core/, glyph: 'core', fill: 0.72, tint: 0.4, edge: 0.95 },
  { re: /TownHall/, glyph: 'hall', fill: 0.62, tint: 0.25, edge: 0.9 },
  { re: /CannonTower/, glyph: 'tower', fill: 0.55, tint: 0.12, edge: 0.85 },
  { re: /Moonwell/, glyph: 'well', fill: 0.42, tint: 0.12, edge: 0.8 },
  { re: /Gate/, glyph: null, fill: 0.3, tint: 0, edge: 0.75 },
];
export const WALL_CLASS = { glyph: null, fill: 0.2, tint: 0, edge: 0.6 };

export function structureStyle(type) {
  return STRUCTURE_CLASSES.find((c) => c.re.test(type)) || WALL_CLASS;
}
