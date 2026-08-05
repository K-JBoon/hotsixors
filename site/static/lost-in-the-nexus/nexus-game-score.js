
export const POSITION_WEIGHT = 0.7;
export const AIM_WEIGHT = 0.3;
export const MAX_POINTS = 1000;

// Distance is scored against the map's own scale, so a small battleground is not
// forgiving. These constants set how fast a miss decays: at one span away the
// position term is worth about 5%, at a right angle off the aim term about 15%.
const POSITION_FALLOFF = 3;
const AIM_FALLOFF = 1.2;

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const len = length(v);
  return len < 1e-9 ? [0, 0, -1] : [v[0] / len, v[1] / len, v[2] / len];
}

export function shotDistance(a, b) {
  return length(sub(a.p, b.p));
}

export function aimAngle(a, b) {
  const da = normalize(sub(a.t, a.p));
  const db = normalize(sub(b.t, b.p));
  const dot = Math.min(1, Math.max(-1, da[0] * db[0] + da[1] * db[1] + da[2] * db[2]));
  return Math.acos(dot);
}

export function scoreShot(shot, target, span) {
  const distance = shotDistance(shot, target);
  const angle = aimAngle(shot, target);
  const position = Math.exp(-POSITION_FALLOFF * (distance / Math.max(span, 1)));
  const aim = Math.exp(-AIM_FALLOFF * angle);
  return {
    distance,
    angle,
    points: Math.round(MAX_POINTS * (POSITION_WEIGHT * position + AIM_WEIGHT * aim)),
  };
}

// Ranked best first; ties break on the closer camera, then on name so every peer
// derives the same order from the same data.
export function rankShots(entries, target, span) {
  return entries
    .map((entry) => ({ ...entry, ...scoreShot(entry.shot, target, span) }))
    .sort((a, b) => b.points - a.points || a.distance - b.distance || a.name.localeCompare(b.name))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
