export const EXAMPLES = [
  {
    name: 'Win rate vs. presence',
    text: 'from draft group hero measure presence = share(count() where kind in ["pick", "ban"]), win = rate(win) where kind = "pick" view scatter',
  },
  {
    name: 'Hero by map',
    text: 'from players group hero, map measure win = delta(rate(win)), games = count() view heatmap',
  },
  {
    name: 'Matchups',
    text: 'from players join opponent group hero, opponent.hero measure win = delta(rate(win)), games = count() view heatmap',
  },
];
