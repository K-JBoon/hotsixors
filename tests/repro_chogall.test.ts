import assert from "node:assert/strict";
import test from "node:test";
import {
  PHASE_TABLE,
  createInitialState,
  applyEvent,
} from "../site/static/draft/draft-state.js";

const baseInit = {
  lobbyCode: "ABCD",
  hostPeerId: "p1",
  captains: { blue: { peerId: "p1", name: "Blue" }, red: { peerId: "p2", name: "Red" } },
  firstPick: "blue",
  timerMode: "timed",
  map: "cursed-hollow",
  now: 1_000_000,
};

test("timeout auto-pick should pick Cho'gall if highlighted and in a valid double-pick slot", () => {
  // Step 5 is the first EN double-pick.
  const state = createInitialState(baseInit);
  // Bans... (0,1,2,3)
  let s = applyEvent(state, { kind: "ban", team: "blue", hero: "Hero1", now: 1000 });
  s = applyEvent(s, { kind: "ban", team: "red", hero: "Hero2", now: 1000 });
  s = applyEvent(s, { kind: "ban", team: "blue", hero: "Hero3", now: 1000 });
  s = applyEvent(s, { kind: "ban", team: "red", hero: "Hero4", now: 1000 });
  // Step 4: FP pick
  s = applyEvent(s, { kind: "pick", team: "blue", hero: "Hero5", now: 1000 });
  
  assert.equal(s.step, 5);
  assert.equal(PHASE_TABLE[s.step].team, "EN");
  
  const available = ["Chogall", "Gall", "Abathur", "Murky"];
  
  // Timeout with Chogall highlighted.
  const next = applyEvent(s, { kind: "timeout", now: 2_000_000, available, highlighted: "Chogall" });
  
  assert.equal(next.step, 7); // Advanced 2 steps
  assert.deepEqual(next.picks.red, ["Chogall", "Gall"]);
});

test("timeout auto-pick should fallback if Cho'gall is highlighted but NOT in a valid slot", () => {
  // Step 4 is a single pick for Blue.
  const state = createInitialState(baseInit);
  let s = applyEvent(state, { kind: "ban", team: "blue", hero: "Hero1", now: 1000 });
  s = applyEvent(s, { kind: "ban", team: "red", hero: "Hero2", now: 1000 });
  s = applyEvent(s, { kind: "ban", team: "blue", hero: "Hero3", now: 1000 });
  s = applyEvent(s, { kind: "ban", team: "red", hero: "Hero4", now: 1000 });
  
  assert.equal(s.step, 4);
  
  const available = ["Chogall", "Gall", "Abathur", "Murky"];
  
  // Timeout with Chogall highlighted, but it's a single pick phase.
  const next = applyEvent(s, { kind: "timeout", now: 2_000_000, available, highlighted: "Chogall" });
  
  assert.equal(next.step, 5); // Advanced 1 step
  assert.equal(next.picks.blue[0], "Abathur"); // Alphabetical fallback (skipping Cho/Gall)
});
