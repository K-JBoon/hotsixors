// IndexedDB store for summaries of the visitor's own replays, plus the folder
// handle so a later visit can rescan without picking the folder again.

const DB_NAME = 'hotsixors-my-replays';
const DB_VERSION = 1;

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('summaries');
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run(store, mode, work) {
  const tx = (await db()).transaction(store, mode);
  const result = work(tx.objectStore(store));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Map of file key → summary. */
export async function loadSummaries() {
  const tx = (await db()).transaction('summaries', 'readonly');
  const store = tx.objectStore('summaries');
  const [keys, values] = await Promise.all(
    [store.getAllKeys(), store.getAll()].map((r) => new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    })),
  );
  return new Map(keys.map((k, i) => [k, values[i]]));
}

export const saveSummaries = (entries) =>
  run('summaries', 'readwrite', (store) => {
    for (const [key, summary] of entries) store.put(summary, key);
  });

export const deleteSummaries = (keys) =>
  run('summaries', 'readwrite', (store) => {
    for (const key of keys) store.delete(key);
  });

export const clearSummaries = () => run('summaries', 'readwrite', (store) => store.clear());

export const saveSetting = (key, value) => run('settings', 'readwrite', (store) => store.put(value, key));
export const loadSetting = (key) => run('settings', 'readonly', (store) => store.get(key));
export const deleteSetting = (key) => run('settings', 'readwrite', (store) => store.delete(key));

/** Asks the browser to keep this data under storage pressure. */
export const persistStorage = () => navigator.storage?.persist?.().catch(() => false) ?? Promise.resolve(false);
