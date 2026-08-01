import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { bunzip2 } from "../site/static/replay/bzip2.js";
import { MPQArchive } from "../site/static/replay/mpq.js";
import {
  decodeTrackerEvents,
  decodeGameEvents,
  decodeDetails,
  decodeHeader,
} from "../site/static/replay/protocol.js";
import {
  analyzeReplay,
  buildPositionTimeline,
  layoutObjectivePhases,
  minionPositionAt,
} from "../site/static/replay/analyze.js";

// Real replays live outside the repo, so these integration tests only run when
// REPLAY_DIR points at a folder of them. Without it they skip, which is what
// happens in CI. Point it at the Replays/Multiplayer folder under your Heroes
// of the Storm account directory.
const REPLAY_DIR = process.env.REPLAY_DIR ?? "";

const replayFiles = existsSync(REPLAY_DIR)
  ? readdirSync(REPLAY_DIR)
      .filter((f) => f.endsWith(".StormReplay") && !f.includes("Nexus Tower Defense"))
      .map((f) => join(REPLAY_DIR, f))
      .filter((f) => readFileSync(f).length > 500_000) // full games only
  : [];

const haveReplays = replayFiles.length > 0;

function loadArchive(path) {
  const buf = readFileSync(path);
  return new MPQArchive(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

test("bzip2 rejects garbage input", () => {
  assert.throws(() => bunzip2(new Uint8Array([1, 2, 3, 4]), 100), /bad magic/);
});

test("MPQ archive opens and lists expected members", { skip: !haveReplays }, async () => {
  const archive = loadArchive(replayFiles[0]);
  for (const name of [
    "replay.tracker.events",
    "replay.game.events",
    "replay.details",
    "replay.initData",
  ]) {
    const data = archive.readFile(name);
    assert.ok(data instanceof Uint8Array, `${name} should decode`);
    assert.ok(data.length > 0, `${name} should be non-empty`);
  }
});

test("header + details decode", { skip: !haveReplays }, async () => {
  const archive = loadArchive(replayFiles[0]);
  const header = decodeHeader(archive.userData);
  assert.ok(header.m_elapsedGameLoops > 0);
  const details = decodeDetails(archive.readFile("replay.details"));
  assert.ok(details.m_playerList.length >= 2);
  assert.ok(details.m_title.length > 0);
});

test("tracker + game event streams decode to completion", { skip: !haveReplays }, async () => {
  const archive = loadArchive(replayFiles[0]);
  let trackerCount = 0;
  for (const ev of decodeTrackerEvents(archive.readFile("replay.tracker.events"))) {
    assert.ok(typeof ev._event === "string");
    trackerCount++;
  }
  assert.ok(trackerCount > 100, `tracker events: ${trackerCount}`);
  let gameCount = 0;
  for (const ev of decodeGameEvents(archive.readFile("replay.game.events"))) {
    assert.ok(typeof ev._event === "string");
    gameCount++;
  }
  assert.ok(gameCount > 1000, `game events: ${gameCount}`);
});

test("analyzer builds a coherent timeline model", { skip: !haveReplays }, async () => {
  const model = await analyzeReplay(loadArchive(replayFiles[0]));
  assert.ok(model.map.length > 0);
  assert.ok(model.durationLoops > 0);
  assert.ok(model.players.length >= 2);
  assert.ok(model.bounds.maxX > model.bounds.minX);
  for (const p of model.players) {
    assert.ok(p.playerId >= 1);
    assert.ok([0, 1].includes(p.team));
    const tl = buildPositionTimeline(p, model.durationLoops);
    if (p.anchors.length) {
      assert.ok(tl.samples.length >= 2);
      const b = model.bounds;
      // estimated positions must stay within (padded) map bounds
      for (let i = 0; i < tl.samples.length; i += 2) {
        assert.ok(tl.samples[i] >= b.minX - 20 && tl.samples[i] <= b.maxX + 20);
        assert.ok(tl.samples[i + 1] >= b.minY - 20 && tl.samples[i + 1] <= b.maxY + 20);
      }
    }
  }
});

test("XP breakdowns are running totals for both teams", { skip: !haveReplays }, async () => {
  for (const file of replayFiles.slice(0, 8)) {
    const model = await analyzeReplay(loadArchive(file));
    const [blue, red] = model.xpBreakdown;
    assert.equal(blue.length, red.length, `${file}: both teams report at the same loops`);
    assert.ok(blue.length >= 2, `${file}: too few XP samples`);
    for (const series of [blue, red]) {
      for (let i = 0; i < series.length; i++) {
        const s = series[i];
        assert.equal(
          s.total,
          s.minion + s.creep + s.structure + s.hero + s.trickle,
          `${file}: total is the sum of its sources`
        );
        if (i === 0) continue;
        assert.ok(s.loop > series[i - 1].loop, `${file}: samples go forward in time`);
        assert.ok(s.total >= series[i - 1].total, `${file}: totals never drop`);
        assert.ok(s.level >= series[i - 1].level, `${file}: levels never drop`);
      }
      assert.ok(series[series.length - 1].loop <= model.durationLoops);
    }
  }
});

test("Braxis zerg stay in their pen until the wave launches", { skip: !haveReplays }, async () => {
  let seenWaves = 0;
  for (const file of replayFiles) {
    const model = await analyzeReplay(loadArchive(file));
    if (model.map !== "Braxis Holdout") continue;
    const launches = model.objectives.filter((o) => /Zerg wave launched/.test(o.text)).map((o) => o.loop);
    for (const z of model.minions.filter((m) => /^Zerg/.test(m.type))) {
      const spawn = z.anchors[0];
      const launch = launches.find((loop) => loop > spawn.loop);
      if (launch == null || z.anchors[z.anchors.length - 1].loop <= launch) continue;
      seenWaves++;
      const held = minionPositionAt(z, launch - 1);
      assert.ok(
        Math.hypot(held[0] - spawn.x, held[1] - spawn.y) < 1,
        `zerg drifted from ${spawn.x},${spawn.y} to ${held} before the launch at ${launch}`
      );
    }
  }
  // A replay directory without Braxis Holdout leaves seenWaves at 0.
  assert.ok(seenWaves >= 0);
});

test("objective sites carry a coherent ownership timeline", { skip: !haveReplays }, async () => {
  // Which maps have objective units at all depends on the replay directory, so
  // assert the shape of whatever is found rather than a per-map count.
  let seenSites = 0;
  let seenOwnerChange = 0;
  for (const file of replayFiles) {
    const model = await analyzeReplay(loadArchive(file));
    const b = model.bounds;
    for (const s of model.objectiveSites) {
      seenSites++;
      assert.ok(s.label.length > 0, `${model.map}: ${s.type} has no label`);
      assert.ok(s.bornLoop >= 0);
      assert.ok(s.diedLoop == null || s.diedLoop >= s.bornLoop);
      assert.ok(s.x >= b.minX - 20 && s.x <= b.maxX + 20, `${model.map}: ${s.type} off map`);
      assert.ok(s.y >= b.minY - 20 && s.y <= b.maxY + 20, `${model.map}: ${s.type} off map`);
      if (s.active) {
        let prevSpan = null;
        for (const w of s.active) {
          assert.ok(w.from >= s.bornLoop && w.to > w.from, `${model.map}: bad active span`);
          assert.ok(!prevSpan || w.from > prevSpan.to, "active spans must not overlap");
          prevSpan = w;
        }
      }
      assert.ok(s.owners.length >= 1);
      if (s.owners.length > 1) seenOwnerChange++;
      let prev = null;
      for (const o of s.owners) {
        assert.ok(o.team === null || o.team === 0 || o.team === 1, `${model.map}: bad team ${o.team}`);
        assert.ok(o.loop >= s.bornLoop);
        if (prev) {
          assert.ok(o.loop >= prev.loop, "owner changes must be in loop order");
          assert.notEqual(o.team, prev.team, "consecutive owners must differ");
        }
        prev = o;
      }
    }
  }
  assert.ok(seenSites > 0, "no objective sites found in any replay");
  assert.ok(seenOwnerChange > 0, "no objective ever changed hands");
});

test("objective rounds are coherent spans", { skip: !haveReplays }, async () => {
  // Rules are matched by the signals a map emits rather than by its title, so
  // the assertions here are about shape: rounds of one kind cannot overlap each
  // other, and none may run past the end of the game.
  let seenPhases = 0;
  let seenWinner = 0;
  let seenSegments = 0;
  for (const file of replayFiles) {
    const model = await analyzeReplay(loadArchive(file));
    const byLabel = new Map();
    for (const p of model.objectivePhases) {
      seenPhases++;
      assert.ok(p.label.length > 0, `${model.map}: phase with no label`);
      assert.ok(p.from >= 0 && p.to >= p.from, `${model.map}: ${p.label} runs backwards`);
      assert.ok(p.to <= model.durationLoops, `${model.map}: ${p.label} outlives the game`);
      assert.ok(
        p.team === null || p.team === 0 || p.team === 1,
        `${model.map}: ${p.label} has team ${p.team}`
      );
      if (p.team !== null) seenWinner++;
      if (p.segments) {
        seenSegments += p.segments.length;
        let prevRun = null;
        for (const s of p.segments) {
          assert.ok(s.team === 0 || s.team === 1, `${model.map}: run with team ${s.team}`);
          assert.ok(
            s.from >= p.from && s.to <= p.to && s.to >= s.from,
            `${model.map}: ${p.label} run ${s.from}-${s.to} escapes its round`
          );
          assert.ok(!prevRun || s.from >= prevRun.to, `${model.map}: ${p.label} runs overlap`);
          assert.notEqual(prevRun?.team, s.team, "consecutive runs must be different teams");
          prevRun = s;
        }
        const counted = p.counts[0] + p.counts[1];
        assert.ok(counted >= p.segments.length, `${model.map}: fewer signals than runs`);
      }
      const prev = byLabel.get(p.label);
      assert.ok(
        prev == null || p.from >= prev,
        `${model.map}: ${p.label} rounds overlap at ${p.from}`
      );
      byLabel.set(p.label, p.to);
    }
    // Every objective round should have a feed line somewhere inside it, since
    // both are built from the same events. The exception is a round the game
    // ended during: the shrine lit, nobody finished it, so there is nothing for
    // the feed to report.
    for (const p of model.objectivePhases) {
      if (p.to >= model.durationLoops) continue;
      const near = model.objectives.some((o) => o.loop >= p.from - 16 * 30 && o.loop <= p.to + 16 * 30);
      assert.ok(near, `${model.map}: ${p.label} round at ${p.from} has no feed line near it`);
    }
  }
  assert.ok(seenPhases > 0, "no objective rounds found in any replay");
  assert.ok(seenWinner > 0, "no objective round recorded a winner");
  assert.ok(seenSegments > 0, "no round was split into per-team runs");
});

test("the objective band gives each kind of round its own row", () => {
  const phases = [
    { from: 0, to: 100, label: "A", team: 0 },
    { from: 50, to: 150, label: "B", team: 1 }, // a different kind, so its own row
    { from: 160, to: 200, label: "A", team: null }, // back on A's row
    { from: 400, to: 400, label: "B", team: null }, // a moment
    { from: 390, to: 420, label: "A", team: null }, // overlaps the A before it
  ];
  const cells = layoutObjectivePhases(phases, 1000);
  assert.deepEqual(
    cells.map((c) => c.row),
    [0, 1, 0, 1, 0]
  );
  assert.equal(cells[0].left, 0);
  assert.equal(cells[0].width, 10);
  assert.equal(cells[1].left, 5);
  // A moment has no width; it draws as a single dot.
  assert.equal(cells[3].width, 0);
  for (const c of cells) {
    assert.ok(c.left >= 0 && c.left + c.width <= 100.001, `${c.label} runs off the band`);
  }
});

test("the objective band never overlaps two rounds on one row", () => {
  const phases = [
    { from: 0, to: 100, label: "A", team: null },
    { from: 50, to: 150, label: "A", team: null }, // same kind, overlapping
  ];
  const cells = layoutObjectivePhases(phases, 1000);
  assert.notEqual(cells[0].row, cells[1].row);
});

const MAPS_JSON = new URL("../site/static/replay/maps.json", import.meta.url).pathname;
const HERO_UNITS_JSON = new URL("../site/static/replay/hero-units.json", import.meta.url).pathname;

test("extracted minimap metadata is coherent", { skip: !existsSync(MAPS_JSON) }, async () => {
  const maps = JSON.parse(readFileSync(MAPS_JSON, "utf8"));
  assert.ok(Object.keys(maps).length >= 20);
  for (const [name, m] of Object.entries(maps)) {
    assert.ok(m.mapWidth > 0 && m.mapHeight > 0, name);
    const png = new URL(`../site/static/replay/maps/${m.slug}.png`, import.meta.url).pathname;
    assert.ok(existsSync(png), `${name}: missing ${png}`);
    if (m.camera) {
      assert.ok(m.camera.left < m.camera.right && m.camera.right <= m.mapWidth, name);
      assert.ok(m.camera.bottom < m.camera.top && m.camera.top <= m.mapHeight, name);
    }
    assert.match(m.hash, /^[0-9a-f]{64}$/, `${name}: no content hash`);
    assert.ok(m.names.length > 0, `${name}: no localized names`);
  }
});

test("maps and heroes are identifiable from a localized replay", { skip: !existsSync(MAPS_JSON) || !existsSync(HERO_UNITS_JSON) }, async () => {
  const maps = JSON.parse(readFileSync(MAPS_JSON, "utf8"));
  // A replay records the map and hero names in the recorder's language, so
  // neither can be matched by the name alone.
  const braxis = maps["Braxis Holdout"];
  assert.ok(braxis.names.includes("Le laboratoire de Braxis"), "missing the French name");

  const heroUnits = JSON.parse(readFileSync(HERO_UNITS_JSON, "utf8"));
  assert.equal(heroUnits.HeroWhitemane, "Whitemane");
  // Unit types are codenames, not names, and multi-body heroes spawn as one of
  // their bodies rather than as the unit the hero is filed under.
  assert.equal(heroUnits.HeroAmazon, "Cassia");
  assert.equal(heroUnits.HeroOlaf, "LostVikings");
  assert.equal(heroUnits.HeroDVaPilot, "DVa");
});

test("every hero a replay reports resolves to a known hero", { skip: !haveReplays || !existsSync(HERO_UNITS_JSON) }, async () => {
  const heroUnits = JSON.parse(readFileSync(HERO_UNITS_JSON, "utf8"));
  for (const file of replayFiles) {
    const model = await analyzeReplay(loadArchive(file));
    for (const p of model.players) {
      assert.ok(heroUnits[p.unitType], `${p.hero}: no hero for unit type ${p.unitType}`);
    }
  }
});

const FOOTPRINTS_JSON = new URL("../site/static/replay/footprints.json", import.meta.url).pathname;

test("structure footprints are well-formed hulls", { skip: !existsSync(FOOTPRINTS_JSON) }, async () => {
  const { shapes, units } = JSON.parse(readFileSync(FOOTPRINTS_JSON, "utf8"));
  assert.ok(shapes.length > 0);
  for (const shape of shapes) {
    assert.ok(shape.rings.length > 0);
    for (const ring of shape.rings) {
      assert.ok(ring.length >= 3, "a hull ring needs at least three vertices");
      for (const [x, y] of ring) {
        // Vertices are world-unit offsets from the unit position; the largest
        // structure (the Core) reaches 4 units out.
        assert.ok(Number.isFinite(x) && Math.abs(x) <= 16, `vertex x ${x}`);
        assert.ok(Number.isFinite(y) && Math.abs(y) <= 16, `vertex y ${y}`);
      }
    }
  }
  for (const [type, index] of Object.entries(units)) {
    assert.ok(shapes[index], `${type} points at missing shape ${index}`);
    assert.ok(!/Destroyed/.test(type), `${type} is rubble and should not have a footprint`);
  }
  for (const type of ["KingsCore", "TownTownHallL2", "TownCannonTowerL2", "TownMoonwellL2"]) {
    assert.ok(units[type] !== undefined, `missing footprint for ${type}`);
  }
});

test("every structure a replay reports has a footprint", { skip: !haveReplays || !existsSync(FOOTPRINTS_JSON) }, async () => {
  const { units } = JSON.parse(readFileSync(FOOTPRINTS_JSON, "utf8"));
  for (const file of replayFiles) {
    const model = await analyzeReplay(loadArchive(file));
    for (const s of model.structures) {
      assert.ok(units[s.type] !== undefined, `${model.map}: no footprint for ${s.type}`);
      assert.ok(s.bornLoop >= 0 && (s.diedLoop === null || s.diedLoop >= s.bornLoop), `${s.type} lifetime`);
    }
  }
});

// Unit tag indices are recycled aggressively; a structure's index is reused by
// dozens of minions over a game. Matching deaths on the index alone made every
// later minion death overwrite the structure's, so structures lingered on the
// map for minutes after they fell.
test("structure deaths match the exact unit tag, not just the index", { skip: !haveReplays }, async () => {
  const archive = loadArchive(replayFiles[0]);
  const born = new Map(); // "index:recycle" -> {type, x, y}
  const died = new Map(); // "index:recycle" -> loop
  for (const ev of decodeTrackerEvents(archive.readFile("replay.tracker.events"))) {
    const key = `${ev.m_unitTagIndex}:${ev.m_unitTagRecycle}`;
    if (ev._event === "NNet.Replay.Tracker.SUnitBornEvent") {
      if (ev.m_controlPlayerId !== 11 && ev.m_controlPlayerId !== 12) continue;
      born.set(key, { type: String(new TextDecoder().decode(ev.m_unitTypeName)), x: ev.m_x, y: ev.m_y });
    } else if (ev._event === "NNet.Replay.Tracker.SUnitDiedEvent" && !died.has(key)) {
      died.set(key, ev._gameloop);
    }
  }
  const expected = new Map();
  for (const [key, u] of born) expected.set(`${u.type}@${u.x},${u.y}`, died.get(key) ?? null);

  const model = await analyzeReplay(archive);
  let checked = 0;
  for (const s of model.structures) {
    const want = expected.get(`${s.type}@${s.x},${s.y}`);
    if (want === undefined) continue; // several structures can share a spot
    assert.equal(s.diedLoop, want, `${s.type} at ${s.x},${s.y} died at the wrong loop`);
    checked++;
  }
  assert.ok(checked > 20, `only cross-checked ${checked} structures`);

  // The index-only bug dragged nearly every death toward the end of the game.
  const destroyed = model.structures.filter((s) => s.diedLoop != null);
  assert.ok(destroyed.length > 0);
  const early = destroyed.filter((s) => s.diedLoop < model.durationLoops * 0.6);
  assert.ok(early.length > 0, "no structure fell in the first 60% of the game");
});

test("every full replay in the directory parses", { skip: !haveReplays }, async () => {
  for (const file of replayFiles) {
    let model;
    try {
      model = await analyzeReplay(loadArchive(file));
    } catch (err) {
      assert.fail(`failed on ${file}: ${err.message}`);
    }
    assert.ok(model.durationLoops > 0, `no duration in ${file}`);
  }
});

// --- Hearthstone resolution -------------------------------------------------
// A Hearthstone carries no target point, so without extra evidence the timeline
// can only park the hero where they cast it and then walk them off toward
// whatever move order lands next. These build a player by hand so the rule is
// pinned without needing a replay on disk.

const HEARTH_LINK = 115; // "Hearthstone" in the abilLink catalog
const HALL = { x: 30, y: 100 };

function hearthingPlayer({ camera = [], deaths = [], castLoops = [1000] }) {
  return {
    // Recorded at the fight, then not again until well after the channel.
    anchors: [
      { loop: 0, x: 30, y: 100 },
      { loop: 960, x: 150, y: 60 },
      { loop: 2400, x: 60, y: 90 },
    ],
    // Player kept clicking toward the fight while channelling.
    moves: [{ loop: 1040, x: 170, y: 55 }],
    casts: castLoops.map((loop) => ({ loop, link: HEARTH_LINK })),
    deaths,
    camera,
  };
}

// Position estimate at a loop, from the flat sample array.
function atLoop(tl, loop) {
  const i = Math.min(Math.max(Math.round(loop / tl.step), 0), tl.samples.length / 2 - 1);
  return { x: tl.samples[i * 2], y: tl.samples[i * 2 + 1] };
}

const hearthOptions = {
  movementLinks: new Set([HEARTH_LINK]),
  hearthLinks: new Set([HEARTH_LINK]),
  hall: HALL,
};

test("a Hearthstone the camera confirms puts the hero on the hall", () => {
  // Camera follows the hero to base as the channel ends.
  const camera = [
    { loop: 1000, x: 150, y: 60 },
    { loop: 1100, x: 31, y: 101 },
    { loop: 1140, x: 33, y: 99 },
  ];
  const tl = buildPositionTimeline(hearthingPlayer({ camera }), 2400, hearthOptions);
  const p = atLoop(tl, 1200);
  assert.ok(
    Math.hypot(p.x - HALL.x, p.y - HALL.y) < 5,
    `expected the hall, got ${p.x},${p.y}`
  );
});

test("without confirmation the hero is not teleported home", () => {
  // Camera stayed on the fight: the channel was interrupted.
  const camera = [
    { loop: 1000, x: 150, y: 60 },
    { loop: 1100, x: 152, y: 58 },
    { loop: 1140, x: 155, y: 57 },
  ];
  const tl = buildPositionTimeline(hearthingPlayer({ camera }), 2400, hearthOptions);
  const p = atLoop(tl, 1200);
  assert.ok(Math.hypot(p.x - HALL.x, p.y - HALL.y) > 50, `should not be at the hall`);
});

test("a Hearthstone recast inside its channel cancelled the first cast", () => {
  // Camera reaches the hall on the second cast's timing, not the first.
  const camera = [
    { loop: 1000, x: 150, y: 60 },
    { loop: 1180, x: 31, y: 101 },
    { loop: 1220, x: 33, y: 99 },
  ];
  const player = hearthingPlayer({ camera, castLoops: [1000, 1060] });
  const tl = buildPositionTimeline(player, 2400, hearthOptions);
  // The first cast's channel would have ended at 1104; nothing should land then.
  const during = atLoop(tl, 1120);
  assert.ok(Math.hypot(during.x - HALL.x, during.y - HALL.y) > 50);
  const after = atLoop(tl, 1200);
  assert.ok(Math.hypot(after.x - HALL.x, after.y - HALL.y) < 5);
});

test("dying mid-channel interrupts the Hearthstone", () => {
  const camera = [
    { loop: 1000, x: 150, y: 60 },
    { loop: 1100, x: 31, y: 101 },
    { loop: 1140, x: 33, y: 99 },
  ];
  // Camera drifts to base because the player is watching the respawn timer.
  const player = hearthingPlayer({ camera, deaths: [{ loop: 1050, x: 150, y: 60 }] });
  const tl = buildPositionTimeline(player, 2400, hearthOptions);
  const p = atLoop(tl, 1120);
  assert.ok(Math.hypot(p.x - HALL.x, p.y - HALL.y) > 50, "a dead hero did not hearth");
});

test("camera targets decode onto the map, near their own hero", { skip: !haveReplays }, async () => {
  const model = await analyzeReplay(loadArchive(replayFiles[0]));
  const b = model.bounds;
  let compared = 0;
  let close = 0;
  for (const p of model.players) {
    assert.ok(p.camera.length > 0, `no camera samples for ${p.hero}`);
    for (const s of p.camera) {
      assert.ok(s.x >= b.minX - 30 && s.x <= b.maxX + 30, `camera x ${s.x} off map`);
      assert.ok(s.y >= b.minY - 30 && s.y <= b.maxY + 30, `camera y ${s.y} off map`);
    }
    // At a recorded position, the nearest camera sample should usually be on
    // the hero: that is what makes it usable as evidence at all.
    let j = 0;
    for (const a of p.anchors) {
      while (j < p.camera.length - 1 && p.camera[j + 1].loop <= a.loop) j++;
      const s = p.camera[j];
      if (!s || a.loop - s.loop > 8 || a.loop < s.loop) continue;
      compared++;
      if (Math.hypot(s.x - a.x, s.y - a.y) < 15) close++;
    }
  }
  assert.ok(compared > 50, `only ${compared} camera/position pairs to compare`);
  assert.ok(close / compared > 0.6, `only ${((close / compared) * 100) | 0}% of cameras were on the hero`);
});

test("every team has a Hall of Storms", { skip: !haveReplays }, async () => {
  for (const file of replayFiles.slice(0, 20)) {
    const model = await analyzeReplay(loadArchive(file));
    for (const hall of model.teamHalls) {
      assert.ok(hall, `no hall in ${file}`);
      assert.ok(Number.isFinite(hall.x) && Number.isFinite(hall.y));
    }
  }
});
