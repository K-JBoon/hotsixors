import { BASES, JOINS, OPS, clause, splitColumn, tableOf } from './model.js';
import { minorOf } from '../query.js';
import { multiSelect } from '../multi-select.js';
import { escapeHtml } from '../view.js';

const LIST_MAX = { string: 600, number: 20, boolean: 2 };

const collator = new Intl.Collator(undefined, { numeric: true });

const order = (col) =>
  col === 'patch' ? (a, b) => collator.compare(b, a) : (a, b) => (typeof a === 'string' ? collator.compare(a, b) : a - b);

const caches = new WeakMap();

/** `{ type, values }` of one column; `values` is empty past `LIST_MAX`. */
export const columnValues = (stats, table, col) => {
  if (!caches.has(stats)) caches.set(stats, new Map());
  const cache = caches.get(stats);
  const key = `${table}.${col}`;
  if (!cache.has(key))
    cache.set(
      key,
      stats.columns(table, [col]).then((cols) => {
        const list = [...new Set(cols[col])].filter((v) => v != null);
        const type = typeof list[0];
        return { type, values: list.length <= (LIST_MAX[type] ?? 0) ? list.sort(order(col)) : [] };
      }),
    );
  return cache.get(key);
};

const coerce = (type, raw) => {
  const t = raw.trim();
  if (t === 'null') return null;
  if (type === 'number' && t && Number.isFinite(Number(t))) return Number(t);
  if (type === 'boolean' && (t === 'true' || t === 'false')) return t === 'true';
  return t;
};

const complete = (c) => (c.op === 'in' ? c.value.length > 0 : c.value !== '');

const columnsOf = (names, from, joins) => [
  ...(names[from] ?? []),
  ...joins.flatMap((j) => (names[JOINS[j]] ?? []).map((c) => `${j}.${c}`)),
];

const emptyValue = (op) => (op === 'in' ? [] : '');

const retype = (prev, next) => {
  if (prev.col !== next.col) return { ...next, value: emptyValue(next.op) };
  if ((prev.op === 'in') === (next.op === 'in')) return next;
  return { ...next, value: next.op === 'in' ? (next.value === '' ? [] : [next.value]) : (next.value[0] ?? '') };
};

const option = (value, label, selected) =>
  `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;

const printed = (v) => (v == null ? 'null' : String(v));

const fromField = (from) =>
  `<div class="stats-filters__field"><span id="qb-from">Table</span><div class="segmented" role="radiogroup" aria-labelledby="qb-from">${Object.keys(
    BASES,
  )
    .map(
      (b) =>
        `<label class="segmented__btn"><input type="radio" name="from" value="${b}"${b === from ? ' checked' : ''}> ${b}</label>`,
    )
    .join('')}</div></div>`;

const joinField = () =>
  `<div class="stats-filters__field"><span id="qb-joins">Join</span><div data-multi="joins" aria-labelledby="qb-joins"></div></div>`;

const valueControl = (c, i) =>
  c.op === 'in'
    ? `<div data-multi="w${i}" aria-label="Values"></div>`
    : `<input class="input" name="w${i}" value="${escapeHtml(c.value === '' ? '' : printed(c.value))}" list="qb-list-${i}" aria-label="Value" autocomplete="off"><datalist id="qb-list-${i}"></datalist>`;

const clauseRow = (columns) => (c, i) => {
  const cols = columns.includes(c.col) ? columns : [c.col, ...columns];
  return `<div class="stats-query__clause" data-clause="${i}"><select class="input" name="c${i}" aria-label="Column">${cols
    .map((col) => option(col, col, col === c.col))
    .join('')}</select><select class="input" name="o${i}" aria-label="Operator">${OPS.map((op) => option(op, op, op === c.op)).join(
    '',
  )}</select>${valueControl(c, i)}<button class="btn stats-query__btn" type="button" data-remove="${i}" aria-label="Remove">×</button></div>`;
};

/**
 * Form for the base table, joins and where clauses of a query. `show(q)` draws
 * it; edits call `onChange({ from, joins, where })`. Rows without a value stay
 * in the form only. `values(table, col)` resolves to `columnValues`.
 */
export function builderForm(el, { names, values, label = (col, v) => printed(v), onChange }) {
  let state = { from: 'players', joins: [], rows: [] };
  const valuesOf = (ref) => {
    const { join, col } = splitColumn(ref);
    return values(tableOf(state.from, join), col);
  };

  const fillValues = (c, i) => {
    const picker = c.op === 'in' ? multiSelect(el.querySelector(`[data-multi="w${i}"]`), { allLabel: 'Pick' }) : null;
    picker?.setOptions(c.value.map((v) => ({ value: v, label: v })), c.value);
    return valuesOf(c.col).then(({ values: list }) => {
      const { col } = splitColumn(c.col);
      const opts = list.map((v) => ({ value: printed(v), label: label(col, v) }));
      if (!picker) {
        el.querySelector(`#qb-list-${i}`).innerHTML = opts.map((o) => option(o.value, o.label)).join('');
        return;
      }
      const minors = col === 'patch' && list.length;
      picker.setOptions(
        minors ? opts.map((o) => ({ ...o, group: minorOf(o.value) })) : opts,
        c.value,
        minors ? Object.fromEntries(list.map((p) => [minorOf(p), `${minorOf(p)}.x`])) : {},
      );
    });
  };

  const draw = () => {
    const columns = columnsOf(names, state.from, state.joins);
    el.innerHTML = `${fromField(state.from)}${joinField()}${state.rows.map(clauseRow(columns)).join('')}<button class="btn stats-query__btn" type="button" data-add>+ Where</button>`;
    multiSelect(el.querySelector('[data-multi="joins"]'), { allLabel: 'None' }).setOptions(
      BASES[state.from].map((j) => ({ value: j, label: j })),
      state.joins,
    );
    state.rows.forEach(fillValues);
  };

  const read = () => {
    const data = new FormData(el);
    const from = String(data.get('from') ?? state.from);
    const rows = state.rows.map((prev, i) => {
      const raw = prev.op === 'in' ? data.getAll(`w${i}`).map(String) : String(data.get(`w${i}`) ?? '');
      return retype(prev, clause(String(data.get(`c${i}`)), String(data.get(`o${i}`)), raw));
    });
    return { from, joins: data.getAll('joins').map(String), rows };
  };

  const normalize = ({ from, joins, rows }) => {
    const allowed = joins.filter((j) => BASES[from].includes(j));
    const columns = columnsOf(names, from, allowed);
    return { from, joins: allowed, rows: rows.filter((c) => columns.includes(c.col)) };
  };

  const shape = (s) => JSON.stringify([s.from, s.joins, s.rows.map((c) => [c.col, c.op])]);

  const typed = (c) =>
    valuesOf(c.col).then(({ type }) => ({
      ...c,
      value: c.op === 'in' ? c.value.map((v) => coerce(type, v)) : coerce(type, c.value),
    }));

  const emit = async () => {
    const snapshot = state;
    const where = await Promise.all(snapshot.rows.filter(complete).map(typed));
    if (snapshot === state) onChange({ from: state.from, joins: state.joins, where });
  };

  const update = (next) => {
    const reshaped = shape(next) !== shape(state);
    state = reshaped ? normalize(next) : next;
    if (reshaped) draw();
    emit();
  };

  el.addEventListener('change', () => update(read()));
  let timer;
  el.addEventListener('input', (e) => {
    if (!e.target.matches('input[list]')) return;
    clearTimeout(timer);
    timer = setTimeout(() => update(read()), 300);
  });
  el.addEventListener('submit', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add], [data-remove]');
    if (!btn) return;
    const current = read();
    if (btn.dataset.add != null) {
      const col = columnsOf(names, current.from, current.joins)[0];
      state = { ...current, rows: [...current.rows, clause(col, '=', '')] };
      draw();
      return;
    }
    const i = Number(btn.dataset.remove);
    state = { ...current, rows: current.rows.filter((_, j) => j !== i) };
    draw();
    emit();
  });

  return {
    show(q) {
      state = normalize({ from: q.from, joins: q.joins, rows: q.where.map((c) => ({ ...c, value: c.op === 'in' ? c.value.map(printed) : printed(c.value) })) });
      draw();
    },
  };
}
