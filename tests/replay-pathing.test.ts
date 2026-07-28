import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWalkGrid,
  findPath,
  lineWalkable,
  routeUnitsThroughTerrain,
} from "../site/static/replay/pathing.js";
import { buildPositionTimeline, minionPositionAt } from "../site/static/replay/analyze.js";

// Builds a mask image the way gen-replay-maps.mjs writes one: row 0 is the top
// of the world, B marks an unwalkable cell. `rows` are given top-down, using
// '#' for unwalkable and '.' for open ground.
function grid(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const rgba = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      const i = (y * width + x) * 4;
      rgba[i + 2] = c === "#" ? 255 : 0;
      rgba[i + 3] = 255;
    });
  });
  return buildWalkGrid(rgba, width, height);
}

test("the mask's top row becomes the world's highest y", () => {
  const g = grid([
    "#.",
    "..",
  ]);
  assert.equal(g.blocked[1 * 2 + 0], 1); // world (0,1), top-left of the image
  assert.equal(g.blocked[0 * 2 + 0], 0); // world (0,0), bottom-left
});

test("a sight-blocking wall also blocks a straight walk", () => {
  const g = grid([
    ".....",
    "..#..",
    ".....",
  ]);
  assert.equal(lineWalkable(g, 0.5, 1.5, 4.5, 1.5), false);
  assert.equal(lineWalkable(g, 0.5, 0.5, 4.5, 0.5), true);
});

test("a route bends around a wall instead of through it", () => {
  const g = grid([
    "..#..",
    "..#..",
    "..#..",
    ".....",
  ]);
  const path = findPath(g, 0.5, 3.5, 4.5, 3.5);
  assert.ok(path);
  // every leg of the route stays on walkable ground
  let [px, py] = [0.5, 3.5];
  for (const [x, y] of path) {
    assert.ok(lineWalkable(g, px, py, x, y), `leg ${px},${py} -> ${x},${y} crosses a wall`);
    [px, py] = [x, y];
  }
  assert.deepEqual(path[path.length - 1], [4.5, 3.5]);
});

test("an open field routes straight, without stair-stepping through cell centres", () => {
  const g = grid([
    ".....",
    ".....",
    ".....",
  ]);
  assert.deepEqual(findPath(g, 0.5, 0.5, 4.5, 2.5), [[4.5, 2.5]]);
});

test("a walled-off target has no route", () => {
  const g = grid([
    "#####",
    "#...#",
    "#####",
    ".....",
  ]);
  assert.equal(findPath(g, 0.5, 0.5, 2.5, 2.5), null);
});

const wallMap = () =>
  grid([
    "..........",
    "..........",
    "....##....",
    "....##....",
    "....##....",
    "....##....",
    "..........",
    "..........",
  ]);

function player(over = {}) {
  return { anchors: [{ loop: 0, x: 1, y: 4 }], moves: [], casts: [], ...over };
}

function sampleAt(tl, loop) {
  const i = Math.floor(loop / tl.step);
  return [tl.samples[i * 2], tl.samples[i * 2 + 1]];
}

test("a walking hero is routed around terrain rather than through it", () => {
  const p = player({ moves: [{ loop: 0, x: 9, y: 4 }] });
  const walkGrid = wallMap();
  const straight = buildPositionTimeline(p, 320, { step: 8 });
  const routed = buildPositionTimeline(p, 320, { step: 8, walkGrid });

  const inWall = (tl) => {
    for (let i = 0; i < tl.samples.length; i += 2) {
      const cx = Math.floor(tl.samples[i]);
      const cy = Math.floor(tl.samples[i + 1]);
      if (walkGrid.blocked[cy * walkGrid.width + cx]) return true;
    }
    return false;
  };
  assert.equal(inWall(straight), true);
  assert.equal(inWall(routed), false);
  // both still arrive
  assert.deepEqual(sampleAt(routed, 320), [9, 4]);
});

const unit = (anchors) => ({
  type: "MercLanerMeleeKnight",
  bornLoop: anchors[0].loop,
  diedLoop: anchors[anchors.length - 1].loop,
  anchors,
});

test("a unit's samples are walked around terrain between them", () => {
  const walkGrid = wallMap();
  const m = unit([
    { loop: 0, x: 1, y: 4 },
    { loop: 160, x: 9, y: 4 },
  ]);
  routeUnitsThroughTerrain([m], walkGrid);
  assert.ok(m.anchors.length > 2, "corners were spliced in");
  for (let loop = 0; loop <= 160; loop += 4) {
    const [x, y] = minionPositionAt(m, loop);
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    assert.equal(walkGrid.blocked[cy * walkGrid.width + cx], 0, `inside the wall at loop ${loop}`);
  }
  assert.deepEqual(minionPositionAt(m, 160), [9, 4]);
});

test("a segment already clear of terrain is left alone", () => {
  const m = unit([
    { loop: 0, x: 1, y: 1 },
    { loop: 160, x: 9, y: 1 },
  ]);
  routeUnitsThroughTerrain([m], wallMap());
  assert.equal(m.anchors.length, 2);
});

test("routing a unit twice changes nothing the second time", () => {
  const walkGrid = wallMap();
  const anchors = [
    { loop: 0, x: 1, y: 4 },
    { loop: 160, x: 9, y: 4 },
  ];
  const once = unit(anchors.map((a) => ({ ...a })));
  const twice = unit(anchors.map((a) => ({ ...a })));
  routeUnitsThroughTerrain([once], walkGrid);
  routeUnitsThroughTerrain([twice], walkGrid);
  routeUnitsThroughTerrain([twice], walkGrid);
  assert.deepEqual(twice.anchors, once.anchors);
});

test("a route far longer than the straight line is rejected", () => {
  // The only way round costs many times the straight distance, so the unit was
  // moved rather than walked.
  const walkGrid = grid([
    "..........",
    "#########.",
    "..........",
  ]);
  const m = unit([
    { loop: 0, x: 0.5, y: 0.5 },
    { loop: 160, x: 0.5, y: 2.5 },
  ]);
  routeUnitsThroughTerrain([m], walkGrid);
  assert.equal(m.anchors.length, 2);
});

test("a confirmed reposition lands on the cast's target point at once", () => {
  const p = player({
    moves: [{ loop: 0, x: 1, y: 4 }],
    casts: [{ loop: 64, link: 7, x: 40, y: 40 }],
    anchors: [
      { loop: 0, x: 1, y: 4 },
      { loop: 96, x: 40.5, y: 40.5 }, // recorded position agrees with the blink
    ],
  });
  const tl = buildPositionTimeline(p, 320, { step: 8, movementLinks: new Set([7]) });
  assert.deepEqual(sampleAt(tl, 64), [40, 40]);
});

test("an unconfirmed reposition parks the hero instead of walking them", () => {
  const cast = { loop: 64, link: 7, x: 40, y: 40 };
  const anchors = [
    { loop: 0, x: 1, y: 4 },
    { loop: 200, x: 3, y: 4 }, // hero never went anywhere near the cast point
  ];
  const moves = [{ loop: 8, x: 30, y: 30 }];
  const walked = buildPositionTimeline(player({ moves, anchors, casts: [cast] }), 320, { step: 8 });
  const parked = buildPositionTimeline(player({ moves, anchors, casts: [cast] }), 320, {
    step: 8,
    movementLinks: new Set([7]),
  });

  const [wx, wy] = sampleAt(walked, 190);
  const [px, py] = sampleAt(parked, 190);
  assert.ok(Math.hypot(wx - 1, wy - 4) > 5, "without the cast the estimate keeps walking");
  const [castX, castY] = sampleAt(parked, 64);
  assert.deepEqual([px, py], [castX, castY], "position is held from the cast to the next anchor");
  assert.notDeepEqual([px, py], [40, 40], "and it does not teleport to an unconfirmed point");
});
