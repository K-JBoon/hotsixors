
import { fetchJson } from '../js/storage.js';
import { MPQArchive } from './mpq.js';
import { analyzeReplay, buildPositionTimeline } from './analyze.js';
import { buildVisionGrid } from './vision.js';
import { buildWalkGrid, routeUnitsThroughTerrain } from './pathing.js';
import { buildLanePaths, routeUnitsAlongLanes } from './lanes.js';
import { marchUnits } from './march.js';
import { loadSummons } from './summons.js';
import { heroMeta, hearthLinkSet, movementLinkSet, normalizeName, resolveLink } from './ui/abilities.js';
import { sendCompanionsWhereTheyWereTold } from './ui/companions.js';
import { buildBaseMasks, draw, iconScale, positionAt, worldToCanvas } from './ui/drawing.js';
import { buildFeed, FEED_KINDS, objectiveBandHtml, renderFeed, syncFeed } from './ui/feed.js';
import { escapeHtml } from './ui/html.js';
import { icon } from './ui/icons.js';
import { buildPanel } from './ui/panel.js';
import { selectPlayer, seekTo, tick, togglePlay, updatePlayButton, wireFilterRow } from './ui/playback.js';
import { BASE_CANVAS_WIDTH, dropZone, fileInput, root, setState, state, TEAM_COLORS } from './ui/state.js';
import { nameStructures, structureStyle } from './ui/structures.js';
import { canvasAspect, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp, onCanvasWheel, resetView, toggleFullscreen } from './ui/viewport.js';

async function loadStaticData() {
  const [draftData, shortcodeData, mapsData, footprints, movementAbilities, heroUnits, summons] = await Promise.all([
    fetch('/draft/draft-data.json').then((r) => r.json()),
    fetch('/shortcode-data.json').then((r) => r.json()),
    fetchJson('/replay/maps.json', {}),
    fetchJson('/replay/footprints.json', { shapes: [], units: {} }),
    fetchJson('/replay/movement-abilities.json', {}),
    fetchJson('/replay/hero-units.json', {}),
    loadSummons(),
  ]);
  return { draftData, shortcodeData, mapsData, footprints, movementAbilities, heroUnits, summons };
}
async function loadAbilLinkIndex(build) {
  const index = await fetchJson('/replay/abillinks/index.json', null);
  if (!index || !index.builds.length) return {};
  const older = index.builds.filter((b) => b <= build);
  const pick = older.length ? older[older.length - 1] : index.builds[0];
  return fetchJson(`/replay/abillinks/${pick}.json`, {});
}
// A replay names its map in the recorder's language, so fall back to the map's
// content hash and then to its other localized names.
function findMap(mapsData, model) {
  if (!mapsData) return null;
  const hashes = new Set(model.mapHashes || []);
  for (const entry of Object.values(mapsData)) {
    if (entry.hash && hashes.has(entry.hash)) return entry;
  }
  if (mapsData[model.map]) return mapsData[model.map];
  const want = normalizeName(model.map || '');
  if (!want) return null;
  for (const entry of Object.values(mapsData)) {
    if ((entry.names || []).some((n) => normalizeName(n) === want)) return entry;
  }
  return null;
}

function viewRect(model, mapMeta) {
  if (mapMeta) {
    const c = mapMeta.camera || { left: 0, bottom: 0, right: mapMeta.mapWidth, top: mapMeta.mapHeight };
    return { minX: c.left, minY: c.bottom, maxX: c.right, maxY: c.top };
  }
  return { minX: model.bounds.minX, minY: model.bounds.minY, maxX: model.bounds.maxX, maxY: model.bounds.maxY };
}

async function handleFile(file) {
  root.dataset.state = 'loading';
  dropZone.innerHTML = `<p>Parsing ${file.name}…</p>`;
  try {
    const [data, buffer] = await Promise.all([loadStaticData(), file.arrayBuffer()]);
    const model = await analyzeReplay(new MPQArchive(buffer));
    const abilLinkIndex = await loadAbilLinkIndex(model.baseBuild ?? model.build ?? 0);
    setupViewer(model, { ...data, abilLinkIndex });
  } catch (err) {
    console.error(err);
    root.dataset.state = 'error';
    dropZone.innerHTML = `<p><strong>Could not parse this replay.</strong></p>
      <p class="replay-drop__note">${escapeHtml(String(err && err.message || err))}</p>
      <p><button class="replay-file-btn" data-retry>Try another file</button></p>`;
    dropZone.querySelector('[data-retry]').addEventListener('click', () => location.reload());
  }
}


function setupViewer(model, { draftData, shortcodeData, mapsData, footprints, abilLinkIndex, movementAbilities, heroUnits, summons }) {
  const players = model.players;
  const movementLinks = movementLinkSet(abilLinkIndex, movementAbilities);
  const hearthLinks = hearthLinkSet(abilLinkIndex);
  const playersById = new Map(players.map((p) => [p.playerId, p]));
  for (const p of players) {
    p.meta = heroMeta(draftData, p.hero, heroUnits, p.unitType);
    if (p.meta) p.hero = p.meta.name; // the replay's name is in the recorder's language
    p.timeline = buildPositionTimeline(p, model.durationLoops, {
      movementLinks,
      hearthLinks,
      hall: model.teamHalls[p.team],
    });
    const heroSlug = (p.meta && p.meta.slug) || normalizeName(p.hero);
    const heroId = (p.meta && p.meta.id) || '';
    p.heroSlug = heroSlug;
    p.linkInfo = {};
    for (const c of p.casts) {
      if (!(c.link in p.linkInfo)) {
        p.linkInfo[c.link] = resolveLink(shortcodeData, abilLinkIndex, heroSlug, heroId, c.link);
      }
    }
  }

  const mapMeta = findMap(mapsData, model);
  for (const s of model.structures) {
    const index = footprints && footprints.units ? footprints.units[s.type] : undefined;
    s.shape = index === undefined ? null : footprints.shapes[index];
    const sight = footprints && footprints.sight ? footprints.sight[s.type] : undefined;
    s.sight = typeof sight === 'number' ? sight : null;
    s.style = structureStyle(s.type);
  }
  for (const m of model.minions) {
    const sight = footprints && footprints.sight ? footprints.sight[m.type] : undefined;
    m.sight = typeof sight === 'number' ? sight : null;
  }
  const lanePaths = mapMeta && mapMeta.lanes ? buildLanePaths(mapMeta.lanes) : [];
  const mobileUnits = model.minions.concat(model.objectiveSites.filter((s) => s.mobile));
  if (lanePaths.length) routeUnitsAlongLanes(mobileUnits, lanePaths);
  const unitSpeeds = footprints && footprints.speed ? footprints.speed : null;
  sendCompanionsWhereTheyWereTold(model);
  for (const c of model.companions) {
    if (c.moves.length) c.timeline = buildPositionTimeline(c, model.durationLoops);
    else mobileUnits.push(c);
  }
  const unitRanges = footprints && footprints.range ? footprints.range : null;
  marchUnits(mobileUnits, unitSpeeds, { model, ranges: unitRanges });
  nameStructures(model, lanePaths);

  const baseView = viewRect(model, mapMeta);
  setState({
    model,
    playersById,
    footprints,
    summons,
    mobileUnits,
    unitSpeeds,
    unitRanges,
    draftData,
    shortcodeData,
    mapMeta,
    baseMasks: buildBaseMasks(mapMeta, model),
    baseView,
    view: { ...baseView },
    zoom: 1,
    center: { x: (baseView.minX + baseView.maxX) / 2, y: (baseView.minY + baseView.maxY) / 2 },
    drag: null,
    dragMoved: false,
    loop: model.gatesOpenLoop,
    playing: false,
    speed: 4,
    visionTeam: null,
    trails: true,
    minions: true,
    objectives: true,
    camera: true, // only drawn for the selected hero
    selected: null, // playerId
    feedKinds: new Set(FEED_KINDS.filter((k) => !k.off).map((k) => k.id)),
    feedHeroes: new Set(players.map((p) => p.playerId)),
    feedQuery: '',
    lastTick: 0,
    bg: null,
    visionGrid: null, // blocker grid; vision is circles until it loads
    walkGrid: null, // same mask's walkability bit; paths are straight until it loads
    movementLinks,
    hearthLinks,
  });
  if (mapMeta) {
    const img = new Image();
    img.onload = () => {
      state.bg = img;
      draw();
    };
    img.src = mapMeta.image;
  }
  if (mapMeta && mapMeta.vision) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const rgba = g.getImageData(0, 0, img.width, img.height).data;
      state.visionGrid = buildVisionGrid(rgba, img.width, img.height);
      state.walkGrid = buildWalkGrid(rgba, img.width, img.height);
      for (const p of state.model.players) {
        p.timeline = buildPositionTimeline(p, state.model.durationLoops, {
          movementLinks: state.movementLinks,
          hearthLinks: state.hearthLinks,
          hall: state.model.teamHalls[p.team],
          walkGrid: state.walkGrid,
        });
      }
      for (const c of state.model.companions) {
        if (c.timeline) {
          c.timeline = buildPositionTimeline(c, state.model.durationLoops, { walkGrid: state.walkGrid });
        }
      }
      routeUnitsThroughTerrain(state.mobileUnits, state.walkGrid);
      marchUnits(state.mobileUnits, state.unitSpeeds, { model: state.model, ranges: state.unitRanges });
      draw();
    };
    img.src = mapMeta.vision;
  }

  renderShell();
  buildPanel();
  buildFeed();
  requestAnimationFrame(tick);
}

function renderShell() {
  const { model } = state;
  const teams = [0, 1].map((t) => model.players.filter((p) => p.team === t));
  const winner = model.players.find((p) => p.result === 1);
  root.dataset.state = 'loaded';
  root.innerHTML = `
    <div class="replay-layout">
      <div class="replay-map-pane">

		<div class="replay-summary">
			<div class="replay-summary__map">${escapeHtml(model.map)} · build ${model.build ?? '?'}</div>
			<div class="replay-summary__teams">
				${teams
				.map(
					(team, ti) => `
				<div class="replay-team-block">
					<div class="replay-team" style="--team-color:${TEAM_COLORS[ti]}">
					${team
						.map(
						(p) => `
						<button class="replay-portrait" data-select="${p.playerId}" title="${escapeHtml(p.hero)}: ${escapeHtml(p.name)}">
						${p.meta ? `<img src="/images/heroportraits/${p.meta.portrait}" alt="${escapeHtml(p.hero)}">` : escapeHtml(p.hero[0])}
						</button>`
						)
						.join('')}
					<span class="replay-team__label">${
						winner && winner.team === ti ? `<span title="Winner">${icon('crown', 'rp-icon--crown')}</span>` : ''
					}</span>
					</div>
					<div class="replay-team-level" style="color:${TEAM_COLORS[ti]}" data-team-level="${ti}">Level 1</div>
				</div>`
				)
				.join('<span class="replay-vs">vs</span>')}
			</div>
		</div>
        <div class="replay-canvas-box" data-canvas-box>
          <canvas class="replay-canvas" data-canvas width="${BASE_CANVAS_WIDTH}" height="${Math.round(
            BASE_CANVAS_WIDTH * canvasAspect()
          )}"></canvas>
          <div class="replay-settings" data-settings-panel hidden role="dialog" aria-label="View settings">
            <div class="replay-settings__group">
              <div class="replay-settings__legend">Layers</div>
              <label class="rp-switch"><input type="checkbox" data-trails checked><span class="rp-switch__track"></span>Trails</label>
              <label class="rp-switch"><input type="checkbox" data-minions checked><span class="rp-switch__track"></span>Minions &amp; mercs</label>
              <label class="rp-switch"><input type="checkbox" data-objectives checked><span class="rp-switch__track"></span>Objectives</label>
              <label class="rp-switch"><input type="checkbox" data-camera checked><span class="rp-switch__track"></span>Camera of selected hero</label>
            </div>
            <div class="replay-settings__group">
              <div class="replay-settings__legend">Fog of war</div>
              <div class="rp-segmented">
                <label><input type="radio" name="vision" value="" checked data-vision><span>Off</span></label>
                <label style="--seg-color:${TEAM_COLORS[0]}"><input type="radio" name="vision" value="0" data-vision><span>Blue</span></label>
                <label style="--seg-color:${TEAM_COLORS[1]}"><input type="radio" name="vision" value="1" data-vision><span>Red</span></label>
              </div>
            </div>
          </div>
        </div>
        <div class="replay-controls">
          <button data-play title="Play/Pause" aria-label="Play">${icon('play')}</button>
          <div class="replay-track">
            ${objectiveBandHtml(model)}
            <input type="range" data-scrub min="0" max="${model.durationLoops}" value="${state.loop}" step="8">
          </div>
          <span class="replay-time" data-time>0:00</span>
          <select data-speed title="Playback speed">
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4" selected>4×</option>
            <option value="8">8×</option>
            <option value="16">16×</option>
          </select>
          <button data-reset-view title="Reset zoom (r)" hidden>Reset view</button>
          <button data-settings title="View settings" aria-label="View settings" aria-expanded="false">${icon('gear')}</button>
          <button data-fullscreen title="Full screen (f)" aria-label="Full screen">${icon('expand')}</button>
        </div>
        <details class="replay-notes">
          <summary>About this view</summary>
          <p class="replay-note">Unit positions are only logged occasionally in replays, so the visualizations here are estimated from position events, input commands, camera movement, the map terrain, etc.</p>
          <p class="replay-note">Vision is approximated by ray-casting each unit's sight radius against the map's vision-blocking terrain and brush.</p>
          <p class="replay-note">Abilities in the event log are shown when players push the ability's button. The ability may not actually have fired (e.g. on cooldown, no mana, silenced, etc.).</p>
          <p class="replay-note">The camera outline shows the ground the selected player had on screen. Replays log where the camera pointed, not the screen shape, so the outline assumes a 16:9 screen at the game's default field of view.</p>
          <p class="replay-note">Click on a hero's portrait to see their detailed ability log.</p>
        </details>
        <div class="replay-panel" data-panel></div>
      </div>
      <div class="replay-feed-pane">
        <div class="replay-feed-head">
          <span data-feed-title>All events</span>
          <button data-clear-select hidden>Show all</button>
        </div>
        <div class="replay-feed-filters">
          <div class="feed-filter-row" data-kind-row>
            <button class="feed-filter feed-filter--all" data-kind-all>None</button>
            ${FEED_KINDS.map(
              (k) => `<button class="feed-filter${k.off ? '' : ' is-on'}" data-kind="${k.id}">${k.label}</button>`
            ).join('')}
          </div>
          <div class="feed-filter-row" data-hero-row>
            <button class="feed-filter feed-filter--all" data-hero-all>None</button>
            <div class="feed-hero-grid">
              ${teams
                .map(
                  (team) => `<div class="feed-hero-team" style="--hero-count:${team.length}">
                ${team
                  .map(
                    (p) =>
                      `<button class="feed-hero-filter is-on" data-hero="${p.playerId}" style="--team-color:${TEAM_COLORS[p.team]}" title="${escapeHtml(p.hero)}: ${escapeHtml(p.name)}">
                        ${p.meta ? `<img src="/images/heroportraits/${p.meta.portrait}" alt="${escapeHtml(p.hero)}">` : escapeHtml(p.hero[0])}
                      </button>`
                  )
                  .join('')}
              </div>`
                )
                .join('')}
            </div>
          </div>
          <input type="search" class="feed-search" data-feed-search placeholder="Search events…" aria-label="Search events">
        </div>
        <ol class="replay-feed" data-feed></ol>
      </div>
    </div>`;

  const canvas = root.querySelector('[data-canvas]');
  state.canvas = canvas;
  state.ctx = canvas.getContext('2d');
  state.visionCanvas = document.createElement('canvas');
  state.visionCanvas.width = canvas.width;
  state.visionCanvas.height = canvas.height;

  root.querySelector('[data-play]').addEventListener('click', togglePlay);
  root.querySelector('[data-scrub]').addEventListener('input', (e) => {
    state.loop = Number(e.target.value);
    state.playing = false;
    updatePlayButton();
    draw();
    syncFeed();
  });
  const band = root.querySelector('[data-phase-band]');
  if (band) {
    band.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-phase-loop]');
      if (!cell) return;
      seekTo(Number(cell.dataset.phaseLoop));
    });
  }
  root.querySelector('[data-speed]').addEventListener('change', (e) => {
    state.speed = Number(e.target.value);
  });
  root.querySelector('[data-trails]').addEventListener('change', (e) => {
    state.trails = e.target.checked;
    draw();
  });
  root.querySelector('[data-minions]').addEventListener('change', (e) => {
    state.minions = e.target.checked;
    draw();
  });
  root.querySelector('[data-objectives]').addEventListener('change', (e) => {
    state.objectives = e.target.checked;
    draw();
  });
  root.querySelector('[data-camera]').addEventListener('change', (e) => {
    state.camera = e.target.checked;
    draw();
  });
  for (const radio of root.querySelectorAll('[data-vision]')) {
    radio.addEventListener('change', (e) => {
      state.visionTeam = e.target.value === '' ? null : Number(e.target.value);
      draw();
    });
  }
  for (const btn of root.querySelectorAll('[data-select]')) {
    btn.addEventListener('click', () => selectPlayer(Number(btn.dataset.select)));
  }
  root.querySelector('[data-clear-select]').addEventListener('click', () => selectPlayer(null));
  wireFilterRow('[data-kind]', '[data-kind-all]', state.feedKinds, (btn) => btn.dataset.kind);
  wireFilterRow('[data-hero]', '[data-hero-all]', state.feedHeroes, (btn) =>
    Number(btn.dataset.hero)
  );
  root.querySelector('[data-feed-search]').addEventListener('input', (e) => {
    state.feedQuery = e.target.value;
    renderFeed();
  });
  wireSettingsPanel();
  root.querySelector('[data-fullscreen]').addEventListener('click', toggleFullscreen);
  root.querySelector('[data-reset-view]').addEventListener('click', resetView);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('wheel', onCanvasWheel, { passive: false });
  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  canvas.addEventListener('pointermove', onCanvasPointerMove);
  canvas.addEventListener('pointerup', onCanvasPointerUp);
  canvas.addEventListener('pointercancel', onCanvasPointerUp);
}

/* The panel lives inside the canvas box so it stays reachable in fullscreen,
   where the rest of the map pane is hidden. */
function wireSettingsPanel() {
  const btn = root.querySelector('[data-settings]');
  const panel = root.querySelector('[data-settings-panel]');
  const setOpen = (open) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('is-on', open);
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  // renderShell can run again for a new replay; those listeners hold a detached panel.
  document.addEventListener('click', () => {
    if (panel.isConnected) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.isConnected && !panel.hidden) setOpen(false);
  });
}

function onCanvasClick(e) {
  if (state.dragMoved) {
    state.dragMoved = false;
    return;
  }
  const rect = state.canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * state.canvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * state.canvas.height;
  let best = null;
  let bestD = 20 * iconScale();
  for (const p of state.model.players) {
    const pos = positionAt(p, Math.floor(state.loop));
    if (!pos) continue;
    const [px, py] = worldToCanvas(pos[0], pos[1]);
    const d = Math.hypot(px - x, py - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) selectPlayer(best.playerId);
}

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('is-dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('is-dragover');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
const replayUrl = new URLSearchParams(location.search).get('url');
if (replayUrl) {
  fetch(replayUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching replay`);
      return r.blob();
    })
    .then((b) => handleFile(new File([b], replayUrl.split('/').pop())))
    .catch((err) => {
      dropZone.insertAdjacentHTML('beforeend', `<p class="replay-drop__note">${escapeHtml(String(err))}</p>`);
    });
}
