# Moonlit Knight

A turn-based storybook deck-builder (original clone — gameplay inspired by the
deck-builder genre; all names, card text, monster designs and art are original).

You are a knight of the moonlit book. Turn the pages through three chapters —
Village, Forest, Graveyard — fight original monsters, buy cards from the crow
merchant, take fairy blessings, and face the Grave Witch at the end.

## How to play

- **Turn-based combat.** Drag a card up toward the enemy and release to play
  it (or drag it over the enemy). Attack cards are free.
  Action cards cost Action (hourglass, refills each turn). Spells cost Mana
  (Mana does **not** refill — only Mana cards add it). Equipment is free to
  play and stays in play for the fight.
- **Tap / click a card** only enlarges it in the middle of the screen so it
  can be read — it never plays the card. Tap it again (or tap elsewhere) to
  dismiss the preview.
- **Armor** is a shield pool in front of HP. Piercing damage bypasses Armor.
- **Reshuffle rule.** At the end of every turn the discard pile shuffles back
  into the deck, and the hand returns to the deck at the start of the next
  turn — so every turn you draw a fresh hand of 5.
- **Run structure.** Each chapter shows 3 pages at a time (monster / shop /
  blessing / event / smithy). Pick one, then the next three appear. A boss
  gates the end of each chapter. Death retries the battle with full HP.

## Tunable numbers (src/engine.js — CONFIG)

| Setting | Value |
|---|---|
| Player start HP | 30 |
| Player start Mana | 2 |
| Action cap (per turn) | 2 |
| Cards drawn per turn | 5 |
| Start gold | 23 |
| Equipment slots (start) | 1 |
| Monster HP (proposed) | Thorn Wolf 20 · Rat King 33 · Hollow Stag 28 · Mire Wisp 25 · Mire Crocodile (boss) 60 · Grave Witch (final boss) 100 |

## Design notes

- **Smithy dual bonus.** A smithy upgrade gives +3 Armor per level to cards that gain Armor and +1 card drawn per level to cards that draw — a card that does both gets both bonuses (e.g. an upgraded Bulwark Stance gains +3 Armor *and* draws +1 extra card per upgrade level).
- **Counter cards cannot be upgraded.** Parry and Thorn Guard get no effect from smithy upgrades, so the smithy disables their rows with a "Counter cards cannot be upgraded" note instead of taking your gold.

## Run locally

```sh
# any static server, e.g.
python3 -m http.server 8123
# then open http://localhost:8123/
```

Or play on GitHub Pages: https://laoban-makeyourich.github.io/moonlit-knight/

## Development stages

- **Stage 0** — skeleton: title screen, asset preload, wiring.
- **Stage 1** — data + combat engine (pure JS) with node unit tests (`node tests/engine.test.js`, 20+ tests, all green).
- **Stage 2** — combat UI (DOM, no framework; CSS transform/opacity animations only).
- **Stage 3** — book/chapter flow, shops, blessings, events, level-ups, bosses (run `npm test` — engine, combat UI, blessings and book tests, all green).
- **Stage 4** — performance + stability pass (no console errors, lazy images, debounced buttons).
- **v0.6** — combat layout reworked to match the original game's arrangement
  (top bar, enemy ribbon, bottom-centre HUD, deck/discard arches); cards are
  now played by drag & drop, tap only enlarges. All module URLs carry
  `?v=0.6` — bump the version in every `?v=` specifier (index.html script
  tag + all `from './….js?v=…'` imports) on each release, or browsers may
  keep running a cached pre-fix module while the CSS is already new.
- **v0.7** — landscape-only like the original (16:9): a rotate prompt covers
  the screen in portrait (CSS media query) and Begin tries the Screen
  Orientation API on phones/tablets (best-effort, `src/orientation.js`);
  combat/book/title sizes use vh clamps so a short landscape phone screen
  fits. Version bumped to `?v=0.7` everywhere.

## Performance notes

- No framework, no per-frame JS timers; animations are CSS `transform`/`opacity` only.
- Images are lazy-loaded except the title screen; card art is pre-scaled to 342×519 JPG.
- Buttons are debounced against double activation.
