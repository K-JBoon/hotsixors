// Finds .StormReplay files in a folder the visitor picks, summarizes the new
// ones in workers and keeps the summaries in IndexedDB.

import { SUMMARY_VERSION } from '../replay/summary.js';
import { deleteSummaries, loadSummaries, saveSummaries } from './local-store.js';

const SAVE_EVERY = 25;
const isReplay = (name) => name.endsWith('.StormReplay');
const fileKey = (path, file) => `${path}|${file.size}|${file.lastModified}`;

export const canPickFolder = () => typeof window.showDirectoryPicker === 'function';

async function* walk(dir, prefix = '') {
  for await (const entry of dir.values()) {
    const path = `${prefix}${entry.name}`;
    if (entry.kind === 'directory') yield* walk(entry, `${path}/`);
    else if (isReplay(entry.name)) yield { path, getFile: () => entry.getFile() };
  }
}

/** `source` is a FileSystemDirectoryHandle, a FileList or `[{ path, file }]`. */
async function listReplays(source) {
  const out = [];
  if (source instanceof FileList) {
    for (const file of source) if (isReplay(file.name)) out.push({ key: fileKey(file.webkitRelativePath || file.name, file), file });
    return out;
  }
  if (Array.isArray(source)) return source.filter(({ path }) => isReplay(path)).map(({ path, file }) => ({ key: fileKey(path, file), file }));
  for await (const { path, getFile } of walk(source)) {
    const file = await getFile();
    out.push({ key: fileKey(path, file), file });
  }
  return out;
}

const entryFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
async function entryChildren(dir) {
  const reader = dir.createReader();
  const out = [];
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return out;
    out.push(...batch);
  }
}
async function walkEntries(entries) {
  const out = [];
  for (const entry of entries) {
    if (entry.isDirectory) out.push(...(await walkEntries(await entryChildren(entry))));
    else if (isReplay(entry.name)) out.push({ path: entry.fullPath.replace(/^\//, ''), file: await entryFile(entry) });
  }
  return out;
}

/**
 * Reads a drop. A single dropped folder comes back as a handle where the
 * browser supports it, so it can be rescanned later; otherwise as files.
 * Items must be read before the first await: the DataTransfer empties after.
 */
export async function droppedReplays(dataTransfer) {
  const items = [...dataTransfer.items].filter((i) => i.kind === 'file');
  const handles = items.map((i) => i.getAsFileSystemHandle?.());
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (handles.length === 1 && handles[0]) {
    const handle = await handles[0].catch(() => null);
    if (handle?.kind === 'directory') return { handle };
  }
  return { files: await walkEntries(entries) };
}

/** True when the saved folder can be read without a new permission prompt. */
export async function hasReadPermission(handle) {
  return (await handle.queryPermission?.({ mode: 'read' })) === 'granted';
}

export async function requestReadPermission(handle) {
  return (await handle.requestPermission?.({ mode: 'read' })) === 'granted';
}

const isCurrent = (summary) => summary?.v === SUMMARY_VERSION;

/** Compares a folder with the stored summaries without parsing anything. */
export async function folderDiff(source, known) {
  known ??= await loadSummaries();
  const files = await listReplays(source);
  const present = new Set(files.map((f) => f.key));
  return {
    files,
    todo: files.filter(({ key }) => !isCurrent(known.get(key))),
    removed: [...known.keys()].filter((key) => !present.has(key)),
  };
}

/**
 * Summarizes replays not yet stored. With `prune`, also drops stored replays
 * missing from `source`. Calls `onProgress({ done, total, failed, found, removed })`
 * and resolves to all stored summaries.
 */
export async function scanReplays(source, { workerUrl, prune = false, onProgress = () => {}, signal } = {}) {
  const known = await loadSummaries();
  const { files, todo, removed } = await folderDiff(source, known);
  if (prune && removed.length) {
    await deleteSummaries(removed);
    for (const key of removed) known.delete(key);
  }
  const progress = { done: 0, total: todo.length, failed: 0, found: files.length, removed: prune ? removed.length : 0 };
  onProgress(progress);

  const lanes = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const workers = Array.from({ length: Math.min(lanes, todo.length) }, () => new Worker(workerUrl, { type: 'module' }));
  const pending = [];
  const flush = async () => {
    if (pending.length) await saveSummaries(pending.splice(0));
  };

  let next = 0;
  await Promise.all(workers.map(async (worker) => {
    while (next < todo.length && !signal?.aborted) {
      const { key, file } = todo[next++];
      const reply = await new Promise((resolve) => {
        worker.onmessage = ({ data }) => resolve(data);
        worker.onerror = (e) => resolve({ key, error: e.message });
        worker.postMessage({ key, file });
      });
      const summary = reply.summary ?? { id: key, v: SUMMARY_VERSION, error: reply.error };
      if (reply.error) progress.failed++;
      known.set(key, summary);
      pending.push([key, summary]);
      progress.done++;
      onProgress(progress);
      if (pending.length >= SAVE_EVERY) await flush();
    }
    worker.terminate();
  }));
  await flush();
  return known;
}

/** One summary per game: the same match can sit in several account folders. */
export function uniqueGames(summaries) {
  const seen = new Map();
  for (const s of summaries) {
    if (s.error || !s.players) continue;
    const id = `${s.date}|${s.players.map((p) => p.toon).sort().join(',')}`;
    if (!seen.has(id)) seen.set(id, s);
  }
  return [...seen.values()];
}
