import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import subsetFont from "subset-font";
import { SITE_STATIC, SITE_SASS, FONT_SOURCES } from "./lib/paths.ts";

const OUT_DIR = path.join(SITE_STATIC, "fonts");

interface Face {
  file: string;
  chars: string;
  weight: number;
}

/** Each @font-face names the file it needs and the codepoints it claims. */
function readFaces(css: string): Face[] {
  return [...css.matchAll(/@font-face \{[^}]*\}/g)].map(([face]) => {
    const file = face.match(/url\("\/fonts\/([^"]+)"\)/)?.[1];
    const range = face.match(/unicode-range:\s*([^;]+);/)?.[1];
    const weight = face.match(/font-weight:\s*(\d+)/)?.[1];
    if (!file || !range || !weight) throw new Error(`@font-face is missing file, range or weight:\n${face}`);
    return { file, chars: expandRange(range), weight: Number(weight) };
  });
}

function expandRange(range: string): string {
  const chars: string[] = [];
  for (const part of range.split(",")) {
    const [from, to] = part.trim().replace(/^U\+/i, "").split("-");
    const first = parseInt(from, 16);
    const last = to ? parseInt(to, 16) : first;
    for (let point = first; point <= last; point++) chars.push(String.fromCodePoint(point));
  }
  return chars.join("");
}

const faces = readFaces(await readFile(path.join(SITE_SASS, "main.scss"), "utf-8"));
const sources = new Set(await readdir(FONT_SOURCES));

await mkdir(OUT_DIR, { recursive: true });

for (const face of faces) {
  if (!sources.has(face.file)) throw new Error(`No source font for ${face.file} in ${FONT_SOURCES}`);
  const input = await readFile(path.join(FONT_SOURCES, face.file));
  // A variable source carries every weight; pin it to the one this face
  // declares. Static sources have no wght axis and subset as they are.
  const output = await subsetFont(input, face.chars, {
    targetFormat: "woff2",
    variationAxes: { wght: face.weight },
  }).catch(() => subsetFont(input, face.chars, { targetFormat: "woff2" }));
  await writeFile(path.join(OUT_DIR, face.file), output);
  console.log(`${face.file}: ${(input.length / 1024).toFixed(1)} KB -> ${(output.length / 1024).toFixed(1)} KB`);
}
