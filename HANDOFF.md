# Rack & Ruin — Session Handoff

Last updated: 2026-06-06 (overnight rewrite session)

## TL;DR
The full rewrite (Phases 0–5) is implemented and committed on the **`rewrite`**
branch. `master` is the untouched original baseline (`b7e0e5c`). The game is a
playable card-battler pool game with: a pool-accurate table, real physics,
standard rules for all four variants, the 30-card sabotage system, working online
multiplayer plumbing, and synthesized audio. **39 unit tests pass** (`npm test`).

## ⭐ NEXT UP — Card & table rework backlog (do this BEFORE any online/downstream polish)
User feedback 2026-06-06. These are intentionally NOT yet implemented — several
touch the card UX, physics, and render together and will affect online sync, so do
them as one coordinated pass and re-test online afterward.

**Card UX / drafting**
1. **Draw into hand, click to play.** Drawn cards should land in the player's hand;
   the player then clicks a card in their hand to play it — replace the current
   "select up to 2 in an overlay + Done" flow. Files: `app.js`
   (`beginCardPhase`/`buildCardGrid`/`drawCards`/`onCardPhaseDone`), `PLAY ME.html`
   (`#cardOverlay`/`#handArea`), `styles/main.css`.
2. **No duplicate cards in a single offering.** `drawCards` can currently repeat a
   card within one draw — make each offering's cards unique. File: `app.js drawCards`.
3. **Separate the offered cards from the cards already in hand** (distinct UI
   sections / divider). Files: `app.js` UI, `PLAY ME.html`, CSS.

**New mechanic**
4. **Spin / English.** Add the ability to put spin on the cue ball (top/back/side).
   There's already a `drawSpinDial` in the OLD `hd-renderer.js` (git history) for a
   reference UI. Needs: a spin-select control + physics that applies English to the
   cue's post-contact path. Files: new render control, `physics.js`, `app.js`.

**Placement preview**
5. **Live preview for placement / pocket-moving cards.** Before committing, show a
   ghost of the effect (zone/bumper/portal/moved hole) following the cursor; click
   to confirm. Files: `app.js` (`resolvePick`/`pendingPick`), `render/effects.js`.

**Table render**
6. **Remove the stray yellow diamonds in the side (center) pockets** — the rail
   diamond sights at the side-pocket midpoints now sit on top of the recessed
   pockets. File: `render/table.js drawDiamonds` (drop/relocate the `pa.cx` entries).
7. **Make the cue stick much longer** (real pool-cue proportion). File:
   `render/aim.js` (the `len2 = base * 8.5` term — increase substantially).

**Card behavior bugs**
8. **Moved pocket must still pocket.** After Move Hole, balls rest ON the moved
   hole instead of dropping. Also: Move Hole placement must be rejected if it lands
   on a ball. Investigate `physics.js pocketCheck` capture at moved positions
   (works in `pocketsFor` but balls aren't dropping — maybe capture radius/funnel at
   a mid-table hole, or a render/physics position mismatch). Files: `physics.js`,
   `cards/effects.js move_hole`, `app.js resolvePick` (block placing on a ball).
9. **Fog of War does nothing.** Should mask the table to a narrow sight (cone/circle
   around the aim line to the first object ball); everything else black/hidden.
   Files: new render mask + `app.js` render order; flag is `activeEffects.fogOfWar`.
10. **Drunk should NOT affect the ball after the shot.** Remove the per-frame +
    shot-time random jitter on the cue (currently in `physics.js applyShot` and
    `step`); keep ONLY the aim oscillation, and tighten it to ±5° (currently the
    render sway is ~±0.16 rad ≈ ±9° in `app.js render`).
11. **Shrink / Block pocket should change the pocket's shape/barrier**, not just
    overlay a circle — shrink = visibly smaller opening; block = a barrier across the
    mouth. File: `render/effects.js` (pocket-state drawing), maybe `geometry.js`.

> Note: items 5, 8–11 change physics/state, so re-verify the online snapshot path
> after — effects/zones already serialize, but new fields (e.g., spin) must be
> added to `serializeSnapshot`/`applySnapshot`.

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
