// Extracts readable excerpts from GalaxyScript for timers and mechanics.

import { esc } from "./catalog-xml.ts";


export function sanitizeGamedataUrl(relPath: string): string {
  return relPath.replace(/\.(xml|galaxy)$/i, (m) => "-" + m.slice(1));
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
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
