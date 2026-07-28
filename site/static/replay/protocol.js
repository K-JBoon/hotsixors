
import DEFAULT_PROTOCOL from './typeinfos.js';
import { BitPackedDecoder, VersionedDecoder } from './decoder.js';

const PROTOCOL_DIR = '/replay/protocols/';

let indexPromise = null;
const protocolCache = new Map();

async function readProtocolJson(name) {
  if (typeof document !== 'undefined') {
    const res = await fetch(PROTOCOL_DIR + name);
    if (!res.ok) throw new Error(`protocol fetch failed: ${name}`);
    return res.json();
  }
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(new URL(`./protocols/${name}`, import.meta.url), 'utf-8'));
}

function loadIndex() {
  if (!indexPromise) indexPromise = readProtocolJson('index.json').catch(() => null);
  return indexPromise;
}
function resolveBuild(index, build) {
  if (index.builds[String(build)]) return Number(build);
  let best = null;
  for (const known of Object.keys(index.builds)) {
    const n = Number(known);
    if (n <= build && (best === null || n > best)) best = n;
  }
  return best ?? index.latest;
}

export async function loadProtocol(build) {
  const index = await loadIndex();
  if (!index) return DEFAULT_PROTOCOL;
  const file = index.builds[String(build ? resolveBuild(index, build) : index.latest)];
  if (!file) return DEFAULT_PROTOCOL;
  if (!protocolCache.has(file)) {
    protocolCache.set(file, readProtocolJson(`${file}.json`).catch(() => DEFAULT_PROTOCOL));
  }
  return protocolCache.get(file);
}

function varuint32Value(value) {
  for (const k of Object.keys(value)) return value[k];
  return 0;
}

function* decodeEventStream(P, decoder, eventidTypeid, eventTypes, decodeUserId) {
  let gameloop = 0;
  while (!decoder.done()) {
    const startBits = decoder.usedBits();
    gameloop += varuint32Value(decoder.instance(P.svaruint32_typeid));
    let userid = null;
    if (decodeUserId) userid = decoder.instance(P.replay_userid_typeid);
    const eventid = decoder.instance(eventidTypeid);
    const type = eventTypes[String(eventid)];
    if (!type) throw new Error(`unknown eventid ${eventid} at gameloop ${gameloop}`);
    const [typeid, typename] = type;
    const event = decoder.instance(typeid);
    event._event = typename;
    event._eventid = eventid;
    event._gameloop = gameloop;
    if (decodeUserId) event._userid = userid;
    decoder.byteAlign();
    event._bits = decoder.usedBits() - startBits;
    yield event;
  }
}

export function* decodeGameEvents(contents, P = DEFAULT_PROTOCOL) {
  const decoder = new BitPackedDecoder(contents, P.typeinfos);
  yield* decodeEventStream(P, decoder, P.game_eventid_typeid, P.game_event_types, true);
}

export function* decodeMessageEvents(contents, P = DEFAULT_PROTOCOL) {
  const decoder = new BitPackedDecoder(contents, P.typeinfos);
  yield* decodeEventStream(P, decoder, P.message_eventid_typeid, P.message_event_types, true);
}

export function* decodeTrackerEvents(contents, P = DEFAULT_PROTOCOL) {
  const decoder = new VersionedDecoder(contents, P.typeinfos);
  yield* decodeEventStream(P, decoder, P.tracker_eventid_typeid, P.tracker_event_types, false);
}

export function decodeHeader(contents, P = DEFAULT_PROTOCOL) {
  return new VersionedDecoder(contents, P.typeinfos).instance(P.replay_header_typeid);
}

export function decodeDetails(contents, P = DEFAULT_PROTOCOL) {
  return new VersionedDecoder(contents, P.typeinfos).instance(P.game_details_typeid);
}

export function decodeInitdata(contents, P = DEFAULT_PROTOCOL) {
  return new BitPackedDecoder(contents, P.typeinfos).instance(P.replay_initdata_typeid);
}

export function unitTag(index, recycle) {
  return index * 262144 + recycle;
}

export { LOOPS_PER_SECOND as GAMELOOPS_PER_SECOND } from './analyze/stat-events.js';
