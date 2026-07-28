// Classifies replay-visible abilities by caster movement.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { GAMEDATA_DIR, GAMEDATA_REPO, SITE_STATIC } from "./lib/paths.ts";
import { shouldIncludeGamedataPath } from "./gen-gamedata.ts";
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

async function collectGamedataFiles(dir: string, rel: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await collectGamedataFiles(path.join(dir, e.name), childRel, out);
    } else if (e.name.endsWith(".xml") && shouldIncludeGamedataPath(`mods/${childRel}`)) {
      out.push(`mods/${childRel}`);
    }
  }
}

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

async function main(): Promise<void> {
  console.log("gen-replay-movement: starting");
  // Union over every shipped build's catalog.
  const abilLinkDir = path.join(SITE_STATIC, "replay", "abillinks");
  const { builds } = JSON.parse(await readFile(path.join(abilLinkDir, "index.json"), "utf-8")) as { builds: number[] };
  const abilLinkIndex: Record<string, string> = {};
  for (const build of builds) {
    Object.assign(abilLinkIndex, JSON.parse(await readFile(path.join(abilLinkDir, `${build}.json`), "utf-8")));
  }

  const relPaths: string[] = [];
  await collectGamedataFiles(GAMEDATA_DIR, "", relPaths);
  const files = await Promise.all(
    relPaths.map(async (rel) => ({ path: rel, content: await readFile(path.join(GAMEDATA_REPO, rel), "utf-8") })),
  );
  const graph = buildEffectGraph(files);

  const result = classifyMovement(graph, new Set(Object.values(abilLinkIndex)));

  const dest = path.join(SITE_STATIC, "replay", "movement-abilities.json");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(result), "utf-8");
  const teleports = Object.values(result).filter((k) => k === "teleport").length;
  console.log(
    `gen-replay-movement: ${teleports} teleport, ${Object.keys(result).length - teleports} dash abilities -> ${path.relative(process.cwd(), dest)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
