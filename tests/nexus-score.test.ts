import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_POINTS,
  aimAngle,
  rankShots,
  scoreShot,
  shotDistance,
} from "../site/static/lost-in-the-nexus/nexus-game-score.js";

const target = { p: [0, 10, 0], t: [0, 10, -10], fov: 50 };

test("an identical shot scores full marks", () => {
  const result = scoreShot({ ...target }, target, 500);
  assert.equal(result.points, MAX_POINTS);
  assert.equal(result.distance, 0);
  assert.equal(result.angle, 0);
});

test("distance and angle are measured off the camera pose", () => {
  const shot = { p: [3, 14, 4], t: [3, 14, 14], fov: 50 };
  assert.equal(shotDistance(shot, target), Math.hypot(3, 4, 4));
  assert.ok(Math.abs(aimAngle(shot, target) - Math.PI) < 1e-9);
});

test("a closer camera outscores a further one", () => {
  const near = scoreShot({ p: [10, 10, 0], t: [10, 10, -10] }, target, 500);
  const far = scoreShot({ p: [200, 10, 0], t: [200, 10, -10] }, target, 500);
  assert.ok(near.points > far.points);
});

test("position outweighs aim", () => {
  const rightSpotWrongWay = scoreShot({ p: [0, 10, 0], t: [0, 10, 10] }, target, 500);
  const wrongSpotRightWay = scoreShot({ p: [500, 10, 0], t: [500, 10, -10] }, target, 500);
  assert.ok(rightSpotWrongWay.points > wrongSpotRightWay.points);
});

test("the same miss scores worse on a smaller map", () => {
  const shot = { p: [100, 10, 0], t: [100, 10, -10] };
  assert.ok(scoreShot(shot, target, 200).points < scoreShot(shot, target, 1000).points);
});

test("ranking is best first and breaks ties on distance then name", () => {
  const ranked = rankShots([
    { peerId: "c", name: "Cara", shot: { p: [400, 10, 0], t: [400, 10, -10] } },
    { peerId: "a", name: "Ana", shot: { p: [5, 10, 0], t: [5, 10, -10] } },
    { peerId: "b", name: "Bo", shot: { p: [40, 10, 0], t: [40, 10, -10] } },
  ], target, 500);
  assert.deepEqual(ranked.map((e) => e.name), ["Ana", "Bo", "Cara"]);
  assert.deepEqual(ranked.map((e) => e.rank), [1, 2, 3]);
  assert.ok(ranked[0].points > ranked[1].points);
});
