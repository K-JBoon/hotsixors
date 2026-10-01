// Weapon attack timing and missile speed, read from the raw XML catalogs.

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { SaxesParser } from "saxes";
import { resolveNumber, type Constants } from "./catalog-consts.ts";
import { loadGamedataXmlFiles, type GamedataFile } from "./gamedata-paths.ts";
import { DATA_ROOT } from "./paths.ts";
import type { HeroStatsMissilePhase, HeroStatsWeaponTiming } from "../types.ts";

interface CatalogNode {
  tag: string;
  attrs: Record<string, string>;
  children: CatalogNode[];
}

export interface CatalogIndex {
  entries: Map<string, CatalogNode[]>;
  consts: Constants;
}

type Family = "CWeapon" | "CEffect" | "CMover" | "CUnit";

const FAMILY_RE = /^C(Weapon|Effect|Mover|Unit)/;

// Effect fields that run on launch, before any missile impact.
const LAUNCH_VALUE_FIELDS = new Set(["EffectArray", "CaseDefault", "InitialEffect", "PeriodicEffectArray"]);

const DEFAULT_MOVER = "MissileDefault";

// Class defaults and shared templates, ahead of the hero catalogs that override them.
const BASE_CATALOGS = [
  "mods/core.stormmod/base.stormdata/gamedata/effectdata.xml",
  "mods/core.stormmod/base.stormdata/gamedata/moverdata.xml",
  "mods/core.stormmod/base.stormdata/gamedata/unitdata.xml",
  "mods/core.stormmod/base.stormdata/gamedata/weapondata.xml",
  "mods/heroesdata.stormmod/base.stormdata/gamedata/moverdata.xml",
  "mods/heroesdata.stormmod/base.stormdata/gamedata/unitdata.xml",
  "mods/heroesdata.stormmod/base.stormdata/gamedata/weapondata.xml",
];

function findLast<T>(items: T[], pred: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (pred(items[i])) return items[i];
  return undefined;
}

function familyOf(tag: string): Family | null {
  const m = FAMILY_RE.exec(tag);
  return m ? (`C${m[1]}` as Family) : null;
}

function pushEntry(entries: Map<string, CatalogNode[]>, key: string, node: CatalogNode): void {
  const list = entries.get(key);
  if (list) list.push(node);
  else entries.set(key, [node]);
}

export async function loadWeaponCatalogFiles(): Promise<GamedataFile[]> {
  const base = await Promise.all(
    BASE_CATALOGS.map(async (rel) => ({ path: rel, content: await readFile(path.join(DATA_ROOT, rel), "utf-8") })),
  );
  const rest = (await loadGamedataXmlFiles()).filter((f) => !BASE_CATALOGS.includes(f.path));
  return [...base, ...rest];
}

export function buildCatalogIndex(files: { content: string }[]): CatalogIndex {
  const entries = new Map<string, CatalogNode[]>();
  const consts: Constants = new Map();

  for (const { content } of files) {
    const parser = new SaxesParser({ fragment: true });
    const stack: CatalogNode[] = [];

    parser.on("opentag", (tag) => {
      const attrs = { ...(tag.attributes as Record<string, string>) };
      if (tag.name === "const" && attrs.id && attrs.value !== undefined && !consts.has(attrs.id)) {
        consts.set(attrs.id, attrs.value);
      }
      stack.push({ tag: tag.name, attrs, children: [] });
    });

    parser.on("closetag", () => {
      const node = stack.pop();
      if (!node) return;
      stack.at(-1)?.children.push(node);
      // Top-level entries sit directly under <Catalog>.
      const family = stack.length === 1 ? familyOf(node.tag) : null;
      if (!family) return;
      if (node.attrs.id) pushEntry(entries, `${family}:${node.attrs.id}`, node);
      else if (node.attrs.default === "1") pushEntry(entries, `${node.tag}#default`, node);
    });

    parser.on("error", () => {});
    try {
      parser.write(content).close();
    } catch {}
  }

  return { entries, consts };
}

// Declarations from most to least specific: own (latest first), parents, class defaults.
function* chain(index: CatalogIndex, family: Family, id: string): Iterable<CatalogNode> {
  const seen = new Set<string>();
  let tag: string | undefined;
  for (let at: string | undefined = id; at && !seen.has(at); ) {
    seen.add(at);
    const decls: CatalogNode[] = index.entries.get(`${family}:${at}`) ?? [];
    tag ??= decls[0]?.tag;
    yield* [...decls].reverse();
    at = findLast(decls, (d) => Boolean(d.attrs.parent))?.attrs.parent;
  }
  if (!tag) return;
  yield* index.entries.get(`${tag}#default`) ?? [];
  if (tag !== family) yield* index.entries.get(`${family}#default`) ?? [];
}

function fieldNode(index: CatalogIndex, family: Family, id: string, field: string): CatalogNode | null {
  for (const node of chain(index, family, id)) {
    const hit = findLast(node.children, (c) => c.tag === field);
    if (hit) return hit;
  }
  return null;
}

function numberField(index: CatalogIndex, family: Family, id: string, field: string): number | null {
  return resolveNumber(fieldNode(index, family, id, field)?.attrs.value ?? null, index.consts);
}

function effectTag(index: CatalogIndex, id: string): string | null {
  return index.entries.get(`CEffect:${id}`)?.[0]?.tag ?? null;
}

function launchChildren(index: CatalogIndex, id: string): string[] {
  const out: string[] = [];
  for (const node of chain(index, "CEffect", id)) {
    for (const child of node.children) {
      if (LAUNCH_VALUE_FIELDS.has(child.tag) && child.attrs.value) out.push(child.attrs.value);
      if (child.tag === "CaseArray" && child.attrs.Effect) out.push(child.attrs.Effect);
    }
  }
  return out;
}

// First missile launched by the weapon's effect tree, breadth first.
function findLaunchMissile(index: CatalogIndex, effectId: string): string | null {
  const seen = new Set<string>();
  const queue = [effectId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (effectTag(index, id) === "CEffectLaunchMissile") return id;
    queue.push(...launchChildren(index, id));
  }
  return null;
}

// Effect Movers override the ammo unit's Mover; unknown movers fall back to the engine default.
function launchMover(index: CatalogIndex, launchId: string): string {
  const own = fieldNode(index, "CEffect", launchId, "Movers")?.attrs.Link;
  const ammo = fieldNode(index, "CEffect", launchId, "AmmoUnit")?.attrs.value;
  const fromAmmo = ammo ? fieldNode(index, "CUnit", ammo, "Mover")?.attrs.value?.replaceAll("##id##", ammo) : undefined;
  const id = own ?? fromAmmo;
  return id && index.entries.has(`CMover:${id}`) ? id : DEFAULT_MOVER;
}

// Unindexed phases take their position in declaration order.
function motionPhases(index: CatalogIndex, moverId: string): Record<string, string>[] {
  const phases: Record<string, string>[] = [];
  for (const node of [...chain(index, "CMover", moverId)].reverse()) {
    let pos = 0;
    for (const child of node.children) {
      if (child.tag !== "MotionPhases") continue;
      const at = child.attrs.index !== undefined ? Number(child.attrs.index) : pos;
      pos = at + 1;
      const phase = (phases[at] ??= {});
      for (const field of child.children) {
        if (field.attrs.value !== undefined) phase[field.tag] = field.attrs.value;
      }
    }
  }
  return phases;
}

// Accelerating phases report their cap; others their clamped launch speed.
function phaseSpeed(index: CatalogIndex, phase: Record<string, string>): number | null {
  const num = (field: string) => resolveNumber(phase[field] ?? null, index.consts);
  const [speed, min, max] = [num("Speed"), num("MinSpeed"), num("MaxSpeed")];
  if ((num("Acceleration") ?? 0) > 0 && max !== null) return max;
  if (speed === null) return max;
  return Math.min(Math.max(speed, min ?? speed), max ?? speed);
}

// Outro is BlendAt[,StopAt]; negative values count back from the target, positive from launch.
function outroDistance(index: CatalogIndex, phase: Record<string, string>): number[] | null {
  const values = (phase.Outro ?? "").split(",").map((v) => resolveNumber(v, index.consts));
  if (values.some((v) => v === null || v >= 0)) return null;
  return [...new Set(values.map((v) => -v!))];
}

// Phases without a speed, or with the previous phase's speed, are dropped.
function missilePhases(index: CatalogIndex, launchId: string): HeroStatsMissilePhase[] {
  const out: HeroStatsMissilePhase[] = [];
  let fromDistance: number[] | null = null;
  for (const phase of motionPhases(index, launchMover(index, launchId))) {
    if (!phase) continue;
    const speed = phaseSpeed(index, phase);
    if (speed !== null && speed !== out.at(-1)?.speed) out.push({ speed, fromDistance });
    fromDistance = outroDistance(index, phase);
  }
  return out;
}

export function readWeaponTiming(index: CatalogIndex, weaponId: string): HeroStatsWeaponTiming | null {
  if (!index.entries.has(`CWeapon:${weaponId}`)) return null;
  const effectId = fieldNode(index, "CWeapon", weaponId, "Effect")?.attrs.value;
  const launchId = effectId ? findLaunchMissile(index, effectId) : null;
  const num = (field: string) => numberField(index, "CWeapon", weaponId, field);
  return {
    damagePoint: num("DamagePoint"),
    backswing: num("Backswing"),
    missilePhases: launchId ? missilePhases(index, launchId) : null,
  };
}
