// Classifies replay-visible abilities by caster movement.

import * as path from "node:path";
import { SITE_STATIC } from "./lib/paths.ts";
import { loadGamedataXmlFiles } from "./lib/gamedata-paths.ts";
import { displayPath, readJson, writeJson } from "./lib/fs.ts";
import { runScript } from "./lib/script.ts";
import { buildEffectGraph } from "./lib/effect-graph.ts";
import type { EffectGraph } from "./lib/effect-graph.ts";

export type MovementKind = "caster-teleport" | "teleport" | "dash";

// Effect classes that reposition the resolved unit.
const TELEPORT_TAGS = new Set(["CEffectTeleport"]);
const DASH_TAGS = new Set(["CEffectApplyForce"]);

// <WhichUnit Value="Caster"/> means the caster moves.
const CASTER_UNIT_VALUES = new Set(["Caster", "Source"]);

// Refs that leave the caster's own effect chain.
const FOREIGN_REF_FIELDS = new Set(["SpawnEffect", "Abil", "AbilArray", "Tech", "Entry"]);

// Every id reachable from `id` through forward refs and parent links.
function* reachable(graph: EffectGraph, id: string): Iterable<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    yield cur;
    for (let at: string | null = cur, guard = 0; at && guard < 32; guard++) {
      const node = graph.nodes.get(at);
      if (!node) break;
      for (const [field, values] of Object.entries(node.refs)) {
        if (FOREIGN_REF_FIELDS.has(field)) continue;
        for (const v of values) if (!seen.has(v)) stack.push(v);
      }
      at = node.parentAttr && graph.nodes.has(node.parentAttr) ? node.parentAttr : null;
    }
  }
}

// Does this teleport effect name the caster as the moved unit?
function movesCaster(graph: EffectGraph, effectId: string): boolean {
  for (let at: string | null = effectId, guard = 0; at && guard < 32; guard++) {
    const node = graph.nodes.get(at);
    if (!node) return false;
    for (const el of node.elements) {
      if (el.tag === "WhichUnit" && el.attrs.Value) return CASTER_UNIT_VALUES.has(el.attrs.Value);
    }
    at = node.parentAttr && graph.nodes.has(node.parentAttr) ? node.parentAttr : null;
  }
  return false;
}

const RANK: Record<MovementKind, number> = { dash: 0, teleport: 1, "caster-teleport": 2 };

export function classifyMovement(graph: EffectGraph, abilityIds: Iterable<string>): Record<string, MovementKind> {
  const out: Record<string, MovementKind> = {};
  for (const id of abilityIds) {
    if (!graph.nodes.has(id)) continue;
    let kind: MovementKind | null = null;
    for (const reached of reachable(graph, id)) {
      const tag = graph.nodes.get(reached)?.tag;
      if (!tag) continue;
      let found: MovementKind | null = null;
      if (TELEPORT_TAGS.has(tag)) found = movesCaster(graph, reached) ? "caster-teleport" : "teleport";
      else if (DASH_TAGS.has(tag)) found = "dash";
      if (found && (!kind || RANK[found] > RANK[kind])) kind = found;
      if (kind === "caster-teleport") break; // nothing outranks it
    }
    if (kind) out[id] = kind;
  }
  return out;
}

// Union over every shipped build's catalog.
async function loadAbilLinkIndex(): Promise<Record<string, string>> {
  const dir = path.join(SITE_STATIC, "replay", "abillinks");
  const { builds } = await readJson<{ builds: number[] }>(path.join(dir, "index.json"));
  const out: Record<string, string> = {};
  for (const build of builds) {
    Object.assign(out, await readJson<Record<string, string>>(path.join(dir, `${build}.json`)));
  }
  return out;
}

async function main(): Promise<void> {
  const abilLinkIndex = await loadAbilLinkIndex();
  const graph = buildEffectGraph(await loadGamedataXmlFiles());
  const result = classifyMovement(graph, new Set(Object.values(abilLinkIndex)));

  const dest = path.join(SITE_STATIC, "replay", "movement-abilities.json");
  await writeJson(dest, result);
  const teleports = Object.values(result).filter((k) => k === "teleport").length;
  console.log(
    `gen-replay-movement: ${teleports} teleport, ${Object.keys(result).length - teleports} dash abilities -> ${displayPath(dest)}`,
  );
}

runScript(import.meta.url, main);
