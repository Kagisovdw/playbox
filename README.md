# Playbox

**Play it: https://kagisovdw.github.io/playbox/**

Five board and card games in one browser app: **Ludo**, **Uno**, **Snakes & Ladders**,
**Connect Four** and **Memory**. Every game supports computer opponents and
pass-and-play on a single device.

## Running it

Double-click `index.html`. That's it — no build step, no install, no server.

Everything is plain HTML, CSS and classic `<script>` files, so it runs straight from
`file://`. It works offline and has no external dependencies.

## Installing it as an app

Playbox is a PWA, so it installs to a phone home screen or the Windows taskbar and
runs offline like a native app — no store, no packaging.

Open <https://kagisovdw.github.io/playbox/> and use your browser's **Install** /
**Add to Home Screen** option.

That needs the folder served over **http(s)**; service workers are blocked on
`file://`, so double-clicking `index.html` gives you the games but not the install
prompt. To try it locally instead:

```
python -m http.server 8000
```

Then open `http://localhost:8000`.

The pieces: `manifest.webmanifest` (name, colours, icons), `sw.js` (offline cache),
and `icons/` (generated PNGs of the brand mark). The service worker is
stale-while-revalidate — it serves the cached copy instantly and refreshes in the
background, so your edits appear on the next load rather than never. If you ever need
to force every client to drop its cache, bump `CACHE` in `sw.js`.

### Sharing a link instead

`tools/build-artifact.py` rewrites `index.html` into `dist/playbox.html` with the
`<html>/<head>/<body>` scaffold stripped, ready to publish as a Claude Artifact — a
private URL that runs on any device with nothing installed. Re-run it after changing
`index.html`.

## The games

| Game | Players | Opponent |
|---|---|---|
| Connect Four | 2 | Alpha-beta minimax, three depths |
| Ludo | 2–4 | Heuristic (captures, safety, blocking) |
| Snakes & Ladders | 2–4 | Pure chance — the computer just rolls |
| Uno | 2–4 | Heuristic (card value, colour control, pressure) |
| Memory | 2–4 | Imperfect recall — three retention levels |

Each seat is set to **Human** or **Computer** independently, so you can play solo
against bots, hand the device around a table, or mix both.

### Rules implemented

**Connect Four** — standard 7×6. `Easy` searches one move ahead and wanders; `Normal`
four; `Hard` six and will punish a loose move.

**Ludo** — 52-square shared track, four tokens each. A six frees a token and grants
another roll. Landing on a lone opponent sends it back to its yard and earns a bonus
roll. The eight ★ squares are safe. Two of your tokens on one square form a **block**
opponents cannot land on or pass (switchable in setup). Reaching home needs an exact
roll. Three sixes in a row forfeits the turn.

**Snakes & Ladders** — the classic Milton Bradley layout. Two house rules are
switchable: roll again on a six, and exact roll to finish (overshooting 100 bounces
you back).

**Memory** — a grid of face-down pairs; flip two a turn and claim what matches.
Claimed pairs stay face up in the finder's colour. Board size is switchable between
20 and 36 cards, a match can earn another go, and an optional opening peek shows the
whole board first. Difficulty is how much the computer actually *remembers*: `Easy`
keeps only a handful of cards and forgets most flips, `Normal` holds the last few and
lets the rest fade, `Hard` never forgets a card you turn over. Most pairs wins; equal scores tie.

**Uno** — full 108-card deck. Skip, Reverse, Draw Two, Wild and Wild Draw Four, with
correct two-player Reverse behaviour (it acts as a Skip). Draw one, then play it if it
matches. **Wild Draw Four bluffing and challenges** are implemented per the official
rules: you may play it even when you hold a matching colour, but the next player can
challenge — a caught bluffer draws 4, a wrong challenger draws 6. Calling **UNO!** is
on a timer; miss it and you draw two. The computers forget sometimes, so you can catch
them. Optionally play a full match to 500 points.

## Controls

- **Connect Four** — click a column, or press `1`–`7`.
- **Ludo / Snakes** — click the dice; in Ludo click a highlighted token to move it.
- **Uno** — click a playable card, or the draw pile. Dimmed cards cannot be played.
- **Memory** — click any face-down card.
- The `?` button in the top bar opens that game's rules at any time.

Pass-and-play hides your hand behind a "Pass to …" confirmation whenever the device
changes hands, so nobody sees anyone else's cards.

## Project layout

```
index.html        app shell: top bar, menu, setup and game screens
css/style.css     design tokens + every board's styling
js/core.js        DOM helpers, game registry, modal/toast, dice, game shell
js/app.js         menu, per-game setup screen, routing
js/connect4.js    board, minimax engine
js/snakes.js      board geometry, SVG snakes and ladders, movement
js/ludo.js        track geometry, move generation, captures, blocks, AI
js/uno.js         deck, turn flow, action cards, challenges, UNO calls, AI
js/memory.js      deck, flip/match flow, per-CPU memory model

manifest.webmanifest  PWA metadata: name, colours, icon set
sw.js                 service worker: offline cache (stale-while-revalidate)
icons/                app icons, generated from the brand mark
tools/                build-artifact.py - derives dist/playbox.html for publishing
dist/                 generated output, safe to delete
```

### Adding a game

Games are self-registering. A module calls `G.Games.register({...})` with its
metadata and a `start(root, config)` function; the hub builds the menu card and the
setup screen automatically from that definition.

```js
G.Games.register({
  id: 'mygame', name: 'My Game', tagline: '…', accent: '#7c5cff', icon: '<svg…>',
  minPlayers: 2, maxPlayers: 4, difficulty: true,
  seatColors: ['#f0483c', '#22b36b', '#f5c518', '#2f7df6'],
  options: [{ key: 'someRule', label: 'Some rule', hint: '…', default: true }],
  rules: '<h4>Goal</h4>…',
  start: function (root, config) { /* … */ return { destroy(){} }; }
});
```

`config` provides `seats` (name, colour, `isAI`), `difficulty`, `options`, and the
callbacks `exit()`, `restart()` and `finish(humanWon)`. Add the file to the script
list in `index.html`. Use `G.Shell(root)` for the standard HUD, banner, board stage
and action bar, and `G.Ticker()` for delays that must stop cleanly when the player
leaves mid-game.

## Notes

- Win/loss records and your last setup per game are kept in `localStorage`. Clearing
  site data resets them; the app degrades gracefully if storage is unavailable.
- Respects `prefers-reduced-motion`.
- Layout adapts down to phone widths.
