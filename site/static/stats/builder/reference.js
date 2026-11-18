import { escapeHtml } from '../view.js';
import { METRICS, query, clause, fn, metric } from './model.js';
import { printQuery } from './text.js';
import { METRIC_DOCS, CLAUSE_DOCS } from './docs.js';

const m = (name, kind, args, where) => metric(name, fn(kind, args, where));

const METRIC_EXAMPLES = {
  count: query({ dimensions: ['hero'], metrics: [m('games', 'count')] }),
  present: query({ metrics: [m('matched', 'present', ['tournament'])] }),
  sum: query({ dimensions: ['player'], metrics: [m('solo_kills', 'sum', ['score_SoloKill'])] }),
  mean: query({ dimensions: ['map'], metrics: [m('length', 'mean', ['duration_s'])] }),
  rate: query({ from: 'draft', dimensions: ['hero'], metrics: [m('bans', 'rate', ['kind', 'ban'])] }),
  distinct: query({ dimensions: ['hero'], metrics: [m('players', 'distinct', ['player'])] }),
  ratio: query({ dimensions: ['hero'], metrics: [m('dpm', 'ratio', ['score_HeroDamage', 'duration_s', 60])] }),
  mode: query({ dimensions: ['player'], metrics: [m('main', 'mode', ['hero'])] }),
  latest: query({ dimensions: ['player'], metrics: [m('name', 'latest', ['name', 'date'])] }),
  share: query({ from: 'draft', dimensions: ['hero'], metrics: [m('bans', 'share', [fn('count', [], [clause('kind', '=', 'ban')])])] }),
  delta: query({ dimensions: ['hero', 'map'], metrics: [m('win', 'delta', [fn('rate', ['win'])])] }),
};

const byHero = { dimensions: ['hero'], metrics: [m('games', 'count')] };

const CLAUSE_EXAMPLES = {
  SELECT: query({ metrics: [m('rows', 'count')] }),
  FROM: query({ from: 'draft', metrics: [m('rows', 'count')] }),
  JOIN: query({ joins: ['game'], dimensions: ['game.stage'], metrics: [m('rows', 'count')] }),
  WHERE: query({ ...byHero, where: [clause('patch', '=', '2.55'), clause('strict', '=', true)] }),
  'GROUP BY': query(byHero),
  FILTER: query({ dimensions: ['hero'], metrics: [m('wins', 'count', [], [clause('win', '=', true)])] }),
  'ORDER BY': query({ ...byHero, sort: { by: 'games', dir: 'desc' } }),
  LIMIT: query({ ...byHero, sort: { by: 'games', dir: 'desc' }, limit: 10 }),
  VIEW: query({ ...byHero, view: 'bar' }),
};

const signature = (kind) => `${kind}(${METRICS[kind].params.join(', ')})`;

/** Reference entries; `example` is a query object, `text` its printed form. */
export const REFERENCE = [
  {
    title: 'Metrics',
    entries: Object.keys(METRICS).map((kind) => ({ head: signature(kind), doc: METRIC_DOCS[kind], example: METRIC_EXAMPLES[kind] })),
  },
  {
    title: 'Clauses',
    entries: Object.keys(CLAUSE_DOCS).map((c) => ({ head: c, doc: CLAUSE_DOCS[c], example: CLAUSE_EXAMPLES[c] })),
  },
].map((g) => ({ ...g, entries: g.entries.map((e) => ({ ...e, text: printQuery(e.example) })) }));

const entry = ({ head, doc, text }) =>
  `<dt><code>${escapeHtml(head)}</code></dt><dd>${escapeHtml(doc)}<pre class="stats-query__example"><code>${escapeHtml(text)}</code></pre></dd>`;

const group = ({ title, entries }) =>
  `<div class="card stats-query__table"><details><summary>${escapeHtml(title)} <span class="stats-note">${entries.length}</span></summary><dl class="stats-query__cols stats-query__ref">${entries.map(entry).join('')}</dl></details></div>`;

/** Metric and clause reference for the Query tab rail. */
export function referenceRail(el) {
  el.innerHTML = REFERENCE.map(group).join('');
}
