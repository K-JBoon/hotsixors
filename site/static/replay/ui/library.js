
import { escapeHtml } from './html.js';
import { icon } from './icons.js';
import { TEAM_COLORS } from './state.js';

export const library = { entries: [], activeId: null };

let nextId = 1;

export function addEntry(fileName, key) {
  const entry = {
    id: nextId++,
    fileName,
    key: key || '',
    hash: '',
    status: 'loading',
    error: '',
    viewer: null,
    card: null,
  };
  library.entries.push(entry);
  return entry;
}

export function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function findEntry(id) {
  return library.entries.find((e) => e.id === id) || null;
}

export function findByKey(key) {
  return (key && library.entries.find((e) => e.key === key)) || null;
}

export function findByHash(hash, exceptId) {
  return (hash && library.entries.find((e) => e.hash === hash && e.id !== exceptId)) || null;
}

export function removeEntry(id) {
  const i = library.entries.findIndex((e) => e.id === id);
  if (i >= 0) library.entries.splice(i, 1);
  return i;
}

export function buildCard(model, mapMeta, draftData) {
  const bg = mapMeta && (draftData.battlegrounds || []).find((b) => b.slug === mapMeta.slug);
  const winner = model.players.find((p) => p.result === 1);
  return {
    map: model.map,
    background: (bg && bg.background) || (mapMeta && mapMeta.image) || '',
    winnerTeam: winner ? winner.team : null,
    teams: [0, 1].map((t) =>
      model.players
        .filter((p) => p.team === t)
        .map((p) => ({ name: p.name, hero: p.hero, portrait: p.meta ? p.meta.portrait : '' }))
    ),
  };
}

function heroHtml(p) {
  const label = `${p.hero} · ${p.name}`;
  return `<span class="rp-lib-hero" data-label="${escapeHtml(label)}">${
    p.portrait
      ? `<img src="/images/heroportraits/${p.portrait}" alt="${escapeHtml(p.hero)}">`
      : escapeHtml(p.hero.slice(0, 1))
  }</span>`;
}

function teamHtml(card, ti) {
  return `<span class="rp-lib-team" style="--team-color:${TEAM_COLORS[ti]}">
    ${card.teams[ti].map(heroHtml).join('')}
    <span class="rp-lib-team__crown">${
      card.winnerTeam === ti ? `<span title="Winner">${icon('crown', 'rp-icon--crown')}</span>` : ''
    }</span>
  </span>`;
}

function entryHtml(entry) {
  const active = entry.id === library.activeId ? ' is-active' : '';
  const card = entry.card;
  const thumb = card && card.background ? ` style="--card-bg:url('${card.background}')"` : '';
  let body;
  if (entry.status === 'loading') {
    body = `<span class="rp-lib-card__title">${escapeHtml(entry.fileName)}</span>
      <span class="rp-lib-card__note">Parsing…</span>`;
  } else if (entry.status === 'error') {
    body = `<span class="rp-lib-card__title">${escapeHtml(entry.fileName)}</span>
      <span class="rp-lib-card__note rp-lib-card__note--error">${escapeHtml(entry.error)}</span>`;
  } else {
    body = `<span class="rp-lib-card__title">${escapeHtml(card.map)}</span>
      <span class="rp-lib-card__teams">${teamHtml(card, 0)}${teamHtml(card, 1)}</span>`;
  }
  return `<div class="rp-lib-item${active}">
    <button class="rp-lib-card" data-lib-select="${entry.id}"${thumb} title="${escapeHtml(
      card ? `${card.map} — ${entry.fileName}` : entry.fileName
    )}"${
      entry.status === 'ready' ? '' : ' disabled'
    }>
      <span class="rp-lib-card__body">${body}</span>
    </button>
    <button class="rp-lib-remove" data-lib-remove="${entry.id}" title="Remove this replay" aria-label="Remove ${escapeHtml(
      entry.fileName
    )}">${icon('close')}</button>
  </div>`;
}

export function libraryHtml() {
  return `<aside class="rp-lib" data-library>
    <div class="rp-lib__head">
      <span class="rp-lib__title">Replays<span class="rp-lib__count">${library.entries.length}</span></span>
    </div>
    <div class="rp-lib__list">${library.entries.map(entryHtml).join('')}</div>
    <label class="rp-lib__add" for="replay-file-input" title="Add a replay to this view">${icon(
      'plus'
    )}<span>Add replay</span></label>
  </aside>`;
}
