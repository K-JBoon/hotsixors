import assert from "node:assert/strict";
import test from "node:test";
import { marchUnits } from "../site/static/replay/march.js";
import { minionPositionAt } from "../site/static/replay/analyze.js";

const SPEEDS = { FootmanMinion: 3.25, RangedMinion: 3.25 };
const RANGES = { FootmanMinion: 0.875, RangedMinion: 5 };

const minion = (team: number, anchors: { loop: number; x: number; y: number }[], type = "FootmanMinion") => ({
  team,
  type,
  bornLoop: anchors[0].loop,
  diedLoop: anchors[anchors.length - 1].loop,
  anchors,
});
const emptyModel = { structures: [], players: [], companions: [], durationLoops: 4096 };
const march = (units: unknown[], model: unknown = emptyModel) =>
  marchUnits(units as never[], SPEEDS, { model, ranges: RANGES });

test("a minion walks at its own speed instead of stretching to fill the gap", () => {
  // 100 units of lane, 3.25/s: the walk takes 492 loops of the 800 available.
  const m = minion(0, [
    { loop: 0, x: 0, y: 0 },
    { loop: 800, x: 100, y: 0 },
  ]);
  march([m]);
  const [x] = minionPositionAt(m, 246)!;
  assert.ok(Math.abs(x - 50) < 4, `expected half the lane walked by loop 246, got x=${x}`);
  const [endX] = minionPositionAt(m, 800)!;
  assert.equal(Math.round(endX), 100);
});

test("a minion stops at weapon range of an enemy instead of walking through it", () => {
  const walker = minion(0, [
    { loop: 0, x: 0, y: 0 },
    { loop: 800, x: 100, y: 0 },
  ]);
  // A stationary enemy parked mid-lane for the whole window.
  const holder = minion(1, [
    { loop: 0, x: 40, y: 0 },
    { loop: 800, x: 40, y: 0 },
  ]);
  march([walker, holder]);
  const stopped = minionPositionAt(walker, 400)!;
  assert.ok(stopped[0] < 40, `walked past its target: x=${stopped[0]}`);
  assert.ok(stopped[0] > 36, `stopped nowhere near its target: x=${stopped[0]}`);
});

test("a minion breaks off in time to make its next logged position", () => {
  const walker = minion(0, [
    { loop: 0, x: 0, y: 0 },
    { loop: 800, x: 100, y: 0 },
  ]);
  const holder = minion(1, [
    { loop: 0, x: 40, y: 0 },
    { loop: 800, x: 40, y: 0 },
  ]);
  march([walker, holder]);
  assert.equal(Math.round(minionPositionAt(walker, 800)![0]), 100);
  // It has to still be moving in the run-up, not parked on the destination waiting.
  const before = minionPositionAt(walker, 780)![0];
  assert.ok(before < 99, `arrived early and stood still: x=${before} at loop 780`);
});

test("a ranged minion keeps its distance", () => {
  const walker = minion(
    0,
    [
      { loop: 0, x: 0, y: 0 },
      { loop: 800, x: 100, y: 0 },
    ],
    "RangedMinion"
  );
  const holder = minion(1, [
    { loop: 0, x: 40, y: 0 },
    { loop: 800, x: 40, y: 0 },
  ]);
  march([walker, holder]);
  const stopped = minionPositionAt(walker, 400)!;
  assert.ok(stopped[0] > 32 && stopped[0] < 35, `expected to hold at ~6 units of range, got x=${stopped[0]}`);
});

test("allies are not targets", () => {
  const walker = minion(0, [
    { loop: 0, x: 0, y: 0 },
    { loop: 800, x: 100, y: 0 },
  ]);
  const friend = minion(0, [
    { loop: 0, x: 40, y: 0 },
    { loop: 800, x: 40, y: 0 },
  ]);
  march([walker, friend]);
  assert.ok(minionPositionAt(walker, 400)![0] > 60, "stopped for a friendly minion");
});

test("towers and gates stop a march, moonwells and walls do not", () => {
  const withStructure = (type: string, shape: { r: number } | null = null) => {
    const m = minion(0, [
      { loop: 0, x: 0, y: 0 },
      { loop: 800, x: 100, y: 0 },
    ]);
    march([m], { ...emptyModel, structures: [{ type, shape, team: 1, x: 40, y: 0, bornLoop: 0, diedLoop: null }] });
    return minionPositionAt(m, 400)![0];
  };
  assert.ok(withStructure("TownCannonTowerL2") < 40, "walked into the tower");
  assert.ok(withStructure("TownGateL3VerticalLeftVisionBlocked") < 40, "walked through the gate");
  assert.ok(withStructure("TownMoonwellL2") > 60, "stopped for a healing fountain");
  assert.ok(withStructure("TownWallRadial5L2") > 60, "stopped for a side wall");
});

test("a footprint is attacked from its edge, not its centre", () => {
  const stopAt = (r: number) => {
    const m = minion(0, [
      { loop: 0, x: 0, y: 0 },
      { loop: 800, x: 100, y: 0 },
    ]);
    march([m], {
      ...emptyModel,
      structures: [{ type: "TownGateL3", shape: { r }, team: 1, x: 40, y: 0, bornLoop: 0, diedLoop: null }],
    });
    return minionPositionAt(m, 400)![0];
  };
  // A wide gate is reached ~3 units earlier than a point-sized one.
  assert.ok(stopAt(0) - stopAt(3) > 2.5, `footprint radius ignored: ${stopAt(0)} vs ${stopAt(3)}`);
});

test("logged positions are still hit exactly", () => {
  const m = minion(0, [
    { loop: 0, x: 0, y: 0 },
    { loop: 200, x: 10, y: 5 },
    { loop: 600, x: 60, y: 5 },
  ]);
  march([m]);
  const mid = minionPositionAt(m, 200)!;
  assert.ok(Math.hypot(mid[0] - 10, mid[1] - 5) < 0.6, `missed its logged position: ${mid}`);
  assert.equal(Math.round(minionPositionAt(m, 600)![0]), 60);
});

test("path samples move forward in time", () => {
  const m = minion(0, [
    { loop: 0, x: 0, y: 0 },
    { loop: 200, x: 10, y: 0 },
    { loop: 800, x: 100, y: 0 },
  ]);
  march([m]);
  const path = (m as { path?: { loop: number }[] }).path!;
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i].loop > path[i - 1].loop, `loop went backwards at index ${i}`);
  }
});
