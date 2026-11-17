// Builds the aggregate replay stats tables from the replays on R2.
//
//   npm run gen:replay-stats                 summarize new replays, publish tables
//   npm run gen:replay-stats -- --limit 500  cap the replays summarized this run
//   npm run gen:replay-stats -- --local      also write site/static/stats/data for zola serve
//
// One summary per replay is cached (cache/replay-stats locally, stats/ on R2),
// keyed by replay id and SUMMARY_VERSION, so a run only parses new replays.
// Tables are content-hashed Parquet files; stats/v1/meta.json points at the
// current set. Needs `npm run gen` output (hero pages, maps.json, hero-units.json).

import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { parquetWriteBuffer } from "hyparquet-writer";
import { writeBinary, writeJson } from "./lib/fs.ts";
import { SITE_DATA_HEROES, SITE_STATIC } from "./lib/paths.ts";
import { pool } from "./lib/pool.ts";
import { r2FromEnv, type R2Bucket } from "./lib/r2.ts";
import { loadResolver } from "./lib/replay-stats/resolve.ts";
import { loadTournaments, tournamentEvents, type TournamentInfo } from "./lib/replay-stats/tournaments.ts";
import { runScript } from "./lib/script.ts";
import { MPQArchive } from "../site/static/replay/mpq.js";
import { SUMMARY_VERSION, summarizeReplay } from "../site/static/replay/summary.js";
import { buildTables } from "../site/static/stats/tables.js";

interface Summary {
  id: string;
  v: number;
  error?: string;
  [key: string]: unknown;
}
type Table = { name: string; type: string; data: unknown[] }[];

const BUCKET = process.env.R2_REPLAYS_BUCKET ?? "hotsixors-nexus";
const REPLAY_ID = /^[0-9a-f]{32}$/;
const TABLES_PREFIX = "stats/v1/";
const SUMMARIES_KEY = `stats/summaries.v${SUMMARY_VERSION}.ndjson.gz`;
const LOCAL_CACHE = path.resolve("cache/replay-stats", `summaries.v${SUMMARY_VERSION}.ndjson`);
const LOCAL_OUT = path.join(SITE_STATIC, "stats/data");
const CONCURRENCY = 6;
const CHECKPOINT_EVERY = 500;

// Buffers, not one string: the cache outgrows V8's max string length.
const toNdjson = (summaries: Summary[]) => Buffer.concat(summaries.map((s) => Buffer.from(`${JSON.stringify(s)}\n`)));

function fromNdjson(bytes: Buffer): Summary[] {
  const out: Summary[] = [];
  for (let start = 0; start < bytes.length; ) {
    const end = bytes.indexOf(10, start);
    const stop = end === -1 ? bytes.length : end;
    if (stop > start) {
      const s = JSON.parse(bytes.toString("utf-8", start, stop)) as Summary;
      if (s.v === SUMMARY_VERSION) out.push(s);
    }
    start = stop + 1;
  }
  return out;
}

async function loadSummaries(r2: R2Bucket): Promise<Map<string, Summary>> {
  const local = await readFile(LOCAL_CACHE).catch(() => null);
  const gz = local ? null : await r2.get(SUMMARIES_KEY);
  const bytes = local ?? (gz ? gunzipSync(gz) : Buffer.alloc(0));
  return new Map(fromNdjson(bytes).map((s) => [s.id, s]));
}

async function saveSummaries(r2: R2Bucket | null, summaries: Map<string, Summary>): Promise<void> {
  const bytes = toNdjson([...summaries.values()].sort((a, b) => a.id.localeCompare(b.id)));
  await writeBinary(LOCAL_CACHE, bytes);
  if (r2) await r2.put(SUMMARIES_KEY, gzipSync(bytes), "application/gzip", "no-store");
}

async function summarize(r2: R2Bucket, id: string): Promise<Summary> {
  try {
    const bytes = await r2.get(`replays/${id}.StormReplay`);
    if (!bytes) throw new Error("missing on R2");
    const archive = new MPQArchive(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return { id, ...(await summarizeReplay(archive)) } as Summary;
  } catch (error) {
    return { id, v: SUMMARY_VERSION, error: String((error as Error)?.message ?? error) } as Summary;
  }
}

// Rows repeat per game, so a spread sample sees only unique values and the writer skips the dictionary.
const DICTIONARY_COLUMNS = new Set(["game_id", "date"]);

function toParquet(table: Table, repeated: boolean): Uint8Array {
  return new Uint8Array(parquetWriteBuffer({
    columnData: table.map((c) => ({
      name: c.name,
      type: c.type as never,
      data: c.data as never,
      ...(repeated && DICTIONARY_COLUMNS.has(c.name) ? { encoding: "RLE_DICTIONARY" as const } : {}),
      ...(c.type === "INT32" && c.name.startsWith("score_") ? { encoding: "DELTA_BINARY_PACKED" as const } : {}),
    })),
    rowGroupSize: 50_000,
  }));
}

interface TalentInfo {
  name: string;
  icon: string;
  hero: string;
  tier: string;
}

// Replays name talents by their button id; the stats UI needs a label and icon.
async function talentIndex(): Promise<Record<string, TalentInfo>> {
  const index: Record<string, TalentInfo> = {};
  for (const file of (await readdir(SITE_DATA_HEROES)).filter((f) => f.endsWith(".json")).sort()) {
    const hero = path.basename(file, ".json");
    const data = JSON.parse(await readFile(path.join(SITE_DATA_HEROES, file), "utf-8"));
    for (const t of data.talents ?? []) {
      index[t.nameId] ??= { name: t.name, icon: t.icon, hero, tier: t.tier };
    }
  }
  return index;
}

const hashOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "all" },
      local: { type: "boolean", default: false },
      "no-upload": { type: "boolean", default: false },
    },
  });
  const limit = values.limit === "all" ? Infinity : Number(values.limit);
  const upload = !values["no-upload"];
  const r2 = r2FromEnv(BUCKET);

  const [resolver, { games: tournamentGames, tournaments }, summaries] = await Promise.all([
    loadResolver(),
    loadTournaments(),
    loadSummaries(r2),
  ]);
  const ids = (await r2.list("replays/")).map((key) => path.basename(key, ".StormReplay")).filter((id) => REPLAY_ID.test(id));
  const todo = ids.filter((id) => !summaries.has(id)).slice(0, limit);
  console.log(`summaries: ${summaries.size} cached, ${ids.length} replays on R2, summarizing ${todo.length}`);

  let done = 0;
  await pool(todo, CONCURRENCY, async (id) => {
    summaries.set(id, await summarize(r2, id));
    if (++done % CHECKPOINT_EVERY === 0) {
      console.log(`summaries: ${done}/${todo.length}`);
      await saveSummaries(null, summaries);
    }
  });
  if (todo.length) await saveSummaries(upload ? r2 : null, summaries);

  const tables = buildTables([...summaries.values()] as never[], resolver, tournamentEvents(tournamentGames) as never);
  const tournamentInfo: TournamentInfo[] = tournaments
    .map((t) => ({ ...t, ...(tables.events.get(t.name) ?? { games: 0, first: null, last: null }) }))
    .filter((t) => t.games > 0)
    .sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""));
  const failed = new Map<string, number>();
  for (const s of tables.skipped) failed.set(s.reason, (failed.get(s.reason) ?? 0) + 1);
  console.log(`tables: ${tables.games[0].data.length} games, ${tables.players[0].data.length} player rows, skipped ${tables.skipped.length}`, Object.fromEntries(failed));

  const files: Record<string, { key: string; bytes: Uint8Array }> = {};
  for (const name of ["games", "players", "draft"] as const) {
    const bytes = toParquet(tables[name] as Table, name !== "games");
    files[name] = { key: `${name}.${hashOf(bytes)}.parquet`, bytes };
    console.log(`tables: ${files[name].key} ${(bytes.length / 1e6).toFixed(1)} MB`);
  }
  const talentBytes = Buffer.from(JSON.stringify(await talentIndex()));
  files.talents = { key: `talents.${hashOf(talentBytes)}.json`, bytes: talentBytes };

  const meta = {
    version: 1,
    summaryVersion: SUMMARY_VERSION,
    built: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(files).map(([name, f]) => [name, f.key])),
    games: tables.games[0].data.length,
    scoreColumns: tables.scoreColumns,
    tournaments: tournamentInfo,
  };

  if (values.local) {
    await rm(LOCAL_OUT, { recursive: true, force: true });
    for (const f of Object.values(files)) await writeBinary(path.join(LOCAL_OUT, f.key), f.bytes);
    await writeJson(path.join(LOCAL_OUT, "meta.json"), meta);
    console.log(`tables: wrote ${LOCAL_OUT}`);
  }
  if (!upload) return;

  const previous = await r2.get(`${TABLES_PREFIX}meta.json`).then((b) => (b ? JSON.parse(Buffer.from(b).toString()) : null));
  for (const f of Object.values(files)) {
    await r2.put(TABLES_PREFIX + f.key, f.bytes, f.key.endsWith(".json") ? "application/json" : "application/vnd.apache.parquet");
  }
  await r2.put(`${TABLES_PREFIX}meta.json`, JSON.stringify(meta), "application/json", "public, max-age=300");

  // Pages loaded under the previous meta.json may still range-read its files.
  const keep = new Set([...Object.values(meta.files), ...Object.values<string>(previous?.files ?? {})].map((k) => TABLES_PREFIX + k));
  for (const key of await r2.list(TABLES_PREFIX)) {
    if (/\.(parquet|json)$/.test(key) && !key.endsWith("meta.json") && !keep.has(key)) await r2.delete(key);
  }
  console.log(`tables: published ${TABLES_PREFIX}meta.json`);
}

runScript(import.meta.url, main);
