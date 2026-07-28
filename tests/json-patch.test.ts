import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function applyPatch(doc, patch) {
  const script = `
    import { applyJsonPatch } from "./scripts/lib/json-patch.ts";
    const doc = ${JSON.stringify(doc)};
    const patch = ${JSON.stringify(patch)};
    try {
      console.log(JSON.stringify({ ok: true, value: applyJsonPatch(doc, patch) }));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, error: String(e.message) }));
    }
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  ));
}

test("replace and add rewrite object members the way heroes-data patches do", () => {
  const { ok, value } = applyPatch(
    { meta: { heroesVersion: "2.55.16.97039" }, items: { Abathur: { speed: 4.8398 }, Lucio: { skinIds: ["a", "b", "c"] } } },
    [
      { op: "replace", path: "/meta/heroesVersion", value: "2.55.17.97605" },
      { op: "replace", path: "/items/Abathur/speed", value: 4.75 },
      { op: "replace", path: "/items/Lucio/skinIds/2", value: "LucioToon20" },
      { op: "add", path: "/items/Lucio/skinIds/3", value: "LucioUltimate" },
      { op: "add", path: "/items/Nova", value: { speed: 4.4 } },
    ]
  );

  assert.equal(ok, true);
  assert.deepEqual(value, {
    meta: { heroesVersion: "2.55.17.97605" },
    items: {
      Abathur: { speed: 4.75 },
      Lucio: { skinIds: ["a", "b", "LucioToon20", "LucioUltimate"] },
      Nova: { speed: 4.4 },
    },
  });
});

test("add with an index inserts into an array rather than overwriting", () => {
  const { value } = applyPatch({ ids: ["a", "c"] }, [{ op: "add", path: "/ids/1", value: "b" }]);
  assert.deepEqual(value.ids, ["a", "b", "c"]);
});

test("add with the - token appends to an array", () => {
  const { value } = applyPatch({ ids: ["a"] }, [{ op: "add", path: "/ids/-", value: "b" }]);
  assert.deepEqual(value.ids, ["a", "b"]);
});

test("remove, move and copy operate on both objects and arrays", () => {
  const { value } = applyPatch(
    { keep: 1, drop: 2, ids: ["a", "b", "c"], from: { nested: true } },
    [
      { op: "remove", path: "/drop" },
      { op: "remove", path: "/ids/1" },
      { op: "move", from: "/from", path: "/moved" },
      { op: "copy", from: "/keep", path: "/copied" },
    ]
  );
  assert.deepEqual(value, { keep: 1, ids: ["a", "c"], moved: { nested: true }, copied: 1 });
});

test("escaped pointer tokens address keys containing / and ~", () => {
  const { value } = applyPatch({ "a/b": { "c~d": 1 } }, [{ op: "replace", path: "/a~1b/c~0d", value: 2 }]);
  assert.deepEqual(value, { "a/b": { "c~d": 2 } });
});

test("a failed test op aborts the patch instead of applying it partially", () => {
  const { ok, error } = applyPatch({ v: 1 }, [{ op: "test", path: "/v", value: 2 }]);
  assert.equal(ok, false);
  assert.match(error, /test failed at \/v/);
});

test("patching a path that does not exist throws rather than silently skipping", () => {
  const { ok, error } = applyPatch({ items: {} }, [{ op: "replace", path: "/items/Missing/speed", value: 1 }]);
  assert.equal(ok, false);
  assert.match(error, /does not exist|not a container/);
});
