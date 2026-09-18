// Cross-reference index for the game data browser: definitions, outgoing refs,
// and incoming refs per file. Line-oriented scan so positions match the
// line anchors gen-gamedata emits.

import { BACKREF_TAG_RE, normalizeRefValue } from "./effect-graph/build.ts";

export interface XrefDef {
  id: string;
  line: number;
  tag: string;
  parent: string | null;
}

export interface XrefRef {
  line: number;
  field: string;
  value: string;
  from: string | null;
}

export interface FileScan {
  defs: XrefDef[];
  refs: XrefRef[];
}

// [fileIndex, line, tag]
export type XrefTarget = [number, number, string];
// [fileIndex, line, field, fromId]
export type XrefIncoming = [number, number, string, string];

// [line, targetId, fieldIndex, owningElementId]
export type XrefOutgoing = [number, string, number, string];

// [id, line, tag] for a repeat definition of an id already in `defs`
export type XrefAltDef = [string, number, string];

// Loaded with the page: what this file defines and where its refs point.
export interface XrefSidecar {
  files: string[];
  fields: string[];
  defs: Record<string, [number, string, string | null]>;
  alts?: XrefAltDef[];
  refs: XrefOutgoing[];
  targets: Record<string, XrefTarget[]>;
  refCounts: Record<string, number>;
  chains: Record<string, string[]>;
}

// Loaded on demand: who points at the ids this file defines.
export interface XrefIncomingFile {
  files: string[];
  incoming: Record<string, XrefIncoming[]>;
  truncated?: Record<string, number>;
}

const TAG_RE = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g;
const ATTR_RE = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;

function isCElementTag(tag: string): boolean {
  return /^C[A-Z]/.test(tag);
}

// "Abil/X,Execute" and "X,Execute" both point at X.
export function normalizeXrefValue(field: string, value: string): string {
  return normalizeRefValue(field, value.replace(/^[A-Za-z]\w*\//, "")).split(",")[0];
}

function isIdLike(value: string): boolean {
  return /^[A-Za-z_]\w{2,}$/.test(value);
}

function parseAttrs(raw: string): [string, string][] {
  const out: [string, string][] = [];
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw)) !== null) out.push([m[1], m[2]]);
  return out;
}

export function scanXrefFile(content: string): FileScan {
  const defs: XrefDef[] = [];
  const refs: XrefRef[] = [];
  const stack: { tag: string; backref: boolean; owner: string | null }[] = [];
  const lines = content.split("\n");

  const currentOwner = (): string | null => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].owner) return stack[i].owner;
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = TAG_RE.exec(line)) !== null) {
      const [, closing, tag, rawAttrs, selfClosing] = m;

      if (closing) {
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j].tag === tag) {
            stack.length = j;
            break;
          }
        }
        continue;
      }

      const attrs = parseAttrs(rawAttrs);
      const attrMap = Object.fromEntries(attrs);
      const isDef = isCElementTag(tag) && attrMap["id"] !== undefined;
      const backref = BACKREF_TAG_RE.test(tag);

      if (isDef) {
        defs.push({
          id: attrMap["id"],
          line: lineNumber,
          tag,
          parent: attrMap["parent"] ?? null,
        });
      }

      const owner = isDef ? attrMap["id"] : null;
      const inherited = currentOwner();
      const from = owner ?? inherited;

      // Any attribute value shaped like an id counts as a candidate reference;
      // the effect graph's REF_FIELDS only decide which edges it follows itself.
      // Backref elements name earlier positions, not catalog entries.
      for (const [name, value] of attrs) {
        if (name === "id" || backref) continue;
        const field = (name === "value" || name === "Link") && !isDef ? tag : name;
        const candidate = normalizeXrefValue(field, value);
        if (!isIdLike(candidate)) continue;
        refs.push({ line: lineNumber, field, value: candidate, from: isDef ? from : inherited });
      }

      if (!selfClosing) stack.push({ tag, backref, owner });
    }
  }

  return { defs, refs };
}

export interface ScannedFile {
  path: string; // url path, e.g. "mods/.../effectdata-xml"
  scan: FileScan;
}

const MAX_INCOMING_PER_ID = 200;

export interface XrefOutput {
  sidecar: XrefSidecar;
  incoming: XrefIncomingFile;
}

export function buildXrefSidecars(
  files: ScannedFile[],
  maxIncoming = MAX_INCOMING_PER_ID,
): Map<string, XrefOutput> {
  const definitions = new Map<string, { path: string; line: number; tag: string }[]>();
  for (const { path, scan } of files) {
    for (const def of scan.defs) {
      const list = definitions.get(def.id) ?? [];
      list.push({ path, line: def.line, tag: def.tag });
      definitions.set(def.id, list);
    }
  }

  const parents = new Map<string, string>();
  for (const { scan } of files) {
    for (const def of scan.defs) {
      if (def.parent && !parents.has(def.id)) parents.set(def.id, def.parent);
    }
  }
  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    let cur = parents.get(id);
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = parents.get(cur);
    }
    return out;
  };

  const incoming = new Map<string, { path: string; line: number; field: string; from: string }[]>();
  for (const { path, scan } of files) {
    for (const ref of scan.refs) {
      if (!definitions.has(ref.value)) continue;
      const list = incoming.get(ref.value) ?? [];
      list.push({ path, line: ref.line, field: ref.field, from: ref.from ?? "" });
      incoming.set(ref.value, list);
    }
  }

  const sidecars = new Map<string, XrefOutput>();
  for (const { path, scan } of files) {
    const fileIndexer = () => {
      const index = new Map<string, number>();
      const list: string[] = [];
      return {
        list,
        indexOf(p: string): number {
          const known = index.get(p);
          if (known !== undefined) return known;
          index.set(p, list.length);
          list.push(p);
          return list.length - 1;
        },
      };
    };
    const targetFiles = fileIndexer();
    const incomingFiles = fileIndexer();
    const indexOfFile = targetFiles.indexOf;

    // One id can be defined by several catalogs in a file (CAbil, CButton,
    // CUnit). The first holds the id; the rest go to `alts` so every line keeps
    // its own badge.
    const sidecarDefs: XrefSidecar["defs"] = {};
    const alts: XrefAltDef[] = [];
    for (const def of scan.defs) {
      if (sidecarDefs[def.id]) alts.push([def.id, def.line, def.tag]);
      else sidecarDefs[def.id] = [def.line, def.tag, def.parent];
    }

    const targets: Record<string, XrefTarget[]> = {};
    const addTarget = (id: string): void => {
      if (targets[id]) return;
      const sites = definitions.get(id);
      if (!sites) return;
      targets[id] = sites.map((site) => [indexOfFile(site.path), site.line, site.tag]);
    };

    const fields = fileIndexer();
    const sidecarRefs: XrefOutgoing[] = [];
    for (const ref of scan.refs) {
      if (!definitions.has(ref.value)) continue;
      sidecarRefs.push([ref.line, ref.value, fields.indexOf(ref.field), ref.from ?? ""]);
      addTarget(ref.value);
    }

    const chains: Record<string, string[]> = {};
    for (const def of scan.defs) {
      const chain = ancestorsOf(def.id);
      if (!chain.length) continue;
      chains[def.id] = chain;
      for (const ancestor of chain) addTarget(ancestor);
    }

    const sidecarIncoming: Record<string, XrefIncoming[]> = {};
    const refCounts: Record<string, number> = {};
    const truncated: Record<string, number> = {};
    for (const def of scan.defs) {
      const sites = incoming.get(def.id);
      if (!sites?.length) continue;
      refCounts[def.id] = sites.length;
      if (sites.length > maxIncoming) truncated[def.id] = sites.length;
      sidecarIncoming[def.id] = sites
        .slice(0, maxIncoming)
        .map((site) => [incomingFiles.indexOf(site.path), site.line, site.field, site.from] as XrefIncoming);
    }

    const incomingFile: XrefIncomingFile = { files: incomingFiles.list, incoming: sidecarIncoming };
    if (Object.keys(truncated).length) incomingFile.truncated = truncated;

    sidecars.set(path, {
      sidecar: {
        files: targetFiles.list,
        fields: fields.list,
        defs: sidecarDefs,
        ...(alts.length ? { alts } : {}),
        refs: sidecarRefs,
        targets,
        refCounts,
        chains,
      },
      incoming: incomingFile,
    });
  }

  return sidecars;
}
