import { fetchJson } from '../js/storage.js';

let promise = null;

async function read() {
  if (typeof document !== 'undefined') return fetchJson('/replay/hero-units.json', {});
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(new URL('./hero-units.json', import.meta.url), 'utf-8'));
}

export function loadHeroUnits() {
  if (!promise) promise = read().catch(() => ({}));
  return promise;
}
