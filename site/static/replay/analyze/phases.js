
import { LOOPS_PER_SECOND } from './stat-events.js';
import { templeLabel } from './objective-events.js';
const PHASE_RULES = [
  {
    label: 'Tribute',
    start: { born: ['RavenLordTribute'] },
    end: { stat: 'TributeCollected' },
    team: 'end',
    gap: 30,
    maxLen: 300,
  },
  {
    label: 'Dragon Knight',
    start: { stat: 'DragonKnightActivated' },
    end: { died: ['VehicleDragon'] },
    team: 'start',
    maxLen: 180,
  },
  { label: 'Ghost Ship', start: { stat: 'GhostShipCaptured' }, team: 'start', hold: 20 },
  {
    label: 'Garden Terror',
    start: { born: ['GardenTerror'] },
    end: { died: ['GardenTerror'] },
    endMode: 'last',
    team: 'start',
    gap: 45,
    maxLen: 180,
  },
  {
    label: 'Temple',
    groupBy: true,
    groupLabel: templeLabel,
    start: { stat: 'SkyTempleActivated' },
    end: { stat: 'SkyTempleShotsFired' },
    endMode: 'last',
    segments: true,
    gap: 60,
    maxLen: 240,
  },
  {
    label: 'Shrine',
    start: { born: ['CursedShrineMinion'] },
    end: { stat: 'Punisher Killed' },
    team: 'end',
    gap: 45,
    maxLen: 300,
  },
  {
    label: 'Webweavers',
    start: { stat: 'SoulEatersSpawned' },
    end: { died: ['SoulEater'] },
    endMode: 'last',
    team: 'start',
    gap: 20,
    maxLen: 180,
  },
  {
    label: 'Zerg wave',
    start: { stat: 'BraxisHoldoutMapEventComplete' },
    end: { died: ['ZergUltralisk', 'ZergGuardian', 'ZergHydralisk'] },
    endMode: 'last',
    team: 'start',
    maxLen: 180,
  },
  {
    label: 'Immortals',
    start: { stat: 'Boss Duel Started' },
    end: { stat: 'Immortal Defeated' },
    team: 'end',
    maxLen: 300,
  },
  {
    label: 'Immortal push',
    start: { born: ['BossDuelLanerHeaven', 'BossDuelLanerHell'] },
    end: { died: ['BossDuelLanerHeaven', 'BossDuelLanerHell'] },
    endMode: 'last',
    team: 'start',
    gap: 20,
    maxLen: 180,
  },
  {
    label: 'Control Point',
    start: { born: ['ControlPointMinimapIconA', 'ControlPointMinimapIconB', 'ControlPointMinimapIconC'] },
    end: { stat: 'VolskayaCapturePointComplete' },
    requireEnd: true,
    team: 'end',
    gap: 30,
    maxLen: 420,
  },
  {
    label: 'Triglav Protector',
    start: { born: ['VolskayaVehicle'] },
    end: { died: ['VolskayaVehicle'] },
    team: 'start',
    gap: 20,
    maxLen: 180,
  },
  {
    label: 'Payload',
    start: { born: ['Payload_Neutral'] },
    untilNext: true,
    gap: 45,
    maxLen: 180,
  },
  {
    label: 'Nukes',
    start: { stat: 'WarheadJunctionNukesSpawned' },
    end: { stat: 'WarheadJunctionNukeFired' },
    endMode: 'last',
    team: 'majority',
    gap: 90,
    maxLen: 300,
  },
  {
    label: 'Altars',
    start: { stat: 'Altar Captured' },
    end: { stat: 'Altar Captured' },
    endMode: 'last',
    chain: true,
    team: 'majority',
    gap: 45,
    maxLen: 150,
  },
  {
    label: 'Cavalry',
    start: { born: ['AllianceCavalry', 'HordeCavalry'] },
    end: { died: ['AllianceCavalry', 'HordeCavalry'] },
    endMode: 'last',
    team: 'start',
    gap: 30,
    maxLen: 240,
  },
  {
    label: 'Grave Golem',
    start: { born: ['UnderworldSummonedBoss'] },
    end: { died: ['UnderworldSummonedBoss'] },
    endMode: 'last',
    team: 'start',
    gap: 30,
    maxLen: 240,
  },
];
export const PHASE_BORN_TYPES = new Set(
  PHASE_RULES.flatMap((r) => (r.start.born || []).concat(r.end && r.end.born ? r.end.born : []))
);
export const PHASE_DIED_TYPES = new Set(PHASE_RULES.flatMap((r) => (r.end && r.end.died ? r.end.died : [])));
export const PHASE_STAT_NAMES = new Set(
  PHASE_RULES.flatMap((r) => [r.start.stat, r.end && r.end.stat].filter(Boolean))
);
export function newPhaseSignals() {
  const signals = { born: new Map(), died: new Map(), stat: new Map() };
  signals.add = (kind, key, loop, team, group = null) => {
    const list = signals[kind].get(key);
    if (list) list.push({ loop, team, group });
    else signals[kind].set(key, [{ loop, team, group }]);
  };
  return signals;
}
function signalTimes(signals, spec) {
  if (!spec) return [];
  const out = [];
  if (spec.stat) out.push(...(signals.stat.get(spec.stat) || []));
  for (const type of spec.born || []) out.push(...(signals.born.get(type) || []));
  for (const type of spec.died || []) out.push(...(signals.died.get(type) || []));
  return out.sort((a, b) => a.loop - b.loop);
}
export function buildObjectivePhases(signals, durationLoops) {
  const phases = [];
  for (const rule of PHASE_RULES) {
    const allStarts = signalTimes(signals, rule.start);
    if (!allStarts.length) continue;
    const allEnds = signalTimes(signals, rule.end);
    if (rule.requireEnd && !allEnds.length) continue;
    const groups = rule.groupBy
      ? [...new Set(allStarts.map((s) => s.group))].sort((a, b) => a - b)
      : [null];
    for (const group of groups) {
      const inGroup = (s) => !rule.groupBy || s.group === group;
      phases.push(
        ...rulePhases(rule, allStarts.filter(inGroup), allEnds.filter(inGroup), durationLoops, group)
      );
    }
  }
  return phases.sort((a, b) => a.from - b.from);
}
function unclosedEnd(rule, start, starts, gap, cap, durationLoops) {
  if (rule.chain) return start.loop;
  if (rule.hold) return Math.min(start.loop + rule.hold * LOOPS_PER_SECOND, durationLoops);
  if (rule.untilNext) return Math.min(nextStartAfter(starts, start.loop, gap) ?? cap, cap);
  return rule.end ? cap : start.loop;
}
function rulePhases(rule, starts, ends, durationLoops, group) {
  const gap = (rule.gap || 0) * LOOPS_PER_SECOND;
  const maxLen = (rule.maxLen || 0) * LOOPS_PER_SECOND;
  const phases = [];
  let roundEnd = -1;
  let lastStart = -Infinity;
  for (const start of starts) {
    if (start.loop <= roundEnd || start.loop - lastStart <= gap) continue;
    lastStart = start.loop;
    const cap = Math.min(maxLen ? start.loop + maxLen : Infinity, durationLoops);
    const inRange = ends.filter((e) => e.loop > start.loop && e.loop <= cap);

    let end = inRange[0];
    if (rule.chain && end && end.loop - start.loop > gap) end = undefined;
    if (end && rule.endMode === 'last') {
      for (let i = 1; i < inRange.length && inRange[i].loop - end.loop <= gap; i++) end = inRange[i];
    }

    const to = end ? end.loop : unclosedEnd(rule, start, starts, gap, cap, durationLoops);
    roundEnd = Math.max(to, start.loop);
    const within = inRange.filter((e) => e.loop <= roundEnd);

    const phase = {
      from: start.loop,
      to: roundEnd,
      label: rule.groupLabel ? rule.groupLabel(group) : rule.label,
      team: phaseTeam(rule, start, end, within),
    };
    if (rule.segments) {
      phase.segments = teamRuns(within, roundEnd);
      phase.counts = signalCounts(within);
    }
    phases.push(phase);
  }
  return phases;
}

function phaseTeam(rule, start, end, within) {
  if (rule.team === 'end') return end ? end.team ?? null : null;
  if (rule.team === 'start') return start.team ?? null;
  if (rule.team === 'majority') return majorityTeam(within);
  return null;
}
function majorityTeam(signals) {
  const count = signalCounts(signals);
  if (count[0] === count[1]) return null;
  return count[0] > count[1] ? 0 : 1;
}
function nextStartAfter(starts, loop, gap) {
  const next = starts.find((s) => s.loop - loop > gap);
  return next ? next.loop : null;
}
function teamRuns(signals, endLoop) {
  const runs = [];
  for (const s of signals) {
    if (s.team !== 0 && s.team !== 1) continue;
    const last = runs[runs.length - 1];
    if (last && last.team === s.team) last.to = s.loop;
    else {
      if (last) last.to = s.loop;
      runs.push({ from: s.loop, to: s.loop, team: s.team });
    }
  }
  const last = runs[runs.length - 1];
  if (last) last.to = Math.max(last.to, endLoop);
  return runs;
}
function signalCounts(signals) {
  const counts = [0, 0];
  for (const s of signals) if (s.team === 0 || s.team === 1) counts[s.team]++;
  return counts;
}
export function layoutObjectivePhases(phases, durationLoops) {
  const rowsByLabel = new Map();
  const rowEnds = [];
  return phases.map((p) => {
    let rows = rowsByLabel.get(p.label);
    if (!rows) rowsByLabel.set(p.label, (rows = [rowEnds.push(-Infinity) - 1]));
    let row = rows.find((r) => p.from >= rowEnds[r]);
    if (row == null) {
      row = rowEnds.push(-Infinity) - 1;
      rows.push(row);
    }
    rowEnds[row] = p.to;
    return {
      ...p,
      row,
      left: (p.from / durationLoops) * 100,
      width: ((p.to - p.from) / durationLoops) * 100,
    };
  });
}
