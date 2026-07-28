
import { LOOPS_PER_SECOND, XP_SOURCES } from '../analyze.js';
import { abilityEntryFor } from './abilities.js';
import { clockText, escapeHtml, externalLink, heroUrl, portraitHtml, talentUrl } from './html.js';
import { seekTo } from './playback.js';
import { activeScoreColumns, compactNumber, scoreValues } from './scores.js';
import { root, state, TEAM_COLORS } from './state.js';

export const TALENT_TIERS = [1, 4, 7, 10, 13, 16, 20];
function heroCellHtml(p) {
  const url = heroUrl(p);
  const title = escapeHtml(p.hero);
  return `<th class="hero-cell"><span class="hero-cell__inner">
    ${externalLink(url, portraitHtml(p), 'talent-portrait-link', title)}
    <span class="talent-hero-names">
      ${externalLink(url, `<span class="talent-hero">${title}</span>`, 'talent-hero-link', title)}
      <span class="talent-player">${escapeHtml(p.name)}</span>
    </span>
  </span></th>`;
}
const teamLevel = (model, team) => {
  const levels = model.players.filter((p) => p.team === team).map((p) => Number(p.score.Level ?? 0));
  const level = Math.max(0, ...levels);
  return level || (model.teamLevels[team].at(-1)?.level ?? 0);
};

function teamRowHtml(model, team, columnCount) {
  const level = teamLevel(model, team);
  const label = `${team === 0 ? 'Blue' : 'Red'} team${level ? ` · level ${level}` : ''}`;
  return `<tr class="team-row" style="--team-color:${TEAM_COLORS[team]}">
    <th class="hero-cell">${label}</th>
    <td colspan="${columnCount}"></td>
  </tr>`;
}

function talentTableHtml() {
  const { model, shortcodeData } = state;
  const teamRows = (team) =>
    model.players
      .filter((p) => p.team === team)
      .map((p) => {
        const cells = TALENT_TIERS.map((tier, i) => {
          const pick = p.talents[i];
          if (!pick) return '<td></td>';
          const entry = abilityEntryFor(shortcodeData, p.heroSlug, pick.name);
          const label = entry ? entry.name : pick.name;
          const title = `${escapeHtml(label)} (level ${tier})`;
          const inner =
            entry && entry.icon
              ? `<img class="talent-icon" src="/images/abilitytalents/${entry.icon}" alt="${escapeHtml(label)}">`
              : `<span class="talent-text">${escapeHtml(label)}</span>`;
          return `<td>${externalLink(talentUrl(p, pick.name), inner, 'talent-link', title)}</td>`;
        }).join('');
        return `<tr style="--team-color:${TEAM_COLORS[team]}">
          ${heroCellHtml(p)}
          ${cells}
        </tr>`;
      })
      .join('');
  return `
    <div class="panel-scroll">
    <table class="talent-table">
      <thead><tr><th></th>${TALENT_TIERS.map((t) => `<th>${t}</th>`).join('')}</tr></thead>
      <tbody>${teamRowHtml(model, 0, TALENT_TIERS.length)}${teamRows(0)}</tbody>
      <tbody>${teamRowHtml(model, 1, TALENT_TIERS.length)}${teamRows(1)}</tbody>
    </table>
    </div>`;
}

function scoreTableHtml() {
  const { model } = state;
  const columns = activeScoreColumns(model.players);
  const teamRows = (team) =>
    model.players
      .filter((p) => p.team === team)
      .map((p) => {
        const cells = columns
          .map((col) => {
            const values = scoreValues(p, col);
            const text = col.text ? col.text(values) : compactNumber(values[0]);
            return `<td class="score-cell" title="${col.title}">${text}</td>`;
          })
          .join('');
        return `<tr style="--team-color:${TEAM_COLORS[team]}">
          ${heroCellHtml(p)}
          ${cells}
        </tr>`;
      })
      .join('');
  const head = columns
    .map((col) => `<th class="score-cell" title="${col.title}">${col.label}</th>`)
    .join('');
  return `
    <div class="panel-scroll">
    <table class="talent-table score-table">
      <thead><tr><th></th>${head}</tr></thead>
      <tbody>${teamRowHtml(model, 0, columns.length)}${teamRows(0)}</tbody>
      <tbody>${teamRowHtml(model, 1, columns.length)}${teamRows(1)}</tbody>
    </table>
    </div>`;
}

const XP_CHART = { w: 760, padL: 54, padR: 18, padT: 18, padB: 26, plotH: 260 };
XP_CHART.h = XP_CHART.padT + XP_CHART.plotH + XP_CHART.padB;

const xpText = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v)));
const gameSeconds = (model, loop) =>
  Math.max(0, Math.round((loop - model.gatesOpenLoop) / LOOPS_PER_SECOND));

const emptyXp = () => {
  const s = { level: 0, total: 0 };
  for (const src of XP_SOURCES) s[src.key] = 0;
  return s;
};
function xpSeries(model) {
  const [blue, red] = model.xpBreakdown || [[], []];
  const count = Math.min(blue.length, red.length);
  if (!count) return [];
  const points = [{ loop: model.gatesOpenLoop, secs: 0, teams: [emptyXp(), emptyXp()] }];
  for (let i = 0; i < count; i++) {
    points.push({
      loop: blue[i].loop,
      secs: gameSeconds(model, blue[i].loop),
      teams: [blue[i], red[i]],
    });
  }
  return points;
}
function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const mult = raw / pow;
  return (mult <= 1 ? 1 : mult <= 2 ? 2 : mult <= 5 ? 5 : 10) * pow;
}

function xpChartHtml() {
  const { model } = state;
  const points = xpSeries(model);
  if (points.length < 2) return '<div class="xp-chart__empty">This replay reports no XP breakdown.</div>';
  state.xpPoints = points;

  const { w, h, padL, padR, padT, padB, plotH } = XP_CHART;
  const plotW = w - padL - padR;
  const maxSecs = Math.max(1, points[points.length - 1].secs);
  const peak = Math.max(...points.map((p) => Math.max(p.teams[0].total, p.teams[1].total)));
  const yStep = niceStep(Math.max(1, peak) / 4);
  const yMax = Math.max(yStep, Math.ceil(peak / yStep) * yStep);
  const x = (secs) => padL + (secs / maxSecs) * plotW;
  const y = (v) => padT + (1 - v / yMax) * plotH;

  const yTicks = [];
  for (let v = 0; v <= yMax + 1; v += yStep) yTicks.push(v);
  const xStep = maxSecs > 1500 ? 300 : 120;
  const xTicks = [];
  for (let s = 0; s <= maxSecs; s += xStep) xTicks.push(s);

  const grid = yTicks
    .map(
      (v) => `<line class="xp-grid" x1="${padL}" x2="${w - padR}" y1="${y(v)}" y2="${y(v)}"></line>
        <text class="xp-tick xp-tick--y" x="${padL - 8}" y="${y(v) + 4}">${xpText(v)}</text>`
    )
    .join('');
  const xAxis = xTicks
    .map((s) => `<text class="xp-tick" x="${x(s)}" y="${h - padB + 16}">${clockText(s)}</text>`)
    .join('');
  const band = points
    .slice(1)
    .map((p, i) => {
      const prev = points[i];
      const leader = p.teams[0].total >= p.teams[1].total ? 0 : 1;
      const corners = [
        [x(prev.secs), y(prev.teams[0].total)],
        [x(p.secs), y(p.teams[0].total)],
        [x(p.secs), y(p.teams[1].total)],
        [x(prev.secs), y(prev.teams[1].total)],
      ];
      return `<polygon class="xp-band" points="${corners
        .map(([px, py]) => `${px},${py}`)
        .join(' ')}" fill="${TEAM_COLORS[leader]}"></polygon>`;
    })
    .join('');

  const lines = [0, 1]
    .map(
      (team) =>
        `<polyline class="xp-line" stroke="${TEAM_COLORS[team]}" points="${points
          .map((p) => `${x(p.secs)},${y(p.teams[team].total)}`)
          .join(' ')}"></polyline>`
    )
    .join('');
  const last = points[points.length - 1];
  const ends = [0, 1].map((team) => ({ team, y: y(last.teams[team].total) }));
  const overlap = 13 - Math.abs(ends[0].y - ends[1].y);
  if (overlap > 0) {
    const up = ends[0].y <= ends[1].y ? 0 : 1;
    ends[up].y -= overlap / 2;
    ends[1 - up].y += overlap / 2;
  }
  const endLabels = ends
    .map(
      (e) =>
        `<text class="xp-end" x="${x(last.secs) - 4}" y="${e.y + 4}" fill="${TEAM_COLORS[e.team]}">${xpText(
          last.teams[e.team].total
        )}</text>`
    )
    .join('');

  const legend = [0, 1]
    .map(
      (team) =>
        `<span class="xp-legend__item"><span class="xp-legend__swatch" style="background:${TEAM_COLORS[team]}"></span>${
          team === 0 ? 'Blue' : 'Red'
        } team</span>`
    )
    .join('');

  return `
    <div class="xp-chart" data-xp-chart>
      <div class="xp-legend">${legend}<span class="xp-legend__note">Cumulative team experience · click to jump</span></div>
      <svg class="xp-svg" viewBox="0 0 ${w} ${h}" data-xp-svg role="img" aria-label="Team experience over time">
        ${grid}${xAxis}${band}${lines}${endLabels}
        <line class="xp-cursor" data-xp-cursor x1="${padL}" x2="${padL}" y1="${padT}" y2="${padT + plotH}"></line>
        <line class="xp-hover-line is-off" data-xp-hover-line x1="${padL}" x2="${padL}" y1="${padT}" y2="${
          padT + plotH
        }"></line>
        <circle class="xp-dot is-off" data-xp-dot="0" r="4" fill="${TEAM_COLORS[0]}"></circle>
        <circle class="xp-dot is-off" data-xp-dot="1" r="4" fill="${TEAM_COLORS[1]}"></circle>
        <rect data-xp-hit x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent"></rect>
      </svg>
      <div class="xp-tip" data-xp-tip hidden></div>
    </div>`;
}
function xpTipHtml(point) {
  const cell = (team, value) =>
    `<td class="xp-tip__num" style="color:${TEAM_COLORS[team]}">${value.toLocaleString()}</td>`;
  const rows = XP_SOURCES.map(
    (src) =>
      `<tr><th>${src.label}</th>${cell(0, point.teams[0][src.key])}${cell(1, point.teams[1][src.key])}</tr>`
  ).join('');
  const lead = Math.abs(point.teams[0].total - point.teams[1].total);
  const leader = point.teams[0].total === point.teams[1].total ? null : point.teams[0].total > point.teams[1].total ? 0 : 1;
  return `
    <div class="xp-tip__time">${clockText(point.secs)}</div>
    <table class="xp-tip__table">
      <tr class="xp-tip__head"><th></th><th style="color:${TEAM_COLORS[0]}">Blue</th><th style="color:${TEAM_COLORS[1]}">Red</th></tr>
      <tr><th>Level</th>${cell(0, point.teams[0].level)}${cell(1, point.teams[1].level)}</tr>
      ${rows}
      <tr class="xp-tip__total"><th>Total</th>${cell(0, point.teams[0].total)}${cell(1, point.teams[1].total)}</tr>
    </table>
    <div class="xp-tip__lead">${
      leader == null ? 'Level' : `${leader === 0 ? 'Blue' : 'Red'} ahead by ${lead.toLocaleString()}`
    }</div>`;
}

function initXpChart() {
  const chart = root.querySelector('[data-xp-chart]');
  const points = state.xpPoints;
  if (!chart || !points) return;
  const svg = chart.querySelector('[data-xp-svg]');
  const tip = chart.querySelector('[data-xp-tip]');
  const line = chart.querySelector('[data-xp-hover-line]');
  const dots = [0, 1].map((t) => chart.querySelector(`[data-xp-dot="${t}"]`));
  const hit = chart.querySelector('[data-xp-hit]');
  const svgX = (e) => {
    const box = svg.getBoundingClientRect();
    return ((e.clientX - box.left) / box.width) * XP_CHART.w;
  };
  const maxSecs = Math.max(1, points[points.length - 1].secs);
  const plotW = XP_CHART.w - XP_CHART.padL - XP_CHART.padR;
  const secsAt = (vx) =>
    Math.max(0, Math.min(maxSecs, ((vx - XP_CHART.padL) / plotW) * maxSecs));
  const nearest = (secs) =>
    points.reduce((best, p) => (Math.abs(p.secs - secs) < Math.abs(best.secs - secs) ? p : best));

  const peak = Math.max(...points.map((p) => Math.max(p.teams[0].total, p.teams[1].total)));
  const yStep = niceStep(Math.max(1, peak) / 4);
  const yMax = Math.max(yStep, Math.ceil(peak / yStep) * yStep);

  const move = (e) => {
    const point = nearest(secsAt(svgX(e)));
    const px = XP_CHART.padL + (point.secs / maxSecs) * plotW;
    const yOf = (team) => XP_CHART.padT + (1 - point.teams[team].total / yMax) * XP_CHART.plotH;
    line.classList.remove('is-off');
    line.setAttribute('x1', px);
    line.setAttribute('x2', px);
    dots.forEach((dot, team) => {
      dot.classList.remove('is-off');
      dot.setAttribute('cx', px);
      dot.setAttribute('cy', yOf(team));
    });
    tip.hidden = false;
    tip.innerHTML = xpTipHtml(point);
    const box = chart.getBoundingClientRect();
    const left = e.clientX - box.left;
    tip.style.left = `${Math.min(Math.max(left, 8), box.width - tip.offsetWidth - 8)}px`;
  };
  const leave = () => {
    tip.hidden = true;
    line.classList.add('is-off');
    for (const dot of dots) dot.classList.add('is-off');
  };

  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', leave);
  hit.addEventListener('click', (e) => {
    const secs = secsAt(svgX(e));
    seekTo(state.model.gatesOpenLoop + secs * LOOPS_PER_SECOND);
  });
  updateXpCursor();
}
export function updateXpCursor() {
  const cursor = root.querySelector('[data-xp-cursor]');
  const points = state.xpPoints;
  if (!cursor || !points) return;
  const maxSecs = Math.max(1, points[points.length - 1].secs);
  const plotW = XP_CHART.w - XP_CHART.padL - XP_CHART.padR;
  const secs = Math.min(maxSecs, gameSeconds(state.model, state.loop));
  const px = XP_CHART.padL + (secs / maxSecs) * plotW;
  cursor.setAttribute('x1', px);
  cursor.setAttribute('x2', px);
}
const PANEL_TABS = [
  { id: 'talents', label: 'Talents', html: talentTableHtml },
  { id: 'scores', label: 'Scores', html: scoreTableHtml },
  { id: 'xp', label: 'XP', html: xpChartHtml, init: initXpChart },
];

export function buildPanel() {
  const container = root.querySelector('[data-panel]');
  if (!container) return;
  container.innerHTML = `
    <div class="replay-panel__tabs" role="tablist">
      ${PANEL_TABS.map(
        (t, i) =>
          `<button class="replay-panel__tab${i === 0 ? ' is-on' : ''}" role="tab" aria-selected="${
            i === 0
          }" data-panel-tab="${t.id}">${t.label}</button>`
      ).join('')}
    </div>
    <div class="replay-panel__body" data-panel-body></div>`;
  const body = container.querySelector('[data-panel-body]');
  const show = (id) => {
    const tab = PANEL_TABS.find((t) => t.id === id) || PANEL_TABS[0];
    body.innerHTML = tab.html();
    if (tab.init) tab.init();
    for (const btn of container.querySelectorAll('[data-panel-tab]')) {
      const on = btn.dataset.panelTab === tab.id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', String(on));
    }
  };
  for (const btn of container.querySelectorAll('[data-panel-tab]')) {
    btn.addEventListener('click', () => show(btn.dataset.panelTab));
  }
  show(PANEL_TABS[0].id);
}
