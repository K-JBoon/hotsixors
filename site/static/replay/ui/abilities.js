
const SLOT_LABELS = { A: 'Attack', S: 'Stop', Z: 'Mount', B: 'Hearthstone' };
const GENERIC_SLOTS = {
  attack: 'A', stop: 'S', HoldFire: 'S', move: null,
  Mount: 'Z', Dismount: 'Z', Hearthstone: 'B',
};
const ABILITY_ID_ALIASES = {
  LostVikingsControlAll: 'LostVikingSelectAll',
  LostVikingsControlErik: 'LostVikingSelectErik',
  LostVikingsControlBaleog: 'LostVikingSelectBaleog',
  LostVikingsControlOlaf: 'LostVikingSelectOlaf',
};
export const normalizeName = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function heroMeta(draftData, heroName) {
  const want = normalizeName(heroName);
  return draftData.heroes.find((h) => normalizeName(h.name) === want) || null;
}

export function toSlotLetter(abilityType) {
  return abilityType === 'Heroic' ? 'R' : abilityType === 'Trait' ? 'D' : abilityType;
}
export function abilityEntryFor(shortcodeData, heroSlug, nameId) {
  const entry = shortcodeData[nameId];
  if (entry && normalizeName(entry.heroSlug || '') === heroSlug) return entry;
  return shortcodeData[`${heroSlug}:${nameId}`] || (entry && !entry.heroSlug ? entry : null);
}
export function humanizeNameId(nameId, heroId) {
  let rest = nameId;
  for (const prefix of heroId ? [heroId, `${heroId}s`] : []) {
    if (rest.length > prefix.length && rest.toLowerCase().startsWith(prefix.toLowerCase())) {
      rest = rest.slice(prefix.length);
      break;
    }
  }
  const words = rest.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return words || nameId;
}
export function resolveLink(shortcodeData, abilLinkIndex, heroSlug, heroId, link) {
  const nameId = abilLinkIndex[link];
  if (!nameId) return { nameId: null, entry: null, slot: null, label: `Ability #${link}`, icon: null };
  if (nameId in GENERIC_SLOTS) {
    const slot = GENERIC_SLOTS[nameId];
    return { nameId, entry: null, slot, label: (slot && SLOT_LABELS[slot]) || nameId, icon: null };
  }
  const entry = abilityEntryFor(shortcodeData, heroSlug, ABILITY_ID_ALIASES[nameId] || nameId);
  if (!entry) return { nameId, entry: null, slot: null, label: humanizeNameId(nameId, heroId), icon: null };
  return { nameId, entry, slot: toSlotLetter(entry.abilityType), label: entry.name, icon: entry.icon };
}
export function movementLinkSet(abilLinkIndex, movementAbilities) {
  const links = new Set();
  for (const [link, nameId] of Object.entries(abilLinkIndex || {})) {
    if (movementAbilities && movementAbilities[nameId] === 'caster-teleport') links.add(Number(link));
  }
  return links;
}
export function hearthLinkSet(abilLinkIndex) {
  const links = new Set();
  for (const [link, nameId] of Object.entries(abilLinkIndex || {})) {
    if (/Hearthstone$/.test(nameId)) links.add(Number(link));
  }
  return links;
}

export function castLabel(p, cast) {
  const info = p.linkInfo[cast.link] || { label: `Ability #${cast.link}`, icon: null, slot: null };
  return { label: info.label, icon: info.icon, slot: info.slot };
}
