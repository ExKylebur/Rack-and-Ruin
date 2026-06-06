# Rack & Ruin - Claude Code Handoff

Last updated: 2026-03-27

## 1) Project Snapshot

Rack & Ruin is a browser-based pool game with arcade/card modifiers, multiple game variants, local and online play, HD rendering, and synthesized audio.

Key status:
- Refactored from single-file HTML into modular files under `src/`.
- Runs with no JS build step.
- Has optional Python multiplayer server for room-based sync and async turn handoff.
- Setup UI is now a startup modal overlay (not persistent in layout during active play).

Primary entrypoint:
- `PLAY ME.html`

Legacy file (not primary):
- `Rack&Ruin.html`

## 2) Repository Layout

- `PLAY ME.html`
  - Main page markup, includes setup modal overlay, table canvas, overlays.
- `src/main.js`
  - Core game logic: physics, turn flow, rulesets, cards, online sync, UI wiring.
- `src/render/hd-renderer.js`
  - High-fidelity table + ball rendering.
- `src/audio/sfx.js`
  - WebAudio-based synthesized SFX (shots, collisions, rail, pockets, card events).
- `src/styles/main.css`
  - UI + overlay + card animation styling.
- `server/multiplayer_server.py`
  - Room API server + static file hosting + persisted state + optional public tunnel.
- `server/state/rooms.json`
  - Persistent room snapshots (runtime data file).

## 3) Running the Project

### Local (no online)
- Open `PLAY ME.html` directly, or serve repo statically.

### Online/multiplayer
1. Start server:
   - `python3 server/multiplayer_server.py --port 8000`
2. Open:
   - `http://localhost:8000/PLAY%20ME.html`
3. In setup modal:
   - Choose `ONLINE`
   - Host uses `CREATE ROOM`
   - Opponent uses `JOIN ROOM`

Public invite options:
- Manual base URL:
  - `--public-base-url https://your-public-host`
- Auto tunnel (localhost.run via ssh):
  - `--auto-public-tunnel`
- Client also attempts `/api/start-tunnel` when creating room if needed.

## 4) Current UX/Game Flow

### Setup modal behavior (recently changed)
- Setup controls are in a popup overlay (`#setupOverlay`) shown at app open.
- On `RACK UP`, overlay hides and gameplay continues without setup panel on screen.
- On game over, `NEW GAME` opens setup modal again instead of instantly restarting.

Relevant code:
- `src/main.js`
  - `setSetupOverlayVisible(show)`
  - `rackBtn` click handler
  - `msgBtn` click handler
  - `startGame()` (forces setup hidden)
  - `applyGameSnapshot()` (online state can show/hide setup based on `started`)
- `src/styles/main.css`
  - `.setup-overlay`, `.setup-overlay.show`

### Control modes
- `mouse` mode:
  - Aim + hold/release on table.
- `phone` mode:
  - Drag table to aim, hold/release side shot button for power/fire.

### Variants
- `eight` (8-ball)
- `nine` (9-ball)
- `cutthroat` (3-player local)
- `doubles` (4-player local, 2v2)

Variant setup constraints:
- Online mode forces 2 players and blocks local-only variants (`cutthroat`, `doubles`).

### Contextual guide text
- Left panel "How To Play" is dynamic by selected variant via:
  - `getGuideTextForVariant()`
  - `updateGuideCopy()`

## 5) Rules + Turn/Card Logic (Important)

### Rack generation
- 8-ball rack uses constrained random generation (`getEightBallRackNumbers()`):
  - 8-ball fixed center
  - apex fixed to 1-ball
  - one solid and one stripe in rear corners
  - remaining randomized

### Turn resolution
- Main flow:
  - Physics loop -> `endTurn()` -> variant-specific evaluator -> `resolveTurnFlow()`
- Card phase trigger:
  - Triggered when turn is lost (miss or foul), not after every shot.

### Card draw/play behavior
- Hand cap: 7 (`MAX_HAND_CARDS`)
- Auto draw at turn end: 3 cards (`AUTO_DRAW_CARDS_PER_TURN`)
  - Guaranteed at least 1 ball-effect + 1 rail-effect card when slots allow.
- Cards playable from hand each card phase: up to 2 (`PLAY_CARDS_PER_TURN`)
  - Player can also play 0 and end turn.

### Debug card mode
- Toggle: "DEBUG: FULL CARD PICK AFTER MY SHOTS"
- In debug mode, draw phase can expose full card list in scrollable mode.

## 6) Card System Architecture

Card registry:
- `CARD_POOL` in `src/main.js` (ball + table cards).

Execution model:
1. Card phase selects cards from hand.
2. Immediate card fns run (`card.fn()`).
3. Any placement/picking requirements are queued in `interactionQueue`.
4. `processInteractionQueue()` drives table interactions until complete.

Interaction step types:
- `ball_pick`
- `pocket_pick`
- `rail_pick`
- `table_place`
- `portal_place`
- `move_hole`

Confirmation UX:
- Placement/pick actions use confirmation overlay with optional "do not show again this session" behavior.

Card catalog in code includes (by id):
- Ball: `fog_of_war`, `heavyweight`, `lightweight`, `confusion`, `cloak`, `sticky`, `drunk`, `shortsighted`, `roid_rage`, `cool_hands`, `big_ball`, `small_ball`, `oil_cue`, `reverse_spin`, `mirror`, `magnet`, `turbo`
- Table: `bouncer`, `bounce_house`, `dead_rail`, `bear_trap`, `portal`, `ice_patch`, `block_pocket`, `open_pocket`, `move_hole`, `warp_rail`, `mud_patch`, `crosswind`, `pocket_shrink`, `earthquake`

Cards removed from historical design and no longer present:
- `glass cue`
- `ice strip`

## 7) Warp Table + Physics Notes

Warp geometry:
- Represented by warped corners + warped top/bottom midpoints.
- Active state:
  - `activeEffects.warpCorners`
  - `activeEffects.warpMids`
- Helpers:
  - `normalizeWarpGeometry()`
  - `shiftPointInsideWarp()`
  - `shiftAllBallsInsideWarp()`
  - `normalizePortalsToWarp()`

Warp Rail behavior:
- User picks a pocket anchor, then previews moved position.
- Table shape updates after confirmation.
- Balls are shifted back inside bounds after warp changes.

Mirror + Warp compatibility:
- Mirror rendering uses warped-centroid reflection + clamp (`getMirroredBallRenderPoint`) to avoid out-of-bounds visuals.
- Both fallback and HD renderer honor this.

Known sensitive area:
- Warped edge collision and pocket mouth interaction can regress if rail/pocket math is changed. Validate with high-speed shots near pockets and warped corners.

## 8) Audio System

Implemented in `src/audio/sfx.js` using WebAudio synthesis (no external audio files).

Events wired in gameplay:
- `shot(power)`
- `ballHit(impact)`
- `railHit(impact, railType)`
- `pocket(kind)`
- `cardPlayed(cardId)`

Card-specific sounds include:
- `bounce_house` -> boing
- `bear_trap` -> metallic trap
- `portal`, `warp_rail`, pocket cards -> custom tone/noise patterns

## 9) Online Architecture

### Session model
- Room has up to 2 player seats.
- Extra joins become spectators.
- Name-based seat reclaim supported when room is full.

### Persistence / async
- Rooms saved in `server/state/rooms.json`.
- Server stores latest full snapshot + incrementing version.
- Clients long-poll `/api/state` and apply newer snapshots.
- This supports asynchronous turn-taking as long as room persists.

### Main API endpoints
- `GET /api/server-info`
- `POST /api/create-room`
- `POST /api/join-room`
- `POST /api/reconnect`
- `GET /api/state?code=&token=&since=&timeout=`
- `POST /api/update-state`
- `POST /api/start-tunnel`

### Invite URL logic (client)
- Computes invite from `onlinePublicUrlInput` first.
- Falls back to API base or current origin.
- Adds `room` query param, and `server` param when API origin differs.

### Input lock rules online
- Non-turn player input is locked generally.
- Local player card interaction window is explicitly exempted via `isLocalCardInteractionWindow()` to allow card choices during own card phase.

## 10) Rendering/UI Layers

Main overlays:
- Setup modal: `#setupOverlay` (startup + new game setup)
- Card phase overlay: `#cardOverlay`
- Selection confirmation overlay: `#selectionConfirmOverlay`
- Game over overlay: `#overlay`

Z-index intent:
- Setup overlay sits above base layout.
- Selection confirm sits above most interaction overlays.

## 11) Deployment Notes

For off-device invites to work:
- App must be served from a reachable host (not `localhost` only).
- `publicBaseUrl` should resolve to public URL of the HTML host.
- If API and HTML origins differ, invite includes `server=<api-base>` query param.

Quick production-ish approach:
- Host repo behind a public reverse proxy.
- Start Python server with `--public-base-url https://your-domain`.
- Ensure HTTPS and CORS/path access for API endpoints.

## 12) Known Risks / Gaps

- No automated test suite; regressions are currently manual.
- `src/main.js` is large and monolithic; high coupling across physics, UI, and cards.
- Warp geometry, moved pockets, and portal interactions are complex and easy to destabilize.
- Multiplayer snapshot model is last-write-wins; no conflict resolution beyond version monotonicity.
- Offline/opening via `file://` can break online API discovery and invite behavior.

## 13) Suggested Next Refactor Steps for Claude

1. Split `src/main.js` into modules:
   - `rules/`, `physics/`, `cards/`, `online/`, `ui/`.
2. Add deterministic physics/card test harness:
   - especially warp rail + portal + mirror + pocket edge cases.
3. Add integration tests for API contract:
   - create/join/reconnect/state/update-state/tunnel metadata.
4. Add replayable snapshot fixtures:
   - validate applying historical snapshots from `server/state/rooms.json`.
5. Add runtime diagnostics panel (developer mode):
   - current variant, turn owner, online role, snapshot version, effect stack.

## 14) Fast Orientation Map (Where to Start)

If working gameplay bugs:
- Start in `src/main.js`:
  - `startGame`, `endTurn`, `resolveTurnFlow`, card appliers, warp helpers.

If working visuals:
- `src/render/hd-renderer.js` + draw fallbacks in `src/main.js`.

If working online failures:
- Client: `onlineApi`, `pollOnlineState`, `queueOnlineSync`, `applyGameSnapshot`.
- Server: `server/multiplayer_server.py` endpoint handlers.

If working setup UX:
- Markup: `PLAY ME.html` (`#setupOverlay` block)
- Behavior: `setSetupOverlayVisible` + rack/new-game handlers
- Style: `src/styles/main.css` (`.setup-overlay`)

## 15) Notes to Preserve

- Keep compatibility with direct-open local play when possible.
- Preserve current card IDs in `CARD_POOL` (snapshot + hand serialization depends on IDs).
- Preserve snapshot shape in `serializeGameSnapshot()` unless server/client migration is handled.
- When changing invite URL behavior, validate with both same-origin and split-origin API setups.

