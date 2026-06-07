# Plan: Rack & Ruin — Full Rewrite (online-first)

Last updated: 2026-06-06
Baseline commit: `b7e0e5c` (original handoff build, fully reversible)

**Goal:** A card-battler pool game that *looks* like pool, where every card does
visually what it says, and where two friends can actually play online.

**Tech stack:** Vanilla ES modules (no build step), HTML5 canvas, WebAudio,
Python stdlib HTTP server. Stay buildless — open `PLAY ME.html` or serve via the
Python server.

---

## Core architectural principle (the one that fixes everything)

> **Render is a pure function of state. Physics, cards, and the network all
> mutate ONE state object; the renderer only ever reads it.**

The current build has two desynced "tables": a physics table (`pockets[]`, ball
radii, warp geometry in `main.js`) and a hardcoded, *cached* visual table in
`hd-renderer.js` that never reads game state. That single split causes:

- Move Hole / Warp Rail / Big Ball / Small Ball changing physics but not visuals
- The size-only render cache never repainting on state change
- Online being impossible (no single serializable source of truth)

Fixing the split is Phase 1 and is the spine of the whole rewrite.

---

## Target module map

```
PLAY ME.html              modified — markup only; <script type="module" src="src/app.js">
src/
  app.js                  NEW — entry: wires DOM, owns the GameState instance, main loop
  state.js                NEW — GameState shape + factory + (de)serialize. SINGLE SOURCE OF TRUTH
  geometry.js             NEW — table/pocket/rail geometry derived from state (one place)
  physics.js              NEW — pure step(state, dt): balls, rails, pockets, portals, warp
  rules/
    index.js              NEW — variant dispatch
    eightball.js          NEW
    nineball.js           NEW
    cutthroat.js          NEW
    doubles.js            NEW
  cards/
    registry.js           NEW — CARD_POOL (ids preserved), metadata only
    effects.js            NEW — pure appliers that mutate state.activeEffects / balls / pockets
    interactions.js       NEW — interaction queue (ball/pocket/rail/place picks)
  online/
    client.js             NEW — create/join/reconnect, push-on-change, long-poll loop
  render/
    table.js              NEW — draws felt+rails+pockets FROM state.pockets & geometry (no static cache)
    ball.js               NEW — ball rendering (radius read from state, incl. cue size)
    effects.js            NEW — effect overlays (ice, mud, portal, bouncer, traps, pocket states)
    aim.js                NEW — aim line, ghost ball, cue stick
  audio/sfx.js            keep (minor: ensure card ids still map)
  styles/main.css         keep, light touch-ups
server/
  multiplayer_server.py   modified — ThreadingHTTPServer; keep room/token/persistence model
```

`main.js`, `hd-renderer.js` are deleted once their logic is migrated.

---

## The state object (load-bearing — settle this first)

```js
// state.js — conceptual shape (single source of truth, fully serializable)
function createGameState() {
  return {
    version: 0,              // monotonic; drives online sync + render-dirty
    started: false,
    gameOver: false,
    variant: 'eight',
    // table geometry is DERIVED from dims via geometry.js, not stored, EXCEPT
    // mutations: moved pockets + warp live in state so they serialize + render.
    dims: { w: 0, h: 0 },    // canvas px (recomputed on resize)
    units: { ballR: 0, pocketR: 0, cushion: 0 }, // ALL scale from dims.w
    balls: [],               // {num,x,y,vx,vy,r,pocketed, flags...} — normalized 0..1? see decision D2
    pockets: [],             // {x,y,r,moved,blocked,shrunk,open} — RENDER READS THIS
    warp: null,              // null | {corners:[...], mids:[...], turns}
    players: [],             // {name,group,hand:[cardId],seat}
    currentPlayer: 0,
    cardPhasePlayer: null,   // explicit — replaces fragile currentPlayer±1 math
    activeEffects: {},       // ball + table effects, all serializable
    turn: { firstHit:null, pocketed:[], foul:false }, // reset per shot
  };
}
```

**Decision D1 — coordinate system.** Store ball/pocket positions in **table-
relative units (0..1 of play width)**, convert to px at render time. This makes
state resolution-independent (critical for online: two players on different
screen sizes share identical state). *Recommended.* Alternative: keep px and
renormalize on resize (current approach, fragile).

**Decision D2 — physics tick ownership online.** Who simulates the shot?
- (a) **Shooter simulates, broadcasts resulting state** once balls settle
  (simplest, matches async turn model, ~1 round-trip latency). *Recommended.*
- (b) Server-authoritative simulation (much larger; real-time netcode). Not for v1.

---

## Phased milestones (each phase = a playable build + a commit)

| Phase | Outcome | Status |
|-------|---------|--------|
| 0 | Test harness + scaffolding so we can TDD pure modules | ☑ done (`6fe8b11`, `01c08a0`) |
| 1 | **Looks like pool**: render-from-state, correct pocket geometry, scaling that tracks canvas, Move Hole visibly moves | ☑ done (`cbb4eef`) — verified in browser |
| 1b | **Playable solo**: physics.js + input + shot loop wired into app.js (no cards yet) | ☑ done (`79642bc`) — verified in browser |
| 2 | **Cards work**: card-phase player fix, all appliers pure + visually correct (big/small ball, open pocket, warp render) | ☑ core done (`499c9f3`) — verified in browser; warp render + per-effect playtest still TODO |
| 3 | **Rules clean**: variant evaluators extracted + unit-tested (8/9/cutthroat/doubles) | ☑ done (`da63e26`) |
| 4 | **Online works**: threaded server, client push-on-change + long-poll wired, resolution-independent sync | ☑ done (`e82c038`) — server validated; live 2-client test pending |
| 5 | Polish: audio wired (`1e66f91`). Remaining: phone-aim tweak, diagnostics panel, warp render | ◐ partial |

---

## Phase 0 — Test harness (do first; everything after is TDD)

No build step, so use Node's built-in test runner against the pure modules
(`physics.js`, `rules/*`, `cards/effects.js`, `geometry.js`). DOM/render code is
verified manually in-browser via the preview tools.

### Task 0.1: Add Node test scaffold
- [ ] Create `package.json` with `{ "type": "module", "scripts": { "test": "node --test" } }`
- [ ] Create `test/smoke.test.js` importing `geometry.js` once it exists
- [ ] Run `node --test` — expect "no tests" / trivial pass
- [ ] Commit: "Phase 0: node --test scaffold"

### Task 0.2: geometry.js + first real test
- [ ] Write `test/geometry.test.js`: asserts `unitsFor({w:1000,h:500})` returns
      `ballR`, `pocketR ≈ 2×ballR`, `cushion`, all proportional to `w`
- [ ] Run — verify it FAILS (module missing)
- [ ] Implement `geometry.js`: `unitsFor(dims)`, `pocketLayout(dims, movedPockets)`,
      `playArea(dims)` — pure, no globals
- [ ] Run — verify PASS
- [ ] Commit: "Phase 0: geometry module + tests"

---

## Phase 1 — Make it look like pool (highest visible payoff)

**Target behaviors to verify in-browser:**
1. Balls and pockets are correctly proportioned at any window size; resizing
   keeps proportions.
2. Pockets read as *mouths cut into the rail* (opening flush to cushion line),
   not black discs floating on the felt.
3. The physics catch-radius matches the painted opening (no invisible suction).
4. Move Hole moves the painted pocket immediately.

### Task 1.1: Pocket geometry from state
- [ ] `test/geometry.test.js`: corner pocket centers sit ON the rail corner;
      side pockets centered on rail midpoints; moved pocket overrides default
- [ ] Implement `pocketLayout()` to merge defaults with `state.pockets[].moved`
- [ ] Verify PASS; commit

### Task 1.2: render/table.js draws from state (kill the static cache)
- [ ] Port felt/rail/diamond drawing from `hd-renderer.js` into `render/table.js`
- [ ] Draw pockets by iterating `state.pockets` (positions + per-pocket r),
      with the felt jaw cut matched to the SAME radius used for the black mouth
- [ ] Cache keyed on a `geometryHash(state)` (dims + moved pockets + warp), not
      size alone — so moving a hole invalidates the cache
- [ ] Manual verify in browser: table looks right; commit

### Task 1.3: render/ball.js reads radius from state (fixes big/small ball later)
- [ ] Port ball rendering; read radius from `ball.r` uniformly (drop the
      cue-only `_r` path that silently no-ops)
- [ ] Manual verify; commit

### Task 1.4: Scaling — units derive from dims
- [ ] Replace `const BALL_R = 11` with `state.units.ballR = unitsFor(dims).ballR`
- [ ] Rack spacing, pocket radius, cushion all read from `state.units`
- [ ] On resize: recompute units, rescale ball/pocket positions (trivial if D1
      = relative coords)
- [ ] Manual verify resize keeps proportions; commit

### Task 1.5: Move Hole end-to-end
- [ ] Wire `applyMoveHole` to set `state.pockets[i] = {x,y,moved:true}` in
      relative coords
- [ ] Confirm physics (`physics.checkPocket`) and render both read `state.pockets`
- [ ] Manual verify: pick pocket → place → painted hole AND drop point both move
- [ ] Commit: "Phase 1 complete: render-from-state, pool-accurate table"

---

## Phase 2 — Cards do what they say (detailed at start of Phase 2)

Known fixes already identified (turn into tasks then):
- **Card-phase player desync on scratch**: `handleScratch` draws for the post-
  advance player but `onCardPhaseDone` splices from `currentPlayer-1`. Replace
  all `currentPlayer±1` card math with explicit `state.cardPhasePlayer`.
- **Big/Small Ball**: now visible once Task 1.3 lands (radius read from state).
- **Open Pocket inert**: `applyOpenPocket` must set `activeEffects.openPockets`
  (physics + overlay both read it); currently only clears `blockedPockets`.
- **Warp Rail**: render warped rails from `state.warp` (Task ports the bounding-
  box warp into `render/table.js`).
- Make every applier a pure mutation of `state` (no reads of globals) so they
  serialize for online.

## Phase 3 — Rules (detail at start)
Extract `evaluate*` into `rules/*`, unit-test each variant's keep-turn / foul /
win conditions. Fix doubles/cutthroat `%2` assumptions.

## Phase 4 — Online (detail at start)
- Server: `HTTPServer` → `ThreadingHTTPServer` (one-line class swap) so the
  25s long-poll stops blocking all other requests. Keep rooms/tokens/persist.
- Client: call `pushState()` on every `version` bump; start `pollLoop()` on
  create/join; apply newer snapshots; lock input when not your turn (except your
  own card-interaction window).
- Verify with two browser tabs against the local server, then via tunnel.

## Phase 5 — Polish
Phone aim relative to cue, audio coverage for all card ids, "whose effect" UI,
optional diagnostics panel (turn owner, version, effect stack).

---

## Self-review checklist (per phase, before moving on)
- [ ] Every changed behavior verified (test for pure code, browser for render)
- [ ] State stays fully serializable (no functions/DOM refs in state)
- [ ] Card ids in `cards/registry.js` unchanged (online snapshot compatibility)
- [ ] Committed with a phase-tagged message
