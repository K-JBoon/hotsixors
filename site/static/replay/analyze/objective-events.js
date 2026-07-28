
import { FIXED, LOOPS_PER_SECOND, pct, statData, str, teamFromFixed, teamFromInt } from './stat-events.js';
const TEMPLE_LABELS = ['Top Temple', 'Middle Temple', 'Bottom Temple'];
export const templeLabel = (id) => TEMPLE_LABELS[id - 1] || `Temple ${id}`;
const PUNISHER_NAMES = { ArcaneShrine: 'Arcane', FrozenShrine: 'Frozen', BombardShrine: 'Mortar' };
const punisherName = (type) => PUNISHER_NAMES[type] || type || 'Unknown';
export const OBJECTIVE_EVENTS = {
  TributeCollected: (ev) => ({
    team: teamFromFixed(statData(ev, 'm_fixedData', 'TeamID')),
    text: 'Tribute collected',
  }),
  RavenCurseActivated: (ev) => ({
    team: teamFromFixed(statData(ev, 'm_fixedData', 'TeamID')),
    text: `Curse activated (enemy on ${statData(ev, 'm_intData', 'OpponentScore')} tributes)`,
  }),
  GhostShipCaptured: (ev) => ({
    team: teamFromFixed(statData(ev, 'm_fixedData', 'TeamID')),
    text: `Ghost Ship bought (${statData(ev, 'm_intData', 'TeamScore')}-${statData(ev, 'm_intData', 'OpponentScore')} doubloons)`,
  }),
  DragonKnightActivated: (ev) => ({
    team: teamFromFixed(statData(ev, 'm_fixedData', 'TeamID')),
    text: 'Dragon Knight activated',
  }),
  GardenTerrorActivated: (ev) => ({
    team: teamFromFixed(statData(ev, 'm_fixedData', 'TeamID')),
    text: 'Garden Terror activated',
  }),
  SoulEatersSpawned: (ev) => ({
    team: teamFromFixed(statData(ev, 'm_fixedData', 'TeamID')),
    text: `Webweavers spawned (${statData(ev, 'm_intData', 'TeamScore')}-${statData(ev, 'm_intData', 'OpponentScore')} gems)`,
  }),
  SkyTempleActivated: (ev) => ({
    team: null,
    text: `${templeLabel(statData(ev, 'm_intData', 'TempleID'))} activated`,
  }),
  SkyTempleCaptured: (ev) => {
    const label = templeLabel(statData(ev, 'm_intData', 'TempleID'));
    const team = teamFromInt(statData(ev, 'm_intData', 'TeamID'));
    return team == null
      ? { team: null, text: `${label} contested`, kind: 'verbose' }
      : { team, text: `${label} captured` };
  },
  'Infernal Shrine Captured': (ev) => ({
    team: teamFromInt(statData(ev, 'm_intData', 'Winning Team')),
    text: `Shrine captured (${statData(ev, 'm_intData', 'Winning Score')}-${statData(ev, 'm_intData', 'Losing Score')})`,
  }),
  'Punisher Killed': (ev) => ({
    team: teamFromInt(statData(ev, 'm_intData', 'Owning Team of Punisher')),
    text: `${punisherName(str(statData(ev, 'm_stringData', 'Punisher Type')))} Punisher died after ${statData(ev, 'm_intData', 'Duration')}s`,
  }),
  BraxisHoldoutMapEventComplete: (ev) => {
    const blue = statData(ev, 'm_fixedData', 'TeamOrderProgress');
    const red = statData(ev, 'm_fixedData', 'TeamChaosProgress');
    return {
      team: blue === red ? null : blue > red ? 0 : 1,
      text: `Zerg wave launched (${pct(blue)} vs ${pct(red)})`,
    };
  },
  VolskayaCapturePointSpawned: () => ({
    team: null,
    text: 'Triglav Protector spawning',
    kind: 'verbose',
  }),
  VolskayaCapturePointComplete: (ev) => ({
    team: teamFromInt(statData(ev, 'm_intData', 'WinningTeam')),
    text: `Control point captured (${pct(statData(ev, 'm_fixedData', 'LosingTeamProgress'))} for the other team)`,
  }),
  WarheadJunctionNukesSpawned: (ev) => ({
    team: null,
    text: `${statData(ev, 'm_intData', 'NukeSpawnedCount')} nukes dropped`,
  }),
  WarheadJunctionNukeCollected: (ev) => ({
    team: teamFromInt(statData(ev, 'm_intData', 'OwningTeam')),
    text: 'Nuke picked up',
    kind: 'verbose',
  }),
  WarheadJunctionNukeDropped: (ev) => ({
    team: teamFromInt(statData(ev, 'm_intData', 'OwningTeam')),
    text: 'Nuke dropped',
    kind: 'verbose',
  }),
  WarheadJunctionNukeFired: (ev) => ({
    team: teamFromInt(statData(ev, 'm_intData', 'OwningTeam')),
    text: 'Nuke fired',
  }),
  'Altar Captured': (ev) => ({
    team: teamFromInt(statData(ev, 'm_intData', 'Firing Team')),
    text: `Altar captured (${(statData(ev, 'm_intData', 'Towns Owned') ?? 0) + 1} damage)`,
  }),
  'Town Captured': (ev) => ({
    team: teamFromInt((statData(ev, 'm_intData', 'New Owner') ?? 0) - 10),
    text: 'Fort captured',
  }),
  'Six Town Event Start': (ev) => ({
    team: teamFromInt(statData(ev, 'm_intData', 'Owning Team')),
    text: 'Holds all six forts',
  }),
  'Six Town Event End': (ev) => ({
    team: teamFromInt(statData(ev, 'm_intData', 'Owning Team')),
    text: 'No longer holds all six forts',
  }),
  'Boss Duel Started': (ev) => ({
    team: null,
    text: `Immortals spawn (duel ${statData(ev, 'm_intData', 'Boss Duel Number')})`,
  }),
  'Immortal Defeated': (ev) => {
    const power = Math.round(statData(ev, 'm_fixedData', 'Immortal Power Percent') / FIXED);
    return {
      team: teamFromInt(statData(ev, 'm_intData', 'Winning Team')),
      text: `Immortal fight won after ${statData(ev, 'm_intData', 'Immortal Fight Duration')}s (${power}% power kept)`,
    };
  },
};
export const VOLLEY_GAP_LOOPS = 3 * LOOPS_PER_SECOND;
export function flushVolley(model, run) {
  model.objectives.push({
    loop: run.loop,
    team: run.team,
    text: `${templeLabel(run.templeId)} fires ${run.shots} shot${run.shots === 1 ? '' : 's'} (${run.damage} damage)`,
    kind: 'objective',
  });
}
export const OBJECTIVE_UNITS = {
  VolskayaVehicle: 'Triglav Protector spawned',
  UnderworldSummonedBoss: 'Grave Golem spawned',
  GardenTerror: 'Garden Terror spawned',
  Payload_Neutral: 'Payload dropped',
  AllianceCavalry: 'Cavalry charges',
  HordeCavalry: 'Cavalry charges',
  CapturedSoldier: 'Prisoners freed',
};

export const COLLAPSE_UNIT_LINE_LOOPS = 10 * LOOPS_PER_SECOND;
