import assert from "node:assert/strict";
import test from "node:test";
import { buildVisionGrid, castVisibility, patchAt, HARD, SOFT } from "../site/static/replay/vision.js";

// Builds a mask image the way gen-replay-maps.mjs writes one: row 0 is the top
// of the world, R marks a hard blocker, G marks concealment. `rows` are given
// top-down, using '#' for hard, 'b' for brush and '.' for open.
function mask(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const rgba = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      const i = (y * width + x) * 4;
      rgba[i] = c === "#" ? 255 : 0;
      rgba[i + 1] = c === "b" ? 255 : 0;
      rgba[i + 3] = 255;
    });
  });
  return buildVisionGrid(rgba, width, height);
}

test("the mask's top row becomes the world's highest y", () => {
  const grid = mask([
    "#.",
    "..",
  ]);
  assert.equal(grid.cells[1 * 2 + 0], HARD); // world (0,1), top-left of the image
  assert.equal(grid.cells[0 * 2 + 0], 0); // world (0,0), bottom-left
});

test("touching concealment cells share a patch, diagonals included", () => {
  const grid = mask([
    "b...",
    ".b..",
    "...b",
  ]);
  assert.equal(patchAt(grid, 0.5, 2.5), patchAt(grid, 1.5, 1.5));
  assert.notEqual(patchAt(grid, 0.5, 2.5), patchAt(grid, 3.5, 0.5));
  assert.equal(patchAt(grid, 2.5, 2.5), 0); // open ground is not a patch
});

const farthest = (poly, x, y) => {
  let max = 0;
  for (let i = 0; i < poly.length; i += 2) max = Math.max(max, Math.hypot(poly[i] - x, poly[i + 1] - y));
  return max;
};
// How far vision reaches straight along +x, which is ray 0 of every fan.
const reachEast = (poly, x) => poly[0] - x;

test("open ground gives the full sight radius in every direction", () => {
  const grid = mask(Array(9).fill("........."));
  const poly = castVisibility(grid, 4.5, 4.5, 3);
  assert.ok(farthest(poly, 4.5, 4.5) > 2.99);
});

test("a wall stops the sight line at its near face", () => {
  const grid = mask([
    ".........",
    ".........",
    "....@..#.",
    ".........",
  ].map((r) => r.replace("@", ".")));
  const poly = castVisibility(grid, 4.5, 1.5, 6);
  assert.ok(reachEast(poly, 4.5) < 3, `expected the wall at x=7 to cut the ray short, reached ${reachEast(poly, 4.5)}`);
});

test("brush blocks from outside but not from inside the same patch", () => {
  const rows = [
    ".........",
    ".........",
    "...bb....",
    ".........",
  ];
  const grid = mask(rows);
  // World y=1 is the brush row; the brush occupies x=3..4.
  const outside = castVisibility(grid, 0.5, 1.5, 8);
  assert.ok(reachEast(outside, 0.5) < 3, `brush should stop the ray, reached ${reachEast(outside, 0.5)}`);
  const inside = castVisibility(grid, 3.5, 1.5, 8);
  assert.ok(reachEast(inside, 3.5) > 4, `from inside its own brush the ray should carry on, reached ${reachEast(inside, 3.5)}`);
});

test("a source standing in a blocker still sees out of it", () => {
  const grid = mask([
    ".........",
    "..###....",
    ".........",
  ]);
  const poly = castVisibility(grid, 3.5, 1.5, 5);
  assert.ok(farthest(poly, 3.5, 1.5) > 4, "a wall's own vision should escape the wall");
});

test("cells off the edge of the map block", () => {
  const grid = mask(Array(4).fill("...."));
  const poly = castVisibility(grid, 3.5, 1.5, 6);
  assert.ok(reachEast(poly, 3.5) <= 1, `expected the map edge to stop the ray, reached ${reachEast(poly, 3.5)}`);
});

test("SOFT and HARD stay distinguishable in the grid", () => {
  const grid = mask(["#b."]);
  assert.deepEqual([...grid.cells], [HARD, SOFT, 0]);
});
