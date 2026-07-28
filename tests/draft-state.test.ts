import assert from "node:assert/strict";
import test from "node:test";
import {
  PHASE_TABLE,
  createInitialState,
  applyEvent,
  teamOnClock,
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

// Play forward to the start of a given step, committing a distinct hero each
// time at the moment `now`. Returns the state with `state.step === targetStep`.
function playTo(targetStep, { now }) {
  let s = createInitialState({ ...baseInit, now });
  let h = 0;
  while (s.step < targetStep) {
    const phase = PHASE_TABLE[s.step];
    s = applyEvent(s, { kind: phase.action, team: teamOnClock(s), hero: `Hero${h++}`, now });
  }
  return s;
}

test("double-pick phases are consecutive same-team picks", () => {
  const doubles = [[5, 6], [7, 8], [11, 12], [13, 14]];
  for (const [a, b] of doubles) {
    assert.equal(PHASE_TABLE[a].action, "pick");
    assert.equal(PHASE_TABLE[b].action, "pick");
    assert.equal(PHASE_TABLE[a].team, PHASE_TABLE[b].team, `steps ${a}/${b} same team`);
  }
});

test("first pick of a double-pick phase arms a fresh 30s clock", () => {
  // Enter step 5 (first EN pick) by committing step 4 at a known time.
  const before = playTo(4, { now: 1_000_000 });
  const after = applyEvent(before, {
    kind: "pick", team: teamOnClock(before), hero: "FpPick", now: 5_000_000,
  });
  assert.equal(after.step, 5);
  assert.equal(after.turnDeadline, 5_000_000 + 30_000);
});

test("second pick of a double-pick phase inherits the shared clock", () => {
  // At step 5 with a deadline; committing the first pick must NOT reset it.
  const atStep5 = playTo(5, { now: 1_000_000 });
  const sharedDeadline = atStep5.turnDeadline;
  const atStep6 = applyEvent(atStep5, {
    kind: "pick", team: teamOnClock(atStep5), hero: "EnPick1", now: sharedDeadline - 12_000,
  });
  assert.equal(atStep6.step, 6);
  assert.equal(atStep6.turnDeadline, sharedDeadline, "deadline carries over unchanged");
});

test("leaving a double-pick phase arms a fresh clock for the next step", () => {
  // Step 6 -> 7 switches team (EN double ends, FP double begins): fresh 30s.
  const atStep6 = playTo(6, { now: 1_000_000 });
  const atStep7 = applyEvent(atStep6, {
    kind: "pick", team: teamOnClock(atStep6), hero: "EnPick2", now: 9_000_000,
  });
  assert.equal(atStep7.step, 7);
  assert.equal(atStep7.turnDeadline, 9_000_000 + 30_000);
});

test("single picks and bans always arm a fresh clock", () => {
  // Step 4 is the lone first pick (preceded by a ban), so committing the
  // step-3 ban must arm a fresh clock for it: no carry-over.
  const atStep3 = playTo(3, { now: 1_000_000 });
  const next = applyEvent(atStep3, {
    kind: "ban", team: teamOnClock(atStep3), hero: "Ban3", now: 7_000_000,
  });
  assert.equal(next.step, 4);
  assert.equal(next.turnDeadline, 7_000_000 + 30_000);
});

test("expired shared clock cascades: timeout on first pick leaves clock expired for second", () => {
  const atStep5 = playTo(5, { now: 1_000_000 });
  const expiredAt = atStep5.turnDeadline + 1; // a tick past the deadline
  // Host auto-commits the first pick at expiry.
  const atStep6 = applyEvent(atStep5, {
    kind: "timeout", now: expiredAt, available: ["Zed", "Abathur", "Murky"], highlighted: null,
  });
  assert.equal(atStep6.step, 6);
  assert.deepEqual(atStep6.picks[teamOnClock(atStep5)], ["Abathur"]);
  // The carried-over deadline is still in the past, so the host's timer re-fires.
  assert.ok(atStep6.turnDeadline < expiredAt, "second pick's clock is already expired");
});

test("untimed mode never sets a deadline", () => {
  let s = createInitialState({ ...baseInit, timerMode: "untimed", now: 1_000_000 });
  assert.equal(s.turnDeadline, null);
  s = applyEvent(s, { kind: "ban", team: teamOnClock(s), hero: "B", now: 2_000_000 });
  assert.equal(s.turnDeadline, null);
});
