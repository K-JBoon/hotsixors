import { escapeHtml } from './view.js';

const STEPS = [1, 2, 2.5, 5, 10];

/** Round domain covering `[lo, hi]` and about `count` evenly spaced ticks in it, at least `minStep` apart. */
export function niceTicks([lo, hi], count = 5, minStep = 0) {
  if (lo === hi) [lo, hi] = lo ? [Math.min(0, lo), Math.max(0, hi)] : [0, 1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(STEPS.find((s) => s * mag >= raw) * mag, minStep);
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

const plot = (bars, x, ticks, ref) => {
  const y = (i, f) => pct((i + f) / bars.length);
  const zero = x(0);
  const grid = ticks.map((t) => `<line class="stats-chart__grid" x1="${pct(x(t))}" x2="${pct(x(t))}" y1="0" y2="100%"/>`);
  const marks = bars.flatMap((b, i) => {
    if (b.value == null) return [];
    const at = x(b.value);
    const cls = b.thin ? ' is-thin' : '';
    const bar = `<rect class="stats-chart__bar${cls}" x="${pct(Math.min(at, zero))}" width="${pct(Math.abs(at - zero))}" y="${y(i, (1 - BAR) / 2)}" height="${y(0, BAR)}"/>`;
    if (b.interval == null) return [bar];
    const [lo, hi] = b.interval.map(x);
    return [bar, `<line class="stats-chart__whisker ${b.tone ?? ''}${cls}" x1="${pct(lo)}" x2="${pct(hi)}" y1="${y(i, 0.5)}" y2="${y(i, 0.5)}"/>`];
  });
  const rule = (v, cls) => `<line class="${cls}" x1="${pct(x(v))}" x2="${pct(x(v))}" y1="0" y2="100%"/>`;
  return `<svg class="stats-chart__plot" aria-hidden="true">${grid.join('')}${rule(0, 'stats-chart__zero')}${marks.join('')}${ref == null ? '' : rule(ref, 'stats-chart__ref')}</svg>`;
};

const edgeAnchor = (i, n) => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');

const axis = (x, ticks, format, anchor = (i) => edgeAnchor(i, ticks.length)) =>
  `<svg class="stats-chart__axis" aria-hidden="true">${ticks
    .map((t, i) => `<text x="${pct(x(t))}" y="100%" text-anchor="${anchor(i)}">${escapeHtml(format(t))}</text>`)
    .join('')}</svg>`;

/**
 * Horizontal bars from zero, one per entry, in the given order.
 * `bars`: `{ label, value, text, interval?: [lo, hi], tone?, thin? }`; `label` and `text` are HTML.
 * `head`: `[label, value]` HTML. `ref` draws a reference line at that value. `minStep` bounds the tick spacing.
 */
export function barChart(el, { bars, head, format, ref = null, minStep = 0 }) {
  const values = bars.flatMap((b) => [b.value, ...(b.interval ?? [])]);
  const { domain, ticks } = niceTicks(extent([0, ...values, ...(ref == null ? [] : [ref])]), 5, minStep);
  const x = linear(domain);
  const cell = (cls, thin) => (html) => `<div class="stats-chart__${cls}${thin ? ' is-thin' : ''}">${html}</div>`;
  el.innerHTML = `<div class="stats-chart stats-chart--bar" style="--rows: ${bars.length}">
    ${cell('head')(head[0])}${axis(x, ticks, format)}${cell('head num')(head[1])}
    ${plot(bars, x, ticks, ref)}
    ${bars.map((b) => `${cell('label', b.thin)(b.label)}${cell('value num', b.thin)(b.text)}`).join('')}
  </div>`;
}

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
      return [`<circle class="stats-chart__point${p.thin ? ' is-thin' : ''}" cx="${cx}" cy="${cy}" r="${r}"><title>${escapeHtml(p.title)}</title></circle>`];
    });
    return [`<g style="${seriesColor(k)}">${segments.join('')}${points.join('')}</g>`];
  });
  return `<svg class="stats-chart__plot">${grid.join('')}${ref == null ? '' : hline(ref, 'stats-chart__ref')}${lines.join('')}</svg>`;
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
 * `on` flags drawn series; the legend toggles them. The y domain covers drawn series and `ref`.
 */
export function lineChart(el, { xs, series, on, head, format, ref = null, minStep = 0 }) {
  const values = series.flatMap((s, k) => (on[k] ? s.points.map((p) => p?.value) : []));
  const { domain, ticks } = niceTicks(extent([...values, ...(ref == null ? [] : [ref])]), 5, minStep);
  const y = (v) => 1 - linear(domain)(v);
  const step = Math.ceil(xs.length / MAX_X_LABELS);
  const shown = xs.map((_, i) => i).filter((i) => i % step === 0);
  el.innerHTML = `<div class="stats-chart stats-chart--line">
    <div class="stats-chart__head">${head}</div>
    ${linePlot(xs, series, on, y, ticks, format, ref)}
    ${axis((i) => (i + 0.5) / xs.length, shown, (i) => xs[i], () => 'middle')}
    ${legend(series, on)}
  </div>`;
  el.querySelector('.stats-chart__legend')?.addEventListener('click', (e) => {
    const k = e.target.closest('[data-series]')?.dataset.series;
    if (k != null) lineChart(el, { xs, series, on: on.map((v, i) => (i === +k ? !v : v)), head, format, ref, minStep });
  });
}

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

const scale = ({ ref = null, minStep = 0 }, values) => {
  const { domain, ticks } = niceTicks(extent([...values, ...(ref == null ? [] : [ref])]), 5, minStep);
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
 * `x`, `y`: `{ head, format, ref?, minStep? }`; `head` is HTML. Whiskers clip to the domain.
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
}
