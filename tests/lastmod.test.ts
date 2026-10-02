import assert from "node:assert/strict";
import test from "node:test";
import { commitDates, contentUrl, lastmodByUrl } from "../scripts/gen-lastmod.ts";

test("commitDates keeps the newest date per file", () => {
  const log = "\x002026-09-27\n\n_index.md\nreplay.md\n\x002026-09-01\n\nreplay.md\nabout.md\n";
  assert.deepEqual(
    commitDates(log),
    new Map([
      ["_index.md", "2026-09-27"],
      ["replay.md", "2026-09-27"],
      ["about.md", "2026-09-01"],
    ]),
  );
});

test("contentUrl follows Zola's path rules", () => {
  assert.equal(contentUrl("_index.md", "+++\ntitle = \"Home\"\n+++\n"), "/");
  assert.equal(contentUrl("replay.md", "+++\ntitle = \"Replay\"\n+++\n"), "/replay/");
  assert.equal(contentUrl("heroes/_index.md", "+++\n+++\n"), "/heroes/");
  assert.equal(contentUrl("heroes/x.md", "+++\nslug = \"abathur\"\n+++\n"), "/heroes/abathur/");
  assert.equal(contentUrl("gamedata/a/b.md", "+++\npath = \"gamedata/a/b.xml\"\n+++\n"), "/gamedata/a/b.xml/");
  assert.equal(contentUrl("guides/x.md", "+++\n[extra]\nslug = \"nope\"\n+++\n"), "/guides/x/");
});

test("lastmodByUrl dates sections by their newest page", () => {
  const files = [
    { rel: "_index.md", url: "/" },
    { rel: "about.md", url: "/about/" },
    { rel: "heroes/_index.md", url: "/heroes/" },
    { rel: "heroes/abathur.md", url: "/heroes/abathur/" },
  ];
  const committed = new Map([
    ["_index.md", "2026-08-01"],
    ["about.md", "2026-09-01"],
    ["heroes/_index.md", "2026-07-01"],
  ]);
  assert.deepEqual(lastmodByUrl(files, committed, "2026-09-30"), {
    "/": "2026-09-01",
    "/about/": "2026-09-01",
    "/heroes/": "2026-09-30",
    "/heroes/abathur/": "2026-09-30",
  });
});
