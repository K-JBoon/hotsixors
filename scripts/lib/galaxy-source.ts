// Extracts readable excerpts from GalaxyScript for timers and mechanics.

export function sanitizeGamedataUrl(relPath: string): string {
  return relPath.replace(/\.(xml|galaxy|aitree)$/i, (m) => "-" + m.slice(1));
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Value of `NAME`, whether declared as a header const or assigned in
 * `InitVariables`. Returns the first match, which is the declaration.
 */
export function galaxyValue(src: string, name: string): number | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(-?[\\d.]+)\\s*;`).exec(src);
  return m ? parseFloat(m[1]) : null;
}

/** Body of the named Galaxy function, from its signature to the closing brace. */
export function galaxyFunctionBody(src: string, fnName: string): string | null {
  const start = new RegExp(`^\\w+ ${fnName}\\s*\\(`, "m").exec(src);
  if (!start) return null;
  const end = src.indexOf("\n}", start.index);
  return src.slice(start.index, end === -1 ? undefined : end);
}

/**
 * `galaxyValue` scoped to one function body. An assignment whose right side is
 * another variable, as the camp initializers use, resolves against `src`.
 */
export function galaxyValueIn(src: string, fnName: string, name: string): number | null {
  const body = galaxyFunctionBody(src, fnName);
  if (body === null) return null;
  const m = new RegExp(`\\b${name}\\s*=\\s*(-?[\\d.]+|\\w+)\\s*;`).exec(body);
  if (!m) return null;
  return /^-?[\d.]+$/.test(m[1]) ? parseFloat(m[1]) : galaxyValue(src, m[1]);
}

// Track the source header file for each const.
export type ConstEntry = { value: number; headerFile: string; headerName: string };

export function extractGalaxyConstsTracked(
  src: string,
  headerFile: string,   // absolute path
  headerName: string,   // display name (basename)
  target: Map<string, ConstEntry>,
): void {
  for (const m of src.matchAll(/const\s+(?:fixed|int)\s+(\w+)\s*=\s*([\d.]+)\s*;/g)) {
    target.set(m[1], { value: parseFloat(m[2]), headerFile, headerName });
  }
}

// Extract the const-definition lines for the given names.
export function buildConstBlock(src: string, constNames: string[]): string {
  return src.split('\n')
    .filter(line => line.match(/^\s*const\s+(?:fixed|int)/) && constNames.some(c => line.includes(c)))
    .join('\n');
}

// Find matching timer lines and return surrounding context.
export function extractTimerContext(src: string, constNames: string[], contextLines = 6): string {
  const lines = src.split('\n');
  const included = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!constNames.some(c => line.includes(c))) continue;
    // Only extract when the const appears in a timer operation.
    if (!line.includes('TimerStart(') && !/Wait\s*\(/.test(line)) continue;
    for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) {
      included.add(j);
    }
  }

  if (included.size === 0) return '';

  const sorted = [...included].sort((a, b) => a - b);
  const result: string[] = [];
  let prev = -2;

  for (const ln of sorted) {
    if (ln > prev + 1 && result.length > 0) result.push('\n// ...\n');
    result.push(lines[ln]);
    prev = ln;
  }

  return result.join('\n');
}

// Extract context around any matching line.
export function extractPatternContext(src: string, pattern: string, contextLines = 8): string {
  const lines = src.split('\n');
  const included = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(pattern)) continue;
    for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) {
      included.add(j);
    }
  }

  if (included.size === 0) return '';

  const sorted = [...included].sort((a, b) => a - b);
  const result: string[] = [];
  let prev = -2;

  for (const ln of sorted) {
    if (ln > prev + 1 && result.length > 0) result.push('\n// ...\n');
    result.push(lines[ln]);
    prev = ln;
  }

  return result.join('\n');
}

// Map a header path like libmlbd_h.galaxy to its implementation file.
export function headerToImpl(headerAbsPath: string): string {
  return headerAbsPath.replace(/_h\.galaxy$/, '.galaxy');
}
