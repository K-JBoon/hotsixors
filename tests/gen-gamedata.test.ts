import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function runGamedataFilter(paths) {
  const script = `
    import { shouldIncludeGamedataPath } from "./scripts/lib/gamedata-paths.ts";
    const paths = ${JSON.stringify(paths)};
    console.log(JSON.stringify(paths.map((p) => [p, shouldIncludeGamedataPath(p)])));
  `;
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );
  return Object.fromEntries(JSON.parse(output));
}

function renderGamedataHtml(content, anchors) {
  const script = `
    import { renderGamedataHtml } from "./scripts/gen-gamedata.ts";
    const anchorEntries = ${JSON.stringify(anchors)};
    const anchors = new Map(anchorEntries.map(([line, ids]) => [line, ids]));
    console.log(renderGamedataHtml(${JSON.stringify(content)}, anchors, "xml"));
  `;
  return execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );
}

test("gamedata export skips unused XML while keeping lookup data", () => {
  const results = runGamedataFilter([
    "mods/heromods/dva.stormmod/base.stormdata/gamedata/dvadata.xml",
    "mods/heromods/dva.stormmod/base.stormdata/gamedata/validatordata.xml",
    "mods/heromods/dva.stormmod/base.stormdata/gamedata/characterdata.xml",
    "mods/heromods/dva.stormmod/base.stormdata/gamedata/gamedata.xml",
    "mods/heromods/dva.stormmod/base.stormdata/gamedata/dvaskindata/dvabasedata.xml",
    "mods/heromods/dva.stormmod/base.stormdata/gamedata/dvavodata/dvabasevodata.xml",
    "mods/heromods/dva.stormmod/base.stormdata/gamedata/lightdata.xml",
    "mods/heromods/dva.stormmod/base.stormdata/gamedata/sounddata.xml",
    "mods/heromods/dva.stormmod/base.stormdata/gamedata/soundexclusivitydata.xml",
    "mods/heromods/maiev.stormmod/preload.xml",
    "mods/heroesdata.stormmod/base.stormdata/triggerlibs/librarylist.xml",
    "mods/heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/gamedata/soundtrackdata.xml",
    "mods/heroesmapmods/battlegroundmapmods/alteracpass.stormmod/preload.xml",
    "mods/heroesmapmods/battlegroundmapmods/volskayasound.stormmod/base.stormdata/libvlss.galaxy",
    "mods/heroesdata.stormmod/base.stormdata/triggerlibs/soundlib.galaxy",
  ]);

  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/dvadata.xml"], true);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/validatordata.xml"], true);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/characterdata.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/gamedata.xml"], true);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/dvaskindata/dvabasedata.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/dvavodata/dvabasevodata.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/lightdata.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/sounddata.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/soundexclusivitydata.xml"], false);
  assert.equal(results["mods/heromods/maiev.stormmod/preload.xml"], false);
  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/triggerlibs/librarylist.xml"], true);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/gamedata/soundtrackdata.xml"], false);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/alteracpass.stormmod/preload.xml"], false);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/volskayasound.stormmod/base.stormdata/libvlss.galaxy"], false);
  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/triggerlibs/soundlib.galaxy"], false);
});

test("gamedata export keeps Galaxy scripts", () => {
  const results = runGamedataFilter([
    "mods/heromods/dva.stormmod/base.stormdata/libhdva.galaxy",
    "mods/heroesdata.stormmod/base.stormdata/triggerlibs/gamelib.galaxy",
    "mods/heroesmapmods/battlegroundmapmods/blackheartsbay.stormmod/base.stormdata/libbbay.galaxy",
    "mods/heromods/dva.stormmod/base.stormdata/ui/layout/dvaheroinfo.xml",
    "mods/heromods/dva.stormmod/base.stormdata/cutscenes/endofmatch/endofmatch.galaxy",
    "mods/heroesmapmods/battlegroundmapmods/blackheartsbay.stormmod/base.stormdata/ui/layout/maplayout.xml",
    "mods/core.stormmod/base.stormdata/triggerlibs/natives.galaxy",
  ]);

  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/libhdva.galaxy"], true);
  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/triggerlibs/gamelib.galaxy"], true);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/blackheartsbay.stormmod/base.stormdata/libbbay.galaxy"], true);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/ui/layout/dvaheroinfo.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/cutscenes/endofmatch/endofmatch.galaxy"], false);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/blackheartsbay.stormmod/base.stormdata/ui/layout/maplayout.xml"], false);
  assert.equal(results["mods/core.stormmod/base.stormdata/triggerlibs/natives.galaxy"], false);
});

test("gamedata export is scoped to hero and battleground details", () => {
  const results = runGamedataFilter([
    "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/tyraeldata/tyraeldata.xml",
    "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/common/genericeffectdata.xml",
    "mods/heroesdata.stormmod/base.stormdata/gamedata/maps/protectors.xml",
    "mods/heroesmapmods/battlegroundmapmods/blackheartsbay.stormmod/base.stormdata/gamedata/mapdata.xml",
    "mods/core.stormmod/base.stormdata/gamedata/abildata.xml",
    "mods/gameplaymods/lootbox.stormmod/base.stormdata/gamedata/lootchestdata.xml",
    "mods/heroes.stormmod/base.stormmaps/maps/heroes/singleplayermaps/(10)trymemode.stormmap/mapscript.galaxy",
    "mods/heroesbrawlmods/arenamodemods/arenashared.stormmod/base.stormdata/gamedata/abildata.xml",
    "mods/heroesdata.stormmod/base.stormdata/gamedata/mounts/mountravenbasedata/mount_ride_ravenbasedata.xml",
    "mods/heroesdata.stormmod/base.stormdata/gamedata/lootbox/sprays/spraystaticcarbotsbrightwingdata.xml",
    "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/tyraeldata/tyraelskindata/tyraelbasedata.xml",
  ]);

  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/tyraeldata/tyraeldata.xml"], true);
  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/common/genericeffectdata.xml"], true);
  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/gamedata/maps/protectors.xml"], true);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/blackheartsbay.stormmod/base.stormdata/gamedata/mapdata.xml"], true);
  assert.equal(results["mods/core.stormmod/base.stormdata/gamedata/abildata.xml"], false);
  assert.equal(results["mods/gameplaymods/lootbox.stormmod/base.stormdata/gamedata/lootchestdata.xml"], false);
  assert.equal(results["mods/heroes.stormmod/base.stormmaps/maps/heroes/singleplayermaps/(10)trymemode.stormmap/mapscript.galaxy"], false);
  assert.equal(results["mods/heroesbrawlmods/arenamodemods/arenashared.stormmod/base.stormdata/gamedata/abildata.xml"], false);
  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/gamedata/mounts/mountravenbasedata/mount_ride_ravenbasedata.xml"], false);
  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/gamedata/lootbox/sprays/spraystaticcarbotsbrightwingdata.xml"], false);
  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/tyraeldata/tyraelskindata/tyraelbasedata.xml"], false);
});

test("gamedata export excludes cosmetic and presentation data", () => {
  const results = runGamedataFilter([
    "mods/heromods/tracer.stormmod/base.stormdata/gamedata/actordata.xml",
    "mods/heromods/hogger.stormmod/base.stormdata/gamedata/modeldata.xml",
    "mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/common/genericcursordata.xml",
    "mods/heroesmapmods/battlegroundmapmods/gardenofterror.stormmod/base.stormdata/gamedata/announcerdata.xml",
    "mods/heroesmapmods/battlegroundmapmods/braxisholdoutdata.stormmod/base.stormdata/gamedata/texturedata.xml",
    "mods/heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/gamedata/colorspecdata.xml",
    "mods/heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/gamedata/effectdata.xml",
    "mods/heromods/garrosh.stormmod/base.stormdata/gamedata/talentdata.xml",
  ]);

  assert.equal(results["mods/heromods/tracer.stormmod/base.stormdata/gamedata/actordata.xml"], false);
  assert.equal(results["mods/heromods/hogger.stormmod/base.stormdata/gamedata/modeldata.xml"], false);
  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/gamedata/heroes/common/genericcursordata.xml"], false);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/gardenofterror.stormmod/base.stormdata/gamedata/announcerdata.xml"], false);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/braxisholdoutdata.stormmod/base.stormdata/gamedata/texturedata.xml"], false);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/gamedata/colorspecdata.xml"], false);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/gamedata/effectdata.xml"], true);
  assert.equal(results["mods/heromods/garrosh.stormmod/base.stormdata/gamedata/talentdata.xml"], true);
});

test("gamedata HTML is compact escaped source with line anchors", () => {
  const html = renderGamedataHtml(`<CAbil id="DVaBoosters">\n  <Info value="A & B"/>\n</CAbil>`, [
    [1, ["DVaBoosters"]],
  ]);

  assert.match(html, /<pre class="gamedata-code" data-lang="xml"><code>/);
  assert.match(html, /<span class="line" id="DVaBoosters">/);
  assert.match(html, /&lt;CAbil id=&quot;DVaBoosters&quot;&gt;/);
  assert.match(html, /A &amp; B/);
  assert.doesNotMatch(html, /style="/);
  assert.doesNotMatch(html, /shiki/);
});

test("gamedata record lines get a class-qualified anchor", () => {
  const script = `
    import { extractRecordAnchors } from "./scripts/gen-gamedata.ts";
    const lines = ${JSON.stringify([
      '  <CButton id="AnaSleepDart" parent="StormButtonParent">',
      '    <TooltipAppender Validator="AnaHasOverdose" />',
      '  <CTalent id="AnaSleepDartNightTerrors">',
      '  <const id="$Range" value="8" />',
      '  <CEffectApplyBehavior default="1">',
      '  <CGame id="Dflt">',
    ])};
    console.log(JSON.stringify([...extractRecordAnchors(lines)]));
  `;
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );

  assert.deepEqual(JSON.parse(output), [
    [1, ["CButton.AnaSleepDart"]],
    [3, ["CTalent.AnaSleepDartNightTerrors"]],
    [5, ["CEffectApplyBehavior.default"]],
    [6, ["CGame.Dflt"]],
  ]);
});

function runGamedataModule(body) {
  const script = `import * as paths from "./scripts/lib/gamedata-paths.ts";
    import * as gen from "./scripts/gen-gamedata.ts";
    ${body}`;
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );
  return JSON.parse(output);
}

test("gamedata export adds the reference files the Hero XML guide links", () => {
  const paths = [
    "mods/core.stormmod/base.stormdata/gamedata/effectdata.xml",
    "mods/core.stormmod/base.stormdata/gamedata/abildata.xml",
    "mods/heroesdata.stormmod/base.stormdata/gamedata/unitdata.xml",
    "mods/heroesdata.stormmod/base.stormdata/includes.xml",
    "mods/heromods/ana.stormmod/documentinfo",
    "mods/heromods/ana.stormmod/base.stormdata/gamedata.xml",
    "mods/heromods/ana.stormmod/enus.stormdata/localizeddata/gamestrings.txt",
    "mods/heromods/ana.stormmod/frfr.stormdata/localizeddata/gamestrings.txt",
    "mods/heromods/ana.stormmod/base.stormdata/gamedata/assets.txt",
    "mods/heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/gamedata/gamedata.xml",
    "mods/heroes.stormmod/base.stormmaps/maps/heroes/singleplayermaps/startingexperience/tutorial01.stormmap/base.stormdata/gamedata/herodata.xml",
  ];
  const [included, reference] = runGamedataModule(`
    const paths_ = ${JSON.stringify(paths)};
    console.log(JSON.stringify([
      Object.fromEntries(paths_.map((p) => [p, paths.shouldIncludeGamedataPath(p)])),
      Object.fromEntries(paths_.map((p) => [p, paths.isReferenceGamedataPath(p)])),
    ]));
  `);

  assert.deepEqual(Object.entries(included).filter(([, v]) => !v).map(([p]) => p), [
    "mods/core.stormmod/base.stormdata/gamedata/abildata.xml",
    "mods/heromods/ana.stormmod/frfr.stormdata/localizeddata/gamestrings.txt",
    "mods/heromods/ana.stormmod/base.stormdata/gamedata/assets.txt",
    "mods/heroesmapmods/battlegroundmapmods/alteracpass.stormmod/base.stormdata/gamedata/gamedata.xml",
  ]);
  assert.equal(reference["mods/heroesdata.stormmod/base.stormdata/gamedata/unitdata.xml"], true);
  assert.equal(reference["mods/core.stormmod/base.stormdata/gamedata/abildata.xml"], false);
});

test("gamedata walk enters English hero strings and reference folders only", () => {
  const dirs = [
    "mods/heromods/ana.stormmod/enus.stormdata",
    "mods/heromods/ana.stormmod/enus.stormdata/localizeddata",
    "mods/heromods/ana.stormmod/frfr.stormdata",
    "mods/heroesdata.stormmod/enus.stormdata",
    "mods/core.stormmod/base.stormdata/triggerlibs",
    "mods/core.stormmod/base.stormdata/ui",
  ];
  const results = runGamedataModule(`
    console.log(JSON.stringify(${JSON.stringify(dirs)}.map((d) => paths.shouldDescendIntoGamedataPath(d))));
  `);

  assert.deepEqual(results, [true, true, false, false, true, false]);
});

test("GameStrings keys anchor their line", () => {
  const anchors = runGamedataModule(`
    const lines = ${JSON.stringify(["\uFEFF14 seconds=14 seconds", "Button/Name/AnaSleepDart=Sleep Dart", "", "Button/Tooltip/AnaSleepDart=Fire a dart"])};
    console.log(JSON.stringify([...gen.extractStringAnchors(lines)]));
  `);

  assert.deepEqual(anchors, [
    [2, ["Button/Name/AnaSleepDart"]],
    [4, ["Button/Tooltip/AnaSleepDart"]],
  ]);
});

test("gamedata export keeps AI think trees", () => {
  const results = runGamedataFilter([
    "mods/heroesdata.stormmod/base.stormdata/ai/wizard.aitree",
    "mods/heromods/chromie.stormmod/base.stormdata/ai/chromie.aitree",
    "mods/heroesmapmods/battlegroundmapmods/volskayadata.stormmod/base.stormdata/ai/volskayacorethinktree.aitree",
    "mods/heroesbrawlmods/arenamodemods/punisherarena.stormmod/base.stormdata/ai/heromap.aitree",
    "mods/heroes.stormmod/base.stormmaps/maps/heroes/singleplayermaps/(10)trymemode.stormmap/base.stormdata/ai/tutorial.aitree",
  ]);

  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/ai/wizard.aitree"], true);
  assert.equal(results["mods/heromods/chromie.stormmod/base.stormdata/ai/chromie.aitree"], true);
  assert.equal(results["mods/heroesmapmods/battlegroundmapmods/volskayadata.stormmod/base.stormdata/ai/volskayacorethinktree.aitree"], true);
  assert.equal(results["mods/heroesbrawlmods/arenamodemods/punisherarena.stormmod/base.stormdata/ai/heromap.aitree"], false);
  assert.equal(results["mods/heroes.stormmod/base.stormmaps/maps/heroes/singleplayermaps/(10)trymemode.stormmap/base.stormdata/ai/tutorial.aitree"], false);
});
