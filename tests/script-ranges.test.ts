import assert from "node:assert/strict";
import test from "node:test";
import { parseScriptRange } from "../scripts/lib/script-ranges.ts";

const SOURCE = `
const fixed libX_gv_bowMaximumRange = 13.0;
bool libX_gt_Other_Func (bool testConds, bool runActions) {
    lv_maxScale = -2.0;
}
bool libX_gt_FistTracker_Func (bool testConds, bool runActions) {
    lv_base = -4.0;
    lv_maxScale = -10.0;
}
`;

test("script range reads a global constant", () => {
  assert.equal(parseScriptRange(SOURCE, { variable: "libX_gv_bowMaximumRange" }), 13);
});

test("script range reads a local inside the named function, as a magnitude", () => {
  assert.equal(parseScriptRange(SOURCE, { variable: "lv_maxScale", func: "libX_gt_FistTracker_Func" }), 10);
});

test("script range is null when the variable is missing", () => {
  assert.equal(parseScriptRange(SOURCE, { variable: "lv_missing", func: "libX_gt_FistTracker_Func" }), null);
});
