
/* The in-game camera is the `BlizzardAllStars` CCamera in
   core.stormmod/base.stormdata/gamedata/cameradata.xml: a 37.5° field of view
   and a zoom table pairing each camera distance with a pitch. Replays log a
   distance only when the player changes zoom, so samples without one are
   assumed to sit at the zoomed-out end of the table. */
const FOV_DEG = 37.5;
const DEFAULT_DISTANCE = 34;
const SCREEN_ASPECT = 16 / 9; // the recording player's screen shape is not in the replay
const ZOOM_TABLE = [
  { distance: 14, pitch: 42 },
  { distance: 20, pitch: 42 },
  { distance: 24, pitch: 48 },
  { distance: 30, pitch: 54 },
  { distance: 34, pitch: 54 },
];
/* Cuts (centering on a hero, pings, alerts) arrive as one event, so anything
   this far apart is a jump rather than a scroll and must not be tweened. */
const JUMP_DIST = 20;
const JUMP_LOOPS = 16;

const rad = (deg) => (deg * Math.PI) / 180;

function pitchFor(distance) {
  const t = ZOOM_TABLE;
  if (distance <= t[0].distance) return t[0].pitch;
  for (let i = 1; i < t.length; i++) {
    if (distance > t[i].distance) continue;
    const prev = t[i - 1];
    const f = (distance - prev.distance) / (t[i].distance - prev.distance);
    return prev.pitch + (t[i].pitch - prev.pitch) * f;
  }
  return t[t.length - 1].pitch;
}

/* The camera looks along +y (screen up) from behind and above its target, so
   the ground it covers is a trapezoid: narrow at the bottom of the screen,
   wide at the top, with the target below the middle. */
export function cameraQuad(x, y, distance = DEFAULT_DISTANCE) {
  const pitch = rad(pitchFor(distance));
  const tanV = Math.tan(rad(FOV_DEG) / 2);
  const tanH = tanV * SCREEN_ASPECT;
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const height = distance * sin;
  const toTarget = distance * cos;
  /* The ray to the bottom (v = -1) or top (v = 1) edge of the screen leaves the
     camera along forward + v * tanV * up, and covers `t` before it hits the
     ground. Its horizontal spread grows with that same t, which is why the far
     edge is the wide one. Pitches only ever come from the zoom table, so the
     top ray always points below the horizon and t stays positive. */
  const edge = (v) => {
    const t = height / (sin - v * tanV * cos);
    return { dy: t * (cos + v * tanV * sin) - toTarget, w: t * tanH };
  };
  const near = edge(-1);
  const far = edge(1);
  return [
    [x - near.w, y + near.dy],
    [x + near.w, y + near.dy],
    [x + far.w, y + far.dy],
    [x - far.w, y + far.dy],
  ];
}

export function cameraAt(p, loop) {
  const cam = p.camera;
  if (!cam || !cam.length || cam[0].loop > loop) return null;
  let lo = 0;
  let hi = cam.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cam[mid].loop <= loop) lo = mid;
    else hi = mid - 1;
  }
  const a = cam[lo];
  const b = cam[lo + 1];
  if (!b || b.loop - a.loop > JUMP_LOOPS || Math.hypot(b.x - a.x, b.y - a.y) > JUMP_DIST) return a;
  const f = (loop - a.loop) / (b.loop - a.loop);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, d: a.d };
}
