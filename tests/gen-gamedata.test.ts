import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function runGamedataFilter(paths) {
  const script = `
    import { shouldIncludeGamedataPath } from "./scripts/gen-gamedata.ts";
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
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/gamedata.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/dvaskindata/dvabasedata.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/dvavodata/dvabasevodata.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/lightdata.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/sounddata.xml"], false);
  assert.equal(results["mods/heromods/dva.stormmod/base.stormdata/gamedata/soundexclusivitydata.xml"], false);
  assert.equal(results["mods/heromods/maiev.stormmod/preload.xml"], false);
  assert.equal(results["mods/heroesdata.stormmod/base.stormdata/triggerlibs/librarylist.xml"], false);
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
