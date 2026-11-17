import { MISSING_ICON, escapeHtml, fmt, heroCell, heroName, heroPortrait, renderTable, thinOf, wilson, winRateCell } from '../view.js';
import { barChart, lineChart, scatterChart } from '../charts.js';
import { splitColumn } from './model.js';
import { valueOf } from './run.js';
import { printCall } from './text.js';

const text = (v) => (v == null ? '–' : typeof v === 'number' ? fmt.num(v) : escapeHtml(String(v)));

const signed = (f) => (v) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`);

const FORMATS = {
  count: fmt.int,
  present: fmt.int,
  distinct: fmt.int,
  sum: fmt.int,
  mean: fmt.num,
  ratio: fmt.num,
  mode: text,
  latest: text,
  share: fmt.pct,
};

const DELTA_FORMATS = { rate: fmt.delta, share: fmt.delta };

const measureFormat = (m) => {
  if (m.kind === 'rate') return fmt.pct;
  if (m.kind === 'delta') return DELTA_FORMATS[m.args[0].kind] ?? signed(FORMATS[m.args[0].kind] ?? fmt.num);
  return FORMATS[m.kind] ?? text;
};

const measureCell = (m) => {
  if (m.kind === 'rate') return (v) => winRateCell(valueOf(v), v?.n);
  const format = measureFormat(m);
  return (v) => format(valueOf(v));
};

const versionKey = (v) => (typeof v === 'string' ? v.split('.').map((p) => p.padStart(8, '0')).join('.') : v);

const heroHash = (slug) => `#hero/${encodeURIComponent(slug)}`;

const groupColumn = (heroes) => (ref) => {
  const { col } = splitColumn(ref);
  if (col === 'hero') {
    return {
      key: ref,
      label: ref,
      sort: (r) => (r[ref] == null ? null : heroName(heroes, r[ref])),
      html: (r) => (r[ref] == null ? '–' : heroCell(heroes, r[ref], heroHash(r[ref]))),
    };
  }
  return { key: ref, label: ref, sort: col === 'patch' ? (r) => versionKey(r[ref]) : (r) => r[ref], html: (r) => text(r[ref]) };
};

const measureColumn = (m) => {
  const cell = measureCell(m);
  return { key: m.name, label: m.name, title: printCall(m), num: true, sort: (r) => valueOf(r[m.name]), html: (r) => cell(r[m.name]) };
};

/** Sample size per row: the first `count` measure, else the first sized measure. */
const sampleSize = (measures) => {
  const counted = measures.find((m) => m.kind === 'count');
  if (counted) return (r) => r[counted.name];
  return (r) => measures.map((m) => r[m.name]).find((v) => v != null && typeof v === 'object')?.n;
};

const groupText = (heroes, group) => (r) =>
  group.map((ref) => (splitColumn(ref).col === 'hero' && r[ref] != null ? heroName(heroes, r[ref]) : String(r[ref] ?? ''))).join(' ');

const table = (el, { rows }, q, heroes) => {
  const columns = [...q.group.map(groupColumn(heroes)), ...q.measures.map(measureColumn)];
  renderTable(el, {
    columns,
    rows,
    sortKey: q.sort?.by ?? columns[0]?.key,
    sortDir: q.sort ? (q.sort.dir === 'asc' ? 1 : -1) : 1,
    count: sampleSize(q.measures),
    empty: 'No rows match this query.',
    search: q.group.length ? { placeholder: 'Filter', text: groupText(heroes, q.group) } : undefined,
  });
};

const TEXT_MEASURES = ['mode', 'latest'];

const INT_MEASURES = ['count', 'present', 'distinct', 'sum'];

const tone = ([lo, hi]) => (lo > 0.5 ? 'is-high' : hi < 0.5 ? 'is-low' : null);

const refOf = (m) => (m.kind === 'rate' ? 0.5 : m.kind === 'delta' ? 0 : null);

const minStepOf = (m) => (INT_MEASURES.includes(m.kind) ? 1 : 0);

const noRows = (el) => {
  el.innerHTML = '<p class="stats-note">No rows match this query.</p>';
};

const measureHead = (m) => `<span title="${escapeHtml(printCall(m))}">${escapeHtml(m.name)}</span>`;

const bar = (el, result, q, heroes) => {
  const [m] = q.measures;
  if (!m || TEXT_MEASURES.includes(m.kind)) return table(el, result, q, heroes);
  const { rows } = result;
  if (!rows.length) return noRows(el);
  const groups = q.group.map(groupColumn(heroes));
  const cell = measureCell(m);
  const size = sampleSize(q.measures);
  const dim = thinOf(rows.map(size));
  const rate = m.kind === 'rate';
  const key = (r) => valueOf(r[m.name]) ?? -Infinity;
  const ordered = q.sort ? rows : [...rows].sort((a, b) => (key(a) === key(b) ? 0 : key(b) - key(a)));
  const bars = ordered.map((r) => {
    const v = r[m.name];
    const interval = rate && valueOf(v) != null ? wilson(valueOf(v), v.n) : null;
    return {
      label: groups.length ? groups.map((g) => g.html(r)).join(' ') : '–',
      value: valueOf(v),
      text: cell(v),
      interval,
      tone: interval && tone(interval),
      thin: dim(size(r)),
    };
  });
  barChart(el, {
    bars,
    head: [escapeHtml(q.group.join(' ')), measureHead(m)],
    format: measureFormat(m),
    ref: rate ? 0.5 : null,
    minStep: minStepOf(m),
  });
};

const LINE_SERIES = 8;

const ascending = (a, b) => (a === b ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : 1);

const NAMES = { hero: (heroes, v) => heroName(heroes, v), date: (_, v) => fmt.date(v) };

const groupName = (heroes, ref) => (v) =>
  v == null ? '–' : (NAMES[splitColumn(ref).col] ?? ((_, v) => String(v)))(heroes, v);

const groupLabel = (heroes, ref) => (v) =>
  v != null && splitColumn(ref).col === 'hero' ? heroCell(heroes, v) : text(v);

const line = (el, result, q, heroes) => {
  const [m] = q.measures;
  if (!m || TEXT_MEASURES.includes(m.kind)) return table(el, result, q, heroes);
  const { rows } = result;
  if (!rows.length) return noRows(el);
  const [xRef, sRef] = q.group;
  const xSort = groupColumn(heroes)(xRef).sort;
  const xs = [...new Set(rows.map((r) => r[xRef]))].sort((a, b) => ascending(xSort({ [xRef]: a }), xSort({ [xRef]: b })));
  const xName = groupName(heroes, xRef);
  const sName = sRef ? groupName(heroes, sRef) : () => m.name;
  const size = sampleSize(q.measures);
  const dim = thinOf(rows.map(size));
  const format = measureFormat(m);
  const bySeries = Map.groupBy(rows, (r) => (sRef ? r[sRef] : null));
  const games = (rs) => rs.reduce((t, r) => t + (size(r) ?? 0), 0);
  const ranked = [...bySeries].sort(([, a], [, b]) => games(b) - games(a));
  const series = ranked.map(([s, rs]) => {
    const at = new Map(rs.map((r) => [r[xRef], r]));
    const point = (x) => {
      const r = at.get(x);
      if (!r) return null;
      const v = valueOf(r[m.name]);
      const n = size(r);
      return { value: v, title: `${sName(s)} ${xName(x)}: ${format(v)}${n == null ? '' : `, n=${fmt.int(n)}`}`, thin: dim(n) };
    };
    return { label: sRef ? groupLabel(heroes, sRef)(s) : escapeHtml(m.name), points: xs.map(point) };
  });
  lineChart(el, {
    xs: xs.map(xName),
    series,
    on: series.map((_, i) => i < LINE_SERIES),
    head: measureHead(m),
    format,
    ref: refOf(m),
    minStep: minStepOf(m),
  });
};

const smallestSize = (measures) => (r) => {
  const ns = measures.map((m) => r[m.name]?.n).filter(Number.isFinite);
  return ns.length ? Math.min(...ns) : undefined;
};

const scatter = (el, result, q, heroes) => {
  const ms = q.measures.slice(0, 2);
  if (ms.length < 2 || ms.some((m) => TEXT_MEASURES.includes(m.kind))) return table(el, result, q, heroes);
  const { rows } = result;
  if (!rows.length) return noRows(el);
  const [mx, my] = ms;
  const [fx, fy] = ms.map(measureFormat);
  const size = q.measures.some((m) => m.kind === 'count') ? sampleSize(q.measures) : smallestSize(ms);
  const dim = thinOf(rows.map(size));
  const name = groupText(heroes, q.group);
  const heroRef = q.group.find((ref) => splitColumn(ref).col === 'hero');
  const interval = (m, v) => (m.kind === 'rate' ? wilson(valueOf(v), v.n) : null);
  const plotted = rows.filter((r) => ms.every((m) => valueOf(r[m.name]) != null));
  const points = plotted
    .sort((a, b) => (size(a) ?? 0) - (size(b) ?? 0))
    .map((r) => {
      const [x, y] = ms.map((m) => valueOf(r[m.name]));
      const n = size(r);
      const hero = heroRef ? r[heroRef] : null;
      return {
        x,
        y,
        xi: interval(mx, r[mx.name]),
        yi: interval(my, r[my.name]),
        mark: hero == null ? null : heroPortrait(heroes, hero) || MISSING_ICON,
        href: hero == null ? null : heroHash(hero),
        title: `${name(r) || '–'}: ${mx.name} ${fx(x)}, ${my.name} ${fy(y)}${n == null ? '' : `, n=${fmt.int(n)}`}`,
        thin: dim(n),
      };
    });
  const axisOf = (m, format) => ({ head: measureHead(m), format, ref: refOf(m), minStep: minStepOf(m) });
  scatterChart(el, { points, x: axisOf(mx, fx), y: axisOf(my, fy) });
};

const VIEWS = { table, bar, line, scatter };

/** Draws a `runQuery` result in `el` per `q.view`; views without a renderer fall back to the table. */
export const renderResult = (el, result, q, heroes) => (VIEWS[q.view] ?? table)(el, result, q, heroes);
