// Runs the generators, as many at once as the dependencies allow.
//
// `needs` names the tasks whose output a generator reads. `stage` names which
// half of the extraction its `.gamedata/` inputs come from: `casc-extract`
// writes `mods/` ("mods"), and the parser run that follows writes `data/`,
// `gamestrings/` and `images/` ("parsed"). The two stages partition the tasks,
// and no "mods" task needs a "parsed" one, so the "mods" half can run while
// the parser is still working. See scripts/refresh.ts.

import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import * as path from "node:path";
import { isMain } from "./lib/script.ts";

export type Stage = "mods" | "parsed";

export interface Task {
  name: string;
  stage: Stage;
  needs?: string[];
}

export const TASKS: Task[] = [
  { name: "gen-fonts", stage: "mods" },
  { name: "gen-gamedata", stage: "mods" },
  { name: "gen-mechanics", stage: "mods", needs: ["gen-gamedata"] },
  { name: "gen-minions", stage: "mods" },
  { name: "gen-structures", stage: "mods" },
  { name: "gen-experience", stage: "mods" },
  { name: "gen-build-info", stage: "mods" },
  { name: "gen-replay-footprints", stage: "mods" },
  { name: "gen-replay-maps", stage: "mods" },
  { name: "gen-replay-protocols", stage: "mods" },
  { name: "gen-replay-abillinks", stage: "mods" },
  { name: "gen-replay-movement", stage: "mods", needs: ["gen-replay-abillinks"] },

  { name: "gen-heroes", stage: "parsed", needs: ["gen-gamedata"] },
  { name: "gen-battlegrounds", stage: "parsed" },
  { name: "gen-replay-summons", stage: "parsed" },
  { name: "gen-replay-hero-units", stage: "parsed" },
  { name: "gen-replay-minimap-icons", stage: "parsed" },
  // Writes into the gamedata-xref directory gen-gamedata clears.
  { name: "gen-gamedata-entries", stage: "parsed", needs: ["gen-gamedata", "gen-heroes"] },
  { name: "gen-cross-references", stage: "parsed", needs: ["gen-heroes", "gen-mechanics"] },
  { name: "gen-draft-data", stage: "parsed", needs: ["gen-heroes", "gen-battlegrounds"] },
  { name: "gen-search", stage: "parsed", needs: ["gen-gamedata", "gen-mechanics", "gen-heroes", "gen-cross-references"] },
];

const SCRIPTS_DIR = path.dirname(new URL(import.meta.url).pathname);
// Spawning the binary directly skips npx's resolution, which costs more than
// some of the generators take.
const TSX = path.join(SCRIPTS_DIR, "..", "node_modules", ".bin", "tsx");

interface Result {
  task: Task;
  code: number;
  output: string;
  seconds: number;
}

function run(task: Task): Promise<Result> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(TSX, [path.join(SCRIPTS_DIR, `${task.name}.ts`)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const finish = (code: number) =>
      resolve({ task, code, output, seconds: (Date.now() - started) / 1000 });
    child.on("error", (error) => {
      output += `${error}\n`;
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

function report(result: Result): void {
  process.stdout.write(result.output);
  console.log(`  [${result.seconds.toFixed(1)}s] ${result.task.name}`);
}

/** `stages` limits the run to part of the graph; anything else counts as done. */
export async function runTasks(stages: Stage[], limit = availableParallelism()): Promise<boolean> {
  const wanted = TASKS.filter((task) => stages.includes(task.stage));
  const pending = new Set(wanted.map((task) => task.name));
  const done = new Set(TASKS.filter((task) => !stages.includes(task.stage)).map((task) => task.name));
  const running = new Map<string, Promise<Result>>();
  const started = new Date();
  let failed = false;

  const ready = () =>
    wanted.filter((task) =>
      pending.has(task.name) && !running.has(task.name) && (task.needs ?? []).every((need) => done.has(need)));

  while (pending.size > 0) {
    for (const task of ready()) {
      if (running.size >= limit) break;
      running.set(task.name, run(task));
    }
    if (running.size === 0) {
      console.error(`gen: cannot start ${[...pending].join(", ")}; check the task graph`);
      return false;
    }

    const result = await Promise.race(running.values());
    running.delete(result.task.name);
    pending.delete(result.task.name);
    report(result);
    if (result.code === 0) {
      done.add(result.task.name);
    } else {
      console.error(`gen: ${result.task.name} exited with ${result.code}`);
      failed = true;
      break;
    }
  }

  // A failure leaves the rest running; their output still belongs in the log.
  for (const result of await Promise.all(running.values())) report(result);

  const seconds = ((Date.now() - started.getTime()) / 1000).toFixed(1);
  console.log(failed ? `gen: failed after ${seconds}s` : `gen: ${wanted.length} generators in ${seconds}s`);
  return !failed;
}

async function main(): Promise<void> {
  const stageArg = process.argv.find((a) => a.startsWith("--stage="))?.split("=")[1];
  const stages: Stage[] = stageArg === "mods" || stageArg === "parsed" ? [stageArg] : ["mods", "parsed"];
  const limit = process.argv.includes("--serial") ? 1 : availableParallelism();
  if (!(await runTasks(stages, limit))) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
