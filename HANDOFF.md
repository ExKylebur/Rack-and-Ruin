# Rack & Ruin — Session Handoff

Last updated: 2026-06-07 (card & table rework session)

## TL;DR
The full rewrite (Phases 0–5) is implemented and committed on the **`rewrite`**
branch. `master` is the untouched original baseline (`b7e0e5c`). The game is a
playable card-battler pool game with: a pool-accurate table, real physics,
standard rules for all four variants, the 30-card sabotage system, working online
multiplayer plumbing, and synthesized audio. **42 unit tests pass** (`npm test`).
The 2026-06-06 card & table rework backlog (all 11 items) is **done** — see below.

## ✅ DONE — Card & table rework backlog (2026-06-06 feedback, all 11 items)
Shipped on `rewrite` in four commits: `1bcbd1f` (items 6–11), `c351978` (1–3),
`69fe309` (5), `c12b6a7` (4). Each item was verified in-browser and/or by unit
test; the suite grew 39 → 42 (3 new spin tests).

1–3. **Card UX rework** — click-to-play replaces multi-select+Done; `drawCards`
   produces a unique offering (no dupes); the overlay separates "✨ Just Drawn"
   from "🃏 In Hand" with a "🎯 Playing this turn" tray (`phaseCards` replaced
   `cardSelected`). Files: `app.js`, `PLAY ME.html`, `styles/main.css`.
4. **Spin / English** — cue-ball dial in the right panel (`#spinDial`); top/back
   = follow/draw, sides = English; drag to set, dbl/right-click to clear; red
   marker on the cue while aiming. Physics: `applyShot` stores spin (×power);
   one-time impulse on first object-ball contact + rail-tangent kick that washes
   out. Files: `app.js` (`spin`, dial fns, `drawSpinMarker`), `physics.js`.
5. **Live placement ghost** — `drawPlacementGhost` (`render/effects.js`) follows
   the cursor for `place` picks (bouncer/trap/ice/mud/portal/move-hole); move-hole
   ghost turns red over a ball; `pickHover` tracked on mouse/touch move in `app.js`.
6. **Side-pocket diamonds removed** — dropped the `pa.cx` entries in
   `render/table.js drawDiamonds`.
7. **Cue stick lengthened** — `render/aim.js` `len2 = base * 22` (~25 ball-dia).
8. **Moved pocket pockets again** — `physics.js pocketCheck` widens capture for
   `p.moved` holes (`p.r + b.r*0.75`); `app.js resolvePick` rejects move-hole onto
   a ball (toast).
9. **Fog of War** — `drawFog` (`render/effects.js`) blacks out all but a sight
   beam down the aim line to the first object ball; wired in `app.js render`.
10. **Drunk** — removed the shot-time and per-frame cue jitter in `physics.js`;
    kept only the aim sway, tightened to ±5° (`0.087` in `app.js render`).
11. **Shrink/Block pocket shape** — `render/effects.js` redraws shrink as a smaller
    bore and block as a hazard barrier across the mouth.

> Online check: confirmed these added **no new serialized state**. Fog uses the
> existing `activeEffects.fogOfWar`; spin is consumed within the shot and never
> enters the settled snapshot. `serializeSnapshot`/`applySnapshot` unchanged; the
> snapshot round-trip test still passes.

## ⭐ NEXT UP
With the backlog cleared, the open work is the **NOT-yet-verified gaps** below —
chiefly the **live 2-client online test** (never run with two real browsers) and a
**per-card playtest** of all 30 cards.

**Recent UX revisions (2026-06-07, commits `8117dc3`, `e142d83`, `5b2332a`):**
- **Card phase now plays from the right-panel Hand — no modal.** Drawn cards land
  in `#handArea` (badged NEW); click a card to play it, one at a time, up to
  `PLAY_PER_TURN`. While a pick resolves, a "▶ Playing <card> — <prompt>" banner
  (`#nowPlaying`) shows over the table and the hand locks. Unplayed cards persist.
  Driver: `beginCardPhase`/`playHandCard`/`updateCardPhaseUI`/`afterCardResolved`
  in `app.js`; `phaseNewIds` is the NEW set. The old `#cardOverlay` modal is gone
  (its `.card-grid`/`.card-pick-item` CSS is now dead — safe to delete).
- **Warp Rail is a pocket relocator** (like Move Hole), NOT a cushion warp. It
  picks a pocket then drags it anywhere not on a ball (writes `movedPockets`). The
  earlier warped-cushion code (`geometry.warpRail`, physics warp faces, `state.warp`)
  was fully removed.
- **Player ball icon shows solids/stripes** in 8-ball/doubles (`updatePlayers`).

**For the many more cards to come**, the pattern is: applier in `cards/effects.js`
(mutating `activeEffects`/`balls`/`movedPockets`/`pocketState`) + catalogue entry
with `interactions` in `cards/registry.js`; any new shared geometry goes in
`geometry.js` as a pure fn so physics and render agree; cover with a `node --test`.

## How to run
- **Double-click `launch.bat`** → starts the Python server and opens the browser.
  (You MUST use the server — the game uses ES modules, which browsers block over
  `file://`. Opening `PLAY ME.html` directly will show the menu but nothing runs.)
- Tests: `npm test` (Node's built-in runner; no deps).
- Upload to GitHub: **`push-to-github.bat`** (remote: ExKylebur/Rack-and-Ruin).

## Architecture (all under `src/`, vanilla ES modules, no build step)
- `geometry.js` — table geometry as pure fns; **relative {u,v} coords** (0..1 of
  play area) so state is resolution-independent. `cushions()` = angled jaw faces
  that funnel into pockets (physics + render share this).
- `state.js` — the single source of truth + `serializeSnapshot`/`applySnapshot`.
- `physics.js` — pure sim in a fixed CANON pixel space (so every machine
  simulates identically). Reads card effects via `env`. Emits sound events.
- `rules/` — `index.js` dispatch + `eightball/nineball/cutthroat`. `evaluateTurn`
  returns `{foul,keepTurn,gameOver,winner,reason,ballInHand,respot,message}` and
  assigns groups. `commitmentLabel()` powers the per-player UI.
- `cards/registry.js` (30 ids, stable) + `cards/effects.js` (pure appliers).
- `online/client.js` — create/join/push/long-poll.
- `render/{table,ball,aim,effects}.js` — render is a pure function of state.
- `app.js` — entry: setup, input, shot loop, card phase, turn flow, online glue.
- `server/multiplayer_server.py` — `ThreadingHTTPServer`; rooms/tokens/long-poll.

## What works (verified)
- Table look (user-approved): wood rails, green bed, angled cushion facings that
  funnel, recessed side pockets, flat cushion colour.
- Physics: break/aim/charge/shoot, pocket funnel, scratch.
- Rules: group assignment + lock-in (8-ball), lowest-first + 9-ball win, cutthroat
  last-alive, doubles teams; ball-in-hand on fouls; commitment shown next to names.
  (10 rules unit tests.)
- Cards: draw → card overlay → select → table-pick interactions → effect applied +
  overlay; effects feed physics; one-shot ball effects clear, table effects decay.
- Online: server room API + threading **validated via live requests** (independent
  request returned in 3 ms while a 7 s long-poll was open). Snapshot round-trip
  unit-tested.
- Audio: shot/ball/rail/pocket/card/win SFX wired (unlocks on first click).

## NOT yet verified / known gaps (start here next session)
1. **Live 2-client online test.** The plumbing is done but never run with two real
   browsers. Test: host `launch.bat`, Create Room, Rack Up; second browser opens
   the invite link, Join. Verify turn-lock, snapshot sync, card sabotage crossing
   over, ball-in-hand, win. Likely small bugs to shake out (e.g., joiner name not
   synced — currently host's snapshot names win; that's a known simplification).
2. ~~`warp_rail` card is inert~~ — **DONE** (`ff66d6d`): real warped cushion ridge,
   physics + render share `geometry.warpRail`.
3. **Per-card playtest** — only the card *flow* + a few effects were verified in
   browser. Play all 30 and tune feel/visuals (esp. portals, bouncer, magnet).
4. **rAF throttling gotcha** — the shot loop uses requestAnimationFrame, which the
   browser pauses when the tab is unfocused. For headless/debug, `window.RR.simShot
   (power, angle)` runs a shot synchronously. Not a gameplay bug.
5. Minor polish: phone-aim is relative-to-drag (works but could aim from cue);
   no diagnostics panel; doubles/cutthroat not selectable online (by design).

## Dev hooks (browser console, `window.RR`)
`start()`, `shoot(power,angle)`, `simShot(power,angle)` (headless), `isMyTurn()`,
`pick()`, `queue()`, `clickRel(u,v)`, `moveHole(i,u,v)`, `setSize(num,size)`.

## Commit trail (rewrite branch)
b7e0e5c baseline · Phase0 geometry/tests · Phase1 render-from-state · Phase1b
playable · cushion fixes (several) · Phase2 cards (499c9f3) · Phase3 rules
(da63e26) · Phase4 online (e82c038) · Phase5 audio (1e66f91).

## Decisions locked
- D1: relative {u,v} coords. D2: shooter simulates, broadcasts settled snapshot.
- Card ids are stable (online compatibility). Render == physics geometry.
