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
npm run dev          # generate content, then serve on localhost:1111
```


| Command | What it does |
|---|---|
| `npm run gen` | generate `site/content/`, `site/data/` and `site/static/` from the submodules |
| `npm run build` | `gen`, then `zola build` |
| `npm run dev` | `gen`, then `zola serve` |
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
submodules/       the data sources
tests/            node:test suites
```

Read through [ARCHITECTURE.md](./ARCHITECTURE.md) for an explanation of what the
scripts do and how the site is built from their output.

## Data sources

This project relies on a few submodules that provide extracted and/or parsed
game data, as well as the official replay protocol. A big thank you to the
maintainers of these listed projects!

| Submodule | Provides |
|---|---|
| [heroes-data2](https://github.com/HeroesToolChest/heroes-data) | hero, ability and talent JSON per game version |
| [heroes-images](https://github.com/HeroesToolChest/heroes-images) | ability, talent and portrait art |
| [HeroesOfTheStorm_Gamedata](https://github.com/SquishyBrick/HeroesOfTheStorm_Gamedata) | the raw XML and GalaxyScript catalogs |
| [heroprotocol](https://github.com/Blizzard/heroprotocol) | Blizzard's replay decoding tables, per build |
| [HeroesOfTheStorm_S2MA](https://github.com/jamiephan/HeroesOfTheStorm_S2MA) | packaged `.stormmap` files, source for minimap art and terrain |

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
