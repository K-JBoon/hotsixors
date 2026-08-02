// Reads the stormmap pieces the replay viewer needs.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { GAMEDATA_DIR } from "./paths.ts";

export interface MPQArchive {
  readFile(name: string): Uint8Array | null;
}

export interface CameraBounds {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface MapInfo {
  width: number;
  height: number;
  camera: CameraBounds | null;
}

type RegionShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number; negative?: true }
  | { kind: "circle"; x: number; y: number; r: number; negative?: true }
  | { kind: "diamond"; x: number; y: number; w: number; h: number; negative?: true };

export type BaseRegions = { order?: RegionShape[]; chaos?: RegionShape[] };

export type LanePath = [number, number][];

export function readMember(archive: MPQArchive, name: string): Uint8Array | null {
  try {
    return archive.readFile(name) || null;
  } catch {
    return null;
  }
}

function readText(archive: MPQArchive, name: string): string | null {
  const data = readMember(archive, name);
  return data ? Buffer.from(data).toString("utf8") : null;
}

const attr = (source: string, name: string) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(source)?.[1];

// ------------------------------------------------------------ map titles

const LOCALES = [
  "enUS", "deDE", "esES", "esMX", "frFR", "itIT",
  "koKR", "plPL", "ptBR", "ruRU", "zhCN", "zhTW",
];

/** Every localized DocInfo/Name for a map, English first, deduplicated. */
export function localizedMapNames(archive: MPQArchive): string[] {
  const names: string[] = [];
  for (const locale of LOCALES) {
    const text = readText(archive, `${locale}.StormData\\LocalizedData\\GameStrings.txt`);
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      const stripped = line.replace(/^﻿/, "");
      if (!stripped.startsWith("DocInfo/Name=")) continue;
      const name = stripped.slice("DocInfo/Name=".length).trim();
      if (name && !names.includes(name)) names.push(name);
      break;
    }
  }
  return names;
}

// ------------------------------------------------------------- shading data

/** Terrain heights on the vertex grid, one more vertex than cells per axis. */
export interface HeightField {
  verts: Float32Array;
  vw: number;
  vh: number;
}

/**
 * t3HeightMap is 32 header bytes then 6 bytes per vertex, of which the first
 * uint16 is the height, quantized by the factors t3Terrain.xml carries.
 */
export function terrainHeights(archive: MPQArchive): HeightField | null {
  const data = readMember(archive, "t3HeightMap");
  const xml = readText(archive, "t3Terrain.xml");
  if (!data || !xml) return null;
  const bias = Number(attr(xml, "quantizeBias"));
  const scale = Number(attr(xml, "quantizeScale"));
  if (!Number.isFinite(bias) || !Number.isFinite(scale)) return null;
  const buf = Buffer.from(data);
  const vw = buf.readUInt32LE(8);
  const vh = buf.readUInt32LE(12);
  if (buf.length < 32 + vw * vh * 6) return null;
  const verts = new Float32Array(vw * vh);
  for (let i = 0; i < verts.length; i++) verts[i] = buf.readUInt16LE(32 + i * 6) * scale + bias;
  return { verts, vw, vh };
}

/**
 * The dominant saturated colour of the map's loading-screen art, used to tint
 * its schematic. Grey and near-black pixels are ignored so the result tracks
 * the art's theme rather than its overall brightness.
 */
export function previewAccent(archive: MPQArchive): [number, number, number] | null {
  const tga = readMember(archive, "ReplaysPreviewImage.tga");
  if (!tga) return null;
  const bytes = tga[16]! / 8;
  if (bytes < 3) return null;
  const width = tga[12]! | (tga[13]! << 8);
  const height = tga[14]! | (tga[15]! << 8);
  const start = 18 + tga[0]!;
  let r = 0, g = 0, b = 0, total = 0;
  for (let i = 0; i < width * height; i++) {
    const p = start + i * bytes;
    const pb = tga[p]!, pg = tga[p + 1]!, pr = tga[p + 2]!;
    const max = Math.max(pr, pg, pb);
    const chroma = max - Math.min(pr, pg, pb);
    if (max < 40 || chroma < 25) continue;
    const weight = chroma / 255;
    r += pr * weight;
    g += pg * weight;
    b += pb * weight;
    total += weight;
  }
  if (!total) return null;
  return [r / total, g / total, b / total];
}

// ---------------------------------------------------------------- MapInfo

export function parseMapInfo(data: Uint8Array): MapInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(0x10, true);
  const height = view.getUint32(0x14, true);
  // Scan for the first 4x u32 window that looks like camera bounds.
  let camera: CameraBounds | null = null;
  for (let off = 0x20; off + 16 <= data.length; off++) {
    const left = view.getUint32(off, true);
    const bottom = view.getUint32(off + 4, true);
    const right = view.getUint32(off + 8, true);
    const top = view.getUint32(off + 12, true);
    if (
      left <= 80 &&
      bottom <= 80 &&
      right <= width &&
      top <= height &&
      right >= width - 80 &&
      top >= height - 96 &&
      right - left >= width * 0.5 &&
      top - bottom >= height * 0.4
    ) {
      camera = { left, bottom, right, top };
      break;
    }
  }
  return { width, height, camera };
}

// ------------------------------------------------------------------- brush

// Brush is placed as curtain doodads with ShrubFootprint<n>x<n> actors.

interface DoodadActor {
  parent?: string;
  footprint?: string;
}

type ActorTable = Map<string, DoodadActor>;

function collectDoodadActors(xml: string, table: ActorTable): void {
  const re = /<CActorDoodad\b([^>]*?)(\/>|>([\s\S]*?)<\/CActorDoodad>)/g;
  for (const m of xml.matchAll(re)) {
    const id = attr(m[1]!, "id");
    if (!id) continue;
    const parent = attr(m[1]!, "parent");
    const footprint = /<Footprint\s+value="([^"]*)"/.exec(m[3] || "")?.[1];
    const entry = table.get(id) || {};
    if (parent !== undefined) entry.parent = parent;
    if (footprint !== undefined) entry.footprint = footprint;
    table.set(id, entry);
  }
}

export function loadBaseDoodadActors(): ActorTable {
  const table: ActorTable = new Map();
  for (const rel of readdirSync(GAMEDATA_DIR, { recursive: true })) {
    const file = String(rel);
    if (!/(^|[\\/])(actordata|doodadautodata)\.xml$/i.test(file)) continue;
    collectDoodadActors(readFileSync(join(GAMEDATA_DIR, file), "utf8"), table);
  }
  return table;
}

/** Footprint size in cells from the actor chain. 0 = not brush. */
function shrubSize(table: ActorTable, id: string): number {
  const seen = new Set<string>();
  for (let cur: string | undefined = id; cur && !seen.has(cur); ) {
    seen.add(cur);
    const entry = table.get(cur);
    if (!entry) return 0;
    if (entry.footprint !== undefined) {
      const m = /^ShrubFootprint(\d)x\d$/.exec(entry.footprint);
      return m ? Number(m[1]) : 0;
    }
    cur = entry.parent;
  }
  return 0;
}

export function brushMask(
  archive: MPQArchive,
  baseTable: ActorTable,
  mapW: number,
  mapH: number
): Uint8Array | null {
  const objects = readText(archive, "Objects");
  if (!objects) return null;

  const table: ActorTable = new Map(baseTable);
  for (const member of [
    "Base.StormData\\GameData\\ActorData.xml",
    "Base.StormData\\GameData\\DoodadAutoData.xml",
  ]) {
    const xml = readText(archive, member);
    if (xml) collectDoodadActors(xml, table);
  }

  const mask = new Uint8Array(mapW * mapH);
  for (const m of objects.matchAll(/<ObjectDoodad\b[^>]*>/g)) {
    const type = attr(m[0], "Type");
    const size = type ? shrubSize(table, type) : 0;
    if (!size) continue;
    const pos = attr(m[0], "Position");
    if (!pos) continue;
    const [px, py] = pos.split(",").map(Number) as [number, number];
    const x0 = size === 1 ? Math.floor(px) : Math.round(px) - size / 2;
    const y0 = size === 1 ? Math.floor(py) : Math.round(py) - size / 2;
    for (let y = Math.max(0, y0); y < Math.min(mapH, y0 + size); y++) {
      for (let x = Math.max(0, x0); x < Math.min(mapW, x0 + size); x++) {
        mask[y * mapW + x] = 1;
      }
    }
  }
  return mask;
}

// -------------------------------------------------------------- lane paths

// Minions follow waypoint chains stored as `Lane <n> - Waypoint <m>`.
const WAYPOINT_RE = /^Lane\s+(\d+)\s*-\s*Waypoint\s+(\d+)(?:_(\d+))?(?:\s*\([^)]*\))?$/i;

export function lanePaths(archive: MPQArchive): LanePath[] {
  const objects = readText(archive, "Objects");
  if (!objects) return [];

  const lanes = new Map<number, { order: number; sub: number; x: number; y: number }[]>();
  for (const m of objects.matchAll(/<ObjectPoint\b[^>]*>/g)) {
    const name = attr(m[0], "Name");
    const at = name && WAYPOINT_RE.exec(name);
    if (!at) continue;
    const pos = attr(m[0], "Position");
    if (!pos) continue;
    const [x, y] = pos.split(",").map(Number) as [number, number];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const lane = Number(at[1]);
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane)!.push({ order: Number(at[2]), sub: Number(at[3] ?? 0), x, y });
  }

  return [...lanes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, points]) =>
      points
        .sort((a, b) => a.order - b.order || a.sub - b.sub)
        .map((p): [number, number] => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])
    )
    .filter((path) => path.length >= 2);
}

// ------------------------------------------------------------ base regions

// A team always sees its own base. Shapes stay in editor order.
const BASE_REGION_NAMES = {
  order: /^(Base Visibility Blue Team|Order Base( Region)?|Blue Team Base Region)$/i,
  chaos: /^(Base Visibility Orange Team|Chaos Base( Region)?|Chaos Team Base Region)$/i,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function regionBlock(xml: string, id: string): string | null {
  return new RegExp(`<region id="${id}">([\\s\\S]*?)</region>`).exec(xml)?.[1] || null;
}

function regionBlockByName(xml: string, re: RegExp): string | null {
  for (const m of xml.matchAll(/<region id="\d+">([\s\S]*?)<\/region>/g)) {
    const name = /<name value="([^"]*)"/.exec(m[1]!)?.[1];
    if (name && re.test(name)) return m[1]!;
  }
  return null;
}

function regionShapes(block: string): RegionShape[] {
  const shapes: RegionShape[] = [];
  for (const m of block.matchAll(/<shape type="(\w+)">([\s\S]*?)<\/shape>/g)) {
    const body = m[2]!;
    const nums = (tag: string) =>
      (new RegExp(`<${tag} value="([^"]+)"`).exec(body)?.[1] || "").split(",").map(Number);
    const negative = /<negative\s*\/>/.test(body) ? ({ negative: true } as const) : null;

    let shape: RegionShape | null = null;
    if (m[1] === "rect") {
      const [x0, y0, x1, y1] = nums("quad") as [number, number, number, number];
      if (x1 > x0 && y1 > y0) {
        shape = { kind: "rect", x: round2(x0), y: round2(y0), w: round2(x1 - x0), h: round2(y1 - y0) };
      }
    } else if (m[1] === "circle") {
      const [x, y] = nums("center") as [number, number];
      const [r] = nums("radius") as [number];
      if (r > 0) shape = { kind: "circle", x: round2(x), y: round2(y), r: round2(r) };
    } else if (m[1] === "diamond") {
      const [x, y] = nums("center") as [number, number];
      const [w] = nums("width") as [number];
      const [h] = nums("height") as [number];
      if (w > 0 && h > 0) {
        shape = { kind: "diamond", x: round2(x), y: round2(y), w: round2(w), h: round2(h) };
      }
    }
    if (shape && Number.isFinite(shape.x) && Number.isFinite(shape.y)) {
      shapes.push({ ...shape, ...negative });
    }
  }
  return shapes;
}

export function baseRegions(archive: MPQArchive): BaseRegions | null {
  const script = readText(archive, "mapscript.galaxy");
  const xml = readText(archive, "Regions");
  if (!script || !xml) return null;

  const out: BaseRegions = {};
  const re = /libCore_gv_mAP(Order|Chaos)BaseRegion = RegionFromId\((\d+)\)/g;
  for (const m of script.matchAll(re)) {
    const side = m[1]!.toLowerCase() as "order" | "chaos";
    // Arena maps assign a fresh pair per round.
    if (out[side]) continue;
    const block = regionBlock(xml, m[2]!) || regionBlockByName(xml, BASE_REGION_NAMES[side]);
    if (!block) continue;
    const shapes = regionShapes(block);
    if (shapes.length) out[side] = shapes;
  }
  return out.order || out.chaos ? out : null;
}
