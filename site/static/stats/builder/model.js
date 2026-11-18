import { count, present, sum, mean, rate, distinct, ratio, mode, latest, minorOf } from '../query.js';
import { TALENT_TIERS } from '../../js/talent-tiers.js';

export const BASES = { players: ['game', 'teammate', 'opponent', 'talent_pair'], draft: ['game'] };

export const JOINS = { game: 'games', teammate: 'players', opponent: 'players' };

const TALENT_PAIRS = TALENT_TIERS.slice(1).map((level, i) => ({
  tiers: `${TALENT_TIERS[i]}-${level}`,
  a: `talent${i + 1}`,
  b: `talent${i + 2}`,
}));

/** Joins without a table. `rows(row)` maps one base row, keyed by `reads`, to its joined rows. */
export const DERIVED_JOINS = {
  talent_pair: {
    columns: ['tiers', 'a', 'b'],
    reads: TALENT_TIERS.map((_, i) => `talent${i + 1}`),
    values: { tiers: TALENT_PAIRS.map((p) => p.tiers) },
    rows: (row) => TALENT_PAIRS.map((p) => ({ tiers: p.tiers, a: row[p.a] ?? null, b: row[p.b] ?? null })),
  },
};

export const VIEWS = ['table', 'bar', 'line', 'scatter', 'heatmap'];

export const OPS = ['=', '!=', 'in', '<', '<=', '>', '>='];

export const MAX_DIMENSIONS = 2;

/**
 * Param types: `col` column ref, `value` literal, `number` literal, `metric` inner metric. `?` marks optional.
 * `sized` metrics yield `{ value, n }`, `n` being the rows with every `col` argument non-null.
 */
export const METRICS = {
  count: { params: [], make: count },
  present: { params: ['col'], make: present },
  sum: { params: ['col'], make: sum },
  mean: { params: ['col'], make: mean, sized: true },
  rate: { params: ['col', 'value?'], make: rate, sized: true },
  distinct: { params: ['col'], make: distinct },
  ratio: { params: ['col', 'col', 'number?'], make: ratio, sized: true },
  mode: { params: ['col'], make: mode },
  latest: { params: ['col', 'col'], make: latest },
  share: { params: ['metric'] },
  delta: { params: ['metric'] },
};

export const WRAPPERS = ['share', 'delta'];

export const clause = (col, op, value) => ({ col, op, value });

export const fn = (kind, args = [], where = []) => ({ kind, args, where });

export const metric = (name, inner) => ({ name, ...inner });

export const query = ({
  from = 'players',
  joins = [],
  where = [],
  dimensions = [],
  facet = null,
  metrics = [],
  sort = null,
  limit = null,
  view = 'table',
} = {}) => ({ from, joins, where, dimensions, facet, metrics, sort, limit, view });

/** `opponent.hero` -> `{ join: 'opponent', col: 'hero' }`; unprefixed refs read the base table. */
export const splitColumn = (ref) => {
  const dot = ref.indexOf('.');
  return dot < 0 ? { join: null, col: ref } : { join: ref.slice(0, dot), col: ref.slice(dot + 1) };
};

/** Table a column ref reads; null for a derived join. */
export const tableOf = (from, join) => (join ? (JOINS[join] ?? null) : from);

/** Key into tableNames output: the table, or the join name for a derived join. */
export const namesKey = (from, join) => (join && DERIVED_JOINS[join] ? join : tableOf(from, join));

export const paramType = (kind, i) => METRICS[kind]?.params[i]?.replace('?', '');

/** Column refs one metric reads, its where clauses included. */
export const metricColumns = (m) => [
  ...(m.args ?? []).flatMap((a, i) => {
    const type = paramType(m.kind, i);
    return type === 'col' ? [a] : type === 'metric' ? metricColumns(a) : [];
  }),
  ...(m.where ?? []).map((c) => c.col),
];

/** Column refs a query reads, without duplicates. */
export const queryColumns = (q) => [
  ...new Set([...q.where.map((c) => c.col), ...q.dimensions, ...(q.facet == null ? [] : [q.facet]), ...q.metrics.flatMap(metricColumns)]),
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
  return names[namesKey(from, join)]?.includes(col) ? [] : [error(path, `unknown column ${ref}`)];
};

const unquotedPatch = ({ col, value }) =>
  typeof col === 'string' && splitColumn(col).col === 'patch' && [value].flat().some((v) => typeof v === 'number');

const whereErrors = (column) => (clauses, path) =>
  clauses.flatMap((c, i) => [
    ...column(c.col, `${path}.${i}.col`),
    ...(OPS.includes(c.op) ? [] : [error(`${path}.${i}.op`, `unknown operator ${c.op}`)]),
    ...(unquotedPatch(c) ? [error(`${path}.${i}.value`, 'quote patch values')] : []),
  ]);

const arity = (params) => [params.filter((p) => !p.endsWith('?')).length, params.length];

const metricErrors = (column, where) => {
  const check = (m, path, wrapped) => {
    const spec = METRICS[m?.kind];
    if (!spec) return [error(`${path}.kind`, `unknown metric ${m?.kind}`)];
    const wrapper = WRAPPERS.includes(m.kind);
    if (wrapper && wrapped) return [error(`${path}.kind`, `${m.kind} cannot sit inside share or delta`)];
    if (wrapper && m.where?.length) return [error(`${path}.where`, `where belongs inside ${m.kind}`)];
    const args = m.args ?? [];
    const [min, max] = arity(spec.params);
    if (args.length < min || args.length > max)
      return [error(`${path}.args`, `${m.kind} takes ${min === max ? min : `${min} to ${max}`} arguments, got ${args.length}`)];
    const arg = (a, i) => {
      const at = `${path}.args.${i}`;
      const type = spec.params[i].replace('?', '');
      if (type === 'col') return column(a, at);
      if (type === 'metric') return check(a, at, wrapper);
      if (type === 'number' && !Number.isFinite(a)) return [error(at, 'expected a number')];
      return [];
    };
    return [...args.flatMap(arg), ...where(m.where ?? [], `${path}.where`)];
  };
  return (m, path) => check(m, path, false);
};

const RESERVED_NAMES = ['key'];

/** Why metric `i` cannot use its name, else null. */
export const nameClash = ({ metrics, dimensions, facet }, i) => {
  const { name } = metrics[i];
  if (RESERVED_NAMES.includes(name)) return `${name} is a reserved name`;
  if (dimensions.includes(name)) return `${name} is a dimension`;
  if (name === facet) return `${name} is the facet`;
  return metrics.findIndex((m) => m.name === name) < i ? `duplicate metric ${name}` : null;
};

const nameErrors = (q) =>
  q.metrics.flatMap((_, i) => {
    const message = nameClash(q, i);
    return message ? [error(`metrics.${i}.name`, message)] : [];
  });

const VIEW_SHAPES = {
  scatter: (q) => (q.metrics.length < 2 ? 'scatter needs two metrics' : null),
  heatmap: (q) => (q.dimensions.length !== 2 ? 'heatmap needs two dimensions' : null),
  line: (q) => (q.dimensions.length < 1 ? 'line needs a dimension' : null),
};

const viewErrors = (q) => {
  if (!VIEWS.includes(q.view)) return [error('view', `unknown view ${q.view}`)];
  const message = VIEW_SHAPES[q.view]?.(q);
  return message ? [error('view', message)] : [];
};

const sortErrors = ({ sort, dimensions, metrics }) => {
  if (sort == null) return [];
  const keys = [...metrics.map((m) => m.name), ...dimensions];
  return [
    ...(keys.includes(sort.by) ? [] : [error('sort.by', `sort ${sort.by} is not a metric or dimension`)]),
    ...(sort.dir == null || SORT_DIRS.includes(sort.dir) ? [] : [error('sort.dir', `unknown sort direction ${sort.dir}`)]),
  ];
};

const facetErrors = (column, { facet, dimensions }) => {
  if (facet == null) return [];
  if (dimensions.includes(facet)) return [error('facet', `facet ${facet} is also a dimension`)];
  return column(facet, 'facet');
};

const limitErrors = ({ limit }) =>
  limit == null || (Number.isInteger(limit) && limit > 0) ? [] : [error('limit', 'limit must be a positive integer')];

/** `names` maps table name to its column names. Empty result means the query can run. */
export const validateQuery = (q, names) => {
  if (!BASES[q.from]) return [error('from', `unknown base table ${q.from}`)];
  const column = columnErrors(q, names);
  const where = whereErrors(column);
  const metric = metricErrors(column, where);
  return [
    ...q.joins.flatMap((j, i) => (BASES[q.from].includes(j) ? [] : [error(`joins.${i}`, `${q.from} does not allow join ${j}`)])),
    ...where(q.where, 'where'),
    ...(q.dimensions.length > MAX_DIMENSIONS ? [error('dimensions', `at most ${MAX_DIMENSIONS} dimensions`)] : []),
    ...q.dimensions.flatMap((d, i) => column(d, `dimensions.${i}`)),
    ...facetErrors(column, q),
    ...q.metrics.flatMap((m, i) => metric(m, `metrics.${i}`)),
    ...nameErrors(q),
    ...viewErrors(q),
    ...sortErrors(q),
    ...limitErrors(q),
  ];
};
