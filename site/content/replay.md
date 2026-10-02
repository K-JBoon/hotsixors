+++
title = "Replay Viewer"
description = "Open Heroes of the Storm .StormReplay files in your browser to see the match on the map with stats. Files stay on your computer."
template = "replay.html"
+++

## Watch Heroes of the Storm replays in your browser

Open `.StormReplay` files directly in your browser. Drop one or more files on this
page to play the match in the replay viewer. All parsing happens in your browser.
Your files stay on your computer.

## What you see

- **Heroes** move on the map, with vision and fog of war for each team.
- **Cameras** show where each player was looking.
- **Structures** show when they go down
- **Merc camps and objectives** show when they are active, and who capped them
- **Event feed** lists ultimates, abilities, deaths, level ups, merc
  captures, structures and objectives. Pick a player to see only their
  events.
- **Talents** for each hero, with tooltips.
- **Scores** like hero damage, siege damage, healing, damage taken, XP
  contribution and time dead.

## Where to find replays

The game saves a replay of each match you play.

- **Windows**: `Documents\Heroes of the Storm\Accounts\<account>\<region>-Hero-<id>\Replays\Multiplayer`
- **macOS**: `~/Library/Application Support/Blizzard/Heroes of the Storm/Accounts/<account>/<region>-Hero-<id>/Replays/Multiplayer`
- **Linux** (Wine or Proton): `<prefix>/drive_c/users/<user>/Documents/Heroes of the Storm/Accounts/<account>/<region>-Hero-<id>/Replays/Multiplayer`

## Limits

A replay does not contain the full game. It holds player commands and some tracked events.
The viewer reads it with Blizzard's
[heroprotocol](https://github.com/Blizzard/heroprotocol) tables and the
current game data, and does it past to simulate how the game went.

Some limitations:

- Hero paths between position samples follow move commands around terrain.
- Abilities in the feed are key presses. The replay does not say if the cast
  went off.
