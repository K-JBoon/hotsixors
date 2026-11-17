// Mirrors the community replay archive on Proton Drive. Tournament metadata
// lands in data/replay-corpus/verified (committed); replay files go to R2.
//
//   npm run sync:replays                    metadata + every missing replay
//   npm run sync:replays -- --replays 500   cap the replays copied this run
//   npm run sync:replays -- --replays 0     metadata only, no R2 needed
//
// Reads the share link from replay_source in site/config.toml; REPLAY_SHARE_URL
// overrides it. Replays need R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.

import { readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { parseCsv } from "./lib/csv.ts";
import { readFileSafe, readJsonSafe, writeBinary, writeText } from "./lib/fs.ts";
import { REPLAY_CORPUS_DIR, REPO_ROOT } from "./lib/paths.ts";
import { pool } from "./lib/pool.ts";
import { openShare, type ProtonShare, type ShareNode } from "./lib/proton-share.ts";
import { r2FromEnv, type R2Bucket } from "./lib/r2.ts";
import { runScript } from "./lib/script.ts";

const VERIFIED_DIR = path.join(REPLAY_CORPUS_DIR, "verified");
const BUCKET = process.env.R2_REPLAYS_BUCKET ?? "hotsixors-nexus";
const R2_PREFIX = "replays/";
const REPLAY_ID = /^[0-9a-f]{32}$/;
const CONCURRENCY = 4;

interface ExportLatest {
  export_id: string;
  tournaments: number;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function need(share: ProtonShare, folder: ShareNode, name: string): Promise<ShareNode> {
  const node = await share.child(folder, name);
  if (!node) throw new Error(`share: ${folder.name}/${name} is missing`);
  return node;
}

const contentIds = (csv: string | null) =>
  new Map(csv ? parseCsv(csv).map((row) => [row.tournament, row.content_id]) : []);

async function syncTournament(share: ProtonShare, folder: ShareNode): Promise<number> {
  const files = (await share.children(folder)).filter((n) => n.type === "file" && !n.name.endsWith(".StormReplay"));
  const dir = path.join(VERIFIED_DIR, folder.name);
  await rm(dir, { recursive: true, force: true });
  for (const file of files) await writeBinary(path.join(dir, file.name), await share.read(file));
  return files.length;
}

async function syncVerified(share: ProtonShare, verified: ShareNode, force: boolean): Promise<void> {
  const latestBytes = await share.read(await need(share, verified, "latest.json"));
  const latest = JSON.parse(text(latestBytes)) as ExportLatest;
  const local = await readJsonSafe<ExportLatest>(path.join(VERIFIED_DIR, "latest.json"));
  if (!force && local?.export_id === latest.export_id) {
    console.log(`verified: export ${latest.export_id} unchanged`);
    return;
  }

  const manifestBytes = await share.read(await need(share, verified, "export_manifest.csv"));
  const remote = contentIds(text(manifestBytes));
  const known = contentIds(await readFileSafe(path.join(VERIFIED_DIR, "export_manifest.csv")));
  const folders = new Map((await share.children(verified)).filter((n) => n.type === "folder").map((n) => [n.name, n]));

  const changed = [...remote].filter(([name, id]) => force || known.get(name) !== id).map(([name]) => name);
  for (const name of changed) {
    const folder = folders.get(name);
    if (!folder) throw new Error(`share: verified/${name} is listed in export_manifest.csv but missing`);
    console.log(`verified: ${name} (${await syncTournament(share, folder)} files)`);
  }

  const staleDirs = (await readdir(VERIFIED_DIR, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory() && !remote.has(d.name));
  for (const dir of staleDirs) {
    console.log(`verified: dropping ${dir.name}`);
    await rm(path.join(VERIFIED_DIR, dir.name), { recursive: true });
  }

  await writeBinary(path.join(VERIFIED_DIR, "export_manifest.csv"), manifestBytes);
  await writeBinary(path.join(VERIFIED_DIR, "latest.json"), latestBytes);
  console.log(`verified: export ${latest.export_id}, ${changed.length} of ${remote.size} tournaments updated`);
}

async function tournamentReplayIds(): Promise<Set<string>> {
  const dirs = await readdir(VERIFIED_DIR, { withFileTypes: true }).catch(() => []);
  const ids = new Set<string>();
  for (const dir of dirs.filter((d) => d.isDirectory())) {
    const csv = await readFileSafe(path.join(VERIFIED_DIR, dir.name, "replay_manifest.csv"));
    for (const row of csv ? parseCsv(csv) : []) if (REPLAY_ID.test(row.replay_id)) ids.add(row.replay_id);
  }
  return ids;
}

function corpusIds(csv: string): string[] {
  return csv.split("\n").map((line) => line.slice(0, line.indexOf(";"))).filter((id) => REPLAY_ID.test(id));
}

async function syncReplays(share: ProtonShare, replays: ShareNode, r2: R2Bucket, limit: number): Promise<void> {
  const csvBytes = await share.read(await need(share, replays, "parsed_replays.csv"));
  const ids = corpusIds(text(csvBytes));
  const stored = new Set(
    (await r2.list(R2_PREFIX)).map((key) => path.basename(key, ".StormReplay")).filter((id) => REPLAY_ID.test(id)),
  );
  const tournament = await tournamentReplayIds();
  const missing = ids.filter((id) => !stored.has(id)).sort((a, b) => Number(tournament.has(b)) - Number(tournament.has(a)));
  const batch = missing.slice(0, limit);
  console.log(`replays: ${ids.length} listed, ${stored.size} on R2, copying ${batch.length} of ${missing.length} (tournament replays first)`);

  const byId = await need(share, replays, "by-id");
  const shards = new Map((await share.children(byId)).map((n) => [n.name, n]));
  const shardFiles = new Map<string, Promise<Map<string, ShareNode>>>();
  const filesIn = (shard: string) => {
    if (!shardFiles.has(shard)) {
      const node = shards.get(shard);
      shardFiles.set(shard, node
        ? share.children(node).then((files) => new Map(files.map((f) => [f.name, f])))
        : Promise.resolve(new Map()));
    }
    return shardFiles.get(shard)!;
  };

  let done = 0;
  const absent: string[] = [];
  await pool(batch, CONCURRENCY, async (id) => {
    const file = (await filesIn(id.slice(0, 2))).get(`${id}.StormReplay`);
    if (!file) {
      absent.push(id);
      return;
    }
    await r2.put(`${R2_PREFIX}${id}.StormReplay`, await share.read(file), "application/octet-stream");
    if (++done % 100 === 0) console.log(`replays: ${done}/${batch.length}`);
  });

  await r2.put(`${R2_PREFIX}parsed_replays.csv`, csvBytes, "text/csv; charset=utf-8", "public, max-age=300");
  if (absent.length) console.warn(`replays: ${absent.length} listed ids have no file in by-id, e.g. ${absent.slice(0, 5).join(", ")}`);
  console.log(`replays: copied ${done}`);
}

async function configShareUrl(): Promise<string | undefined> {
  const config = await readFileSafe(path.join(REPO_ROOT, "site/config.toml"));
  return config?.match(/^replay_source\s*=\s*"([^"]*)"/m)?.[1];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      replays: { type: "string", default: "all" },
      force: { type: "boolean", default: false },
    },
  });
  const limit = values.replays === "all" ? Infinity : Number(values.replays);
  if (!Number.isInteger(limit) && limit !== Infinity) throw new Error(`--replays wants a count or "all"`);

  const url = process.env.REPLAY_SHARE_URL || (await configShareUrl());
  if (!url?.includes("#")) throw new Error("set replay_source in site/config.toml to the full share link, including its #key");
  const r2 = limit > 0 ? r2FromEnv(BUCKET) : undefined;

  const share = await openShare(url);
  await syncVerified(share, await need(share, share.root, "verified"), values.force);
  if (r2) await syncReplays(share, await need(share, share.root, "replays"), r2, limit);
}

runScript(import.meta.url, main);
