import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

function run(body) {
  const script = `
    import { parsePythonLiteral, readAssignment } from "./scripts/lib/python-literal.ts";
    try {
      console.log(JSON.stringify({ ok: true, value: (() => { ${body} })() }));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, error: String(e.message) }));
    }
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf-8",
    })
  );
}

const parse = (src) => run(`return parsePythonLiteral(${JSON.stringify(src)});`);

test("parses the literal forms protocol tables use", () => {
  assert.deepEqual(parse("('_int',[(0,7)])").value, ["_int", [[0, 7]]]);
  assert.deepEqual(parse("{5: (80, 'NNet.Game.SUserFinishedLoadingSyncEvent')}").value, {
    5: [80, "NNet.Game.SUserFinishedLoadingSyncEvent"],
  });
  assert.deepEqual(parse("[None, True, False, -3, 0x10]").value, [null, true, false, -3, 16]);
  assert.deepEqual(parse("[1, 2,]").value, [1, 2]);
});

test("ignores comments and trailing commas in table bodies", () => {
  const source = "typeinfos = [\n  ('_int',[(0,7)]),  #0\n  ('_bool',[]),  #1\n]\n";
  const { value } = run(`return readAssignment(${JSON.stringify(source)}, "typeinfos");`);
  assert.deepEqual(value, [
    ["_int", [[0, 7]]],
    ["_bool", []],
  ]);
});

test("rejects unsupported syntax instead of guessing", () => {
  assert.equal(parse("[1, foo(2)]").ok, false);
  assert.equal(parse("('unterminated'").ok, false);
});

test("missing assignments read as undefined", () => {
  assert.equal(run(`return readAssignment("a = 1\\n", "b") ?? "undefined";`).value, "undefined");
});

test("generated protocol tables match the default tables the parser ships with", async () => {
  const index = JSON.parse(readFileSync(new URL("../site/static/replay/protocols/index.json", import.meta.url)));
  const latest = JSON.parse(
    readFileSync(new URL(`../site/static/replay/protocols/${index.builds[String(index.latest)]}.json`, import.meta.url))
  );
  const defaults = (await import("../site/static/replay/typeinfos.js")).default;
  for (const key of Object.keys(latest).filter((k) => k !== "protocol_builds")) {
    assert.deepEqual(defaults[key], latest[key], `${key} differs from the default tables`);
  }
});
