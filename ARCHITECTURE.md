# Architecture

`extract-gamedata.ts` pulls the current game build from Blizzard's CASC content
servers into `.gamedata/`, and the `gen-*.ts` scripts produce the data files the
site is built from. Extraction is a separate step: it is the only one that needs
the network, and it only has to rerun when a new build ships.

Output may be written to any of:


- `site/content/`: Markdown with TOML front matter. Zola turns each file into a
  page. Mostly generated (e.g. hero pages)
- `site/data/`: JSON that templates read at build time, through Zola's
  `load_data`. This is how e.g. ability cards on a hero page get populated.
  Files here are not directly served by the site.
- `site/static/`: copied to the site root as-is. This is data the site
needs for some functionality at runtime (e.g. for being able to resolve
abilities from replays)

## The generation pipeline

`npm run gen` runs `scripts/gen.ts`, which holds the task graph: each generator
declares the tasks whose output it reads, and the runner starts as many at once
as those dependencies and the core count allow. `--serial` runs one at a time,
which is easier to read when a generator is misbehaving.

The wall time is the longest dependency chain, currently
`gen-gamedata` -> `gen-heroes` -> `gen-cross-references` -> `gen-search`.

The effect graph never changes once built, so `walk.ts` keeps each parent chain
and an index of the apply-behavior effects per behavior, `gating.ts` inverts
talent-to-behavior grants, and `owners.ts` keeps one alias table per anchor
index. Without them each of the 37 mechanics re-walked the whole graph.

| Script | Writes | Notes |
| --- | --- | --- |
| `gen-fonts` | `static/fonts/*.woff2` | instances `data/fonts/` to the weights `main.scss` declares; see below |
| `gen-gamedata` | `content/gamedata/**`, `data/anchor-map.json`, `data/gamedata-tree.json`, `static/gamedata-tree.json`, `static/id-lookup.json` | a page per XML/Galaxy file, plus an ID/file index |
| `gen-mechanics` | `data/mechanics.json` | the gameplay mechanics the effect index is built around |
| `gen-heroes` | `content/heroes/*.md`, `data/heroes/*.json`, `static/shortcode-data.json`, `static/hero-aliases.json`, `static/images/` | |
| `gen-cross-references` | `data/cross-references.json` | see below |
| `gen-battlegrounds` | `content/battlegrounds/*.md`, `data/battlegrounds/*.json` | |
| `gen-draft-data` | `static/draft/draft-data.json` | hero list for the draft tool |
| `gen-minions` / `gen-structures` | `data/minions-and-mercs.json`, `data/structures.json` | |
| `gen-replay-*` | `static/replay/**` | see below |
| `gen-experience` | `content/experience.md`, `data/experience.json` | |
| `gen-search` | `static/site-search.json` | needs every other index to exist |
| `gen-build-info` | `data/build-info.json` | |

`npm run clean` deletes all generated data.

Each task also declares which half of the extraction its `.gamedata/` inputs
come from. `casc-extract` writes `mods/` ("mods"), and the HeroesDataParser run
after it writes `data/`, `gamestrings/` and `images/` ("parsed"). No mods task
reads a parsed task's output, which is what lets `npm run refresh` run the mods
half of the graph while the parser is still working. `tests/gen-tasks.test.ts`
holds that invariant. `npm run extract && npm run gen` does the same work
without the overlap.

`gen-replay-maps` renders a map only when the packaged archive's hash is not
already in `maps.json`, which takes a repeat run from ~50s to under a second.
`MAPS_FORCE=1` renders every map again.

### Webfonts

`data/fonts/` holds the unsubset sources; `gen-fonts` instances each one to the
single weight its `@font-face` declares and subsets it to that face's
`unicode-range`.

Google Fonts' Rajdhani ships ~50 glyphs per weight whose `glyf` bounding boxes
disagree with their control points, which makes Firefox log
`glyf: Glyph bbox was incorrect; adjusting`. The vendored copies are repaired,
so re-downloading Rajdhani reintroduces it. To repair again:

```python
from fontTools.ttLib import TTFont
f = TTFont(path)
for name in f.getGlyphOrder():
    f['glyf'][name].recalcBounds(f['glyf'])
f.flavor = 'woff2'
f.save(path)
```

Inter needs no such repair. harfbuzz carries corrected bounds through subsetting.

## The client bundle

`npm run build` runs `bundle-client.ts` between `gen` and Zola. esbuild bundles
three entry points (`hotsixors.js`, `replay/replay-ui.js`, `draft/draft.js`) as
ES modules with code splitting, plus the two classic scripts
(`level-slider.js`, `underdog-calc.js`) as IIFEs, into `static/bundle/`.

Stylesheets go through the same pass. The bundler compiles `sass/main.scss` and
`sass/gamedata.scss` with dart-sass into `static/`, then takes those two plus
`replay/replay.css`, `draft/draft.css` and `lost-in-the-nexus/viewer.css` as CSS
entry points. Zola's own `compile_sass` is off. A `.scss` edit therefore needs
`npm run bundle`; `zola serve` alone will not pick it up.

Output names carry a content hash, so `_headers` caches the whole directory
immutably. Templates resolve an entry through `data/bundles.json`, which the
bundler writes alongside `data/bundle-sources.json`; `prune-bundled-sources.ts`
reads the latter to delete the now-duplicated sources from `site/public` after
Zola copies `static/`.

Only `lost-in-the-nexus/nexus-game.css` stays unhashed: its script fetches it by
plain path. It caches for ten minutes, like the pages.

`hotsixors.js` only holds what every page needs (nav, site search, grid filter,
hero list controls). The game data explorer, the talent builder and the effect
index live in `js/*-page.js` and are `import()`ed when their markup is present,
so an ordinary page never downloads them. `js/index.js` re-exports every client
module for the Node tests and is never served.

`gen-og-card.ts` renders the fallback social card. It is not part of `gen`: run
`npm run gen:og-card` when the site name or tagline changes.

### Shared generator code

`scripts/lib/` contains some shared utilities.

- `heroes-data.ts`: reads the parsed hero, unit and gamestring JSON out of
`.gamedata/`, keyed by the build in `mods/hdp.info`.
- `paths.ts`: every input and output location, plus the extracted build's
version. `HOTS_DATA_ROOT` moves the extraction root.
- `catalog-xml.ts`: Regex helpers for reading the XML catalogs. Eventually this
should probably get replaced with a proper XML parser.
- `battleground-xml.ts`: helpers to extract map-specific unit data across
multiple mod files.
- `galaxy-source.ts`: Helpers to parse some known values out of GalaxyScript
files so we can extract e.g. map objective timers reliably.
- `gamestrings.ts`: handles parsing some gamestrings like tooltips and turns
them into a format the site can use.
- `hero-entries.ts`: resolves an ability or talent into text, icon, stats and
  a `shortcode-data.json` entry.
- `stormmap.ts`: parses data out of a .StormMap file like terrain structure,
lane waypoints, etc.
- `fs.ts`: reads and writes files. Every write creates its parent directory, so
no gen script calls `mkdir` itself.
- `script.ts`: `runScript(import.meta.url, main)`, the entry point every gen
script ends with. It logs the start, skips `main` when the module is imported
rather than run, and turns a failure into a non-zero exit code.
- `frontmatter.ts`: builds and reads Zola's TOML front matter.
- `gamedata-paths.ts`: decides which files under `mods/` the site publishes,
and loads the XML catalogs the effect graph reads.
- `json-patch.ts`, `png.ts`, `python-literal.ts`.

## The effect graph

This is a still somewhat experimental parser which attempts to find out how
abilities function (what "effects" they apply) by thoroughly scanning through
the XML that defines those abilities.

The code attempts to construct a graph, walking the deepest nodes (e.g. the
final applyset of an ability) upwards until it can find a link to an actual
mechanic.

Several issues have to be solved here, like constructing the whole graph in the
first place, finding out if nodes are conditional (e.g. they require a talent),
etc.


| Module | Question |
|---|---|
| `build.ts` | what does the graph look like? |
| `walk.ts`, `traverse.ts` | what can this ability reach? |
| `apply.ts` | which effects actually apply a behavior? |
| `gating.ts` | is this branch conditional, and on what? |
| `polarity.ts` | is this done to an enemy or an ally? |
| `owners.ts` | whose ability is this? |
| `membership.ts`, `filter.ts`, `exclusions.ts` | should this count? |
| `protection.ts` | is this a cleanse or an immunity rather than an application? |

`gen-cross-references.ts` uses these and writes `cross-references.json`, which
the effect index page reads.

It's very easy to accidentally introduce problems when changing how the graph
parsing logic works, so I recommend snapshotting the generated
cross-references.json that gets built, and then diffing it with the newly
generated file to see if your changes did not produce unintended side-effects.

## The replay viewer

The replay viewer works locally in a users browser. This is achieved by,
among other things, porting MPQ parsing (based on `mpyq`) and heroprotocol
(the official HotS replay parser written in Python) into JavaScript.

`gen-replay-protocols.ts` also automatically parse new `heroprotocol` versions
into `typeinfos.js` so the parser continues to work across build updates.

Finally, to reliably detect abilities, `gen-replay-abillinks.ts` constructs
a mapping of `m_abilLink` (which is contained in the payload of a `SCmdEvent)
to the ability name. This was done by reverse engineering across a large set
of replays to figure out in what order the game assigns `m_abilLink` IDs.

A big thank you to [Ebshimizu/Falindrith](https://ebshimizu.github.io/stats-of-the-storm/hots-replay-data.html),
and other community members like barrett777, for their amazing work detailing
the replay events.

And the client side, we then make use of the following:


```
mpq.js + bzip2.js     open the archive
protocol.js           decode events with the tables for this replay's build
analyze.js            build the model
replay-ui.js          draw it
```

### Parsing

A `.StormReplay` is an MPQ archive. `mpq.js` opens it, `bzip2.js` handles the
compression, `protocol.js` decodes the event streams.

### The model

`analyze.js` makes two passes and returns one model:

- `analyze/tracker.js`: `replay.tracker.events`: which units existed, where,
  who owned them, what the game reported
- `analyze/commands.js`: `replay.game.events`: what each player ordered

The rest is supporting detail: `registry.js` (unit tag bookkeeping, tag indices
are recycled constantly, so a lookup by index has to pick whichever unit held it
at that loop), `objective-events.js` and `objective-sites.js` (map objectives),
`phases.js` (objective rounds), `timeline.js` (position estimation),
`stat-events.js`, `selection.js`, `units.js`.

**Positions are estimated.** Replays log a unit's position only every 10-15
seconds. Between those anchors the viewer walks the unit toward its last
movement order at its own speed, routed around terrain, and snaps back whenever
a real position arrives.

The estimates try to take into account movement abilities, Hearthstones, lane paths,
camera positions and other things, but ultimately it's a best-guess and the viewer
may be off by a decent margin.

### Maps

`gen-replay-maps.ts` renders each battleground from its packaged `.stormmap`:
a schematic minimap, a per-cell mask the viewer ray-casts sight lines and routes
units against, and metadata (camera bounds, lane waypoints, the regions each
team permanently sees).

### The UI

`replay-ui.js` loads the data and wires the page. `replay/ui/` holds the rest:
`drawing.js` (canvas), `panel.js` (talents, scores, XP chart), `feed.js` (event
log and objective band), `viewport.js` (zoom, pan, full screen),
`playback.js`, plus some modules for icons, sight radii, ability naming and
structure naming. `ui/state.js` holds the shared viewer state.

## Draft tool

A peer-to-peer networked mock drafting tool.

| Module | Job |
| --- | --- |
| `draft.js` | entry point; owns app state, wires network events to state transitions and re-renders |
| `draft-state.js` | reducer, applies events to the draft state |
| `draft-net.js` | Trystero (WebRTC over public trackers) wrapper; one room per lobby code, two broadcast channels (`cmd`: captain to host, `event`: host to all) |
| `draft-timer.js` | per-turn countdown, fires host-side auto-pick on expiry |
| `draft-snapshot.js` | base64url-encodes the finished draft into the result URL, so it can be shared after the p2p network closes |
| `draft-storage.js` | localStorage: remembered name, captain token per lobby (for rejoin-on-reload), last state snapshot per lobby |
| `draft-ui.js` | render functions for the four screens: landing, lobby, drafting, result |

**Host authority.** One peer is host and is the only one allowed to mutate
`state` (`applyEvent`); everyone else sends `cmd` requests and waits for the
host to broadcast the resulting `event`. This avoids conflict resolution,
as there's a single writer. If the host disconnects, remaining peers
(generally just the other captain) run a deterministic election
(`electHost` in `draft-net.js`: highest last-seen event
sequence number wins, lex-smallest peer id breaks ties) and the winner
broadcasts a fresh snapshot to resync everyone.

State itself is otherwise a plain immutable object (lobby code, captains,
firstPick, bans/picks per team, `step` index into `PHASE_TABLE`, turn
deadline) rebuilt via `applyEvent`, so any peer can catch up from a single
`snapshot` event.

## Copy editing

`npm run dev` starts an edit server (`scripts/copy-server.ts`, port 1112)
next to `zola serve`. `base.html` loads its client script only when
`config.base_url` is local, so nothing of it ships.

`scripts/lib/copy-registry.ts` derives the registry on every request: no ids
are stored anywhere. It scans three kinds of source and records a byte range
per string.

| Kind | Sources | Encoding on save |
| --- | --- | --- |
| `template` | text runs in `site/templates/**/*.html`, and raw HTML inside markdown | `&` and `<` escaped; Tera markup rejected |
| `markdown` | headings, list items, paragraphs and `title`/`description` in `site/content` outside the generated directories | written as typed |
| `ts` | allowlisted fields in `battlegrounds-config.ts` and `gen-mechanics.ts` | re-escaped as a string literal |

The client (`scripts/lib/copy-edit-client.js`) matches rendered text against
the registry by whitespace-normalized text: elements first, then remaining
text nodes, which it wraps in a span. Text that resolves to one entry edits
in place; anything ambiguous, or whose source differs from what the page
shows, opens a panel on the raw source text.

A save re-scans the file, checks the range still holds the text the client
started from, rewrites it, then reruns the generator the entry names
(`gen-battlegrounds`, `gen-mechanics`). Zola picks up the write and reloads.
