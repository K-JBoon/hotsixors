import { createNet } from '/draft/draft-net.js';
import { createStorage } from '/draft/draft-storage.js';
import { rankShots } from '/lost-in-the-nexus/nexus-game-score.js';
import {
  createGameUi,
  createShotView,
  confirmPanel,
  el,
  hudView,
  lobbyPanel,
  mapSelectPanel,
  namePanel,
  noticePanel,
  resultsPanel,
} from '/lost-in-the-nexus/nexus-game-ui.js';

const APP_ID = 'hotsixors-nexus-snapshot';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;
// One slot per max player, so every lobby member keeps a distinct colour.
const PLAYER_COLORS = ['#e6474c', '#4c9be6', '#4cd97a', '#e6b93c', '#b073e6', '#e67ba3', '#3ddbd0', '#e68a3c'];
const HOST_SHOT_MS = 60_000;
const SUBMIT_GRACE_MS = 4000;
const REVEAL_MS = 1400;
const PODIUM_MS = 2400;
const DEFAULT_LIMIT_SEC = 180;
const MAP_CHOICES = 3;
const SHOT_SIZE = [960, 540];
const THUMB_SIZE = [320, 180];
// Standard battlegrounds plus Snow Brawl and Garden of Terror Classic.
const ALLOWED_MAP_SLUGS = new Set([
  'alterac-pass',
  'battlefield-of-eternity',
  'blackhearts-bay',
  'braxis-holdout',
  'cursed-hollow',
  'dragon-shire',
  'garden-of-terror',
  'hanamura-temple',
  'haunted-mines',
  'infernal-shrines',
  'sky-temple',
  'tomb-of-the-spider-queen',
  'towers-of-doom',
  'volskaya-foundry',
  'warhead-junction',
  'snow-brawl',
  'garden-of-terror-classic',
]);

function genCode() {
  let out = '';
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

function allowedMaps(maps) {
  return Object.fromEntries(Object.entries(maps).filter(([slug]) => ALLOWED_MAP_SLUGS.has(slug)));
}

function pickChoices(maps, count) {
  const slugs = Object.keys(maps);
  for (let i = slugs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slugs[i], slugs[j]] = [slugs[j], slugs[i]];
  }
  return slugs.slice(0, count).map((slug) => ({ slug, name: maps[slug].name || slug, bytes: maps[slug].bytes }));
}

export function createNexusGame({ nexus, page, lobbyCode, setStatus }) {
  const storage = createStorage();
  const view = createGameUi({ page });
  const shots = createShotView({ shotHost: view.shotHost });

  let net = null;
  let selfPeerId = null;
  let isHost = false;
  let myName = '';
  let code = lobbyCode || '';
  let phase = 'name';
  let players = [];          // { peerId, name, isHost, loaded, shot, auto, lockedAt }
  let choices = [];
  let limitSec = DEFAULT_LIMIT_SEC;
  let mapSlug = null;
  let hostShot = null;
  let deadline = null;       // local epoch ms
  let hostDeadline = null;
  let mapLoaded = false;
  let mySubmitted = false;
  let confirming = null;
  let seq = 0;
  let finished = false;
  let hostShotAt = 0;
  let mapPanelShown = false;
  let posTimer = null;

  const me = () => players.find((p) => p.peerId === selfPeerId);
  const guessers = () => players.filter((p) => !p.isHost);
  // Join order, not turn order: stable across leaves so a colour never jumps.
  const colorFor = (peerId) => PLAYER_COLORS[players.findIndex((p) => p.peerId === peerId) % PLAYER_COLORS.length];
  const publicPlayers = () => players.map(({ peerId, name, isHost: host, loaded, shot }) => ({
    peerId, name, isHost: host, loaded, submitted: !!shot,
  }));

  function broadcast(msg, target) {
    net?.sendEvent({ seq: ++seq, ...msg }, target);
  }

  function setPanel(node, { freeze = true } = {}) {
    view.setPanel(node);
    nexus.setFlyEnabled(!(node && freeze));
  }

  async function connect() {
    net = await createNet({
      lobbyCode: code,
      appId: APP_ID,
      onCommand: handleCommand,
      onEvent: handleEvent,
      onPeers: handlePeers,
    });
    selfPeerId = net.peerId;
  }

  function showName() {
    phase = 'name';
    setPanel(namePanel({
      name: storage.getName(),
      lobbyCode: code,
      onSubmit: async (name) => {
        storage.setName(name);
        myName = name;
        setPanel(noticePanel({ title: 'Connecting…' }));
        if (code) await joinLobby();
        else await hostLobby();
      },
    }));
  }

  async function hostLobby() {
    isHost = true;
    code = genCode();
    await connect();
    players = [{ peerId: selfPeerId, name: myName, isHost: true, loaded: false, shot: null }];
    history.replaceState(null, '', `?game=${code}`);
    phase = 'lobby';
    render();
  }

  async function joinLobby() {
    await connect();
    history.replaceState(null, '', `?game=${code}`);
    phase = 'lobby';
    setPanel(noticePanel({ title: 'Looking for the lobby…', body: `Lobby ${code}`, onLeave: leave }));
  }

  function handlePeers(event) {
    if (event?.kind === 'join' && !isHost) {
      net.sendCommand({ kind: 'hello', name: myName });
      return;
    }
    if (event?.kind !== 'leave') return;
    if (!isHost) {
      // No migration: without the host there is no picture to guess at.
      if (players.find((p) => p.peerId === event.peerId)?.isHost && !finished) {
        nexus.setFlyEnabled(false);
        setPanel(noticePanel({ title: 'The host left', body: 'This game is over.', onLeave: leave }));
      }
      return;
    }
    players = players.filter((p) => p.peerId !== event.peerId);
    broadcast({ kind: 'lobby', players: publicPlayers(), phase });
    render();
    if (phase === 'player-shot' && guessers().length && guessers().every((p) => p.shot)) finish();
  }

  function handleCommand(msg, fromPeerId) {
    if (!isHost || !msg?.kind) return;
    switch (msg.kind) {
      case 'hello': {
        if (players.some((p) => p.peerId === fromPeerId)) break;
        if (phase !== 'lobby') {
          broadcast({ kind: 'rejected', reason: 'The game has already started.' }, fromPeerId);
          break;
        }
        if (players.length >= MAX_PLAYERS) {
          broadcast({ kind: 'rejected', reason: 'The lobby is full.' }, fromPeerId);
          break;
        }
        players = [...players, { peerId: fromPeerId, name: msg.name || 'Player', isHost: false, loaded: false, shot: null }];
        broadcast({ kind: 'lobby', players: publicPlayers(), phase, code });
        render();
        break;
      }
      case 'ready': {
        const player = players.find((p) => p.peerId === fromPeerId);
        if (player) player.loaded = true;
        broadcast({ kind: 'progress', players: publicPlayers() });
        render();
        break;
      }
      case 'submit': {
        if (phase !== 'player-shot') break;
        const player = players.find((p) => p.peerId === fromPeerId);
        if (!player || player.shot) break;
        player.shot = msg.shot;
        player.auto = !!msg.auto;
        broadcast({ kind: 'progress', players: publicPlayers() });
        render();
        if (guessers().every((p) => p.shot)) finish();
        break;
      }
      case 'position': {
        if (phase !== 'player-shot') break;
        const player = players.find((p) => p.peerId === fromPeerId);
        if (!player || player.shot) break;
        player.prevPose = player.pose || msg.shot;
        player.pose = msg.shot;
        player.poseAt = Date.now();
        break;
      }
    }
  }

  function handleEvent(msg) {
    if (!msg?.kind || isHost) return;
    switch (msg.kind) {
      case 'lobby':
        players = msg.players;
        phase = msg.phase === 'lobby' ? 'lobby' : phase;
        render();
        break;
      case 'rejected':
        setPanel(noticePanel({ title: 'Cannot join', body: msg.reason, onLeave: leave }));
        break;
      case 'map-options':
        phase = 'map-select';
        choices = msg.choices;
        limitSec = msg.limitSec;
        render();
        break;
      case 'map-chosen':
        limitSec = msg.limitSec;
        beginLoad(msg.slug);
        break;
      case 'host-timer':
        hostDeadline = Date.now() + msg.duration;
        if (mapLoaded) phase = 'host-shot';
        render();
        break;
      case 'host-shot':
        hostShot = msg.shot;
        hostShotAt = Date.now();
        hostDeadline = null;
        beginGuessing(msg.limit);
        break;
      case 'progress':
        players = msg.players.map((p) => ({ ...players.find((q) => q.peerId === p.peerId), ...p }));
        render();
        break;
      case 'results':
        showResults(msg.entries, msg.target);
        break;
      case 'host-transfer':
        if (msg.hostPeerId === selfPeerId) { isHost = true; seq = msg.seq; }
        players = msg.players;
        render();
        break;
      case 'restart':
        finished = false;
        hostShot = null;
        hostDeadline = null;
        deadline = null;
        mapLoaded = false;
        mapSlug = null;
        mapPanelShown = false;
        mySubmitted = false;
        confirming = null;
        shots.hide();
        players = msg.players;
        phase = 'lobby';
        render();
        break;
    }
  }

  function startGame() {
    if (!isHost || guessers().length < 1) return;
    phase = 'map-select';
    choices = pickChoices(allowedMaps(nexus.maps), MAP_CHOICES);
    broadcast({ kind: 'map-options', choices, limitSec });
    render();
  }

  function transferHost(newHostPeerId) {
    if (!isHost || phase !== 'lobby' || newHostPeerId === selfPeerId) return;
    players = players.map((p) => ({ ...p, isHost: p.peerId === newHostPeerId }));
    broadcast({ kind: 'host-transfer', hostPeerId: newHostPeerId, players: publicPlayers() });
    isHost = false;
    render();
  }

  // Same lobby, same players, back to the top: only the round state resets.
  function playAgain() {
    if (!isHost) return;
    players = players.map((p) => ({ ...p, loaded: false, shot: null, auto: false, pose: null }));
    finished = false;
    hostShot = null;
    hostDeadline = null;
    deadline = null;
    mapLoaded = false;
    mapSlug = null;
    mapPanelShown = false;
    mySubmitted = false;
    confirming = null;
    shots.hide();
    updateWisps();
    phase = 'lobby';
    broadcast({ kind: 'restart', players: publicPlayers() });
    render();
  }

  // Live pins on the map for whoever the host is watching search; a click
  // moves the host's own camera to that player's current spot. Positions only
  // arrive every WISP_BROADCAST_MS, so the dot is interpolated toward the
  // latest sample rather than snapping, and the loop below runs far more
  // often than the network traffic that feeds it.
  function updateWisps() {
    if (!isHost || phase !== 'player-shot') {
      nexus.setWisps([]);
      return;
    }
    const now = Date.now();
    const entries = guessers().filter((p) => p.pose && !p.shot).map((p) => {
      const t = p.poseAt ? Math.min(1, (now - p.poseAt) / WISP_BROADCAST_MS) : 1;
      const from = p.prevPose?.p || p.pose.p;
      const to = p.pose.p;
      return { id: p.peerId, name: p.name, color: colorFor(p.peerId), p: from.map((v, i) => v + (to[i] - v) * t) };
    });
    nexus.setWisps(entries, (id) => {
      const player = players.find((p) => p.peerId === id);
      if (player?.pose) nexus.applyShot(player.pose);
    });
  }

  const WISP_BROADCAST_MS = 800;

  function startPositionBroadcast() {
    stopPositionBroadcast();
    posTimer = setInterval(() => {
      if (isHost || phase !== 'player-shot' || mySubmitted || !mapLoaded) return;
      net.sendCommand({ kind: 'position', shot: nexus.getShot() });
    }, WISP_BROADCAST_MS);
  }

  function stopPositionBroadcast() {
    clearInterval(posTimer);
    posTimer = null;
  }

  function chooseMap(slug) {
    if (!isHost) return;
    broadcast({ kind: 'map-chosen', slug, limitSec });
    beginLoad(slug);
  }

  async function beginLoad(slug) {
    mapSlug = slug;
    mapLoaded = false;
    phase = 'loading';
    shots.hide();
    setPanel(noticePanel({ title: `Loading ${nexus.maps[slug]?.name || slug}…`, body: 'Stukov is a good hero btw' }));
    const ok = await nexus.loadMap(slug, (text) => setStatus(text));
    setStatus('');
    if (!ok) {
      setPanel(noticePanel({ title: 'That battleground failed to load', onLeave: leave }));
      return;
    }
    nexus.frame();
    mapLoaded = true;
    setPanel(null);
    if (isHost) {
      phase = 'host-shot';
      deadline = Date.now() + HOST_SHOT_MS;
      broadcast({ kind: 'host-timer', duration: HOST_SHOT_MS });
    } else {
      net.sendCommand({ kind: 'ready' });
      phase = 'host-shot';
      // A slow load eats into the guessing time: everyone races the same clock.
      if (hostShot) beginGuessing(limitSec * 1000 - (Date.now() - hostShotAt));
    }
    render();
  }

  function takeHostShot() {
    if (!isHost || phase !== 'host-shot') return;
    nexus.clampToSurfaces();
    hostShot = nexus.getShot();
    phase = 'player-shot';
    deadline = Date.now() + limitSec * 1000;
    broadcast({ kind: 'host-shot', shot: hostShot, limit: limitSec * 1000 });
    shots.show(nexus.renderShot(hostShot, ...SHOT_SIZE));
    render();
  }

  function beginGuessing(limitMs) {
    if (!mapLoaded || phase === 'player-shot') return;
    phase = 'player-shot';
    deadline = Date.now() + limitMs;
    shots.show(nexus.renderShot(hostShot, ...SHOT_SIZE));
    if (!isHost) startPositionBroadcast();
    render();
  }

  function offerLockIn(auto = false) {
    if (phase !== 'player-shot' || mySubmitted || isHost) return;
    nexus.clampToSurfaces();
    const shot = nexus.getShot();
    if (auto) {
      submit(shot, true);
      return;
    }
    confirming = shot;
    shots.close();
    setPanel(confirmPanel({
      image: nexus.renderShot(shot, ...SHOT_SIZE),
      onLockIn: () => submit(confirming, false),
      onRetake: () => {
        confirming = null;
        setPanel(null);
        render();
      },
    }));
  }

  function submit(shot, auto) {
    mySubmitted = true;
    confirming = null;
    stopPositionBroadcast();
    setPanel(null);
    const mine = me();
    if (mine) {
      mine.shot = shot;
      mine.auto = auto;
    }
    net.sendCommand({ kind: 'submit', shot, auto });
    render();
  }

  function finish() {
    if (!isHost || finished) return;
    finished = true;
    phase = 'results';
    const entries = guessers().filter((p) => p.shot).map((p) => ({
      peerId: p.peerId, name: p.name, shot: p.shot, auto: !!p.auto,
    }));
    const ranked = rankShots(entries, hostShot, nexus.getSpan());
    const missing = guessers().filter((p) => !p.shot).map((p, i) => ({
      peerId: p.peerId, name: p.name, shot: null, points: 0, distance: 0, angle: 0,
      auto: true, rank: ranked.length + i + 1,
    }));
    const all = [...ranked, ...missing];
    broadcast({ kind: 'results', entries: all, target: hostShot });
    showResults(all, hostShot);
  }

  // Bottom of the table first, so the winner lands last.
  function showResults(entries, target) {
    phase = 'results';
    finished = true;
    deadline = null;
    hostDeadline = null;
    shots.hide();
    updateWisps();
    const results = resultsPanel({
      target: nexus.renderShot(target, ...SHOT_SIZE),
      isHost,
      onLeave: leave,
      onPlayAgain: playAgain,
      // Thumbnails are cheap; a full-size frame is rendered only when asked for.
      onOpenImage: ({ image, shot, caption }) => {
        shots.preview(shot ? nexus.renderShot(shot, ...SHOT_SIZE) : image, caption);
      },
    });
    setPanel(results.panel);
    render();
    const ordered = [...entries].sort((a, b) => b.rank - a.rank);
    let index = 0;
    const step = () => {
      const entry = ordered[index++];
      if (!entry) return;
      results.reveal({ ...entry, image: entry.shot ? nexus.renderShot(entry.shot, ...THUMB_SIZE) : null });
      // The podium lands one at a time: the pause before each medal is longer.
      const next = ordered[index];
      if (next) setTimeout(step, next.rank <= 3 ? PODIUM_MS : REVEAL_MS);
    };
    setTimeout(step, 600);
  }

  function leave() {
    stopPositionBroadcast();
    try { net?.leave(); } catch { /* already gone */ }
    net = null;
    view.destroy();
    history.replaceState(null, '', location.pathname);
    location.reload();
  }

  function playerState(player) {
    if (phase === 'loading' || (phase === 'host-shot' && !player.isHost)) {
      return player.loaded ? 'ready' : 'loading';
    }
    if (phase === 'player-shot') {
      if (player.isHost) return 'watching';
      return player.submitted || player.shot ? 'locked in' : 'looking';
    }
    return player.isHost ? 'host' : '';
  }

  function canShoot() {
    if (phase === 'host-shot') return isHost && mapLoaded;
    if (phase === 'player-shot') return !isHost && !mySubmitted && mapLoaded;
    return false;
  }

  function actionButton() {
    if (!canShoot()) return null;
    const onClick = phase === 'host-shot' ? takeHostShot : () => offerLockIn();
    return el('button', { class: 'ng-btn ng-btn--primary', text: 'Take a Picture', onClick });
  }

  function hudLabel() {
    switch (phase) {
      case 'loading': return `Loading ${nexus.maps[mapSlug]?.name || ''}`;
      case 'host-shot': return isHost ? 'Find a spot and take your picture' : 'The host is taking a picture';
      case 'player-shot': return mySubmitted ? 'Locked in. Waiting for the others' : 'Find the spot in the picture';
      case 'results': return 'Results';
      default: return '';
    }
  }

  function render() {
    if (phase === 'lobby') {
      setPanel(lobbyPanel({
        lobbyCode: code,
        players,
        selfPeerId,
        isHost,
        onStart: startGame,
        onLeave: leave,
        onMakeHost: transferHost,
      }));
      return;
    }
    if (phase === 'map-select') {
      // Rebuilding would restart the roll animation, so it is drawn once.
      if (!mapPanelShown) {
        mapPanelShown = true;
        setPanel(mapSelectPanel({
          maps: Object.entries(allowedMaps(nexus.maps)).map(([slug, map]) => ({ slug, name: map.name || slug, bytes: map.bytes })),
          choices,
          limitSec,
          isHost,
          onPick: chooseMap,
          onLimit: (value) => { limitSec = value; },
        }));
      }
      return;
    }
    renderHud();
  }

  let hud = null;
  let hudKey = '';

  function renderHud() {
    if (phase === 'name' || phase === 'lobby' || phase === 'map-select') {
      hud = null;
      hudKey = '';
      view.setHud(null);
      return;
    }
    const clock = phase === 'host-shot' && !isHost ? hostDeadline : deadline;
    const timeLeft = clock ? Math.max(0, clock - Date.now()) : null;
    const chips = players.map((p) => ({
      peerId: p.peerId,
      name: p.name,
      color: colorFor(p.peerId),
      state: playerState(p),
      done: phase === 'player-shot' ? !!(p.submitted || p.shot) : !!p.loaded,
    }));
    const key = JSON.stringify([phase, hudLabel(), chips, timeLeft === null, canShoot()]);
    if (hud && key === hudKey) {
      hud.setClock(timeLeft);
      return;
    }
    hudKey = key;
    hud = hudView({ label: hudLabel(), timeLeft, players: chips, selfPeerId, action: actionButton() });
    view.setHud(hud.node);
  }

  const tick = setInterval(() => {
    renderHud();
    const now = Date.now();
    if (deadline && now >= deadline) {
      if (phase === 'host-shot' && isHost) takeHostShot();
      else if (phase === 'player-shot' && !isHost && !mySubmitted && mapLoaded) offerLockIn(true);
      else if (phase === 'player-shot' && isHost && now >= deadline + SUBMIT_GRACE_MS) finish();
    }
  }, 250);

  const wispTick = setInterval(updateWisps, 60);

  addEventListener('beforeunload', () => {
    clearInterval(tick);
    clearInterval(wispTick);
    stopPositionBroadcast();
    try { net?.leave(); } catch { /* already gone */ }
  });

  showName();
}
