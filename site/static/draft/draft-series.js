const CHOGALL = ["Chogall", "Gall"];

export function otherTeam(team) {
  return team === "blue" ? "red" : "blue";
}

export function summarizeGame(state) {
  return { map: state.map, firstPick: state.firstPick, bans: state.bans, picks: state.picks };
}

export function seriesLockedHeroes(preset, games) {
  const picked = games.flatMap(g => [...g.picks.blue, ...g.picks.red]);
  return [...new Set([...preset, ...picked])];
}

export function openMaps(battlegrounds, games) {
  const used = new Set(games.map(g => g.map));
  return battlegrounds.filter(b => !used.has(b.slug));
}

export function togglePresetHero(preset, hero) {
  const group = CHOGALL.includes(hero) ? CHOGALL : [hero];
  return preset.includes(hero)
    ? preset.filter(h => !group.includes(h))
    : [...preset, ...group.filter(h => !preset.includes(h))];
}
