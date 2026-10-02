// Max range of charge-up abilities whose galaxy script grows the range while charging.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { GAMEDATA_DIR } from "./paths.ts";

interface ScriptRange {
  file: string;
  variable: string;
  // Narrows the search to one function body, for locals such as lv_maxScale.
  func?: string;
}

const CHO_SURGING_FIST: ScriptRange = {
  file: "heromods/chogall.stormmod/base.stormdata/libhcho.galaxy",
  func: "libHCHO_gt_HeroChoSurgingFistDistanceTracker_Func",
  variable: "lv_maxScale",
};

const SCRIPT_RANGES: Record<string, ScriptRange> = {
  ChoSurgingFistCast: CHO_SURGING_FIST,
  ChoSurgingFistTrigger: CHO_SURGING_FIST,
  HanzoStormBowFireTargetPoint: {
    file: "heromods/hanzo.stormmod/base.stormdata/libhhan_h.galaxy",
    variable: "libHHAN_gv_heroHanzoStormBowDefaultMaximumRange",
  },
};

function functionBody(source: string, func: string) {
  const start = source.indexOf(`${func} (`);
  if (start < 0) return null;
  const end = source.indexOf("\n}", start);
  return source.slice(start, end < 0 ? undefined : end);
}

// Offsets are negative Y in the scripts, so the magnitude is the range.
export function parseScriptRange(source: string, { variable, func }: Omit<ScriptRange, "file">) {
  const scope = func ? functionBody(source, func) : source;
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = scope && new RegExp(`\\b${escaped}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`).exec(scope);
  return match ? Math.abs(Number(match[1])) : null;
}

const sources = new Map<string, string | null>();

function readSource(file: string) {
  if (!sources.has(file)) {
    try {
      sources.set(file, readFileSync(path.join(GAMEDATA_DIR, file), "utf-8"));
    } catch {
      sources.set(file, null);
    }
  }
  return sources.get(file) ?? null;
}

export function scriptRange(abilId: string) {
  const entry = SCRIPT_RANGES[abilId];
  const source = entry ? readSource(entry.file) : null;
  const range = entry && source ? parseScriptRange(source, entry) : null;
  if (entry && range === null) console.warn(`script-ranges: ${entry.variable} not found in ${entry.file} for ${abilId}`);
  return range;
}
