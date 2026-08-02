// Renders the replay viewer's minimaps from packaged .stormmap files.
//
// Per map: a schematic PNG at 2 px per game unit, a 1 px per cell mask the
// viewer ray-casts sight lines and routes walking units against, and an entry
// in maps.json carrying the map rect, camera bounds, lane waypoints and the
// regions each team permanently sees.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

import { MPQArchive } from "../site/static/replay/mpq.js";
import { encodePng, type Bitmap } from "./lib/png.ts";
import { S2MA_MAPS_DIR, SITE_STATIC_REPLAY, slugify } from "./lib/paths.ts";
import {
  baseRegions,
  brushMask,
  lanePaths,
  loadBaseDoodadActors,
  localizedMapNames,
  parseMapInfo,
  previewAccent,
  readMember,
  terrainHeights,
  type BaseRegions,
  type CameraBounds,
  type HeightField,
  type LanePath,
} from "./lib/stormmap.ts";

const OUT_DIR = join(SITE_STATIC_REPLAY, "maps");

/** Schematic pixels per game unit. The viewer reads this back out of maps.json. */
const IMAGE_SCALE = 4;

interface MapEntry {
  slug: string;
  image: string;
  imageScale: number;
  vision: string;
  hash: string; // sha256, matching the replay's s2ma cache handles
  names: string[]; // DocInfo/Name per locale
  mapWidth: number;
  mapHeight: number;
  camera: CameraBounds | null;
  lanes: LanePath[];
  baseVision: BaseRegions | null;
}

/** Cell grids the renderers work from. Each is mapW*mapH bytes, 0 = clear. */
interface Grids {
  pnp: Uint8Array;
  pcl: Uint8Array | null;
  vbl: Uint8Array | null;
  brush: Uint8Array | null;
  height: HeightField | null;
  accent: [number, number, number] | null;
  mapW: number;
  mapH: number;
}

// --------------------------------------------------------------- rendering

const SCHEME = {
  void: [15, 8, 19], // unpathable and vision-blocking: walls, cliffs
  voidLip: [31, 24, 38], // the first cells in from that mass, so it is not a flat silhouette
  low: [43, 36, 51], // unpathable but see-through: fences, water
  ground: [82, 76, 89],
  groundLit: [101, 94, 109], // pathable cell out in the open
  bush: [76, 118, 65],
  outline: [5, 0, 7],
};

/** How far the map's own art colour is allowed to pull each tone. */
const ACCENT_STRENGTH = {
  ground: 0.15,
  wall: 0.3,
  bush: 0.08,
};

/** Pathable only when neither grid blocks the cell. */
const pathableAt = (g: Grids, cx: number, cy: number) =>
  cx >= 0 &&
  cy >= 0 &&
  cx < g.mapW &&
  cy < g.mapH &&
  g.pnp[cy * g.mapW + cx] === 0 &&
  (!g.pcl || g.pcl[cy * g.mapW + cx] === 0);

const visionBlockedAt = (g: Grids, cx: number, cy: number) =>
  g.vbl ? g.vbl[cy * g.mapW + cx] !== 0 : false;

/** Shrub footprints, plus vision blockers painted over walkable ground. */
const concealedAt = (g: Grids, cx: number, cy: number) =>
  (g.brush && g.brush[cy * g.mapW + cx] !== 0) || visionBlockedAt(g, cx, cy);

const mix = (a: number[], b: number[], t: number) => [
  a[0]! + (b[0]! - a[0]!) * t,
  a[1]! + (b[1]! - a[1]!) * t,
  a[2]! + (b[2]! - a[2]!) * t,
];

/**
 * Rescales each channel towards the accent's own channel ratios, which shifts
 * the hue without moving the tone's brightness far.
 */
function tinted(base: number[], accent: [number, number, number] | null, amount: number): number[] {
  if (!accent) return base;
  const peak = Math.max(...accent) || 1;
  return base.map((c, i) => c * (1 - amount) + c * (accent[i]! / peak) * amount * 1.6);
}

/**
 * Cell distance from every seed cell, spreading only through cells `pass`
 * accepts. Cells the flood never reaches keep Infinity.
 */
function distanceField(
  g: Grids,
  seed: (cx: number, cy: number) => boolean,
  pass: (cx: number, cy: number) => boolean
): Float32Array {
  const dist = new Float32Array(g.mapW * g.mapH).fill(Infinity);
  let front: number[] = [];
  for (let i = 0; i < dist.length; i++) {
    if (seed(i % g.mapW, Math.floor(i / g.mapW))) {
      dist[i] = 0;
      front.push(i);
    }
  }
  while (front.length) {
    const next: number[] = [];
    for (const i of front) {
      const cx = i % g.mapW;
      const cy = Math.floor(i / g.mapW);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= g.mapW || ny >= g.mapH) continue;
        const ni = ny * g.mapW + nx;
        if (dist[ni] !== Infinity || !pass(nx, ny)) continue;
        dist[ni] = dist[i]! + 1;
        next.push(ni);
      }
    }
    front = next;
  }
  return dist;
}

function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Three octaves, centred on zero. */
const fbm = (x: number, y: number) =>
  valueNoise(x, y) * 0.6 + valueNoise(x * 2.3, y * 2.3) * 0.3 + valueNoise(x * 5.1, y * 5.1) * 0.1 - 0.5;

// Everything is lit from the top left, both the hillshade and the cast shadows.
const LIGHT = [-0.55, 0.55, 0.63];
const LIGHT_LEN = Math.hypot(...LIGHT);

function heightAt(h: HeightField, wx: number, wy: number): number {
  const x = Math.min(h.vw - 2, Math.max(0, Math.floor(wx)));
  const y = Math.min(h.vh - 2, Math.max(0, Math.floor(wy)));
  const tx = wx - x;
  const ty = wy - y;
  const top = h.verts[y * h.vw + x]! * (1 - tx) + h.verts[y * h.vw + x + 1]! * tx;
  const bottom = h.verts[(y + 1) * h.vw + x]! * (1 - tx) + h.verts[(y + 1) * h.vw + x + 1]! * tx;
  return top * (1 - ty) + bottom * ty;
}

/** -1..1 relief from the real terrain, zero on flat ground. */
function hillshade(h: HeightField | null, wx: number, wy: number): number {
  if (!h) return 0;
  const dzdx = heightAt(h, wx + 0.5, wy) - heightAt(h, wx - 0.5, wy);
  const dzdy = heightAt(h, wx, wy + 0.5) - heightAt(h, wx, wy - 0.5);
  const normal = [-dzdx, -dzdy, 1];
  const dot =
    (normal[0]! * LIGHT[0]! + normal[1]! * LIGHT[1]! + normal[2]! * LIGHT[2]!) /
    (Math.hypot(...normal) * LIGHT_LEN);
  return Math.max(-1, Math.min(1, (dot - LIGHT[2]! / LIGHT_LEN) * 2.2));
}

const AO_REACH = 2; // cells of ground darkening alongside a wall
const SHADOW_REACH = 2.2; // cells a wall throws its shadow across the ground
const SHADOW_STEPS = 7;

/**
 * The map as terrain rather than a flat mask: ground darkens into corners and
 * under the shadow walls cast, wall masses carry a lip and the terrain's own
 * relief, and the whole palette leans on the map's art colour.
 */
function renderSchematic(g: Grids): Bitmap {
  const walkable = (cx: number, cy: number) => pathableAt(g, cx, cy);
  const openness = distanceField(g, (cx, cy) => !walkable(cx, cy), walkable);
  const wallDepth = distanceField(g, walkable, (cx, cy) => !walkable(cx, cy));

  const accent = g.accent;
  const pal = {
    ground: tinted(SCHEME.ground, accent, ACCENT_STRENGTH.ground),
    groundLit: tinted(SCHEME.groundLit, accent, ACCENT_STRENGTH.ground),
    void: tinted(SCHEME.void, accent, ACCENT_STRENGTH.wall),
    voidLip: tinted(SCHEME.voidLip, accent, ACCENT_STRENGTH.wall),
    low: tinted(SCHEME.low, accent, ACCENT_STRENGTH.wall),
    bush: tinted(SCHEME.bush, accent, ACCENT_STRENGTH.bush),
  };

  const width = g.mapW * IMAGE_SCALE;
  const height = g.mapH * IMAGE_SCALE;
  const rgba = new Uint8Array(width * height * 4);
  for (let iy = 0; iy < height; iy++) {
    const wy = g.mapH - iy / IMAGE_SCALE; // row 0 = world top
    const cy = Math.min(g.mapH - 1, Math.max(0, Math.floor(wy)));
    for (let ix = 0; ix < width; ix++) {
      const wx = ix / IMAGE_SCALE;
      const cx = Math.min(g.mapW - 1, Math.floor(wx));
      const cell = cy * g.mapW + cx;
      const relief = hillshade(g.height, wx, wy);
      const grain = fbm(wx * 0.9, wy * 0.9);

      let color: number[];
      if (walkable(cx, cy)) {
        const open = Math.min(1, (openness[cell]! - 0.2) / AO_REACH);
        const patches = fbm(wx * 0.11, wy * 0.11);
        const bush = concealedAt(g, cx, cy);
        const base = bush ? pal.bush : mix(pal.ground, pal.groundLit, 0.3 + 0.7 * open);
        color = base.map(
          (c) => c * (1 + relief * 0.22) * (1 + grain * 0.06) * (1 + patches * 0.13) * (0.84 + 0.16 * open)
        );
        let shadow = 0;
        for (let step = 1; step <= SHADOW_STEPS; step++) {
          const reach = (step / SHADOW_STEPS) * SHADOW_REACH;
          const sx = Math.floor(wx - reach * 0.75);
          const sy = Math.floor(wy + reach * 0.75);
          if (sx < 0 || sy < 0 || sx >= g.mapW || sy >= g.mapH) continue;
          if (!walkable(sx, sy)) shadow = Math.max(shadow, 1 - step / (SHADOW_STEPS + 1));
        }
        color = color.map((c) => c * (1 - shadow * 0.34));
        if (!walkable(cx + 1, cy) || !walkable(cx, cy - 1)) color = color.map((c) => c * 1.1);
        if (bush) color = color.map((c) => c * (0.86 + 0.28 * (fbm(wx * 4.5, wy * 4.5) + 0.5)));
      } else if (wallDepth[cell]! <= 1) {
        color = SCHEME.outline;
      } else {
        const inset = Math.min(1, (wallDepth[cell]! - 2) / 5);
        const body = visionBlockedAt(g, cx, cy) ? pal.void : pal.low;
        color = mix(pal.voidLip, body, inset).map((c) => c * (1 + relief * 0.4) * (1 + grain * 0.16));
      }

      const i = (iy * width + ix) * 4;
      rgba[i] = Math.max(0, Math.min(255, Math.round(color[0]!)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round(color[1]!)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round(color[2]!)));
      rgba[i + 3] = 255;
    }
  }
  return { width, height, rgba };
}

// The same grids as data instead of pixels, one pixel per cell:
//   R  hard blocker, vision-blocking terrain you cannot walk on
//   G  concealment, stops a sight line unless the viewer stands in the same
//      connected patch
//   B  unwalkable, see-through cells (fences, water, ledges) included
//
// See-through unwalkable cells carry B only and never block sight. Row 0 is
// world top, matching the schematic.
function renderVisionMask(g: Grids): Bitmap {
  const rgba = new Uint8Array(g.mapW * g.mapH * 4);
  for (let iy = 0; iy < g.mapH; iy++) {
    const cy = g.mapH - 1 - iy;
    for (let ix = 0; ix < g.mapW; ix++) {
      const pathable = pathableAt(g, ix, cy);
      const blocked = visionBlockedAt(g, ix, cy);
      const i = (iy * g.mapW + ix) * 4;
      rgba[i] = blocked && !pathable ? 255 : 0;
      rgba[i + 1] = (g.brush && g.brush[cy * g.mapW + ix] !== 0) || (blocked && pathable) ? 255 : 0;
      rgba[i + 2] = pathable ? 0 : 255;
      rgba[i + 3] = 255;
    }
  }
  return { width: g.mapW, height: g.mapH, rgba };
}

// -------------------------------------------------------------------- main

function openMap(buf: Buffer, baseActors: ReturnType<typeof loadBaseDoodadActors>) {
  const archive = new MPQArchive(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    { inflate: (d: Uint8Array) => zlib.inflateSync(d) }
  );
  const info = parseMapInfo(archive.readFile("MapInfo"));
  const pnp = archive.readFile("CellAttribute_Pnp");
  if (!pnp) throw new Error("no CellAttribute_Pnp");
  const pcl = readMember(archive, "CellAttribute_Pcl");
  const vbl = readMember(archive, "CellAttribute_Vbl");
  const grids: Grids = {
    // each grid carries a 4-byte header before the cells
    pnp: pnp.subarray(4),
    pcl: pcl ? pcl.subarray(4) : null,
    vbl: vbl ? vbl.subarray(4) : null,
    brush: brushMask(archive, baseActors, info.width, info.height),
    height: terrainHeights(archive),
    accent: previewAccent(archive),
    mapW: info.width,
    mapH: info.height,
  };
  return { archive, info, grids };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const stale of readdirSync(OUT_DIR)) unlinkSync(join(OUT_DIR, stale));

  const listing = readdirSync(S2MA_MAPS_DIR).filter((n) => n.endsWith(".stormmap"));
  const baseActors = loadBaseDoodadActors();
  const index: Record<string, MapEntry> = {};

  for (const file of listing) {
    const name = file.replace(/\.stormmap$/, "");
    const slug = slugify(name);
    try {
      const buf = readFileSync(join(S2MA_MAPS_DIR, file));
      const { archive, info, grids } = openMap(buf, baseActors);
      const image = renderSchematic(grids);
      writeFileSync(join(OUT_DIR, `${slug}.png`), encodePng(image));
      writeFileSync(join(OUT_DIR, `${slug}.vision.png`), encodePng(renderVisionMask(grids)));

      const entry: MapEntry = {
        slug,
        image: `/replay/maps/${slug}.png`,
        imageScale: IMAGE_SCALE,
        vision: `/replay/maps/${slug}.vision.png`,
        hash: createHash("sha256").update(buf).digest("hex"),
        names: localizedMapNames(archive),
        // image pixel for world (x,y): px = x*imageScale, py = (mapHeight-y)*imageScale
        mapWidth: info.width,
        mapHeight: info.height,
        camera: info.camera, // playable subrect, null = full map
        lanes: lanePaths(archive), // minion waypoint chains in walking order
        // the viewer matches a side to a team by whose Hall of Storms sits in it
        baseVision: baseRegions(archive),
      };
      index[name] = entry;

      const camera = info.camera
        ? `${info.camera.left},${info.camera.bottom}..${info.camera.right},${info.camera.top}`
        : "none";
      const base = entry.baseVision;
      console.log(
        `${name}: ${image.width}x${image.height}, map ${info.width}x${info.height}, ` +
          `camera ${camera}, lanes ${entry.lanes.map((l) => l.length).join("/") || "none"}, ` +
          `base vision ${base ? `${(base.order || []).length}/${(base.chaos || []).length} shapes` : "none"}`
      );
    } catch (err) {
      console.error(`${name} FAILED: ${(err as Error).message}`);
    }
  }

  writeFileSync(join(OUT_DIR, "..", "maps.json"), JSON.stringify(index, null, 1));
  console.log(`\nwrote ${Object.keys(index).length} maps to ${OUT_DIR}`);
}

await main();
