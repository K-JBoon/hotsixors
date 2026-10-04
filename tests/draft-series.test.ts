import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, applyEvent, chogallIsPickable, teamOnClock, PHASE_TABLE } from "../site/static/draft/draft-state.js";
import {
  seriesLockedHeroes,
  openMaps,
  togglePresetHero,
  summarizeGame,
} from "../site/static/draft/draft-series.js";

const baseInit = {
  lobbyCode: "ABCD",
  hostPeerId: "p1",
  captains: { blue: { peerId: "p1", name: "Blue" }, red: { peerId: "p2", name: "Red" } },
  firstPick: "blue",
  timerMode: "untimed",
  map: "cursed-hollow",
  now: 0,
};

const game = (map: string, blue: string[], red: string[]) =>
  ({ map, firstPick: "blue", bans: { blue: ["X"], red: ["Y"] }, picks: { blue, red } });

test("locked heroes come from the preset and every earlier pick, not bans", () => {
  const games = [game("a", ["Abathur", "Ana"], ["Zeratul"]), game("b", ["Muradin"], ["Ana"])];
  assert.deepEqual(seriesLockedHeroes(["Tracer"], games), ["Tracer", "Abathur", "Ana", "Zeratul", "Muradin"]);
});

test("locked heroes cannot be banned or picked", () => {
  const s = createInitialState({ ...baseInit, locked: ["Abathur"] });
  assert.throws(() => applyEvent(s, { kind: "ban", team: "blue", hero: "Abathur", now: 0 }), /already used/);
});

test("timeout auto-pick skips locked heroes", () => {
  const s = createInitialState({ ...baseInit, locked: ["Abathur"] });
  const next = applyEvent(s, { kind: "timeout", now: 0, available: ["Abathur", "Ana"], highlighted: "Abathur" });
  assert.deepEqual(next.bans.blue, ["Ana"]);
});

test("a locked Cho blocks the Cho'gall pick", () => {
  let s = createInitialState({ ...baseInit, locked: ["Chogall", "Gall"] });
  let h = 0;
  while (s.step < 5) s = applyEvent(s, { kind: PHASE_TABLE[s.step].action, team: teamOnClock(s), hero: `H${h++}`, now: 0 });
  assert.equal(chogallIsPickable(s), false);
});

test("map pool excludes maps played earlier in the series", () => {
  const bgs = [{ slug: "a" }, { slug: "b" }, { slug: "c" }];
  assert.deepEqual(openMaps(bgs, [game("b", [], [])]).map(b => b.slug), ["a", "c"]);
});

test("preset toggles Cho and Gall together", () => {
  const on = togglePresetHero(["Ana"], "Gall");
  assert.deepEqual(on, ["Ana", "Chogall", "Gall"]);
  assert.deepEqual(togglePresetHero(on, "Chogall"), ["Ana"]);
  assert.deepEqual(togglePresetHero(on, "Ana"), ["Chogall", "Gall"]);
});

test("game summary keeps only what later games need", () => {
  const s = createInitialState({ ...baseInit, locked: ["Ana"], game: 2 });
  assert.deepEqual(Object.keys(summarizeGame(s)).sort(), ["bans", "firstPick", "map", "picks"]);
});
