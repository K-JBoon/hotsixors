
import { fetchJson } from '../../js/storage.js';
import { abilityKeyFor } from './abilities.js';
import { escapeHtml } from './html.js';
import { root, state } from './state.js';

let descriptions = null;
let descriptionsPromise = null;
function loadDescriptions() {
  if (!descriptionsPromise) {
    descriptionsPromise = fetchJson('/ability-descriptions.json', {}).then((data) => {
      descriptions = data;
      return data;
    });
  }
  return descriptionsPromise;
}

let activeCell = null;

function tooltipEl() {
  let el = root.querySelector('[data-talent-tooltip]');
  if (!el) {
    el = document.createElement('div');
    el.className = 'talent-tooltip';
    el.setAttribute('data-talent-tooltip', '');
    el.hidden = true;
    root.appendChild(el);
  }
  return el;
}

function tooltipHtml(cell) {
  const { talentId, talentHero, talentTier } = cell.dataset;
  const key = abilityKeyFor(state.shortcodeData, talentHero, talentId);
  const entry = key ? state.shortcodeData[key] : null;
  const name = entry ? entry.name : talentId;
  const desc =
    (descriptions && key && descriptions[key]) || (entry && escapeHtml(entry.shortDesc)) || '';
  const icon = entry && entry.icon
    ? `<img class="talent-tooltip__icon" src="/images/abilitytalents/${entry.icon}" alt="">`
    : '';
  return `
    <div class="talent-tooltip__head">
      ${icon}
      <span class="talent-tooltip__name">${escapeHtml(name)}</span>
    </div>
    <div class="talent-tooltip__meta">Level ${escapeHtml(talentTier || '')}</div>
    ${desc ? `<div class="talent-tooltip__desc storm-game-string">${desc}</div>` : ''}`;
}

function place(el, cell) {
  const margin = 8;
  el.style.left = '0px';
  el.style.top = '0px';
  const cellRect = cell.getBoundingClientRect();
  const tipRect = el.getBoundingClientRect();
  const left = Math.max(
    margin,
    Math.min(
      cellRect.left + cellRect.width / 2 - tipRect.width / 2,
      window.innerWidth - tipRect.width - margin
    )
  );
  let top = cellRect.bottom + 6;
  if (top + tipRect.height > window.innerHeight - margin) top = cellRect.top - tipRect.height - 6;
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(margin, top)}px`;
}

function show(cell) {
  activeCell = cell;
  const el = tooltipEl();
  el.innerHTML = tooltipHtml(cell);
  el.hidden = false;
  place(el, cell);
  if (!descriptions) {
    loadDescriptions().then(() => {
      if (activeCell !== cell) return;
      el.innerHTML = tooltipHtml(cell);
      place(el, cell);
    });
  }
}

export function hideTalentTooltip() {
  activeCell = null;
  const el = root.querySelector('[data-talent-tooltip]');
  if (el) el.hidden = true;
}

let globalsBound = false;
function bindGlobals() {
  if (globalsBound) return;
  globalsBound = true;
  window.addEventListener('scroll', hideTalentTooltip, true);
  window.addEventListener('resize', hideTalentTooltip);
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest?.('[data-talent-id]')) hideTalentTooltip();
  });
}

export function initTalentTooltip(container) {
  loadDescriptions();
  bindGlobals();
  container.addEventListener('pointerover', (e) => {
    const cell = e.target.closest?.('[data-talent-id]');
    if (cell && cell !== activeCell) show(cell);
  });
  container.addEventListener('pointerout', (e) => {
    const cell = e.target.closest?.('[data-talent-id]');
    if (cell && !cell.contains(e.relatedTarget)) hideTalentTooltip();
  });
  container.addEventListener('focusin', (e) => {
    const cell = e.target.closest?.('[data-talent-id]');
    if (cell) show(cell);
  });
  container.addEventListener('focusout', hideTalentTooltip);
}
