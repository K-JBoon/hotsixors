// Minimal DDS reader for the texture formats Blizzard ships the UI icons in:
// uncompressed B8G8R8A8, A8L8, DXT1 and DXT5.

import type { Bitmap } from "./png.ts";

const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_LUMINANCE = 0x20000;

interface PixelFormat {
  flags: number;
  fourCC: string;
  rgbBitCount: number;
  masks: [number, number, number, number];
}

function maskShift(mask: number): { shift: number; scale: number } {
  if (!mask) return { shift: 0, scale: 0 };
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift++;
  const bits = ((mask >>> shift) >>> 0).toString(2).length;
  return { shift, scale: 255 / ((1 << bits) - 1) };
}

function decodeUncompressed(
  data: Buffer,
  width: number,
  height: number,
  pf: PixelFormat
): Uint8Array {
  const bytes = pf.rgbBitCount / 8;
  const [rm, gm, bm, am] = pf.masks;
  const ch = [rm, gm, bm, am].map(maskShift);
  const luminance = (pf.flags & DDPF_LUMINANCE) !== 0;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let px = 0;
    for (let b = 0; b < bytes; b++) px |= data[i * bytes + b]! << (b * 8);
    px >>>= 0;
    const r = Math.round(((px & rm) >>> ch[0]!.shift) * ch[0]!.scale);
    const g = luminance ? r : Math.round(((px & gm) >>> ch[1]!.shift) * ch[1]!.scale);
    const b = luminance ? r : Math.round(((px & bm) >>> ch[2]!.shift) * ch[2]!.scale);
    const a = am ? Math.round(((px & am) >>> ch[3]!.shift) * ch[3]!.scale) : 255;
    rgba.set([r, g, b, a], i * 4);
  }
  return rgba;
}

function colorTable(block: Buffer, offset: number, dxt1: boolean): number[][] {
  const c0 = block.readUInt16LE(offset);
  const c1 = block.readUInt16LE(offset + 2);
  const rgb = (c: number) => [
    Math.round((((c >> 11) & 0x1f) * 255) / 31),
    Math.round((((c >> 5) & 0x3f) * 255) / 63),
    Math.round(((c & 0x1f) * 255) / 31),
  ];
  const [r0, g0, b0] = rgb(c0) as [number, number, number];
  const [r1, g1, b1] = rgb(c1) as [number, number, number];
  if (dxt1 && c0 <= c1) {
    return [
      [r0, g0, b0, 255],
      [r1, g1, b1, 255],
      [(r0 + r1) >> 1, (g0 + g1) >> 1, (b0 + b1) >> 1, 255],
      [0, 0, 0, 0],
    ];
  }
  const mix = (a: number, b: number, w: number) => Math.round((a * w + b * (3 - w)) / 3);
  return [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    [mix(r0, r1, 2), mix(g0, g1, 2), mix(b0, b1, 2), 255],
    [mix(r0, r1, 1), mix(g0, g1, 1), mix(b0, b1, 1), 255],
  ];
}

function alphaTable(a0: number, a1: number): number[] {
  const table = [a0, a1];
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) table.push(Math.round((a0 * (7 - i) + a1 * i) / 7));
  } else {
    for (let i = 1; i < 5; i++) table.push(Math.round((a0 * (5 - i) + a1 * i) / 5));
    table.push(0, 255);
  }
  return table;
}

function decodeBlocks(
  data: Buffer,
  width: number,
  height: number,
  dxt5: boolean
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const blockBytes = dxt5 ? 16 : 8;
  const cols = Math.ceil(width / 4);
  const rows = Math.ceil(height / 4);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const off = (by * cols + bx) * blockBytes;
      const colors = colorTable(data, off + (dxt5 ? 8 : 0), !dxt5);
      const bits = data.readUInt32LE(off + (dxt5 ? 12 : 4));
      let alphas: number[] | null = null;
      let alphaBits = 0n;
      if (dxt5) {
        alphas = alphaTable(data[off]!, data[off + 1]!);
        for (let i = 7; i >= 2; i--) alphaBits = (alphaBits << 8n) | BigInt(data[off + i]!);
      }
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const i = py * 4 + px;
          const color = colors[(bits >>> (i * 2)) & 3]!;
          const a = alphas ? alphas[Number((alphaBits >> BigInt(i * 3)) & 7n)]! : color[3]!;
          rgba.set([color[0]!, color[1]!, color[2]!, a], (y * width + x) * 4);
        }
      }
    }
  }
  return rgba;
}

export function decodeDds(buf: Buffer): Bitmap {
  if (buf.subarray(0, 4).toString("latin1") !== "DDS ") throw new Error("not a DDS file");
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const pf: PixelFormat = {
    flags: buf.readUInt32LE(80),
    fourCC: buf.subarray(84, 88).toString("latin1"),
    rgbBitCount: buf.readUInt32LE(88),
    masks: [
      buf.readUInt32LE(92),
      buf.readUInt32LE(96),
      buf.readUInt32LE(100),
      buf.readUInt32LE(104),
    ],
  };
  const data = buf.subarray(128);

  if (pf.flags & DDPF_FOURCC) {
    if (pf.fourCC === "DXT1") return { width, height, rgba: decodeBlocks(data, width, height, false) };
    if (pf.fourCC === "DXT5") return { width, height, rgba: decodeBlocks(data, width, height, true) };
    throw new Error(`unsupported DDS fourCC ${pf.fourCC}`);
  }
  if (pf.flags & (DDPF_RGB | DDPF_LUMINANCE | DDPF_ALPHAPIXELS)) {
    return { width, height, rgba: decodeUncompressed(data, width, height, pf) };
  }
  throw new Error(`unsupported DDS pixel format flags ${pf.flags}`);
}
