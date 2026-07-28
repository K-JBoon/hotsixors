
import { LOOPS_PER_SECOND } from '../analyze.js';
import { state, TEAM_COLORS } from './state.js';

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const heroUrl = (p) => (p.heroSlug ? `/heroes/${p.heroSlug}/` : null);
export const talentUrl = (p, nameId) => (p.heroSlug ? `/heroes/${p.heroSlug}/#talent-${nameId}` : null);

export function externalLink(href, inner, className, title) {
  if (!href) return inner;
  return `<a class="${className}" href="${href}" target="_blank" rel="noopener"${
    title ? ` title="${title}"` : ''
  }>${inner}</a>`;
}

export function portraitHtml(p) {
  return p.meta
    ? `<img class="feed-portrait" style="border-color:${TEAM_COLORS[p.team]}" src="/images/heroportraits/${p.meta.portrait}" alt="${escapeHtml(p.hero)}" title="${escapeHtml(p.hero)}">`
    : `<span class="feed-portrait" style="border-color:${TEAM_COLORS[p.team]}">${escapeHtml(p.hero[0])}</span>`;
}

export function killerNames(model, death) {
  return death.killers
    .map((pid) => model.players.find((p) => p.playerId === pid))
    .filter(Boolean)
    .map((p) => p.hero);
}

export const clockText = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

export function formatLoop(loop) {
  const secs = Math.floor((loop - state.model.gatesOpenLoop) / LOOPS_PER_SECOND);
  return `${secs < 0 ? '-' : ''}${clockText(Math.abs(secs))}`;
}
