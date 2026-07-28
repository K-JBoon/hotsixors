
const td = new TextDecoder();

export const str = (b) => (b instanceof Uint8Array ? td.decode(b) : String(b ?? ''));

export const LOOPS_PER_SECOND = 16;
export const FIXED = 4096;
export function statData(ev, field, key) {
  const list = ev[field];
  if (!list) return null;
  for (const item of list) {
    if (str(item.m_key) === key) return item.m_value;
  }
  return null;
}

export function statDataAll(ev, field, key) {
  const list = ev[field] || [];
  return list.filter((i) => str(i.m_key) === key).map((i) => i.m_value);
}
export const teamFromInt = (v) => (v === 1 || v === 2 ? v - 1 : null);

export const teamFromFixed = (v) => (v == null ? null : teamFromInt(Math.round(v / FIXED)));
export const pct = (v) => {
  const n = v / FIXED;
  return `${Math.round(n <= 1.5 ? n * 100 : n)}%`;
};
export const XP_SOURCES = [
  { key: 'minion', stat: 'MinionXP', label: 'Minions' },
  { key: 'structure', stat: 'StructureXP', label: 'Structures' },
  { key: 'creep', stat: 'CreepXP', label: 'Mercs' },
  { key: 'hero', stat: 'HeroXP', label: 'Heroes' },
  { key: 'trickle', stat: 'TrickleXP', label: 'Passive' },
];
export function xpSample(ev, loop, level) {
  const sample = { loop, level: level || 0, total: 0 };
  for (const src of XP_SOURCES) {
    const value = Math.round((statData(ev, 'm_fixedData', src.stat) || 0) / FIXED);
    sample[src.key] = value;
    sample.total += value;
  }
  return sample;
}
