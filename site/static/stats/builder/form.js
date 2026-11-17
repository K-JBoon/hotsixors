import {
  BASES,
  JOINS,
  MAX_GROUPS,
  MEASURES,
  OPS,
  VIEWS,
  WRAPPERS,
  clause,
  fn,
  measure,
  paramType,
  splitColumn,
  tableOf,
} from './model.js';
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

const radios = (name, values, checked, aria) =>
  `<div class="segmented" role="radiogroup" ${aria}>${values
    .map((v) => `<label class="segmented__btn"><input type="radio" name="${name}" value="${v}"${v === checked ? ' checked' : ''}> ${v}</label>`)
    .join('')}</div>`;

const radioField = (name, label, values, checked) =>
  `<div class="stats-filters__field"><span id="qb-${name}">${label}</span>${radios(name, values, checked, `aria-labelledby="qb-${name}"`)}</div>`;

const DIRS = ['desc', 'asc'];

const sortField = (keys, sort, colOption, group) =>
  `<div class="stats-filters__field"><span id="qb-sort">Sort</span><div class="stats-query__clause"><select class="input" name="sort" aria-labelledby="qb-sort">${option(
    '',
    'None',
    !sort,
  )}${keys.map((k) => (group.includes(k) ? colOption(k, k === sort?.by) : option(k, k, k === sort?.by))).join('')}</select>${radios(
    'dir',
    DIRS,
    sort?.dir ?? 'desc',
    'aria-label="Direction"',
  )}</div></div>`;

const limitField = (limit) =>
  `<div class="stats-filters__field"><span id="qb-limit">Limit</span><input class="input stats-filters__min" aria-labelledby="qb-limit" type="number" min="1" name="limit" value="${
    limit ?? ''
  }" placeholder="All"></div>`;

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

const TOPS = [...KINDS, ...WRAPPERS];

const topOf = (m) => m.wrap ?? m.kind;

const NAME = /^[A-Za-z_]\w*$/;

const named = (m, i, all) => NAME.test(m.name) && all.findIndex((o) => o.name === m.name) === i;

const sortKeys = ({ measures, group }) => [...measures.filter(named).map((m) => m.name), ...group];

const pruneSort = (s) => ({ ...s, sort: s.sort && sortKeys(s).includes(s.sort.by) ? s.sort : null });

const readLimit = (raw) => (raw.trim() === '' ? null : Number(raw));

const autoName = (kind, taken) =>
  [kind, ...Array.from({ length: taken.length + 1 }, (_, n) => `${kind}${n + 2}`)].find((n) => !taken.includes(n));

const isAuto = (name, kind) => new RegExp(`^${kind}\\d*$`).test(name);

const columnBefore = (kind, args, j) => args.slice(0, j).findLast((_, k) => paramType(kind, k) === 'col');

const argColumns = (m) => m.args.filter((_, j) => paramType(m.kind, j) === 'col');

const retypeArgs = (columns) => (prev, next) => {
  if (prev.kind === next.kind)
    return next.args.map((a, j) =>
      paramType(next.kind, j) === 'value' && columnBefore(next.kind, next.args, j) !== columnBefore(prev.kind, prev.args, j) ? '' : a,
    );
  const cols = argColumns({ kind: prev.kind, args: next.args });
  return MEASURES[next.kind].params.map((_, j) => {
    const type = paramType(next.kind, j);
    if (type === paramType(prev.kind, j)) return next.args[j];
    return type === 'col' ? (cols[0] ?? columns[0]) : '';
  });
};

const renamed = (prev, next, taken) =>
  topOf(prev) !== topOf(next) && isAuto(next.name, topOf(prev)) ? autoName(topOf(next), taken) : next.name;

const formArgs = (m) =>
  MEASURES[m.kind].params.map((_, j) => {
    const a = m.args?.[j];
    return paramType(m.kind, j) === 'col' ? a : a === undefined ? '' : printed(a);
  });

const formRows = (where) => where.map((c) => ({ ...c, value: c.op === 'in' ? c.value.map(printed) : printed(c.value) }));

const formMeasure = (m) => {
  const wrap = WRAPPERS.includes(m.kind) ? m.kind : null;
  const inner = wrap ? m.args?.[0] : m;
  if (!KINDS.includes(inner?.kind)) return null;
  return { name: m.name, wrap, kind: inner.kind, args: formArgs(inner), where: formRows(inner.where ?? []) };
};

const keyOf = (of) => (of == null ? '' : `m${of}-`);

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
  return `<input class="input stats-filters__min" type="number" name="${at}" value="${escapeHtml(a)}" placeholder="${placeholder}" aria-label="Scale">`;
};

const valueControl = (c, at) =>
  c.op === 'in'
    ? `<div data-multi="w${at}" aria-label="Values"></div>`
    : `<input class="input" name="w${at}" value="${escapeHtml(c.value === '' ? '' : printed(c.value))}" list="qb-list-${at}" aria-label="Value" autocomplete="off"><datalist id="qb-list-${at}"></datalist>`;

const ofAttr = (of) => (of == null ? '' : ` data-of="${of}"`);

const clauseRow = (columns, colOption, of) => (c, i) => {
  const at = `${keyOf(of)}${i}`;
  const cols = columns.includes(c.col) ? columns : [c.col, ...columns];
  return `<div class="stats-query__clause" data-clause="${at}"><select class="input" name="c${at}" aria-label="Column">${cols
    .map((col) => colOption(col, col === c.col))
    .join('')}</select><select class="input" name="o${at}" aria-label="Operator">${OPS.map((op) => option(op, op, op === c.op)).join(
    '',
  )}</select>${valueControl(c, at)}<button class="btn stats-query__btn" type="button" data-remove="${i}"${ofAttr(of)} aria-label="Remove">×</button></div>`;
};

const measureRow = (columns, colOption) => (m, i) =>
  `<div class="stats-query__clause" data-measure="${i}"><input class="input stats-query__name" name="mn${i}" value="${escapeHtml(
    m.name,
  )}" aria-label="Name" autocomplete="off" spellcheck="false"><select class="input" name="mk${i}" aria-label="Measure">${TOPS.map((k) =>
    option(k, k, k === topOf(m)),
  ).join('')}</select>${
    m.wrap ? `<select class="input" name="mi${i}" aria-label="Inner measure">${KINDS.map((k) => option(k, k, k === m.kind)).join('')}</select>` : ''
  }${m.args
    .map(argControl(columns, colOption, m, i))
    .join('')}<button class="btn stats-query__btn" type="button" data-add="where" data-of="${i}">+ Where</button><button class="btn stats-query__btn" type="button" data-remove-measure="${i}" aria-label="Remove">×</button></div>${m.where
    .map(clauseRow(columns, colOption, i))
    .join('')}`;

/**
 * Form for every part of a query. `show(q)` draws it; edits call
 * `onChange({ from, joins, where, group, measures, sort, limit, view })`.
 * Where rows without a value and measures without a valid unique name stay in
 * the form only. `values(table, col)` resolves to `columnValues`.
 */
export function builderForm(el, { names, values, label = (col, v) => printed(v), columnLabel = (col) => col, onChange }) {
  let state = { from: 'players', joins: [], rows: [], group: [], measures: [], sort: null, limit: null, view: 'table' };
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

  const fillValues = (of) => (c, i) => {
    const at = `${keyOf(of)}${i}`;
    if (c.op !== 'in') return fillList(`qb-list-${at}`, c.col);
    const picker = multiSelect(el.querySelector(`[data-multi="w${at}"]`), { allLabel: 'Pick' });
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

  const fillMeasure = (m, i) => {
    m.args.forEach((_, j) => paramType(m.kind, j) === 'value' && fillList(`qb-mlist-${i}-${j}`, columnBefore(m.kind, m.args, j)));
    m.where.forEach(fillValues(i));
  };

  const draw = () => {
    const columns = columnsOf(names, state.from, state.joins);
    el.innerHTML = `${radioField('from', 'Table', Object.keys(BASES), state.from)}${joinField()}${groupField(columns, state.group, colOption)}${state.rows
      .map(clauseRow(columns, colOption))
      .join('')}<button class="btn stats-query__btn" type="button" data-add="where">+ Where</button><div class="stats-filters__field stats-query__measures"><span>Measure</span>${state.measures
      .map(measureRow(columns, colOption))
      .join('')}<button class="btn stats-query__btn" type="button" data-add="measure">+ Measure</button></div>${sortField(
      sortKeys(state),
      state.sort,
      colOption,
      state.group,
    )}${limitField(state.limit)}${radioField('view', 'View', VIEWS, state.view)}`;
    multiSelect(el.querySelector('[data-multi="joins"]'), { allLabel: 'None' }).setOptions(
      BASES[state.from].map((j) => ({ value: j, label: j })),
      state.joins,
    );
    state.rows.forEach(fillValues(null));
    state.measures.forEach(fillMeasure);
  };

  const readRows = (data, rows, of) =>
    rows.map((prev, i) => {
      const at = `${keyOf(of)}${i}`;
      const raw = prev.op === 'in' ? data.getAll(`w${at}`).map(String) : String(data.get(`w${at}`) ?? '');
      return retype(prev, clause(String(data.get(`c${at}`)), String(data.get(`o${at}`)), raw));
    });

  const readMeasures = (data, columns) => {
    const read = state.measures.map((prev, i) => {
      const top = String(data.get(`mk${i}`) ?? topOf(prev));
      const wrap = WRAPPERS.includes(top) ? top : null;
      return {
        ...prev,
        name: String(data.get(`mn${i}`) ?? '').trim(),
        wrap,
        kind: wrap ? String(data.get(`mi${i}`) ?? prev.kind) : top,
        args: prev.args.map((_, j) => String(data.get(`ma${i}.${j}`) ?? '')),
        where: readRows(data, prev.where, i),
      };
    });
    return read.map((next, i) => {
      const prev = state.measures[i];
      const taken = read.filter((_, k) => k !== i).map((m) => m.name);
      return { ...next, name: renamed(prev, next, taken), args: retypeArgs(columns)(prev, next) };
    });
  };

  const read = () => {
    const data = new FormData(el);
    const from = String(data.get('from') ?? state.from);
    const rows = readRows(data, state.rows, null);
    const group = groupSlots(state.group).map((_, i) => String(data.get(`g${i}`) ?? '')).filter(Boolean);
    const joins = data.getAll('joins').map(String);
    const measures = readMeasures(data, columnsOf(names, from, joins));
    const by = String(data.get('sort') ?? '');
    const at = state.measures.findIndex((m) => m.name === by);
    return {
      from,
      joins,
      rows,
      group,
      measures,
      sort: by ? { by: at < 0 ? by : measures[at].name, dir: String(data.get('dir') ?? 'desc') } : null,
      limit: readLimit(String(data.get('limit') ?? '')),
      view: String(data.get('view') ?? state.view),
    };
  };

  const normalize = ({ from, joins, rows, group, measures, ...rest }) => {
    const allowed = joins.filter((j) => BASES[from].includes(j));
    const columns = columnsOf(names, from, allowed);
    return pruneSort({
      ...rest,
      from,
      joins: allowed,
      rows: rows.filter((c) => columns.includes(c.col)),
      group: [...new Set(group)].filter((g) => columns.includes(g)).slice(0, MAX_GROUPS),
      measures: measures
        .filter((m) => argColumns(m).every((c) => columns.includes(c)))
        .map((m) => ({ ...m, where: m.where.filter((c) => columns.includes(c.col)) })),
    });
  };

  const rowsShape = (rows) => rows.map((c) => [c.col, c.op]);

  const measureShape = (m) => [m.wrap, m.kind, argColumns(m), rowsShape(m.where)];

  const shape = (s) => JSON.stringify([s.from, s.joins, rowsShape(s.rows), s.group, s.measures.map(measureShape), sortKeys(s)]);

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

  const typedRows = (rows) => Promise.all(rows.filter(complete).map(typed));

  const typedMeasure = async (m) => {
    const [args, where] = await Promise.all([Promise.all(m.args.map(typedArg(m))), typedRows(m.where)]);
    const inner = fn(m.kind, trimArgs(args), where);
    return measure(m.name, m.wrap ? fn(m.wrap, [inner]) : inner);
  };

  const emit = async () => {
    const snapshot = state;
    const [where, measures] = await Promise.all([
      typedRows(snapshot.rows),
      Promise.all(snapshot.measures.filter(named).map(typedMeasure)),
    ]);
    if (snapshot === state) {
      const { from, joins, group, sort, limit, view } = state;
      onChange({ from, joins, where, group, measures, sort, limit, view });
    }
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
    const { add, remove, removeMeasure, of } = btn.dataset;
    const withRows = (f) =>
      of == null
        ? { ...current, rows: f(current.rows) }
        : { ...current, measures: current.measures.map((m, k) => (k === Number(of) ? { ...m, where: f(m.where) } : m)) };
    if (add === 'where') {
      const col = columnsOf(names, current.from, current.joins)[0];
      state = withRows((rows) => [...rows, clause(col, '=', '')]);
    } else if (add === 'measure') {
      const name = autoName('count', current.measures.map((m) => m.name));
      state = { ...current, measures: [...current.measures, { name, wrap: null, kind: 'count', args: [], where: [] }] };
    } else if (remove != null) {
      state = withRows((rows) => rows.filter((_, j) => j !== Number(remove)));
    } else {
      state = pruneSort({ ...current, measures: current.measures.filter((_, j) => j !== Number(removeMeasure)) });
    }
    draw();
    if (add !== 'where') emit();
  });

  return {
    show(q) {
      clearTimeout(timer);
      state = normalize({
        from: q.from,
        joins: q.joins,
        rows: formRows(q.where),
        group: q.group,
        measures: q.measures.map(formMeasure).filter(Boolean),
        sort: q.sort,
        limit: q.limit,
        view: q.view,
      });
      draw();
    },
  };
}
