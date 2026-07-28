
const KEY = "hotsixors.draft.lobbies";
const NAME_KEY = "hotsixors.draft.name";
const SNAPSHOT_PREFIX = "hotsixors.draft.snap.";
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

export function createStorage({ backend, now } = {}) {
  const store = backend ?? (typeof localStorage !== "undefined" ? localStorage : memoryFallback());
  const clock = now ?? (() => Date.now());

  function read() {
    try {
      const raw = store.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function write(arr) {
    try { store.setItem(KEY, JSON.stringify(arr)); } catch { /* quota / disabled */ }
  }

  return {
    rememberLobby({ lobbyCode, peerId, role, captainId }) {
      const t = clock();
      const existing = read().find(e => e.lobbyCode === lobbyCode);
      const arr = read().filter(e => e.lobbyCode !== lobbyCode);
      arr.unshift({ lobbyCode, peerId, role, captainId: captainId ?? existing?.captainId, t });
      write(arr.slice(0, 20));
    },
    getActiveLobby() {
      const arr = read();
      if (!arr.length) return null;
      const e = arr[0];
      if (clock() - e.t > ACTIVE_WINDOW_MS) return null;
      return { lobbyCode: e.lobbyCode, peerId: e.peerId, role: e.role, captainId: e.captainId };
    },
    getCaptainId(lobbyCode) {
      const e = read().find(x => x.lobbyCode === lobbyCode);
      return e?.captainId ?? null;
    },
    clearLobby(lobbyCode) {
      write(read().filter(e => e.lobbyCode !== lobbyCode));
    },
    setName(name) {
      try { store.setItem(NAME_KEY, String(name)); } catch {}
    },
    getName() {
      try { return store.getItem(NAME_KEY) || ""; } catch { return ""; }
    },
    saveSnapshot(lobbyCode, state) {
      try { store.setItem(SNAPSHOT_PREFIX + lobbyCode, JSON.stringify(state)); } catch {}
    },
    getSnapshot(lobbyCode) {
      try {
        const raw = store.getItem(SNAPSHOT_PREFIX + lobbyCode);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    clearSnapshot(lobbyCode) {
      try { store.removeItem(SNAPSHOT_PREFIX + lobbyCode); } catch {}
    },
  };
}

function memoryFallback() {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
}
