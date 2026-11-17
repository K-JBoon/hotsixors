export const EXAMPLES = [
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
];
