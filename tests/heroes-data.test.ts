import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";

// Build a miniature extraction root: `mods/hdp.info` names the build that every
// data and gamestring file is suffixed with.
async function makeFixture({ isPtr = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "gamedata-"));
  await mkdir(path.join(root, "mods"), { recursive: true });
  await mkdir(path.join(root, "data"), { recursive: true });
  await mkdir(path.join(root, "gamestrings"), { recursive: true });

  await writeFile(path.join(root, "mods", "hdp.info"), JSON.stringify({
    Version: "2.57.0.98182",
    IsPtr: isPtr,
    HdpVersion: "5.0.4",
    ExtractedDate: "2026-09-18T17:55:42.1174969+00:00",
  }));

  await writeFile(path.join(root, "data", "herodata_98182.json"), JSON.stringify({
    meta: { heroesVersion: "2.57.0.98182" },
    items: { Abathur: { speed: 4.75 }, Alarak: { speed: 4.4 } },
  }));

  await writeFile(path.join(root, "gamestrings", "gamestrings_98182_enus.json"), JSON.stringify({
    meta: {},
    items: { hero: { name: { Abathur: "Abathur" } } },
  }));

  // Battleground overlay: only present for some maps and some locales.
  const overlay = path.join(root, "gamestrings", "maps", "infernal_shrines");
  await mkdir(overlay, { recursive: true });
  await writeFile(path.join(overlay, "gamestrings_98182_enus.patch.json"), JSON.stringify([
    { op: "add", path: "/items/ability/name/MercPunisherLanerLeap|MercPunisherLanerLeap|Q", value: "Punish" },
  ]));
  await mkdir(path.join(root, "gamestrings", "maps", "cursed_hollow"), { recursive: true });

  return root;
}

function runInFixture(root, body) {
  const script = `
    import { loadDataFile, loadGamestrings, loadMapGamestringPatches } from "./scripts/lib/heroes-data.ts";
    import { gameBuild, gameVersion, readHdpInfo } from "./scripts/lib/paths.ts";
    ${body}
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8", env: { ...process.env, HOTS_DATA_ROOT: root } }
  ));
}

test("data and gamestring files are found by the build in hdp.info", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runInFixture(root, `
    const data = await loadDataFile("herodata");
    const gs = await loadGamestrings("enus");
    console.log(JSON.stringify({ build: gameBuild(await readHdpInfo()), data, heroNames: gs.items.hero.name }));
  `);

  assert.equal(result.build, 98182);
  assert.equal(result.data.meta.heroesVersion, "2.57.0.98182");
  assert.deepEqual(result.data.items, { Abathur: { speed: 4.75 }, Alarak: { speed: 4.4 } });
  assert.deepEqual(result.heroNames, { Abathur: "Abathur" });
});

test("battleground overlays are returned per map, skipping maps without one", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runInFixture(root, `
    console.log(JSON.stringify(await loadMapGamestringPatches("enus")));
  `);

  assert.deepEqual(result, [
    {
      map: "infernal_shrines",
      patch: [{ op: "add", path: "/items/ability/name/MercPunisherLanerLeap|MercPunisherLanerLeap|Q", value: "Punish" }],
    },
  ]);
});

test("a locale with no overlays yields no patches", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runInFixture(root, `
    console.log(JSON.stringify(await loadMapGamestringPatches("dede")));
  `);

  assert.deepEqual(result, []);
});

test("a PTR extraction reports the _ptr suffixed version", async (t) => {
  const root = await makeFixture({ isPtr: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runInFixture(root, `
    const info = await readHdpInfo();
    console.log(JSON.stringify({ version: gameVersion(info), build: gameBuild(info) }));
  `);

  assert.equal(result.version, "2.57.0.98182_ptr");
  assert.equal(result.build, 98182);
});
