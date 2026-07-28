
export async function fetchJson(path, fallback) {
  try {
    const response = await fetch(path);
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

export function getStoredBoolean(storage, key, fallback = false) {
  try {
    const value = storage?.getItem(key);
    if (value === null || value === undefined) return fallback;
    return value === "true";
  } catch {
    return fallback;
  }
}
export function getStoredString(storage, key, fallback = "", allowed = null) {
  try {
    const value = storage?.getItem(key);
    if (value === null || value === undefined) return fallback;
    if (allowed && !allowed.includes(value)) return fallback;
    return value;
  } catch {
    return fallback;
  }
}

export function setStoredString(storage, key, value) {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function setStoredBoolean(storage, key, value) {
  if (!storage) return false;
  try {
    storage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function getAvailableStorage(storageOwner = globalThis) {
  try {
    return storageOwner?.localStorage || null;
  } catch {
    return null;
  }
}

let aliasPromise;
export function loadAliases() {
  if (!aliasPromise) aliasPromise = fetchJson("/hero-aliases.json", {});
  return aliasPromise;
}

let siteIndexPromise;
export function loadSiteIndex() {
  if (!siteIndexPromise) siteIndexPromise = fetchJson("/site-search.json", []);
  return siteIndexPromise;
}

export const DATAMINING_STORAGE_KEY = "hotsixors.datamining";

export function isDataminingSearchEntry(entry) {
  const url = String(entry?.url || entry?.path || "");
  const type = String(entry?.type || "");
  return url.startsWith("/gamedata") || url.includes("/gamedata/") || type.toLowerCase().includes("game data");
}

export function isDataminingEnabled() {
  return document.documentElement.classList.contains("datamining-enabled");
}

export function applyDataminingState(enabled) {
  document.documentElement.classList.toggle("datamining-enabled", enabled);
  for (const toggle of document.querySelectorAll("[data-datamining-toggle]")) {
    toggle.checked = enabled;
    toggle.setAttribute("aria-checked", String(enabled));
  }
}

let gameDataTreePromise;
export function loadGameDataTree() {
  if (!gameDataTreePromise) gameDataTreePromise = fetchJson("/gamedata-tree.json", { children: [] });
  return gameDataTreePromise;
}
