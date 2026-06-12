# Rack & Ruin — Session Handoff

Last updated: 2026-06-12

## TL;DR
The full rewrite is implemented and committed on the **`rewrite`** branch.
`master` is the untouched original baseline (`b7e0e5c`). The game is a playable
card-battler pool game: a pool-accurate table, real physics, standard rules for
all four variants, a 30-card sabotage system, online multiplayer plumbing, and
synthesized audio. **42 unit tests pass** (`npm test`).

2026-06-11 session: **full visual/audio modernization** (UI theme, menu, table /
ball / cue rendering, particles, richer SFX) and **both big verification gaps
closed** — the live 2-client online sync test PASSES (browser host + scripted
joiner over the real server), and all card ids pass an automated in-browser
playtest (resolve → effect applies → live shot → decay turn, no errors). What's
left is human play for *feel/balance* tuning, not correctness.

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

## What the 2026-06-12 session changed (user playtest feedback round)
One commit; **47 unit tests** + the automated 31-card in-browser playtest pass.

**Gameplay fixes**
- **CCD anti-tunneling:** `physics.step` slices each frame so no ball moves
  more than ~0.45·ballR per slice (`substep()`, cap 12). Fixes extreme thin
  cuts where the cue tunneled past the advertised contact. Tests in
  `test/jump.test.js`.
- **Jump Shot** (counter to Warp Rail trapping balls): toggle button under the
  spin dial (`#jumpBtn`, `toggleJump`). `applyShot(..., jump=true)` sets
  `cue.air = power * PA.w * JUMP_RANGE_FRAC(0.55)`; airborne balls skip
  friction/zones/rails/collisions (`airStep` in physics.js), land via distance
  countdown — off the bed = **scratch**, over a pocket = drop. Aim preview =
  hop-arc dots + landing ring (red X = will scratch). Airborne render: ball
  lifts/grows, shadow stays grounded (`ball.js` lift/airT). `land` event ->
  thud SFX + dust. `air/airTotal` are runtime-only (NOT serialized; snapshots
  are settled). RR.simShot takes a 4th `jump` arg.
- **Oil Cue friction +33%** (0.9985 -> 0.998/frame) — stops drifting forever.
- **Open Pocket gating:** never dealt unless a pocket is blocked
  (`blockedPocketExists()` filters the draw pool); dead in hand shows disabled.

**Visual round 2** ("cards were dull / effects identical")
- Hand = 2-col mini game cards (`updateHand` markup + main.css): per-card hue
  (`cardHue(id)` -> `--card-hue`), art zone w/ watermark icon, type chip, foil
  shine, pulsing playable glow, NEW ribbon.
- `spawnCardFlourishFor` (app.js) + `particles.spawnCardFlourish`: shockwave
  rings, hue sparks, rising card icon at the resolved effect's location.
- `effects.js` amped (glow/shadowBlur + animation on everything): ice
  twinkles, mud oozes/pops, bouncer neon rings, portal halos + outer dashed
  ring, crosswind comet streaks w/ arrowheads, magnet rings collapse into
  pockets, neon bounce-house rail, cracked dead rail, blocked pocket = red
  glow + marching hazard ticks, shrunk pocket pulses, badges on glow chips.
  Idle loop now also animates while pocketState has blocked/shrunk entries.

## What the 2026-06-11 session changed
All on `rewrite`; verified in-browser (preview tools) + `npm test`. Three commits:

**Visual overhaul part 1 — modern UI + table/ball/cue rendering** (`56557fe`)
- `src/styles/main.css` rewritten around design tokens (`:root` vars): glass
  panels, gradient menu hero ("RACK & RUIN / Sabotage Billiards"), modern
  buttons/toasts/banners, card items as icon-chip rows with a type-coloured
  strip (blue = ball card, amber = table card). Dead card-modal CSS removed.
- `PLAY ME.html`: Outfit + Bebas Neue webfonts (graceful offline fallback),
  menu hero block, title bar restyled; fixed the stray visible "Player 3 Name"
  label; `updateHand()` in app.js now emits `.card-icon` markup.
- `render/ball.js`: layered contact shadow, 3-stop body shading, felt bounce
  light, fresnel rim, sheen + hard glint, crisper stripe band, number decal.
- `render/table.js`: layered wood grain + brass inlay line, tournament felt
  with diagonal weave + faint R&R watermark, rail inner shadow onto the cloth,
  leather/brass pocket collars with inner-lip light, mother-of-pearl diamonds.
- `render/aim.js`: guide line tints white→gold→red with power and glows; ghost
  ball + contact crosshair; cut line gets an arrowhead; real tapered cue
  (blue tip, ferrule, maple shaft, brass joint, wrapped rosewood butt, shadow).

**Visual overhaul part 2 — particles + SFX** (`a05cf04`-ish, see log)
- `physics.js` events now carry **relative {u,v} positions** (runtime only,
  never serialized — online unaffected).
- NEW `render/particles.js`: pocket-drop ring + burst in the ball's colour,
  rail dust, hard-hit kiss flash, bear-trap sparks, chalk puff on the strike.
  Self-clocking, 400-particle cap; finishes animating via the idle loop
  (`particles.alive()` is part of the idle-loop condition). Cleared on new game.
- `audio/sfx.js`: pocket = leather thunk + wooden return-rattle knocks;
  scratch = hollow thud; rising C-major win fanfare; soft `click()` wired to
  buttons / playable cards / spin dial via a delegated listener in app.js.

**Online: live 2-client sync test — PASSES** (`tools/online-smoke.mjs`)
- Scripted joiner speaks the exact client protocol (join-room, long-poll
  /api/state, update-state). Verified against a real browser host: rack
  snapshot sync, turn-lock to seat 1 after a host foul, ball-in-hand crossing,
  card sabotage (crosswind) visible to the joiner, and the joiner's pushed
  turn applied live by the host browser. Rerun: start server, host creates a
  room in the browser, then `node tools/online-smoke.mjs <CODE>`, then host
  racks + fouls + plays a card.
- Confirmed known simplification: joiner name not synced (host names win).

**Automated per-card playtest — all pass.** In-browser driver (preview_eval):
for every id in CARD_POOL → fresh game → force card into hand → soft no-contact
foul opens the card phase → play it resolving every pick type (ball/pocket/
rail/place) → assert state changed → full shot with the effect live → another
shot to run the decay path. 31/31 ok, zero console errors.

## What the 2026-06-08 → 06-10 session changed
Newest first:

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
1. **Human feel/balance pass.** Mechanics of every card are machine-verified
   (see above), but nothing substitutes for playing full games: tune card
   strength, zone sizes, SFX levels, particle amounts.
2. **Two real browsers / two machines.** The 2-client test used a real browser
   host + a protocol-exact scripted joiner; a second human browser via the
   invite link should behave identically but hasn't been done end-to-end
   (incl. win screen on both sides).
3. **rAF throttling gotcha** — the live shot loop uses `requestAnimationFrame`,
   paused when the tab is unfocused. For headless/debug use the `window.RR` hooks.
4. Minor polish: phone-aim is relative-to-drag (could aim from the cue);
   doubles/cutthroat not selectable online (by design). Webfonts (Outfit/Bebas
   Neue) load from Google Fonts — offline play falls back to system fonts.

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
