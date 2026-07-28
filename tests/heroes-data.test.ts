import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";

// Build a miniature heroes-data2 tree: one "full" version followed by two
// "patch" versions chained through depends-on.
async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "heroesdata-"));

  async function version(name, manifest, files) {
    const dir = path.join(root, name);
    await mkdir(path.join(dir, "data"), { recursive: true });
    await mkdir(path.join(dir, "gamestrings"), { recursive: true });
    await writeFile(path.join(dir, ".hdp.json"), JSON.stringify(manifest));
    for (const [rel, body] of Object.entries(files)) {
      await writeFile(path.join(dir, rel), JSON.stringify(body));
    }
  }

  await writeFile(path.join(root, ".version.json"), JSON.stringify({
    latest: "1.0.2",
    "latest-full": "1.0.0",
    date: "2026-07-21T00:00:00Z",
    versions: ["1.0.0", "1.0.1", "1.0.2"],
  }));

  await version("1.0.0", {
    hdp: "5.0.0",
    json: "full",
    "depends-on": "",
    "root-version": "",
    extracted: true,
    files: { "[data]": { herodata: "herodata_100.json" }, "[gamestrings]": { enus: "gamestrings_100_enus.json" } },
  }, {
    "data/herodata_100.json": { meta: { heroesVersion: "1.0.0" }, items: { Abathur: { speed: 4.8 } } },
    "gamestrings/gamestrings_100_enus.json": { meta: {}, items: { hero: { name: { Abathur: "Abathur" } } } },
  });

  await version("1.0.1", {
    hdp: "5.0.0",
    json: "patch",
    "depends-on": "1.0.0",
    "root-version": "1.0.0",
    extracted: true,
    files: { "[data]": { herodata: "herodata_101.patch.json" }, "[gamestrings]": { enus: "gamestrings_101_enus.patch.json" } },
  }, {
    "data/herodata_101.patch.json": [
      { op: "replace", path: "/meta/heroesVersion", value: "1.0.1" },
      { op: "add", path: "/items/Alarak", value: { speed: 4.4 } },
    ],
    "gamestrings/gamestrings_101_enus.patch.json": [
      { op: "add", path: "/items/hero/name/Alarak", value: "Alarak" },
    ],
  });

  await version("1.0.2", {
    hdp: "5.0.0",
    json: "patch",
    "depends-on": "1.0.1",
    "root-version": "1.0.0",
    extracted: true,
    files: { "[data]": { herodata: "herodata_102.patch.json" }, "[gamestrings]": { enus: "gamestrings_102_enus.patch.json" } },
  }, {
    "data/herodata_102.patch.json": [
      { op: "replace", path: "/meta/heroesVersion", value: "1.0.2" },
      { op: "replace", path: "/items/Abathur/speed", value: 4.75 },
    ],
    "gamestrings/gamestrings_102_enus.patch.json": [
      { op: "replace", path: "/items/hero/name/Abathur", value: "Abathur the Evolution Master" },
    ],
  });

  // Battleground overlay: only present for some maps and some locales.
  const overlay = path.join(root, "1.0.2", "gamestrings", "maps", "infernal_shrines");
  await mkdir(overlay, { recursive: true });
  await writeFile(path.join(overlay, "gamestrings_102_enus.patch.json"), JSON.stringify([
    { op: "add", path: "/items/ability/name/MercPunisherLanerLeap|MercPunisherLanerLeap|Q", value: "Punish" },
  ]));
  await mkdir(path.join(root, "1.0.2", "gamestrings", "maps", "cursed_hollow"), { recursive: true });

  return root;
}

function runInFixture(root, body) {
  const script = `
    import { loadDataFile, loadGamestrings, loadMapGamestringPatches, readVersionIndex } from "./scripts/lib/heroes-data.ts";
    import { findLatestVersion } from "./scripts/lib/paths.ts";
    const root = ${JSON.stringify(root)};
    ${body}
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  ));
}

test("loading a patch version replays the whole chain from the root full version", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runInFixture(root, `
    const version = await findLatestVersion(root);
    const data = await loadDataFile("herodata", version, root);
    const gs = await loadGamestrings(version, "enus", root);
    console.log(JSON.stringify({ version, data, heroNames: gs.items.hero.name }));
  `);

  assert.equal(result.version, "1.0.2");
  assert.equal(result.data.meta.heroesVersion, "1.0.2");
  assert.deepEqual(result.data.items, { Abathur: { speed: 4.75 }, Alarak: { speed: 4.4 } });
  assert.deepEqual(result.heroNames, { Abathur: "Abathur the Evolution Master", Alarak: "Alarak" });
});

test("loading the full version itself needs no patching", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runInFixture(root, `
    const index = await readVersionIndex(root);
    const data = await loadDataFile("herodata", index["latest-full"], root);
    console.log(JSON.stringify({ latestFull: index["latest-full"], items: data.items }));
  `);

  assert.equal(result.latestFull, "1.0.0");
  assert.deepEqual(result.items, { Abathur: { speed: 4.8 } });
});

test("battleground overlays are returned per map, skipping maps without one", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runInFixture(root, `
    console.log(JSON.stringify(await loadMapGamestringPatches("1.0.2", "enus", root)));
  `);

  assert.deepEqual(result, [
    {
      map: "infernal_shrines",
      patch: [{ op: "add", path: "/items/ability/name/MercPunisherLanerLeap|MercPunisherLanerLeap|Q", value: "Punish" }],
    },
  ]);
});

test("a version with no map overlays yields no patches", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runInFixture(root, `
    console.log(JSON.stringify(await loadMapGamestringPatches("1.0.0", "enus", root)));
  `);

  assert.deepEqual(result, []);
});

test("findLatestVersion reads the published version index", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = runInFixture(root, `
    console.log(JSON.stringify({ latest: await findLatestVersion(root) }));
  `);

  assert.equal(result.latest, "1.0.2");
});
