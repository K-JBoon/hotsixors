import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseCsvRows } from "../scripts/lib/csv.ts";

test("quoted fields keep delimiters, newlines and escaped quotes", () => {
  assert.deepEqual(parseCsvRows('a,"b,c","say ""hi""\nthere"\r\nd,e,f\n'), [
    ["a", "b,c", 'say "hi"\nthere'],
    ["d", "e", "f"],
  ]);
});

test("records use the header row and the given delimiter", () => {
  const csv = "﻿id;draft\n0003;\"['Hogger', \"\"Anub'arak\"\"]\"\n\n";
  assert.deepEqual(parseCsv(csv, ";"), [{ id: "0003", draft: `['Hogger', "Anub'arak"]` }]);
});

test("short rows fill missing columns with empty strings", () => {
  assert.deepEqual(parseCsv("a,b,c\n1"), [{ a: "1", b: "", c: "" }]);
});
