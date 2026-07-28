// Copyright (c) 2010-2014 Aku Kotkavuo. All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//   1. Redistributions of source code must retain the above copyright
//      notice, this list of conditions and the following disclaimer.
// 
//   2. Redistributions in binary form must reproduce the above copyright
//      notice, this list of conditions and the following disclaimer in the
//      documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
// ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
// ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

import { bunzip2 } from './bzip2.js';

const MPQ_FILE_ENCRYPTED = 0x00010000;
const MPQ_FILE_SINGLE_UNIT = 0x01000000;
const MPQ_FILE_SECTOR_CRC = 0x04000000;
const MPQ_FILE_COMPRESS = 0x00000200;
const MPQ_FILE_EXISTS = 0x80000000;

const cryptTable = new Uint32Array(0x500);
{
  let seed = 0x00100001;
  for (let i = 0; i < 0x100; i++) {
    let index = i;
    for (let j = 0; j < 5; j++) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t1 = (seed & 0xffff) << 16;
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t2 = seed & 0xffff;
      cryptTable[index] = (t1 | t2) >>> 0;
      index += 0x100;
    }
  }
}

function hashString(str, hashType) {
  const offsets = { TABLE_OFFSET: 0, HASH_A: 1, HASH_B: 2, TABLE: 3 };
  const type = offsets[hashType];
  let seed1 = 0x7fed7fed;
  let seed2 = 0xeeeeeeee;
  for (let i = 0; i < str.length; i++) {
    const ch = str.toUpperCase().charCodeAt(i);
    seed1 = (cryptTable[(type << 8) + ch] ^ (seed1 + seed2)) >>> 0;
    seed2 = (ch + seed1 + seed2 + (seed2 << 5) + 3) >>> 0;
  }
  return seed1;
}

function decrypt(data, key) {
  let seed1 = key >>> 0;
  let seed2 = 0xeeeeeeee;
  const out = new Uint8Array(data.length);
  const inView = new DataView(data.buffer, data.byteOffset, data.length);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < data.length; i += 4) {
    seed2 = (seed2 + cryptTable[0x400 + (seed1 & 0xff)]) >>> 0;
    const value = (inView.getUint32(i, true) ^ (seed1 + seed2)) >>> 0;
    seed1 = ((((~seed1 << 0x15) >>> 0) + 0x11111111) | (seed1 >>> 0x0b)) >>> 0;
    seed2 = (value + seed2 + (seed2 << 5) + 3) >>> 0;
    outView.setUint32(i, value, true);
  }
  return out;
}

export class MPQArchive {
  constructor(buffer, options = {}) {
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
    this.inflate = options.inflate || null;
    this.userData = null;
    this.headerOffset = 0;
    this._parseHeader();
    this._parseTables();
  }

  _parseHeader() {
    const magic = this.view.getUint32(0, true);
    if ((magic & 0x00ffffff) !== 0x51504d) throw new Error('not an MPQ archive');
    if (this.bytes[3] === 0x1b) {
      const userDataSize = this.view.getUint32(4, true);
      this.headerOffset = this.view.getUint32(8, true);
      const contentSize = this.view.getUint32(12, true);
      this.userData = this.bytes.subarray(16, 16 + Math.min(contentSize, userDataSize));
      if (this.view.getUint32(this.headerOffset, true) !== 0x1a51504d) {
        throw new Error('MPQ header not found at user-data offset');
      }
    }
    const o = this.headerOffset;
    this.header = {
      headerSize: this.view.getUint32(o + 4, true),
      archiveSize: this.view.getUint32(o + 8, true),
      formatVersion: this.view.getUint16(o + 12, true),
      sectorSizeShift: this.view.getUint16(o + 14, true),
      hashTableOffset: this.view.getUint32(o + 16, true),
      blockTableOffset: this.view.getUint32(o + 20, true),
      hashTableEntries: this.view.getUint32(o + 24, true),
      blockTableEntries: this.view.getUint32(o + 28, true),
    };
  }

  _parseTables() {
    const h = this.header;
    this.hashTable = this._readTable(h.hashTableOffset, h.hashTableEntries, '(hash table)');
    this.blockTable = this._readTable(h.blockTableOffset, h.blockTableEntries, '(block table)');
  }

  _readTable(offset, entries, keyName) {
    const start = this.headerOffset + offset;
    const raw = this.bytes.subarray(start, start + entries * 16);
    const data = decrypt(raw, hashString(keyName, 'TABLE'));
    const view = new DataView(data.buffer);
    const table = [];
    for (let i = 0; i < entries; i++) {
      const o = i * 16;
      if (keyName === '(hash table)') {
        table.push({
          hashA: view.getUint32(o, true),
          hashB: view.getUint32(o + 4, true),
          locale: view.getUint16(o + 8, true),
          platform: view.getUint16(o + 10, true),
          blockTableIndex: view.getUint32(o + 12, true),
        });
      } else {
        table.push({
          offset: view.getUint32(o, true),
          archivedSize: view.getUint32(o + 4, true),
          size: view.getUint32(o + 8, true),
          flags: view.getUint32(o + 12, true),
        });
      }
    }
    return table;
  }

  _findHashEntry(filename) {
    const hashA = hashString(filename, 'HASH_A');
    const hashB = hashString(filename, 'HASH_B');
    return this.hashTable.find((e) => e.hashA === hashA && e.hashB === hashB) || null;
  }

  readFile(filename) {
    const hashEntry = this._findHashEntry(filename);
    if (!hashEntry) return null;
    const block = this.blockTable[hashEntry.blockTableIndex];
    if (!block || !(block.flags & MPQ_FILE_EXISTS)) return null;
    if (block.size === 0) return new Uint8Array(0);
    if (block.flags & MPQ_FILE_ENCRYPTED) throw new Error('encrypted MPQ files unsupported');

    const start = this.headerOffset + block.offset;
    const raw = this.bytes.subarray(start, start + block.archivedSize);

    if (block.flags & MPQ_FILE_SINGLE_UNIT) {
      let data = raw;
      if ((block.flags & MPQ_FILE_COMPRESS) && block.archivedSize < block.size) {
        data = this._decompress(raw, block.size);
      }
      if (data.length !== block.size) {
        throw new Error(`MPQ file size mismatch for ${filename}: ${data.length} != ${block.size}`);
      }
      return data;
    }
    return this._readSectored(block, raw, filename);
  }

  _readSectored(block, raw, filename) {
    if (!(block.flags & MPQ_FILE_COMPRESS)) return raw.subarray(0, block.size);
    const sectorSize = 512 << this.header.sectorSizeShift;
    const sectors = Math.ceil(block.size / sectorSize);
    let tableEntries = sectors + 1;
    if (block.flags & MPQ_FILE_SECTOR_CRC) tableEntries += 1;
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const offsets = [];
    for (let i = 0; i < tableEntries; i++) offsets.push(view.getUint32(i * 4, true));

    const out = new Uint8Array(block.size);
    let outPos = 0;
    for (let i = 0; i < sectors; i++) {
      const chunk = raw.subarray(offsets[i], offsets[i + 1]);
      const want = Math.min(sectorSize, block.size - outPos);
      let data = chunk;
      if ((block.flags & MPQ_FILE_COMPRESS) && chunk.length < want) {
        data = this._decompress(chunk, want);
      }
      if (data.length !== want) {
        throw new Error(`MPQ sector size mismatch for ${filename}: ${data.length} != ${want}`);
      }
      out.set(data, outPos);
      outPos += want;
    }
    return out;
  }

  _decompress(data, expectedSize) {
    const type = data[0];
    const payload = data.subarray(1);
    if (type === 0x10) return bunzip2(payload, expectedSize);
    if (type === 0x02) {
      if (!this.inflate) throw new Error('zlib-compressed MPQ member but no inflate provided');
      return new Uint8Array(this.inflate(payload));
    }
    if (type === 0x00) return payload;
    throw new Error(`unsupported MPQ compression type 0x${type.toString(16)}`);
  }
}
