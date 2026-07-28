
export const newRegistry = (byPlayerId) => ({
  byPlayerId,
  unitToPlayer: new Map(), // tag -> player, for kill and revive attribution
  heroesByIndex: new Map(), // index -> player, main body only, lives all game
  bodyByTag: new Map(), // tag -> player or companion
  companionsByTag: new Map(),
  companionsByIndex: new Map(),
  visionByTag: new Map(),
  visionByIndex: new Map(),
  structsByTag: new Map(),
  minionsByTag: new Map(),
  minionsByIndex: new Map(),
  objSitesByTag: new Map(),
  objSitesByIndex: new Map(),
  phaseUnitsByTag: new Map(), // tag -> {type, team}, for died signals
});

export const tagOf = (ev) => `${ev.m_unitTagIndex}:${ev.m_unitTagRecycle}`;

export function pushByIndex(byIndex, index, unit) {
  const list = byIndex.get(index);
  if (list) list.push(unit);
  else byIndex.set(index, [unit]);
}
export function aliveAtLoop(byIndex, index, loop) {
  const list = byIndex.get(index);
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const u = list[i];
    if (u.bornLoop <= loop && (u.diedLoop == null || u.diedLoop >= loop)) return u;
  }
  return null;
}
export const bodyAtLoopOf = (reg) => (index, loop) =>
  reg.heroesByIndex.get(index) || aliveAtLoop(reg.companionsByIndex, index, loop);
export const ownerAtLoopOf = (reg) => {
  const bodyAtLoop = bodyAtLoopOf(reg);
  return (index, loop) => {
    const body = bodyAtLoop(index, loop);
    if (!body) return null;
    return body.ownerId == null ? body : reg.byPlayerId.get(body.ownerId);
  };
};
export const isAiPlayer = (pid) => pid === 11 || pid === 12;

export const teamOfOwnerIn = (byPlayerId) => (pid) => {
  if (isAiPlayer(pid)) return pid - 11;
  const p = byPlayerId.get(pid);
  return p ? p.team : null;
};

export function openSpan(body, loop) {
  const last = body.spans[body.spans.length - 1];
  if (last && last.to == null) return;
  body.spans.push({ from: loop, to: null });
}

export function closeSpan(body, loop) {
  const last = body.spans[body.spans.length - 1];
  if (last && last.to == null) last.to = loop;
}
