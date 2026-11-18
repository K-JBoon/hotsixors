import { escapeHtml } from '../view.js';
import { MEASURES, query, clause, fn, measure } from './model.js';
import { printQuery } from './text.js';
import { MEASURE_DOCS, CLAUSE_DOCS } from './docs.js';

const m = (name, kind, args, where) => measure(name, fn(kind, args, where));

const MEASURE_EXAMPLES = {
  count: query({ group: ['hero'], measures: [m('games', 'count')] }),
  present: query({ measures: [m('matched', 'present', ['tournament'])] }),
  sum: query({ group: ['player'], measures: [m('solo_kills', 'sum', ['score_SoloKill'])] }),
  mean: query({ group: ['map'], measures: [m('length', 'mean', ['duration_s'])] }),
  rate: query({ from: 'draft', group: ['hero'], measures: [m('bans', 'rate', ['kind', 'ban'])] }),
  distinct: query({ group: ['hero'], measures: [m('players', 'distinct', ['player'])] }),
  ratio: query({ group: ['hero'], measures: [m('dpm', 'ratio', ['score_HeroDamage', 'duration_s', 60])] }),
  mode: query({ group: ['player'], measures: [m('main', 'mode', ['hero'])] }),
  latest: query({ group: ['player'], measures: [m('name', 'latest', ['name', 'date'])] }),
  share: query({ from: 'draft', group: ['hero'], measures: [m('bans', 'share', [fn('count', [], [clause('kind', '=', 'ban')])])] }),
  delta: query({ group: ['hero', 'map'], measures: [m('win', 'delta', [fn('rate', ['win'])])] }),
};

const byHero = { group: ['hero'], measures: [m('games', 'count')] };

const CLAUSE_EXAMPLES = {
  SELECT: query({ measures: [m('rows', 'count')] }),
  FROM: query({ from: 'draft', measures: [m('rows', 'count')] }),
  JOIN: query({ joins: ['game'], group: ['game.stage'], measures: [m('rows', 'count')] }),
  WHERE: query({ ...byHero, where: [clause('patch', '=', '2.55'), clause('strict', '=', true)] }),
  'GROUP BY': query(byHero),
  FILTER: query({ group: ['hero'], measures: [m('wins', 'count', [], [clause('win', '=', true)])] }),
  'ORDER BY': query({ ...byHero, sort: { by: 'games', dir: 'desc' } }),
  LIMIT: query({ ...byHero, sort: { by: 'games', dir: 'desc' }, limit: 10 }),
  VIEW: query({ ...byHero, view: 'bar' }),
};

const signature = (kind) => `${kind}(${MEASURES[kind].params.join(', ')})`;

/** Reference entries; `example` is a query object, `text` its printed form. */
export const REFERENCE = [
  {
    title: 'Measures',
    entries: Object.keys(MEASURES).map((kind) => ({ head: signature(kind), doc: MEASURE_DOCS[kind], example: MEASURE_EXAMPLES[kind] })),
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

/** Measure and clause reference for the Query tab rail. */
export function referenceRail(el) {
  el.innerHTML = REFERENCE.map(group).join('');
}
