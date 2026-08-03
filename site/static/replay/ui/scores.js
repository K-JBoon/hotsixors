
import { clockText } from './html.js';
export const compactNumber = (v) => (v >= 10000 ? `${(v / 1000).toFixed(1)}k` : String(v));
export const secondsText = (v) => {
  const s = Math.round(v);
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  if (s >= 3600) return `${Math.floor(s / 3600)}h${mm}`;
  return clockText(s);
};
export const SCORE_COLUMNS = [
  {
    id: 'kda',
    label: 'K/A/D',
    title: 'Kills / assists / deaths',
    keys: ['SoloKill', 'Assists', 'Deaths'],
    text: ([k, a, d]) => `${k}/${a}/${d}`,
    sort: ([k, a]) => k * 1000 + a,
    always: true,
  },
  { id: 'takedowns', label: 'TD', title: 'Takedowns', keys: ['Takedowns'], always: true },
  { id: 'herodmg', label: 'Hero', title: 'Hero damage', keys: ['HeroDamage'], always: true },
  { id: 'siege', label: 'Siege', title: 'Siege damage', keys: ['SiegeDamage'], always: true },
  { id: 'taken', label: 'Taken', title: 'Damage taken', keys: ['DamageTaken'] },
  { id: 'healing', label: 'Heal', title: 'Healing', keys: ['Healing'] },
  { id: 'selfheal', label: 'Self', title: 'Self healing', keys: ['SelfHealing'] },
  { id: 'shield', label: 'Shield', title: 'Shielding', keys: ['ProtectionGivenToAllies'] },
  {
    id: 'xp',
    label: 'XP',
    title: 'Experience contribution',
    keys: ['ExperienceContribution'],
    always: true,
  },
  { id: 'mercs', label: 'Mercs', title: 'Merc camp captures', keys: ['MercCampCaptures'] },
  { id: 'towers', label: 'Eyes', title: 'Watch tower captures', keys: ['WatchTowerCaptures'] },
  { id: 'globes', label: 'Globes', title: 'Regen globes', keys: ['RegenGlobes'] },
  {
    id: 'cc',
    label: 'CC',
    title: 'Time crowd controlling enemy heroes',
    keys: ['TimeCCdEnemyHeroes'],
    text: ([v]) => secondsText(v),
  },
  {
    id: 'dead',
    label: 'Dead',
    title: 'Time spent dead',
    keys: ['TimeSpentDead'],
    text: ([v]) => secondsText(v),
    always: true,
  },
  {
    id: 'temple',
    label: 'Temple',
    title: 'Time in temple',
    keys: ['TimeInTemple'],
    text: ([v]) => secondsText(v),
  },
  {
    id: 'point',
    label: 'Point',
    title: 'Time on point',
    keys: ['TimeOnPoint'],
    text: ([v]) => secondsText(v),
  },
  {
    id: 'payload',
    label: 'Payload',
    title: 'Time on payload',
    keys: ['TimeOnPayload'],
    text: ([v]) => secondsText(v),
  },
  { id: 'cages', label: 'Cages', title: 'Cage unlocks interrupted', keys: ['CageUnlocksInterrupted'] },
  { id: 'seeds', label: 'Seeds', title: 'Seeds collected', keys: ['GardenSeedsCollectedByPlayer'] },
];

export const scoreValues = (p, col) => col.keys.map((k) => Number(p.score[k] ?? 0));
export const scoreSortValue = (p, col) => {
  const values = scoreValues(p, col);
  return col.sort ? col.sort(values) : values[0];
};
export function activeScoreColumns(players) {
  return SCORE_COLUMNS.filter(
    (col) =>
      players.some((p) => col.keys.some((k) => p.score[k] != null)) &&
      (col.always || players.some((p) => scoreValues(p, col).some((v) => v > 0)))
  );
}
