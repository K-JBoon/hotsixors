// Extracts a build and generates from it, overlapping the two where the data
// allows: `casc-extract` writes `mods/` first, and the generators that read
// only `mods/` run while HeroesDataParser is still writing `data/`,
// `gamestrings/` and `images/`. The rest run once the parser is done.
//
// `npm run extract && npm run gen` does the same work without the overlap.

import { extract } from "./extract-gamedata.ts";
import { runTasks } from "./gen.ts";
import { runScript } from "./lib/script.ts";

async function main(): Promise<void> {
  let modsStage: Promise<boolean> | null = null;

  await extract({
    onModsReady: () => {
      console.log("refresh: mods extracted, starting the generators that only read them");
      modsStage = runTasks(["mods"]);
    },
  });

  // The parser has finished; the mods-stage generators may not have.
  if (modsStage && !(await modsStage)) {
    throw new Error("refresh: a mods-stage generator failed");
  }
  if (!(await runTasks(["parsed"]))) {
    throw new Error("refresh: a parsed-stage generator failed");
  }
}

runScript(import.meta.url, main);
