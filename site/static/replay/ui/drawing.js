
import { isAliveAt, isDeadAt, LOOPS_PER_SECOND, minionPositionAt, objectiveOwnerAt, objectivePositionAt } from '../analyze.js';
import { brushPatchAt, castVisibility, pointInShapes } from '../vision.js';
import { cameraAt, cameraQuad } from './camera.js';
import { drawDeathCross, drawIcon, iconImages } from './icons.js';
import { updateXpCursor } from './panel.js';
import { HERO_SIGHT, MERC_RE, SIGHT_OVERRIDES, SIGHT_WHEN_DEPLOYED, WISP_BRUSH_VISION, WISP_BRUSH_VISION_SENTINEL, WISP_FLYING_TALENT, WISP_UNIT } from './sight.js';
import { root, state, ILLUSION_EDGE, ILLUSION_TINT, TEAM_COLORS } from './state.js';
import { formatLoop } from './html.js';
import { PET_LEASH } from './companions.js';
import { WALL_CLASS } from './structures.js';

export function worldToCanvas(x, y) {
  const v = state.view;
  const { canvas } = state;
  return [
    ((x - v.minX) / (v.maxX - v.minX)) * canvas.width,
    canvas.height - ((y - v.minY) / (v.maxY - v.minY)) * canvas.height, // game y axis points up
  ];
}

function worldScale() {
  const v = state.view;
  return state.canvas.width / (v.maxX - v.minX);
}
/* Icons keep their size relative to the map, so this reference width is fixed
   rather than tied to the canvas resolution. */
const ICON_REF_WIDTH = 900;
export function iconScale() {
  return Math.min(state.zoom, 3) * (state.canvas.width / ICON_REF_WIDTH);
}
function heroDeadAt(p, loop) {
  if (!p.multiBody) return isDeadAt(p, loop, state.model.durationLoops);
  return isAliveAt(p.spans, loop) ? null : { respawnLoop: null };
}
function unitSight(type, ageLoops) {
  const deployed = SIGHT_WHEN_DEPLOYED[type];
  if (deployed && ageLoops >= deployed.afterLoops) return deployed.sight;
  const summon = state.summons && state.summons[type];
  if (summon) return summon.sight;
  const sight = state.footprints && state.footprints.sight ? state.footprints.sight[type] : undefined;
  return SIGHT_OVERRIDES[type] ?? (typeof sight === 'number' ? sight : HERO_SIGHT);
}
function unitFlies(type) {
  return !!(state.footprints && state.footprints.flying && state.footprints.flying[type]);
}
function companionPositionAt(c, loop) {
  const pos = c.timeline ? positionAt(c, loop) : minionPositionAt(c, loop);
  if (!pos || c.kind !== 'pet') return pos;
  const owner = state.playersById.get(c.ownerId);
  const home = owner && positionAt(owner, loop);
  if (!home) return pos;
  const dist = Math.hypot(pos[0] - home[0], pos[1] - home[1]);
  if (dist <= PET_LEASH) return pos;
  return [
    home[0] + ((pos[0] - home[0]) * PET_LEASH) / dist,
    home[1] + ((pos[1] - home[1]) * PET_LEASH) / dist,
  ];
}

function ownerHasTalent(ownerId, name) {
  const owner = state.playersById.get(ownerId);
  return !!owner && owner.talents.some((t) => t.name === name);
}
function seesOverWalls(c) {
  return c.unitType === WISP_UNIT && ownerHasTalent(c.ownerId, WISP_FLYING_TALENT);
}
function brushVision(c, loop, pos) {
  if (c.unitType !== WISP_UNIT || !state.visionGrid) return null;
  const sentinel = ownerHasTalent(c.ownerId, WISP_BRUSH_VISION_SENTINEL.talent);
  const rule = sentinel ? WISP_BRUSH_VISION_SENTINEL : WISP_BRUSH_VISION;
  const then = loop - rule.dwellLoops;
  if (then < c.bornLoop) return null;
  const patch = brushPatchAt(state.visionGrid, pos[0], pos[1]);
  if (!patch) return null;
  const before = companionPositionAt(c, then);
  if (!before || brushPatchAt(state.visionGrid, before[0], before[1]) !== patch) return null;
  return rule;
}

export function positionAt(p, loop) {
  if (!p.timeline) return null;
  const i = Math.min(Math.floor(loop / p.timeline.step), p.timeline.samples.length / 2 - 1);
  return [p.timeline.samples[i * 2], p.timeline.samples[i * 2 + 1]];
}
const BODY_PORTRAITS = {
  HeroOlaf: { file: 'storm_ui_ingame_partyframe_lostvikings_olaf.png', sx: 8 },
  HeroBaleog: { file: 'storm_ui_ingame_partyframe_lostvikings_baelog.png', sx: 37 },
  HeroErik: { file: 'storm_ui_ingame_partyframe_lostvikings_eric.png', sx: 66 },
  RexxarMisha: { file: 'storm_ui_ingame_partyframe_rexxar_misha.png', sx: 72 },
  [WISP_UNIT]: { dir: 'abilitytalents', file: 'storm_ui_icon_lunara_wisp.png', sx: 0 },
  JunkratConcussionMine: { dir: 'abilitytalents', file: 'storm_ui_icon_junkrat_concussion_mine.png', sx: 0 },
  JunkratSteelTrap: { dir: 'abilitytalents', file: 'storm_ui_icon_junkrat_steel_trap.png', sx: 0 },
  JunkratRIPTire: { dir: 'abilitytalents', file: 'storm_ui_icon_junkrat_rip_tire.png', sx: 0 },
  ChromieTimeTrap: { dir: 'abilitytalents', file: 'storm_ui_icon_chromie_timetrap.png', sx: 0 },
  ZagaraCreepTumor: { dir: 'abilitytalents', file: 'storm_ui_icon_zagara_creep.png', sx: 0 },
  ZagaraCreepTumorBurrowed: { dir: 'abilitytalents', file: 'storm_ui_icon_zagara_creep.png', sx: 0 },
};
function summonPortrait(type) {
  const summon = state.summons && state.summons[type];
  return summon && summon.portrait ? { dir: 'unitportraits', file: summon.portrait } : null;
}
let portraitDrawPending = false;
function schedulePortraitDraw() {
  if (portraitDrawPending) return;
  portraitDrawPending = true;
  requestAnimationFrame(() => {
    portraitDrawPending = false;
    if (state) draw();
  });
}
const missingIcons = new Set();
function minimapIcon(type) {
  const file = state.minimapIcons && state.minimapIcons[type];
  return file && !missingIcons.has(file) ? { dir: 'minimapicons', file } : null;
}
function drawBodyPortrait(ctx, body, type, fallbackFile, x, y, r) {
  if (!body.portraitImg) {
    const icon = minimapIcon(type);
    const unit = icon || BODY_PORTRAITS[type] || summonPortrait(type);
    const file = unit ? unit.file : fallbackFile;
    if (!file) return false;
    const img = new Image();
    img.onload = schedulePortraitDraw;
    if (icon) {
      img.onerror = () => {
        missingIcons.add(icon.file);
        body.portraitImg = null;
        schedulePortraitDraw();
      };
    }
    img.src = `/images/${(unit && unit.dir) || 'heroportraits'}/${file}`;
    body.portraitImg = img;
    body.portraitCrop = unit || null;
  }
  const img = body.portraitImg;
  if (!img.complete || !img.naturalWidth) return false;
  if (body.portraitCrop) {
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const { sx } = body.portraitCrop;
    const left = sx === undefined ? (img.naturalWidth - s) / 2 : Math.min(sx, img.naturalWidth - s);
    ctx.drawImage(img, left, 0, s, s, x - r, y - r, r * 2, r * 2);
  } else {
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  }
  return true;
}
function drawUnitMarker(ctx, body, type, fallbackPortrait, x, y, r, opts) {
  const { fill, edge, lineWidth, dash, tint, tintOnlyWhenDrawn, filter } = opts;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.clip();
  if (filter) ctx.filter = filter;
  const drawn = drawBodyPortrait(ctx, body, type, fallbackPortrait, x, y, r);
  if (filter) ctx.filter = 'none';
  if (tint && (drawn || !tintOnlyWhenDrawn)) {
    ctx.fillStyle = tint;
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = edge;
  ctx.lineWidth = lineWidth;
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  if (dash) ctx.setLineDash([]);
}
function drawCompanions(loop) {
  const { ctx, model } = state;
  const scale = iconScale();
  for (const c of model.companions) {
    if (!isAliveAt(c.spans, loop)) continue;
    const pos = companionPositionAt(c, loop);
    if (!pos) continue;
    const owner = state.playersById.get(c.ownerId);
    const decoy = c.kind === 'decoy';
    const [x, y] = worldToCanvas(pos[0], pos[1]);
    const r = (decoy || c.kind === 'summon' ? 6.5 : 9) * scale;
    drawUnitMarker(ctx, c, c.unitType, owner && owner.meta ? owner.meta.portrait : null, x, y, r, {
      fill: TEAM_COLORS[c.team],
      edge: decoy ? ILLUSION_EDGE : TEAM_COLORS[c.team],
      lineWidth: (decoy ? 1 : 1.25) * Math.min(scale, 2),
      dash: decoy ? [3 * scale, 3 * scale] : null,
      tint: decoy ? ILLUSION_TINT : null,
    });
  }
}
/* What the player had on screen: the ground the game camera covered. */
function drawCameraBox(loop, p) {
  if (!p) return;
  const cam = cameraAt(p, loop);
  if (!cam) return;
  const { ctx } = state;
  const quad = cameraQuad(cam.x, cam.y, cam.d);
  ctx.save();
  ctx.beginPath();
  quad.forEach(([wx, wy], i) => {
    const [x, y] = worldToCanvas(wx, wy);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fill();
  ctx.strokeStyle = TEAM_COLORS[p.team] + 'cc';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.restore();
}
function drawVisionUnits(loop) {
  const { ctx, model } = state;
  const scale = iconScale();
  for (const u of model.visionUnits) {
    const pos = minionPositionAt(u, loop);
    if (!pos) continue;
    const [x, y] = worldToCanvas(pos[0], pos[1]);
    const r = 5.5 * scale;
    drawUnitMarker(ctx, u, u.type, null, x, y, r, {
      fill: TEAM_COLORS[u.team],
      edge: TEAM_COLORS[u.team],
      lineWidth: 1 * Math.min(scale, 2),
    });
  }
}

export function draw() {
  const { ctx, canvas, model } = state;
  const loop = Math.floor(state.loop);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (state.bg && state.mapMeta) {
    const v = state.view;
    const s = state.mapMeta.imageScale || 2;
    const sx = v.minX * s;
    const sy = (state.mapMeta.mapHeight - v.maxY) * s;
    const sw = (v.maxX - v.minX) * s;
    const sh = (v.maxY - v.minY) * s;
    ctx.drawImage(state.bg, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }
  for (const s of model.structures) {
    if (s.bornLoop > loop) continue;
    if (s.diedLoop != null && s.diedLoop <= loop) continue;
    drawStructure(ctx, s);
  }
  drawCamps(loop);
  if (state.objectives) drawObjectives(loop);

  updateXpCursor();
  for (const ti of [0, 1]) {
    const el = root.querySelector(`[data-team-level="${ti}"]`);
    if (el) el.textContent = `Level ${teamLevelAt(ti, loop)}`;
  }
  if (state.visionTeam != null) drawVision(loop, state.visionTeam);
  if (state.camera && state.selected) drawCameraBox(loop, state.playersById.get(state.selected));
  if (state.minions) drawMinions(loop);
  if (state.trails) {
    for (const p of model.players) {
      if (state.selected && p.playerId !== state.selected) continue;
      if (!p.timeline) continue;
      ctx.strokeStyle = TEAM_COLORS[p.team] + '66';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const trailLoops = 160; // 10s
      const jumpDist = (6 * p.timeline.step) / LOOPS_PER_SECOND;
      let prev = null;
      for (let l = Math.max(0, loop - trailLoops); l <= loop; l += p.timeline.step) {
        const pos = positionAt(p, l);
        const [x, y] = worldToCanvas(pos[0], pos[1]);
        if (!prev || Math.hypot(pos[0] - prev[0], pos[1] - prev[1]) > jumpDist) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        prev = pos;
      }
      ctx.stroke();
    }
  }
  for (const p of model.players) {
    for (const c of p.casts) {
      if (c.x == null) continue;
      const age = loop - c.loop;
      if (age < 0 || age > 24) continue;
      const slot = p.linkInfo[c.link] && p.linkInfo[c.link].slot;
      if (!slot || slot === 'A' || slot === 'S' || slot === 'Z') continue;
      const [x, y] = worldToCanvas(c.x, c.y);
      ctx.strokeStyle = TEAM_COLORS[p.team];
      ctx.lineWidth = slot === 'R' ? 3 : 1.5;
      ctx.globalAlpha = 1 - age / 24;
      ctx.beginPath();
      ctx.arc(x, y, 4 + age / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  for (const p of model.players) {
    for (const d of p.deaths) {
      const age = loop - d.loop;
      if (age < 0 || age > 160) continue;
      const [x, y] = worldToCanvas(d.x, d.y);
      ctx.globalAlpha = Math.max(0.25, 1 - age / 160);
      drawDeathCross(ctx, x, y, 5, 'rgba(255, 255, 255, 0.9)');
      ctx.globalAlpha = 1;
    }
  }

  drawVisionUnits(loop);
  drawCompanions(loop);
  for (const p of model.players) {
    const pos = positionAt(p, loop);
    if (!pos) continue;
    const dead = heroDeadAt(p, loop);
    const [x, y] = worldToCanvas(pos[0], pos[1]);
    const scale = iconScale();
    const r = (state.selected === p.playerId ? 13 : 10) * scale;
    drawUnitMarker(ctx, p, p.unitType, p.meta ? p.meta.portrait : null, x, y, r, {
      fill: dead ? '#333' : TEAM_COLORS[p.team],
      edge: state.selected === p.playerId ? '#fff' : dead ? '#777' : TEAM_COLORS[p.team],
      lineWidth: 1.25 * Math.min(scale, 2),
      filter: dead ? 'grayscale(1) brightness(0.5)' : null,
      tint: dead ? 'rgba(0,0,0,0.45)' : null,
      tintOnlyWhenDrawn: true,
    });
    if (dead) {
      const respawnIn = dead.respawnLoop ? Math.ceil((dead.respawnLoop - loop) / LOOPS_PER_SECOND) : null;
      if (respawnIn != null) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(10 * scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(String(respawnIn), x, y + 3 * scale);
      } else {
        drawDeathCross(ctx, x, y, 4 * scale, '#fff');
      }
    }
  }
  root.querySelector('[data-time]').textContent = formatLoop(loop);
  markCurrentPhases(loop);
}
let lastPhaseKey = '';
function markCurrentPhases(loop) {
  const band = root.querySelector('[data-phase-band]');
  if (!band) return;
  const phases = state.model.objectivePhases;
  const key = phases.map((p, i) => (loop >= p.from && loop <= p.to ? i : '')).join(',');
  if (key === lastPhaseKey) return;
  lastPhaseKey = key;
  const cells = band.children;
  for (let i = 0; i < cells.length; i++) {
    const p = phases[i];
    cells[i].classList.toggle('is-now', loop >= p.from && loop <= p.to);
    cells[i].classList.toggle('is-past', loop > p.to);
  }
}

function teamLevelAt(team, loop) {
  let level = 1;
  for (const e of state.model.teamLevels[team]) {
    if (e.loop <= loop) level = e.level;
    else break;
  }
  return level;
}

function teamShade(team, tint, a) {
  const hex = TEAM_COLORS[team];
  const mix = (channel) => {
    const v = parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16);
    return Math.round(v + (255 - v) * tint);
  };
  return `rgba(${mix(0)},${mix(1)},${mix(2)},${a})`;
}
function drawStructure(ctx, s) {
  const [x, y] = worldToCanvas(s.x, s.y);
  const style = s.style || WALL_CLASS;
  if (!s.shape) {
    ctx.fillStyle = teamShade(s.team, style.tint, style.edge);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const scale = worldScale();
  ctx.beginPath();
  for (const ring of s.shape.rings) {
    ring.forEach(([dx, dy], i) => {
      const px = x + dx * scale;
      const py = y - dy * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }
  ctx.fillStyle = teamShade(s.team, style.tint, style.fill);
  ctx.fill();
  ctx.strokeStyle = teamShade(s.team, style.tint, style.edge);
  ctx.lineWidth = 1;
  ctx.stroke();

  if (style.glyph) drawStructureGlyph(ctx, style.glyph, x, y, s.shape.r * scale, s.team);
}
function drawStructureGlyph(ctx, glyph, x, y, radius, team) {
  if (glyph === 'core') {
    drawIcon(ctx, iconImages.core[team], x, y, Math.max(5, radius * 0.75) * 2);
    return;
  } else if (glyph === 'hall') {
    drawIcon(ctx, iconImages.town[team], x, y, Math.max(6, radius * 0.9) * 2);
    return;
  }
  const r = Math.max(3.5, Math.min(radius * 0.55, 13));
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1, r / 4);
  if (glyph === 'tower') {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.9, y + r * 0.7);
    ctx.lineTo(x - r * 0.9, y + r * 0.7);
    ctx.closePath();
    ctx.fill();
  } else if (glyph === 'well') {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  }
}
const CAMP_RECENT_LOOPS = 90 * LOOPS_PER_SECOND;

function drawCamps(loop) {
  const { ctx, model } = state;
  for (const site of model.campSites) {
    const [x, y] = worldToCanvas(site.x, site.y);
    let recent = null;
    let last = null;
    for (const c of site.captures) {
      if (c.loop > loop) continue;
      last = c;
      if (loop - c.loop < CAMP_RECENT_LOOPS) recent = c;
    }
    const teamIndex = recent && (recent.team === 0 || recent.team === 1) ? recent.team : 2; // 2 = neutral/yellow
    let iconSet = 'merccamp';
    if (site.defenderType === 'boss' || (last && /boss|golem/i.test(last.campType))) iconSet = 'golemmerccamp';
    else if (site.defenderType === 'elite' || (last && /elite|bruiser|knight/i.test(last.campType))) iconSet = 'elitemerccamp';
    const size = Math.max(17, worldScale() * 4.2);
    ctx.save();
    ctx.globalAlpha = recent ? 0.55 : 0.95;
    drawIcon(ctx, iconImages[iconSet][teamIndex], x, y, size);
    ctx.restore();
  }
}
const OBJECTIVE_NEUTRAL = '#e8c351';

function drawObjectives(loop) {
  const { ctx, model } = state;
  for (const site of model.objectiveSites) {
    const pos = objectivePositionAt(site, loop);
    if (!pos) continue;
    const [x, y] = worldToCanvas(pos[0], pos[1]);
    const team = objectiveOwnerAt(site, loop);
    const color = team === 0 || team === 1 ? TEAM_COLORS[team] : OBJECTIVE_NEUTRAL;
    const size = Math.max(16, worldScale() * 4) * (site.small ? 0.38 : 1);
    ctx.save();
    if (site.transient) ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(loop / 5));
    const imgs = site.icon && iconImages[site.icon];
    if (imgs) {
      const img = imgs[Math.min(team == null ? 2 : team, imgs.length - 1)];
      if (imgs.length < 3 && team != null) {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      drawIcon(ctx, img, x, y, size);
    } else {
      const r = size * 0.42;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}
const SIGHT_RECAST_DIST = 0.35;

function sightPolygon(source, x, y, radius, flying) {
  const cache = source._sight;
  if (
    cache &&
    cache.grid === state.visionGrid &&
    cache.radius === radius &&
    cache.flying === flying &&
    Math.abs(cache.x - x) < SIGHT_RECAST_DIST &&
    Math.abs(cache.y - y) < SIGHT_RECAST_DIST
  ) {
    return cache.poly;
  }
  const poly = castVisibility(state.visionGrid, x, y, radius, undefined, flying);
  source._sight = { grid: state.visionGrid, radius, x, y, flying, poly };
  return poly;
}
const BASE_MASK_SCALE = 2;

function baseMaskCanvas(shapes, mapWidth, mapHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = mapWidth * BASE_MASK_SCALE;
  canvas.height = mapHeight * BASE_MASK_SCALE;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  const px = (x) => x * BASE_MASK_SCALE;
  const py = (y) => (mapHeight - y) * BASE_MASK_SCALE;
  for (const s of shapes) {
    g.globalCompositeOperation = s.negative ? 'destination-out' : 'source-over';
    g.beginPath();
    if (s.kind === 'rect') {
      g.rect(px(s.x), py(s.y + s.h), s.w * BASE_MASK_SCALE, s.h * BASE_MASK_SCALE);
    } else if (s.kind === 'circle') {
      g.arc(px(s.x), py(s.y), s.r * BASE_MASK_SCALE, 0, Math.PI * 2);
    } else {
      const a = s.w / (2 * Math.SQRT2);
      const b = s.h / (2 * Math.SQRT2);
      const corners = [
        [s.x + a + b, s.y + a - b],
        [s.x + a - b, s.y + a + b],
        [s.x - a - b, s.y - a + b],
        [s.x - a + b, s.y - a - b],
      ];
      corners.forEach(([cx, cy], i) => (i ? g.lineTo(px(cx), py(cy)) : g.moveTo(px(cx), py(cy))));
      g.closePath();
    }
    g.fill();
  }
  return canvas;
}
function teamForSide(model, shapes, side) {
  for (const team of [0, 1]) {
    const hall = model.teamHalls[team];
    if (hall && pointInShapes(shapes, hall[0], hall[1])) return team;
  }
  return side === 'order' ? 0 : 1;
}

export function buildBaseMasks(mapMeta, model) {
  const base = mapMeta && mapMeta.baseVision;
  if (!base) return null;
  const masks = [null, null];
  for (const side of ['order', 'chaos']) {
    const shapes = base[side];
    if (!shapes || !shapes.length) continue;
    masks[teamForSide(model, shapes, side)] = baseMaskCanvas(shapes, mapMeta.mapWidth, mapMeta.mapHeight);
  }
  return masks;
}

function drawVision(loop, team) {
  const { visionCanvas, ctx, model } = state;
  const v = visionCanvas.getContext('2d');
  v.globalCompositeOperation = 'source-over';
  v.clearRect(0, 0, visionCanvas.width, visionCanvas.height);
  v.fillStyle = 'rgba(0,0,0,0.55)';
  v.fillRect(0, 0, visionCanvas.width, visionCanvas.height);
  v.globalCompositeOperation = 'destination-out';
  v.fillStyle = 'rgba(0,0,0,1)';
  const fill = (poly) => {
    v.beginPath();
    for (let i = 0; i < poly.length; i += 2) {
      const [cx, cy] = worldToCanvas(poly[i], poly[i + 1]);
      if (i === 0) v.moveTo(cx, cy);
      else v.lineTo(cx, cy);
    }
    v.closePath();
    v.fill();
  };
  const punch = (source, x, y, radius, flying = false) =>
    fill(sightPolygon(source, x, y, radius, flying));
  const reveal = (x, y, radius) => fill(castVisibility(null, x, y, radius));
  const baseMask = state.baseMasks && state.baseMasks[team];
  if (baseMask && state.mapMeta) {
    const view = state.view;
    v.drawImage(
      baseMask,
      view.minX * BASE_MASK_SCALE,
      (state.mapMeta.mapHeight - view.maxY) * BASE_MASK_SCALE,
      (view.maxX - view.minX) * BASE_MASK_SCALE,
      (view.maxY - view.minY) * BASE_MASK_SCALE,
      0,
      0,
      visionCanvas.width,
      visionCanvas.height
    );
  }
  for (const p of model.players) {
    if (p.team !== team || heroDeadAt(p, loop)) continue;
    const pos = positionAt(p, loop);
    if (pos) punch(p, pos[0], pos[1], unitSight(p.unitType));
  }
  for (const c of model.companions) {
    if (c.team !== team || !isAliveAt(c.spans, loop)) continue;
    const pos = companionPositionAt(c, loop);
    if (!pos) continue;
    const brush = brushVision(c, loop, pos);
    if (brush && brush.reveal) reveal(pos[0], pos[1], brush.reveal);
    punch(c, pos[0], pos[1], unitSight(c.unitType) + (brush ? brush.bonus : 0), seesOverWalls(c));
  }
  for (const u of model.visionUnits) {
    if (u.team !== team) continue;
    const pos = minionPositionAt(u, loop);
    if (pos) punch(u, pos[0], pos[1], unitSight(u.type, loop - u.bornLoop), unitFlies(u.type));
  }
  for (const s of model.structures) {
    if (s.team !== team || s.bornLoop > loop) continue;
    if (s.diedLoop != null && s.diedLoop <= loop) continue;
    if (s.sight) punch(s, s.x, s.y, s.sight);
  }
  if (state.minions) {
    for (const m of model.minions) {
      if (m.team !== team || !m.sight) continue;
      const pos = minionPositionAt(m, loop);
      if (pos) punch(m, pos[0], pos[1], m.sight);
    }
  }
  ctx.drawImage(visionCanvas, 0, 0);
}
function drawMinions(loop) {
  const { ctx, model } = state;
  ctx.save();
  ctx.globalAlpha = 0.9;
  for (const m of model.minions) {
    const pos = minionPositionAt(m, loop);
    if (!pos) continue;
    const [x, y] = worldToCanvas(pos[0], pos[1]);
    const merc = MERC_RE.test(m.type);
    const zoomScale = Math.min(state.zoom, 3);
    ctx.beginPath();
    ctx.arc(x, y, (merc ? 3.5 : 2) * zoomScale, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[m.team];
    ctx.fill();
    if (merc) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}
