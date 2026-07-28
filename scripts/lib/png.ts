import zlib from "node:zlib";

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, row 0 at the top. */
  rgba: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Truecolor PNG, no alpha channel: the bitmaps here are always opaque. */
export function encodePng({ width, height, rgba }: Bitmap): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[p++] = rgba[i]!;
      raw[p++] = rgba[i + 1]!;
      raw[p++] = rgba[i + 2]!;
    }
  }

  const chunks = [Buffer.from("\x89PNG\r\n\x1a\n", "latin1")];
  const chunk = (tag: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const payload = Buffer.concat([Buffer.from(tag, "latin1"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(payload));
    chunks.push(len, payload, crc);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  chunk("IHDR", ihdr);
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 }));
  chunk("IEND", Buffer.alloc(0));
  return Buffer.concat(chunks);
}
