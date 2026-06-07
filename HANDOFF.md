# Rack & Ruin — Session Handoff

Last updated: 2026-06-06 (overnight rewrite session)

## TL;DR
The full rewrite (Phases 0–5) is implemented and committed on the **`rewrite`**
branch. `master` is the untouched original baseline (`b7e0e5c`). The game is a
playable card-battler pool game with: a pool-accurate table, real physics,
standard rules for all four variants, the 30-card sabotage system, working online
multiplayer plumbing, and synthesized audio. **39 unit tests pass** (`npm test`).

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
2. **`warp_rail` card is inert** — sets `state.warp` but physics/render ignore it.
   Either implement warped rails or repurpose the card.
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
