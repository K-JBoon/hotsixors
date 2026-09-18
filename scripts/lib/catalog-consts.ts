// `<const>` values in the mod catalogs. A value is a literal, a reference to
// another const, or a prefix expression over both.

const OPS: Record<string, (a: number, b: number) => number> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
};

const FNS: Record<string, (n: number) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  round: Math.round,
};

export type Constants = Map<string, string>;

export function parseConstants(xml: string): Constants {
  const out: Constants = new Map();
  for (const m of xml.matchAll(/<const\b[^>]*\bid="(\$[^"]+)"[^>]*\bvalue="([^"]*)"/gi)) {
    if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

type Resolve = (ref: string) => number;

class Reader {
  private pos = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  private rest(): string {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
    return this.src.slice(this.pos);
  }

  private match(re: RegExp): string | null {
    const m = re.exec(this.rest());
    if (!m) return null;
    this.pos += m[0].length;
    return m[0];
  }

  // Arguments run to the closing parenthesis.
  private args(resolve: Resolve): number[] {
    const out: number[] = [];
    while (this.rest() !== "" && this.rest()[0] !== ")") out.push(this.term(resolve));
    this.match(/^\)/);
    return out;
  }

  term(resolve: Resolve): number {
    const op = /^([-+*/])\s*\(/.exec(this.rest());
    if (op) {
      this.match(/^[-+*/]\s*\(/);
      const values = this.args(resolve);
      return values.length === 0 ? NaN : values.reduce(OPS[op[1]]);
    }

    const ref = this.match(/^\$[\w.]+/);
    if (ref) return resolve(ref);

    const fn = this.match(/^[A-Za-z_]\w*\s*\(/);
    if (fn) {
      const values = this.args(resolve);
      const apply: ((n: number) => number) | undefined = FNS[fn.replace(/\s*\($/, "")];
      return apply !== undefined && values.length === 1 ? apply(values[0]) : NaN;
    }

    const number = this.match(/^-?\d*\.?\d+/);
    return number === null ? NaN : Number.parseFloat(number);
  }
}

/** Resolves a catalog value to a number, or null when it does not evaluate. */
export function resolveNumber(raw: string | null, consts: Constants, seen = new Set<string>()): number | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value === "") return null;

  const resolve: Resolve = (ref) => {
    const next = seen.has(ref) ? undefined : consts.get(ref);
    if (next === undefined) return NaN;
    const resolved = resolveNumber(next, consts, new Set([...seen, ref]));
    return resolved === null ? NaN : resolved;
  };

  const result = new Reader(value).term(resolve);
  return Number.isFinite(result) ? result : null;
}
