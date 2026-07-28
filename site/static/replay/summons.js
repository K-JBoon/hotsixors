
import { fetchJson } from '../js/storage.js';

let promise = null;

async function read() {
  if (typeof document !== 'undefined') return fetchJson('/replay/summons.json', {});
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(new URL('./summons.json', import.meta.url), 'utf-8'));
}

export function loadSummons() {
  if (!promise) promise = read().catch(() => ({}));
  return promise;
}
