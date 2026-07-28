
class Bits {
  constructor(data) {
    this.data = data;
    this.pos = 0; // bit position
  }

  read(n) {
    let result = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.data[this.pos >>> 3];
      if (byte === undefined) throw new Error('bzip2: unexpected end of stream');
      const bit = (byte >>> (7 - (this.pos & 7))) & 1;
      result = result * 2 + bit;
      this.pos++;
    }
    return result;
  }

  readBit() {
    const byte = this.data[this.pos >>> 3];
    if (byte === undefined) throw new Error('bzip2: unexpected end of stream');
    const bit = (byte >>> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return bit;
  }
}

const GROUP_SIZE = 50;
const RUNA = 0;
const RUNB = 1;

function decodeHuffmanTables(bits, nGroups, alphaSize) {
  const tables = [];
  for (let g = 0; g < nGroups; g++) {
    const lengths = new Uint8Array(alphaSize);
    let len = bits.read(5);
    for (let s = 0; s < alphaSize; s++) {
      for (;;) {
        if (len < 1 || len > 20) throw new Error('bzip2: invalid code length');
        if (!bits.readBit()) break;
        len += bits.readBit() ? -1 : 1;
      }
      lengths[s] = len;
    }
    tables.push(buildHuffman(lengths, alphaSize));
  }
  return tables;
}

function buildHuffman(lengths, alphaSize) {
  let minLen = 32;
  let maxLen = 0;
  for (let i = 0; i < alphaSize; i++) {
    if (lengths[i] > maxLen) maxLen = lengths[i];
    if (lengths[i] < minLen) minLen = lengths[i];
  }
  const perm = new Int32Array(alphaSize);
  let pp = 0;
  for (let len = minLen; len <= maxLen; len++) {
    for (let s = 0; s < alphaSize; s++) {
      if (lengths[s] === len) perm[pp++] = s;
    }
  }
  const count = new Int32Array(maxLen + 2);
  for (let s = 0; s < alphaSize; s++) count[lengths[s] + 1]++;
  for (let len = 1; len < count.length; len++) count[len] += count[len - 1];
  const limit = new Int32Array(maxLen + 2);
  const base = new Int32Array(maxLen + 2);
  let vec = 0;
  for (let len = minLen; len <= maxLen; len++) {
    vec += count[len + 1] - count[len];
    limit[len] = vec - 1;
    vec <<= 1;
  }
  for (let len = minLen + 1; len <= maxLen; len++) {
    base[len] = ((limit[len - 1] + 1) << 1) - count[len];
  }
  return { minLen, maxLen, limit, base, perm };
}

function readSymbol(bits, table) {
  let len = table.minLen;
  let vec = bits.read(len);
  while (len <= table.maxLen && vec > table.limit[len]) {
    vec = vec * 2 + bits.readBit();
    len++;
  }
  if (len > table.maxLen) throw new Error('bzip2: bad huffman code');
  return table.perm[vec - table.base[len]];
}
export function bunzip2(input, expectedSize) {
  if (input[0] !== 0x42 || input[1] !== 0x5a || input[2] !== 0x68) {
    throw new Error('bzip2: bad magic');
  }
  const level = input[3] - 0x30;
  if (level < 1 || level > 9) throw new Error('bzip2: bad level');
  const maxBlockSize = level * 100000;
  const bits = new Bits(input);
  bits.pos = 32;

  const out = new Uint8Array(expectedSize || maxBlockSize * 2);
  let outLen = 0;
  const ensure = (extra) => {
    if (outLen + extra <= out.length) return out;
    throw new Error('bzip2: output larger than expected');
  };

  const bwtBuf = new Uint8Array(maxBlockSize);
  const next = new Uint32Array(maxBlockSize);

  for (;;) {
    const magicHi = bits.read(24);
    const magicLo = bits.read(24);
    if (magicHi === 0x177245 && magicLo === 0x385090) {
      bits.read(32); // combined CRC
      break;
    }
    if (magicHi !== 0x314159 || magicLo !== 0x265359) {
      throw new Error('bzip2: bad block magic');
    }
    bits.read(32); // block CRC (not verified)
    if (bits.readBit()) throw new Error('bzip2: randomized blocks unsupported');
    const origPtr = bits.read(24);
    const used16 = bits.read(16);
    const seqToUnseq = [];
    for (let i = 0; i < 16; i++) {
      if (used16 & (0x8000 >>> i)) {
        const bitmap = bits.read(16);
        for (let j = 0; j < 16; j++) {
          if (bitmap & (0x8000 >>> j)) seqToUnseq.push(i * 16 + j);
        }
      }
    }
    const nUsed = seqToUnseq.length;
    if (nUsed === 0) throw new Error('bzip2: empty symbol map');
    const alphaSize = nUsed + 2;
    const eob = alphaSize - 1;

    const nGroups = bits.read(3);
    const nSelectors = bits.read(15);
    if (nGroups < 2 || nGroups > 6) throw new Error('bzip2: bad group count');
    const selectorMtf = [];
    for (let i = 0; i < nSelectors; i++) {
      let j = 0;
      while (bits.readBit()) j++;
      if (j >= nGroups) throw new Error('bzip2: bad selector');
      selectorMtf.push(j);
    }
    const groupOrder = [];
    for (let i = 0; i < nGroups; i++) groupOrder.push(i);
    const selectors = selectorMtf.map((j) => {
      const v = groupOrder.splice(j, 1)[0];
      groupOrder.unshift(v);
      return v;
    });

    const tables = decodeHuffmanTables(bits, nGroups, alphaSize);
    const mtf = seqToUnseq.slice();
    let bwtLen = 0;
    let groupPos = 0;
    let groupNo = -1;
    let table = null;
    let run = 0;
    let runBit = 0;
    for (;;) {
      if (groupPos === 0) {
        groupNo++;
        if (groupNo >= nSelectors) throw new Error('bzip2: ran out of selectors');
        groupPos = GROUP_SIZE;
        table = tables[selectors[groupNo]];
      }
      groupPos--;
      const sym = readSymbol(bits, table);
      if (sym === RUNA || sym === RUNB) {
        run += (sym === RUNA ? 1 : 2) * Math.pow(2, runBit);
        runBit++;
        continue;
      }
      if (run > 0) {
        const b = mtf[0];
        if (bwtLen + run > maxBlockSize) throw new Error('bzip2: block overflow');
        bwtBuf.fill(b, bwtLen, bwtLen + run);
        bwtLen += run;
        run = 0;
        runBit = 0;
      }
      if (sym === eob) break;
      const idx = sym - 1;
      const b = mtf.splice(idx, 1)[0];
      mtf.unshift(b);
      if (bwtLen >= maxBlockSize) throw new Error('bzip2: block overflow');
      bwtBuf[bwtLen++] = b;
    }
    if (origPtr >= bwtLen) throw new Error('bzip2: bad origPtr');
    const first = new Int32Array(256);
    for (let i = 0; i < bwtLen; i++) first[bwtBuf[i]]++;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      const c = first[i];
      first[i] = sum;
      sum += c;
    }
    for (let i = 0; i < bwtLen; i++) next[first[bwtBuf[i]]++] = i;
    let p = next[origPtr];
    let runByte = -1;
    let runCount = 0;
    for (let k = 0; k < bwtLen; k++) {
      const b = bwtBuf[p];
      p = next[p];
      if (runCount === 4) {
        ensure(b);
        out.fill(runByte, outLen, outLen + b);
        outLen += b;
        runCount = 0;
        runByte = -1;
        continue;
      }
      if (b === runByte) {
        runCount++;
      } else {
        runByte = b;
        runCount = 1;
      }
      ensure(1);
      out[outLen++] = b;
    }
  }
  return out.subarray(0, outLen);
}
