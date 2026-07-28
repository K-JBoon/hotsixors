// Parses the Python literal subset used by heroprotocol's protocol*.py tables:
// ints, strings, None/True/False, lists, tuples and dicts, with comments and
// trailing commas. Tuples become arrays, dicts become plain objects with
// stringified keys.

export type PyValue = null | boolean | number | string | PyValue[] | { [key: string]: PyValue };

class Reader {
  constructor(
    private readonly src: string,
    private pos = 0
  ) {}

  private error(message: string): never {
    const line = this.src.slice(0, this.pos).split("\n").length;
    throw new Error(`python-literal: ${message} at line ${line}`);
  }

  skipTrivia(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === "#") {
        while (this.pos < this.src.length && this.src[this.pos] !== "\n") this.pos++;
      } else if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\\") {
        this.pos++;
      } else {
        return;
      }
    }
  }

  peek(): string {
    this.skipTrivia();
    return this.src[this.pos] ?? "";
  }

  eat(ch: string): boolean {
    if (this.peek() === ch) {
      this.pos++;
      return true;
    }
    return false;
  }

  expect(ch: string): void {
    if (!this.eat(ch)) this.error(`expected '${ch}', got '${this.peek()}'`);
  }

  atEnd(): boolean {
    return this.peek() === "";
  }

  value(): PyValue {
    const ch = this.peek();
    if (ch === "[") return this.sequence("[", "]");
    if (ch === "(") return this.sequence("(", ")");
    if (ch === "{") return this.dict();
    if (ch === "'" || ch === '"') return this.string();
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.number();
    return this.word();
  }

  private sequence(open: string, close: string): PyValue[] {
    this.expect(open);
    const items: PyValue[] = [];
    while (!this.eat(close)) {
      if (this.atEnd()) this.error(`unterminated '${open}'`);
      items.push(this.value());
      if (!this.eat(",") && this.peek() !== close) this.error("expected ',' in sequence");
    }
    return items;
  }

  private dict(): { [key: string]: PyValue } {
    this.expect("{");
    const out: { [key: string]: PyValue } = {};
    while (!this.eat("}")) {
      if (this.atEnd()) this.error("unterminated '{'");
      const key = this.value();
      if (typeof key !== "number" && typeof key !== "string") this.error("dict key must be int or string");
      this.expect(":");
      out[String(key)] = this.value();
      if (!this.eat(",") && this.peek() !== "}") this.error("expected ',' in dict");
    }
    return out;
  }

  private string(): string {
    const quote = this.src[this.pos];
    this.pos++;
    let out = "";
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos++];
      if (ch === quote) return out;
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const esc = this.src[this.pos++];
      if (esc === "n") out += "\n";
      else if (esc === "t") out += "\t";
      else if (esc === "r") out += "\r";
      else if (esc === "x") {
        out += String.fromCharCode(parseInt(this.src.substr(this.pos, 2), 16));
        this.pos += 2;
      } else out += esc;
    }
    this.error("unterminated string");
  }

  private number(): number {
    const match = /^-?(0[xX][0-9a-fA-F]+|\d+)/.exec(this.src.slice(this.pos));
    if (!match) this.error("bad number");
    this.pos += match[0].length;
    return Number(match[0]);
  }

  private word(): PyValue {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.pos));
    if (!match) this.error(`unexpected character '${this.peek()}'`);
    this.pos += match[0].length;
    if (match[0] === "None") return null;
    if (match[0] === "True") return true;
    if (match[0] === "False") return false;
    this.error(`unsupported name '${match[0]}'`);
  }
}

export function parsePythonLiteral(source: string): PyValue {
  const reader = new Reader(source);
  const value = reader.value();
  if (!reader.atEnd()) throw new Error("python-literal: trailing input after value");
  return value;
}

// Reads `name = <literal>` from a module body. Returns undefined when the
// assignment is absent.
export function readAssignment(source: string, name: string): PyValue | undefined {
  const pattern = new RegExp(`^${name}\\s*=\\s*`, "m");
  const match = pattern.exec(source);
  if (!match) return undefined;
  const reader = new Reader(source, match.index + match[0].length);
  return reader.value();
}
