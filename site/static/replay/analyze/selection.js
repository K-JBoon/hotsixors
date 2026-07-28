export const TAG_RECYCLE_SPAN = 1 << 22;

export const splitTag = (packed) =>
  `${Math.floor(packed / TAG_RECYCLE_SPAN)}:${packed % TAG_RECYCLE_SPAN}`;
const LIVE_SELECTION_GROUP = 10;

export const newSelection = () => ({ units: [], groups: new Map() });
function keepSelected(units, mask) {
  if (!mask || mask.None !== undefined) return units;
  if (mask.ZeroIndices) return units.filter((_, i) => mask.ZeroIndices.includes(i));
  if (mask.OneIndices) return units.filter((_, i) => !mask.OneIndices.includes(i));
  if (mask.Mask) {
    const [length, bits] = mask.Mask;
    return units.filter((_, i) => i >= length || !((bits >> i) & 1));
  }
  return units;
}

export function applySelectionDelta(sel, groupId, delta) {
  if (!delta) return;
  const list = groupId === LIVE_SELECTION_GROUP ? sel.units : sel.groups.get(groupId) || [];
  const next = keepSelected(list, delta.m_removeMask).concat(delta.m_addUnitTags || []);
  if (groupId === LIVE_SELECTION_GROUP) sel.units = next;
  else sel.groups.set(groupId, next);
}
export function applyControlGroupUpdate(sel, index, update) {
  const group = sel.groups.get(index) || [];
  if (update === 0) sel.groups.set(index, [...sel.units]);
  else if (update === 1) sel.groups.set(index, [...new Set(group.concat(sel.units))]);
  else if (update === 2) sel.units = [...group];
}
