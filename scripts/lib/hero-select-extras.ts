// HeroAbilArray entries the hero select screen shows but HDP drops: button-only,
// ShowInHeroSelect, without the Trait flag (Hogger's Rage). Added as passive traits.

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { Gamestrings, HeroAbility, HeroData } from "../types.ts";
import { attr, block } from "./catalog-xml.ts";
import type { GamedataFile } from "./gamedata-paths.ts";
import { PASSIVE_ABILITY_ID } from "./gamestrings.ts";
import { DATA_ROOT } from "./paths.ts";
import { readCatalogNumber, type CatalogIndex } from "./weapon-timing.ts";

interface HeroSelectExtra {
  hero: string;
  ability: HeroAbility;
  name: string;
  shortText: string;
  fullText: string;
}

const HERO_ABIL_RE = /<HeroAbilArray\s+Button="(\w+)"\s*>([\s\S]*?)<\/HeroAbilArray>/g;
const D_REF_RE = /<d\s+ref="([^"]+)"([^>]*)\/>/g;
const CATALOG_REF_RE = /([A-Za-z]+),(\w+),([\w.[\]]+)/g;
const HLT_COLOR_RE = /val="([0-9a-f]{6})" hlt-name="(#\w+)"/gi;

function flagSet(body: string, flag: string): boolean {
  return new RegExp(`index="${flag}"\\s+value="1"`).test(body);
}

function modRoot(relPath: string): string | null {
  const m = /^(.*?\.stormmod)\//.exec(relPath);
  return m ? m[1] : null;
}

async function readLocalizedStrings(mod: string): Promise<Map<string, string>> {
  const file = path.join(DATA_ROOT, mod, "enus.stormdata/localizeddata/gamestrings.txt");
  const text = await readFile(file, "utf-8").catch(() => "");
  return new Map(
    text.split(/\r?\n/).flatMap((line) => {
      const at = line.indexOf("=");
      return at > 0 ? [[line.slice(0, at), line.slice(at + 1)] as const] : [];
    }),
  );
}

// HDP rewrites "#TooltipNumbers" style colors to hex; reuse its mapping.
function highlightColors(gs: Gamestrings): Map<string, string> {
  const colors = new Map<string, string>();
  for (const text of Object.values(gs.ability.fullText)) {
    for (const [, hex, name] of text.matchAll(HLT_COLOR_RE)) colors.set(name, hex);
  }
  return colors;
}

function formatNumber(value: number, precision: number): string {
  return String(Number(value.toFixed(precision)));
}

function resolveRef(expr: string, index: CatalogIndex): number | null {
  let missing = false;
  const arithmetic = expr.replace(CATALOG_REF_RE, (_, catalog: string, id: string, field: string) => {
    const value = readCatalogNumber(index, catalog, id, field);
    if (value === null) missing = true;
    return String(value);
  });
  if (missing || !/^[\d.+\-*/()\s]+$/.test(arithmetic)) return null;
  return Number(new Function(`return (${arithmetic});`)());
}

function resolveText(text: string, index: CatalogIndex, colors: Map<string, string>, where: string): string {
  return text
    .replace(D_REF_RE, (raw, expr: string, rest: string) => {
      const value = resolveRef(expr, index);
      if (value === null) {
        console.warn(`hero-select-extras: unresolved ${raw} in ${where}`);
        return "?";
      }
      return formatNumber(value, Number(attr(rest, "precision") ?? 2));
    })
    .replace(/val="(#\w+)"/g, (raw, name: string) => (colors.has(name) ? `val="${colors.get(name)}"` : raw));
}

function buttonIcon(xml: string, buttonId: string): string {
  const icon = attr(block(xml, "CButton", buttonId)?.match(/<Icon\b[^>]*>/)?.[0] ?? "", "value") ?? "";
  return path.basename(icon.replace(/\\/g, "/")).replace(/\.dds$/i, ".png").toLowerCase();
}

export async function findHeroSelectExtras(
  files: GamedataFile[],
  heroData: Record<string, HeroData>,
  gs: Gamestrings,
  index: CatalogIndex,
): Promise<HeroSelectExtra[]> {
  const known = new Set(
    Object.values(heroData).flatMap((h) => Object.values(h.abilities).flat().map((a) => a.buttonId)),
  );
  const colors = highlightColors(gs);
  const extras: HeroSelectExtra[] = [];

  for (const file of files) {
    const mod = modRoot(file.path);
    if (!mod) continue;
    for (const heroBlock of file.content.match(/<CHero\b[^>]*>[\s\S]*?<\/CHero>/g) ?? []) {
      const hero = attr(heroBlock, "id");
      if (!hero || !heroData[hero]) continue;
      for (const [, buttonId, body] of heroBlock.matchAll(HERO_ABIL_RE)) {
        if (known.has(buttonId) || !flagSet(body, "ShowInHeroSelect") || flagSet(body, "Trait")) continue;
        const strings = await readLocalizedStrings(mod);
        const text = (kind: string) =>
          resolveText(strings.get(`Button/${kind}/${buttonId}`) ?? "", index, colors, buttonId);
        extras.push({
          hero,
          ability: {
            linkId: `${PASSIVE_ABILITY_ID}|${buttonId}|Trait`,
            abilityId: PASSIVE_ABILITY_ID,
            buttonId,
            icon: buttonIcon(file.content, buttonId),
            abilityType: "Trait",
          },
          name: text("Name"),
          shortText: text("SimpleDisplayText"),
          fullText: text("Tooltip"),
        });
      }
    }
  }
  return extras;
}

export function withHeroSelectExtras(
  heroData: Record<string, HeroData>,
  gs: Gamestrings,
  extras: HeroSelectExtra[],
): { heroData: Record<string, HeroData>; gs: Gamestrings } {
  const text = (pick: (e: HeroSelectExtra) => string) =>
    Object.fromEntries(extras.map((e) => [e.ability.linkId, pick(e)]));
  const traits = (hero: string) => extras.filter((e) => e.hero === hero).map((e) => e.ability);
  return {
    heroData: Object.fromEntries(
      Object.entries(heroData).map(([name, hero]) => {
        const added = traits(name);
        if (!added.length) return [name, hero];
        const abilities = { ...hero.abilities, Trait: [...(hero.abilities.Trait ?? []), ...added] };
        return [name, { ...hero, abilities }];
      }),
    ),
    gs: {
      ...gs,
      ability: {
        ...gs.ability,
        name: { ...gs.ability.name, ...text((e) => e.name) },
        shortText: { ...gs.ability.shortText, ...text((e) => e.shortText) },
        fullText: { ...gs.ability.fullText, ...text((e) => e.fullText) },
      },
    },
  };
}
