// Converts heroprotocol's protocol*.py decoding tables into JSON the browser
// parser loads per replay build. Emits one deduplicated file per distinct
// table set plus an index mapping build number -> file, and regenerates
// typeinfos.js from the newest protocol as the parser's default tables.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { HEROPROTOCOL_VERSIONS, SITE_STATIC } from "./lib/paths.ts";
import { readAssignment, type PyValue } from "./lib/python-literal.ts";

const TABLE_FIELDS = ["typeinfos", "game_event_types", "message_event_types", "tracker_event_types"] as const;

const TYPEID_FIELDS = [
  "game_eventid_typeid",
  "message_eventid_typeid",
  "tracker_eventid_typeid",
  "svaruint32_typeid",
  "replay_userid_typeid",
  "replay_header_typeid",
  "game_details_typeid",
  "replay_initdata_typeid",
] as const;

interface Protocol {
  protocol_version: string;
  [field: string]: PyValue | string;
}

function parseProtocol(source: string, version: string): Protocol {
  const out: Protocol = { protocol_version: version };
  for (const field of TABLE_FIELDS) {
    const value = readAssignment(source, field);
    if (value === undefined) throw new Error(`${version}: missing ${field}`);
    out[field] = value;
  }
  for (const field of TYPEID_FIELDS) {
    const value = readAssignment(source, field);
    if (typeof value !== "number") throw new Error(`${version}: missing or non-int ${field}`);
    out[field] = value;
  }
  return out;
}

// Key order decides the dedup hash, so serialize the fields in a fixed order.
function serialize(protocol: Protocol): string {
  const ordered: Record<string, unknown> = {};
  for (const field of [...TABLE_FIELDS, ...TYPEID_FIELDS]) ordered[field] = protocol[field];
  return JSON.stringify(ordered);
}

async function main(): Promise<void> {
  console.log("gen-replay-protocols: starting");
  const files = (await readdir(HEROPROTOCOL_VERSIONS))
    .filter((f) => /^protocol\d+\.py$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (files.length === 0) throw new Error(`no protocol files in ${HEROPROTOCOL_VERSIONS}`);

  const outDir = path.join(SITE_STATIC, "replay", "protocols");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const builds: Record<string, string> = {};
  const tables = new Map<string, string>(); // hash -> serialized tables
  const sharedBy = new Map<string, number[]>(); // hash -> builds decoding with them
  let newest: Protocol | null = null;

  for (const file of files) {
    const build = Number(file.match(/\d+/)![0]);
    const source = await readFile(path.join(HEROPROTOCOL_VERSIONS, file), "utf-8");
    const protocol = parseProtocol(source, `protocol${build}`);
    newest = protocol;

    const body = serialize(protocol);
    const hash = createHash("sha1").update(body).digest("hex").slice(0, 12);
    tables.set(hash, body);
    if (!sharedBy.has(hash)) sharedBy.set(hash, []);
    sharedBy.get(hash)!.push(build);
    builds[String(build)] = hash;
  }

  for (const [hash, body] of tables) {
    const withBuilds = { protocol_builds: sharedBy.get(hash), ...JSON.parse(body) };
    await writeFile(path.join(outDir, `${hash}.json`), JSON.stringify(withBuilds), "utf-8");
  }

  const buildNumbers = Object.keys(builds).map(Number).sort((a, b) => a - b);
  await writeFile(
    path.join(outDir, "index.json"),
    JSON.stringify({ builds, latest: buildNumbers[buildNumbers.length - 1] }),
    "utf-8"
  );

  const defaults = { ...JSON.parse(serialize(newest!)), protocol_version: newest!.protocol_version };
  await writeFile(
    path.join(SITE_STATIC, "replay", "typeinfos.js"),
    `// Generated from heroprotocol ${newest!.protocol_version} by gen-replay-protocols.ts. Do not edit by hand.\n` +
      `export default ${JSON.stringify(defaults)};\n`,
    "utf-8"
  );

  console.log(
    `gen-replay-protocols: ${files.length} builds, ${tables.size} distinct tables -> ${path.relative(process.cwd(), outDir)}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
