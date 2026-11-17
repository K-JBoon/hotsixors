// Rendering helpers shared by the stats page and the hero page panel.

import { escapeHtml } from '../js/escape.js';
import { normalizeSearchValue, updateSelectGridSearchQuery } from '../js/search.js';

export { escapeHtml };

export const fmt = {
  int: (v) => (v == null ? '–' : Math.round(v).toLocaleString('en-US')),
  num: (v) => (v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 1 })),
  num2: (v) => (v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
  delta: (v) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(1)} pp`),
  big: (v) => (v == null ? '–' : v >= 10000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString('en-US')),
  pct: (v) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`),
  dur: (s) => (s == null ? '–' : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`),
  date: (iso) => (iso ? iso.slice(0, 10) : '–'),
  ago: (iso) => {
    const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
    return iso.slice(0, 10);
  },
};

/** Rows under this many games are dimmed. */
export const THIN_GAMES = 10;

/** 95% Wilson score interval for `rate` over `n` trials. */
export function wilson(rate, n, z = 1.96) {
  if (rate == null || !n) return [0, 1];
  const z2 = z * z;
  const mid = (rate + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((rate * (1 - rate)) / n + z2 / (4 * n * n));
  return [mid - half, mid + half];
}

/** Colored when the interval excludes `base`. */
export function deltaCell(v, base, games) {
  if (v == null || base == null) return '–';
  const [lo, hi] = wilson(v, games);
  const tone = lo > base ? ' is-high' : hi < base ? ' is-low' : '';
  return `<span class="stats-wr${tone}" title="Win rate minus ${fmt.pct(base)}">${fmt.delta(v - base)}</span>`;
}

/** Win rates the interval bar spans, 50% in the middle. */
const WR_AXIS = [0.2, 0.8];

/** Colored only when the interval excludes 50%. */
export function winRateCell(v, games) {
  if (v == null) return '–';
  const [lo, hi] = wilson(v, games);
  const tone = lo > 0.5 ? ' is-high' : hi < 0.5 ? ' is-low' : '';
  const at = (x) => `${(Math.min(Math.max((x - WR_AXIS[0]) / (WR_AXIS[1] - WR_AXIS[0]), 0), 1) * 100).toFixed(1)}%`;
  return `<span class="stats-wr${tone}" title="95% interval ${fmt.pct(lo)}–${fmt.pct(hi)}" style="--lo: ${at(lo)}; --hi: ${at(hi)}">${fmt.pct(v)}</span>`;
}

const thin = (n) => typeof n === 'number' && n < THIN_GAMES;
export const thinOf = (counts) => (counts.every(thin) ? () => false : thin);

let heroIndex = null;
/** Hero slug → `{ name, portrait }` from the draft tool's data. */
export function loadHeroes() {
  heroIndex ??= fetch('/draft/draft-data.json')
    .then((r) => (r.ok ? r.json() : { heroes: [] }))
    .then((d) => new Map(d.heroes.map((h) => [h.slug, h])))
    .catch(() => new Map());
  return heroIndex;
}

export const heroPortrait = (heroes, slug) => {
  const h = heroes.get(slug);
  return h ? `<img class="stats-portrait" src="/images/heroportraits/${escapeHtml(h.portrait)}" alt="" loading="lazy">` : '';
};

export function heroCell(heroes, slug, href = null) {
  const name = heroName(heroes, slug);
  const img = heroPortrait(heroes, slug);
  const label = `${img}<span>${escapeHtml(name)}</span>`;
  return `<span class="stats-hero">${href ? `<a href="${escapeHtml(href)}">${label}</a>` : label}</span>`;
}

export const heroName = (heroes, slug) => heroes.get(slug)?.name ?? slug;

export const MISSING_ICON = '<span class="stats-portrait stats-portrait--missing" aria-hidden="true">?</span>';

const TIER_LEVELS = [1, 4, 7, 10, 13, 16, 20];
const splitId = (id) => id.replace(/([a-z])([A-Z])/g, '$1 $2');

/**
 * Talent picks as one table, a row group per tier, most picked first.
 * `rows` are heroReport talents: `{ tier, talent, picks, pickRate, winRate }`.
 * `delta` adds a column against `tierWinRate`, the hero's win rate in games that reached the tier.
 */
export function renderTalentTiers(container, talents, rows, delta = false) {
  const tiers = Map.groupBy(rows, (r) => r.tier);
  const dim = thinOf(rows.map((r) => r.picks));
  const talentCell = (r) => {
    const t = talents[r.talent];
    if (!t) return `<span class="stats-hero" title="Not in the current game data">${MISSING_ICON}<span>${escapeHtml(splitId(r.talent))}</span></span>`;
    const img = `<img class="stats-portrait" src="/images/abilitytalents/${escapeHtml(t.icon)}" alt="" loading="lazy">`;
    return `<span class="stats-hero"><a href="/heroes/${escapeHtml(t.hero)}/#talent-${escapeHtml(r.talent)}">${img}<span>${escapeHtml(t.name)}</span></a></span>`;
  };
  const group = (tier) => {
    const list = tiers.get(tier).sort((a, b) => b.picks - a.picks);
    const level = `<th scope="rowgroup" rowspan="${list.length}" class="stats-talents__level"><span class="talent-tier__num">${TIER_LEVELS[tier - 1] ?? tier}</span></th>`;
    return `<tbody>${list.map((r, i) => `<tr${dim(r.picks) ? ' class="is-thin"' : ''}>${i ? '' : level}
      <td>${talentCell(r)}</td>
      <td class="num">${fmt.pct(r.pickRate)}</td>
      <td class="num">${winRateCell(r.winRate, r.picks)}</td>${delta ? `
      <td class="num">${deltaCell(r.winRate, r.tierWinRate, r.picks)}</td>` : ''}
      <td class="num">${fmt.int(r.picks)}</td></tr>`).join('')}</tbody>`;
  };
  container.innerHTML = rows.length
    ? `<div class="table-wrap"><table class="table stats-table stats-talents">
        <thead><tr><th scope="col">Level</th><th scope="col">Talent</th><th scope="col" class="num">Picked</th><th scope="col" class="num">Win</th>${delta ? '<th scope="col" class="num" title="Win rate minus hero win rate at this level">vs hero</th>' : ''}<th scope="col" class="num">Games</th></tr></thead>
        ${[...tiers.keys()].sort((a, b) => a - b).map(group).join('')}
      </table></div>`
    : '<p class="stats-note">No games match these filters.</p>';
}

let activeSearch = null;
const savedQueries = new Map();
window.addEventListener('hashchange', () => savedQueries.clear());
document.addEventListener('keydown', (e) => {
  if (!activeSearch?.input.isConnected) return;
  if (e.target?.isContentEditable || e.target?.matches?.('input, textarea, select')) return;
  const { input, setQuery } = activeSearch;
  const next = updateSelectGridSearchQuery(input.value, e);
  if (next === input.value) return;
  e.preventDefault();
  input.value = next;
  input.focus();
  setQuery(next);
});

/**
 * Sortable table. `columns`: `{ key, label, title, html(row) | format, num, shrink, sort(row, dir) }`;
 * `shrink` sizes the column to its content. Rows whose `count` is under THIN_GAMES are dimmed.
 * Clicking a header re-sorts in place. Rows beyond `pageSize` go to further pages.
 * `search: { placeholder, text(row) }` adds a filter box when rows span several pages or a query is active;
 * typing anywhere on the page fills it. The query survives re-renders until the hash changes.
 * `onSort(key, dir)` runs after a header click.
 */
export function renderTable(container, { columns, rows, sortKey, sortDir = -1, pageSize = 20, split = Infinity, empty, search, onSort, count = (r) => r.games }) {
  empty ??= 'No games match these filters.';
  let key = columns.some((c) => c.key === sortKey) ? sortKey : columns[0].key;
  let dir = sortDir;
  let page = 0;
  let fullHeight = 0;
  let query = '';
  const saved = search ? savedQueries.get(search.placeholder) ?? '' : '';
  const searchable = search && (rows.length > pageSize || normalizeSearchValue(saved) !== '');
  const haystacks = searchable && new Map(rows.map((r) => [r, normalizeSearchValue(search.text(r))]));
  let target = container;
  if (searchable) {
    container.innerHTML = `<div class="select-search" role="search">
        <input class="input select-search__input" type="search" placeholder="${escapeHtml(search.placeholder ?? 'Filter')}" aria-label="${escapeHtml(search.placeholder ?? 'Filter')}" autocomplete="off" spellcheck="false">
      </div><div></div>`;
    target = container.lastElementChild;
    const input = container.querySelector('input');
    input.value = saved;
    query = normalizeSearchValue(input.value);
    const setQuery = (value) => {
      savedQueries.set(search.placeholder, value);
      const next = normalizeSearchValue(value);
      if (next === query) return;
      query = next;
      page = 0;
      draw();
    };
    input.addEventListener('input', () => setQuery(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      input.value = '';
      setQuery('');
    });
    activeSearch = { input, setQuery };
  }
  const cell = (c, r) => (c.html ? c.html(r) : c.format ? c.format(r[c.key]) : escapeHtml(r[c.key] ?? '–'));
  const sortValue = (c, r) => (c.sort ? c.sort(r, dir) : r[c.key]);
  const cls = (c) => [c.num && 'num', c.shrink && 'shrink'].filter(Boolean).join(' ');

  const draw = () => {
    const col = columns.find((c) => c.key === key) ?? columns[0];
    const shown = query ? rows.filter((r) => haystacks.get(r).includes(query)) : rows;
    const sorted = [...shown].sort((a, b) => {
      const x = sortValue(col, a);
      const y = sortValue(col, b);
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
    const head = columns
      .map((c) => {
        const sort = c.key === key ? (dir > 0 ? 'ascending' : 'descending') : 'none';
        return `<th scope="col" class="${cls(c)}" aria-sort="${sort}"><button type="button" data-sort="${c.key}"${c.title ? ` title="${escapeHtml(c.title)}"` : ''}>${escapeHtml(c.label)}</button></th>`;
      })
      .join('');
    const size = Number.isFinite(pageSize) ? pageSize : Math.max(sorted.length, 1);
    const pages = Math.max(1, Math.ceil(sorted.length / size));
    page = Math.min(page, pages - 1);
    const start = page * size;
    const dim = thinOf(sorted.map(count));
    const trs = sorted
      .slice(start, start + size)
      .map((r) => `<tr${dim(count(r)) ? ' class="is-thin"' : ''}>${columns.map((c) => `<td class="${cls(c)}">${cell(c, r)}</td>`).join('')}</tr>`);
    const half = Math.ceil(trs.length / 2);
    const bodies = trs.length > split ? [trs.slice(0, half), trs.slice(half)] : [trs];
    const table = (body) => `<div class="table-wrap"><table class="table stats-table"><thead><tr>${head}</tr></thead><tbody>${body.join('')}</tbody></table></div>`;
    const pager = pages > 1
      ? `<nav class="stats-pager" aria-label="Table pages">
          <button class="btn btn--sm" type="button" data-page="${page - 1}"${page === 0 ? ' disabled' : ''}>Previous</button>
          <span>${start + 1}–${Math.min(start + size, sorted.length)} of ${sorted.length.toLocaleString('en-US')}</span>
          <button class="btn btn--sm" type="button" data-page="${page + 1}"${page === pages - 1 ? ' disabled' : ''}>Next</button>
        </nav>`
      : '';
    target.innerHTML = sorted.length
      ? `${bodies.length > 1 ? `<div class="stats-split">${bodies.map(table).join('')}</div>` : table(trs)}${pager}`
      : `<p class="stats-note">${escapeHtml(rows.length ? 'No rows match that search.' : empty)}</p>`;
    const wrap = target.querySelector('.table-wrap');
    if (wrap && pages > 1) {
      if (sorted.length - start >= size) fullHeight = Math.max(fullHeight, wrap.offsetHeight);
      wrap.style.minHeight = `${fullHeight}px`;
    }
  };

  container.onclick = (e) => {
    const pageButton = e.target.closest('[data-page]');
    if (pageButton) {
      page = Number(pageButton.dataset.page);
      draw();
      container.scrollIntoView({ block: 'nearest' });
      return;
    }
    const button = e.target.closest('[data-sort]');
    if (!button) return;
    page = 0;
    const next = button.dataset.sort;
    dir = next === key ? -dir : -1;
    key = next;
    onSort?.(key, dir);
    draw();
  };
  draw();
}

export function tiles(items) {
  return `<dl class="stats-tiles">${items
    .map(([label, value]) => `<div class="stats-tile"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`)
    .join('')}</dl>`;
}

export const LIQUIPEDIA_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 363.75" aria-hidden="true"><path d="M283.34 141.23c.23.53 7.67 17.37 12.41 20.5 4.8 3.17 15.96-1.37 15.96-1.37l-9.34-9.05-19.03-10.08Zm46.84 16.9 63.25 97.06-23.48 34.15-41.34-18.06-1.430.14c-1.15-13.45-7.27-27.22-25.49-38.63-14.74-9.22-36.38-9.66-52.68.75-5.87-8.52-13.77-23.33-14.98-42.61 0 0-3.6 27.09 3.42 53.14a48.11 48.11 0 0 0-6.1 10.31c-14.46 33.04 12.04 53.68 17.25 71.55 1.46 5 2.19 12.01-8.2 15.25-12.4 3.87-105 12.86-105.96 12.96 0 0-4.73.5-4.79-5.22l-.96-94c.16-21.95-12.43-21.44-12.44-21.44-4.33 0-12.05 2.84-22.94 8.44-2.36 1.21-4.65 2.27-6.9 3.22.71-6.82 1.71-13.41 3-19.79-18.35 2.59-43.34 4.86-69.8 4.63-4.78-6.51-8.71-15.26-9.790-26.85-.58-6.72.12-13.4 1.95-19.64 31.23 8.26 62.72 12.24 84.93 13.78 3.27-9.16 7.090-17.75 11.33-25.8-16.09-4.61-37.03-11.66-58.68-21.06.96-.08 1.9-.13 2.86-.13 2.49 0 39.16 3.82 41.01 3.82 8 0 14.92-3.18 14.53-14.8 5.47 3.17 10.63 6.04 15.35 8.55 5.61-7.83 11.58-14.97 17.67-21.42-14.89-12.48-34.41-30.63-52.72-51.7l-1.96-5.89c-.75-2.18-.33-4.28 2.65-5.25l35.58-11.82c12.63 21.91 26.4 41.36 37.35 55.37 7.83-6.27 15.5-11.44 22.61-15.57 1.28 16.2 9.89 29.38 25.78 39.33 7.27 4.52 16.36 7.01 25.6 7.01 15.61 0 35.56-7.51 44.73-28.59.44-1.02.84-2.01 1.2-3 20.21 11.16 43.43 23.87 45.94 24.73 0 0-2 14.96 2.62 27.09Zm29.95 103.57 17.22-3.08-13.32-3.66-11.59-7.55 7.69 14.29Zm-31.52 9.58 21.92 28.31s-18.71 4.28-26.56 2.61c1.79-9.07 4.16-19.82 3.22-30.79l1.43-.14ZM164.52 38.41c25.92-7.69 27.95 5.38 21.44 33.66-1.13 4.92-1.73 9.61-1.82 14.1-6.25-13.14-13.29-29.64-19.63-47.75Z" class="lp-horse"></path><path d="M511.73 159.52c3.23 34.83-22.72 63.53-52.17 63.53-2.54 0-38.78-3.69-38.78-3.69-6.4-.55-10.5-1-4.53 16.77l18.54 55.63c1.24 3.6 1.08 7.16-.49 10.53 0 0-2.28 5.03-8.29 6.96 0 0-74.83 27.2-90.64 27.2-9.58 0-20.86-4.1-22.25-17.46-2.66-25.57 20.49-55.07-16.5-78.05-5.74-3.57-13.03-5.54-20.5-5.54-12.56 0-28.59 5.99-35.91 22.81-12.19 28 12.04 45.7 17.67 65.01 3.78 12.97-1.66 23.12-14.57 27.14-16.15 5.03-107.4 13.29-108 13.36 0 0-11.91 1-14.94-11.38-.17-.72-1.27-97.47-1.27-97.47v-.18c0-6.59-6.83-10.95-12.85-8.3-2.32 1.02-5.13 2.35-8.51 4.08-30.2 15.54-54.48 11.14-72.23-1.43-10.29-7.29-23.03-21.03-25.26-45.08-1.48-17.06 3.97-33.86 14.94-46.13 9.97-10.94 23.46-17.2 37.04-17.2 2.59 0 40.01 3.83 41.01 3.83 5.32 0 7.44-1.6 2.3-16.9L77 71.92c-2.65-7.73 1.49-15.16 8.79-17.48l69.55-23.12c11.37-4.12 25.56-6.31 34.52-.88 10.7 6.47 11.06 18.18 5.51 43.72-9.16 42.17 26.95 54.11 40.33 54.11 27.03 0 51.09-27.9 33.09-59.52 0 0-12.97-21.83-14.86-28.31-3.79-12.97 1.66-23.12 14.57-27.14C277.22 10.59 368.99.9 377.33.02c.44-.05 12.08-.67 14.23 12.4 0 0 1.05 96.41 1.05 96.64-.02 6.58 6.82 10.95 12.85 8.3 2.38-1.05 44.71-28.62 81.02-2.91 10.29 7.29 23.03 21.03 25.25 45.07Zm-118.3 95.67-63.25-97.06c-4.62-12.13-2.62-27.09-2.62-27.09-2.52-.86-25.74-13.57-45.94-24.73-.37.99-.77 1.99-1.2 3-9.17 21.08-29.12 28.59-44.73 28.59-9.24 0-18.33-2.48-25.6-7.01-15.89-9.95-24.5-23.13-25.78-39.33-7.12 4.13-14.79 9.3-22.61 15.57-10.95-14.01-24.72-33.46-37.35-55.37L88.77 63.58c-2.99.96-3.4 3.07-2.65 5.25l1.96 5.89c18.3 21.07 37.83 39.22 52.72 51.7a206.017 206.017 0 0 0-17.67 21.42c-4.72-2.51-9.88-5.38-15.35-8.55.38 11.61-6.54 14.8-14.53 14.8-1.85 0-38.52-3.82-41.01-3.82-.96 0-1.9.05-2.86.13 21.65 9.4 42.59 16.45 58.68 21.06-4.24 8.05-8.06 16.64-11.33 25.8-22.21-1.54-53.7-5.52-84.93-13.78a53.568 53.568 0 0 0-1.95 19.64c1.08 11.6 5.01 20.34 9.79 26.85 26.46.23 51.46-2.04 69.8-4.63-1.29 6.37-2.29 12.97-3 19.79 2.25-.95 4.55-2.01 6.9-3.22 10.89-5.6 18.6-8.44 22.94-8.44 0 0 12.6-.5 12.44 21.44l.96 94c.06 5.73 4.79 5.22 4.79 5.22.96-.1 93.56-9.1 105.96-12.96 10.39-3.23 9.66-10.25 8.2-15.25-5.21-17.87-31.71-38.51-17.25-71.55 1.68-3.85 3.75-7.27 6.1-10.31-7.02-26.04-3.42-53.14-3.42-53.14 1.2 19.28 9.11 34.09 14.98 42.61 16.3-10.41 37.94-9.98 52.68-.75 18.22 11.41 24.34 25.18 25.49 38.63.94 10.97-1.43 21.72-3.22 30.79 7.85 1.66 26.56-2.61 26.56-2.61l-21.92-28.31 41.34 18.06 23.48-34.15ZM185.96 72.07c6.5-28.28 4.47-41.34-21.44-33.66 6.34 18.12 13.38 34.61 19.63 47.750.09-4.49.68-9.18 1.82-14.1Zm178.07 182.89-11.59-7.55 7.69 14.29 17.22-3.08-13.32-3.66Zm-80.69-113.73c.23.53 7.67 17.37 12.41 20.5 4.8 3.17 15.96-1.37 15.96-1.37l-9.34-9.05-19.03-10.08Z"></path></svg>';
