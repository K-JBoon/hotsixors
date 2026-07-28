
export const PHASE_TABLE = Object.freeze([
  { action: "ban",  team: "FP", timer: 60 },
  { action: "ban",  team: "EN", timer: 30 },
  { action: "ban",  team: "FP", timer: 30 },
  { action: "ban",  team: "EN", timer: 30 },
  { action: "pick", team: "FP", timer: 30 },
  { action: "pick", team: "EN", timer: 30 },
  { action: "pick", team: "EN", timer: 30 },
  { action: "pick", team: "FP", timer: 30 },
  { action: "pick", team: "FP", timer: 30 },
  { action: "ban",  team: "EN", timer: 30 },
  { action: "ban",  team: "FP", timer: 30 },
  { action: "pick", team: "EN", timer: 30 },
  { action: "pick", team: "EN", timer: 30 },
  { action: "pick", team: "FP", timer: 30 },
  { action: "pick", team: "FP", timer: 30 },
  { action: "pick", team: "EN", timer: 30 },
]);

export function createInitialState({ lobbyCode, hostPeerId, captains, firstPick, timerMode, map, now }) {
  if (firstPick !== "blue" && firstPick !== "red") throw new Error("firstPick must be 'blue' or 'red'");
  if (!map) throw new Error("map is required before draft start");
  const deadline = timerMode === "timed" ? now + PHASE_TABLE[0].timer * 1000 : null;
  return Object.freeze({
    lobbyCode,
    hostPeerId,
    captains,
    firstPick,
    timerMode,
    map,
    bans:  { blue: [], red: [] },
    picks: { blue: [], red: [] },
    step: 0,
    turnDeadline: deadline,
  });
}

export function currentPhase(state) {
  return state.step < PHASE_TABLE.length ? PHASE_TABLE[state.step] : null;
}

export function isDraftComplete(state) {
  return state.step >= PHASE_TABLE.length;
}

export function teamOnClock(state) {
  const phase = currentPhase(state);
  if (!phase) return null;
  const fp = state.firstPick;
  const en = fp === "blue" ? "red" : "blue";
  return phase.team === "FP" ? fp : en;
}
export function teamForRole(role) {
  return role === "captain-blue" ? "blue" : role === "captain-red" ? "red" : null;
}

export function heroIsUsed(state, hero) {
  return state.bans.blue.includes(hero) ||
         state.bans.red.includes(hero) ||
         state.picks.blue.includes(hero) ||
         state.picks.red.includes(hero);
}
export function chogallIsPickable(state) {
  if (isDraftComplete(state)) return false;
  const phase = currentPhase(state);
  if (phase?.action !== "pick") return false;
  const nextPhase = (state.step + 1) < PHASE_TABLE.length ? PHASE_TABLE[state.step + 1] : null;
  if (!sharesTimer(phase, nextPhase)) return false;
  return !heroIsUsed(state, "Chogall") && !heroIsUsed(state, "Gall");
}
function sharesTimer(prev, next) {
  return !!prev && !!next && prev.action === "pick" && next.action === "pick" && prev.team === next.team;
}

function advance(state, mutate, now) {
  const next = {
    ...state,
    bans:  { blue: [...state.bans.blue],  red: [...state.bans.red] },
    picks: { blue: [...state.picks.blue], red: [...state.picks.red] },
  };
  mutate(next);
  const prevPhase = state.step < PHASE_TABLE.length ? PHASE_TABLE[state.step] : null;
  next.step = state.step + 1;
  const nextPhase = next.step < PHASE_TABLE.length ? PHASE_TABLE[next.step] : null;
  if (state.timerMode !== "timed" || !nextPhase) {
    next.turnDeadline = null;
  } else if (sharesTimer(prevPhase, nextPhase)) {
    next.turnDeadline = state.turnDeadline;
  } else {
    next.turnDeadline = now + nextPhase.timer * 1000;
  }
  return Object.freeze(next);
}

function commitHero(state, team, hero, action, now) {
  if (isDraftComplete(state)) throw new Error("draft is complete");
  const phase = currentPhase(state);
  if (phase.action !== action) throw new Error(`wrong phase: expected ${phase.action}, got ${action}`);
  if (teamOnClock(state) !== team) throw new Error(`team ${team} is not on the clock`);
  if (heroIsUsed(state, hero)) throw new Error(`hero ${hero} is already used`);
  if (action === "pick" && (hero === "Chogall" || hero === "Gall")) {
    throw new Error("Cho and Gall must be picked together via pick-chogall");
  }
  return advance(state, (next) => {
    if (action === "ban") next.bans[team].push(hero);
    else next.picks[team].push(hero);
  }, now);
}

function applyPickChogall(state, team, now) {
  if (isDraftComplete(state)) throw new Error("draft is complete");
  const phase = currentPhase(state);
  if (phase?.action !== "pick") throw new Error("not a pick phase");
  if (teamOnClock(state) !== team) throw new Error(`team ${team} is not on the clock`);
  const nextStepPhase = (state.step + 1) < PHASE_TABLE.length ? PHASE_TABLE[state.step + 1] : null;
  if (!sharesTimer(phase, nextStepPhase)) throw new Error("Cho'gall can only be picked in a double-pick phase");
  if (heroIsUsed(state, "Chogall") || heroIsUsed(state, "Gall")) throw new Error("Cho or Gall is already used");
  const next = {
    ...state,
    bans:  { blue: [...state.bans.blue],  red: [...state.bans.red] },
    picks: { blue: [...state.picks.blue], red: [...state.picks.red] },
  };
  next.picks[team].push("Chogall", "Gall");
  next.step = state.step + 2;
  const afterPhase = next.step < PHASE_TABLE.length ? PHASE_TABLE[next.step] : null;
  next.turnDeadline = (state.timerMode !== "timed" || !afterPhase)
    ? null
    : now + afterPhase.timer * 1000;
  return Object.freeze(next);
}

export function applyEvent(state, event) {
  switch (event.kind) {
    case "ban":  return commitHero(state, event.team, event.hero, "ban",  event.now);
    case "pick": return commitHero(state, event.team, event.hero, "pick", event.now);
    case "pick-chogall": return applyPickChogall(state, event.team, event.now);
    case "timeout": {
      const team = teamOnClock(state);
      const phase = currentPhase(state);
      let hero = event.highlighted;
      const available = event.available || [];

      const isChogall = (h) => h === "Chogall" || h === "Gall";
      const canPickChogall = phase.action === "pick" && chogallIsPickable(state);

      if (!hero || heroIsUsed(state, hero) || !available.includes(hero)) {
        const candidates = available.filter(h => {
          if (heroIsUsed(state, h)) return false;
          if (phase.action === "pick" && isChogall(h)) return false; // never auto-pick Cho/Gall
          return true;
        });
        candidates.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
        hero = candidates[0];
      }

      if (!hero) throw new Error("no available heroes for timeout auto-pick");

      if (phase.action === "pick" && isChogall(hero)) {
        if (canPickChogall) return applyPickChogall(state, team, event.now);
        const candidates = available.filter(h => !heroIsUsed(state, h) && !isChogall(h));
        candidates.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
        hero = candidates[0];
        if (!hero) throw new Error("no available heroes for timeout auto-pick");
      }

      return commitHero(state, team, hero, phase.action, event.now);
    }
    case "host-handoff":
      return Object.freeze({ ...state, hostPeerId: event.newHostPeerId });
    default:
      throw new Error(`unknown event kind: ${event.kind}`);
  }
}
