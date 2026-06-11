# Rack & Ruin — Session Handoff

Last updated: 2026-06-10

## TL;DR
The full rewrite is implemented and committed on the **`rewrite`** branch (HEAD
`fc97a16`). `master` is the untouched original baseline (`b7e0e5c`). The game is a
playable card-battler pool game: a pool-accurate table, real physics, standard
rules for all four variants, a 30-card sabotage system, online multiplayer
plumbing, and synthesized audio. **42 unit tests pass** (`npm test`).

The 2026-06-06 "card & table rework" backlog (11 items) is **done**, plus a large
round of follow-up UX/feel work (this session). The remaining big gaps are the
**live 2-client online test** (never run with two real browsers) and a **per-card
playtest** of all 30 cards.

## How to run
- **Double-click `launch.bat`** → starts the Python server on :8000 and opens the
  browser. You MUST use the server (ES modules are blocked over `file://`).
- ⚠️ **Port 8000 conflict:** the SynthRiders mapper also defaults to :8000 (it runs
  `uvicorn main:app`). If that server is up, `localhost:8000` returns
  `{"detail":"Not Found"}` (FastAPI 404) and the game won't load. Fix: stop the
  conflicting server (`Stop-Process` the stray `python ... uvicorn` PID). Both
  projects can't run on :8000 at once.
- Tests: `npm test` (Node's built-in runner; no deps).
- Upload to GitHub: **`push-to-github.bat`** (remote: ExKylebur/Rack-and-Ruin).
- Preview/verify changes: the project has `.claude/launch.json` (config name
  `rack-and-ruin`) so the Claude preview tools can serve and screenshot the game.

## Architecture (all under `src/`, vanilla ES modules, no build step)
- `geometry.js` — table geometry as pure fns; **relative {u,v} coords** (0..1 of
  play area) so state is resolution-independent. **`cushions(dims, movedPockets)`**
  builds the table boundary as a **6-vertex polygon** (one vertex per pocket, CW:
  TL, TM, TR, BR, BM, BL); each edge is a cushion with angled jaw faces that funnel
  into the pockets. Physics + render share this. `pocketLayout(dims, movedPockets)`
  returns the 6 pockets (side pockets tagged `side:true`, moved ones `moved:true`).
- `state.js` — single source of truth + `serializeSnapshot`/`applySnapshot`.
- `physics.js` — pure sim in a fixed CANON pixel space (so every machine simulates
  identically). Reads card effects + `movedPockets` via `env`. Emits sound events.
- `rules/` — `index.js` dispatch + `eightball/nineball/cutthroat`. `evaluateTurn`
  returns `{foul,keepTurn,gameOver,winner,reason,ballInHand,respot,message}` and
  assigns groups. `commitmentLabel()` powers the per-player UI.
- `cards/registry.js` (30 ids, STABLE — online snapshots reference them) +
  `cards/effects.js` (pure appliers + `clearBallEffects`/`decayTableEffects`).
- `online/client.js` — create/join/push/long-poll.
- `render/{table,ball,aim,effects}.js` — render is a pure function of state.
- `audio/sfx.js` — `window.SFX` synth; `cardPlayed(id)` routes per-card cues.
- `app.js` — entry: setup, input, shot loop, card phase, turn flow, online glue.
- `server/multiplayer_server.py` — `ThreadingHTTPServer`; rooms/tokens/long-poll;
  also serves the static files (`/` → `PLAY ME.html`).

## What this session changed (2026-06-08 → 06-10)
All on `rewrite`; each item verified in-browser and/or by unit test. Newest first:

**Warp Rail — bend the rails to follow the hole** (`fc97a16`, user picked "Option A")
- The boundary polygon's pocket vertex moves when a pocket is warped; the two
  adjacent rails bend to follow. `geometry.cushions(dims, movedPockets)` checks
  `movedPockets[i].warp`. With default vertices it reproduces the old axis-aligned
  table exactly (all cushion tests pass). Physics recomputes faces in CANON when a
  warp is active (memoised on the shot `env`, threaded via `env.movedPockets`).
- **Move Hole** sets `movedPockets[i] = {u,v}` (floating hole, rails straight);
  **Warp Rail** sets `{u,v,warp:true}` (rails bend). Both reject drops onto a ball.
- The placement ghost previews the bend (dashed cushion lines from the two
  neighbour pockets to the cursor) in `render/effects.js drawPlacementGhost`.
- `state.warp` and the old `geometry.warpRail` cushion-ridge are GONE (a dead-end
  earlier this session: `ff66d6d` ridge → `e142d83` plain relocator → `fc97a16`
  bend). Warp persists one round like other placed effects.

**Side-pocket capture fix** (`be70624`)
- Side pockets are recessed behind the rail; the corner-sized capture didn't cover
  the mouth and `pocketCheck` ran AFTER `railBounce`, so balls rattled off the jaw.
  Now: `SIDE_POCKET_PULL = 1.45` wider capture for `p.side` pockets, and **`step()`
  runs `pocketCheck` BEFORE `railBounce`** so a ball that reached the funnel drops.
  Angled side-pocket window went ~0° → ~13°; corners unaffected.

**Aim precision** (`54e31e5`)
- `render/aim.js` uses analytic **ray–circle intersection** for ball contact (was
  discrete 3px stepping that overshot), so the ghost ball rests exactly tangent —
  no more clipping into the target as you slide the aim. Added a cyan **cut-line**
  showing the struck ball's direction.

**Effect lifetimes + single-use bear trap + ball-in-hand + CSS fix** (`9f7ec56`)
- **Lifetimes:** only rails (bounce_house/dead_rail) and felt zones (ice/mud)
  persist; bouncer/bear-trap/portals clear after one round (turn counters in
  `cards/effects.js decayTableEffects`).
- **Bear trap is single-use:** snaps shut on the FIRST ball (`physics.js` sets
  `effects.bearTrap.sprung`, emits a `beartrap` event), won't catch again, lingers
  closed until it decays. New snapping-jaws animation + metallic SFX.
- **Ball-in-hand:** prominent pulsing `#ballInHand` banner over the table +
  marching-ants/pulsing cue placement ring (`updateBallInHandUI`, `drawCuePlacement`).
- **Root-cause CSS fix:** there was no general `.hidden` rule (only
  `.overlay-base.hidden`), so the card-phase chrome and new banners never actually
  hid. Added `.hidden { display:none !important; }`. (Removed the confusing
  per-turn "Drew: ..." toast too — the hand's NEW badges already show the draw.)

**Card flair: themed visuals + sounds; real bear trap** (`8afae31`)
- `render/effects.js drawEffects` rewritten with richer (mostly opaque, balls draw
  on top) art: ice sheen, muddy bubbling mud, glossy bouncer, swirling portals,
  crosswind breeze streaks, magnet pocket-field arcs, and **rail treatments**
  (bounce_house = vibrating rubber band, dead_rail = rotted segmented wood) drawn
  over the cushions. Bear trap is now real sprung steel jaws (was a 🪤 emoji).
- New `drawEffectBadges` (over the balls): **turbo lightning bolt** on the cue,
  plus roid/cool/oil/reverse/sticky/drunk glyphs and heavy/light weight markers.
- The idle loop animates these. `audio/sfx.js cardPlayed` adds per-card cues
  (zap/whoosh/freeze/squelch/hum/drip + more).

**Card phase plays from the Hand; player icon = solids/stripes** (`8117dc3`,
`5b2332a`)
- The full-screen card modal is GONE. Drawn cards land in the right-panel
  **`#handArea`** (badged NEW); click a card there to play it, one at a time, up to
  `PLAY_PER_TURN`. While a card's table pick resolves, a **"▶ Playing &lt;card&gt; —
  &lt;prompt&gt;"** banner (`#nowPlaying`) shows over the table and the hand locks.
  Unplayed cards persist. Drivers in `app.js`: `beginCardPhase` / `playHandCard` /
  `updateCardPhaseUI` / `afterCardResolved` / `endCardPhase`; `phaseNewIds` is the
  NEW set. The old `#cardOverlay` modal + its `.card-grid`/`.card-pick-item` CSS
  were removed (some grid CSS may still be dead — safe to delete if found).
- **Player ball icon** by each name shows their 8-ball group: solid coloured ball
  for solids, white ball + coloured band for stripes (`updatePlayers`).

**The original 11-item backlog** (`1bcbd1f` items 6–11, `c351978` 1–3, `69fe309`
5, `c12b6a7` 4): card UX (now superseded by the Hand redesign above), Spin/English
(`#spinDial`, `drawSpinMarker`, post-contact impulse in `physics.js`), placement
ghost, side-pocket diamonds removed, cue stick lengthened (`aim.js len2=base*22`),
moved pocket captures, Fog of War sight beam, Drunk = aim-only ±5°, Shrink/Block
reshape the pocket opening.

## Online safety (checked)
No new **serialized** state was added this session. `movedPockets` (incl. the
`warp` flag), `pocketState`, and `activeEffects` all serialize. Spin and the
bear-trap `sprung` flag live within a shot / the settled snapshot already carries
`activeEffects`. The snapshot round-trip test still passes. So online sync is
unaffected — but it has STILL never been run with two real browsers (see gaps).

## NOT yet verified / known gaps (start here next session)
1. **Live 2-client online test.** Plumbing done, server validated via live
   requests, but never run with two browsers. Host `launch.bat` → Create Room →
   Rack Up; second browser opens the invite link → Join. Verify turn-lock,
   snapshot sync, card sabotage crossing over, ball-in-hand, win. Known
   simplification: joiner name not synced (host's snapshot names win).
2. **Per-card playtest of all 30.** The card *flow* and most effects were verified
   (often headlessly via `window.RR.simBall`), but play a full game with each card
   to tune feel/visuals/balance.
3. **rAF throttling gotcha** — the live shot loop uses `requestAnimationFrame`,
   paused when the tab is unfocused. For headless/debug use the `window.RR` hooks.
4. Minor polish: phone-aim is relative-to-drag (could aim from the cue);
   doubles/cutthroat not selectable online (by design); some dead card-modal CSS.

## Dev hooks (browser console, `window.RR`)
`state`, `render()`, `start()`, `shoot(power,angle)`,
`simShot(power,angle[,spin])` (headless full shot, runs the rules),
**`simBall(num,power,angle)`** (headless PURE physics, no rules — returns
`{pocketed,restU,restV}`; great for pocket-capture testing),
`isMoving()`, `pick()`, `queue()`, `clickRel(u,v)`, `moveHole(i,u,v)`,
`setSize(num,size)`, `refreshPanels()`, `playHand(slot)`, `cardPhaseActive()`,
`selected()`.

## Working conventions for new cards
Applier in `cards/effects.js` (mutating `activeEffects`/`balls`/`movedPockets`/
`pocketState`; give placed/zone effects a turn counter if they shouldn't persist) +
a catalogue entry with `interactions` in `cards/registry.js` (ball/pocket/rail/place
picks). Any new shared geometry goes in `geometry.js` as a pure fn so physics and
render agree. Visuals: zones/rails in `drawEffects` (under balls), cue/ball glyphs
in `drawEffectBadges` (over balls), a `place`-pick preview in `drawPlacementGhost`.
Sound: a case in `audio/sfx.js cardPlayed`. Cover physics with a `node --test`.

## Decisions locked
- D1: relative {u,v} coords. D2: shooter simulates, broadcasts the settled snapshot.
- Card ids are stable (online compatibility). Render == physics geometry (both
  derive from `geometry.js`, including the warped boundary).
