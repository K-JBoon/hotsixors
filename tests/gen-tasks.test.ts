import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import { TASKS } from "../scripts/gen.ts";

const byName = new Map(TASKS.map((task) => [task.name, task]));

test("every task needs a task that exists", () => {
  for (const task of TASKS) {
    for (const need of task.needs ?? []) {
      assert.ok(byName.has(need), `${task.name} needs unknown task ${need}`);
    }
  }
});

test("task names are unique", () => {
  assert.equal(byName.size, TASKS.length);
});

// refresh.ts runs the mods stage while HeroesDataParser is still writing the
// parsed inputs, so a mods task that read a parsed task's output would read it
// too early.
test("no mods-stage task depends on a parsed-stage task", () => {
  for (const task of TASKS.filter((t) => t.stage === "mods")) {
    for (const need of task.needs ?? []) {
      assert.equal(byName.get(need)!.stage, "mods", `${task.name} (mods) needs ${need} (parsed)`);
    }
  }
});

test("the task graph is acyclic", () => {
  const settled = new Set<string>();
  for (let pass = 0; pass < TASKS.length && settled.size < TASKS.length; pass++) {
    for (const task of TASKS) {
      if (!settled.has(task.name) && (task.needs ?? []).every((need) => settled.has(need))) {
        settled.add(task.name);
      }
    }
  }
  assert.equal(settled.size, TASKS.length, `unreachable: ${TASKS.filter((t) => !settled.has(t.name)).map((t) => t.name)}`);
});

test("every gen script the pipeline owns is a task", async () => {
  const dir = path.join(import.meta.dirname, "..", "scripts");
  // Run on demand rather than as part of `npm run gen`.
  const standalone = new Set(["gen-og-card", "gen-replay-map3d"]);
  const scripts = (await readdir(dir))
    .filter((file) => file.startsWith("gen-") && file.endsWith(".ts"))
    .map((file) => path.basename(file, ".ts"))
    .filter((name) => !standalone.has(name));
  assert.deepEqual(scripts.filter((name) => !byName.has(name)), []);
});
