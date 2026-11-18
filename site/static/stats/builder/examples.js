import { parseQuery, printQuery } from './text.js';

const EXAMPLES = [
  {
    name: 'Win rate vs. presence',
    text: `SELECT hero,
       share(count() FILTER (WHERE kind IN ('pick', 'ban'))) AS presence,
       rate(win) FILTER (WHERE kind = 'pick') AS win
FROM draft
GROUP BY hero
VIEW scatter`,
  },
  {
    name: 'Hero by map',
    text: `SELECT hero, map, delta(rate(win)) AS win, count() AS games
FROM players
GROUP BY hero, map
VIEW heatmap`,
  },
  {
    name: 'Matchups',
    text: `SELECT hero, opponent.hero, delta(rate(win)) AS win, count() AS games
FROM players JOIN opponent
GROUP BY hero, opponent.hero
VIEW heatmap`,
  },
  {
    name: 'Talent pairs',
    text: `SELECT talent_pair.a,
       talent_pair.b,
       talent_pair.tiers,
       delta(rate(win)) AS win,
       count() AS games
FROM players JOIN talent_pair
WHERE hero = 'valla'
GROUP BY talent_pair.a, talent_pair.b
FACET BY talent_pair.tiers
VIEW heatmap`,
  },
];

export const withWhere = (where, text) => {
  const q = parseQuery(text);
  return printQuery({ ...q, where: [...where, ...q.where] });
};

export const examples = (where) => EXAMPLES.map((e) => ({ ...e, text: withWhere(where, e.text) }));
