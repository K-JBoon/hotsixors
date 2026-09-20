// File helpers shared by the gen scripts. Every write creates its parent
// directory, so callers never mkdir first.

import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

export async function writeText(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf-8");
}

export async function writeBinary(file: string, content: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

/** `space` 0 writes compact JSON, any other value pretty-prints. */
export async function writeJson(file: string, value: unknown, space = 0): Promise<void> {
  await writeText(file, JSON.stringify(value, null, space || undefined));
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf-8")) as T;
}

export async function readFileSafe(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return null;
  }
}

/** Parsed JSON, or null when the file is absent or unreadable. */
export async function readJsonSafe<T>(file: string): Promise<T | null> {
  const raw = await readFileSafe(file);
  return raw === null ? null : (JSON.parse(raw) as T);
}

export async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export interface WalkedFile {
  abs: string;
  /** Path below the walk root, with forward slashes. */
  rel: string;
}

/** Every file below `dir`, depth first. Unreadable directories are skipped. */
export async function* walkFiles(dir: string): AsyncGenerator<WalkedFile> {
  async function* walk(current: string, rel: string): AsyncGenerator<WalkedFile> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) yield* walk(abs, childRel);
      else yield { abs, rel: childRel };
    }
  }
  yield* walk(dir, "");
}

/** Path as the console messages report it. */
export function displayPath(file: string): string {
  return path.relative(process.cwd(), file);
}
