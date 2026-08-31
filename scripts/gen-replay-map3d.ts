// Renders the replay viewer's 3D map plates from the Lost in the Nexus assets.
//
// Per map: a top-down orthographic PNG of the terrain and doodads with every
// building left out, a list of where those buildings stand, and one sprite per
// building model. The viewer pastes the sprites over the plate and drops each
// one when the replay says the structure died.

import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { stat } from "node:fs/promises";
import puppeteer from "puppeteer";

import { SITE_STATIC, SITE_STATIC_REPLAY } from "./lib/paths.ts";

declare global {
  interface Window {
    nexusRender: {
      map(slug: string, rect: Rect, options: { pxPerUnit: number }): Promise<string | null>;
      sprite(name: string, options: Record<string, unknown>): Promise<SpriteShot | null>;
    };
  }
}

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface SpriteShot {
  png: string;
  w: number;
  h: number;
  worldW: number;
  worldH: number;
  anchorX: number;
  anchorY: number;
}

const PLATE_DIR = join(SITE_STATIC_REPLAY, "plates");
const PLATE_INDEX = join(PLATE_DIR, "index.json");

/** Plate pixels per game unit. The viewer draws a fit map at about 4.7 and zooms to 8x. */
const PLATE_SCALE = Number(process.env.PLATE_SCALE) || 16;
/** Sprite pixels per game unit, and the angle they are pitched at. */
const SPRITE_SCALE = 26;
const SPRITE_PITCH = 60;
/** WebP keeps a battleground's plate and its sprites near two megabytes. */
const FORMAT = "image/webp";
const PLATE_QUALITY = Number(process.env.PLATE_QUALITY) || 0.82;
const SPRITE_QUALITY = 0.9;

interface Instance {
  m: string;
  x: number;
  y: number;
  z: number;
  r?: number;
  s?: number;
  t?: number;
  sprite?: string;
}

/** Distinct picture per model, yaw, scale and team. */
function spriteKey(item: Instance) {
  const yaw = Math.round(((item.r || 0) * 180) / Math.PI);
  return `${item.m}.y${yaw}.s${Math.round((item.s || 1) * 100)}.t${item.t ?? "x"}`;
}

interface SpriteEntry {
  w: number;
  h: number;
  worldW: number;
  worldH: number;
  anchorX: number;
  anchorY: number;
  file: string;
  [key: string]: unknown;
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".bin": "application/octet-stream",
  ".gltf": "model/gltf+json",
  ".dds": "application/octet-stream",
};

function serveStatic(root: string) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const file = join(root, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(root) || !existsSync(file) || !(await stat(file)).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

const decodeImage = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const slugs = process.argv.slice(2);
  if (!slugs.length) {
    console.error("usage: tsx scripts/gen-replay-map3d.ts <slug> [slug...]");
    process.exitCode = 1;
    return;
  }

  const maps = await readJson<Record<string, { slug: string; mapWidth: number; mapHeight: number }>>(
    join(SITE_STATIC_REPLAY, "maps.json"),
    {},
  );
  const bySlug = new Map(Object.values(maps).map((entry) => [entry.slug, entry]));

  await mkdir(PLATE_DIR, { recursive: true });
  // The viewer reads this to know which maps have a plate to paste.
  const rendered = new Set(await readJson<string[]>(PLATE_INDEX, []));

  const site = await serveStatic(SITE_STATIC);
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
    ],
  });
  const page = await browser.newPage();
  page.on("pageerror", (error: unknown) => console.error("page:", String(error)));
  await page.setViewport({ width: 960, height: 720 });

  try {
    for (const slug of slugs) {
      try {
        const meta = bySlug.get(slug);
        if (!meta) {
          console.error(`gen-replay-map3d: ${slug} is not in maps.json`);
          continue;
        }
        const placedFile = join(SITE_STATIC, "lost-in-the-nexus/maps3d", `${slug}.json`);
        if (!existsSync(placedFile)) {
          console.error(`gen-replay-map3d: ${slug} has no 3D conversion`);
          continue;
        }

        // A fresh page per map: model caches and animation mixers pile up.
        await page.goto(`http://127.0.0.1:${site.port}/lost-in-the-nexus/render.html`, { waitUntil: "load" });
        await page.waitForFunction("window.nexusReady === true", { timeout: 120_000 });

        const rect = { minX: 0, minY: 0, maxX: meta.mapWidth, maxY: meta.mapHeight };
        const plate = await page.evaluate(
          (s, r, options) => window.nexusRender.map(s, r, options),
          slug,
          rect,
          { pxPerUnit: PLATE_SCALE, format: FORMAT, quality: PLATE_QUALITY },
        );
        if (!plate) {
          console.error(`gen-replay-map3d: ${slug} failed to load`);
          continue;
        }
        await writeFile(join(PLATE_DIR, `${slug}.webp`), decodeImage(plate));

        const placed = JSON.parse(await readFile(placedFile, "utf-8")) as { instances: Instance[] };
        const buildings = placed.instances.filter((item) => item.m.startsWith("storm_building_"));

        // One sprite per distinct model, yaw, scale and team: two towers facing
        // different ways are different pictures, and 60 buildings collapse to ~48.
        const spriteDir = join(PLATE_DIR, slug);
        await mkdir(spriteDir, { recursive: true });
        const sprites = new Map<string, SpriteEntry>();
        for (const item of buildings) {
          const key = spriteKey(item);
          item.sprite = key;
          if (sprites.has(key)) continue;
          const sprite = await page.evaluate(
            (n, options) => window.nexusRender.sprite(n, options),
            item.m,
            { pxPerUnit: SPRITE_SCALE, pitch: SPRITE_PITCH, r: item.r || 0, s: item.s || 0, team: item.t, format: FORMAT, quality: SPRITE_QUALITY },
          );
          if (!sprite) {
            console.error(`gen-replay-map3d: no model for ${item.m}`);
            continue;
          }
          await writeFile(join(spriteDir, `${key}.webp`), decodeImage(sprite.png));
          sprites.set(key, {
            w: sprite.w,
            h: sprite.h,
            worldW: sprite.worldW,
            worldH: sprite.worldH,
            anchorX: sprite.anchorX,
            anchorY: sprite.anchorY,
            file: `/replay/plates/${slug}/${key}.webp`,
          });
        }

        await writeFile(
          join(PLATE_DIR, `${slug}.json`),
          JSON.stringify({ scale: PLATE_SCALE, pitch: SPRITE_PITCH, sprites: Object.fromEntries(sprites), buildings }, null, 1),
          "utf-8",
        );
        rendered.add(slug);
        await writeFile(PLATE_INDEX, JSON.stringify([...rendered].sort(), null, 1), "utf-8");
        console.log(`gen-replay-map3d: ${slug}, ${buildings.length} buildings, ${sprites.size} sprites`);
      } catch (error) {
        console.error(`gen-replay-map3d: ${slug} failed:`, error);
      }
    }
  } finally {
    await browser.close();
    await site.close();
  }

  await writeFile(PLATE_INDEX, JSON.stringify([...rendered].sort(), null, 1), "utf-8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
