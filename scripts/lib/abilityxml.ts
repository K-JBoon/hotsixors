import type { AbilityStats, AbilityStatSource } from "../types.ts";
import { attr, block as catalogBlock, esc } from "./catalog-xml.ts";
import { parseConstants, resolveNumber, type Constants } from "./catalog-consts.ts";

function parseMana(block: string, consts: Constants): number | null {
  const el = /<Vital[^>]+index="Energy"[^>]*\/?>/i.exec(block);
  if (!el) return null;
  return resolveNumber(attr(el[0], "value"), consts);
}

function parseCooldown(block: string, consts: Constants): number | null {
  const m = /<Cooldown[^>]+TimeUse="([^"]+)"/i.exec(block);
  return m ? resolveNumber(m[1], consts) : null;
}

function parseCastIntroTime(block: string, consts: Constants): number | null {
  const m = /<CastIntroTime[^>]+value="([^"]+)"/i.exec(block);
  return m ? resolveNumber(m[1], consts) : null;
}

function parseCastFinishTime(block: string, consts: Constants): number | null {
  const m = /<FinishTime[^>]+value="([^"]+)"/i.exec(block);
  return m ? resolveNumber(m[1], consts) : null;
}

function extractChargeBlock(abilBlock: string): string | null {
  const m = /<Charge>([\s\S]*?)<\/Charge>/i.exec(abilBlock);
  return m ? m[1] : null;
}

function parseChargeCountMax(abilBlock: string, consts: Constants): number | null {
  const charge = extractChargeBlock(abilBlock);
  if (!charge) return null;
  const m = /<CountMax[^>]+value="([^"]+)"/i.exec(charge);
  return m ? resolveNumber(m[1], consts) : null;
}

function parseChargeTimeUse(abilBlock: string, consts: Constants): number | null {
  const charge = extractChargeBlock(abilBlock);
  if (!charge) return null;
  const m = /<TimeUse[^>]+value="([^"]+)"/i.exec(charge);
  return m ? resolveNumber(m[1], consts) : null;
}

function parseScaling(xml: string, abilityId: string, consts: Constants): number | null {
  const lsaRe = new RegExp(
    `<LevelScalingArray[^>]+Ability="${esc(abilityId)}"[^>]*>([\\s\\S]*?)</LevelScalingArray>`,
    "i"
  );
  const lsaMatch = lsaRe.exec(xml);
  if (!lsaMatch) return null;

  for (const modMatch of lsaMatch[1].matchAll(/<Modifications>([\s\S]*?)<\/Modifications>/gi)) {
    const mod = modMatch[1];
    if (/<Field[^>]+value="Amount"/i.test(mod)) {
      const v = /<Value[^>]+value="([^"]+)"/i.exec(mod);
      if (v) return resolveNumber(v[1], consts);
    }
  }
  return null;
}

// ---

const constantsCache = new Map<string, Constants>();

export function parseAbilityStats(xml: string, abilityId: string, xmlPath: string): AbilityStats {
  const abilBlock = catalogBlock(xml, "CAbil", abilityId);
  const consts = constantsCache.get(xmlPath) ?? parseConstants(xml);
  constantsCache.set(xmlPath, consts);
  const abilSrc: AbilityStatSource = { xmlPath, anchor: abilityId };

  const sources: AbilityStats["sources"] = {};

  const manaCost = abilBlock ? parseMana(abilBlock, consts) : null;
  if (manaCost !== null) sources.manaCost = abilSrc;

  const cooldown = abilBlock ? parseCooldown(abilBlock, consts) : null;
  if (cooldown !== null) sources.cooldown = abilSrc;

  const castIntroTime = abilBlock ? parseCastIntroTime(abilBlock, consts) : null;
  if (castIntroTime !== null) sources.castIntroTime = abilSrc;

  const castFinishTime = abilBlock ? parseCastFinishTime(abilBlock, consts) : null;
  if (castFinishTime !== null) sources.castFinishTime = abilSrc;

  const chargeCountMax = abilBlock ? parseChargeCountMax(abilBlock, consts) : null;
  if (chargeCountMax !== null) sources.chargeCountMax = abilSrc;

  const chargeTimeUse = abilBlock ? parseChargeTimeUse(abilBlock, consts) : null;
  if (chargeTimeUse !== null) sources.chargeTimeUse = abilSrc;

  const scaling = parseScaling(xml, abilityId, consts);
  if (scaling !== null) sources.scaling = abilSrc;

  return { manaCost, cooldown, castIntroTime, castFinishTime, scaling, chargeCountMax, chargeTimeUse, sources };
}
