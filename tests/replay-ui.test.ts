// The viewer's modules only ever run in a browser, so nothing else here would
// notice a missing import or an identifier left behind by a refactor. Linking
// the whole graph against a stub DOM catches both.

import assert from "node:assert/strict";
import test from "node:test";

/** Absorbs any property access or call, so DOM chains resolve to something. */
const el: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? undefined : el),
  apply: () => el,
  set: () => true,
});

function stubDom() {
  const g = globalThis as any;
  g.document = {
    getElementById: () => el,
    querySelector: () => el,
    querySelectorAll: () => [],
    createElement: () => el,
    addEventListener: () => {},
    fullscreenElement: null,
    activeElement: null,
  };
  g.window = { addEventListener: () => {} };
  g.Image = class {
    set src(_v: string) {}
  };
  g.location = { search: "" };
  g.fetch = async () => ({ ok: false, json: async () => ({}) });
  g.requestAnimationFrame = () => {};
  g.performance = { now: () => 0 };
}

test("the replay viewer's module graph links against a stub DOM", async () => {
  stubDom();
  const ui = await import("../site/static/replay/replay-ui.js");
  assert.ok(ui);
});

test("the Globes tab counts pickups and lost globes up to the scrubber time", async () => {
  stubDom();
  const { setState } = await import("../site/static/replay/ui/state.js");
  const panel = await import("../site/static/replay/ui/panel.js");
  const player = (playerId: number, team: number, name: string, globes: number[]) => ({
    playerId, team, name, hero: name, heroSlug: "", score: {}, talents: [], globes,
  });
  const model = {
    teamLevels: [[], []],
    players: [player(1, 0, "A", [100, 300]), player(2, 1, "B", [200])],
    globes: [
      { team: 0, endLoop: 90, outcome: "own", toucher: 1 },
      { team: 0, endLoop: 150, outcome: "expired" },
      { team: 0, endLoop: 250, outcome: "opponent" },
      { team: 1, endLoop: 50, outcome: "own", toucher: 2 },
      { team: 1, endLoop: 400, outcome: "expired" },
    ],
  };
  const state: any = { model, loop: 0 };
  setState(state);

  const html: string = panel.globesTableHtml();
  assert.match(html, /data-globes/);
  const ids = [...html.matchAll(/data-globe-cell="(\d+)"/g)].map((m) => m[1]);
  // Per team: expired, taken by enemy, then each player's picked up and received.
  assert.equal(ids.length, 8);
  const cells = ids.map((id) => ({ dataset: { globeCell: id }, textContent: "" }));
  const table = { isConnected: true, querySelectorAll: () => cells };
  panel.PANEL_TABS.find((t: any) => t.id === "globes").init({ querySelector: () => table });
  const text = () => cells.map((c) => c.textContent).join(" ");

  assert.equal(text(), "0 0 0 0 0 0 0 0");
  state.loop = 260;
  panel.updateGlobes();
  assert.equal(text(), "1 1 1 1 0 0 1 1");
  state.loop = 1000;
  panel.updateGlobes();
  assert.equal(text(), "1 1 1 2 1 0 1 1");

  table.isConnected = false;
  state.loop = 0;
  panel.updateGlobes();
  assert.equal(text(), "1 1 1 2 1 0 1 1");
});
