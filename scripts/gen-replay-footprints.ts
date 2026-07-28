// Builds the replay viewer's structure footprint table and unit sight data.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { GAMEDATA_DIR, SITE_STATIC } from "./lib/paths.ts";
import { attr } from "./lib/catalog-xml.ts";

type Shape = { rings: [number, number][][]; r: number };
type FootprintDef = { parent?: string; shape?: Shape };
type UnitDef = { parent?: string; footprint?: string; sight?: number; visionHeight?: number; speed?: number };

// Unit ids the replay tracker reports as team structures.
const STRUCTURE_ID_RE =
  /^(Town|Kings|VolskayaMechanic|BossDuel)?(TownHall|Wall|Gate|CannonTower|Moonwell|Core|KingsCore)/;

// Sight is emitted for every unit with a radius, not just structures.
const NO_SIGHT_ID_RE = /Missile|Dummy/i;

// <Shape> stores vertices in `Offsets` and edges in `Borders`.
function parseShape(body: string): Shape | null {
  const shapeBody = /<Shape>([\s\S]*?)<\/Shape>/.exec(body)?.[1];
  if (!shapeBody) return null;
  const offsets = /<Offsets\s+value="([^"]*)"/.exec(shapeBody)?.[1];
  const borders = /<Borders\s+value="([^"]*)"/.exec(shapeBody)?.[1];
  if (!offsets || !borders) return null;
  const verts = offsets
    .split(";")
    .filter(Boolean)
    .map((pair) => pair.split(",").map(Number) as [number, number]);
  const next = new Map<number, number>();
  for (const edge of borders.split(";").filter(Boolean)) {
    const [from, to] = edge.split(",").map(Number);
    if (Number.isInteger(from) && Number.isInteger(to)) next.set(from, to);
  }
  const seen = new Set<number>();
  const rings: [number, number][][] = [];
  for (let start = 0; start < verts.length; start++) {
    if (seen.has(start) || !next.has(start)) continue;
    const ring: [number, number][] = [];
    for (let v: number | undefined = start; v !== undefined && !seen.has(v); v = next.get(v)) {
      seen.add(v);
      if (verts[v]) ring.push(verts[v]);
    }
    if (ring.length >= 3) rings.push(ring);
  }
  if (!rings.length) return null;
  const r = Number(/<Radius\s+value="([\d.]+)"/.exec(shapeBody)?.[1] ?? 0);
  return { rings, r };
}

async function* xmlFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* xmlFiles(full);
    else if (entry.name.toLowerCase().endsWith(".xml")) yield full;
  }
}

// Base data first so shared ids resolve consistently across maps.
function scanOrder(files: string[]) {
  const rank = (f: string) => (f.includes("heroesdata.stormmod") ? 0 : f.includes("core.stormmod") ? 1 : 2);
  return [...files].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

async function main() {
  console.log("gen-replay-footprints: starting");
  const footprints = new Map<string, FootprintDef>();
  const units = new Map<string, UnitDef>();

  const all: string[] = [];
  for await (const file of xmlFiles(GAMEDATA_DIR)) all.push(file);

  for (const file of scanOrder(all)) {
    const xml = await readFile(file, "utf-8");
    if (!xml.includes("<CFootprint") && !xml.includes("<CUnit")) continue;
    for (const m of xml.matchAll(/<CFootprint\b([^>]*?)(\/>|>([\s\S]*?)<\/CFootprint>)/g)) {
      const id = attr(m[1], "id");
      if (!id || footprints.has(id)) continue;
      const parent = attr(m[1], "parent") ?? undefined;
      const shape = parseShape(m[3] ?? "") ?? undefined;
      footprints.set(id, { parent, shape });
    }
    for (const m of xml.matchAll(/<CUnit\b([^>]*?)(\/>|>([\s\S]*?)<\/CUnit>)/g)) {
      const id = attr(m[1], "id");
      if (!id || units.has(id)) continue;
      const parent = attr(m[1], "parent") ?? undefined;
      const footprint = /<Footprint\s+value="([^"]+)"/.exec(m[3] ?? "")?.[1];
      const sight = /<Sight\s+value="([\d.]+)"/.exec(m[3] ?? "")?.[1];
      const visionHeight = /<VisionHeight\s+value="([\d.]+)"/.exec(m[3] ?? "")?.[1];
      const speed = /<Speed\s+value="([\d.]+)"/.exec(m[3] ?? "")?.[1];
      units.set(id, {
        parent,
        footprint,
        sight: sight === undefined ? undefined : Number(sight),
        visionHeight: visionHeight === undefined ? undefined : Number(visionHeight),
        speed: speed === undefined ? undefined : Number(speed),
      });
    }
  }

  const inherited = <T, V>(table: Map<string, T & { parent?: string }>, id: string, pick: (e: T) => V | undefined) => {
    const seen = new Set<string>();
    for (let cur: string | undefined = id; cur && !seen.has(cur); cur = table.get(cur)?.parent) {
      seen.add(cur);
      const entry = table.get(cur);
      if (!entry) return undefined;
      const value = pick(entry);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  const shapes: Shape[] = [];
  const shapeIndex = new Map<string, number>();
  const unitToShape: Record<string, number> = {};
  const unitToSight: Record<string, number> = {};
  const unitToFlying: Record<string, true> = {};
  const unitToSpeed: Record<string, number> = {};
  let missing = 0;
  let missingSight = 0;

  for (const id of [...units.keys()].sort()) {
    if (/Destroyed/.test(id)) continue;
    if (!NO_SIGHT_ID_RE.test(id)) {
      const sight = inherited(units, id, (u) => u.sight);
      if (sight === undefined) missingSight++;
      else unitToSight[id] = sight;
      if ((inherited(units, id, (u) => u.visionHeight) ?? 0) > 0) unitToFlying[id] = true;
      const speed = inherited(units, id, (u) => u.speed);
      if (speed !== undefined && speed > 0) unitToSpeed[id] = speed;
    }
    if (!STRUCTURE_ID_RE.test(id)) continue;
    const fpId = inherited(units, id, (u) => u.footprint);
    const shape = fpId ? inherited(footprints, fpId, (f) => f.shape) : undefined;
    if (!shape) {
      missing++;
      continue;
    }
    const key = JSON.stringify(shape);
    let index = shapeIndex.get(key);
    if (index === undefined) {
      index = shapes.length;
      shapes.push(shape);
      shapeIndex.set(key, index);
    }
    unitToShape[id] = index;
  }

  const out = path.join(SITE_STATIC, "replay", "footprints.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(
    out,
    JSON.stringify({ shapes, units: unitToShape, sight: unitToSight, flying: unitToFlying, speed: unitToSpeed }),
    "utf-8"
  );
  console.log(
    `gen-replay-footprints: ${Object.keys(unitToShape).length} unit types over ${shapes.length} shapes (${missing} without a footprint shape), ` +
      `${Object.keys(unitToSight).length} with a sight radius (${missingSight} without), ` +
      `${Object.keys(unitToFlying).length} that see over terrain, ` +
      `${Object.keys(unitToSpeed).length} with a move speed`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
