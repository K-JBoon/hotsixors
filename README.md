# HotSixors

A site containing tools and reference material for Heroes of the Storm, at [hots.epixors.com](https://hots.epixors.com).

This project aims to automate almost all of the site content based on extracted
game data. It's served as a static site, with no back-end server required to run
it.

## Getting it running

Needs [Zola](https://www.getzola.org/) and [Node](https://nodejs.org/en/download) 18+ (LTS recommended).

```bash
git clone --recurse-submodules https://github.com/K-JBoon/hotsixors
cd hotsixors
npm install
npm run extract      # download and parse the game data (~7 minutes, ~600 MB)
npm run dev          # generate content, then serve on localhost:1111
```

`extract` only needs rerunning when a new game build ships.


| Command | What it does |
|---|---|
| `npm run extract` | download and parse the current live build into `.gamedata/` |
| `npm run extract:ptr` | the same for the PTR build, into `.gamedata-ptr/` |
| `npm run gen` | generate `site/content/`, `site/data/` and `site/static/` from `.gamedata/` |
| `npm run build` | `gen`, then `zola build` |
| `npm run dev` | `gen`, then `zola serve` |
| `npm run dev:ptr` | the same, from `.gamedata-ptr/`. See [PTR](#ptr) |
| `npm run clean` | delete everything `gen` writes |
| `npm test` | run the test suite |
| `npm run typecheck` | `tsc` over `scripts/` |


## Tests

```bash
npm test
```

The replay tests want a directory of real `.StormReplay` files and skip
themselves when there isn't one. Point `REPLAY_DIR` at yours to run them:

```bash
REPLAY_DIR=~/path/to/Replays/Multiplayer npm test
```

## Layout

```
scripts/          generators, one per output; shared code in scripts/lib/
site/             the Zola site
  content/        pages (mostly generated)
  templates/      Tera templates
  static/         client-side JS, CSS and generated JSON
  sass/           styles
submodules/       heroprotocol, the one external source left
.gamedata/        extracted game data (generated, ignored)
tests/            node:test suites
```

Read through [ARCHITECTURE.md](./ARCHITECTURE.md) for an explanation of what the
scripts do and how the site is built from their output.

## Data sources

`npm run extract` reads Blizzard's CASC content servers directly, using
[HeroesDataParser](https://github.com/HeroesToolChest/HeroesDataParser). It
writes one self-contained tree, whichever build the servers currently carry:

| Path | Holds |
|---|---|
| `.gamedata/mods/` | the raw XML and GalaxyScript catalogs, plus the packaged maps under `core.stormmod/base.stormdata/depotcache/` |
| `.gamedata/data/` | hero, unit and map JSON |
| `.gamedata/gamestrings/` | resolved tooltip text, with the per-battleground overlays under `maps/` |
| `.gamedata/images/` | ability, talent, portrait and loading screen art |
| `.gamedata/mods/**/*.dds` | the minimap icon textures, converted to PNG during generation |
| `.gamedata/mods/hdp.info` | the build that was extracted, and whether it is the PTR |


[heroprotocol](https://github.com/Blizzard/heroprotocol) is used to generate the
JavaScript-based replay parser from.

A big thank you to the maintainers of HeroesDataParser, and to
[jamiephan](https://github.com/jamiephan) and
[HeroesToolChest](https://github.com/HeroesToolChest), whose published
extractions this project ran on when it first started.

## Licence

Licensed under either of the following, at your choice:

- [Apache License, Version 2.0](LICENSE-APACHE.txt), or
- [MIT license](LICENSE-MIT.txt)

Unless explicitly stated otherwise, any contribution intentionally submitted for
inclusion in this project, as defined in the Apache-2.0 license, shall be
dual-licensed as above, without any additional terms or conditions.

The licence covers the code in this repository. It does not cover Heroes of the
Storm's data or artwork, which remain Blizzard's.

## Disclaimer

Not affiliated with or endorsed by Blizzard Entertainment. Heroes of the Storm
and all related assets are trademarks or registered trademarks of Blizzard
Entertainment, Inc.
