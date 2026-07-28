import type { Gamestrings, GamestringsAbilityText } from "../types.ts";
import { attr } from "./catalog-xml.ts";

export const PASSIVE_ABILITY_ID = ":PASSIVE:";

export function entryNameId(entry: { abilityId?: string; talentId?: string; buttonId: string }): string {
  const id = entry.talentId ?? entry.abilityId;
  return !id || id === PASSIVE_ABILITY_ID ? entry.buttonId : id;
}

function textSection(gs: Gamestrings, linkId: string): GamestringsAbilityText {
  return linkId.split("|").length > 3 ? gs.talent : gs.ability;
}

export function getAbilityName(gs: Gamestrings, linkId: string, fallback = linkId): string {
  return textSection(gs, linkId).name[linkId] ?? fallback;
}

export function getAbilityShortDesc(gs: Gamestrings, linkId: string): string {
  return textSection(gs, linkId).shortText[linkId] ?? "";
}

export function getAbilityFullDesc(gs: Gamestrings, linkId: string): string {
  return textSection(gs, linkId).fullText[linkId] ?? "";
}

export function splitCamelCase(id: string): string {
  return id.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function getUnitName(gs: Gamestrings, unitId: string): string {
  return gs.unit?.name?.[unitId] ?? splitCamelCase(unitId);
}

export function stripMarkup(text: string): string {
  return text
    .replace(/<c val="[^"]*">/g, "")
    .replace(/<c val="[^"]*"[^>]*>/g, "")
    .replace(/<\/c>/g, "")
    .replace(/<s val="[^"]*"[^>]*>/g, "")
    .replace(/<\/s>/g, "")
    .replace(/<n\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/~~([0-9.]+)~~/g, (_, v) => ` (+${Math.round(parseFloat(v) * 100)}% per level)`);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/`/g, "&#96;");
}

function styleClassToken(value: string): string {
  const token = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return token || "unknown";
}

const SCALE_PATTERN = /(\d+(?:\.\d+)?)(%?)~~([0-9.]+)~~/g;

function renderTextSegment(text: string): string {
  let html = "";
  let index = 0;
  let match: RegExpExecArray | null;
  SCALE_PATTERN.lastIndex = 0;

  while ((match = SCALE_PATTERN.exec(text)) !== null) {
    html += escapeHtml(text.slice(index, match.index));
    const base = match[1];
    const percent = match[2];
    const scale = match[3];
    const percentAttr = percent ? ` data-percent="true"` : "";
    const scalePct = Math.round(parseFloat(scale) * 100);
    const titleAttr = ` title="+${scalePct}% per level"`;
    html += `<span class="storm-scale" data-base="${base}" data-scale="${scale}"${percentAttr}${titleAttr}>${escapeHtml(base + percent)}</span>`;
    index = match.index + match[0].length;
  }

  return html + escapeHtml(text.slice(index));
}

const SCALE_TAG_BRIDGE = /(\d+(?:\.\d+)?)(%?)<\/c>\s*<c[^>]*>~~([0-9.]+)~~/g;

export function renderGameStringMarkup(text: string): string {
  text = text.replace(SCALE_TAG_BRIDGE, (_, base, pct, scale) => `${base}${pct}~~${scale}~~`);
  let html = "";
  let index = 0;
  let openSpans = 0;
  const tagPattern = /<[^>]+>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(text)) !== null) {
    const tag = match[0];
    html += renderTextSegment(text.slice(index, match.index));
    index = match.index + tag.length;

    if (/^<img\b/i.test(tag)) continue;
    if (/^<n\s*\/>$/i.test(tag)) {
      html += "<br>";
      continue;
    }
    if (/^<c\b/i.test(tag)) {
      const color = attr(tag, "val");
      if (color && /^[0-9a-f]{3,8}$/i.test(color)) {
        html += `<span class="storm-color" style="color: #${color.slice(0, 6)}">`;
      } else {
        html += `<span class="storm-color">`;
      }
      openSpans += 1;
      continue;
    }
    if (/^<\/c>$/i.test(tag)) {
      if (openSpans > 0) {
        html += "</span>";
        openSpans -= 1;
      }
      continue;
    }
    if (/^<s\b/i.test(tag)) {
      const style = attr(tag, "val") ?? "";
      const colorStyle = /^[0-9a-f]{3,8}$/i.test(style) ? ` style="color: #${style.slice(0, 6)}"` : "";
      html += `<span class="storm-style storm-style--${styleClassToken(style)}" data-storm-style="${escapeAttribute(style)}"${colorStyle}>`;
      openSpans += 1;
      continue;
    }
    if (/^<\/s>$/i.test(tag)) {
      if (openSpans > 0) {
        html += "</span>";
        openSpans -= 1;
      }
    }
  }

  html += renderTextSegment(text.slice(index));
  while (openSpans > 0) {
    html += "</span>";
    openSpans -= 1;
  }
  return html;
}

export function getHeroDescription(gs: Gamestrings, heroKey: string, variationSkinIds: string[] = []): string {
  const info = gs.hero?.infoText?.[heroKey];
  if (info) return stripMarkup(info);
  for (const skinKey of variationSkinIds) {
    const val = gs.skin?.infoText?.[skinKey];
    if (val) return stripMarkup(val);
  }
  return "";
}

export function getRoleFromPlaystyles(playstyles: string[]): string {
  for (const p of playstyles) {
    if (p.startsWith("Role")) return p.slice(4);
  }
  return "Unknown";
}
