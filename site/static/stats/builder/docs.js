import { STAT_COLUMNS } from '../reports.js';

export const TABLE_DOCS = {
  players: 'One row per player per game, 10 rows per game.',
  games: 'One row per game.',
  draft: 'One row per hero ban or pick; games without a draft have no rows.',
};

export const JOIN_DOCS = {
  game: 'Adds the games row of the same game. The row count does not change.',
  teammate: 'Each player row becomes 4 rows, one per teammate. The row of the player is not included.',
  opponent: 'Each player row becomes 5 rows, one per player of the other team.',
};

export const JOIN_ROWS = { game: 1, teammate: 4, opponent: 5 };

const JOIN_ON = {
  game: ['game_id'],
  teammate: ['game_id', 'team', ['slot', '!=']],
  opponent: ['game_id', ['team', '!=']],
};

/** Standard SQL equivalent of `JOIN join` from `base`; `table` is the joined table. */
export const joinSql = (base, join, table) =>
  [
    `LEFT JOIN ${table} AS ${join}`,
    ...JOIN_ON[join]
      .map((k) => (Array.isArray(k) ? k : [k, '=']))
      .map(([col, op], i) => `${i ? 'AND' : ' ON'} ${join}.${col} ${op} ${base}.${col}`),
  ].join('\n');

const COMMON = {
  game_id: 'Unique ID of the game.',
  date: 'Game date and time as an ISO 8601 UTC string.',
  patch: "Game version such as 2.55.3; patch = '2.55' also matches every 2.55.x.",
  build: 'Game build number.',
  game_mode: 'Game mode from the replay, such as Custom.',
  map: 'Map name.',
  tournament: 'Tournament name, null when the game is not matched to a tournament.',
  strict: 'True on a standard map with a hero draft.',
};

const TALENT_TIERS = 7;

const TALENTS = Object.fromEntries(
  Array.from({ length: TALENT_TIERS }, (_, i) => [`talent${i + 1}`, `Talent ID chosen at tier ${i + 1}, null when not chosen.`]),
);

export const COLUMN_DOCS = {
  players: {
    ...COMMON,
    team: 'Team of the player, 0 or 1.',
    slot: 'Lobby slot, 0 to 9.',
    player: 'Battle.net account ID as region-realm-id.',
    battletag: 'BattleTag such as Name#1234.',
    name: 'In-game player name.',
    hero: 'Hero ID such as valla.',
    win: 'True when the team of the player won; a hero on both teams adds a win and a loss.',
    team_name: 'Tournament team name of the player, null outside tournaments.',
    opponent: 'Tournament team name of the other team; opponent.<column> reads the opponent join.',
    duration_s: 'Game length in seconds.',
    ...TALENTS,
  },
  games: {
    ...COMMON,
    duration_s: 'Game length in seconds.',
    winner: 'Team that won, 0 or 1.',
    first_pick: 'Team that made the first hero pick, 0 or 1, null when unknown.',
    stage: 'Bracket stage such as Upper Bracket Final.',
    set_id: 'ID of the match this game belongs to.',
    map_number: 'Position of the game in its match, from 1.',
    team0: 'Tournament team name of team 0.',
    team1: 'Tournament team name of team 1.',
  },
  draft: {
    ...COMMON,
    order: 'Position in the draft sequence, from 0.',
    kind: 'ban or pick.',
    team: 'Team that made the ban or pick, 0 or 1.',
    hero: 'Hero ID such as valla.',
    win: 'True when the team that made the ban or pick won.',
    team_name: 'Tournament team name of the team that made the ban or pick.',
  },
};

export const SCORE_PREFIX = 'score_';

export const SCORE_DOC = 'End-of-game score screen values from the replay, one per player row.';

export const SCORE_LABELS = new Map(STAT_COLUMNS.filter((s) => !s.per).map((s) => [s.col, s.label]));

export const isScore = (col) => col.startsWith(SCORE_PREFIX);

export const columnDoc = (table, col) => COLUMN_DOCS[table]?.[col] ?? (isScore(col) ? SCORE_DOC : null);

export const MEASURE_DOCS = {
  count: 'Number of rows in the group.',
  present: 'Number of rows where the column is not null.',
  sum: 'Sum of the column; null counts as 0.',
  mean: 'Mean of the non-null values of the column.',
  rate: 'Fraction of non-null rows where the column equals the value, TRUE by default.',
  distinct: 'Number of distinct non-null values of the column.',
  ratio: 'Sum of the first column divided by the sum of the second, times the optional scale, over rows where both are not null.',
  mode: 'Most frequent non-null value of the column.',
  latest: 'Value of the first column on the row where the second column is largest, such as the latest name by date.',
  share: 'Inner measure divided by the number of distinct games among all rows that pass WHERE.',
  delta: 'Inner measure minus the same measure grouped by every GROUP BY column except the last.',
};

export const CLAUSE_DOCS = {
  SELECT: 'Lists the GROUP BY columns and the measures, each measure as call AS name.',
  FROM: 'Sets the base table, players or draft.',
  JOIN: 'Adds the columns of a joined table, read as join.column. Works as LEFT JOIN: a row with no match stays, with null joined columns. JOIN teammate JOIN opponent gives 4 × 5 = 20 rows per player row.',
  WHERE: 'Keeps only the rows where every condition is true.',
  'GROUP BY': 'Makes one result row per distinct value of up to two columns; null values make their own group.',
  FILTER: 'Limits one measure to the rows where every condition is true.',
  'ORDER BY': 'Sorts result rows by a measure or GROUP BY column, DESC by default, nulls last.',
  LIMIT: 'Keeps the first n result rows after sorting.',
  VIEW: 'Sets the result display: table, bar, line, scatter or heatmap.',
};
