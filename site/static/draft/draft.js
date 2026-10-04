import { renderLanding, renderLobby, renderDraft, renderResult, renderMapPick, normalizeLobbyCode } from "./draft-ui.js";
import { createStorage } from "./draft-storage.js";
import { createInitialState, applyEvent, teamOnClock, teamForRole, currentPhase, isDraftComplete } from "./draft-state.js";
import { updateSelectGridSearchQuery } from "../js/search.js";
import { createTimer } from "./draft-timer.js";
import { createNet, electHost } from "./draft-net.js";
import { encodeSnapshot, decodeSnapshot } from "./draft-snapshot.js";
import { summarizeGame, seriesLockedHeroes, openMaps } from "./draft-series.js";

const root = document.getElementById("draft-root");
const storage = createStorage();
const params = new URLSearchParams(location.search);

let draftData = null;
let net = null;
let timer = null;
let state = null;            // canonical draft state once draft starts
let role = null;             // "captain-blue" | "captain-red" | "spectator"
let isHost = false;
let mySelfPeerId = null;
let mySelfCaptainId = null;
let myName = "";
let highlight = null;
let draftSearchQuery = "";
let draftSearchShouldFocus = false;
let draftHeroShouldFocus = null;
let seqCounter = 0;
let lobby = null;            // { code, hostPeerId, captains, hostConfig, series }
let finalized = false;
let soloCheckTimeout = null; // pending timer to detect solo arrival

const LOBBY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEFAULT_HOST_CONFIG = {
  timerMode: "timed",
  firstPick: "random",
  mapPickMode: "captain",
  map: null,
  fearless: false,
  presetLocked: [],
};

function genLobbyCode() {
  let s = "";
  for (let i = 0; i < 4; i++) s += LOBBY_CODE_ALPHABET[Math.floor(Math.random() * LOBBY_CODE_ALPHABET.length)];
  return s;
}

function genCaptainId() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

function updateMyUrl(lobbyCode) {
  history.replaceState(null, "", `?lobby=${lobbyCode}`);
}

async function bootstrap() {
  try {
    const r = await fetch("/draft/draft-data.json");
    draftData = await r.json();
  } catch (e) {
    root.innerHTML = "<p>Failed to load draft data. Refresh to retry.</p>";
    console.error(e);
    return;
  }

  const resultParam = params.get("result");
  if (resultParam) {
    try {
      const decoded = decodeSnapshot(resultParam);
      renderResult(root, { state: decoded, draftData, shareUrl: location.href, series: decoded.series ?? [] });
    } catch (e) {
      console.error("invalid result snapshot", e);
      root.textContent = "Invalid result link.";
    }
    return;
  }

  const lobbyParam = params.get("lobby");
  const savedName = storage.getName();
  const code = lobbyParam ? normalizeLobbyCode(lobbyParam) : "";
  const savedCaptainId = code ? storage.getCaptainId(code) : null;
  if (code && savedCaptainId && savedName) {
    joinLobby(savedName, code);
    return;
  }

  showLanding(code, savedName);
}

function showLanding(prefilledCode, prefilledName, message) {
  renderLanding(root, {
    prefilledCode,
    prefilledName,
    message,
    onCreate: ({ name }) => { storage.setName(name); createLobby(name); },
    onJoin:  ({ name, lobbyCode }) => { storage.setName(name); joinLobby(name, lobbyCode); },
  });
}
async function enterLobby(name, code, { role: joinRole, host }) {
  myName = name;
  mySelfCaptainId = storage.getCaptainId(code) || genCaptainId();
  role = joinRole;
  isHost = host;
  updateMyUrl(code);
  await connect(code);
  lobby = {
    code,
    hostPeerId: host ? mySelfPeerId : null,
    captains: host
      ? { blue: { peerId: mySelfPeerId, name, captainId: mySelfCaptainId }, red: null }
      : { blue: null, red: null },
    hostConfig: { ...DEFAULT_HOST_CONFIG },
    series: [],
  };
  storage.rememberLobby({ lobbyCode: code, peerId: mySelfPeerId, role, captainId: mySelfCaptainId });
  renderCurrentView();
}

async function createLobby(name) {
  await enterLobby(name, genLobbyCode(), { role: "captain-blue", host: true });
}

async function joinLobby(name, lobbyCode) {
  await enterLobby(name, lobbyCode, { role: "spectator", host: false });

  soloCheckTimeout = setTimeout(() => {
    soloCheckTimeout = null;
    if (net.getPeers().length > 1) return; // other peers joined, all good
    const snapshot = storage.getSnapshot(lobbyCode);
    if (snapshot) {
      state = snapshot;
      renderCurrentView();
    } else {
      try { net.leave(); } catch {}
      net = null;
      lobby = null;
      history.replaceState(null, "", location.pathname);
      showLanding("", name, "This lobby is no longer active. Start a new lobby or join a different one.");
    }
  }, 4000);
}

async function connect(lobbyCode) {
  net = await createNet({
    lobbyCode,
    role,
    onCommand: handleCommand,
    onEvent: handleEvent,
    onPeers: handlePeers,
    onHostElection: handleElection,
  });
  mySelfPeerId = net.peerId;
}

function nextSeq() { return ++seqCounter; }

function persistSnapshot() {
  if (state && lobby?.code) storage.saveSnapshot(lobby.code, state);
}

function broadcastEvent(msg) {
  const wrapped = { seq: nextSeq(), hostPeerId: mySelfPeerId, ...msg };
  net.sendEvent(wrapped);
  return wrapped;
}

function handleCommand(msg, fromPeerId) {
  if (!isHost) return; // only host processes commands
  if (!msg || !msg.kind) return;

  switch (msg.kind) {
    case "hello":
      seatPeer(fromPeerId, msg.name, msg.captainId);
      break;
    case "lobby-pick-map":
      setMap(msg.map);
      break;
    case "ban":
    case "pick":
    case "pick-chogall":
      if (!state) return;
      try {
        const event = { kind: msg.kind, team: msg.team, hero: msg.hero, now: Date.now() };
        advanceState(event);
      } catch (e) {
        console.warn("rejected captain action:", e.message);
      }
      break;
  }
}

function seatPeer(peerId, name, captainId) {
  if (captainId) {
    if (lobby.captains.blue?.captainId === captainId) {
      lobby.captains.blue = { peerId, name, captainId };
      broadcastEvent({ kind: "role-assign", peerId, role: "captain-blue" });
      broadcastLobby();
      return;
    }
    if (lobby.captains.red?.captainId === captainId) {
      lobby.captains.red = { peerId, name, captainId };
      broadcastEvent({ kind: "role-assign", peerId, role: "captain-red" });
      broadcastLobby();
      return;
    }
  }
  if (lobby.captains.blue?.peerId === peerId || lobby.captains.red?.peerId === peerId) {
    broadcastLobby();
    return;
  }
  let assignedRole = "spectator";
  if (!lobby.captains.blue) {
    lobby.captains.blue = { peerId, name, captainId };
    assignedRole = "captain-blue";
  } else if (!lobby.captains.red) {
    lobby.captains.red = { peerId, name, captainId };
    assignedRole = "captain-red";
  }
  broadcastEvent({ kind: "role-assign", peerId, role: assignedRole });
  broadcastLobby();
}

function mapIsOpen(map) {
  return openMaps(draftData.battlegrounds, lobby.series).some(b => b.slug === map);
}

function setMap(map) {
  if (state || lobby.hostConfig.map || !mapIsOpen(map)) return;
  lobby.hostConfig = { ...lobby.hostConfig, map };
  if (betweenGames()) startDraft();
  else broadcastLobby();
}

function pickMap({ map }) {
  if (isHost) setMap(map);
  else net.sendCommand({ kind: "lobby-pick-map", map });
}

function lobbyMessage() {
  return { hostPeerId: mySelfPeerId, captains: lobby.captains, hostConfig: lobby.hostConfig, series: lobby.series };
}

function applyLobbyMessage(msg) {
  lobby.hostPeerId = msg.hostPeerId ?? lobby.hostPeerId;
  lobby.captains = msg.captains;
  lobby.hostConfig = msg.hostConfig;
  lobby.series = msg.series ?? lobby.series;
  if (msg.captains.blue?.peerId === mySelfPeerId) role = "captain-blue";
  else if (msg.captains.red?.peerId === mySelfPeerId) role = "captain-red";
}

function resetDraftInput() {
  highlight = null;
  draftSearchQuery = "";
  draftSearchShouldFocus = false;
  draftHeroShouldFocus = null;
}

function broadcastLobby() {
  if (lobby.captains.blue && lobby.captains.red && lobby.hostConfig.firstPick === "random") {
    lobby.hostConfig = { ...lobby.hostConfig, firstPick: Math.random() < 0.5 ? "blue" : "red" };
  }
  broadcastEvent({ kind: "lobby-update", ...lobbyMessage() });
  renderCurrentView();
}

function handleEvent(msg, _fromPeerId) {
  if (!msg || !msg.kind) return;
  switch (msg.kind) {
    case "role-assign":
      if (msg.peerId === mySelfPeerId) role = msg.role;
      break;
    case "lobby-update":
      if (lobby) applyLobbyMessage(msg);
      break;
    case "next-game":
      if (!lobby) return;
      applyLobbyMessage(msg);
      state = null;
      resetDraftInput();
      storage.clearSnapshot(lobby.code);
      armTimerForState();
      break;
    case "series-end":
      finalize();
      break;
    case "draft-start":
      state = msg.state;
      persistSnapshot();
      armTimerForState();
      break;
    case "commit":
      try {
        if (msg.state) {
          state = msg.state;
        } else if (state) {
          state = applyEvent(state, msg.event);
        } else {
          return;
        }
        resetDraftInput();
        persistSnapshot();
        armTimerForState();
      } catch (e) {
        console.warn("could not apply event:", e.message);
      }
      break;
    case "snapshot":
      state = msg.state;
      persistSnapshot();
      armTimerForState();
      break;
    case "host-claim":
      collectElectionClaim({ peerId: msg.fromPeerId, lastSeenSeq: msg.lastSeenSeq });
      break;
  }
  renderCurrentView();
}

function handlePeers(event) {
  if (event?.kind === "join") {
    if (soloCheckTimeout) {
      clearTimeout(soloCheckTimeout);
      soloCheckTimeout = null;
    }
    if (isHost) {
      if (lobby) net.sendEvent({ seq: nextSeq(), kind: "lobby-update", ...lobbyMessage() }, event.peerId);
      if (state) net.sendEvent({ seq: nextSeq(), hostPeerId: mySelfPeerId, kind: "snapshot", state }, event.peerId);
    } else {
      net.sendCommand({ kind: "hello", captainId: mySelfCaptainId, name: myName });
    }
  }
  renderCurrentView();
}

let electionClaims = null;
let electionTimeout = null;

function collectElectionClaim(claim) {
  if (!electionClaims) return;
  if (!electionClaims.some(c => c.peerId === claim.peerId)) electionClaims.push(claim);
}

function handleElection({ leavingPeerId, lastSeenSeq, selfPeerId }) {
  const hostLeft =
    (lobby && lobby.hostPeerId === leavingPeerId) ||
    (state && state.hostPeerId === leavingPeerId);
  if (!hostLeft) return;
  if (isHost) return;

  electionClaims = [{ peerId: selfPeerId, lastSeenSeq }];
  net.sendEvent({ seq: nextSeq(), kind: "host-claim", fromPeerId: selfPeerId, lastSeenSeq });

  clearTimeout(electionTimeout);
  electionTimeout = setTimeout(() => {
    const winner = electHost(electionClaims);
    electionClaims = null;
    if (winner !== selfPeerId) return;
    isHost = true;
    if (state) {
      state = applyEvent(state, { kind: "host-handoff", newHostPeerId: selfPeerId });
      broadcastEvent({ kind: "snapshot", state });
    } else if (lobby) {
      lobby.hostPeerId = selfPeerId;
      broadcastLobby();
    }
  }, 600);
}

function startDraft() {
  if (!isHost || !lobby) return;
  if (!lobby.captains.blue || !lobby.captains.red) return;
  const { map, fearless, presetLocked, timerMode } = lobby.hostConfig;
  if (!map) return;
  let fp = lobby.hostConfig.firstPick;
  if (fp === "random") fp = Math.random() < 0.5 ? "blue" : "red";
  if (fp !== "blue" && fp !== "red") return;
  state = createInitialState({
    lobbyCode: lobby.code,
    hostPeerId: mySelfPeerId,
    captains: lobby.captains,
    firstPick: fp,
    timerMode,
    map,
    locked: fearless ? seriesLockedHeroes(presetLocked, lobby.series) : [],
    game: fearless ? lobby.series.length + 1 : null,
    now: Date.now(),
  });
  broadcastEvent({ kind: "draft-start", state });
  armTimerForState();
  renderCurrentView();
}

function advanceState(event) {
  state = applyEvent(state, event);
  highlight = null;
  draftSearchQuery = "";
  persistSnapshot();
  broadcastEvent({ kind: "commit", event, state });
  armTimerForState();
  renderCurrentView();
}

function startNextGame(firstPick) {
  if (!isHost || !state || !isDraftComplete(state)) return;
  lobby.series = [...lobby.series, summarizeGame(state)];
  const pool = openMaps(draftData.battlegrounds, lobby.series);
  const rolled = lobby.hostConfig.mapPickMode === "random" ? pool[Math.floor(Math.random() * pool.length)] : null;
  lobby.hostConfig = { ...lobby.hostConfig, firstPick, map: null };
  state = null;
  resetDraftInput();
  storage.clearSnapshot(lobby.code);
  broadcastEvent({ kind: "next-game", ...lobbyMessage() });
  armTimerForState();
  if (rolled) setMap(rolled.slug);
  else renderCurrentView();
}

function endSeries() {
  if (!isHost || !state || !isDraftComplete(state)) return;
  broadcastEvent({ kind: "series-end" });
  finalize();
}

function inSeries() {
  return !!lobby?.hostConfig.fearless;
}

function betweenGames() {
  return !state && inSeries() && lobby.series.length > 0;
}

function armTimerForState() {
  if (!timer) {
    timer = createTimer({
      onTick: () => updateTimerView(),
      onExpire: () => {
        if (!isHost || !state || isDraftComplete(state)) return;
        const available = draftData.heroes.map(h => h.id);
        try {
          advanceState({ kind: "timeout", now: Date.now(), available, highlighted: highlight });
        } catch (e) {
          console.error("timeout auto-commit failed:", e);
        }
      },
    });
  }
  timer.setDeadline(state?.turnDeadline ?? null);
  lastTimerSec = -1;
}

let lastTimerSec = -1;
function updateTimerView() {
  if (!state || isDraftComplete(state)) return;
  if (state.timerMode !== "timed") return;
  const sec = Math.max(0, Math.ceil((state.turnDeadline - Date.now()) / 1000));
  if (sec === lastTimerSec) return;
  lastTimerSec = sec;
  const timerEl = root.querySelector(".draft-timer");
  if (!timerEl) return;
  timerEl.textContent = `${sec}s`;
  timerEl.classList.toggle("draft-timer--critical", sec <= 5);
  timerEl.classList.toggle("draft-timer--warn", sec > 5 && sec <= 10);
}

function finalize() {
  if (finalized || !state) return;
  finalized = true;
  const series = inSeries() ? lobby.series : [];
  const shareState = {
    ...state,
    captains: {
      blue: state.captains.blue ? { name: state.captains.blue.name } : null,
      red:  state.captains.red  ? { name: state.captains.red.name }  : null,
    },
    ...(series.length ? { series } : {}),
  };
  const encoded = encodeSnapshot(shareState);
  const share = `${location.origin}${location.pathname}?result=${encoded}`;
  history.replaceState(null, "", `?result=${encoded}`);
  if (lobby) { storage.clearLobby(lobby.code); storage.clearSnapshot(lobby.code); }
  if (timer) timer.setDeadline(null);
  try { net?.leave(); } catch {}
  net = null;
  renderResult(root, { state, draftData, shareUrl: share, series });
}

function leaveLobby() {
  try { net?.leave(); } catch {}
  if (lobby) { storage.clearLobby(lobby.code); storage.clearSnapshot(lobby.code); }
  history.replaceState(null, "", location.pathname);
  location.reload();
}

function renderCurrentView() {
  if (!draftData || finalized) return;
  if (state && isDraftComplete(state)) {
    if (!inSeries()) {
      finalize();
      return;
    }
    renderResult(root, {
      state, draftData, series: lobby.series,
      live: {
        isHost,
        captains: state.captains,
        onNextGame: startNextGame,
        onEndSeries: endSeries,
      },
    });
    return;
  }
  if (state) {
    const remaining = state.turnDeadline ? (state.turnDeadline - Date.now()) / 1000 : 0;
    const focusSearch = draftSearchShouldFocus || document.activeElement?.matches?.(".draft-search__input");
    const focusHero = draftHeroShouldFocus;
    draftSearchShouldFocus = false;
    draftHeroShouldFocus = null;
    renderDraft(root, {
      state, draftData, role, highlight, searchQuery: draftSearchQuery, focusSearch, focusHero,
      timerSeconds: remaining,
      onHighlight: ({ hero, focusHero }) => {
        const myTeam = teamForRole(role);
        if (!myTeam || teamOnClock(state) !== myTeam) return;
        highlight = hero;
        if (focusHero) draftHeroShouldFocus = hero;
        renderCurrentView();
      },
      onSearchQueryChange: ({ query }) => {
        draftSearchQuery = query;
        draftSearchShouldFocus = true;
        renderCurrentView();
      },
      onLockIn: ({ hero }) => {
        const myTeam = teamForRole(role);
        if (!myTeam || teamOnClock(state) !== myTeam) return;
        const action = currentPhase(state).action;
        const isChogallPick = action === "pick" && (hero === "Chogall" || hero === "Gall");
        const kind = isChogallPick ? "pick-chogall" : action;
        draftSearchQuery = "";
        draftSearchShouldFocus = false;
        draftHeroShouldFocus = null;
        if (isHost) {
          try { advanceState({ kind, team: myTeam, hero, now: Date.now() }); }
          catch (e) { console.warn(e.message); }
        } else {
          net.sendCommand({ kind, team: myTeam, hero });
          renderCurrentView();
        }
      },
    });
    return;
  }
  if (betweenGames()) {
    renderMapPick(root, {
      draftData, role,
      captains: lobby.captains,
      hostConfig: lobby.hostConfig,
      series: lobby.series,
      onPickMap: pickMap,
    });
    return;
  }
  if (lobby) {
    renderLobby(root, {
      lobbyCode: lobby.code,
      captains: lobby.captains,
      role, isHost,
      hostConfig: lobby.hostConfig,
      draftData,
      onConfigChange: (c) => {
        if (!isHost) return;
        lobby.hostConfig = c;
        broadcastLobby();
      },
      onPickMap: pickMap,
      onStartDraft: () => startDraft(),
      onLeave: () => leaveLobby(),
    });
  }
}

document.addEventListener("keydown", (e) => {
  if (root.dataset.state !== "drafting") return;
  const target = e.target;
  if (target?.isContentEditable) return;
  if (target?.matches?.("input, textarea, select")) return;
  const next = updateSelectGridSearchQuery(draftSearchQuery, {
    key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    altKey: e.altKey,
  });
  if (next === draftSearchQuery) return;
  if (e.key !== "Escape") {
    e.preventDefault();
    draftSearchShouldFocus = true;
  }
  draftSearchQuery = next;
  renderCurrentView();
});

bootstrap();
