import { count, present, sum, mean, rate, distinct, ratio, mode, latest, minorOf } from '../query.js';

export const BASES = { players: ['game', 'teammate', 'opponent'], draft: ['game'] };

export const JOINS = { game: 'games', teammate: 'players', opponent: 'players' };

export const VIEWS = ['table', 'bar', 'line', 'scatter', 'heatmap'];

export const OPS = ['=', '!=', 'in', '<', '<=', '>', '>='];

export const MAX_GROUPS = 2;

/**
 * Param types: `col` column ref, `value` literal, `number` literal, `measure` inner measure. `?` marks optional.
 * `sized` measures yield `{ value, n }`, `n` being the rows with every `col` argument non-null.
 */
export const MEASURES = {
  count: { params: [], make: count },
  present: { params: ['col'], make: present },
  sum: { params: ['col'], make: sum },
  mean: { params: ['col'], make: mean, sized: true },
  rate: { params: ['col', 'value?'], make: rate, sized: true },
  distinct: { params: ['col'], make: distinct },
  ratio: { params: ['col', 'col', 'number?'], make: ratio, sized: true },
  mode: { params: ['col'], make: mode },
  latest: { params: ['col', 'col'], make: latest },
  share: { params: ['measure'] },
  delta: { params: ['measure'] },
};

export const WRAPPERS = ['share', 'delta'];

export const clause = (col, op, value) => ({ col, op, value });

export const fn = (kind, args = [], where = []) => ({ kind, args, where });

export const measure = (name, inner) => ({ name, ...inner });

export const query = ({
  from = 'players',
  joins = [],
  where = [],
  group = [],
  measures = [],
  sort = null,
  limit = null,
  view = 'table',
} = {}) => ({ from, joins, where, group, measures, sort, limit, view });

/** `opponent.hero` -> `{ join: 'opponent', col: 'hero' }`; unprefixed refs read the base table. */
export const splitColumn = (ref) => {
  const dot = ref.indexOf('.');
  return dot < 0 ? { join: null, col: ref } : { join: ref.slice(0, dot), col: ref.slice(dot + 1) };
};

export const tableOf = (from, join) => (join ? JOINS[join] : from);

const paramType = (kind, i) => MEASURES[kind]?.params[i]?.replace('?', '');

const measureColumns = (m) => [
  ...(m.args ?? []).flatMap((a, i) => {
    const type = paramType(m.kind, i);
    return type === 'col' ? [a] : type === 'measure' ? measureColumns(a) : [];
  }),
  ...(m.where ?? []).map((c) => c.col),
];

/** Column refs a query reads, without duplicates. */
export const queryColumns = (q) => [
  ...new Set([...q.where.map((c) => c.col), ...q.group, ...q.measures.flatMap(measureColumns)]),
];

const COMPARE = {
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
};

/** Value predicate for one where clause. Patch `2.55` also matches `2.55.x`. */
export const clauseTest = ({ col, op, value }) => {
  if (COMPARE[op]) return (v) => v != null && COMPARE[op](v, value);
  const set = new Set(op === 'in' ? value : [value]);
  const minor = splitColumn(col).col === 'patch';
  const hit = (v) => set.has(v) || (minor && v != null && set.has(minorOf(v)));
  return op === '!=' ? (v) => !hit(v) : hit;
};

const SORT_DIRS = ['asc', 'desc'];

const error = (path, message) => ({ path, message });

const columnErrors = ({ from, joins }, names) => (ref, path) => {
  if (typeof ref !== 'string' || !ref) return [error(path, 'expected a column name')];
  const { join, col } = splitColumn(ref);
  if (join && !joins.includes(join)) return [error(path, `join ${join} is not in the query`)];
  return names[tableOf(from, join)]?.includes(col) ? [] : [error(path, `unknown column ${ref}`)];
};

const whereErrors = (column) => (clauses, path) =>
  clauses.flatMap((c, i) => [
    ...column(c.col, `${path}.${i}.col`),
    ...(OPS.includes(c.op) ? [] : [error(`${path}.${i}.op`, `unknown operator ${c.op}`)]),
  ]);

const arity = (params) => [params.filter((p) => !p.endsWith('?')).length, params.length];

const measureErrors = (column, where) => {
  const check = (m, path, wrapped) => {
    const spec = MEASURES[m?.kind];
    if (!spec) return [error(`${path}.kind`, `unknown measure ${m?.kind}`)];
    const wrapper = WRAPPERS.includes(m.kind);
    if (wrapper && wrapped) return [error(`${path}.kind`, `${m.kind} cannot sit inside share or delta`)];
    const args = m.args ?? [];
    const [min, max] = arity(spec.params);
    if (args.length < min || args.length > max)
      return [error(`${path}.args`, `${m.kind} takes ${min === max ? min : `${min} to ${max}`} arguments, got ${args.length}`)];
    const arg = (a, i) => {
      const at = `${path}.args.${i}`;
      const type = spec.params[i].replace('?', '');
      if (type === 'col') return column(a, at);
      if (type === 'measure') return check(a, at, wrapper);
      if (type === 'number' && !Number.isFinite(a)) return [error(at, 'expected a number')];
      return [];
    };
    return [...args.flatMap(arg), ...where(m.where ?? [], `${path}.where`)];
  };
  return (m, path) => check(m, path, false);
};

const VIEW_SHAPES = {
  scatter: (q) => (q.measures.length < 2 ? 'scatter needs two measures' : null),
  heatmap: (q) => (q.group.length !== 2 ? 'heatmap needs two group-by columns' : null),
  line: (q) => (q.group.length < 1 ? 'line needs a group-by column' : null),
};

const viewErrors = (q) => {
  if (!VIEWS.includes(q.view)) return [error('view', `unknown view ${q.view}`)];
  const message = VIEW_SHAPES[q.view]?.(q);
  return message ? [error('view', message)] : [];
};

const sortErrors = ({ sort, group, measures }) => {
  if (sort == null) return [];
  const keys = [...measures.map((m) => m.name), ...group];
  return [
    ...(keys.includes(sort.by) ? [] : [error('sort.by', `sort ${sort.by} is not a measure or group-by column`)]),
    ...(sort.dir == null || SORT_DIRS.includes(sort.dir) ? [] : [error('sort.dir', `unknown sort direction ${sort.dir}`)]),
  ];
};

const limitErrors = ({ limit }) =>
  limit == null || (Number.isInteger(limit) && limit > 0) ? [] : [error('limit', 'limit must be a positive integer')];

/** `names` maps table name to its column names. Empty result means the query can run. */
export const validateQuery = (q, names) => {
  if (!BASES[q.from]) return [error('from', `unknown base table ${q.from}`)];
  const column = columnErrors(q, names);
  const where = whereErrors(column);
  const measure = measureErrors(column, where);
  return [
    ...q.joins.flatMap((j, i) => (BASES[q.from].includes(j) ? [] : [error(`joins.${i}`, `${q.from} does not allow join ${j}`)])),
    ...where(q.where, 'where'),
    ...(q.group.length > MAX_GROUPS ? [error('group', `at most ${MAX_GROUPS} group-by columns`)] : []),
    ...q.group.flatMap((g, i) => column(g, `group.${i}`)),
    ...q.measures.flatMap((m, i) => measure(m, `measures.${i}`)),
    ...viewErrors(q),
    ...sortErrors(q),
    ...limitErrors(q),
  ];
};
