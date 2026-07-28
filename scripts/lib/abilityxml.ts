import type { AbilityStats, AbilityStatSource } from "../types.ts";
import { attr, block as catalogBlock, esc } from "./catalog-xml.ts";

function parseMana(block: string): number | null {
  const el = /<Vital[^>]+index="Energy"[^>]*\/?>/i.exec(block);
  if (!el) return null;
  const v = attr(el[0], "value");
  return v !== null ? parseFloat(v) : null;
}

function parseCooldown(block: string): number | null {
  const m = /<Cooldown[^>]+TimeUse="([\d.]+)"/i.exec(block);
  return m ? parseFloat(m[1]) : null;
}

function parseCastIntroTime(block: string): number | null {
  const m = /<CastIntroTime[^>]+value="([\d.]+)"/i.exec(block);
  return m ? parseFloat(m[1]) : null;
}

function parseCastFinishTime(block: string): number | null {
  const m = /<FinishTime[^>]+value="([\d.]+)"/i.exec(block);
  return m ? parseFloat(m[1]) : null;
}

function extractChargeBlock(abilBlock: string): string | null {
  const m = /<Charge>([\s\S]*?)<\/Charge>/i.exec(abilBlock);
  return m ? m[1] : null;
}

function parseChargeCountMax(abilBlock: string): number | null {
  const charge = extractChargeBlock(abilBlock);
  if (!charge) return null;
  const m = /<CountMax[^>]+value="([\d.]+)"/i.exec(charge);
  return m ? parseFloat(m[1]) : null;
}

function parseChargeTimeUse(abilBlock: string): number | null {
  const charge = extractChargeBlock(abilBlock);
  if (!charge) return null;
  const m = /<TimeUse[^>]+value="([\d.]+)"/i.exec(charge);
  return m ? parseFloat(m[1]) : null;
}

function parseScaling(xml: string, abilityId: string): number | null {
  const lsaRe = new RegExp(
    `<LevelScalingArray[^>]+Ability="${esc(abilityId)}"[^>]*>([\\s\\S]*?)</LevelScalingArray>`,
    "i"
  );
  const lsaMatch = lsaRe.exec(xml);
  if (!lsaMatch) return null;

  for (const modMatch of lsaMatch[1].matchAll(/<Modifications>([\s\S]*?)<\/Modifications>/gi)) {
    const mod = modMatch[1];
    if (/<Field[^>]+value="Amount"/i.test(mod)) {
      const v = /<Value[^>]+value="([\d.]+)"/i.exec(mod);
      if (v) return parseFloat(v[1]);
    }
  }
  return null;
}

// ---

export function parseAbilityStats(xml: string, abilityId: string, xmlPath: string): AbilityStats {
  const abilBlock = catalogBlock(xml, "CAbil", abilityId);
  const abilSrc: AbilityStatSource = { xmlPath, anchor: abilityId };

  const sources: AbilityStats["sources"] = {};

  const manaCost = abilBlock ? parseMana(abilBlock) : null;
  if (manaCost !== null) sources.manaCost = abilSrc;

  const cooldown = abilBlock ? parseCooldown(abilBlock) : null;
  if (cooldown !== null) sources.cooldown = abilSrc;

  const castIntroTime = abilBlock ? parseCastIntroTime(abilBlock) : null;
  if (castIntroTime !== null) sources.castIntroTime = abilSrc;

  const castFinishTime = abilBlock ? parseCastFinishTime(abilBlock) : null;
  if (castFinishTime !== null) sources.castFinishTime = abilSrc;

  const chargeCountMax = abilBlock ? parseChargeCountMax(abilBlock) : null;
  if (chargeCountMax !== null) sources.chargeCountMax = abilSrc;

  const chargeTimeUse = abilBlock ? parseChargeTimeUse(abilBlock) : null;
  if (chargeTimeUse !== null) sources.chargeTimeUse = abilSrc;

  const scaling = parseScaling(xml, abilityId);
  if (scaling !== null) sources.scaling = abilSrc;

  return { manaCost, cooldown, castIntroTime, castFinishTime, scaling, chargeCountMax, chargeTimeUse, sources };
}
