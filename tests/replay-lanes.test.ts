import assert from "node:assert/strict";
import test from "node:test";
import { buildLanePaths, routeUnitsAlongLanes } from "../site/static/replay/lanes.js";
import { minionPositionAt } from "../site/static/replay/analyze.js";

// An L-shaped lane: east along y=0 to x=40, then north to y=40. A minion
// sampled at the two ends must go round the corner, not diagonally across it.
const L_LANE = [[
  [0, 0], [10, 0], [20, 0], [30, 0], [40, 0], [40, 10], [40, 20], [40, 30], [40, 40],
]];

const minion = (anchors) => ({
  team: 0,
  type: "FootmanMinion",
  bornLoop: anchors[0].loop,
  diedLoop: anchors[anchors.length - 1].loop,
  anchors,
});

test("buildLanePaths measures arc length along the chain", () => {
  const [path] = buildLanePaths(L_LANE);
  assert.equal(path.length, 80);
  assert.deepEqual([...path.cum].slice(0, 3), [0, 10, 20]);
});

test("buildLanePaths drops lanes too short to walk", () => {
  assert.equal(buildLanePaths([[[1, 1]], null, [[0, 0], [5, 0]]]).length, 1);
});

test("a minion sampled at both ends walks round the corner", () => {
  const m = minion([
    { loop: 0, x: 0, y: 0 },
    { loop: 160, x: 40, y: 40 },
  ]);
  routeUnitsAlongLanes([m], buildLanePaths(L_LANE));
  const mid = minionPositionAt(m, 80);
  // Straight-line interpolation would put it at (20,20), well inside the corner.
  assert.ok(Math.abs(mid[0] - 40) < 1 || Math.abs(mid[1]) < 1, `expected a point on the lane, got ${mid}`);
  for (let loop = 0; loop <= 160; loop += 5) {
    const [x, y] = minionPositionAt(m, loop);
    assert.ok(y < 1 || x > 39, `left the lane at loop ${loop}: (${x}, ${y})`);
  }
});

test("routing keeps time moving forward and both samples intact", () => {
  const m = minion([
    { loop: 0, x: 0, y: 0 },
    { loop: 160, x: 40, y: 40 },
  ]);
  routeUnitsAlongLanes([m], buildLanePaths(L_LANE));
  assert.ok(m.anchors.length > 2);
  assert.deepEqual(m.anchors[0], { loop: 0, x: 0, y: 0 });
  assert.deepEqual(m.anchors[m.anchors.length - 1], { loop: 160, x: 40, y: 40 });
  for (let i = 1; i < m.anchors.length; i++) {
    assert.ok(m.anchors[i].loop >= m.anchors[i - 1].loop, "anchor loops must not go backwards");
  }
});

test("a minion walking the other way follows the lane in reverse", () => {
  const m = minion([
    { loop: 0, x: 40, y: 40 },
    { loop: 160, x: 0, y: 0 },
  ]);
  routeUnitsAlongLanes([m], buildLanePaths(L_LANE));
  for (let loop = 0; loop <= 160; loop += 5) {
    const [x, y] = minionPositionAt(m, loop);
    assert.ok(y < 1 || x > 39, `left the lane at loop ${loop}: (${x}, ${y})`);
  }
});

test("a wave's spread survives the trip", () => {
  // Two units three units apart across the lane keep that gap mid-route
  // instead of collapsing onto the centre line.
  const pair = [3, -3].map((offset) =>
    minion([
      { loop: 0, x: 0, y: offset },
      { loop: 160, x: 40, y: 40 + offset },
    ])
  );
  routeUnitsAlongLanes(pair, buildLanePaths(L_LANE));
  const [a, b] = pair.map((m) => minionPositionAt(m, 60));
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 4, `wave collapsed: ${a} vs ${b}`);
});

test("samples nowhere near a lane keep their straight segment", () => {
  const m = minion([
    { loop: 0, x: 0, y: 90 },
    { loop: 160, x: 40, y: 90 },
  ]);
  routeUnitsAlongLanes([m], buildLanePaths(L_LANE));
  assert.equal(m.anchors.length, 2);
});

test("a detour far longer than the straight line is rejected", () => {
  // Both points sit on the lane, but at opposite ends of a long U: a unit
  // teleporting between them was not walking that stretch.
  const uLane = [[[0, 0], [0, 50], [4, 50], [4, 0]]];
  const m = minion([
    { loop: 0, x: 0, y: 0 },
    { loop: 16, x: 4, y: 0 },
  ]);
  routeUnitsAlongLanes([m], buildLanePaths(uLane));
  assert.equal(m.anchors.length, 2);
});

test("standing still inserts nothing", () => {
  const m = minion([
    { loop: 0, x: 20, y: 0 },
    { loop: 160, x: 20, y: 0 },
  ]);
  routeUnitsAlongLanes([m], buildLanePaths(L_LANE));
  assert.equal(m.anchors.length, 2);
});

test("a map with no lane data leaves minions untouched", () => {
  const m = minion([
    { loop: 0, x: 0, y: 0 },
    { loop: 160, x: 40, y: 40 },
  ]);
  routeUnitsAlongLanes([m], buildLanePaths([]));
  assert.equal(m.anchors.length, 2);
});
