import {
  BASES,
  JOINS,
  MAX_GROUPS,
  MEASURES,
  OPS,
  WRAPPERS,
  clause,
  fn,
  measure,
  measureColumns,
  paramType,
  splitColumn,
  tableOf,
} from './model.js';
import { printCall } from './text.js';
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

const columnOption = (columnLabel) => (ref, selected) => {
  const { join, col } = splitColumn(ref);
  return option(ref, join ? `${join}.${columnLabel(col)}` : columnLabel(col), selected);
};

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

const groupSlots = (group) => (group.length < MAX_GROUPS ? [...group, ''] : group);

const groupField = (columns, group, colOption) =>
  `<div class="stats-filters__field"><span id="qb-group">Group</span><div class="stats-query__clause stats-query__group">${groupSlots(group)
    .map(
      (g, i) =>
        `<select class="input" name="g${i}" aria-labelledby="qb-group">${option('', 'None', !g)}${columns
          .map((col) => colOption(col, col === g))
          .join('')}</select>`,
    )
    .join('')}</div></div>`;

const KINDS = Object.keys(MEASURES).filter((k) => !WRAPPERS.includes(k));

const NAME = /^[A-Za-z_]\w*$/;

const autoName = (kind, taken) =>
  [kind, ...Array.from({ length: taken.length + 1 }, (_, n) => `${kind}${n + 2}`)].find((n) => !taken.includes(n));

const isAuto = (name, kind) => new RegExp(`^${kind}\\d*$`).test(name);

const columnBefore = (kind, args, j) => args.slice(0, j).findLast((_, k) => paramType(kind, k) === 'col');

const retypeMeasure = (columns, taken) => (prev, next) => {
  if (prev.kind === next.kind)
    return {
      ...next,
      args: next.args.map((a, j) =>
        paramType(next.kind, j) === 'value' && columnBefore(next.kind, next.args, j) !== columnBefore(prev.kind, prev.args, j) ? '' : a,
      ),
    };
  const cols = next.args.filter((_, j) => paramType(prev.kind, j) === 'col');
  return {
    ...next,
    name: isAuto(next.name, prev.kind) ? autoName(next.kind, taken) : next.name,
    args: MEASURES[next.kind].params.map((_, j) => {
      const type = paramType(next.kind, j);
      if (type === paramType(prev.kind, j)) return next.args[j];
      return type === 'col' ? (cols[0] ?? columns[0]) : '';
    }),
  };
};

const formArgs = (m) =>
  MEASURES[m.kind].params.map((_, j) => {
    const a = m.args?.[j];
    const type = paramType(m.kind, j);
    return type === 'col' || type === 'measure' ? a : a === undefined ? '' : printed(a);
  });

const trimArgs = (args) => args.slice(0, args.findLastIndex((a) => a !== undefined) + 1);

const argControl = (columns, colOption, m, i) => (a, j) => {
  const type = paramType(m.kind, j);
  const at = `ma${i}.${j}`;
  const placeholder = MEASURES[m.kind].params[j].endsWith('?') ? { value: 'true', number: '1' }[type] : '';
  if (type === 'col') {
    const cols = columns.includes(a) ? columns : [a, ...columns];
    return `<select class="input" name="${at}" aria-label="Column">${cols.map((col) => colOption(col, col === a)).join('')}</select>`;
  }
  if (type === 'value')
    return `<input class="input" name="${at}" value="${escapeHtml(a)}" placeholder="${placeholder}" list="qb-mlist-${i}-${j}" aria-label="Value" autocomplete="off"><datalist id="qb-mlist-${i}-${j}"></datalist>`;
  if (type === 'number')
    return `<input class="input stats-filters__min" type="number" name="${at}" value="${escapeHtml(a)}" placeholder="${placeholder}" aria-label="Scale">`;
  return `<input class="input" value="${escapeHtml(printCall(a))}" aria-label="Measure" disabled>`;
};

const measureRow = (columns, colOption) => (m, i) => {
  const kinds = KINDS.includes(m.kind) ? KINDS : [m.kind, ...KINDS];
  return `<div class="stats-query__clause" data-measure="${i}"><input class="input stats-query__name" name="mn${i}" value="${escapeHtml(
    m.name,
  )}" aria-label="Name" autocomplete="off" spellcheck="false"><select class="input" name="mk${i}" aria-label="Measure">${kinds
    .map((k) => option(k, k, k === m.kind))
    .join('')}</select>${m.args
    .map(argControl(columns, colOption, m, i))
    .join('')}<button class="btn stats-query__btn" type="button" data-remove-measure="${i}" aria-label="Remove">×</button></div>`;
};

const valueControl = (c, i) =>
  c.op === 'in'
    ? `<div data-multi="w${i}" aria-label="Values"></div>`
    : `<input class="input" name="w${i}" value="${escapeHtml(c.value === '' ? '' : printed(c.value))}" list="qb-list-${i}" aria-label="Value" autocomplete="off"><datalist id="qb-list-${i}"></datalist>`;

const clauseRow = (columns, colOption) => (c, i) => {
  const cols = columns.includes(c.col) ? columns : [c.col, ...columns];
  return `<div class="stats-query__clause" data-clause="${i}"><select class="input" name="c${i}" aria-label="Column">${cols
    .map((col) => colOption(col, col === c.col))
    .join('')}</select><select class="input" name="o${i}" aria-label="Operator">${OPS.map((op) => option(op, op, op === c.op)).join(
    '',
  )}</select>${valueControl(c, i)}<button class="btn stats-query__btn" type="button" data-remove="${i}" aria-label="Remove">×</button></div>`;
};

/**
 * Form for the base table, joins, where clauses, group-by columns and measures
 * of a query. `show(q)` draws it; edits call `onChange({ from, joins, where, group, measures })`.
 * Where rows without a value and measures without a valid unique name stay in
 * the form only. `values(table, col)` resolves to `columnValues`.
 */
export function builderForm(el, { names, values, label = (col, v) => printed(v), columnLabel = (col) => col, onChange }) {
  let state = { from: 'players', joins: [], rows: [], group: [], measures: [] };
  const colOption = columnOption(columnLabel);
  const valuesOf = (ref) => {
    const { join, col } = splitColumn(ref);
    return values(tableOf(state.from, join), col);
  };

  const optionsOf = (ref) =>
    valuesOf(ref).then(({ values: list }) => {
      const { col } = splitColumn(ref);
      return { list, col, opts: list.map((v) => ({ value: printed(v), label: label(col, v) })) };
    });

  const fillList = (id, ref) =>
    optionsOf(ref).then(({ opts }) => {
      el.querySelector(`#${id}`).innerHTML = opts.map((o) => option(o.value, o.label)).join('');
    });

  const fillValues = (c, i) => {
    if (c.op !== 'in') return fillList(`qb-list-${i}`, c.col);
    const picker = multiSelect(el.querySelector(`[data-multi="w${i}"]`), { allLabel: 'Pick' });
    picker.setOptions(c.value.map((v) => ({ value: v, label: v })), c.value);
    return optionsOf(c.col).then(({ list, col, opts }) => {
      const minors = col === 'patch' && list.length;
      picker.setOptions(
        minors ? opts.map((o) => ({ ...o, group: minorOf(o.value) })) : opts,
        c.value,
        minors ? Object.fromEntries(list.map((p) => [minorOf(p), `${minorOf(p)}.x`])) : {},
      );
    });
  };

  const fillMeasure = (m, i) =>
    m.args.forEach((_, j) => paramType(m.kind, j) === 'value' && fillList(`qb-mlist-${i}-${j}`, columnBefore(m.kind, m.args, j)));

  const draw = () => {
    const columns = columnsOf(names, state.from, state.joins);
    el.innerHTML = `${fromField(state.from)}${joinField()}${groupField(columns, state.group, colOption)}${state.rows
      .map(clauseRow(columns, colOption))
      .join('')}<button class="btn stats-query__btn" type="button" data-add="where">+ Where</button><div class="stats-filters__field stats-query__measures"><span>Measure</span>${state.measures
      .map(measureRow(columns, colOption))
      .join('')}<button class="btn stats-query__btn" type="button" data-add="measure">+ Measure</button></div>`;
    multiSelect(el.querySelector('[data-multi="joins"]'), { allLabel: 'None' }).setOptions(
      BASES[state.from].map((j) => ({ value: j, label: j })),
      state.joins,
    );
    state.rows.forEach(fillValues);
    state.measures.forEach(fillMeasure);
  };

  const readMeasures = (data, columns) => {
    const read = state.measures.map((prev, i) => ({
      ...prev,
      name: String(data.get(`mn${i}`) ?? '').trim(),
      kind: String(data.get(`mk${i}`) ?? prev.kind),
      args: prev.args.map((a, j) => (paramType(prev.kind, j) === 'measure' ? a : String(data.get(`ma${i}.${j}`) ?? ''))),
    }));
    return read.map((next, i) =>
      retypeMeasure(columns, read.filter((_, k) => k !== i).map((m) => m.name))(state.measures[i], next),
    );
  };

  const read = () => {
    const data = new FormData(el);
    const from = String(data.get('from') ?? state.from);
    const rows = state.rows.map((prev, i) => {
      const raw = prev.op === 'in' ? data.getAll(`w${i}`).map(String) : String(data.get(`w${i}`) ?? '');
      return retype(prev, clause(String(data.get(`c${i}`)), String(data.get(`o${i}`)), raw));
    });
    const group = groupSlots(state.group).map((_, i) => String(data.get(`g${i}`) ?? '')).filter(Boolean);
    const joins = data.getAll('joins').map(String);
    return { from, joins, rows, group, measures: readMeasures(data, columnsOf(names, from, joins)) };
  };

  const normalize = ({ from, joins, rows, group, measures }) => {
    const allowed = joins.filter((j) => BASES[from].includes(j));
    const columns = columnsOf(names, from, allowed);
    return {
      from,
      joins: allowed,
      rows: rows.filter((c) => columns.includes(c.col)),
      group: [...new Set(group)].filter((g) => columns.includes(g)).slice(0, MAX_GROUPS),
      measures: measures.filter((m) => MEASURES[m.kind] && measureColumns(m).every((c) => columns.includes(c))),
    };
  };

  const measureShape = (m) => [m.kind, m.args.filter((_, j) => paramType(m.kind, j) === 'col')];

  const shape = (s) =>
    JSON.stringify([s.from, s.joins, s.rows.map((c) => [c.col, c.op]), s.group, s.measures.map(measureShape)]);

  const typed = (c) =>
    valuesOf(c.col).then(({ type }) => ({
      ...c,
      value: c.op === 'in' ? c.value.map((v) => coerce(type, v)) : coerce(type, c.value),
    }));

  const typedArg = (m) => (a, j) => {
    const type = paramType(m.kind, j);
    if (type === 'number') return a.trim() === '' ? undefined : Number(a);
    if (type !== 'value') return a;
    return a.trim() === '' ? undefined : valuesOf(columnBefore(m.kind, m.args, j)).then(({ type: t }) => coerce(t, a));
  };

  const typedMeasure = async (m) => measure(m.name, fn(m.kind, trimArgs(await Promise.all(m.args.map(typedArg(m)))), m.where));

  const named = (m, i, all) => NAME.test(m.name) && all.findIndex((o) => o.name === m.name) === i;

  const emit = async () => {
    const snapshot = state;
    const [where, measures] = await Promise.all([
      Promise.all(snapshot.rows.filter(complete).map(typed)),
      Promise.all(snapshot.measures.filter(named).map(typedMeasure)),
    ]);
    if (snapshot === state) onChange({ from: state.from, joins: state.joins, where, group: state.group, measures });
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
    const btn = e.target.closest('[data-add], [data-remove], [data-remove-measure]');
    if (!btn) return;
    const current = read();
    const { add, remove, removeMeasure } = btn.dataset;
    if (add === 'where') {
      const col = columnsOf(names, current.from, current.joins)[0];
      state = { ...current, rows: [...current.rows, clause(col, '=', '')] };
    } else if (add === 'measure') {
      const name = autoName('count', current.measures.map((m) => m.name));
      state = { ...current, measures: [...current.measures, { name, kind: 'count', args: [], where: [] }] };
    } else if (remove != null) {
      state = { ...current, rows: current.rows.filter((_, j) => j !== Number(remove)) };
    } else {
      state = { ...current, measures: current.measures.filter((_, j) => j !== Number(removeMeasure)) };
    }
    draw();
    if (add !== 'where') emit();
  });

  return {
    show(q) {
      state = normalize({
        from: q.from,
        joins: q.joins,
        rows: q.where.map((c) => ({ ...c, value: c.op === 'in' ? c.value.map(printed) : printed(c.value) })),
        group: q.group,
        measures: q.measures
          .filter((m) => MEASURES[m.kind])
          .map((m) => ({ name: m.name, kind: m.kind, args: formArgs(m), where: m.where ?? [] })),
      });
      draw();
    },
  };
}
