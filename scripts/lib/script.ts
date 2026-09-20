// Entry point for the gen scripts. Tests import the same modules for their
// pure functions, so `main` only runs when the module is the process entry.

import * as path from "node:path";
import { fileURLToPath } from "node:url";

export function isMain(moduleUrl: string): boolean {
  return path.resolve(process.argv[1] ?? "") === fileURLToPath(moduleUrl);
}

function scriptName(moduleUrl: string): string {
  return path.basename(fileURLToPath(moduleUrl), ".ts");
}

/** Logs the start, runs `main`, and reports failure through the exit code. */
export function runScript(moduleUrl: string, main: () => Promise<void>): void {
  if (!isMain(moduleUrl)) return;
  console.log(`${scriptName(moduleUrl)}: starting`);
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
