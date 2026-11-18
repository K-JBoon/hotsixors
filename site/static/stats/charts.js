import { escapeHtml } from './view.js';

const STEPS = [1, 2, 2.5, 5, 10];

/**
 * Round domain covering `[lo, hi]` and about `count` evenly spaced ticks in it, at least `minStep` apart.
 * `steps` lists allowed tick steps in ascending order; past its last entry, steps are decimal.
 */
export function niceTicks([lo, hi], count = 5, minStep = 0, steps = []) {
  if (lo === hi) [lo, hi] = lo ? [Math.min(0, lo), Math.max(0, hi)] : [0, 1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(steps.find((s) => s >= raw) ?? STEPS.find((s) => s * mag >= raw) * mag, minStep);
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks = Array.from({ length: Math.round((end - start) / step) + 1 }, (_, i) => +(start + i * step).toPrecision(12));
  return { domain: [start, end], ticks };
}

export const linear = ([a, b]) => (v) => (v - a) / (b - a);

export const pct = (f) => `${(f * 100).toFixed(3)}%`;

export const extent = (values) => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? [Math.min(...finite), Math.max(...finite)] : [0, 1];
};

const BAR = 0.6;

const STRIPES = '<defs><pattern id="stats-stripes" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="stats-chart__stripe" width="2" height="5"/></pattern></defs>';

/** Striped copy of a thin SVG mark, drawn over it. */
const stripes = (tag, geometry, thin) => (thin ? `<${tag} class="stats-chart__stripes" ${geometry} fill="url(#stats-stripes)"/>` : '');

const plot = (bars, x, ticks, ref, attrs) => {
  const y = (i, f) => pct((i + f) / bars.length);
  const zero = x(0);
  const grid = ticks.map((t) => `<line class="stats-chart__grid" x1="${pct(x(t))}" x2="${pct(x(t))}" y1="0" y2="100%"/>`);
  const marks = bars.flatMap((b, i) => {
    if (b?.value == null) return [];
    const at = clamp01(x(b.value));
    const cls = b.thin ? ' is-thin' : '';
    const geometry = `x="${pct(Math.min(at, zero))}" width="${pct(Math.abs(at - zero))}" y="${y(i, (1 - BAR) / 2)}" height="${y(0, BAR)}"`;
    const bar = `<rect class="stats-chart__bar${cls}" ${geometry}/>${stripes('rect', geometry, b.thin)}`;
    if (b.interval == null) return [bar];
    const [lo, hi] = b.interval.map((v) => clamp01(x(v)));
    return [bar, `<line class="stats-chart__whisker ${b.tone ?? ''}${cls}" x1="${pct(lo)}" x2="${pct(hi)}" y1="${y(i, 0.5)}" y2="${y(i, 0.5)}"/>`];
  });
  const rule = (v, cls) => `<line class="${cls}" x1="${pct(x(v))}" x2="${pct(x(v))}" y1="0" y2="100%"/>`;
  return `<svg class="stats-chart__plot" aria-hidden="true" ${attrs}>${STRIPES}${grid.join('')}${rule(0, 'stats-chart__zero')}${marks.join('')}${ref == null ? '' : rule(ref, 'stats-chart__ref')}</svg>`;
};

const edgeAnchor = (i, n) => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');

const axis = (x, ticks, format, anchor = (i) => edgeAnchor(i, ticks.length), attrs = '') =>
  `<svg class="stats-chart__axis" aria-hidden="true" ${attrs}>${ticks
    .map((t, i) => `<text x="${pct(x(t))}" y="100%" text-anchor="${anchor(i)}"${t === 0 ? ' data-zero' : ''}>${escapeHtml(format(t))}</text>`)
    .join('')}</svg>`;

const LABEL_GAP = 4;

/** Hides tick labels that would overlap; edge-anchored and zero labels win. */
const fitAxis = (svg) => {
  const texts = [...svg.querySelectorAll('text')];
  texts.forEach((t) => t.removeAttribute('display'));
  const rank = (t) => (t.getAttribute('text-anchor') !== 'middle' ? 0 : t.hasAttribute('data-zero') ? 1 : 2);
  const kept = [];
  texts
    .map((t) => ({ t, r: rank(t), box: t.getBoundingClientRect() }))
    .sort((a, b) => a.r - b.r)
    .forEach(({ t, box }) => {
      const clear = kept.every((k) => box.right + LABEL_GAP <= k.left || box.left >= k.right + LABEL_GAP);
      if (clear) kept.push(box);
      else t.setAttribute('display', 'none');
    });
};

const axisObserver = new ResizeObserver((entries) =>
  entries.forEach(({ target }) => (target.isConnected ? fitAxis(target) : axisObserver.unobserve(target))),
);

const fitAxes = (el) => el.querySelectorAll('.stats-chart__axis').forEach((svg) => axisObserver.observe(svg));

/**
 * Rows of horizontal bars from zero, one bar column per entry of `columns`, each on its own axis.
 * `labels`: row label HTML. `columns`: `{ head, bars, format, ref?, minStep?, steps?, range? }`, `head` HTML;
 * `bars` align with `labels` as `{ value, text, interval?: [lo, hi], tone?, thin? } | null`, `text` HTML.
 * `ref` draws a reference line at that value. `minStep` bounds the tick spacing; `steps` as in niceTicks.
 * An axis covers its `range` (`[lo, hi]`) when given, else its values and intervals; bars and intervals clip to it.
 */
export function barColumns(el, { labels, head, columns }) {
  const at = (k, j) => `style="grid-column: ${2 * k + j}"`;
  const cell = (cls, thin, attrs = '') => (html) => `<div class="stats-chart__${cls}${thin ? ' is-thin' : ''}" ${attrs}>${html}</div>`;
  const drawn = columns.map(({ head: title, bars, format, ref = null, minStep = 0, steps = [], range = null }, k) => {
    const values = range ?? bars.flatMap((b) => (b ? [b.value, ...(b.interval ?? [])] : []));
    const { domain, ticks } = niceTicks(extent([0, ...values, ...(ref == null ? [] : [ref])]), 5, minStep, steps);
    const x = linear(domain);
    return { head: `${axis(x, ticks, format, undefined, at(k, 2))}${cell('head num', false, at(k, 3))(title)}`, plot: plot(bars, x, ticks, ref, at(k, 2)) };
  });
  const row = (label, i) => {
    const bars = columns.map((c) => c.bars[i]);
    return `${cell('label', bars.every((b) => b?.thin))(label)}${bars.map((b, k) => cell('value num', b?.thin, at(k, 3))(b?.text ?? '')).join('')}`;
  };
  el.innerHTML = `<div class="stats-chart stats-chart--bar" style="--rows: ${labels.length}; --cols: ${columns.length}">
    ${cell('head')(head)}${drawn.map((d) => d.head).join('')}
    ${drawn.map((d) => d.plot).join('')}
    ${labels.map(row).join('')}
  </div>`;
  fitAxes(el);
}

/** One bar column. `bars`: `{ label, ...bar }`, `label` HTML. `head`: `[label, value]` HTML. Other options as in barColumns. */
export const barChart = (el, { bars, head, ...column }) =>
  barColumns(el, { labels: bars.map((b) => b.label), head: head[0], columns: [{ ...column, head: head[1], bars }] });

const SERIES = [
  'var(--accent-blue)',
  'var(--accent-gold)',
  'var(--success)',
  'var(--danger)',
  'var(--role-healer)',
  'var(--role-ranged-assassin)',
  'var(--accent-blue-pale)',
  'color-mix(in srgb, var(--role-specialist) 50%, var(--text-bright))',
];

const seriesColor = (i) => `--series: ${SERIES[i % SERIES.length]}`;

const MAX_X_LABELS = 12;

const linePlot = (xs, series, on, y, ticks, format, ref) => {
  const x = (i) => (i + 0.5) / xs.length;
  const r = xs.length > 60 ? 2 : 3;
  const hline = (v, cls) => `<line class="${cls}" x1="0" x2="100%" y1="${pct(y(v))}" y2="${pct(y(v))}"/>`;
  const grid = ticks.map((t) => `${hline(t, 'stats-chart__grid')}<text class="stats-chart__tick" x="-6" y="${pct(y(t))}" text-anchor="end" dominant-baseline="middle">${escapeHtml(format(t))}</text>`);
  const lines = series.flatMap((s, k) => {
    if (!on[k]) return [];
    const at = (i) => [pct(x(i)), pct(y(s.points[i].value))];
    const segments = s.points.flatMap((p, i) => {
      const prev = s.points[i - 1];
      if (p?.value == null || prev?.value == null) return [];
      const [[x1, y1], [x2, y2]] = [at(i - 1), at(i)];
      return [`<line class="stats-chart__line${p.thin || prev.thin ? ' is-thin' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`];
    });
    const points = s.points.flatMap((p, i) => {
      if (p?.value == null) return [];
      const [cx, cy] = at(i);
      const geometry = `cx="${cx}" cy="${cy}" r="${r}"`;
      return [`<circle class="stats-chart__point${p.thin ? ' is-thin' : ''}" ${geometry}><title>${escapeHtml(p.title)}</title></circle>${stripes('circle', geometry, p.thin)}`];
    });
    return [`<g style="${seriesColor(k)}">${segments.join('')}${points.join('')}</g>`];
  });
  return `<svg class="stats-chart__plot">${STRIPES}${grid.join('')}${ref == null ? '' : hline(ref, 'stats-chart__ref')}${lines.join('')}</svg>`;
};

const legend = (series, on) =>
  series.length < 2
    ? ''
    : `<div class="stats-chart__legend">${series
        .map((s, k) => `<button type="button" class="chip" data-series="${k}" aria-pressed="${on[k]}" style="${seriesColor(k)}"><span class="stats-chart__swatch"></span>${s.label}</button>`)
        .join('')}</div>`;

/**
 * Lines over ordinal `xs` (plain text, in order), one per series.
 * `series`: `{ label, points }`; `label` is HTML, `points` align with `xs` as `{ value, title, thin? } | null`.
 * `on` flags drawn series; the legend calls `toggle(k)`, by default redrawing with series `k` flipped.
 * The y domain covers `range` (`[lo, hi]`) when given, else drawn series, and `ref`.
 */
export function lineChart(el, opts) {
  const { xs, series, on, head, format, ref = null, minStep = 0, steps = [], range = null } = opts;
  const toggle = opts.toggle ?? ((k) => lineChart(el, { ...opts, on: on.map((v, i) => (i === k ? !v : v)) }));
  const values = range ?? series.flatMap((s, k) => (on[k] ? s.points.map((p) => p?.value) : []));
  const { domain, ticks } = niceTicks(extent([...values, ...(ref == null ? [] : [ref])]), 5, minStep, steps);
  const y = (v) => 1 - linear(domain)(v);
  const step = Math.ceil(xs.length / MAX_X_LABELS);
  const shown = xs.map((_, i) => i).filter((i) => i % step === 0);
  el.innerHTML = `<div class="stats-chart stats-chart--line">
    <div class="stats-chart__head">${head}</div>
    ${linePlot(xs, series, on, y, ticks, format, ref)}
    ${axis((i) => (i + 0.5) / xs.length, shown, (i) => xs[i], () => 'middle')}
    ${legend(series, on)}
  </div>`;
  fitAxes(el);
  el.querySelector('.stats-chart__legend')?.addEventListener('click', (e) => {
    const k = e.target.closest('[data-series]')?.dataset.series;
    if (k != null) toggle(+k);
  });
}

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

const scale = ({ ref = null, minStep = 0, steps = [], range = null }, values) => {
  const { domain, ticks } = niceTicks(extent([...(range ?? values), ...(ref == null ? [] : [ref])]), 5, minStep, steps);
  return { at: linear(domain), ticks };
};

const toneOf = (interval, ref) => (ref == null ? '' : interval[0] > ref ? ' is-high' : interval[1] < ref ? ' is-low' : '');

const whisker = (dir, interval, at, ref) => {
  const [lo, hi] = interval.map((v) => clamp01(at(v))).sort((a, b) => a - b);
  return `<span class="stats-chart__whisker stats-chart__whisker--${dir}${toneOf(interval, ref)}" style="--lo: ${lo}; --hi: ${hi}"></span>`;
};

const dot = (p, x, y, xAxis, yAxis) => {
  const tag = p.href ? 'a' : 'span';
  const href = p.href ? ` href="${escapeHtml(p.href)}"` : '';
  const whiskers = [p.xi && whisker('x', p.xi, x.at, xAxis.ref), p.yi && whisker('y', p.yi, (v) => 1 - y.at(v), yAxis.ref)];
  return `<${tag} class="stats-chart__dot${p.thin ? ' is-thin' : ''}"${href} title="${escapeHtml(p.title)}" style="--x: ${x.at(p.x)}; --y: ${1 - y.at(p.y)}">${whiskers.filter(Boolean).join('')}${p.mark ?? '<span class="stats-chart__pip"></span>'}</${tag}>`;
};

/**
 * Points over two linear axes, drawn in the given order.
 * `points`: `{ x, y, xi?, yi?, mark?, href?, title, thin? }`; `xi`/`yi` are `[lo, hi]` whiskers, `mark` is HTML.
 * `x`, `y`: `{ head, format, ref?, minStep?, steps?, range? }`; `head` is HTML, `range` (`[lo, hi]`) overrides the point extent.
 * Whiskers clip to the domain.
 */
export function scatterChart(el, { points, x: xAxis, y: yAxis }) {
  const x = scale(xAxis, points.map((p) => p.x));
  const y = scale(yAxis, points.map((p) => p.y));
  const vline = (v, cls) => `<line class="${cls}" x1="${pct(x.at(v))}" x2="${pct(x.at(v))}" y1="0" y2="100%"/>`;
  const hline = (v, cls) => `<line class="${cls}" x1="0" x2="100%" y1="${pct(1 - y.at(v))}" y2="${pct(1 - y.at(v))}"/>`;
  const yTicks = y.ticks.map((t) => `${hline(t, 'stats-chart__grid')}<text class="stats-chart__tick" x="-6" y="${pct(1 - y.at(t))}" text-anchor="end" dominant-baseline="middle">${escapeHtml(yAxis.format(t))}</text>`);
  const refs = [xAxis.ref == null ? '' : vline(xAxis.ref, 'stats-chart__ref'), yAxis.ref == null ? '' : hline(yAxis.ref, 'stats-chart__ref')];
  el.innerHTML = `<div class="stats-chart stats-chart--scatter">
    <div class="stats-chart__head">${yAxis.head}</div>
    <div class="stats-chart__area">
      <svg class="stats-chart__plot" aria-hidden="true">${x.ticks.map((t) => vline(t, 'stats-chart__grid')).join('')}${yTicks.join('')}${refs.join('')}</svg>
      ${points.map((p) => dot(p, x, y, xAxis, yAxis)).join('')}
    </div>
    ${axis(x.at, x.ticks, xAxis.format)}
    <div class="stats-chart__head num">${xAxis.head}</div>
  </div>`;
  fitAxes(el);
}

const ramp = (ref, mid) =>
  ref == null
    ? { color: (t) => `color-mix(in srgb, var(--accent-blue) ${pct(clamp01(t))}, var(--bg-card))`, key: 'var(--bg-card), var(--accent-blue)' }
    : {
        color: (t) => {
          const k = t < mid ? (mid - t) / (mid || 1) : (t - mid) / (1 - mid || 1);
          return `color-mix(in srgb, var(${t < mid ? '--danger' : '--success-light'}) ${pct(clamp01(k))}, var(--bg-card))`;
        },
        key: `var(--danger), var(--bg-card) ${pct(mid)}, var(--success-light)`,
      };

const compact = (n) => (n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`);

/** Minimum cell size in rem per set of label lines. */
const LABEL_STEPS = [
  [4, ['value', 'ci', 'n']],
  [3, ['value', 'n']],
  [2, ['n']],
  [0, []],
];

const LINE = 1.2;

const cellText = (x, y, lines) =>
  lines.length
    ? `<text x="${x}" y="${y}">${lines.map((l, k) => `<tspan x="${x}" dy="${k ? LINE : (-(lines.length - 1) * LINE) / 2}em">${escapeHtml(l)}</tspan>`).join('')}</text>`
    : '';

const cellLabels = new WeakMap();

const LABEL_PAD = 6;

/** Draws the largest label step whose cell size and text widths fit. */
const fitLabels = (plot) => {
  const { cols, draw } = cellLabels.get(plot);
  const cell = plot.getBoundingClientRect().width / cols;
  if (plot.dataset.cell === cell.toFixed(1)) return;
  plot.dataset.cell = cell.toFixed(1);
  const size = cell / parseFloat(getComputedStyle(document.documentElement).fontSize);
  const g = plot.querySelector('.stats-chart__labels');
  const fits = () => [...g.children].every((t) => t.getBBox().width + LABEL_PAD <= cell);
  const [step] = LABEL_STEPS.filter(([min]) => size >= min - 0.01).find(([, fields]) => ((g.innerHTML = draw(fields)), fits()));
  plot.dataset.step = step;
};

const labelObserver = new ResizeObserver((entries) =>
  entries.forEach(({ target }) => (target.isConnected ? fitLabels(target) : labelObserver.unobserve(target))),
);

const heatDomain = (values, ref) => {
  if (ref == null) return extent(values);
  const span = Math.max(...values.map((v) => Math.abs(v - ref)), 0) || 1;
  return [ref - span, ref + span];
};

/**
 * Grid of `rows` x `cols` cells colored by value; diverging around `ref` when given.
 * `rows`: `{ label, title? }`, `label` HTML. `cols`: `{ label, name, title? }`, `label` optional mark HTML, `name` text. `cells[i][j]`: `{ value, title, thin? } | null`.
 * The color domain covers `range` (`[lo, hi]`) when given, else non-thin cells when any exist; others clamp.
 */
export function heatmapChart(el, { rows, cols, cells, head, format, ref = null, minStep = 0, steps = [], range = null }) {
  const all = cells.flat().filter((c) => c?.value != null);
  const solid = all.filter((c) => !c.thin);
  const values = range ?? (solid.length ? solid : all).map((c) => c.value);
  const { domain } = niceTicks(heatDomain(values, ref), 4, minStep, steps);
  const at = linear(domain);
  const { color, key } = ramp(ref, ref == null ? 0 : at(ref));
  const rects = cells.flatMap((row, i) =>
    row.flatMap((c, j) => {
      if (c?.value == null) return [];
      const geometry = `x="${pct(j / cols.length)}" y="${pct(i / rows.length)}" width="${pct(1 / cols.length)}" height="${pct(1 / rows.length)}"`;
      return [`<rect class="stats-chart__cell${c.thin ? ' is-thin' : ''}" ${geometry} style="fill: ${color(at(c.value))}"><title>${escapeHtml(c.title)}</title></rect>${stripes('rect', geometry, c.thin)}`];
    }),
  );
  const text = (c) => ({ value: format(c.value), ci: c.ci, n: c.n == null ? null : compact(c.n) });
  const draw = (fields) =>
    cells
      .flatMap((row, i) =>
        row.map((c, j) => {
          if (c?.value == null) return '';
          const t = text(c);
          return cellText(pct((j + 0.5) / cols.length), pct((i + 0.5) / rows.length), fields.map((f) => t[f]).filter((l) => l != null));
        }),
      )
      .join('');
  const title = (t) => (t ? ` title="${escapeHtml(t)}"` : '');
  const name = Math.max(...cols.map((c) => c.name.length), 1);
  el.innerHTML = `<div class="stats-chart stats-chart--heatmap" style="--rows: ${rows.length}; --cols: ${cols.length}; --name: min(${name}ch, 8rem)">
    <div class="stats-chart__head">${head[1]}</div>
    <div class="stats-chart__key"><div class="stats-chart__scale" style="background: linear-gradient(90deg, ${key})"></div>${axis(at, ref == null ? domain : [domain[0], ref, domain[1]], format)}</div>
    <div class="stats-chart__head">${head[0]}</div>
    <div class="stats-chart__cols">${cols.map((c) => `<div${title(c.title ?? c.name)}><span class="stats-chart__name">${escapeHtml(c.name)}</span>${c.label ?? ''}</div>`).join('')}</div>
    <svg class="stats-chart__plot">${STRIPES}${rects.join('')}<g class="stats-chart__labels"></g></svg>
    ${rows.map((r) => `<div class="stats-chart__label"${title(r.title)}>${r.label}</div>`).join('')}
  </div>`;
  fitAxes(el);
  const plot = el.querySelector('.stats-chart__plot');
  cellLabels.set(plot, { cols: cols.length, draw });
  labelObserver.observe(plot);
}
