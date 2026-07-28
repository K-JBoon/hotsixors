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
