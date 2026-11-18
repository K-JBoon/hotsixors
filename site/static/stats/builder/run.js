import { aggregate, count, distinct } from '../query.js';
import { METRICS, WRAPPERS, clauseTest, knownOrder, validateQuery, queryColumns } from './model.js';
import { joinView, tableNames } from './join.js';

const rowTest = (clauses, column) => {
  const tests = clauses.map((c) => [column(c.col), clauseTest(c)]);
  return (i) => tests.every(([values, test]) => test(values[i]));
};

/** Dictionary codes per row; null gets its own code. */
const encode = (values, length) => {
  const ids = new Map();
  const codes = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    let id = ids.get(values[i]);
    if (id === undefined) ids.set(values[i], (id = ids.size));
    codes[i] = id;
  }
  return { codes, values: [...ids.keys()] };
};

/** Mixed-radix key over encoded `dimensions`, first most significant. */
const groupKey = (dimensions, codes) => {
  const key = (i) => codes.reduce((k, d) => k * d.values.length + d.codes[i], 0);
  const split = (k) =>
    Object.fromEntries(
      codes.reduceRight((out, d, j) => {
        out.unshift([dimensions[j], d.values[k % d.values.length]]);
        k = Math.floor(k / d.values.length);
        return out;
      }, []),
    );
  const digits = (k) =>
    codes.reduceRight((ds, d) => {
      ds.unshift(k % d.values.length);
      k = Math.floor(k / d.values.length);
      return ds;
    }, []);
  const project = (keep) => (k) => {
    const ds = digits(k);
    return keep.reduce((p, j) => p * codes[j].values.length + ds[j], 0);
  };
  return { key, split, project };
};

const sized = (inner, cols) => ({
  init: () => [inner.init(), 0],
  add: (s, i) => (cols.some((c) => c[i] == null) ? s : [inner.add(s[0], i), s[1] + 1]),
  done: ([s, n]) => ({ value: inner.done(s), n }),
});

const build = (column) => (m) => {
  const spec = METRICS[m.kind];
  const isCol = (i) => spec.params[i].startsWith('col');
  const args = (m.args ?? []).map((a, i) => (isCol(i) ? column(a) : a));
  const made = spec.make(...args);
  const inner = spec.sized ? sized(made, args.filter((_, i) => isCol(i))) : made;
  if (!m.where?.length) return inner;
  const test = rowTest(m.where, column);
  return { ...inner, add: (s, i) => (test(i) ? inner.add(s, i) : s) };
};

/** Inner value of a sized metric, else the value itself. */
export const valueOf = (v) => (v != null && typeof v === 'object' ? v.value : v);

const sizeOf = (v) => (v != null && typeof v === 'object' ? v.n : null);

const unwrap = (m) => (WRAPPERS.includes(m.kind) ? m.args[0] : m);

const aggregateBy = (length, where, key, metrics, make) =>
  new Map(
    aggregate(length, { where, key, measures: Object.fromEntries(metrics.map((m) => [m.name, make(unwrap(m))])) }).map(
      ({ key: k, ...values }) => [k, values],
    ),
  );

const countBy = (length, where, key) =>
  new Map(aggregate(length, { where, key, measures: { n: count() } }).map(({ key: k, n }) => [k, n]));

const shareOf = (games) => (v) => ({ value: games && valueOf(v) != null ? valueOf(v) / games : null, n: sizeOf(v) ?? games });

const radixOf = (codes) => codes.reduce((n, d) => n * d.values.length, 1);

const deltaOf = (v, base) => ({
  value: valueOf(v) == null || valueOf(base) == null ? null : valueOf(v) - valueOf(base),
  n: sizeOf(v),
});

const compare = ({ by, dir = 'desc' }, dimensions) => {
  const sign = dir === 'asc' ? 1 : -1;
  const order = dimensions.includes(by) ? knownOrder(by) : null;
  const value = order ? (r) => order(r[by]) : (r) => valueOf(r[by]);
  return (a, b) => {
    const x = value(a);
    const y = value(b);
    if (x == null || y == null) return (x == null) - (y == null);
    return x < y ? -sign : x > y ? sign : 0;
  };
};

/**
 * Runs a query object over a stats source. `columns` lists the facet ref, if
 * any, then dimension refs, then metric names; each row holds one value per
 * column. Null dimension and facet values form their own group. Sized metrics
 * hold `{ value, n }`. Sort reads `value`, puts nulls last, and `dir` defaults
 * to `desc`. With a facet, sort and limit apply per facet value.
 * `share` divides its inner metric by the distinct `game_id` count of the
 * filtered rows grouped by the facet and every dimension except the first. `delta` subtracts its inner metric grouped
 * by the facet and every dimension except the last. Both yield `{ value, n }`
 * with `n` from the inner metric. `having` drops groups with fewer rows after
 * every metric is computed, before sort and limit.
 */
export async function runQuery(stats, q) {
  const errors = validateQuery(q, await tableNames(stats));
  if (errors.length) throw Object.assign(new Error(errors.map((e) => `${e.path}: ${e.message}`).join('\n')), { errors });
  const kinds = new Set(q.metrics.map((m) => m.kind));
  const refs = queryColumns(q);
  const { length, column } = await joinView(stats, q, kinds.has('share') ? [...new Set([...refs, 'game_id'])] : refs);
  const panels = q.facet == null ? 0 : 1;
  const keys = panels ? [q.facet, ...q.dimensions] : q.dimensions;
  const codes = keys.map((ref) => encode(column(ref), length));
  const { key, split, project } = groupKey(keys, codes);
  const where = rowTest(q.where, column);
  const make = build(column);
  const groups = aggregateBy(length, where, key, q.metrics, make);
  const shareKeep = keys.map((_, j) => j).filter((j) => j !== panels);
  const shareOfGroup = project(shareKeep);
  const shareKey = groupKey(
    shareKeep.map((j) => keys[j]),
    shareKeep.map((j) => codes[j]),
  ).key;
  const games = kinds.has('share')
    ? new Map(aggregate(length, { where, key: shareKey, measures: { v: distinct(column('game_id')) } }).map(({ key: k, v }) => [k, v]))
    : null;
  const deltas = q.metrics.filter((m) => m.kind === 'delta');
  const depth = Math.max(keys.length - 1, panels);
  const parent = groupKey(keys.slice(0, depth), codes.slice(0, depth));
  const radix = radixOf(codes.slice(depth));
  const baseline = deltas.length ? aggregateBy(length, where, parent.key, deltas, make) : null;
  const finish = (k, values) => (m) => {
    const v = values[m.name];
    if (m.kind === 'share') return shareOf(games.get(shareOfGroup(k)) ?? 0)(v);
    if (m.kind === 'delta') return deltaOf(v, baseline.get(Math.floor(k / radix))?.[m.name]);
    return v;
  };
  const sizes = q.having == null ? null : countBy(length, where, key);
  const kept = sizes ? [...groups].filter(([k]) => sizes.get(k) >= q.having) : [...groups];
  const rows = kept.map(([k, values]) => ({
    ...split(k),
    ...Object.fromEntries(q.metrics.map((m) => [m.name, finish(k, values)(m)])),
  }));
  const cut = (rs) => {
    const sorted = q.sort ? rs.sort(compare(q.sort, q.dimensions)) : rs;
    return q.limit ? sorted.slice(0, q.limit) : sorted;
  };
  return {
    columns: [...keys, ...q.metrics.map((m) => m.name)],
    rows: panels ? [...Map.groupBy(rows, (r) => r[q.facet]).values()].flatMap(cut) : cut(rows),
  };
}
