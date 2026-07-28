
import { decodeTrackerEvents } from '../protocol.js';
import {
  FIXED,
  statData,
  statDataAll,
  str,
  teamFromInt,
  xpSample,
} from './stat-events.js';
import {
  COLLAPSE_UNIT_LINE_LOOPS,
  OBJECTIVE_EVENTS,
  OBJECTIVE_UNITS,
  VOLLEY_GAP_LOOPS,
  flushVolley,
  templeLabel,
} from './objective-events.js';
import { OBJECTIVE_SITES, newObjectiveSite, openWindow } from './objective-sites.js';
import { PHASE_BORN_TYPES, PHASE_DIED_TYPES, PHASE_STAT_NAMES, newPhaseSignals } from './phases.js';
import {
  aliveAtLoop,
  bodyAtLoopOf,
  closeSpan,
  isAiPlayer,
  openSpan,
  pushByIndex,
  tagOf,
  teamOfOwnerIn,
} from './registry.js';
import { anchor } from './timeline.js';
import {
  CAMP_DEFENDER_DIST,
  CAMP_DEFENDER_TYPES,
  COMPANION_TYPES,
  VIKING_BODIES,
  VIKING_CONTROLLER,
  VISION_UNITS,
  isMinion,
  isStructure,
} from './units.js';
const HALL_SAMPLE_LOOPS = 200;

export function runTrackerPass(data, protocol, model, reg, summons) {
  const ctx = {
    model,
    reg,
    summons,
    signals: newPhaseSignals(),
    templeWindows: new Map(),
    volleys: new Map(),
    activity: {
      shrineMinions: [], // Infernal Shrines: {loop, x, y} of each CursedShrineMinion
      shrineCaptures: [], // Infernal Shrines: loop of each completed shrine
      dragonActivations: [], // Dragon Shire: loop the Dragon Knight was mounted
      zergLaunches: [], // Braxis Holdout: loop each zerg wave was released
    },
    hallSamples: [[], []],
    unitLineAt: new Map(), // OBJECTIVE_UNITS text -> loop of its last line
    teamOfOwner: teamOfOwnerIn(reg.byPlayerId),
    bodyAtLoop: bodyAtLoopOf(reg),
  };

  for (const ev of decodeTrackerEvents(data, protocol)) {
    const handler = HANDLERS[ev._event];
    if (handler) handler(ctx, ev);
  }

  for (const run of ctx.volleys.values()) flushVolley(model, run);
  return ctx;
}

const HANDLERS = {
  'NNet.Replay.Tracker.SPlayerSetupEvent': (ctx, ev) => {
    const p = ctx.reg.byPlayerId.get(ev.m_playerId);
    if (p) p.userId = ev.m_userId;
  },
  'NNet.Replay.Tracker.SUnitBornEvent': onUnitBorn,
  'NNet.Replay.Tracker.SUnitOwnerChangeEvent': (ctx, ev) => {
    const site = ctx.reg.objSitesByTag.get(tagOf(ev));
    if (!site) return;
    const team = ctx.teamOfOwner(ev.m_controlPlayerId);
    if (site.owners[site.owners.length - 1].team !== team) {
      site.owners.push({ loop: ev._gameloop, team });
    }
  },
  'NNet.Replay.Tracker.SUnitDiedEvent': onUnitDied,
  'NNet.Replay.Tracker.SUnitRevivedEvent': onUnitRevived,
  'NNet.Replay.Tracker.SUnitPositionsEvent': onUnitPositions,
  'NNet.Replay.Tracker.SScoreResultEvent': onScoreResult,
  'NNet.Replay.Tracker.SStatGameEvent': onStatGameEvent,
};

function addCompanion(model, p, name, kind, loop) {
  p.hasCompanions = true;
  const c = {
    ownerId: p.playerId,
    team: p.team,
    unitType: name,
    kind,
    bornLoop: loop,
    diedLoop: null,
    spans: [{ from: loop, to: null }],
    anchors: [],
  };
  model.companions.push(c);
  if (kind === 'pet') p.pets.push(c);
  return c;
}

function bornHero(ctx, ev, name, p) {
  const { model, reg } = ctx;
  p.heroUnits.push({ tagIndex: ev.m_unitTagIndex, unitType: name });
  reg.unitToPlayer.set(tagOf(ev), p);
  let body = p;
  if (p.unitType == null) {
    p.unitType = name;
    p.spans.push({ from: ev._gameloop, to: null });
    reg.heroesByIndex.set(ev.m_unitTagIndex, p);
  } else if (VIKING_BODIES.has(name)) {
    p.multiBody = true;
    body = addCompanion(model, p, name, 'unit', ev._gameloop);
    reg.companionsByTag.set(tagOf(ev), body);
    pushByIndex(reg.companionsByIndex, ev.m_unitTagIndex, body);
  } else {
    reg.heroesByIndex.set(ev.m_unitTagIndex, p);
    openSpan(p, ev._gameloop);
  }
  reg.bodyByTag.set(tagOf(ev), body);
  anchor(body, ev._gameloop, ev.m_x, ev.m_y);
  if (ev._gameloop <= HALL_SAMPLE_LOOPS && ctx.hallSamples[p.team]) {
    ctx.hallSamples[p.team].push({ x: ev.m_x, y: ev.m_y });
  }
}

function bornCompanion(ctx, ev, name, p) {
  const c = addCompanion(ctx.model, p, name, COMPANION_TYPES[name], ev._gameloop);
  ctx.reg.unitToPlayer.set(tagOf(ev), p);
  ctx.reg.companionsByTag.set(tagOf(ev), c);
  pushByIndex(ctx.reg.companionsByIndex, ev.m_unitTagIndex, c);
  ctx.reg.bodyByTag.set(tagOf(ev), c);
  anchor(c, ev._gameloop, ev.m_x, ev.m_y);
}

function bornVisionUnit(ctx, ev, name, p) {
  const u = {
    team: p.team,
    type: name,
    bornLoop: ev._gameloop,
    diedLoop: null,
    anchors: [{ loop: ev._gameloop, x: ev.m_x, y: ev.m_y }],
  };
  ctx.model.visionUnits.push(u);
  ctx.reg.visionByTag.set(tagOf(ev), u);
  pushByIndex(ctx.reg.visionByIndex, ev.m_unitTagIndex, u);
}

function bornStructure(ctx, ev, name) {
  const s = {
    team: ev.m_controlPlayerId - 11,
    type: name,
    x: ev.m_x,
    y: ev.m_y,
    bornLoop: ev._gameloop,
    diedLoop: null,
  };
  ctx.model.structures.push(s);
  ctx.reg.structsByTag.set(tagOf(ev), s);
}

function bornMinion(ctx, ev, name) {
  const m = {
    team: ev.m_controlPlayerId - 11,
    type: name,
    bornLoop: ev._gameloop,
    diedLoop: null,
    anchors: [{ loop: ev._gameloop, x: ev.m_x, y: ev.m_y }],
  };
  ctx.model.minions.push(m);
  ctx.reg.minionsByTag.set(tagOf(ev), m);
  pushByIndex(ctx.reg.minionsByIndex, ev.m_unitTagIndex, m);
}
function bornCampDefender(ctx, ev, name) {
  let nearest = null;
  let nearestDistSq = CAMP_DEFENDER_DIST ** 2;
  for (const site of ctx.model.campSites) {
    const distSq = (site.x - ev.m_x) ** 2 + (site.y - ev.m_y) ** 2;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = site;
    }
  }
  if (nearest && !nearest.defenderType) nearest.defenderType = CAMP_DEFENDER_TYPES[name];
}

function bornObjectiveSite(ctx, ev, name, def) {
  const site = newObjectiveSite(
    def,
    name,
    ctx.model.map,
    ev._gameloop,
    ev.m_x,
    ev.m_y,
    ctx.teamOfOwner(ev.m_controlPlayerId)
  );
  ctx.model.objectiveSites.push(site);
  ctx.reg.objSitesByTag.set(tagOf(ev), site);
  pushByIndex(ctx.reg.objSitesByIndex, ev.m_unitTagIndex, site);
}

function objectiveUnitLine(ctx, ev, name) {
  const text = OBJECTIVE_UNITS[name];
  const prev = ctx.unitLineAt.get(text);
  ctx.unitLineAt.set(text, ev._gameloop);
  if (prev != null && ev._gameloop - prev <= COLLAPSE_UNIT_LINE_LOOPS) return;
  ctx.model.objectives.push({
    loop: ev._gameloop,
    team: teamFromInt(ev.m_controlPlayerId - 10),
    text,
  });
}

function onUnitBorn(ctx, ev) {
  const { model, reg } = ctx;
  const name = str(ev.m_unitTypeName);
  const owner = reg.byPlayerId.get(ev.m_controlPlayerId);
  growBounds(model, ev.m_x, ev.m_y);

  if (name.startsWith('Hero') && name !== VIKING_CONTROLLER) {
    if (owner) bornHero(ctx, ev, name, owner);
  } else if (COMPANION_TYPES[name] && owner) {
    bornCompanion(ctx, ev, name, owner);
  } else if ((VISION_UNITS.has(name) || name in ctx.summons) && owner) {
    bornVisionUnit(ctx, ev, name, owner);
  } else if (isAiPlayer(ev.m_controlPlayerId) && isStructure(name)) {
    bornStructure(ctx, ev, name);
  } else if (isAiPlayer(ev.m_controlPlayerId) && isMinion(name)) {
    bornMinion(ctx, ev, name);
  } else if (!isAiPlayer(ev.m_controlPlayerId) && name in CAMP_DEFENDER_TYPES && model.campSites.length) {
    bornCampDefender(ctx, ev, name);
  }

  if (PHASE_BORN_TYPES.has(name)) {
    ctx.signals.add('born', name, ev._gameloop, ctx.teamOfOwner(ev.m_controlPlayerId));
  }
  if (PHASE_DIED_TYPES.has(name)) {
    reg.phaseUnitsByTag.set(tagOf(ev), { type: name, team: ctx.teamOfOwner(ev.m_controlPlayerId) });
  }
  if (name in OBJECTIVE_UNITS) objectiveUnitLine(ctx, ev, name);
  if (name === 'CursedShrineMinion') {
    ctx.activity.shrineMinions.push({ loop: ev._gameloop, x: ev.m_x, y: ev.m_y });
  }
  const def = OBJECTIVE_SITES[name];
  if (def) bornObjectiveSite(ctx, ev, name, def);
}

function growBounds(model, x, y) {
  const b = model.bounds;
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}

function onUnitDied(ctx, ev) {
  const { reg } = ctx;
  const tag = tagOf(ev);
  const loop = ev._gameloop;

  const c = reg.companionsByTag.get(tag);
  if (c) {
    c.diedLoop = loop;
    closeSpan(c, loop);
    anchor(c, loop, ev.m_x, ev.m_y);
  }
  const p = !c && reg.unitToPlayer.get(tag);
  if (p) {
    anchor(p, loop, ev.m_x, ev.m_y);
    closeSpan(p, loop);
  }
  const vu = reg.visionByTag.get(tag);
  if (vu) {
    vu.diedLoop = loop;
    vu.anchors.push({ loop, x: ev.m_x, y: ev.m_y });
  }
  const s = reg.structsByTag.get(tag);
  if (s) s.diedLoop = loop;
  const m = reg.minionsByTag.get(tag);
  if (m) {
    m.diedLoop = loop;
    m.anchors.push({ loop, x: ev.m_x, y: ev.m_y });
  }
  const site = reg.objSitesByTag.get(tag);
  if (site) {
    site.diedLoop = loop;
    site.anchors.push({ loop, x: ev.m_x, y: ev.m_y });
  }
  const phaseUnit = reg.phaseUnitsByTag.get(tag);
  if (phaseUnit) ctx.signals.add('died', phaseUnit.type, loop, phaseUnit.team);
}

function onUnitRevived(ctx, ev) {
  const { reg } = ctx;
  const tag = tagOf(ev);
  const loop = ev._gameloop;

  const c = reg.companionsByTag.get(tag);
  if (c) {
    c.diedLoop = null;
    openSpan(c, loop);
    anchor(c, loop, ev.m_x, ev.m_y);
  }
  const p = reg.unitToPlayer.get(tag);
  if (!p) return;
  if (ctx.hallSamples[p.team]) ctx.hallSamples[p.team].push({ x: ev.m_x, y: ev.m_y });
  const d = p.deaths && p.deaths[p.deaths.length - 1];
  if (d && d.respawnLoop == null) d.respawnLoop = loop;
  if (!c) {
    anchor(p, loop, ev.m_x, ev.m_y);
    openSpan(p, loop);
  }
}
function onUnitPositions(ctx, ev) {
  const { reg } = ctx;
  let unitIndex = ev.m_firstUnitIndex;
  for (let i = 0; i < ev.m_items.length; i += 3) {
    unitIndex += ev.m_items[i];
    const x = ev.m_items[i + 1];
    const y = ev.m_items[i + 2];
    const body = ctx.bodyAtLoop(unitIndex, ev._gameloop);
    if (body) {
      anchor(body, ev._gameloop, x, y);
      continue;
    }
    const m = aliveAtLoop(reg.minionsByIndex, unitIndex, ev._gameloop);
    if (m) m.anchors.push({ loop: ev._gameloop, x, y });
    const vu = aliveAtLoop(reg.visionByIndex, unitIndex, ev._gameloop);
    if (vu) vu.anchors.push({ loop: ev._gameloop, x, y });
    const site = aliveAtLoop(reg.objSitesByIndex, unitIndex, ev._gameloop);
    if (site) site.anchors.push({ loop: ev._gameloop, x, y });
  }
}
function onScoreResult(ctx, ev) {
  for (const inst of ev.m_instanceList) {
    const name = str(inst.m_name);
    inst.m_values.forEach((slot, i) => {
      const p = ctx.reg.byPlayerId.get(i + 1);
      const value = slot && slot[0] ? slot[0].m_value : null;
      if (p && value != null) (p.score ||= {})[name] = value;
    });
  }
}

function onStatGameEvent(ctx, ev) {
  const name = str(ev.m_eventName);
  const handler = STAT_HANDLERS[name];
  if (handler) {
    handler(ctx, ev);
  } else if (name in OBJECTIVE_EVENTS) {
    onObjectiveEvent(ctx, ev, name);
  }
}

const STAT_HANDLERS = {
  GatesOpen: (ctx, ev) => {
    ctx.model.gatesOpenLoop = ev._gameloop;
  },
  PlayerDeath: (ctx, ev) => {
    const p = ctx.reg.byPlayerId.get(statData(ev, 'm_intData', 'PlayerID'));
    if (!p) return;
    const x = statData(ev, 'm_fixedData', 'PositionX') / FIXED;
    const y = statData(ev, 'm_fixedData', 'PositionY') / FIXED;
    anchor(p, ev._gameloop, x, y);
    (p.deaths ||= []).push({
      loop: ev._gameloop,
      x,
      y,
      respawnLoop: null,
      killers: statDataAll(ev, 'm_intData', 'KillingPlayer'),
    });
  },
  TalentChosen: (ctx, ev) => {
    const p = ctx.reg.byPlayerId.get(statData(ev, 'm_intData', 'PlayerID'));
    if (!p) return;
    (p.talents ||= []).push({
      loop: ev._gameloop,
      name: str(statData(ev, 'm_stringData', 'PurchaseName')),
    });
  },
  LevelUp: (ctx, ev) => {
    const p = ctx.reg.byPlayerId.get(statData(ev, 'm_intData', 'PlayerID'));
    const level = statData(ev, 'm_intData', 'Level');
    if (!p) return;
    const arr = ctx.model.teamLevels[p.team];
    if (!arr.length || arr[arr.length - 1].level < level) arr.push({ loop: ev._gameloop, level });
  },
  PeriodicXPBreakdown: (ctx, ev) => {
    const team = teamFromInt(statData(ev, 'm_intData', 'Team'));
    if (team == null) return;
    ctx.model.xpBreakdown[team].push(
      xpSample(ev, ev._gameloop, statData(ev, 'm_intData', 'TeamLevel'))
    );
  },
  EndOfGameXPBreakdown: (ctx, ev) => {
    const p = ctx.reg.byPlayerId.get(statData(ev, 'm_intData', 'PlayerID'));
    const series = p && ctx.model.xpBreakdown[p.team];
    if (!series || (series.length && series[series.length - 1].loop >= ev._gameloop)) return;
    series.push(xpSample(ev, ev._gameloop, ctx.model.teamLevels[p.team].at(-1)?.level ?? 0));
  },
  JungleCampInit: (ctx, ev) => {
    ctx.model.campSites.push({
      id: statData(ev, 'm_intData', 'CampID'),
      x: statData(ev, 'm_fixedData', 'PositionX') / FIXED,
      y: statData(ev, 'm_fixedData', 'PositionY') / FIXED,
      captures: [],
    });
  },
  JungleCampCapture: (ctx, ev) => {
    const capture = {
      loop: ev._gameloop,
      campType: str(statData(ev, 'm_stringData', 'CampType')),
      team: statData(ev, 'm_fixedData', 'TeamID') / FIXED - 1, // fixed-point 1/2
      campId: statData(ev, 'm_intData', 'CampID'),
    };
    ctx.model.camps.push(capture);
    const site = ctx.model.campSites.find((s) => s.id === capture.campId);
    if (site) site.captures.push(capture);
  },
  SkyTempleShotsFired: onSkyTempleShot,
};

function onSkyTempleShot(ctx, ev) {
  const templeId = statData(ev, 'm_intData', 'TempleID');
  const team = teamFromInt(statData(ev, 'm_intData', 'TeamID'));
  const damage = Math.round(statData(ev, 'm_fixedData', 'SkyTempleShotsDamage') / FIXED);

  ctx.signals.add('stat', 'SkyTempleShotsFired', ev._gameloop, team, templeId);
  openWindow(ctx.templeWindows, templeId, ev._gameloop);
  ctx.model.objectives.push({
    loop: ev._gameloop,
    team,
    text: `${templeLabel(templeId)} fires (${damage} damage)`,
    kind: 'verbose',
  });

  const run = ctx.volleys.get(templeId);
  if (run && run.team === team && ev._gameloop - run.lastLoop <= VOLLEY_GAP_LOOPS) {
    run.shots++;
    run.damage += damage;
    run.lastLoop = ev._gameloop;
    return;
  }
  if (run) flushVolley(ctx.model, run);
  ctx.volleys.set(templeId, {
    templeId,
    team,
    loop: ev._gameloop,
    lastLoop: ev._gameloop,
    shots: 1,
    damage,
  });
}

function onObjectiveEvent(ctx, ev, name) {
  if (name === 'SkyTempleActivated' || name === 'SkyTempleCaptured') {
    openWindow(
      ctx.templeWindows,
      statData(ev, 'm_intData', 'TempleID'),
      ev._gameloop,
      name === 'SkyTempleActivated'
    );
  }
  if (name === 'Infernal Shrine Captured') ctx.activity.shrineCaptures.push(ev._gameloop);
  if (name === 'DragonKnightActivated') ctx.activity.dragonActivations.push(ev._gameloop);
  if (name === 'BraxisHoldoutMapEventComplete') ctx.activity.zergLaunches.push(ev._gameloop);

  const o = OBJECTIVE_EVENTS[name](ev);
  if (PHASE_STAT_NAMES.has(name)) {
    ctx.signals.add('stat', name, ev._gameloop, o.team, statData(ev, 'm_intData', 'TempleID'));
  }
  ctx.model.objectives.push({
    loop: ev._gameloop,
    team: o.team,
    text: o.text,
    kind: o.kind || 'objective',
  });
}
