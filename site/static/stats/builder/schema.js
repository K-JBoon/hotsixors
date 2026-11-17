import { escapeHtml } from '../view.js';
import { BASES, JOINS } from './model.js';
import { TABLE_DOCS, JOIN_DOCS, SCORE_DOC, SCORE_LABELS, SCORE_PREFIX, isScore, columnDoc } from './docs.js';

const ORDER = ['players', 'draft', 'games'];

const code = (s) => `<code>${escapeHtml(s)}</code>`;

const columnList = (rows) =>
  `<dl class="stats-query__cols">${rows.map(([col, doc]) => `<dt>${code(col)}</dt><dd>${escapeHtml(doc ?? '')}</dd>`).join('')}</dl>`;

const scoreList = (cols) =>
  cols.length
    ? `<details><summary>${code(`${SCORE_PREFIX}*`)} <span class="stats-note">${cols.length} · ${escapeHtml(SCORE_DOC)}</span></summary>${columnList(cols.map((c) => [c, SCORE_LABELS.get(c)]))}</details>`
    : '';

const joinItem = (join) =>
  `<li data-join="${join}">${code(`JOIN ${join}`)} → <button class="btn btn--sm" type="button" data-goto="${JOINS[join]}">${JOINS[join]}</button><span class="stats-note">${code(`${join}.<column>`)} ${escapeHtml(JOIN_DOCS[join])}</span></li>`;

const tableBox = (table, cols) => {
  const plain = cols.filter((c) => !isScore(c));
  const joins = BASES[table] ?? [];
  return `<div class="card stats-query__table" data-table="${table}">
    <details><summary>${code(table)} <span class="stats-note">${escapeHtml(TABLE_DOCS[table])}</span></summary>${columnList(plain.map((c) => [c, columnDoc(table, c)]))}${scoreList(cols.filter(isScore))}</details>
    ${joins.length ? `<ul class="stats-query__joins">${joins.map(joinItem).join('')}</ul>` : ''}
  </div>`;
};

const current = (node, on) => {
  node.classList.toggle('is-active', on);
  if (on) node.setAttribute('aria-current', 'true');
  else node.removeAttribute('aria-current');
};

const markRail = (el) => ({ from, joins }) => {
  el.querySelectorAll('[data-table]').forEach((box) => {
    const base = box.dataset.table === from;
    current(box, base);
    box.querySelectorAll('[data-join]').forEach((item) => {
      current(item, base && joins.includes(item.dataset.join));
      item.classList.toggle('is-thin', !base);
    });
  });
};

/** Schema reference for the Query tab rail; `names` is the tableNames output. Returns `mark(query)`. */
export function schemaRail(el, names) {
  el.innerHTML = ORDER.map((t) => tableBox(t, names[t] ?? [])).join('');
  el.addEventListener('click', (e) => {
    const target = e.target.closest('[data-goto]')?.dataset.goto;
    const box = target && el.querySelector(`[data-table="${target}"]`);
    if (!box) return;
    box.querySelector('details').open = true;
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  return markRail(el);
}
