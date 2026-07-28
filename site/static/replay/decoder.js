export class CorruptedError extends Error {}
export class TruncatedError extends Error {}

class BitPackedBuffer {
  constructor(data, endian = 'big') {
    this.data = data;
    this.used = 0;
    this.next = 0;
    this.nextBits = 0;
    this.bigEndian = endian === 'big';
  }

  done() {
    return this.nextBits === 0 && this.used >= this.data.length;
  }

  usedBits() {
    return this.used * 8 - this.nextBits;
  }

  byteAlign() {
    this.nextBits = 0;
  }

  readAlignedBytes(count) {
    this.byteAlign();
    const out = this.data.subarray(this.used, this.used + count);
    this.used += count;
    if (out.length !== count) throw new TruncatedError('EOF');
    return out;
  }

  readBits(bits) {
    let result = 0;
    let resultBits = 0;
    while (resultBits !== bits) {
      if (this.nextBits === 0) {
        if (this.done()) throw new TruncatedError('EOF');
        this.next = this.data[this.used];
        this.used += 1;
        this.nextBits = 8;
      }
      const copyBits = Math.min(bits - resultBits, this.nextBits);
      const copy = this.next & ((1 << copyBits) - 1);
      if (this.bigEndian) {
        result += copy * Math.pow(2, bits - resultBits - copyBits);
      } else {
        result += copy * Math.pow(2, resultBits);
      }
      this.next >>>= copyBits;
      this.nextBits -= copyBits;
      resultBits += copyBits;
    }
    return result;
  }

  readUnalignedBytes(count) {
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = this.readBits(8);
    return out;
  }
}

const utf8 = new TextDecoder('utf-8');
export function blobToString(blob) {
  return utf8.decode(blob);
}

class BaseDecoder {
  constructor(contents, typeinfos) {
    this.buffer = new BitPackedBuffer(contents);
    this.typeinfos = typeinfos;
  }

  instance(typeid) {
    if (typeid >= this.typeinfos.length) throw new CorruptedError(`typeid ${typeid}`);
    const [method, args] = this.typeinfos[typeid];
    return this[method](...args);
  }

  byteAlign() {
    this.buffer.byteAlign();
  }

  done() {
    return this.buffer.done();
  }

  usedBits() {
    return this.buffer.usedBits();
  }
}

export class BitPackedDecoder extends BaseDecoder {
  _array(bounds, typeid) {
    const length = this._int(bounds);
    const out = new Array(length);
    for (let i = 0; i < length; i++) out[i] = this.instance(typeid);
    return out;
  }

  _bitarray(bounds) {
    const length = this._int(bounds);
    return [length, this.buffer.readBits(length)];
  }

  _blob(bounds) {
    return this.buffer.readAlignedBytes(this._int(bounds));
  }

  _bool() {
    return this._int([0, 1]) !== 0;
  }

  _choice(bounds, fields) {
    const tag = this._int(bounds);
    const field = fields[String(tag)];
    if (!field) throw new CorruptedError(`choice tag ${tag}`);
    return { [field[0]]: this.instance(field[1]) };
  }

  _fourcc() {
    return this.buffer.readAlignedBytes(4);
  }

  _int(bounds) {
    return bounds[0] + this.buffer.readBits(bounds[1]);
  }

  _null() {
    return null;
  }

  _optional(typeid) {
    return this._bool() ? this.instance(typeid) : null;
  }

  _real32() {
    const b = this.buffer.readUnalignedBytes(4);
    return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, false);
  }

  _real64() {
    const b = this.buffer.readUnalignedBytes(8);
    return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, false);
  }

  _struct(fields) {
    let result = {};
    for (const field of fields) {
      if (field[0] === '__parent') {
        const parent = this.instance(field[1]);
        if (parent && typeof parent === 'object' && !Array.isArray(parent) && !(parent instanceof Uint8Array)) {
          Object.assign(result, parent);
        } else if (fields.length === 1) {
          result = parent;
        } else {
          result[field[0]] = parent;
        }
      } else {
        result[field[0]] = this.instance(field[1]);
      }
    }
    return result;
  }
}

export class VersionedDecoder extends BaseDecoder {
  _expectSkip(expected) {
    if (this.buffer.readBits(8) !== expected) throw new CorruptedError('bad skip byte');
  }

  _vint() {
    let b = this.buffer.readBits(8);
    const negative = b & 1;
    let result = (b >> 1) & 0x3f;
    let bits = 6;
    while ((b & 0x80) !== 0) {
      b = this.buffer.readBits(8);
      result += (b & 0x7f) * Math.pow(2, bits);
      bits += 7;
    }
    return negative ? -result : result;
  }

  _array(bounds, typeid) {
    this._expectSkip(0);
    const length = this._vint();
    const out = new Array(length);
    for (let i = 0; i < length; i++) out[i] = this.instance(typeid);
    return out;
  }

  _bitarray(bounds) {
    this._expectSkip(1);
    const length = this._vint();
    return [length, this.buffer.readAlignedBytes(Math.floor((length + 7) / 8))];
  }

  _blob(bounds) {
    this._expectSkip(2);
    return this.buffer.readAlignedBytes(this._vint());
  }

  _bool() {
    this._expectSkip(6);
    return this.buffer.readBits(8) !== 0;
  }

  _choice(bounds, fields) {
    this._expectSkip(3);
    const tag = this._vint();
    const field = fields[String(tag)];
    if (!field) {
      this._skipInstance();
      return {};
    }
    return { [field[0]]: this.instance(field[1]) };
  }

  _fourcc() {
    this._expectSkip(7);
    return this.buffer.readAlignedBytes(4);
  }

  _int(bounds) {
    this._expectSkip(9);
    return this._vint();
  }

  _null() {
    return null;
  }

  _optional(typeid) {
    this._expectSkip(4);
    return this.buffer.readBits(8) !== 0 ? this.instance(typeid) : null;
  }

  _real32() {
    this._expectSkip(7);
    const b = this.buffer.readAlignedBytes(4);
    return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, false);
  }

  _real64() {
    this._expectSkip(8);
    const b = this.buffer.readAlignedBytes(8);
    return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, false);
  }

  _struct(fields) {
    this._expectSkip(5);
    let result = {};
    const length = this._vint();
    for (let i = 0; i < length; i++) {
      const tag = this._vint();
      const field = fields.find((f) => f[2] === tag);
      if (field) {
        if (field[0] === '__parent') {
          const parent = this.instance(field[1]);
          if (parent && typeof parent === 'object' && !Array.isArray(parent) && !(parent instanceof Uint8Array)) {
            Object.assign(result, parent);
          } else if (fields.length === 1) {
            result = parent;
          } else {
            result[field[0]] = parent;
          }
        } else {
          result[field[0]] = this.instance(field[1]);
        }
      } else {
        this._skipInstance();
      }
    }
    return result;
  }

  _skipInstance() {
    const skip = this.buffer.readBits(8);
    if (skip === 0) {
      const length = this._vint();
      for (let i = 0; i < length; i++) this._skipInstance();
    } else if (skip === 1) {
      const length = this._vint();
      this.buffer.readAlignedBytes(Math.floor((length + 7) / 8));
    } else if (skip === 2) {
      this.buffer.readAlignedBytes(this._vint());
    } else if (skip === 3) {
      this._vint();
      this._skipInstance();
    } else if (skip === 4) {
      if (this.buffer.readBits(8) !== 0) this._skipInstance();
    } else if (skip === 5) {
      const length = this._vint();
      for (let i = 0; i < length; i++) {
        this._vint();
        this._skipInstance();
      }
    } else if (skip === 6) {
      this.buffer.readAlignedBytes(1);
    } else if (skip === 7) {
      this.buffer.readAlignedBytes(4);
    } else if (skip === 8) {
      this.buffer.readAlignedBytes(8);
    } else if (skip === 9) {
      this._vint();
    }
  }
}
