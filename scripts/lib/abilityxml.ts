import type { AbilityStats, AbilityStatSource } from "../types.ts";
import { attr, block as catalogBlock, esc } from "./catalog-xml.ts";
import { parseConstants, resolveNumber, type Constants } from "./catalog-consts.ts";

function parseMana(block: string, consts: Constants): number | null {
  const el = /<Vital[^>]+index="Energy"[^>]*\/?>/i.exec(block);
  if (!el) return null;
  return resolveNumber(attr(el[0], "value"), consts);
}

function parseCooldown(block: string, costTag: string, consts: Constants): number | null {
  const cost = new RegExp(`<${costTag}\\b[^>]*>([\\s\\S]*?)</${costTag}>`, "i").exec(block);
  const m = cost && /<Cooldown[^>]+TimeUse="([^"]+)"/i.exec(cost[1]);
  return m ? resolveNumber(m[1], consts) : null;
}

// Off faces come from the ability's CmdButtonArray or from unit card layouts.
export function isToggleOffButton(xml: string, abilityId: string, buttonId: string): boolean {
  const abilBlock = catalogBlock(xml, "CAbil", abilityId);
  if (!abilBlock) return false;
  const cmd = /<CmdButtonArray[^>]+index="Off"[^>]*>/i.exec(abilBlock);
  if (cmd && attr(cmd[0], "DefaultButtonFace") === buttonId) return true;
  const layout = new RegExp(`<Buttons\\b[^>]+AbilCmd="${esc(abilityId)},Off"[^>]*>`, "gi");
  return [...xml.matchAll(layout)].some((m) => attr(m[0], "Face") === buttonId);
}

// Toggles pay Cost on activation (the cancel lockout) and OffCost/ExpireCost on deactivation.
function cardCooldown(abilBlock: string, isOff: boolean, consts: Constants): number | null {
  const onCost = parseCooldown(abilBlock, "Cost", consts);
  if (isOff) return onCost;
  const all = [onCost, parseCooldown(abilBlock, "OffCost", consts), parseCooldown(abilBlock, "ExpireCost", consts)]
    .filter((v): v is number => v !== null);
  return all.length > 0 ? Math.max(...all) : null;
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

// ---

const constantsCache = new Map<string, Constants>();

export function parseAbilityStats(
  xml: string,
  abilityId: string,
  buttonId: string,
  xmlPath: string,
): Omit<AbilityStats, "range" | "radius" | "width"> {
  const abilBlock = catalogBlock(xml, "CAbil", abilityId);
  const consts = constantsCache.get(xmlPath) ?? parseConstants(xml);
  constantsCache.set(xmlPath, consts);
  const abilSrc: AbilityStatSource = { xmlPath, anchor: abilityId };

  const sources: AbilityStats["sources"] = {};

  const manaCost = abilBlock ? parseMana(abilBlock, consts) : null;
  if (manaCost !== null) sources.manaCost = abilSrc;

  const cooldown = abilBlock
    ? cardCooldown(abilBlock, isToggleOffButton(xml, abilityId, buttonId), consts)
    : null;
  if (cooldown !== null) sources.cooldown = abilSrc;

  const castIntroTime = abilBlock ? parseCastIntroTime(abilBlock, consts) : null;
  if (castIntroTime !== null) sources.castIntroTime = abilSrc;

  const castFinishTime = abilBlock ? parseCastFinishTime(abilBlock, consts) : null;
  if (castFinishTime !== null) sources.castFinishTime = abilSrc;

  const chargeCountMax = abilBlock ? parseChargeCountMax(abilBlock, consts) : null;
  if (chargeCountMax !== null) sources.chargeCountMax = abilSrc;

  const chargeTimeUse = abilBlock ? parseChargeTimeUse(abilBlock, consts) : null;
  if (chargeTimeUse !== null) sources.chargeTimeUse = abilSrc;

  return { manaCost, cooldown, castIntroTime, castFinishTime, chargeCountMax, chargeTimeUse, sources };
}
