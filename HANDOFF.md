# Rack & Ruin — Session Handoff

Last updated: 2026-06-12

## TL;DR
A playable **card-battler pool game**, fully rewritten and committed on the
**`rewrite`** branch (`master` is the untouched original baseline `b7e0e5c`).
Pool-accurate table, real physics, standard rules for all four variants, a
**30-card** sabotage system, jump shots, call-your-pocket on the 8, online
multiplayer, and synthesized audio + particles. **56 unit tests pass**
(`npm test`); all 30 cards pass an automated in-browser playtest with no console
errors; the live 2-client online sync test passes (browser host + scripted
joiner). Remaining work is **human feel/balance tuning**, not correctness.

GitHub remote: `ExKylebur/Rack-and-Ruin` (push with `push-to-github.bat`, or
`git push origin rewrite`).

## How to run
- **`launch.bat`** → starts the Python server on :8000 and opens the browser.
  You MUST use the server (ES modules are blocked over `file://`).
- ⚠️ **Port 8000 conflict:** the SynthRiders mapper also defaults to :8000
  (`uvicorn main:app`). If it's up, `localhost:8000` returns `{"detail":"Not
  Found"}` and the game won't load — stop the stray `python` PID first. Note a
  leftover game server from a prior session also squats :8000; `Stop-Process`
  it before re-launching / before `preview_start`.
- Tests: `npm test` (Node's built-in runner; no deps).
- Preview/verify: `.claude/launch.json` config `rack-and-ruin` drives the Claude
  preview tools (serve + screenshot + eval).
- Online 2-client re-test: start server, create a room in the browser, then
  `node tools/online-smoke.mjs <ROOMCODE>`, then rack + foul + play a card.

## Architecture (all under `src/`, vanilla ES modules, no build step)
- `geometry.js` — table geometry as pure fns; **relative {u,v} coords** (0..1 of
  play area) so state is resolution-independent. **`cushions(dims, movedPockets)`**
  builds the boundary as a **6-vertex polygon** (one vertex per pocket, CW: TL,
  TM, TR, BR, BM, BL); each edge is a cushion with angled jaw faces funneling into
  the pockets. `movedPockets[i].warp` bends the two edges meeting that pocket.
  `pocketLayout(dims, movedPockets)` returns the 6 pockets (`side`/`moved` tags).
  `warpBlocksPocket(dims, moved, idx, dropRel)` validates a warp can't seal
  another pocket. Physics + render share all of this.
- `state.js` — single source of truth + `serializeSnapshot`/`applySnapshot`.
  Notable serialized fields: `balls`, `movedPockets`, `pocketState`,
  `activeEffects`, `players[].hand` (card ids), `currentPlayer`, `calledPocket`.
- `physics.js` — pure sim in a fixed CANON pixel space (every machine simulates
  identically). **CCD: `step()` slices each frame into `substep()`s** so no ball
  moves >~0.45·ballR per slice (fixes thin-cut tunneling). Reads card effects +
  `movedPockets` via `env`; emits sound events carrying {u,v}. `turn.pocketDrops`
  maps ballNum→pocketIndex (for called-pocket). Jump shots fly via `airStep`
  (`cue.air`, runtime-only). `freshTurn`, `applyShot(...,jump)`, `makeSim`, `commit`.
- `rules/` — `index.js` dispatch + `eightball/nineball/cutthroat`. `evaluateTurn`
  returns `{foul,keepTurn,gameOver,winner,reason,ballInHand,respot,message}`,
  assigns groups, and (8-ball/doubles) requires the 8 to drop in `state.calledPocket`.
  `commitmentLabel()`, `groupNums()`, `nextPlayer()`.
- `cards/registry.js` (**30 ids, STABLE** — online snapshots reference them) +
  `cards/effects.js` (pure appliers + `clearBallEffects`/`decayTableEffects`).
- `online/client.js` — create/join/push/long-poll.
- `render/{table,ball,aim,effects,particles}.js` — render is a pure function of
  state. `effects.js` also owns fog, pick highlights, placement ghost, and
  `drawCalledPocketUI`. `particles.js` is runtime-only cosmetic juice.
- `audio/sfx.js` — `window.SFX` synth; `cardPlayed(id)` routes per-card cues;
  `jump`/`land`/`click` cues.
- `app.js` — entry: setup, input, shot loop, card phase, turn flow, calling,
  jump-arming, online glue.
- `server/multiplayer_server.py` — `ThreadingHTTPServer`; rooms/tokens/long-poll;
  serves the static files (`/` → `PLAY ME.html`).

## Notable mechanics (current behaviour)
- **Card phase** plays from the right-panel Hand (`#handArea`, no modal): draw →
  cards badged NEW → click to play (up to `PLAY_PER_TURN`); a `#nowPlaying`
  banner shows during a table pick. Hand renders as 2-col mini **game cards**
  (per-card hue via `cardHue(id)`, art zone, type chip, foil shine, playable glow).
  Drivers: `beginCardPhase`/`playHandCard`/`processCardQueue`/`afterCardResolved`/
  `endCardPhase`. Playing a card fires `spawnCardFlourishFor` at the effect site.
- **Call-your-pocket (8-ball/doubles):** when the shooter has cleared their group
  and the 8 is up, they MUST call a pocket before shooting (click a pocket to
  call/re-call, click felt to shoot; `needsCall()` gates `beginCharge`+input).
  `#callPocket` banner + `drawCalledPocketUI` flair. Win only if the 8 drops in
  `state.calledPocket`; wrong/uncalled/early/foul → opponent wins.
- **Jump Shot:** `#jumpBtn`/`toggleJump` arms the next shot; the cue flies
  `power·PA.w·JUMP_RANGE_FRAC(0.55)`, sailing over balls/zones/rails (the counter
  to a Warp Rail trap). Off the bed = scratch; over a pocket = drop. Aim preview
  = hop-arc + landing ring (red X = scratch).
- **Warp Rail** bends the two rails to a dragged pocket (`{u,v,warp:true}`);
  **Move Hole** is a floating hole, straight rails (`{u,v}`) — UNLESS the pocket
  is already warped, in which case Move Hole **preserves** the warp (rails follow,
  don't snap back). Both reject drops onto a ball or that would seal a pocket.
- **Power bar oscillates** 0→100→0 at constant %/sec (1.4 s/sweep); card clamps
  reshape the window: Cool Hands 0–25, Roid Rage starts at 75 and sweeps 75–100.
- **Effect lifetimes:** only rails (bounce/dead) + felt zones (ice/mud) persist;
  bouncer/bear-trap/portals/crosswind/blocked/shrunk decay via turn counters in
  `decayTableEffects`. Bear trap is single-use (`sprung`). Ball/cue effects last
  one shot (`clearBallEffects`).
- **Fog of War** fully blacks out everything but the aim beam (and passes through
  a cloaked ball). **Cloak** also hides the aim ghost/cut-line for that ball.
- **Spin/English** via `#spinDial`; **Drunk** sways aim only (±5°).

## Online safety
Render == physics geometry (both from `geometry.js`, incl. the warped boundary).
Shooter simulates then broadcasts the settled snapshot (D2). All gameplay state
serializes (`movedPockets` incl. `warp`, `pocketState`, `activeEffects`,
`calledPocket`); `cue.air`/`airTotal`, spin, particles, and sound-event positions
are **runtime-only** and never serialized. Snapshot round-trip test passes.

## NOT yet verified / known gaps (start here)
1. **Human feel/balance pass** — card strength, zone sizes, jump range
   (`JUMP_RANGE_FRAC`), SFX levels, particle amounts. The mechanics are
   machine-verified; the *fun* isn't.
2. **Two real browsers / machines** — the online test used a real host + a
   protocol-exact scripted joiner; a second human browser via the invite link
   (incl. the win screen on both sides) hasn't been done end-to-end. Known
   simplification: joiner name not synced (host names win).
3. **rAF / preview gotcha** — the shot loop uses `requestAnimationFrame` (paused
   when unfocused); preview screenshots/evals that await rAF can hang when the
   preview window is occluded. Restart the preview server for a fresh window;
   use `window.RR` hooks for headless work.
4. Minor: phone-aim is relative-to-drag; doubles/cutthroat not selectable online
   (by design); webfonts (Outfit/Bebas Neue) fall back to system fonts offline.

## Dev hooks (browser console, `window.RR`)
`state`, `render()`, `start()`, `shoot(power,angle)`,
`simShot(power,angle[,spin,jump])` (headless full shot, runs the rules),
`simBall(num,power,angle)` (headless PURE physics, no rules → `{pocketed,restU,
restV,frames}`), `isMoving()`, `moveHole(i,u,v)`, `setSize(num,size)`,
`refreshPanels()`, `pick()`, `queue()`, `cardPhaseActive()`, `playHand(slot)`,
`clickRel(u,v)` (resolves a pending pick / places the cue), `onEight()`,
`callPocket(i)`, `calledPocket()`.

## Working conventions for new cards
Applier in `cards/effects.js` (mutate `activeEffects`/`balls`/`movedPockets`/
`pocketState`; add a turn counter to `decayTableEffects` if it shouldn't persist)
+ a catalogue entry with `interactions` in `cards/registry.js`
(ball/pocket/rail/place picks). Shared geometry → a pure fn in `geometry.js` so
physics and render agree. Visuals: zones/rails in `drawEffects` (under balls),
glyphs in `drawEffectBadges` (over balls), a `place`-pick preview in
`drawPlacementGhost`. Sound: a case in `audio/sfx.js cardPlayed`. Cover with a
`node --test`. **Card ids are STABLE** (online compatibility) — never rename one;
to retire a card, remove it from `CARD_POOL` so it's never dealt.

## Decisions locked
- D1: relative {u,v} coords (resolution-independent). D2: shooter simulates,
  broadcasts the settled snapshot. Card ids stable. Render == physics geometry.

## History
Earlier sessions (chronological detail) are in the git log — `git log --oneline`
on `rewrite`. Highlights: the original rewrite + 11-item card/table backlog;
Warp Rail bend + side-pocket capture + analytic aim; visual/audio modernization
(theme, table/ball/cue, particles, SFX) and the online + per-card verification;
then four user-feedback rounds — CCD/jump/oil/open-pocket; warp-block guard +
rail-follows-bend + oscillating power bar; call-your-pocket + opaque fog + cloak
cut-line; and Move-Hole-keeps-warp + Mirror card removed.
