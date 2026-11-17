import { asList, memoryStats, openStats } from './query.js';
import { multiSelect } from './multi-select.js';
import { clearSummaries, deleteSetting, loadSetting, loadSummaries, persistStorage, saveSetting } from './local-store.js';
import { canPickFolder, droppedReplays, folderDiff, hasReadPermission, requestReadPermission, scanReplays, uniqueGames } from './my-replays.js';
import { loadSiteResolver } from './resolve.js';
import { buildTables } from './tables.js';
import {
  STAT_COLUMNS, available, facets, gameList, tournamentReport, tournamentTable, heroReport, mapReport, heroTable, mapTable, playerReport, playerTable, teamReport, teamTable,
} from './reports.js';
import { LIQUIPEDIA_ICON, MISSING_ICON, deltaCell, escapeHtml, fmt, heroCell, heroName, loadHeroes, renderTable, renderTalentTiers, tiles, wilson, winRateCell } from './view.js';

const root = document.querySelector('[data-stats-root]');
const view = root.querySelector('[data-view]');
const form = root.querySelector('[data-filters]');
const status = root.querySelector('[data-stats-status]');
const replayBase = root.dataset.replayBase;
const watchHref = (g) => {
  const q = new URLSearchParams({ url: `${replayBase}/${g.id}.StormReplay` });
  if (g.team0) q.set('team0', g.team0);
  if (g.team1) q.set('team1', g.team1);
  return `/replay/?${q}`;
};
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
const gameActions = (g) => `<div class="stats-actions"><a class="btn btn--sm" href="${watchHref(g)}">Watch</a><a class="btn btn--sm" href="${replayBase}/${g.id}.StormReplay" download="${g.id}.StormReplay" title="Download replay" aria-label="Download replay">${DOWNLOAD_ICON}</a></div>`;

const mine = root.dataset.source === 'personal';
const FILTER_KEYS = ['scope', 'strict', 'tournament', 'player', 'mode', 'map', 'patch', 'from', 'to', 'min', 'per', 'rank', 'show'];
const DEFAULTS = { scope: 'tournament', strict: '1', per: 'game', rank: 'confidence', show: mine ? 'all' : 'draft' };
const SORT_KEYS = ['sort', 'dir'];
const TABS = ['heroes', 'maps', 'players', 'teams', 'tournaments', 'games'];

const MULTI_KEYS = new Set(['tournament', 'player', 'mode', 'map', 'patch']);

const ALL_PATCHES = 'all';
const minorOf = (patch) => patch.split('.').slice(0, 2).join('.');
const recentMinors = (patches, n = 3) => [...new Set(patches.map(minorOf))].slice(0, n);
let defaultPatches = [];
const isDefaultPatch = (v) => v.length === defaultPatches.length && v.every((p) => defaultPatches.includes(p));

const readFilters = () => {
  const q = new URLSearchParams(location.search);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, MULTI_KEYS.has(k) ? q.getAll(k) : q.get(k) ?? DEFAULTS[k] ?? '']));
  filters.patch = q.has('patch') ? filters.patch.filter((p) => p !== ALL_PATCHES) : defaultPatches;
  return mine ? { ...filters, scope: 'all', tournament: [] } : { ...filters, player: [], mode: [] };
};

const toQuery = (filters) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === DEFAULTS[k] || (k === 'scope' && mine)) continue;
    if (k === 'patch') {
      if (!isDefaultPatch(v)) for (const p of v.length ? v : [ALL_PATCHES]) q.append(k, p);
      continue;
    }
    for (const item of asList(v)) q.append(k, item);
  }
  return q;
};

function writeFilters(filters) {
  const current = new URLSearchParams(location.search);
  const q = toQuery(filters);
  for (const k of SORT_KEYS) if (current.has(k)) q.set(k, current.get(k));
  const search = q.toString();
  history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}${location.hash}`);
}

const route = () => {
  const [tab, ...rest] = location.hash.slice(1).split('/');
  return { tab: TABS.includes(tab) || ['hero', 'map', 'player', 'team', 'tournament'].includes(tab) ? tab : 'heroes', arg: decodeURIComponent(rest.join('/')) };
};


/** Applies Min. games when the visitor sets it; otherwise every row stays. */
function minGames(rows, filters, count = (r) => r.games) {
  const min = Number(filters.min);
  if (!min) return { rows };
  const kept = rows.filter((r) => count(r) >= min);
  return {
    rows: kept,
    empty: rows.length && !kept.length ? `No rows with at least ${min} games. Lower Min. games to see more.` : undefined,
  };
}

const link = (hash, label) => `<a href="${escapeHtml(hash)}">${escapeHtml(label)}</a>`;
const hash = (kind, id) => `#${kind}/${encodeURIComponent(id)}`;
const COUNT_STATS = new Set(['kills', 'deaths', 'assists']);
const statCols = (filters) => {
  const perMin = filters.per === 'min';
  return STAT_COLUMNS.map((s) => {
    if (s.per) return { key: s.id, label: s.label, title: 'Takedowns per death', num: true, format: fmt.num };
    const format = COUNT_STATS.has(s.id) ? (perMin ? fmt.num2 : fmt.num) : perMin ? fmt.int : fmt.big;
    return { key: s.id, label: perMin ? `${s.label}/min` : s.label, num: true, format };
  });
};

const urlSort = (sortKey, sortDir = -1) => {
  const q = new URLSearchParams(location.search);
  return {
    sortKey: q.get('sort') ?? sortKey,
    sortDir: q.has('sort') ? (q.get('dir') === 'asc' ? 1 : -1) : sortDir,
    onSort: (key, dir) => {
      const next = new URLSearchParams(location.search);
      next.set('sort', key);
      next.set('dir', dir > 0 ? 'asc' : 'desc');
      history.replaceState(null, '', `${location.pathname}?${next}${location.hash}`);
    },
  };
};
const gamesCol = { key: 'games', label: 'Games', num: true, format: fmt.int };
const winCol = (filters) => ({
  key: 'winRate',
  label: 'Win',
  num: true,
  ...(filters.rank === 'raw' ? {} : { title: 'Sorted by 95% confidence bound', sort: (r, dir) => (r.winRate == null ? null : wilson(r.winRate, r.games)[dir > 0 ? 1 : 0]) }),
  html: (r) => winRateCell(r.winRate, r.games),
});
const pickCols = [
  { key: 'pickRate', label: 'Pick', num: true, format: fmt.pct },
  ...(mine ? [] : [
    { key: 'banRate', label: 'Ban', num: true, format: fmt.pct },
    { key: 'presence', label: 'Presence', title: 'Pick + ban', num: true, format: fmt.pct },
    { key: 'earlyBanRate', label: 'Early ban', title: 'Banned in first phase', num: true, format: fmt.pct },
    { key: 'pickNumber', label: 'Pick #', title: 'Average pick position', num: true, format: fmt.num, sort: (r) => (r.pickNumber == null ? null : -r.pickNumber) },
  ]),
];
/** Draft and score columns of hero tables, per the `show` setting. */
const heroMetricCols = (filters) => [
  ...(filters.show === 'stats' ? [] : pickCols),
  ...(filters.show === 'draft' ? [] : statCols(filters)),
];

/** renderTable with Min. games applied to tables that show a games column. */
function statsTable(el, filters, opts) {
  if (!opts.columns.includes(gamesCol)) return renderTable(el, opts);
  const { rows, empty } = minGames(opts.rows, filters);
  return renderTable(el, { ...opts, rows, empty: empty ?? opts.empty });
}

function section(title, id) {
  const heading = title ? `<h2 class="stats-section__title">${escapeHtml(title)}</h2>` : '';
  return `<section class="stats-section">${heading}<div data-part="${id}"></div></section>`;
}
const row = (...sections) => `<div class="stats-row">${sections.join('')}</div>`;
const part = (el, id) => el.querySelector(`[data-part="${id}"]`);

const heroIcons = (heroes, list) =>
  list.map((h) => heroCell(heroes, h, hash('hero', h)).replace('stats-hero', 'stats-hero stats-hero--icon')).join('');

function gameRows(games, heroes) {
  const side = (g, t) => {
    const name = t === 0 ? g.team0 : g.team1;
    const label = name ? link(hash('team', name), name) : t === 0 ? 'Left' : 'Right';
    return `<span class="stats-side${g.winner === t ? ' is-winner' : ''}">${label}</span>`;
  };
  const lineup = (list) => heroIcons(heroes, list);
  return {
    columns: [
      { key: 'date', label: 'Date', format: fmt.date },
      {
        key: 'tournament',
        label: mine ? 'Mode' : 'Event',
        sort: (g) => g.tournament ?? g.mode ?? '',
        html: (g) => (g.tournament
          ? `${link(hash('tournament', g.tournament), g.tournament)}${g.stage ? `<br><small>${escapeHtml(g.stage)}</small>` : ''}`
          : `<small>${escapeHtml(g.mode ?? 'Custom game')}</small>`),
      },
      { key: 'map', label: 'Map', html: (g) => link(hash('map', g.map), g.map) },
      { key: 'teams', label: 'Teams', sort: (g) => g.team0 ?? '', html: (g) => `${side(g, 0)} vs ${side(g, 1)}` },
      { key: 'heroes', label: 'Heroes', sort: () => 0, html: (g) => `<div class="stats-lineup">${lineup(g.heroes[0])}</div><div class="stats-lineup">${lineup(g.heroes[1])}</div>` },
      { key: 'duration', label: 'Length', num: true, format: fmt.dur },
      ...(mine ? [] : [{ key: 'id', label: '', sort: () => 0, html: gameActions }]),
    ],
    rows: games,
    sortKey: 'date',
    pageSize: 10,
  };
}

const winnerOf = (g) => (g.winner === 0 ? g.team0 : g.winner === 1 ? g.team1 : null);
const sideName = (g, side) => (side === 0 ? g.team0 : side === 1 ? g.team1 : null);
let mapImages;
const mapImage = (map) => {
  mapImages ??= JSON.parse(document.querySelector('[data-map-images]')?.textContent ?? '{}');
  return mapImages[map];
};

function mapStrip(s, g) {
  const picker = g.firstPick == null ? null : sideName(g, 1 - g.firstPick);
  const pickIdx = s.teams.indexOf(picker);
  const winIdx = s.teams.indexOf(winnerOf(g));
  const img = mapImage(g.map);
  const title = `${g.map}${picker ? `, picked by ${picker}` : ''}, won by ${winnerOf(g) ?? 'unknown'}`;
  return `<a class="stats-mapstrip${pickIdx === -1 ? '' : ` is-t${pickIdx}`}" href="${watchHref(g)}" title="${escapeHtml(title)}"${img ? ` style="background-image: url('${escapeHtml(img)}')"` : ''}>
    <span>${escapeHtml(g.map)}</span>${winIdx === -1 ? '' : `<i class="is-t${winIdx}"></i>`}</a>`;
}

function seriesCard(s) {
  const team = (t) => {
    const name = s.teams[t];
    const won = s.wins[t] > s.wins[1 - t];
    return `<div class="stats-series__team is-t${t}${won ? ' stats-side is-winner' : ''}">${name ? link(hash('team', name), name) : '?'}<b>${s.wins[t]}</b></div>`;
  };
  return `<div class="stats-series" data-series="${escapeHtml(s.id)}">${team(0)}${team(1)}<div class="stats-series__maps">${s.games.map((g) => mapStrip(s, g)).join('')}</div></div>`;
}

const cards = (series) => `<div class="stats-cards">${series.map(seriesCard).join('')}</div>`;
const roundLabel = (round, side) => {
  const short = round.replace(/^(upper|lower) bracket /i, '');
  return side && !/grand/i.test(round) ? `${side} ${short.toLowerCase()}` : short;
};

function bracketLine(cols, side, width) {
  if (!cols.length) return '';
  const col = (c) => `<div class="stats-bracket__col" style="grid-column: ${c.at + 1}"><h4>${escapeHtml(roundLabel(c.round, side))}</h4><div class="stats-bracket__cards">${c.series.map(seriesCard).join('')}</div></div>`;
  return `<div class="stats-bracket__line" style="grid-template-columns: repeat(${width}, 13rem)">${cols.map(col).join('')}</div>`;
}

function drawEdges(box, edges) {
  const card = (id) => box.querySelector(`[data-series="${CSS.escape(id)}"]`);
  const draw = () => {
    box.querySelector(':scope > svg')?.remove();
    const base = box.getBoundingClientRect();
    const x = (v) => v - base.left + box.scrollLeft;
    const y = (v) => v - base.top + box.scrollTop;
    const paths = edges.flatMap(({ from, to }) => {
      const a = card(from)?.getBoundingClientRect();
      const b = card(to)?.getBoundingClientRect();
      if (!a || !b) return [];
      const [x1, y1, x2, y2] = [x(a.right), y(a.top + a.height / 2), x(b.left), y(b.top + b.height / 2)];
      const mx = Math.max(x1 + 8, x2 - 12);
      return [`<path d="M${x1},${y1}H${mx}V${y2}H${x2}"/>`];
    });
    box.insertAdjacentHTML('afterbegin', `<svg class="stats-bracket__edges" width="${box.scrollWidth}" height="${box.scrollHeight}" aria-hidden="true">${paths.join('')}</svg>`);
  };
  draw();
  new ResizeObserver(draw).observe(box);
}

function renderPhases(el, phases) {
  const body = (p, i) => {
    if (p.kind === 'bracket') {
      const lower = p.lower.length > 0;
      return `<div class="stats-bracket" data-bracket="${i}">${bracketLine(p.upper, lower ? 'Upper' : '', p.width)}${bracketLine(p.lower, 'Lower', p.width)}</div>`;
    }
    if (p.kind === 'groups') {
      return `<div class="stats-groups">${p.groups.map((g, j) => `<div>
        <h4>${escapeHtml(g.name ?? 'Standings')}</h4>
        <div data-part="standings-${i}-${j}"></div>
        <details class="stats-groups__matches"><summary>Matches</summary>${g.rounds.map((r) => `${r.round ? `<h4>${escapeHtml(r.round)}</h4>` : ''}${cards(r.series)}`).join('')}</details>
      </div>`).join('')}</div>`;
    }
    return p.rounds.map((r) => `${r.round ? `<h4>${escapeHtml(r.round)}</h4>` : ''}${cards(r.series)}`).join('');
  };
  el.innerHTML = phases.map((p, i) => {
    const open = p.name !== phases[i - 1]?.name;
    const close = p.name !== phases[i + 1]?.name;
    return `${open ? `<section class="stats-section"><h2 class="stats-section__title">${escapeHtml(p.name)}</h2>` : ''}${body(p, i)}${close ? '</section>' : ''}`;
  }).join('');
  phases.forEach((p, i) => p.edges && drawEdges(el.querySelector(`[data-bracket="${i}"]`), p.edges));
  phases.forEach((p, i) => p.groups?.forEach((g, j) => renderTable(part(el, `standings-${i}-${j}`), {
    columns: [
      { key: 'team', label: 'Team', html: (x) => link(hash('team', x.team), x.team) },
      { key: 'won', label: 'Series', num: true, html: (x) => `${x.won}–${x.lost}` },
      { key: 'mapsWon', label: 'Maps', num: true, html: (x) => `${x.mapsWon}–${x.mapsLost}` },
    ],
    rows: g.standings,
    sortKey: 'won',
    pageSize: Infinity,
  })));
}

/** Win rate minus `base(row)`, colored when the interval excludes it. */
const deltaCol = (label, title, base) => ({
  key: 'delta',
  label,
  title,
  num: true,
  sort: (x) => (x.winRate == null || base(x) == null ? null : x.winRate - base(x)),
  html: (x) => deltaCell(x.winRate, base(x), x.games),
});

const patchRank = (patch) => patch.split('.').reduce((n, part) => n * 1000 + Number(part), 0);

/** Hero tables for `report.allies` and `report.enemies`, against `base` win rate. */
function companionTables(el, filters, heroes, report, base, whose) {
  for (const [id, rows, label] of [['allies', report.allies, 'Teammate'], ['enemies', report.enemies, 'Opponent']]) {
    statsTable(part(el, id), filters, {
      columns: [
        { key: 'hero', label, sort: (x) => heroName(heroes, x.hero), html: (x) => heroCell(heroes, x.hero, hash('hero', x.hero)) },
        gamesCol, winCol(filters),
        deltaCol(`vs ${whose}`, `Win rate minus ${whose} win rate`, () => base),
      ],
      rows,
      sortKey: 'games',
      pageSize: 10,
    });
  }
}

const lengthLabel = (x) => (x.to == null ? `${x.from / 60}+ min` : x.from ? `${x.from / 60}–${x.to / 60} min` : `Under ${x.to / 60} min`);
function lengthTable(el, filters, rows) {
  statsTable(el, filters, {
    columns: [{ key: 'from', label: 'Length', sort: (x) => -x.from, html: lengthLabel }, gamesCol, winCol(filters)],
    rows,
    sortKey: 'from',
    pageSize: Infinity,
  });
}

const VIEWS = {
  async heroes(stats, filters, heroes, arg, el) {
    el.innerHTML = section(null, 'table');
    statsTable(part(el, 'table'), filters, {
      columns: [
        { key: 'hero', label: 'Hero', sort: (r) => heroName(heroes, r.hero), html: (r) => heroCell(heroes, r.hero, hash('hero', r.hero)) },
        gamesCol, winCol(filters),
        ...heroMetricCols(filters),
      ],
      rows: await heroTable(stats, filters),
      ...urlSort(mine ? 'games' : 'presence'),
      pageSize: Infinity,
    });
  },

  async hero(stats, filters, heroes, slug, el) {
    const [report, talents] = await Promise.all([heroReport(stats, slug, filters), stats.json('talents')]);
    const s = report.summary;
    el.innerHTML = `
      <header class="stats-detail">${heroCell(heroes, slug, `/heroes/${slug}/`)}</header>
      ${row(
        tiles([
          ['Games', fmt.int(s.games)], ['Win rate', winRateCell(s.winRate, s.games)], ['Pick rate', fmt.pct(s.pickRate)],
          ...(mine ? [] : [['Ban rate', fmt.pct(s.banRate)], ['Presence', fmt.pct(s.presence)], ['Early ban', fmt.pct(s.earlyBanRate)], ['Avg pick #', fmt.num(s.pickNumber)]]),
        ]),
        section('Maps', 'maps'),
      )}
      ${section('Talents', 'talents')}${section('Builds', 'builds')}
      ${row(section('With', 'allies'), section('Against', 'enemies'))}
      ${row(section('Patches', 'patches'), section('Game length', 'lengths'))}
      ${section('Players', 'players')}${section('Games', 'games')}`;
    renderTalentTiers(part(el, 'talents'), talents, report.talents, true);
    companionTables(el, filters, heroes, report, s.winRate, 'hero');
    lengthTable(part(el, 'lengths'), filters, report.lengths);
    statsTable(part(el, 'patches'), filters, {
      columns: [
        { key: 'patch', label: 'Patch', sort: (x) => patchRank(x.patch) },
        gamesCol, winCol(filters),
        { key: 'pickRate', label: 'Pick', num: true, format: fmt.pct },
      ],
      rows: report.patches,
      sortKey: 'patch',
      pageSize: 10,
    });
    const talentIcon = (id) => {
      const t = talents[id];
      return t
        ? `<a href="/heroes/${escapeHtml(t.hero)}/#talent-${escapeHtml(id)}" title="${escapeHtml(t.name)}"><img class="stats-portrait" src="/images/abilitytalents/${escapeHtml(t.icon)}" alt="${escapeHtml(t.name)}" loading="lazy"></a>`
        : `<span title="${escapeHtml(id)}">${MISSING_ICON}</span>`;
    };
    statsTable(part(el, 'builds'), filters, {
      columns: [
        { key: 'talents', label: 'Build', title: 'Levels 1 to 16', sort: (b) => b.talents.join(), html: (b) => `<div class="stats-build">${b.talents.map(talentIcon).join('')}</div>` },
        gamesCol, winCol(filters),
        deltaCol('vs hero', 'Win rate minus hero win rate in games through level 16', () => report.buildWinRate),
      ],
      rows: report.builds,
      sortKey: 'games',
      pageSize: 20,
      split: 10,
      empty: 'No builds through level 16 under these filters.',
    });
    statsTable(part(el, 'maps'), filters, { columns: [{ key: 'map', label: 'Map', html: (x) => link(hash('map', x.map), x.map) }, gamesCol, winCol(filters)], rows: report.maps, sortKey: 'games', split: 8 });
    statsTable(part(el, 'players'), filters, {
      columns: [
        { key: 'battletag', label: 'Player', html: (r) => link(hash('player', r.player), r.battletag ?? r.player) },
        gamesCol, winCol(filters), ...statCols(filters),
      ],
      rows: report.players,
      sortKey: 'games',
      pageSize: 10,
    });
    statsTable(part(el, 'games'), filters, gameRows(report.games, heroes));
  },

  async maps(stats, filters, heroes, arg, el) {
    el.innerHTML = section(null, 'table');
    statsTable(part(el, 'table'), filters, {
      columns: [
        { key: 'map', label: 'Map', html: (r) => link(hash('map', r.map), r.map) },
        gamesCol,
        { key: 'duration', label: 'Avg length', num: true, format: fmt.dur },
        ...(asList(filters.player).length ? [winCol(filters)] : []),
        { key: 'firstPickWinRate', label: 'First pick win', num: true, html: (r) => winRateCell(r.firstPickWinRate, r.firstPickGames) },
        { key: 'leftWinRate', label: 'Left side win', num: true, html: (r) => winRateCell(r.leftWinRate, r.sideGames) },
      ],
      rows: await mapTable(stats, filters),
      ...urlSort('games'),
    });
  },

  async map(stats, filters, heroes, name, el) {
    const r = await mapReport(stats, name, filters);
    if (!r.summary) {
      el.innerHTML = '<p class="stats-note">This map has no games under these filters.</p>';
      return;
    }
    const s = r.summary;
    el.innerHTML = `<header class="stats-detail"><h2>${escapeHtml(name)}</h2></header>
      ${tiles([
        ['Games', fmt.int(s.games)],
        ['Avg length', fmt.dur(s.duration)],
        ...(s.winRate !== undefined ? [['Win rate', winRateCell(s.winRate, s.games)]] : []),
        ['First pick win', winRateCell(s.firstPickWinRate, s.firstPickGames)],
        ['Left side win', winRateCell(s.leftWinRate, s.sideGames)],
      ])}
      ${section('Heroes', 'heroes')}${section('Games', 'games')}`;
    statsTable(part(el, 'heroes'), filters, {
      columns: [
        { key: 'hero', label: 'Hero', sort: (x) => heroName(heroes, x.hero), html: (x) => heroCell(heroes, x.hero, hash('hero', x.hero)) },
        gamesCol, winCol(filters),
        deltaCol('vs all maps', 'Win rate minus all-map win rate', (x) => x.baseWinRate),
        ...heroMetricCols(filters),
      ],
      rows: r.heroes,
      sortKey: 'games',
      pageSize: 10,
    });
    statsTable(part(el, 'games'), filters, gameRows(r.games, heroes));
  },

  async players(stats, filters, heroes, arg, el) {
    el.innerHTML = section(null, 'table');
    statsTable(part(el, 'table'), filters, {
      columns: [
        { key: 'battletag', label: 'Player', html: (r) => link(hash('player', r.player), r.battletag ?? r.player) },
        { key: 'team', label: 'Team', html: (r) => (r.team ? link(hash('team', r.team), r.team) : '–') },
        gamesCol, winCol(filters),
        { key: 'heroes', label: 'Heroes', num: true, format: fmt.int },
        { key: 'topHero', label: 'Most played', sort: (r) => heroName(heroes, r.topHero), html: (r) => heroCell(heroes, r.topHero, hash('hero', r.topHero)) },
        ...statCols(filters).slice(0, 4),
        { key: 'lastPlayed', label: 'Last game', format: fmt.date },
      ],
      rows: await playerTable(stats, filters),
      search: { placeholder: 'Player or team', text: (r) => `${r.battletag ?? r.player} ${r.team ?? ''}` },
      ...urlSort('games'),
      pageSize: 10,
    });
  },

  async player(stats, filters, heroes, id, el) {
    const r = await playerReport(stats, id, filters);
    if (!r.summary) {
      el.innerHTML = '<p class="stats-note">This player has no games under these filters.</p>';
      return;
    }
    const signature = [...r.heroes].sort((a, b) => b.games - a.games).slice(0, 5).map((x) => x.hero);
    el.innerHTML = `
      <header class="stats-detail"><h2>${escapeHtml(r.summary.battletag ?? id)}</h2></header>
      ${row(
        tiles([
          ['Games', fmt.int(r.summary.games)], ['Win rate', winRateCell(r.summary.winRate, r.summary.games)],
          ...(mine ? [] : [['Events played in', fmt.int(r.summary.events)]]),
          ['Signature heroes', `<div class="stats-lineup">${heroIcons(heroes, signature)}</div>`],
        ]),
        ...(mine ? [] : [section('Teams', 'teams')]),
        section('Maps', 'maps'),
      )}
      ${section('Heroes', 'heroes')}
      ${row(section('With', 'allies'), section('Against', 'enemies'), section('Game length', 'lengths'))}
      ${section('Games', 'games')}`;
    companionTables(el, filters, heroes, r, r.summary.winRate, 'player');
    lengthTable(part(el, 'lengths'), filters, r.lengths);
    statsTable(part(el, 'heroes'), filters, {
      columns: [{ key: 'hero', label: 'Hero', sort: (x) => heroName(heroes, x.hero), html: (x) => heroCell(heroes, x.hero, hash('hero', x.hero)) }, gamesCol, winCol(filters), ...statCols(filters)],
      rows: r.heroes,
      sortKey: 'games',
      pageSize: 10,
    });
    if (!mine) statsTable(part(el, 'teams'), filters, { columns: [{ key: 'team', label: 'Team', html: (x) => link(hash('team', x.team), x.team) }, gamesCol, winCol(filters)], rows: r.teams, sortKey: 'games', empty: 'No tournament games.' });
    statsTable(part(el, 'maps'), filters, { columns: [{ key: 'map', label: 'Map', html: (x) => link(hash('map', x.map), x.map) }, gamesCol, winCol(filters)], rows: r.maps, sortKey: 'games', split: 8 });
    statsTable(part(el, 'games'), filters, gameRows(r.games, heroes));
  },

  async teams(stats, filters, heroes, arg, el) {
    el.innerHTML = section(null, 'table');
    statsTable(part(el, 'table'), filters, {
      columns: [
        { key: 'team', label: 'Team', html: (r) => link(hash('team', r.team), r.team) },
        gamesCol, winCol(filters),
        { key: 'players', label: 'Players', num: true, format: fmt.int },
        { key: 'tournaments', label: 'Events', num: true, format: fmt.int },
        { key: 'lastPlayed', label: 'Last game', format: fmt.date },
      ],
      rows: await teamTable(stats, filters),
      search: { placeholder: 'Team', text: (r) => r.team },
      ...urlSort('games'),
    });
  },

  async team(stats, filters, heroes, name, el) {
    const r = await teamReport(stats, name, filters);
    el.innerHTML = `<header class="stats-detail"><h2>${escapeHtml(name)}</h2></header>
      ${section('Roster', 'roster')}${row(section('Heroes picked', 'heroes'), section('Bans', 'bans'), section('Maps', 'maps'))}${section('Games', 'games')}`;
    statsTable(part(el, 'roster'), filters, {
      columns: [
        { key: 'battletag', label: 'Player', html: (x) => link(hash('player', x.player), x.battletag ?? x.player) },
        gamesCol, winCol(filters),
        { key: 'topHero', label: 'Most played', html: (x) => heroCell(heroes, x.topHero, hash('hero', x.topHero)) },
      ],
      rows: r.roster,
      sortKey: 'games',
      split: 8,
    });
    statsTable(part(el, 'heroes'), filters, { columns: [{ key: 'hero', label: 'Hero', html: (x) => heroCell(heroes, x.hero, hash('hero', x.hero)) }, gamesCol, winCol(filters)], rows: r.heroes, sortKey: 'games', pageSize: 10 });
    statsTable(part(el, 'bans'), filters, { columns: [{ key: 'hero', label: 'Hero', html: (x) => heroCell(heroes, x.hero, hash('hero', x.hero)) }, { key: 'bans', label: 'Bans', num: true, format: fmt.int }], rows: r.bans, sortKey: 'bans', pageSize: 10, empty: 'No bans recorded.' });
    statsTable(part(el, 'maps'), filters, { columns: [{ key: 'map', label: 'Map', html: (x) => link(hash('map', x.map), x.map) }, gamesCol, winCol(filters)], rows: r.maps, sortKey: 'games', split: 8 });
    statsTable(part(el, 'games'), filters, gameRows(r.games, heroes));
  },

  async tournaments(stats, filters, heroes, arg, el) {
    el.innerHTML = section(null, 'table');
    statsTable(part(el, 'table'), filters, {
      columns: [
        { key: 'name', label: 'Tournament', html: (t) => link(hash('tournament', t.name), t.name) },
        gamesCol,
        { key: 'first', label: 'First game', format: fmt.date },
        { key: 'last', label: 'Last game', format: fmt.date },
        { key: 'url', label: 'Liquipedia', sort: () => 0, html: (t) => (t.url ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">Page</a>` : '–') },
      ],
      rows: await tournamentTable(stats, filters),
      search: { placeholder: 'Tournament', text: (t) => t.name },
      ...urlSort('last'),
    });
  },

  async tournament(stats, filters, heroes, name, el) {
    const r = await tournamentReport(stats, name, filters);
    const { info, summary: s } = r;
    const page = info?.url ? `<a class="stats-liquipedia" href="${escapeHtml(info.url)}" target="_blank" rel="noopener" title="Liquipedia" aria-label="Liquipedia">${LIQUIPEDIA_ICON}</a>` : '';
    el.innerHTML = `<header class="stats-detail"><h2>${escapeHtml(name)}</h2>${page}</header>
      ${row(
        tiles([['Games', fmt.int(s.games)], ['Teams', fmt.int(s.teams)], ['Players', fmt.int(s.players)], ['Avg length', s.duration == null ? '–' : fmt.dur(s.duration)]]),
        section('Teams', 'teams'),
        section('Maps', 'maps'),
      )}
      <div class="stats-phases" data-part="rounds"></div>${section('Heroes', 'heroes')}${section('Games', 'games')}`;
    renderPhases(part(el, 'rounds'), r.phases);
    statsTable(part(el, 'teams'), filters, { columns: [{ key: 'team', label: 'Team', html: (x) => link(hash('team', x.team), x.team) }, gamesCol, winCol(filters)], rows: r.teams, sortKey: 'games', pageSize: 10 });
    statsTable(part(el, 'maps'), filters, {
      columns: [{ key: 'map', label: 'Map', html: (x) => link(hash('map', x.map), x.map) }, gamesCol, { key: 'duration', label: 'Avg length', num: true, format: fmt.dur }],
      rows: r.maps,
      sortKey: 'games',
      split: 8,
    });
    statsTable(part(el, 'heroes'), filters, {
      columns: [
        { key: 'hero', label: 'Hero', sort: (x) => heroName(heroes, x.hero), html: (x) => heroCell(heroes, x.hero, hash('hero', x.hero)) },
        gamesCol, winCol(filters),
        ...heroMetricCols(filters),
      ],
      rows: r.heroes,
      sortKey: 'games',
      pageSize: 10,
    });
    statsTable(part(el, 'games'), filters, { ...gameRows(r.games, heroes), sortDir: 1 });
  },

  async games(stats, filters, heroes, arg, el) {
    el.innerHTML = section(null, 'table');
    statsTable(part(el, 'table'), filters, {
      ...gameRows(await gameList(stats, filters), heroes),
      ...urlSort('date'),
      search: {
        placeholder: 'Event, map, team or hero',
        text: (g) => [g.tournament, g.stage, g.mode, g.map, g.team0, g.team1, ...g.heroes.flat().map((h) => heroName(heroes, h))].join(' '),
      },
    });
  },
};


const minorGroups = (patches) => Object.fromEntries([...new Set(patches.map(minorOf))].map((m) => [m, `${m}.x`]));

const PICKER_OPTS = { player: { allLabel: 'Everyone' } };
const pickers = new Map(
  [...form.querySelectorAll('[data-multi]')].map((el) => [el.dataset.multi, multiSelect(el, PICKER_OPTS[el.dataset.multi])]),
);
const picker = (name) => pickers.get(name);

let currentFacets = null;
let fillToken = 0;

/** Options with data under the other filters; picked values stay listed. */
async function fillFilters(stats, f, filters) {
  currentFacets = f;
  const token = ++fillToken;
  const avail = await available(stats, filters);
  if (token !== fillToken) return;
  const shown = (key, value, group) => avail[key].has(value) || filters[key].includes(value) || (group != null && filters[key].includes(group));
  const plain = (key, values) => values.filter((v) => shown(key, v)).map((v) => ({ value: v, label: v }));
  picker('tournament')?.setOptions(plain('tournament', f.tournaments.map((t) => t.name)), filters.tournament);
  picker('mode')?.setOptions(plain('mode', f.modes), filters.mode);
  picker('map')?.setOptions(plain('map', f.maps), filters.map);
  picker('player')?.setOptions(
    f.people.filter((p) => shown('player', p.key)).map((p) => ({ value: p.key, label: `${p.battletag ?? p.key} (${p.games})` })),
    filters.player,
  );
  const patches = f.patches.filter((p) => shown('patch', p, minorOf(p)));
  picker('patch')?.setOptions(
    patches.map((p) => ({ value: p, label: p, group: minorOf(p) })),
    filters.patch,
    minorGroups(f.patches),
  );
  for (const k of FILTER_KEYS) {
    const el = form.elements[k];
    if (!el || MULTI_KEYS.has(k)) continue;
    if (el instanceof RadioNodeList) {
      for (const radio of el) radio.checked = radio.value === filters[k];
    } else el.value = filters[k];
  }
}

const PARENT_TAB = { hero: 'heroes', map: 'maps', player: 'players', team: 'teams', tournament: 'tournaments' };

let renderToken = 0;

async function render(stats, heroes) {
  const token = ++renderToken;
  const filters = readFilters();
  const { tab, arg } = route();
  if (mine && (tab === 'teams' || tab === 'team' || tab === 'tournaments' || tab === 'tournament')) {
    location.hash = 'heroes';
    return;
  }
  for (const a of root.querySelectorAll('[data-tab]')) {
    const active = a.dataset.tab === (PARENT_TAB[tab] ?? tab);
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  view.setAttribute('aria-busy', 'true');
  view.style.minHeight = `${view.offsetHeight}px`;
  const el = document.createElement('div');
  el.className = 'stats-view__body';
  view.replaceChildren(el);
  try {
    await VIEWS[tab](stats, filters, heroes, arg, el);
  } catch (error) {
    el.innerHTML = `<p class="stats-note">Could not build this view: ${escapeHtml(String(error?.message ?? error))}</p>`;
  }
  if (token !== renderToken) return;
  view.style.minHeight = '';
  view.removeAttribute('aria-busy');
}

function bindFilters(stats, heroes) {
  form.addEventListener('change', () => {
    const data = new FormData(form);
    const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, MULTI_KEYS.has(k) ? data.getAll(k).map(String) : String(data.get(k) ?? '')]));
    writeFilters(filters);
    if (currentFacets) fillFilters(stats, currentFacets, readFilters());
    render(stats, heroes);
  });
  form.addEventListener('reset', (e) => {
    e.preventDefault();
    writeFilters({});
    if (currentFacets) fillFilters(stats, currentFacets, readFilters());
    render(stats, heroes);
  });
  window.addEventListener('hashchange', () => {
    const q = new URLSearchParams(location.search);
    if (SORT_KEYS.some((k) => q.has(k))) {
      SORT_KEYS.forEach((k) => q.delete(k));
      history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
    }
    window.scrollTo(0, 0);
    render(stats, heroes);
  });
}

async function competitive(heroes) {
  const stats = await openStats(root.dataset.statsBase);
  const f = await facets(stats);
  defaultPatches = recentMinors(f.patches);
  await fillFilters(stats, f, readFilters());
  return stats;
}

const CHECK_INTERVAL_MS = 60_000;
const mineEls = (name) => [...root.querySelectorAll(`[data-mine-${name}]`)];
const setText = (name, text) => mineEls(name).forEach((el) => (el.textContent = text));

async function localStats(summaries, resolver, talents) {
  const games = uniqueGames([...summaries.values()]);
  const tables = buildTables(games, resolver);
  return memoryStats(tables, {
    games: tables.games[0].data.length,
    tournaments: [],
    scoreColumns: tables.scoreColumns,
    json: { talents },
  });
}

async function myReplays(heroes) {
  const [resolver, talents] = await Promise.all([
    loadSiteResolver(),
    openStats(root.dataset.statsBase).then((s) => s.json('talents')).catch(() => ({})),
  ]);
  let stats = null;
  let known = new Map();
  let bound = false;
  const show = async (summaries) => {
    known = summaries;
    stats = await localStats(summaries, resolver, talents);
    root.classList.toggle('is-empty', stats.meta.games === 0);
    status.textContent = '';
    if (!stats.meta.games) {
      root.classList.remove('is-loading');
      return;
    }
    const f = await facets(stats, { people: true });
    defaultPatches = recentMinors(f.patches);
    const filters = readFilters();
    if (!filters.player.length && f.people[0] && !new URLSearchParams(location.search).has('player')) {
      filters.player = [f.people[0].key];
      writeFilters(filters);
    }
    await fillFilters(stats, f, filters);
    if (!bound) {
      bindFilters({ columns: (...a) => stats.columns(...a), names: (...a) => stats.names(...a), json: (n) => stats.json(n), get meta() { return stats.meta; } }, heroes);
      bound = true;
    }
    await render(stats, heroes);
    root.classList.remove('is-loading');
  };

  let scanning = false;
  const scan = async (folder, { prune = false } = {}) => {
    if (scanning) return;
    scanning = true;
    const bars = mineEls('progress');
    bars.forEach((b) => (b.hidden = false));
    persistStorage();
    try {
      let removed = 0;
      const summaries = await scanReplays(folder, {
        workerUrl: root.dataset.workerUrl,
        prune,
        onProgress: (progress) => {
          const { done, total, found } = progress;
          removed = progress.removed;
          for (const b of bars) {
            b.max = Math.max(total, 1);
            b.value = done;
          }
          setText('status', total ? `Reading replays: ${done} of ${total} new (${found} found)` : `${found} replays found, nothing new.`);
        },
      });
      const last = bars[0]?.value ?? 0;
      const changes = [last && `added ${last}`, removed && `removed ${removed} no longer in the folder`].filter(Boolean).join(', ');
      setText('status', !summaries.size ? 'No .StormReplay files in that folder.' : changes ? `Synced: ${changes}.` : 'Up to date.');
      await show(summaries);
    } catch (error) {
      setText('status', `Scan failed: ${error?.message ?? error}`);
    } finally {
      bars.forEach((b) => (b.hidden = true));
      scanning = false;
    }
  };

  const showFolder = async () => {
    const synced = await loadSetting('lastSync').catch(() => null);
    const el = mineEls('folder')[0];
    el.hidden = !synced;
    el.textContent = synced ? `Synced ${fmt.ago(synced)}` : '';
  };
  const syncFrom = async (source, handle = null) => {
    await (handle ? saveSetting('folder', handle) : deleteSetting('folder'));
    await scan(source, { prune: Boolean(handle) });
    await saveSetting('lastSync', new Date().toISOString());
    mineEls('folder')[0].hidden = true;
    await check({ force: true });
  };

  const setSyncState = (label, pending) => mineEls('sync').forEach((el) => {
    el.textContent = label;
    el.classList.toggle('btn--primary', pending);
  });
  let checking = false;
  let lastCheck = 0;
  const check = async ({ force = false } = {}) => {
    if (checking || scanning || (!force && Date.now() - lastCheck < CHECK_INTERVAL_MS)) return;
    checking = true;
    lastCheck = Date.now();
    try {
      const handle = await loadSetting('folder').catch(() => null);
      if (!handle || !(await hasReadPermission(handle))) {
        setSyncState('Sync', true);
        return;
      }
      const { todo, removed } = await folderDiff(handle, known);
      const changes = [todo.length && `${todo.length} new`, removed.length && `${removed.length} removed`].filter(Boolean).join(', ');
      setSyncState(changes ? `Sync (${changes})` : 'Up to date', Boolean(changes));
    } catch {
      setSyncState('Sync', true);
    } finally {
      checking = false;
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('focus', () => check());
  const pickFolder = async () => {
    if (!canPickFolder()) {
      mineEls('input')[0].click();
      return;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'hots-replays', mode: 'read' });
    } catch {
      return;
    }
    await syncFrom(handle, handle);
  };
  const sync = async (prompt) => {
    const handle = await loadSetting('folder').catch(() => null);
    if (!handle) return prompt ? pickFolder() : undefined;
    const allowed = prompt ? await requestReadPermission(handle) : await hasReadPermission(handle);
    if (allowed) await syncFrom(handle, handle);
  };

  mineEls('pick').forEach((el) => el.addEventListener('click', pickFolder));
  mineEls('sync').forEach((el) => el.addEventListener('click', () => sync(true)));
  mineEls('input')[0].addEventListener('change', (e) => {
    const files = e.target.files;
    syncFrom(files);
  });
  mineEls('clear').forEach((el) => el.addEventListener('click', async () => {
    if (!confirm('Forget all parsed replays on this device? The replay files stay, but a new sync parses them again.')) return;
    await Promise.all([clearSummaries(), ...['folder', 'lastSync'].map(deleteSetting)]);
    setText('status', '');
    await showFolder();
    await show(new Map());
  }));

  let depth = 0;
  const dragging = (on) => document.body.classList.toggle('is-dragging-file', on);
  document.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    dragging(true);
  });
  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) dragging(false);
  });
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    depth = 0;
    dragging(false);
    const { handle, files } = await droppedReplays(e.dataTransfer);
    if (handle) syncFrom(handle, handle);
    else syncFrom(files);
  });

  await Promise.all([show(await loadSummaries()), showFolder()]);
  await sync(false);
  check({ force: true });
}

async function main() {
  status.textContent = 'Loading stats…';
  try {
    const heroes = await loadHeroes();
    if (mine) {
      await myReplays(heroes);
      return;
    }
    const stats = await competitive(heroes);
    bindFilters(stats, heroes);
    await render(stats, heroes);
    status.textContent = '';
  } catch (error) {
    root.classList.replace('is-loading', 'is-empty');
    status.textContent = `Could not load stats: ${error?.message ?? error}`;
  }
}

main();
