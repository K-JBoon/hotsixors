import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function renderGameStringMarkup(input) {
  const script = `
    import { renderGameStringMarkup, stripMarkup } from "./scripts/lib/gamestrings.ts";
    const input = ${JSON.stringify(input)};
    console.log(JSON.stringify({
      html: renderGameStringMarkup(input),
      text: stripMarkup(input),
    }));
  `;
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: new URL("..", import.meta.url), encoding: "utf-8" }
  );
  return JSON.parse(output);
}

test("game string renderer keeps colors and line breaks while removing inline images", () => {
  const input = "<img path=\"@UI/StormTalentInTextQuestIcon\" alignment=\"uppermiddle\" color=\"B48E4C\" width=\"20\" height=\"22\"/><c val=\"e4b800\">Quest:</c> Gain <c val=\"bfd4fd\">1</c> Blight.<n/><n/><c val=\"e4b800\">Blight:</c> <c val=\"bfd4fd\" validator=\"True\">0/30</c>";
  const { html, text } = renderGameStringMarkup(input);

  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /validator=/i);
  assert.match(html, /<span class="storm-color" style="color: #e4b800">Quest:<\/span>/);
  assert.match(html, /<span class="storm-color" style="color: #bfd4fd">1<\/span>/);
  assert.match(html, /<br><br>/);
  assert.equal(text, "Quest: Gain 1 Blight.\n\nBlight: 0/30");
});

test("game string renderer escapes normal text and preserves style markers as safe spans", () => {
  const input = "<s val=\"Storm_Damage_Kicker_2\"><c val=\"FFFF00\">Health <script></c></s> 100~~0.04~~";
  const { html } = renderGameStringMarkup(input);

  assert.match(html, /storm-style--storm_damage_kicker_2/);
  assert.match(html, /data-storm-style="Storm_Damage_Kicker_2"/);
  assert.match(html, /Health /);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<span class="storm-scale" data-base="100" data-scale="0.04" title="\+4% per level">100<\/span>/);
});

test("game string renderer converts color-valued style tags", () => {
  const input = "Cooldown: <s val=\"bfd4fd\" name=\"StandardTooltipDetails\">30 seconds</s>";
  const { html } = renderGameStringMarkup(input);

  assert.match(html, /<span class="storm-style storm-style--bfd4fd" data-storm-style="bfd4fd" style="color: #bfd4fd">30 seconds<\/span>/);
});
