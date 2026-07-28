
import { LOOPS_PER_SECOND } from './stat-events.js';
import { minionPositionAt } from './timeline.js';
export const OBJECTIVE_SITES = {
  DragonShireShrineSun: { label: 'Sun Shrine', icon: 'sunshrine', feed: true },
  DragonShireShrineMoon: { label: 'Moon Shrine', icon: 'moonshrine', feed: true },
  VehicleDragon: { label: 'Dragon Knight', icon: 'dragonknight', mobile: true },
  DragonballCaptureBeacon: { label: 'Dragon Knight statue' },
  LuxoriaTemple: {
    label: 'Temple',
    variants: ['skytempletop', 'skytemplemid', 'skytemplebot'],
    labels: ['Top Temple', 'Middle Temple', 'Bottom Temple'],
  },
  ZergHiveControlBeacon: {
    label: 'Beacon',
    variants: ['beacon_top', 'beacon_bottom'],
    labels: ['Top Beacon', 'Bottom Beacon'],
    feed: true,
  },
  DiabloShrine: {
    label: 'Shrine',
    labels: ['Top Shrine', 'Middle Shrine', 'Bottom Shrine'],
    feed: true,
    mergeInto: /^Shrine\b/,
  },
  ScoringAltar: { label: 'Altar' },
  WaygateEntrance: { label: 'Waygate', icon: 'tod_waygate_in' },
  WaygateUnit: { label: 'Waygate exit', icon: 'tod_waygate_out' },
  SoulCage: { label: 'Turn-in Cage', icon: 'spiderqueen_turnin', labels: ['Top Cage', 'Bottom Cage'] },
  ControlPointMinimapIconA: { label: 'Control Point', feed: true, feedKind: 'verbose' },
  ControlPointMinimapIconB: { label: 'Control Point', feed: true, feedKind: 'verbose' },
  ControlPointMinimapIconC: { label: 'Control Point', feed: true, feedKind: 'verbose' },
  VolskayaVehicle: { label: 'Triglav Protector', mobile: true },
  ControlPointMinimapPreviewIconA: { label: 'Control Point incoming', transient: true },
  ControlPointMinimapPreviewIconB: { label: 'Control Point incoming', transient: true },
  ControlPointMinimapPreviewIconC: { label: 'Control Point incoming', transient: true },
  Payload_Neutral: { label: 'Payload', mobile: true },
  Payload_Neutral_Warning: { label: 'Payload incoming', transient: true },
  MapMechanicNukeSilo: { label: 'Nuke Silo' },
  NukeTargetMinimapPreviewIconUnit: { label: 'Nuke drop', transient: true },
  NukeTargetMinimapIconUnit: { label: 'Nuke target', transient: true },
  WarheadSingle: { label: 'Warhead', small: true },
  WarheadDouble: { label: 'Warhead', small: true },
  WarheadTriple: { label: 'Warhead', small: true },
  WarheadDropped: { label: 'Dropped warhead', small: true },
  Seed: { label: 'Seed', small: true },
  SeedSpawnPreview: { label: 'Seed incoming', small: true, transient: true },
  GardenTerror: { label: 'Garden Terror', mobile: true },
  OvergrowthPlant: { label: 'Overgrowth Plant' },
  RavenLordTribute: { label: 'Tribute' },
  RavenLordTributePreview: { label: 'Tribute incoming', transient: true },
  RavenLordTributeWarning: { label: 'Tribute incoming', transient: true },
  DocksPirateCaptain: { label: 'Blackheart', icon: 'piratecamp_full' },
  GhostShipBeacon: { label: 'Ghost Ship', icon: 'ghostship', mobile: true },
  DocksTreasureChest: { label: 'Treasure Chest', small: true },
  UnderworldMineEntranceMinimapIcon: { label: 'Mine entrance' },
  UnderworldBoss: { label: 'Grave Golem skulls', mobile: true },
  AVMinimapIcon: { label: 'Capture Point', feed: true },
  CaptureCage: { label: 'Prisoner Cage' },
  Storm_Building_WCAV_Alliance_CaptureCage: { label: 'Prisoner Cage' },
  Storm_Building_WCAV_Horde_CaptureCage: { label: 'Prisoner Cage' },
  AllianceCavalry: { label: 'Cavalry', mobile: true },
  HordeCavalry: { label: 'Cavalry', mobile: true },
  CapturedSoldier: { label: 'Freed soldier', mobile: true },
  BossDuelBossPreviewUnitHeaven: { label: 'Immortal incoming', transient: true },
  BossDuelBossPreviewUnitHell: { label: 'Immortal incoming', transient: true },
  BossDuelBossHeaven: { label: 'Immortal (Heaven)', mobile: true },
  BossDuelBossHell: { label: 'Immortal (Hell)', mobile: true },
  BossDuelLanerHeaven: { label: 'Immortal pushing', mobile: true },
  BossDuelLanerHell: { label: 'Immortal pushing', mobile: true },
};
export const OBJECTIVE_SITE_MAP_LABELS = {
  'Hanamura Temple': {
    ControlPointMinimapIconA: 'Collection Point',
    ControlPointMinimapIconB: 'Collection Point',
    ControlPointMinimapIconC: 'Collection Point',
  },
};
const OBJECTIVE_HOLD_LOOPS = 2 * LOOPS_PER_SECOND;
export function newObjectiveSite(def, name, mapTitle, loop, x, y, team) {
  return {
    type: name,
    label: (OBJECTIVE_SITE_MAP_LABELS[mapTitle] || {})[name] || def.label,
    icon: def.icon || null,
    mobile: !!def.mobile,
    transient: !!def.transient,
    small: !!def.small,
    feed: !!def.feed,
    x,
    y,
    bornLoop: loop,
    diedLoop: null,
    anchors: [{ loop, x, y }],
    owners: [{ loop, team }],
  };
}
export function assignObjectiveVariants(model) {
  const byType = new Map();
  for (const s of model.objectiveSites) {
    const def = OBJECTIVE_SITES[s.type];
    if (!def || (!def.variants && !def.labels)) continue;
    const list = byType.get(s.type);
    if (list) list.push(s);
    else byType.set(s.type, [s]);
  }
  for (const [type, sites] of byType) {
    const def = OBJECTIVE_SITES[type];
    const spots = siteSpots(sites);
    for (const s of sites) {
      const rank = spots.indexOf(Math.round(s.y));
      if (def.variants && def.variants[rank]) s.icon = def.variants[rank];
      if (def.labels && def.labels[rank]) s.label = def.labels[rank];
    }
  }
}
const siteSpots = (sites) => [...new Set(sites.map((s) => Math.round(s.y)))].sort((a, b) => b - a);
export function addObjectiveCaptureLines(model) {
  for (const s of model.objectiveSites) {
    if (!s.feed) continue;
    const def = OBJECTIVE_SITES[s.type];
    for (let i = 1; i < s.owners.length; i++) {
      const o = s.owners[i];
      if (o.team == null) continue;
      const end = i + 1 < s.owners.length ? s.owners[i + 1].loop : s.diedLoop ?? model.durationLoops;
      if (end - o.loop < OBJECTIVE_HOLD_LOOPS) continue;
      if (def.mergeInto && nameExistingLine(model, o, s, def.mergeInto)) continue;
      model.objectives.push({
        loop: o.loop,
        team: o.team,
        text: `${s.label} taken`,
        kind: def.feedKind || 'objective',
      });
    }
  }
  model.objectives.sort((a, b) => a.loop - b.loop);
}
function nameExistingLine(model, owner, site, pattern) {
  for (const line of model.objectives) {
    if (Math.abs(line.loop - owner.loop) > OBJECTIVE_HOLD_LOOPS) continue;
    if (line.team !== owner.team || !pattern.test(line.text)) continue;
    line.text = line.text.replace(pattern, site.label);
    return true;
  }
  return false;
}
const WINDOW_GAP_LOOPS = 60 * LOOPS_PER_SECOND;
const WINDOW_TAIL_LOOPS = 10 * LOOPS_PER_SECOND;

export function openWindow(windows, id, loop, isStart = false) {
  if (id == null) return;
  const spans = windows.get(id);
  if (!spans) {
    windows.set(id, [{ from: loop, to: loop }]);
    return;
  }
  const last = spans[spans.length - 1];
  if ((isStart || loop - last.to > WINDOW_GAP_LOOPS) && loop > last.from) {
    spans.push({ from: loop, to: loop });
  } else {
    last.to = Math.max(last.to, loop);
  }
}
export function assignObjectiveWindows(model, type, windows) {
  if (!windows.size) return;
  const sites = model.objectiveSites.filter((s) => s.type === type);
  const spots = siteSpots(sites);
  for (const s of sites) {
    const spans = windows.get(spots.indexOf(Math.round(s.y)) + 1) || [];
    s.active = spans.map((w) => ({ from: w.from, to: w.to + WINDOW_TAIL_LOOPS }));
  }
}
export function applyObjectiveActivity(model, activity) {
  applyShrineWindows(model, activity.shrineMinions, activity.shrineCaptures);
  applyDragonShireWindows(model, activity.dragonActivations);
  holdStagedZerg(model, activity.zergLaunches);
}
const STAGED_ZERG_RE = /^Zerg/;

function holdStagedZerg(model, launches) {
  if (!launches.length) return;
  for (const m of model.minions) {
    if (!STAGED_ZERG_RE.test(m.type) || m.anchors.length < 2) continue;
    const launch = launches.find((loop) => loop > m.anchors[0].loop);
    if (launch == null || launch >= m.anchors[1].loop) continue;
    m.anchors.splice(1, 0, { loop: launch, x: m.anchors[0].x, y: m.anchors[0].y });
  }
}
const SHRINE_MINION_DIST = 25; // world units; the three shrines are ~50 apart

function applyShrineWindows(model, spawns, captures) {
  const shrines = model.objectiveSites.filter((s) => s.type === 'DiabloShrine');
  if (!shrines.length || !spawns.length) return;
  const bursts = new Map(shrines.map((s) => [s, []]));
  for (const sp of spawns) {
    let nearest = null;
    let nearestDistSq = SHRINE_MINION_DIST ** 2;
    for (const s of shrines) {
      const distSq = (s.x - sp.x) ** 2 + (s.y - sp.y) ** 2;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = s;
      }
    }
    if (!nearest) continue;
    const list = bursts.get(nearest);
    const last = list[list.length - 1];
    if (last && sp.loop - last.to <= WINDOW_GAP_LOOPS) last.to = sp.loop;
    else list.push({ from: sp.loop, to: sp.loop });
  }
  for (const s of shrines) {
    s.active = bursts.get(s).map((w) => {
      const capture = captures.find((loop) => loop >= w.to && loop - w.to <= WINDOW_GAP_LOOPS);
      return { from: w.from, to: (capture ?? w.to) + WINDOW_TAIL_LOOPS };
    });
  }
}
function applyDragonShireWindows(model, activations) {
  const shrines = model.objectiveSites.filter((s) => /^DragonShireShrine/.test(s.type));
  const dragons = model.objectiveSites.filter((s) => s.type === 'VehicleDragon');
  if (!shrines.length || !activations.length) return;
  const piloted = activations.map((loop) => {
    const dragon = dragons.find((d) => d.bornLoop <= loop && (d.diedLoop == null || d.diedLoop >= loop));
    return { from: loop, to: dragon && dragon.diedLoop != null ? dragon.diedLoop : model.durationLoops };
  });
  for (const s of shrines) s.active = invertSpans(piloted, model.durationLoops);
  for (const d of dragons) {
    d.active = piloted.filter((w) => w.from >= d.bornLoop && w.from <= (d.diedLoop ?? Infinity));
  }
}
function invertSpans(spans, end) {
  const out = [];
  let at = 0;
  for (const s of spans) {
    if (s.from > at) out.push({ from: at, to: s.from });
    at = Math.max(at, s.to);
  }
  if (at < end) out.push({ from: at, to: end });
  return out;
}
export function objectivePositionAt(site, loop) {
  if (site.bornLoop > loop) return null;
  if (site.diedLoop != null && site.diedLoop <= loop) return null;
  if (site.active && !site.active.some((w) => loop >= w.from && loop <= w.to)) return null;
  if (!site.mobile) return [site.x, site.y];
  return minionPositionAt(site, loop);
}
export function objectiveOwnerAt(site, loop) {
  let team = null;
  for (const o of site.owners) {
    if (o.loop > loop) break;
    team = o.team;
  }
  return team;
}
