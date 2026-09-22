import { readdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

export type CopyKind = "template" | "markdown" | "ts";

export interface CopyEntry {
  id: string;
  kind: CopyKind;
  file: string;
  line: number;
  label: string;
  /** Source text with its encoding undone: what the editor shows. */
  raw: string;
  /** Rendered plain text, used to match the entry against the DOM. */
  text: string;
  start: number;
  end: number;
  /** Generator to rerun before the page reflects the edit. */
  regen?: string;
}

interface Found {
  label: string;
  start: number;
  end: number;
  kind?: CopyKind;
}

interface TsSource {
  file: string;
  fields: string[];
  regen: string;
}

const TS_SOURCES: TsSource[] = [
  {
    file: "scripts/lib/battlegrounds-config.ts",
    fields: ["name", "description", "title", "summary", "body", "label", "note"],
    regen: "gen-battlegrounds",
  },
  {
    file: "scripts/gen-mechanics.ts",
    fields: ["name", "description", "summary", "label"],
    regen: "gen-mechanics",
  },
];

const TEMPLATE_DIR = "site/templates";
const CONTENT_DIR = "site/content";
/** Content directories a generator owns; editing them there is pointless. */
const GENERATED_CONTENT = new Set(["heroes", "battlegrounds", "gamedata"]);
const OPAQUE_TAGS = new Set(["script", "style", "svg", "pre", "code"]);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", mdash: "—", ndash: "–", times: "×", hellip: "…",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body] ?? match;
  });
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (src[i] === "\n") line++;
  return line;
}

function skipTag(src: string, open: number): number {
  let i = open + 1;
  let quote = "";
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
    i++;
  }
  return src.length;
}

function isTeraOpen(src: string, i: number): boolean {
  return src[i] === "{" && "{%#".includes(src[i + 1] ?? "");
}

function pushRun(out: Found[], src: string, from: number, to: number, label: string): void {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(src[start]!)) start++;
  while (end > start && /\s/.test(src[end - 1]!)) end--;
  const run = src.slice(start, end);
  if (run.length < 2) return;
  if (!/[A-Za-z]{2}/.test(decodeEntities(run))) return;
  out.push({ label, start, end });
}

function scanTemplate(src: string): Found[] {
  const out: Found[] = [];
  const lower = src.toLowerCase();
  let i = 0;
  while (i < src.length) {
    if (src[i] === "<") {
      const tag = /^<\s*\/?\s*([a-zA-Z][-\w]*)/.exec(src.slice(i, i + 40))?.[1]?.toLowerCase();
      const after = skipTag(src, i);
      if (tag && OPAQUE_TAGS.has(tag) && src[i + 1] !== "/" && src[after - 2] !== "/") {
        const close = lower.indexOf(`</${tag}`, after);
        i = close === -1 ? src.length : close;
      } else {
        i = after;
      }
      continue;
    }
    if (isTeraOpen(src, i)) {
      const closer = src[i + 1] === "{" ? "}}" : src[i + 1] === "%" ? "%}" : "#}";
      const close = src.indexOf(closer, i + 2);
      i = close === -1 ? src.length : close + closer.length;
      continue;
    }
    let j = i;
    while (j < src.length && src[j] !== "<" && !isTeraOpen(src, j)) j++;
    pushRun(out, src, i, j, "text");
    i = j;
  }
  return out;
}

/** Markdown blocks carry raw HTML, whose text runs are edited like a template's. */
function emitProse(out: Found[], src: string, start: number, end: number, label: string): void {
  const slice = src.slice(start, end);
  if (!slice.includes("<")) {
    out.push({ label, start, end });
    return;
  }
  for (const run of scanTemplate(slice)) {
    out.push({ label: "html", start: start + run.start, end: start + run.end, kind: "template" });
  }
}

function scanMarkdown(src: string): Found[] {
  const out: Found[] = [];
  const fmEnd = src.startsWith("+++") ? src.indexOf("\n+++", 3) : -1;
  if (fmEnd !== -1) {
    const fm = src.slice(0, fmEnd);
    const re = /^(title|description)\s*=\s*"((?:[^"\\]|\\.)*)"/gm;
    for (let m = re.exec(fm); m; m = re.exec(fm)) {
      const start = m.index + m[0].indexOf('"') + 1;
      out.push({ label: m[1]!, start, end: start + m[2]!.length });
    }
  }

  const bodyStart = fmEnd === -1 ? 0 : src.indexOf("\n", fmEnd + 1) + 1;
  let offset = bodyStart;
  let fenced = false;
  let block: { start: number; end: number } | null = null;

  const flush = () => {
    if (block) emitProse(out, src, block.start, block.end, "paragraph");
    block = null;
  };

  for (const line of src.slice(bodyStart).split("\n")) {
    const start = offset;
    offset += line.length + 1;
    if (/^\s*```/.test(line)) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (!line.trim() || /^\s*\{[{%]/.test(line)) {
      flush();
      continue;
    }
    const marked = /^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+))(.*\S)\s*$/.exec(line);
    if (marked) {
      flush();
      const from = start + marked[1]!.length;
      emitProse(out, src, from, from + marked[2]!.length, /#/.test(marked[1]!) ? "heading" : "item");
      continue;
    }
    const end = start + line.trimEnd().length;
    block = block ? { start: block.start, end } : { start: start + (line.length - line.trimStart().length), end };
  }
  flush();
  return out;
}

function readLiteral(src: string, at: number): { start: number; end: number } | null {
  const quote = src[at];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let i = at + 1;
  while (i < src.length) {
    if (src[i] === "\\") i += 2;
    else if (src[i] === quote) return { start: at + 1, end: i };
    else i++;
  }
  return null;
}

function scanTs(src: string, fields: string[]): Found[] {
  const out: Found[] = [];
  const re = new RegExp(`\\b(${fields.join("|")})\\s*:\\s*`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const at = m.index + m[0].length;
    const literal = readLiteral(src, at);
    if (literal) {
      out.push({ label: m[1]!, ...literal });
      re.lastIndex = literal.end;
      continue;
    }
    if (src[at] !== "[") continue;
    let i = at + 1;
    let n = 0;
    while (i < src.length && src[i] !== "]") {
      const item = readLiteral(src, i);
      if (item) {
        out.push({ label: `${m[1]}[${n++}]`, ...item });
        i = item.end + 1;
      } else i++;
    }
    re.lastIndex = i;
  }
  return out;
}

function decodeTs(raw: string): string {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g, (match, body: string) => {
    if (body[0] === "u") {
      const hex = body[1] === "{" ? body.slice(2, -1) : body.slice(1);
      return String.fromCodePoint(parseInt(hex, 16));
    }
    return { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "`": "`" }[body] ?? match;
  });
}

function encode(kind: CopyKind, text: string): string {
  if (kind === "ts") {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, "\\n");
  }
  if (kind === "template") {
    if (/\{[{%#]/.test(text)) throw new Error("template copy cannot contain Tera markup");
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }
  return text;
}

function entriesFrom(file: string, src: string, fallback: CopyKind, found: Found[], regen?: string): CopyEntry[] {
  return found.map((item, index) => {
    const kind = item.kind ?? fallback;
    const source = src.slice(item.start, item.end);
    const raw = kind === "ts" ? decodeTs(source) : kind === "template" ? decodeEntities(source) : source;
    const text = file.endsWith(".md") ? stripMarkdown(raw) : raw;
    return {
      id: `${file}#${index}`,
      kind,
      file,
      line: lineAt(src, item.start),
      label: item.label,
      raw,
      text: text.replace(/\s+/g, " ").trim(),
      start: item.start,
      end: item.end,
      regen,
    };
  });
}

async function walk(dir: string, skipTop: Set<string> = new Set()): Promise<string[]> {
  const out: string[] = [];
  for (const item of await readdir(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${item.name}`;
    if (item.isDirectory()) {
      if (skipTop.has(item.name)) continue;
      out.push(...(await walk(rel)));
    } else out.push(rel);
  }
  return out;
}

export async function scanFile(file: string): Promise<CopyEntry[]> {
  const src = await readFile(path.join(REPO_ROOT, file), "utf-8");
  const ts = TS_SOURCES.find((source) => source.file === file);
  if (ts) return entriesFrom(file, src, "ts", scanTs(src, ts.fields), ts.regen);
  if (file.endsWith(".html")) return entriesFrom(file, src, "template", scanTemplate(src));
  if (file.endsWith(".md")) return entriesFrom(file, src, "markdown", scanMarkdown(src));
  throw new Error(`${file}: not a copy source`);
}

export async function scanRegistry(): Promise<CopyEntry[]> {
  const files = [
    ...(await walk(TEMPLATE_DIR)).filter((file) => file.endsWith(".html")),
    ...(await walk(CONTENT_DIR, GENERATED_CONTENT)).filter((file) => file.endsWith(".md")),
    ...TS_SOURCES.map((source) => source.file),
  ];
  const scanned = await Promise.all(files.map((file) => scanFile(file)));
  return scanned.flat();
}

export async function saveEntry(id: string, expected: string, next: string): Promise<CopyEntry> {
  const file = id.slice(0, id.lastIndexOf("#"));
  const entry = (await scanFile(file)).find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`no copy entry ${id}`);
  if (entry.raw !== expected) throw new Error(`${entry.file}:${entry.line} changed on disk`);
  if (!next.trim()) throw new Error("copy cannot be empty");

  const abs = path.join(REPO_ROOT, file);
  const src = await readFile(abs, "utf-8");
  await writeFile(abs, src.slice(0, entry.start) + encode(entry.kind, next) + src.slice(entry.end));
  return (await scanFile(file)).find((candidate) => candidate.id === id)!;
}

export { REPO_ROOT };
