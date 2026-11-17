// Liquipedia-matched tournament metadata from data/replay-corpus/verified.

import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { parseCsv } from "../csv.ts";
import { REPLAY_CORPUS_DIR } from "../paths.ts";

export interface TournamentGame {
  tournament: string;
  url: string | null;
  setId: string;
  stage: string | null;
  mapNumber: number | null;
  teams: [string, string];
  heroes: [string[], string[]];
  rosters: [Set<string>, Set<string>];
}

export interface Tournament {
  name: string;
  url: string | null;
}

export interface TournamentInfo extends Tournament {
  games: number;
  first: string | null;
  last: string | null;
}

const split = (list: string) => list.split(";").map((s) => s.trim()).filter(Boolean);
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function readCsv(dir: string, file: string): Promise<Record<string, string>[]> {
  try {
    return parseCsv(await readFile(path.join(dir, file), "utf-8"));
  } catch {
    return [];
  }
}

// Section headings that hold a bracket rather than name a round.
const NOT_A_ROUND = /^(participating teams|participants|top \d+ teams|finale teams|bracket|results|playoffs results|participating teams \(top \d+\))$/i;

const roundOf = (position = "") => {
  const round = position.replace(/\{\{[^|}]*\|([^}]*)\}\}/g, "$1").trim();
  return round && !NOT_A_ROUND.test(round) ? round : null;
};

// Page segments under the tournament's common root, minus edition numbers,
// so `Season 1/Group Stage` and `Season 1/Playoffs` split but `Qualifiers/3` does not.
function pageLabels(pages: string[]): (page: string) => string | null {
  const parts = pages.map((p) => p.split("/"));
  let common = 0;
  while (parts.every((p) => p.length > common && p[common] === parts[0][common])) common++;
  return (page) => page.split("/").slice(common).filter((seg) => !/^\d+$/.test(seg)).join(" / ").replace(/_/g, " ") || null;
}

function stageOf(set: Record<string, string> | undefined, pageLabel: (page: string) => string | null): string | null {
  if (!set) return null;
  return [pageLabel(set.source_page ?? ""), roundOf(set.set_position_in_tournament)].filter(Boolean).join(" / ") || null;
}

export async function loadTournaments(): Promise<{ games: Map<string, TournamentGame>; tournaments: Tournament[] }> {
  const root = path.join(REPLAY_CORPUS_DIR, "verified");
  const games = new Map<string, TournamentGame>();
  const tournaments: Tournament[] = [];
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory());

  for (const { name } of dirs) {
    const dir = path.join(root, name);
    const url = (await readFile(path.join(dir, "liquipedia_url.txt"), "utf-8").catch(() => "")).trim() || null;
    tournaments.push({ name, url });

    const sets = new Map((await readCsv(dir, "sets.csv")).map((s) => [s.set_id, s]));
    const pageLabel = pageLabels([...new Set([...sets.values()].map((s) => s.source_page ?? ""))]);
    const maps = new Map((await readCsv(dir, "maps.csv")).map((m) => [m.map_id, m]));
    const tagsOf = new Map<string, string[]>();
    for (const row of await readCsv(dir, "player_battletags.csv")) {
      if (!row.battletag) continue;
      tagsOf.set(normalize(row.liquipedia_player), [...(tagsOf.get(normalize(row.liquipedia_player)) ?? []), row.battletag.toLowerCase()]);
    }
    const rosterOf = new Map<string, Set<string>>();
    for (const team of await readCsv(dir, "teams.csv")) {
      rosterOf.set(team.team_name, new Set(split(team.players).flatMap((p) => tagsOf.get(normalize(p)) ?? [])));
    }

    for (const row of await readCsv(dir, "replay_manifest.csv")) {
      if (row.match_status !== "matched" || !row.replay_id) continue;
      const map = maps.get(row.map_id);
      const teams: [string, string] = [row.team_1, row.team_2];
      games.set(row.replay_id, {
        tournament: name,
        url,
        setId: map?.set_id ?? "",
        stage: stageOf(sets.get(map?.set_id ?? ""), pageLabel),
        mapNumber: map?.map_number_in_set ? Number(map.map_number_in_set) : null,
        teams,
        heroes: [split(map?.team_1_heroes ?? "").map(normalize), split(map?.team_2_heroes ?? "").map(normalize)],
        rosters: [rosterOf.get(teams[0]) ?? new Set(), rosterOf.get(teams[1]) ?? new Set()],
      });
    }
  }
  return { games, tournaments };
}

/** `eventOf` callback for buildTables: tournament and side-ordered team names. */
export function tournamentEvents(games: Map<string, TournamentGame>) {
  return (summary: { id: string; players: Omit<SidePlayer, "heroSlug">[] }, heroOf: (p: any) => string | null) => {
    const t = games.get(summary.id);
    if (!t) return null;
    const side = team1Side(t, summary.players.map((p) => ({ ...p, heroSlug: heroOf(p) })));
    return {
      tournament: t.tournament,
      stage: t.stage,
      setId: t.setId,
      mapNumber: t.mapNumber,
      teams: side == null ? [null, null] : side === 0 ? t.teams : [t.teams[1], t.teams[0]],
    };
  };
}

interface SidePlayer {
  team: number;
  battletag: string | null;
  heroName: string;
  heroSlug: string | null;
}

/**
 * Which replay team (0/1) Liquipedia's team_1 played, from roster BattleTags
 * and the listed hero lineups. Null when the evidence is even.
 */
export function team1Side(game: TournamentGame, players: SidePlayer[]): 0 | 1 | null {
  const evidence = (side: number) => {
    let score = 0;
    for (const p of players) {
      const listed = p.team === side ? 0 : 1;
      const tag = p.battletag?.toLowerCase();
      if (tag && game.rosters[listed].has(tag)) score++;
      const names = [normalize(p.heroName), p.heroSlug ?? ""];
      if (names.some((n) => n && game.heroes[listed].includes(n))) score++;
    }
    return score;
  };
  const a = evidence(0);
  const b = evidence(1);
  return a === b ? null : a > b ? 0 : 1;
}
