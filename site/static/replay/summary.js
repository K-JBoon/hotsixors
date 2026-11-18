import { decodeDetails, decodeHeader, decodeInitdata, decodeTrackerEvents, loadProtocol } from './protocol.js';
import { LOOPS_PER_SECOND, statData, str, teamFromInt } from './analyze/stat-events.js';

// Bump when the summary shape or its extraction rules change; cached summaries
// with another version are rebuilt.
export const SUMMARY_VERSION = 4;

const FILETIME_EPOCH_MS = 11644473600000;
const GAME_MODES = {
  50001: 'Quick Match',
  50021: 'Versus AI',
  50031: 'Brawl',
  50041: 'Practice',
  50051: 'Unranked Draft',
  50061: 'Hero League',
  50071: 'Team League',
  50091: 'Storm League',
  50101: 'ARAM',
};
const NOT_SCORES = /^Tier\dTalent$|^Role$/;

const filetimeToIso = (t) => {
  const ms = Number(t) / 10000 - FILETIME_EPOCH_MS;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
};

const versionOf = (v) => (v ? `${v.m_major}.${v.m_minor}.${v.m_revision}.${v.m_build}` : null);

const toonKey = (toon) => (toon && toon.m_id ? `${toon.m_region}-${toon.m_realm}-${toon.m_id}` : null);

// The lobby blob is undocumented, but every player's BattleTag appears in it
// as `<name>#<digits>`.
function battletags(lobby, names) {
  if (!lobby) return names.map(() => null);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(lobby);
  return names.map((name) => {
    if (!name) return null;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}#(\\d{3,7})(?!\\d)`, 'u'));
    return match ? `${name}#${match[1]}` : null;
  });
}

function readFile(archive, name) {
  try {
    return archive.readFile(name);
  } catch {
    return null;
  }
}

/**
 * Game-level facts for aggregate stats: no positions, no game events. Hero and
 * map identities stay raw (CHero id, hero unit, localized title + map hashes)
 * so callers resolve them against their own tables.
 */
export async function summarizeReplay(archive) {
  const baseBuild = decodeHeader(archive.userData).m_version?.m_baseBuild ?? null;
  const protocol = await loadProtocol(baseBuild);
  const header = decodeHeader(archive.userData, protocol);
  const details = decodeDetails(archive.readFile('replay.details'), protocol);

  const initData = readFile(archive, 'replay.initData');
  const lobby = initData ? decodeInitdata(initData, protocol).m_syncLobbyState : null;
  const ammId = lobby?.m_gameDescription?.m_gameOptions?.m_ammId ?? null;
  const lobbyHero = new Map((lobby?.m_lobbyState?.m_slots ?? []).map((s) => [s.m_workingSetSlotId, str(s.m_hero) || null]));
  const names = details.m_playerList.map((p) => str(p.m_name));
  const tags = battletags(readFile(archive, 'replay.server.battlelobby'), names);
  const players = details.m_playerList.map((p, i) => ({
    slot: i,
    team: p.m_teamId,
    name: names[i],
    battletag: tags[i],
    toon: toonKey(p.m_toon),
    heroName: str(p.m_hero),
    heroLobby: lobbyHero.get(p.m_workingSetSlotId ?? i) ?? null,
    heroPick: null,
    heroUnit: null,
    win: p.m_result === 1 ? true : p.m_result === 2 ? false : null,
    talents: [],
    score: {},
  }));
  const byTrackerId = (id) => players[id - 1];
  const bySlotId = new Map(details.m_playerList.map((p, i) => [p.m_workingSetSlotId ?? i, players[i]]));

  const draft = [];
  const teamLevels = [[], []];
  const tracker = readFile(archive, 'replay.tracker.events');
  for (const ev of tracker ? decodeTrackerEvents(tracker, protocol) : []) {
    switch (ev._event) {
      case 'NNet.Replay.Tracker.SHeroBannedEvent':
        draft.push({ kind: 'ban', team: teamFromInt(ev.m_controllingTeam), hero: str(ev.m_hero) });
        break;
      case 'NNet.Replay.Tracker.SHeroPickedEvent': {
        const p = bySlotId.get(ev.m_controllingPlayer);
        if (p) p.heroPick = str(ev.m_hero);
        draft.push({ kind: 'pick', team: p ? p.team : null, hero: str(ev.m_hero) });
        break;
      }
      case 'NNet.Replay.Tracker.SHeroSwappedEvent': {
        const p = bySlotId.get(ev.m_newControllingPlayer);
        if (p) p.heroPick = str(ev.m_hero);
        break;
      }
      case 'NNet.Replay.Tracker.SUnitBornEvent': {
        const p = byTrackerId(ev.m_controlPlayerId);
        const unit = str(ev.m_unitTypeName);
        if (p && !p.heroUnit && unit.startsWith('Hero')) p.heroUnit = unit;
        break;
      }
      case 'NNet.Replay.Tracker.SStatGameEvent': {
        const name = str(ev.m_eventName);
        const p = byTrackerId(statData(ev, 'm_intData', 'PlayerID'));
        if (name === 'TalentChosen' && p) p.talents.push(str(statData(ev, 'm_stringData', 'PurchaseName')));
        if (name === 'LevelUp' && teamLevels[p?.team]) {
          const level = statData(ev, 'm_intData', 'Level');
          const levels = teamLevels[p.team];
          if (level > (levels.at(-1)?.level ?? 1)) levels.push({ level, timeS: Math.round(ev._gameloop / LOOPS_PER_SECOND) });
        }
        break;
      }
      case 'NNet.Replay.Tracker.SScoreResultEvent':
        for (const inst of ev.m_instanceList) {
          const key = str(inst.m_name);
          if (NOT_SCORES.test(key)) continue;
          inst.m_values.forEach((slot, slotId) => {
            const p = bySlotId.get(slotId);
            const value = slot && slot[0] ? slot[0].m_value : null;
            if (p && value != null) p.score[key] = Number(value);
          });
        }
        break;
    }
  }

  const winner = players.find((p) => p.win === true)?.team ?? null;
  const firstPick = draft.find((d) => d.kind === 'pick')?.team ?? null;
  return {
    v: SUMMARY_VERSION,
    version: versionOf(header.m_version),
    gameMode: GAME_MODES[ammId] ?? 'Custom',
    build: header.m_version?.m_build ?? null,
    baseBuild,
    date: filetimeToIso(details.m_timeUTC),
    durationS: Math.round((header.m_elapsedGameLoops ?? 0) / LOOPS_PER_SECOND),
    mapTitle: str(details.m_title),
    mapHashes: cacheHashes(details),
    winner,
    firstPick,
    players,
    draft,
    teamLevels,
  };
}

// Each handle is a 4-byte type, a 4-byte region, then the file's sha256.
export function cacheHashes(details) {
  const hex = [];
  for (const handle of details.m_cacheHandles || []) {
    if (!(handle instanceof Uint8Array) || handle.length < 40) continue;
    hex.push(Array.from(handle.subarray(8, 40), (b) => b.toString(16).padStart(2, '0')).join(''));
  }
  return hex;
}
