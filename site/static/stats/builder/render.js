import { MISSING_ICON, escapeHtml, fmt, heroCell, heroName, heroPortrait, renderTable, thinOf, wilson, winRateCell } from '../view.js';
import { barChart, extent, heatmapChart, lineChart, scatterChart } from '../charts.js';
import { METRICS, splitColumn } from './model.js';
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

const metricFormat = (m) => {
  if (m.kind === 'rate') return fmt.pct;
  if (m.kind === 'delta') return DELTA_FORMATS[m.args[0].kind] ?? signed(FORMATS[m.args[0].kind] ?? fmt.num);
  return FORMATS[m.kind] ?? text;
};

const metricCell = (m) => {
  if (m.kind === 'rate') return (v) => winRateCell(valueOf(v), v?.n);
  const format = metricFormat(m);
  return (v) => format(valueOf(v));
};

const versionKey = (v) => (typeof v === 'string' ? v.split('.').map((p) => p.padStart(8, '0')).join('.') : v);

const heroHash = (slug) => `#hero/${encodeURIComponent(slug)}`;

const dimensionColumn = (heroes) => (ref) => {
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

const metricColumn = (m) => {
  const cell = metricCell(m);
  return { key: m.name, label: m.name, title: printCall(m), num: true, sort: (r) => valueOf(r[m.name]), html: (r) => cell(r[m.name]) };
};

/** Sample size per row: the first `count` metric, else the first sized metric. */
const sampleSize = (metrics) => {
  const counted = metrics.find((m) => m.kind === 'count');
  if (counted) return (r) => r[counted.name];
  return (r) => metrics.map((m) => r[m.name]).find((v) => v != null && typeof v === 'object')?.n;
};

const dimensionText = (heroes, dimensions) => (r) =>
  dimensions.map((ref) => (splitColumn(ref).col === 'hero' && r[ref] != null ? heroName(heroes, r[ref]) : String(r[ref] ?? ''))).join(' ');

const table = (el, { rows }, q, heroes) => {
  const columns = [...q.dimensions.map(dimensionColumn(heroes)), ...q.metrics.map(metricColumn)];
  if (!columns.length) {
    el.innerHTML = '<p class="stats-note">No columns.</p>';
    return;
  }
  renderTable(el, {
    columns,
    rows,
    sortKey: q.sort?.by ?? columns[0]?.key,
    sortDir: q.sort ? (q.sort.dir === 'asc' ? 1 : -1) : 1,
    count: sampleSize(q.metrics),
    empty: 'No rows match this query.',
    search: q.dimensions.length ? { placeholder: 'Filter', text: dimensionText(heroes, q.dimensions) } : undefined,
  });
};

const TEXT_METRICS = ['mode', 'latest'];

const INT_METRICS = ['count', 'present', 'distinct', 'sum'];

const tone = ([lo, hi]) => (lo > 0.5 ? 'is-high' : hi < 0.5 ? 'is-low' : null);

const refOf = (m) => (m.kind === 'rate' ? 0.5 : m.kind === 'delta' ? 0 : null);

const minStepOf = (m) => (INT_METRICS.includes(m.kind) ? 1 : 0);

const noRows = (el) => {
  el.innerHTML = '<p class="stats-note">No rows match this query.</p>';
};

const metricHead = (m) => `<span title="${escapeHtml(printCall(m))}">${escapeHtml(m.name)}</span>`;

const bar = (el, result, q, heroes) => {
  const [m] = q.metrics;
  if (!m || TEXT_METRICS.includes(m.kind)) return tableView(el, result, q, heroes);
  const { rows } = result;
  if (!rows.length) return noRows(el);
  const dims = q.dimensions.map(dimensionColumn(heroes));
  const cell = metricCell(m);
  const size = sampleSize(q.metrics);
  const dim = thinOf(rows.map(size));
  const rate = m.kind === 'rate';
  const value = (r) => valueOf(r[m.name]);
  const interval = (r) => (rate && value(r) != null ? wilson(value(r), r[m.name].n) : null);
  const range = [(r) => interval(r)?.[0] ?? value(r), (r) => interval(r)?.[1] ?? value(r)].flatMap((f) => sharedRange(rows, f) ?? []);
  const key = (r) => value(r) ?? -Infinity;
  const panel = (pel, prs) => {
    const ordered = q.sort ? prs : [...prs].sort((a, b) => (key(a) === key(b) ? 0 : key(b) - key(a)));
    const bars = ordered.map((r) => ({
      label: dims.length ? dims.map((d) => d.html(r)).join(' ') : '–',
      value: value(r),
      text: cell(r[m.name]),
      interval: interval(r),
      tone: interval(r) && tone(interval(r)),
      thin: dim(size(r)),
    }));
    barChart(pel, {
      bars,
      head: [escapeHtml(q.dimensions.join(' ')), metricHead(m)],
      format: metricFormat(m),
      ref: rate ? 0.5 : null,
      minStep: minStepOf(m),
      range: range.length ? extent(range) : null,
    });
  };
  facetPanels(el, rows, q, heroes, panel);
};

const LINE_SERIES = 8;

const ascending = (a, b) => (a === b ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : 1);

const NAMES = { hero: (heroes, v) => heroName(heroes, v), date: (_, v) => fmt.date(v) };

const dimensionName = (heroes, ref) => (v) =>
  v == null ? '–' : (NAMES[splitColumn(ref).col] ?? ((_, v) => String(v)))(heroes, v);

const dimensionLabel = (heroes, ref) => (v) =>
  v != null && splitColumn(ref).col === 'hero' ? heroCell(heroes, v) : text(v);

const line = (el, result, q, heroes) => {
  const [m] = q.metrics;
  if (!m || TEXT_METRICS.includes(m.kind)) return tableView(el, result, q, heroes);
  const { rows } = result;
  if (!rows.length) return noRows(el);
  const [xRef, ...sRefs] = q.dimensions;
  const xSort = dimensionColumn(heroes)(xRef).sort;
  const xs = [...new Set(rows.map((r) => r[xRef]))].sort((a, b) => ascending(xSort({ [xRef]: a }), xSort({ [xRef]: b })));
  const xName = dimensionName(heroes, xRef);
  const sName = sRefs.length ? (r) => sRefs.map((ref) => dimensionName(heroes, ref)(r[ref])).join(' ') : () => m.name;
  const sLabel = sRefs.length ? (r) => sRefs.map((ref) => dimensionLabel(heroes, ref)(r[ref])).join(' ') : () => escapeHtml(m.name);
  const size = sampleSize(q.metrics);
  const dim = thinOf(rows.map(size));
  const format = metricFormat(m);
  const seriesKey = (r) => JSON.stringify(sRefs.map((ref) => r[ref]));
  const games = (rs) => rs.reduce((t, r) => t + (size(r) ?? 0), 0);
  const ranked = [...Map.groupBy(rows, seriesKey)].sort(([, a], [, b]) => games(b) - games(a));
  const index = new Map(ranked.map(([k], i) => [k, i]));
  const point = (r) => {
    if (!r) return null;
    const v = valueOf(r[m.name]);
    const n = size(r);
    return { value: v, title: `${sName(r)} ${xName(r[xRef])}: ${format(v)}${n == null ? '' : `, n=${fmt.int(n)}`}`, thin: dim(n) };
  };
  const seriesOf = (prs) => {
    const at = Map.groupBy(prs, seriesKey);
    return ranked.map(([k, rs]) => {
      const byX = new Map((at.get(k) ?? []).map((r) => [r[xRef], r]));
      return { label: sLabel(rs[0]), points: xs.map((x) => point(byX.get(x))) };
    });
  };
  const draw = (on) => {
    const range = sharedRange(rows.filter((r) => on[index.get(seriesKey(r))]), (r) => valueOf(r[m.name]));
    const toggle = (k) => draw(on.map((v, i) => (i === k ? !v : v)));
    const panel = (pel, prs) =>
      lineChart(pel, { xs: xs.map(xName), series: seriesOf(prs), on, head: metricHead(m), format, ref: refOf(m), minStep: minStepOf(m), range, toggle });
    facetPanels(el, rows, q, heroes, panel, '24rem');
  };
  draw(ranked.map((_, i) => i < LINE_SERIES));
};

const smallestSize = (metrics) => (r) => {
  const ns = metrics.map((m) => r[m.name]?.n).filter(Number.isFinite);
  return ns.length ? Math.min(...ns) : undefined;
};

const scatter = (el, result, q, heroes) => {
  const ms = q.metrics.slice(0, 2);
  if (ms.length < 2 || ms.some((m) => TEXT_METRICS.includes(m.kind))) return tableView(el, result, q, heroes);
  const { rows } = result;
  if (!rows.length) return noRows(el);
  const [mx, my] = ms;
  const [fx, fy] = ms.map(metricFormat);
  const size = q.metrics.some((m) => m.kind === 'count') ? sampleSize(q.metrics) : smallestSize(ms);
  const dim = thinOf(rows.map(size));
  const name = dimensionText(heroes, q.dimensions);
  const heroRef = q.dimensions.find((ref) => splitColumn(ref).col === 'hero');
  const interval = (m, v) => (m.kind === 'rate' ? wilson(valueOf(v), v.n) : null);
  const plottable = (r) => ms.every((m) => valueOf(r[m.name]) != null);
  const plotted = rows.filter(plottable);
  const pointOf = (r) => {
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
  };
  const pointsOf = (prs) => prs.filter(plottable).sort((a, b) => (size(a) ?? 0) - (size(b) ?? 0)).map(pointOf);
  const axisOf = (m, format) => ({ head: metricHead(m), format, ref: refOf(m), minStep: minStepOf(m), range: sharedRange(plotted, (r) => valueOf(r[m.name])) });
  const [ax, ay] = [axisOf(mx, fx), axisOf(my, fy)];
  facetPanels(el, rows, q, heroes, (pel, prs) => scatterChart(pel, { points: pointsOf(prs), x: ax, y: ay }));
};

/** Cell sample size: a `count` metric when present, else `m`'s own `n`; `share` of an unsized metric has none. */
const cellSize = (m, metrics) => {
  if (metrics.some((x) => x.kind === 'count')) return sampleSize(metrics);
  if (m.kind === 'share' && !METRICS[m.args[0].kind].sized) return () => undefined;
  return (r) => r[m.name]?.n;
};

const axisValues = (rows, ref, sort, heroes) => {
  const values = [...new Set(rows.map((r) => r[ref]))];
  if (sort) return values;
  const key = dimensionColumn(heroes)(ref).sort;
  return values.sort((a, b) => ascending(key({ [ref]: a }), key({ [ref]: b })));
};

/** Value range over `rows`, skipping thin rows when any others have a value; null when no row has one. */
const sharedRange = (rows, value, thin = () => false) => {
  const valued = rows.filter((r) => value(r) != null);
  const solid = valued.filter((r) => !thin(r));
  return valued.length ? extent((solid.length ? solid : valued).map(value)) : null;
};

/** Draws `draw(panel, rows)` once per `q.facet` value in a labeled grid, or once in `el` without a facet. */
const facetPanels = (el, rows, q, heroes, draw, min = '20rem') => {
  if (q.facet == null) return draw(el, rows);
  const groups = Map.groupBy(rows, (r) => r[q.facet]);
  const values = axisValues(rows, q.facet, null, heroes);
  const label = dimensionLabel(heroes, q.facet);
  el.innerHTML = `<div class="stats-facets" style="--facet-min: ${min}">${values
    .map((v) => `<section class="stats-section"><h3 class="stats-section__title">${label(v)}</h3><div></div></section>`)
    .join('')}</div>`;
  el.querySelectorAll('.stats-facets > section > div').forEach((panel, i) => draw(panel, groups.get(values[i]) ?? []));
};

const withFacet = (q) => (q.facet == null ? q : { ...q, facet: null, dimensions: [q.facet, ...q.dimensions] });

const tableView = (el, result, q, heroes) => table(el, result, withFacet(q), heroes);

const distinctCount = (rows, ref) => new Set(rows.map((r) => r[ref])).size;

const heatmap = (el, result, q, heroes) => {
  const [m] = q.metrics;
  if (!m || TEXT_METRICS.includes(m.kind)) return tableView(el, result, q, heroes);
  const { rows } = result;
  if (!rows.length) return noRows(el);
  const [a, b] = q.dimensions;
  const [rRef, cRef] = distinctCount(rows, a) >= distinctCount(rows, b) ? [a, b] : [b, a];
  const size = cellSize(m, q.metrics);
  const dim = thinOf(rows.map(size));
  const format = metricFormat(m);
  const name = dimensionText(heroes, [q.facet, ...q.dimensions].filter((ref) => ref != null));
  const range = sharedRange(rows, (r) => valueOf(r[m.name]), (r) => dim(size(r)));
  const label = (ref) => {
    const html = dimensionColumn(heroes)(ref).html;
    const title = dimensionName(heroes, ref);
    return (v) => ({ label: html({ [ref]: v }), title: title(v) });
  };
  const panel = (pel, prs) => {
    if (!prs.length) return noRows(pel);
    const rs = axisValues(prs, rRef, q.sort, heroes);
    const cs = axisValues(prs, cRef, q.sort, heroes);
    const at = new Map([...Map.groupBy(prs, (r) => r[rRef])].map(([k, rs]) => [k, new Map(rs.map((r) => [r[cRef], r]))]));
    const cell = (rv, cv) => {
      const r = at.get(rv).get(cv);
      const v = r && valueOf(r[m.name]);
      if (v == null) return null;
      const n = size(r);
      return { value: v, title: `${name(r) || '–'}: ${format(v)}${n == null ? '' : `, n=${fmt.int(n)}`}`, thin: dim(n) };
    };
    heatmapChart(pel, {
      rows: rs.map(label(rRef)),
      cols: cs.map(label(cRef)),
      cells: rs.map((rv) => cs.map((cv) => cell(rv, cv))),
      head: [escapeHtml(`${rRef} / ${cRef}`), metricHead(m)],
      format,
      ref: refOf(m),
      minStep: minStepOf(m),
      range,
    });
  };
  facetPanels(el, rows, q, heroes, panel, `calc(${distinctCount(rows, cRef)} * 1.5rem + 16rem)`);
};

const VIEWS = { bar, line, scatter, heatmap };

/** Draws a `runQuery` result in `el` per `q.view`; views without a renderer fall back to the table. */
export const renderResult = (el, result, q, heroes) => (VIEWS[q.view] ?? tableView)(el, result, q, heroes);
