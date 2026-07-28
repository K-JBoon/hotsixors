
const STRUCTURE_RE = /^(Town|Kings|VolskayaMechanic|BossDuel)?(TownHall|Wall|Gate|CannonTower|Moonwell|Core|KingsCore)/;
const RUBBLE_RE = /Destroyed/;

export const isStructure = (name) => STRUCTURE_RE.test(name) && !RUBBLE_RE.test(name);
const MINION_RE = /Minion|Merc|Golem|Laner|Zerg/;
const NOT_A_UNIT_RE = /Globe|Dummy|Missile|Blocker|Beacon|Icon|Sconce|Tracker|Camera/;

export const isMinion = (name) => MINION_RE.test(name) && !NOT_A_UNIT_RE.test(name);

export const CAMP_DEFENDER_TYPES = {
  MercDefenderMeleeKnight: 'elite',
  MercDefenderRangedMage: 'elite',
  MercSummonerDefender: 'elite',
  MercSummonerDefenderMinion: 'elite',
  TerranGoliathDefender: 'elite',
  TerranRavenDefender: 'elite',
  JungleGraveGolemDefender: 'boss',
  TerranArchangelDefender: 'boss',
  SlimeBossDefender: 'boss',
};
export const CAMP_DEFENDER_DIST = 30;
export const COMPANION_TYPES = {
  RexxarMisha: 'pet',
  NovaHoloClone: 'decoy',
  SamuroMirrorImage: 'decoy',
  DryadWispUnit: 'summon',
};
export const VIKING_CONTROLLER = 'HeroLostVikingsController';
export const VIKING_BODIES = new Set(['HeroErik', 'HeroBaleog', 'HeroOlaf']);
export const VISION_UNITS = new Set(['ChromieTimeTrap']);
