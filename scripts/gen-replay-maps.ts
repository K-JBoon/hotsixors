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
  readMember,
  type BaseRegions,
  type CameraBounds,
  type LanePath,
} from "./lib/stormmap.ts";

const OUT_DIR = join(SITE_STATIC_REPLAY, "maps");

interface MapEntry {
  slug: string;
  image: string;
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
  mapW: number;
  mapH: number;
}

// --------------------------------------------------------------- rendering

const SCHEME = {
  void: [15, 8, 19], // unpathable and vision-blocking: walls, cliffs
  low: [43, 36, 51], // unpathable but see-through: fences, water
  ground: [93, 86, 101],
  groundShade: [77, 70, 85], // pathable cell hugging a wall
  bush: [83, 130, 71],
  outline: [5, 0, 7],
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

/** True when any of the four orthogonal neighbours is pathable. */
const touchesPath = (g: Grids, cx: number, cy: number) =>
  pathableAt(g, cx + 1, cy) ||
  pathableAt(g, cx - 1, cy) ||
  pathableAt(g, cx, cy + 1) ||
  pathableAt(g, cx, cy - 1);

/** True when any of the four orthogonal neighbours blocks. */
const touchesWall = (g: Grids, cx: number, cy: number) =>
  !pathableAt(g, cx + 1, cy) ||
  !pathableAt(g, cx - 1, cy) ||
  !pathableAt(g, cx, cy + 1) ||
  !pathableAt(g, cx, cy - 1);

function schematicColor(g: Grids, cx: number, cy: number): number[] {
  if (pathableAt(g, cx, cy)) {
    const shaded = touchesWall(g, cx, cy);
    if (concealedAt(g, cx, cy)) {
      return shaded ? SCHEME.bush.map((c) => Math.round(c * 0.85)) : SCHEME.bush;
    }
    return shaded ? SCHEME.groundShade : SCHEME.ground;
  }
  if (touchesPath(g, cx, cy)) return SCHEME.outline;
  return visionBlockedAt(g, cx, cy) ? SCHEME.void : SCHEME.low;
}

function renderSchematic(g: Grids): Bitmap {
  const width = g.mapW * 2;
  const height = g.mapH * 2;
  const rgba = new Uint8Array(width * height * 4);
  for (let iy = 0; iy < height; iy++) {
    const cy = g.mapH - 1 - Math.floor(iy / 2); // row 0 = world top
    for (let ix = 0; ix < width; ix++) {
      const color = schematicColor(g, Math.floor(ix / 2), cy);
      const i = (iy * width + ix) * 4;
      rgba[i] = color[0]!;
      rgba[i + 1] = color[1]!;
      rgba[i + 2] = color[2]!;
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
        vision: `/replay/maps/${slug}.vision.png`,
        hash: createHash("sha256").update(buf).digest("hex"),
        names: localizedMapNames(archive),
        // image pixel for world (x,y): px = x*2, py = (mapHeight-y)*2
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
