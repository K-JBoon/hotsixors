import { createNexusScene } from '/lost-in-the-nexus/nexus-scene.js';

const view = document.getElementById('nexus-view');
const status = document.getElementById('nexus-status');
const picker = document.getElementById('nexus-map');
const shadowBox = document.getElementById('nexus-shadows');
const SHADOWS = 'hotsixors.nexus.shadows';
const bloomBox = document.getElementById('nexus-bloom');
const BLOOM = 'hotsixors.nexus.bloom';

// Geometry lives in an R2 bucket rather than alongside the page: it is hundreds
// of megabytes over tens of thousands of files. The indexes store site-absolute
// paths, so everything is resolved through here; an empty base is same-origin,
// which is what a local build serves.
const ASSETS = document.querySelector('.nexus-page')?.dataset.nexusAssets || '';

const params = new URLSearchParams(location.search);

const nexus = await createNexusScene({
  view,
  assets: ASSETS,
  pitch: Number(params.get('pitch')) || 55,
  hotkeys: {
    c: () => nexus.swapCamera(),
    h: () => setShadows(!nexus.shadowsEnabled()),
    r: () => nexus.resetCamera(),
  },
});

const { maps } = nexus;

function setStatus(text) {
  status.hidden = !text;
  status.textContent = text || '';
}

async function loadMap(slug) {
  const ok = await nexus.loadMap(slug, setStatus);
  if (!ok) return;
  nexus.frame({
    span: params.has('span') ? Number(params.get('span')) || undefined : undefined,
    cx: params.has('cx') ? Number(params.get('cx')) : undefined,
    cy: params.has('cy') ? Number(params.get('cy')) : undefined,
    flat: params.get('cam') === 'flat',
  });
  status.hidden = true;
}

function setShadows(on) {
  nexus.setShadows(on);
  shadowBox.checked = on;
  try {
    localStorage.setItem(SHADOWS, String(on));
  } catch {
    // Private mode: the choice lasts this visit.
  }
}

function setBloom(on) {
  nexus.setBloom(on);
  bloomBox.checked = on;
  try {
    localStorage.setItem(BLOOM, String(on));
  } catch {
    // Private mode: the choice lasts this visit.
  }
}

window.__nexusProbe = () => nexus.probe();

function megabytes(slug) {
  const bytes = (maps[slug]?.bytes || 0) + (nexus.terrainIndex[slug]?.bytes || 0);
  return bytes ? `${Math.round(bytes / 1e6)} MB` : 'tens of megabytes';
}

// Standard battlegrounds plus Snow Brawl and Garden of Terror Classic.
const FEATURED_MAP_SLUGS = new Set([
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

const DEFAULT_MAP = 'cursed-hollow';
const wanted = params.get('map');
const byName = (a, b) => (maps[a].name || a).localeCompare(maps[b].name || b);
const isSandbox = (slug) => slug.startsWith('sandbox-');
const featured = Object.keys(maps).filter((slug) => FEATURED_MAP_SLUGS.has(slug)).sort(byName);
const rest = Object.keys(maps).filter((slug) => !FEATURED_MAP_SLUGS.has(slug) && !isSandbox(slug)).sort(byName);
const slugs = [...featured, ...rest];
for (const slug of featured) {
  picker.add(new Option(`${maps[slug].name || slug} (${megabytes(slug)})`, slug));
}
if (featured.length && rest.length) {
  const sep = new Option('--------', '', false, false);
  sep.disabled = true;
  picker.add(sep);
}
for (const slug of rest) {
  picker.add(new Option(`${maps[slug].name || slug} (${megabytes(slug)})`, slug));
}
picker.value = maps[wanted] ? wanted : (maps[DEFAULT_MAP] ? DEFAULT_MAP : slugs[0]);

const AUTOLOAD = 'hotsixors.nexus.autoload';
const gate = document.getElementById('nexus-gate');
const gateButton = document.getElementById('nexus-gate-load');
const gateSize = document.getElementById('nexus-gate-size');
const gateRemember = document.getElementById('nexus-gate-remember');

function describeGate() {
  gateSize.textContent = megabytes(picker.value);
  gateButton.textContent = `Load ${maps[picker.value]?.name || picker.value}`;
}

function start(slug) {
  const next = new URLSearchParams(location.search);
  next.set('map', slug);
  history.replaceState(null, '', `?${next}`);
  loadMap(slug);
}

picker.onchange = () => {
  // Keeping focus would send WASD into the dropdown.
  picker.blur();
  if (gate.hidden) start(picker.value);
  else describeGate();
};

shadowBox.onchange = () => {
  // Keeping focus would send WASD into the checkbox.
  shadowBox.blur();
  setShadows(shadowBox.checked);
};

bloomBox.onchange = () => {
  // Keeping focus would send WASD into the checkbox.
  bloomBox.blur();
  setBloom(bloomBox.checked);
};

{
  const button = document.getElementById('nexus-settings');
  const panel = document.getElementById('nexus-settings-panel');
  const setOpen = (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('is-on', open);
  };
  button.onclick = (e) => {
    e.stopPropagation();
    button.blur();
    setOpen(panel.hidden);
  };
  panel.onclick = (e) => e.stopPropagation();
  addEventListener('click', () => setOpen(false));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
}

let shadowsWanted = true;
try {
  shadowsWanted = localStorage.getItem(SHADOWS) !== 'false';
} catch {
  // Private mode: default on.
}
setShadows(shadowsWanted);

let bloomWanted = true;
try {
  bloomWanted = localStorage.getItem(BLOOM) !== 'false';
} catch {
  // Private mode: default on.
}
setBloom(bloomWanted);

// Everything the guessing game needs loads on demand.
const gameButton = document.getElementById('nexus-game');

let gameStarted = false;
async function startGame(lobbyCode) {
  if (gameStarted) return;
  gameStarted = true;
  gameButton.hidden = true;
  gate.hidden = true;
  status.hidden = true;
  const { createNexusGame } = await import('/lost-in-the-nexus/nexus-game.js');
  createNexusGame({ nexus, page: document.querySelector('.nexus-page'), lobbyCode, setStatus });
}
gameButton.onclick = () => {
  gameButton.blur();
  startGame(null);
};

if (!picker.value) {
  status.textContent = 'No battlegrounds available.';
} else if (params.get('game')) {
  await startGame(params.get('game'));
} else if (readAutoload()) {
  await loadMap(picker.value);
} else {
  status.hidden = true;
  describeGate();
  gate.hidden = false;
  gateButton.onclick = () => {
    if (gateRemember.checked) {
      try {
        localStorage.setItem(AUTOLOAD, 'true');
      } catch {
        // Nothing to persist to; the choice lasts this visit.
      }
    }
    gate.hidden = true;
    start(picker.value);
  };
}

function readAutoload() {
  try {
    return localStorage.getItem(AUTOLOAD) === 'true';
  } catch {
    // Private mode: ask every time.
    return false;
  }
}
