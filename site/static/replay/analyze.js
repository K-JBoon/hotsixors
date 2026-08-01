
import { decodeDetails, decodeHeader, loadProtocol } from './protocol.js';
import { loadSummons } from './summons.js';
import { runGamePass } from './analyze/commands.js';
import { buildObjectivePhases } from './analyze/phases.js';
import { newRegistry } from './analyze/registry.js';
import { str } from './analyze/stat-events.js';
import { median2 } from './analyze/timeline.js';
import {
  addObjectiveCaptureLines,
  applyObjectiveActivity,
  assignObjectiveVariants,
  assignObjectiveWindows,
} from './analyze/objective-sites.js';
import { runTrackerPass } from './analyze/tracker.js';

export { LOOPS_PER_SECOND, XP_SOURCES } from './analyze/stat-events.js';
export { layoutObjectivePhases } from './analyze/phases.js';
export { objectiveOwnerAt, objectivePositionAt } from './analyze/objective-sites.js';
export {
  buildPositionTimeline,
  isAliveAt,
  isDeadAt,
  minionPositionAt,
} from './analyze/timeline.js';
const DEFAULT_GATES_OPEN_LOOP = 610;

function newPlayers(details) {
  return details.m_playerList.map((p, i) => ({
    playerId: i + 1, // tracker playerIds are 1-based in workingSetSlotId order
    userId: null,
    team: p.m_teamId,
    name: str(p.m_name),
    hero: str(p.m_hero),
    result: p.m_result, // 1 = win, 2 = loss
    heroUnits: [],
    unitType: null,
    spans: [],
    multiBody: false,
    hasCompanions: false,
    pets: [],
  }));
}

// Each handle is a 4-byte type, a 4-byte region, then the file's sha256.
function cacheHashes(details) {
  const hex = [];
  for (const handle of details.m_cacheHandles || []) {
    if (!(handle instanceof Uint8Array) || handle.length < 40) continue;
    hex.push(Array.from(handle.subarray(8, 40), (b) => b.toString(16).padStart(2, '0')).join(''));
  }
  return hex;
}

function newModel(details, header, baseBuild, players) {
  return {
    map: str(details.m_title),
    mapHashes: cacheHashes(details),
    durationLoops: header.m_elapsedGameLoops,
    build: header.m_version ? header.m_version.m_build : null,
    baseBuild,
    gatesOpenLoop: DEFAULT_GATES_OPEN_LOOP,
    players,
    bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    structures: [],
    minions: [], // {team, type, bornLoop, diedLoop, anchors: [{loop, x, y}]}
    companions: [],
    visionUnits: [],
    camps: [], // capture events: {loop, campType, team, campId}
    campSites: [], // {id, x, y, captures: [{loop, team, campType}]}
    objectives: [], // feed lines: {loop, team, text, kind}
    objectivePhases: [],
    objectiveSites: [],
    teamLevels: [[], []], // per team: [{loop, level}]
    xpBreakdown: [[], []],
    teamHalls: [null, null],
  };
}
function fillPlayerDefaults(players) {
  for (const p of players) {
    p.anchors ||= [];
    p.moves ||= [];
    p.casts ||= [];
    p.deaths ||= [];
    p.talents ||= [];
    p.camera ||= [];
    p.score ||= {};
    if (!p.spans.length) p.spans.push({ from: 0, to: null });
  }
}
function sortCompanionSamples(companions) {
  for (const c of companions) {
    c.anchors.sort((a, b) => a.loop - b.loop);
    c.moves ||= [];
    c.moves.sort((a, b) => a.loop - b.loop);
    c.casts = [];
  }
}

export async function analyzeReplay(archive) {
  const baseBuild = decodeHeader(archive.userData).m_version?.m_baseBuild ?? null;
  const protocol = await loadProtocol(baseBuild);
  const summons = await loadSummons();

  const header = decodeHeader(archive.userData, protocol);
  const details = decodeDetails(archive.readFile('replay.details'), protocol);

  const players = newPlayers(details);
  const model = newModel(details, header, baseBuild, players);
  const reg = newRegistry(new Map(players.map((p) => [p.playerId, p])));

  const tracked = runTrackerPass(archive.readFile('replay.tracker.events'), protocol, model, reg, summons);
  runGamePass(archive.readFile('replay.game.events'), protocol, model, reg);

  assignObjectiveVariants(model);
  assignObjectiveWindows(model, 'LuxoriaTemple', tracked.templeWindows);
  applyObjectiveActivity(model, tracked.activity);
  addObjectiveCaptureLines(model);
  model.objectivePhases = buildObjectivePhases(tracked.signals, model.durationLoops);

  fillPlayerDefaults(players);
  sortCompanionSamples(model.companions);
  model.teamHalls = tracked.hallSamples.map(median2);
  return model;
}
