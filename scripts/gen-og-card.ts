import { readFile } from "node:fs/promises";
import * as path from "node:path";
import puppeteer from "puppeteer";
import { FONT_SOURCES, SITE_STATIC } from "./lib/paths.ts";

// The fallback social card. It only changes when the name or the tagline does,
// so it is committed rather than rebuilt on every `npm run gen`.
const OUT = path.join(SITE_STATIC, "og-default.png");

const TAGLINE =
  "Heroes of the Storm data browser, replay viewer and datamining tool";

async function embed(file: string): Promise<string> {
  const font = await readFile(path.join(FONT_SOURCES, file));
  return `url(data:font/woff2;base64,${font.toString("base64")}) format('woff2')`;
}

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Rajdhani;src:${await embed("rajdhani-latin-700.woff2")};font-weight:700}
@font-face{font-family:Rajdhani;src:${await embed("rajdhani-latin-600.woff2")};font-weight:600}
@font-face{font-family:Inter;src:${await embed("inter-latin-400-500.woff2")};font-weight:400}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#0a0e1a;display:flex;flex-direction:column;
     justify-content:center;padding:0 96px;font-family:Inter,sans-serif;color:#e0e6f0;
     position:relative;overflow:hidden}
body::before{content:"";position:absolute;inset:0;
  background:radial-gradient(900px 520px at 78% 18%, rgba(74,158,255,.20), transparent 62%),
             radial-gradient(760px 480px at 12% 96%, rgba(228,184,0,.14), transparent 60%)}
.inner{position:relative}
h1{font-family:Rajdhani,sans-serif;font-weight:700;font-size:112px;line-height:1;
   letter-spacing:.06em;text-transform:uppercase;color:#e4b800}
p{margin-top:28px;font-size:34px;line-height:1.45;color:#a6b3c2;max-width:930px}
.rule{margin-top:40px;width:190px;height:5px;background:#c8961e;border-radius:3px}
.foot{position:absolute;left:96px;bottom:60px;font-family:Rajdhani,sans-serif;font-weight:600;
      font-size:26px;letter-spacing:.14em;text-transform:uppercase;color:#4a9eff}
</style>
<div class="inner"><h1>HotSixors</h1><p>${TAGLINE}</p><div class="rule"></div></div>
<div class="foot">hots.epixors.com</div>`;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT });
  console.log(`gen-og-card: wrote ${path.relative(process.cwd(), OUT)}`);
} finally {
  await browser.close();
}
