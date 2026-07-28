// Reading values out of the game data XML catalogs. The catalogs are plain
// key-value XML with a parent chain, so a handful of regexes covers what the
// gen scripts need without paying for a full parse of every mod.

import { readFile } from "node:fs/promises";
import type { ScalingSummaryRow } from "../types.ts";

/** Files are read once per run and shared between the gen scripts. */
const fileCache = new Map<string, Promise<string>>();


export function readCached(filePath: string) {
  let promise = fileCache.get(filePath);
  if (!promise) {
    promise = readFile(filePath, "utf-8");
    fileCache.set(filePath, promise);
  }
  return promise;
}

export function esc(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function attr(tag: string, name: string) {
  return new RegExp(`\\b${esc(name)}="([^"]*)"`, "i").exec(tag)?.[1] ?? null;
}

export function numberTag(block: string, tag: string) {
  const match = new RegExp(`<${esc(tag)}\\b[^>]+value="([\\d.]+)"`, "i").exec(block);
  return match ? Number.parseFloat(match[1]) : null;
}

export function block(xml: string, tagPrefix: string, id: string) {
  const re = new RegExp(`<(${esc(tagPrefix)}\\w*)\\b[^>]+id="${esc(id)}"[^>]*>[\\s\\S]*?</\\1>`, "i");
  return re.exec(xml)?.[0] ?? null;
}

export function links(src: string, tag: string, name: string) {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]+${name}="([^"]+)"`, "gi");
  for (const match of src.matchAll(re)) out.push(match[1]);
  return out;
}

export function summarizeMinuteBands(values: string[]) {
  if (!values.length) return null;
  if (values.every((value) => value === values[0])) return `+${values[0]}/min`;
  const parts: string[] = [];
  let start = 1;
  for (let i = 1; i <= values.length; i += 1) {
    if (values[i] === values[start - 1]) continue;
    const end = i;
    const range = start === end ? `${start}` : end === values.length ? `${start}+` : `${start}-${end}`;
    parts.push(`+${values[start - 1]}/min ${range}`);
    start = i + 1;
  }
  return parts.join(", ");
}

export function veterancyLevelBlocks(behaviorBlock: string) {
  return [...behaviorBlock.matchAll(/<VeterancyLevelArray\b[^>]*(?:\/>|>[\s\S]*?<\/VeterancyLevelArray>)/gi)].map((match) => match[0]);
}

// Which per-minute veterancy stats a caller wants summarized, and under what
// display label. Order decides the order of the summary rows.
export type ScalingField = { label: string; tag: string; index: string };

export const MINION_SCALING_FIELDS: ScalingField[] = [
  { label: "Life", tag: "VitalMaxArray", index: "Life" },
  { label: "Basic damage", tag: "DamageDealtScaled", index: "Basic" },
];

export const STRUCTURE_SCALING_FIELDS: ScalingField[] = [
  { label: "Life", tag: "VitalMaxArray", index: "Life" },
  { label: "Shields", tag: "VitalMaxArray", index: "Shields" },
  { label: "Basic damage", tag: "DamageDealtScaled", index: "Basic" },
];

function scalingPattern(field: ScalingField, flags: string) {
  return new RegExp(`<${field.tag}\\b[^>]+index="${field.index}"[^>]+value="([\\d.]+)"`, flags);
}

function collectScalingValues(behaviorXml: string, ids: string[], fields: ScalingField[]) {
  const valuesByLabel = new Map<string, string[]>();
  for (const id of ids) {
    const behaviorBlock = block(behaviorXml, "CBehavior", id);
    if (!behaviorBlock) continue;
    for (const level of veterancyLevelBlocks(behaviorBlock)) {
      for (const field of fields) {
        const value = scalingPattern(field, "i").exec(level)?.[1];
        if (value) valuesByLabel.set(field.label, [...(valuesByLabel.get(field.label) ?? []), value]);
      }
    }
  }
  return valuesByLabel;
}

export function summarizeScalingRows(behaviorXml: string, ids: string[], fields: ScalingField[]): ScalingSummaryRow[] {
  return [...collectScalingValues(behaviorXml, ids, fields).entries()]
    .map(([label, values]) => ({ label, summary: summarizeMinuteBands(values) }))
    .filter((row): row is ScalingSummaryRow => row.summary !== null);
}

// Behaviors that carry no veterancy levels still name their per-minute values
// directly on the behavior, so fall back to scanning the whole block.
export function summarizeScaling(behaviorXml: string, ids: string[], fields: ScalingField[]) {
  const valuesByLabel = collectScalingValues(behaviorXml, ids, fields);
  const distinct = new Map(fields.map((field) => [field.label, new Set(valuesByLabel.get(field.label) ?? [])]));
  if (valuesByLabel.size === 0) {
    for (const id of ids) {
      const behaviorBlock = block(behaviorXml, "CBehavior", id);
      if (!behaviorBlock) continue;
      for (const field of fields) {
        for (const match of behaviorBlock.matchAll(scalingPattern(field, "gi"))) distinct.get(field.label)!.add(match[1]);
      }
    }
  }
  const parts = fields
    .filter((field) => distinct.get(field.label)!.size > 0)
    .map((field) => `${field.label} +${[...distinct.get(field.label)!].join("/")} per minute`);
  return parts.length ? parts.join("; ") : null;
}

export function summarizeArmor(unitBlock: string, armorXml: string) {
  const armorId = attr(unitBlock.match(/<ArmorLink\b[^>]+/i)?.[0] ?? "", "value");
  if (!armorId) return null;
  const armorBlock = block(armorXml, "CArmor", armorId);
  if (!armorBlock) return armorId;
  const sets: string[] = [];
  for (const set of armorBlock.matchAll(/<ArmorSet\b[^>]+index="([^"]+)"[^>]*>([\s\S]*?)<\/ArmorSet>/gi)) {
    const values = [...set[2].matchAll(/<ArmorMitigationTable\b[^>]+index="([^"]+)"[^>]+value="([\d.]+)"/gi)]
      .map((match) => `${match[1]} ${match[2]}`);
    if (values.length) sets.push(`${set[1]}: ${values.join(", ")}`);
  }
  return sets.length ? sets.join("; ") : armorId;
}
