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
  {
    name: 'Win rate by patch',
    allPatches: true,
    text: `SELECT patch, hero, rate(win) AS win
FROM players
WHERE hero IN ('hanzo', 'blaze', 'johanna', 'dehaka', 'malfurion', 'muradin', 'sylvanas', 'rehgar')
GROUP BY patch, hero
HAVING count() >= 100
VIEW line`,
  },
  {
    name: 'Ban rate',
    text: `SELECT hero, share(count()) AS bans
FROM draft
WHERE kind = 'ban'
GROUP BY hero
ORDER BY bans DESC
LIMIT 20
VIEW bar`,
  },
  {
    name: 'First picks',
    text: `SELECT hero, share(count()) AS first
FROM draft
WHERE kind = 'pick' AND "order" = 4
GROUP BY hero
ORDER BY first DESC
LIMIT 20
VIEW bar`,
  },
  {
    name: 'Pick and ban by map',
    text: `SELECT hero, map, kind, share(count()) AS share
FROM draft
GROUP BY hero, map
FACET BY kind
VIEW heatmap`,
  },
  {
    name: 'Best duos',
    text: `SELECT hero, teammate.hero, delta(rate(win)) AS win, count() AS games
FROM players JOIN teammate
GROUP BY hero, teammate.hero
HAVING count() >= 50
VIEW heatmap`,
  },
  {
    name: 'Team hero pools',
    text: `SELECT team_name, distinct(hero) AS heroes, mode(hero) AS top
FROM players
WHERE team_name != NULL
GROUP BY team_name
ORDER BY heroes DESC`,
  },
  {
    name: 'Popularity by map',
    text: `SELECT hero, map, share(count()) AS picks
FROM players
GROUP BY hero
FACET BY map
ORDER BY picks DESC
LIMIT 10
VIEW bar`,
  },
  {
    name: 'Game length by map',
    text: `SELECT map, mean(duration_s) AS seconds
FROM players
GROUP BY map
ORDER BY seconds DESC
VIEW bar`,
  },
  {
    name: 'Mercs vs. win rate',
    text: `SELECT hero, mean(score_MercCampCaptures) AS mercs, rate(win) AS win
FROM players
GROUP BY hero
VIEW scatter`,
  },
  {
    name: 'Win rate by game length',
    text: `SELECT hero, game_length, delta(rate(win)) AS win, count() AS games
FROM players
GROUP BY hero, game_length
VIEW heatmap`,
  },
  {
    name: 'First-pick advantage',
    text: `SELECT map, rate(win) AS win
FROM players
WHERE picked_first = TRUE
GROUP BY map
ORDER BY win DESC
VIEW bar`,
  },
];

export const withWhere = (where, text) => {
  const q = parseQuery(text);
  return printQuery({ ...q, where: [...where, ...q.where] });
};

const withoutPatch = (where) => where.filter((c) => c.col !== 'patch');

export const examples = (where) =>
  EXAMPLES.map(({ allPatches, ...e }) => ({ ...e, text: withWhere(allPatches ? withoutPatch(where) : where, e.text) }));
