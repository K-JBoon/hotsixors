import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function collect(heroes, units) {
  const script = `
    import { collectMinimapIcons } from "./scripts/gen-replay-minimap-icons.ts";
    console.log(JSON.stringify(collectMinimapIcons(${JSON.stringify(heroes)}, ${JSON.stringify(units)})));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf-8",
    })
  );
}

test("a hero, its alternate bodies and plain units all map to their icon", () => {
  const out = collect(
    {
      Rexxar: {
        unitId: "HeroRexxar",
        portraits: { minimap: "rexxar.png" },
        heroUnits: { RexxarMisha: { portraits: { minimap: "misha.png" } } },
      },
    },
    { ChromieTimeTrap: { portraits: { minimap: "timetrap.png" } } }
  );
  assert.deepEqual(out, {
    HeroRexxar: "rexxar.png",
    RexxarMisha: "misha.png",
    ChromieTimeTrap: "timetrap.png",
  });
});

test("units without minimap art are dropped", () => {
  const out = collect(
    { Abathur: { unitId: "HeroAbathur", portraits: {} } },
    { FootmanMinion: { portraits: { targetInfo: "footman.png" } }, Beacon: {} }
  );
  assert.deepEqual(out, {});
});

// heroUnits values also carry plain numbers, so entry shapes vary.
test("hero unit entries that are not objects are ignored", () => {
  const out = collect({ Cho: { unitId: "HeroCho", heroUnits: { radius: 1.25 } } }, {});
  assert.deepEqual(out, {});
});

function decode(file) {
  const script = `
    import { readFileSync } from "node:fs";
    import { decodeDds } from "./scripts/lib/dds.ts";
    const { width, height, rgba } = decodeDds(readFileSync("data/minimapicons/${file}"));
    console.log(JSON.stringify({ width, height, rgba: [...rgba] }));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf-8",
    })
  );
}

// The icons ship in both an uncompressed and a block-compressed format.
for (const [file, format] of [
  ["storm_ui_minimapicon_alarak.dds", "an uncompressed"],
  ["storm_ui_minimapicon_dragonknight.dds", "a DXT5"],
]) {
  test(`${format} icon decodes to a 32x32 disc`, () => {
    const { width, height, rgba } = decode(file);
    assert.equal(width, 32);
    assert.equal(height, 32);
    assert.equal(rgba.length, 32 * 32 * 4);
    assert.equal(rgba[3], 0, "the top left corner is outside the disc");
    assert.ok(rgba[(16 * 32 + 16) * 4 + 3] > 0, "the middle is drawn");
  });
}

const generated = new URL("../site/static/replay/minimap-icons.json", import.meta.url);

test("the generated table covers the hero unit types a replay reports", { skip: !existsSync(generated) }, () => {
  const icons = JSON.parse(readFileSync(generated, "utf-8"));
  const images = new URL("../site/static/images/minimapicons/", import.meta.url);
  for (const id of ["HeroAlarak", "HeroDVaMech", "HeroDVaPilot", "HeroOlaf", "RexxarMisha", "HeroChenStorm"]) {
    assert.ok(icons[id], `${id} should have a minimap icon`);
    assert.ok(existsSync(new URL(icons[id], images)), `${icons[id]} should be converted to PNG`);
  }
});
