// Walking the CUnit / CWeapon / CEffect catalogs for the units a battleground
// spawns. Definitions inherit through a parent chain and a mod can override a
// stub in an earlier catalog, so a lookup collects every block for an id and
// takes the first hit, child first.

import type { BattlegroundWeapon, ScalingSummaryRow } from "../types.ts";
import { esc, summarizeMinuteBands, veterancyLevelBlocks } from "./catalog-xml.ts";

export function extractUnit(xml: string, unitId: string): string | null {
  const re = new RegExp(`<CUnit\\b[^>]+id="${esc(unitId)}"[^>]*?(?:/>|>[\\s\\S]*?</CUnit>)`, "i");
  const m = xml.match(re);
  return m ? m[0] : null;
}

function extractParent(unitBlock: string): string | null {
  const m = unitBlock.match(/<CUnit\b[^>]*?\bparent="([^"]+)"/);
  return m ? m[1] : null;
}

// Walk the CUnit parent chain across the given XML sources, returning
// blocks ordered child -> ancestor. Multiple definitions of the same id
// across catalogs (e.g. a sparse stub overridden by a rich data mod) are
// all included so per-stat lookups can find values in any of them.
export function unitChain(unitId: string, xmls: string[]): string[] {
  const chain: string[] = [];
  let id: string | null = unitId;
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const blocks: string[] = [];
    for (const xml of xmls) {
      const b = extractUnit(xml, id);
      if (b) blocks.push(b);
    }
    if (!blocks.length) break;
    chain.push(...blocks);
    let parent: string | null = null;
    for (const b of blocks) {
      parent = extractParent(b);
      if (parent) break;
    }
    id = parent;
  }
  return chain;
}

export function firstNumberAttr(blocks: string[], tag: string): number | null {
  for (const b of blocks) {
    const m = b.match(new RegExp(`<${tag}\\b[^>]+value="([\\d.]+)"`));
    if (m) return parseFloat(m[1]);
  }
  return null;
}

export function firstAttrValue(blocks: string[], tag: string): string | null {
  for (const b of blocks) {
    const m = b.match(new RegExp(`<${tag}\\b[^>]+value="([^"]+)"`));
    if (m) return m[1];
  }
  return null;
}

export function collectLinks(blocks: string[], tag: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    for (const m of b.matchAll(new RegExp(`<${tag}\\b[^>]+Link="([^"]+)"`, "g"))) {
      if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
    }
  }
  return out;
}

// Walk the CWeapon* parent chain across the given XML sources. Multiple
// definitions of the same id (e.g. an override + a base) are all included.
function weaponChain(weaponXmls: string[], weaponId: string): string[] {
  const chain: string[] = [];
  let id: string | null = weaponId;
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const blocks: string[] = [];
    for (const xml of weaponXmls) {
      const re = new RegExp(`<(CWeapon\\w*)\\b[^>]+id="${esc(id)}"[^>]*?(?:/>|>[\\s\\S]*?</\\1>)`, "i");
      const m = xml.match(re);
      if (m) blocks.push(m[0]);
    }
    if (!blocks.length) break;
    chain.push(...blocks);
    let parent: string | null = null;
    for (const b of blocks) {
      const pm = b.match(/<CWeapon\w*\b[^>]*?\bparent="([^"]+)"/);
      if (pm) { parent = pm[1]; break; }
    }
    id = parent;
  }
  return chain;
}

export function extractWeapon(weaponXmls: string[], effectXmls: string[], weaponId: string): BattlegroundWeapon {
  const blocks = weaponChain(weaponXmls, weaponId);
  const periodM = blocks.map(b => b.match(/<Period\b[^>]+value="([\d.]+)"/)).find(Boolean);
  const rangeM = blocks.map(b => b.match(/<Range\b[^>]+value="([\d.]+)"/)).find(Boolean);
  let damage: number | null = null;
  for (const b of blocks) {
    const effectId = (b.match(/<DisplayEffect\b[^>]+value="([^"]+)"/)?.[1])
      ?? (b.match(/<Effect\b[^>]+value="([^"]+)"/)?.[1])
      ?? null;
    if (effectId) {
      damage = lookupEffectAmount(effectXmls, effectId);
      if (damage !== null) break;
    }
  }
  return {
    id: weaponId,
    damage,
    period: periodM ? parseFloat(periodM[1]) : null,
    range: rangeM ? parseFloat(rangeM[1]) : null,
  };
}

// Resolve an effect's basic damage Amount. Walks CEffectDamage directly,
// follows CEffectSet sub-effects shallowly, and also walks the parent chain
// (e.g. AllianceSuperCavalryWeaponDamage parent="AlteracSuperCavalryWeaponDamage")
// since the Amount often lives only on the parent.
function lookupEffectAmount(effectXmls: string[], effectId: string, depth = 0, visited = new Set<string>()): number | null {
  if (depth > 6 || visited.has(effectId)) return null;
  visited.add(effectId);
  for (const xml of effectXmls) {
    const re = new RegExp(`<(CEffect\\w*)\\b[^>]+id="${esc(effectId)}"[^>]*?(?:/>|>[\\s\\S]*?</\\1>)`, "i");
    const m = xml.match(re);
    if (!m) continue;
    const block = m[0];
    const tag = m[1];
    if (tag === "CEffectDamage") {
      const am = block.match(/<Amount[^>]+value="([\d.]+)"/);
      if (am) return parseFloat(am[1]);
    }
    const refs = [
      ...block.matchAll(/<EffectArray\b[^>]+value="([^"]+)"/g),
      ...block.matchAll(/<CaseArray\b[^>]+Effect="([^"]+)"/g),
      ...block.matchAll(/<CaseDefault[^>]+value="([^"]+)"/g),
    ].map(x => x[1]);
    for (const r of refs) {
      const val = lookupEffectAmount(effectXmls, r, depth + 1, visited);
      if (val !== null) return val;
    }
    const parentM = block.match(/<CEffect\w*\b[^>]*?\bparent="([^"]+)"/);
    if (parentM) {
      const val = lookupEffectAmount(effectXmls, parentM[1], depth + 1, visited);
      if (val !== null) return val;
    }
  }
  return null;
}

// Parse <const id="$X" value="..."/> definitions out of all behavior XMLs.
// Galaxy Editor constants can reference each other and use prefix-notation
// expressions like `*($VehicleBasicAttackScaling1to5 1.5)`.
export function buildConstMap(behaviorXmls: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const xml of behaviorXmls) {
    for (const m of xml.matchAll(/<const\s+id="(\$\w+)"[^>]+value="([^"]+)"/g)) {
      if (!out.has(m[1])) out.set(m[1], m[2]);
    }
  }
  return out;
}

function splitExprArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(") { depth++; cur += c; }
    else if (c === ")") { depth--; cur += c; }
    else if (/\s/.test(c) && depth === 0) { if (cur) { out.push(cur); cur = ""; } }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function resolveConst(raw: string, consts: Map<string, string>, depth = 0): number | null {
  if (depth > 20) return null;
  const v = raw.trim();
  if (/^[-+]?[\d.]+$/.test(v)) return parseFloat(v);
  if (v.startsWith("$")) {
    const def = consts.get(v);
    if (!def) return null;
    return resolveConst(def, consts, depth + 1);
  }
  const m = v.match(/^([+\-*/])\((.+)\)$/);
  if (m) {
    const op = m[1];
    const nums = splitExprArgs(m[2]).map(a => resolveConst(a, consts, depth + 1));
    if (nums.some(n => n === null)) return null;
    let result = nums[0] as number;
    for (let i = 1; i < nums.length; i += 1) {
      const n = nums[i] as number;
      if (op === "+") result += n;
      else if (op === "-") result -= n;
      else if (op === "*") result *= n;
      else if (op === "/") result /= n;
    }
    return result;
  }
  return null;
}

function parseScalingValue(raw: string, consts: Map<string, string>): string | null {
  if (/^[-+]?[\d.]+$/.test(raw)) return raw;
  const resolved = resolveConst(raw, consts);
  if (resolved === null) return null;
  // Trim trailing zeros; keep at most 4 fractional digits.
  return Number.isInteger(resolved) ? String(resolved) : String(parseFloat(resolved.toFixed(4)));
}

export function extractScalingRows(behaviorXmls: string[], scalingIds: string[], consts: Map<string, string>): ScalingSummaryRow[] {
  const valuesByLabel = new Map<string, string[]>();
  for (const id of scalingIds) {
    let block: string | null = null;
    for (const xml of behaviorXmls) {
      const re = new RegExp(`<(CBehavior\\w*)\\b[^>]+id="${esc(id)}"[^>]*?(?:/>|>[\\s\\S]*?</\\1>)`, "i");
      const m = xml.match(re);
      if (m) { block = m[0]; break; }
    }
    if (!block) continue;
    for (const level of veterancyLevelBlocks(block)) {
      const lifeRaw = /<VitalMaxArray\b[^>]+index="Life"[^>]+value="([^"]+)"/i.exec(level)?.[1];
      const damageRaw = /<DamageDealtScaled\b[^>]+index="Basic"[^>]+value="([^"]+)"/i.exec(level)?.[1];
      const life = lifeRaw ? parseScalingValue(lifeRaw, consts) : null;
      const damage = damageRaw ? parseScalingValue(damageRaw, consts) : null;
      if (life) valuesByLabel.set("Life", [...(valuesByLabel.get("Life") ?? []), life]);
      if (damage) valuesByLabel.set("Basic damage", [...(valuesByLabel.get("Basic damage") ?? []), damage]);
    }
  }
  return [...valuesByLabel.entries()]
    .map(([label, values]) => ({ label, summary: summarizeMinuteBands(values) }))
    .filter((row): row is ScalingSummaryRow => row.summary !== null);
}


export function extractArmor(unitBlocks: string[], armorXmls: string[]): string | null {
  const armorId = firstAttrValue(unitBlocks, "ArmorLink");
  if (!armorId) return null;
  let block: string | null = null;
  for (const xml of armorXmls) {
    const re = new RegExp(`<CArmor\\b[^>]+id="${esc(armorId)}"[^>]*?(?:/>|>[\\s\\S]*?</CArmor>)`, "i");
    const m = xml.match(re);
    if (m) { block = m[0]; break; }
  }
  if (!block) return armorId;
  const sets: string[] = [];
  for (const set of block.matchAll(/<ArmorSet\b[^>]+index="([^"]+)"[^>]*>([\s\S]*?)<\/ArmorSet>/gi)) {
    const values = [...set[2].matchAll(/<ArmorMitigationTable\b[^>]+index="([^"]+)"[^>]+value="([\d.]+)"/gi)]
      .map((m) => `${m[1]} ${m[2]}`);
    if (values.length) sets.push(`${set[1]}: ${values.join(", ")}`);
  }
  return sets.length ? sets.join("; ") : armorId;
}

