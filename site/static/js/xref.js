
export function gamedataHref(path, id, currentPath) {
  const anchor = id ? `#${encodeURIComponent(id)}` : "";
  if (path === currentPath) return anchor || "#";
  return `/gamedata/${path}/${anchor}`;
}

// Page urls carry "-xml"/"-galaxy" where the file name has an extension.
export function gamedataFileLabel(path) {
  const name = String(path ?? "").split("/").pop() ?? "";
  return name.replace(/-(xml|galaxy)$/, ".$1");
}

export function targetsOf(sidecar, id) {
  const entries = sidecar?.targets?.[id];
  if (!entries) return [];
  return entries.map(([fileIndex, line, tag]) => ({
    path: sidecar.files[fileIndex],
    line,
    tag,
  }));
}

export function refValuesByLine(sidecar) {
  const byLine = new Map();
  for (const [line, value] of sidecar?.refs ?? []) {
    const values = byLine.get(line) ?? new Set();
    values.add(value);
    byLine.set(line, values);
  }
  return byLine;
}

export function defsByLine(sidecar) {
  const byLine = new Map();
  for (const [id, [line, tag, parent]] of Object.entries(sidecar?.defs ?? {})) {
    const defs = byLine.get(line) ?? [];
    defs.push({ id, tag, parent, refCount: sidecar.refCounts?.[id] ?? 0 });
    byLine.set(line, defs);
  }
  return byLine;
}

// Outgoing refs of one element, in document order, with each target resolved.
export function childrenOf(sidecar, id) {
  const seen = new Set();
  const children = [];
  for (const [, value, fieldIndex, from] of sidecar?.refs ?? []) {
    if (from !== id) continue;
    const field = sidecar.fields?.[fieldIndex] ?? "";
    const key = `${field}\u0000${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [target] = targetsOf(sidecar, value);
    if (!target) continue;
    children.push({ id: value, field, path: target.path, line: target.line, tag: target.tag });
  }
  return children;
}

// Fallback outline for files with no resolved ability/talent index.
export function outlineDefs(sidecar, limit = 300) {
  const defs = Object.entries(sidecar?.defs ?? {})
    .map(([id, [line, tag]]) => ({ id, line, tag }))
    .sort((a, b) => a.line - b.line);
  const preferred = defs.filter(({ tag }) => tag.startsWith("CAbil") || tag.startsWith("CTalent"));
  const chosen = preferred.length ? preferred : defs;
  return { items: chosen.slice(0, limit), total: chosen.length };
}

export function chainOf(sidecar, id) {
  return (sidecar?.chains?.[id] ?? []).map((ancestorId) => ({
    id: ancestorId,
    targets: targetsOf(sidecar, ancestorId),
  }));
}

export function incomingGroups(incomingFile, id) {
  const entries = incomingFile?.incoming?.[id] ?? [];
  const groups = new Map();
  for (const [fileIndex, line, field, from] of entries) {
    const items = groups.get(field) ?? [];
    items.push({ path: incomingFile.files[fileIndex], line, from });
    groups.set(field, items);
  }
  return [...groups.entries()]
    .map(([field, items]) => ({ field, items }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

// Per-line resolver used by the syntax highlighter: only attribute values that
// the build-side scan recorded as refs on that line become links.
export function createXrefLinker(sidecar, currentPath) {
  const byLine = refValuesByLine(sidecar);
  const defs = sidecar?.defs ?? {};

  return function linkerForLine(line) {
    const values = byLine.get(line);
    if (!values) return null;
    return function linkFor(rawValue) {
      const value = normalizeLinkValue(rawValue);
      if (!values.has(value)) return null;
      const targets = targetsOf(sidecar, value);
      if (!targets.length) return null;
      const target = targets[0];
      const tag = defs[value]?.[1] ?? target.tag;
      return {
        id: value,
        href: gamedataHref(target.path, value, currentPath),
        title: `${tag} — ${gamedataFileLabel(target.path)}:${target.line}`,
        count: targets.length,
      };
    };
  };
}

// Mirrors normalizeRefValue in the build-side scan.
export function normalizeLinkValue(value) {
  const text = String(value ?? "");
  return text.startsWith("Abil/") ? text.slice(5).split(",")[0] : text.split(",")[0];
}

export function jumpHistory(limit = 50) {
  const back = [];
  const forward = [];
  return {
    visit(entry) {
      if (back[back.length - 1] === entry) return;
      back.push(entry);
      if (back.length > limit) back.shift();
      forward.length = 0;
    },
    back() {
      if (back.length < 2) return null;
      forward.push(back.pop());
      return back[back.length - 1];
    },
    forward() {
      const entry = forward.pop();
      if (!entry) return null;
      back.push(entry);
      return entry;
    },
    get entries() {
      return [...back];
    },
  };
}
