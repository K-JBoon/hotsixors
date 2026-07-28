// Ability names and descriptions for battleground-spawned units.

import type { BattlegroundAbility, Gamestrings } from "../types.ts";
import type { MapGamestringPatch } from "./heroes-data.ts";
import { applyJsonPatch } from "./json-patch.ts";
import { stripMarkup } from "./gamestrings.ts";

type AbilityText = { name: Record<string, string>; fullText: Record<string, string> };

function indexAbilityText(out: Map<string, { name: string; full: string }>, sections: AbilityText[]): void {
  for (const section of sections) {
    for (const k of Object.keys(section.name)) {
      const buttonId = k.split("|")[1];
      if (!buttonId) continue;
      if (out.has(buttonId)) continue;
      out.set(buttonId, {
        name: section.name[k] ?? buttonId,
        full: section.fullText[k] ?? "",
      });
    }
  }
}

const OVERLAY_PATHS = /^\/items\/(ability|talent)\/(name|fullText)\//;

function abilityTextDoc(gs: Gamestrings): { items: { ability: AbilityText; talent: AbilityText } } {
  return structuredClone({
    items: {
      ability: { name: gs.ability.name, fullText: gs.ability.fullText },
      talent: { name: gs.talent.name, fullText: gs.talent.fullText },
    },
  });
}

// Build a lookup table from buttonId -> ability metadata.
export function buildAbilityIndex(gs: Gamestrings, mapPatches: MapGamestringPatch[]): Map<string, { name: string; full: string }> {
  const out = new Map<string, { name: string; full: string }>();
  indexAbilityText(out, [gs.ability, gs.talent]);

  for (const { map, patch } of mapPatches) {
    const doc = abilityTextDoc(gs);
    try {
      applyJsonPatch(doc, patch.filter((op) => OVERLAY_PATHS.test(op.path)));
    } catch (e) {
      console.warn(`gen-battlegrounds: skipping gamestring overlay for ${map}: ${(e as Error).message}`);
      continue;
    }
    indexAbilityText(out, [doc.items.ability, doc.items.talent]);
  }

  return out;
}

const SLOT_ORDER = ["Ability1", "Ability2", "Ability3", "Heroic", "Heroic1", "Heroic2", "Trait", "Mount"];
const SLOT_LABEL: Record<string, string> = {
  Ability1: "Q",
  Ability2: "W",
  Ability3: "E",
  Heroic: "R",
  Heroic1: "R",
  Heroic2: "R",
  Trait: "D",
  Mount: "Z",
};

export function extractAbilities(blocks: string[], abilityIndex: Map<string, { name: string; full: string }>): BattlegroundAbility[] {
  const seen = new Set<string>();
  const collected: { face: string; slot: string }[] = [];
  for (const block of blocks) {
    for (const m of block.matchAll(/<LayoutButtons\b[^>]*?Face="([^"]+)"[^>]*?Slot="([^"]+)"/g)) {
      const face = m[1];
      const slot = m[2];
      if (!SLOT_ORDER.includes(slot)) continue;
      if (seen.has(face)) continue;
      seen.add(face);
      collected.push({ face, slot });
    }
  }
  collected.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const out: BattlegroundAbility[] = [];
  for (const { face, slot } of collected) {
    const entry = abilityIndex.get(face);
    if (!entry) continue;
    out.push({
      id: face,
      name: entry.name,
      fullDesc: stripMarkup(entry.full) || null,
      slot: SLOT_LABEL[slot] ?? null,
    });
  }
  return out;
}
