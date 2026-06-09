// app.js — application entry. Owns the single GameState, the setup flow, input,
// the shot loop, and rendering.
//
// Phase 1b: playable solo. Real ruleset (win/foul nuance), cards, audio and
// online are layered on in later phases. Turn handling here is intentionally
// simple: pot a ball to keep shooting, otherwise the turn passes; a scratch
// re-spots the cue and passes the turn.

import { createGameState, rackBalls, serializeSnapshot, applySnapshot } from './state.js';
import * as online from './online/client.js';
import { fitCanvas, playArea, pocketLayout, toPx, toRel, unitsFor } from './geometry.js';
import { drawTable } from './render/table.js';
import { drawBall } from './render/ball.js';
import { drawAim } from './render/aim.js';
import { drawEffects, drawEffectBadges, drawPickHighlights, drawFog, drawPlacementGhost } from './render/effects.js';
import {
  makeSim, pocketsFor, freshTurn, applyShot, step, syncToState, commit, MAX_SHOT_SPEED,
} from './physics.js';
import { CARD_POOL, cardById } from './cards/registry.js';
import { applyCard, clearBallEffects, decayTableEffects } from './cards/effects.js';
import { evaluateTurn, nextPlayer, commitmentLabel } from './rules/index.js';

const MAX_HAND = 7;
const DRAW_PER_TURN = 3;
const PLAY_PER_TURN = 2;

let canvas, ctx;
const state = createGameState();

// runtime (non-serialized) UI/loop flags
let controlMode = 'mouse';
let onlineMode = 'local';
let ballsMoving = false;
let aimAngle = 0;
let spin = { x: 0, y: 0 }; // cue English: x = side (-left..+right), y = top(+)/back(-)
let shotPower = 0;
let charging = false;
let chargeStart = 0;
let chargeAnim = null;
let physLoop = null;
let lastPhysTime = 0;
let sim = null;
let phoneDragStart = null;
let phoneDragging = false;
let placingCue = false; // ball-in-hand after a scratch

// card-phase runtime
let cardPhaseActive = false;
let phaseNewIds = null;     // Set of card ids drawn this phase (badged NEW in hand)
let cardPhasePlaysLeft = 0; // remaining plays this card phase
let pendingPick = null;     // { type, prompt } currently awaited on the table
let pickHover = null;       // {x,y} cursor pos for the live placement ghost
let cardQueue = [];         // [{ id, opts, steps:[...] }] being resolved
let cardPhaseDone = null;   // callback to run when the card phase + picks finish
let idleAnim = null;        // low-freq redraw for animated effects/picks
let trapAnimUntil = 0;      // keep redrawing briefly so a bear-trap snap completes

// ===================== CANVAS =====================
function sizeCanvas() {
  const center = document.getElementById('centerArea');
  const rect = center.getBoundingClientRect();
  const { w, h } = fitCanvas(Math.max(50, rect.width - 4), Math.max(25, rect.height - 4));
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  state.dims = { w: canvas.width, h: canvas.height };
}

function cuePx() {
  const cue = state.balls.find((b) => b.num === 0 && !b.pocketed);
  if (!cue) return null;
  const p = toPx({ u: cue.u, v: cue.v }, state.dims);
  return { ...p, r: unitsFor(state.dims).ballR * (cue.size || 1), ball: cue };
}

// ===================== RENDER =====================
function render() {
  if (!ctx) return;
  drawTable(ctx, state);
  drawEffects(ctx, state);                 // zone/rail art, under the balls
  for (const b of state.balls) drawBall(ctx, b, state);
  drawEffectBadges(ctx, state);            // status glyphs, over the balls
  const e = state.activeEffects || {};
  const canAim = state.started && !state.gameOver && !ballsMoving && !placingCue
    && !cardPhaseActive && !pendingPick && !!cuePx();
  const sway = (canAim && e.drunk) ? Math.sin(performance.now() / 280) * 0.087 : 0; // Drunk: wobbly aim, ±5°
  if (canAim && !e.shortsighted) {
    drawAim(ctx, state, aimAngle + sway, charging ? shotPower : 0);
  }
  // Fog of War masks everything but a sight beam down the (swayed) aim line.
  if (canAim && e.fogOfWar) drawFog(ctx, state, aimAngle + sway);
  if (canAim && (spin.x || spin.y)) drawSpinMarker();
  if (placingCue) drawCuePlacement();
  if (pendingPick) {
    drawPickHighlights(ctx, state, pendingPick);
    if (pendingPick.type === 'place') drawPlacementGhost(ctx, state, pendingPick, pickHover, cardQueue[0]?.opts || {});
  }
}

// Low-frequency redraw so animated effects (portals, pick rings) move while idle.
function startIdleLoop() {
  if (idleAnim) return;
  const tick = () => {
    if (!state.started || state.gameOver) { idleAnim = null; return; }
    const e = state.activeEffects || {};
    const animatedFx = (e.portals && e.portals.length) || e.crosswind || e.magnet || e.turbo
      || e.bouncer || e.icePatch || e.mudPatch || (e.bounceHouseRail && e.bounceHouseRail.length)
      || performance.now() < trapAnimUntil;
    const animated = pendingPick || placingCue || (e.drunk && !ballsMoving) || animatedFx;
    if (animated && !ballsMoving) render();
    idleAnim = requestAnimationFrame(tick);
  };
  idleAnim = requestAnimationFrame(tick);
}

// A small dot on the cue ball showing where the tip will strike (the English).
function drawSpinMarker() {
  const cue = cuePx();
  if (!cue) return;
  const r = cue.r;
  const mx = cue.x + spin.x * r * 0.62;
  const my = cue.y - spin.y * r * 0.62;
  ctx.save();
  ctx.beginPath(); ctx.arc(mx, my, Math.max(2, r * 0.22), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(220,40,40,0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

function drawCuePlacement() {
  const cue = cuePx();
  if (!cue) return;
  const bad = overlapsAnyBall(cue.ball.u, cue.ball.v, cue.ball);
  const pulse = (Math.sin(performance.now() / 220) + 1) / 2;
  ctx.save();
  // pulsing halo so it's obvious the cue is being placed
  ctx.beginPath();
  ctx.arc(cue.x, cue.y, cue.r + 6 + pulse * 6, 0, Math.PI * 2);
  ctx.fillStyle = bad ? `rgba(255,70,70,${0.10 + pulse * 0.16})` : `rgba(90,255,120,${0.10 + pulse * 0.16})`;
  ctx.fill();
  // dashed ring
  ctx.strokeStyle = bad ? 'rgba(255,80,80,0.95)' : 'rgba(110,255,140,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.lineDashOffset = -performance.now() / 60; // marching ants
  ctx.beginPath();
  ctx.arc(cue.x, cue.y, cue.r + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ===================== SETUP / START =====================
function setSetupVisible(show) {
  document.getElementById('setupOverlay').classList.toggle('show', show);
}

function variantPlayerCount(v) {
  return v === 'cutthroat' ? 3 : (v === 'doubles' ? 4 : 2);
}

function onRackUp() {
  state.variant = document.getElementById('variantSelect').value;
  controlMode = document.getElementById('modeMouseBtn').classList.contains('active') ? 'mouse' : 'phone';
  state.cardsEnabled = document.getElementById('enableCards').checked;
  const names = ['p1name', 'p2name', 'p3name', 'p4name'].map((id, i) =>
    document.getElementById(id).value || `Player ${i + 1}`);
  if (onlineMode === 'online') {
    if (!online.onlineState().connected) { showToast('Create or join a room first'); return; }
    if (online.onlineState().seat !== 0) { showToast('Only the host (Player 1) racks up'); return; }
  }
  const n = variantPlayerCount(state.variant);
  state.players = [];
  for (let i = 0; i < n; i++) state.players.push({ name: names[i], group: null, hand: [], seat: i });
  state.currentPlayer = 0;
  startGame();
  if (onlineMode === 'online') { setStatus(isMyTurn() ? 'Your break' : 'Opponent breaks'); maybePush(); }
}

function startGame() {
  state.started = true;
  state.gameOver = false;
  state.broken = false;
  state.players.forEach((p) => { p.group = null; });
  state.movedPockets = {};
  state.activeEffects = {};
  state.pocketState = {};
  state.players.forEach((p) => { p.hand = []; });
  placingCue = false; updateBallInHandUI();
  ballsMoving = false;
  spin = { x: 0, y: 0 }; updateSpinDial();
  cardPhaseActive = false; pendingPick = null; phaseNewIds = null; cardPhasePlaysLeft = 0; cardQueue = [];
  updateCardPhaseUI();
  setSetupVisible(false);
  document.getElementById('overlay').classList.add('hidden');
  sizeCanvas();
  rackBalls(state);
  document.getElementById('shotBtn').classList.toggle('visible', controlMode === 'phone');
  setStatus(`${state.players[state.currentPlayer].name} to break`);
  updatePlayers();
  updateHand();
  updateEffects();
  render();
  startIdleLoop();
}

function onNewGame() {
  document.getElementById('overlay').classList.add('hidden');
  setSetupVisible(true);
  updateGuide();
}

function setControlMode(mode) {
  controlMode = mode;
  document.getElementById('modeMouseBtn').classList.toggle('active', mode === 'mouse');
  document.getElementById('modePhoneBtn').classList.toggle('active', mode === 'phone');
  document.getElementById('shotBtn').classList.toggle('visible', mode === 'phone' && state.started);
}

function setOnlineMode(mode) {
  onlineMode = mode;
  document.getElementById('modeLocalBtn').classList.toggle('active', mode === 'local');
  document.getElementById('modeOnlineBtn').classList.toggle('active', mode === 'online');
  document.getElementById('onlineSetupSection').style.display = mode === 'online' ? 'flex' : 'none';
  const vs = document.getElementById('variantSelect');
  vs.querySelectorAll('option').forEach((o) => {
    o.disabled = mode === 'online' && (o.value === 'cutthroat' || o.value === 'doubles');
  });
  if (mode === 'online' && (vs.value === 'cutthroat' || vs.value === 'doubles')) {
    vs.value = 'eight';
    onVariantChange();
  }
}

// ===================== SHOOTING =====================
function beginCharge() {
  if (ballsMoving || !state.started || state.gameOver || placingCue) return;
  if (!isMyTurn() || cardPhaseActive || pendingPick) return;
  charging = true;
  chargeStart = performance.now();
  const loop = () => {
    if (!charging) return;
    let p = Math.min((performance.now() - chargeStart) / 1500, 1);
    const e = state.activeEffects || {};
    if (e.roidRage) p = Math.max(p, 0.75);
    if (e.coolHands) p = Math.min(p, 0.25);
    shotPower = p;
    updatePowerBar(shotPower);
    render();
    chargeAnim = requestAnimationFrame(loop);
  };
  loop();
}

function releaseCharge() {
  if (!charging) return;
  charging = false;
  if (chargeAnim) { cancelAnimationFrame(chargeAnim); chargeAnim = null; }
  const p = shotPower;
  shotPower = 0;
  updatePowerBar(0);
  if (p > 0.02) shoot(p, aimAngle);
  else render();
}

const sfx = (m, ...a) => { try { window.SFX && window.SFX[m] && window.SFX[m](...a); } catch (e) { /* no audio */ } };
function playEvents(evts) {
  let ball = 0, rail = 0, trap = false; // collapse many same-frame hits into one sound each
  for (const e of evts) {
    if (e.type === 'pocket') sfx('pocket', e.kind);
    else if (e.type === 'ball') ball = Math.max(ball, e.impact);
    else if (e.type === 'rail') rail = Math.max(rail, e.impact);
    else if (e.type === 'beartrap') trap = true;
  }
  if (ball > 0.05) sfx('ballHit', ball);
  if (rail > 0.05) sfx('railHit', rail, 'normal');
  if (trap) { sfx('railHit', 1, 'bear_trap'); trapAnimUntil = performance.now() + 400; } // metallic snap
}

function shoot(power, angle) {
  sim = makeSim(state);
  applyShot(sim, power, angle, state.activeEffects, spin);
  spin = { x: 0, y: 0 }; updateSpinDial(); // spin is consumed by this shot
  state.turn = freshTurn();
  state.turn.isBreak = !state.broken;
  ballsMoving = true;
  sfx('shot', power);
  lastPhysTime = performance.now();
  const env = { effects: state.activeEffects, pocketState: state.pocketState, events: [] };
  const tick = () => {
    const now = performance.now();
    const dt = Math.min((now - lastPhysTime) / 16.67, 3);
    lastPhysTime = now;
    let moving = false;
    const sub = 3;
    env.events.length = 0;
    for (let i = 0; i < sub; i++) moving = step(sim, pocketsFor(state), dt / sub, state.turn, env);
    playEvents(env.events);
    syncToState(state, sim);
    render();
    if (moving) {
      physLoop = requestAnimationFrame(tick);
    } else {
      physLoop = null;
      commit(state, sim);
      ballsMoving = false;
      resolveShot();
    }
  };
  physLoop = requestAnimationFrame(tick);
}

// Online helpers: is it this client's turn, and push the authoritative snapshot.
function isMyTurn() {
  if (onlineMode !== 'online') return true;
  return online.onlineState().seat === state.currentPlayer && !state.gameOver;
}
function maybePush() {
  if (onlineMode !== 'online') return;
  const snap = serializeSnapshot(state);
  state.version = snap.version;
  online.pushSnapshot(snap);
}

// Full per-variant turn resolution via the rules engine. On a lost turn the
// shooter gets a card phase to sabotage the incoming player, then play passes.
function resolveShot() {
  const t = state.turn;
  const shooter = state.currentPlayer;

  clearBallEffects(state);           // ball/cue effects last exactly one shot
  const res = evaluateTurn(state, t); // may assign groups; returns the outcome
  state.broken = true;
  if (t.cueScratched) respotCue();
  (res.respot || []).forEach(respotBall);

  if (res.gameOver) {
    updatePlayers(); updateEffects(); render();
    showGameOver(res.reason);
    maybePush();
    return;
  }

  if (res.keepTurn) {
    setStatus(res.message);
    updatePlayers(); updateEffects(); render();
    maybePush();
    return;
  }

  const proceed = () => {
    decayTableEffects(state);
    state.currentPlayer = nextPlayer(state);
    state.ballInHand = !!(res.ballInHand || t.cueScratched);
    placingCue = state.ballInHand && isMyTurn();
    if (state.ballInHand) setStatus(`${current().name}: ball in hand — place the cue ball, then shoot`);
    else setStatus(`${current().name}'s turn`);
    updatePlayers(); updateEffects(); updateHand(); updateBallInHandUI(); render();
    maybePush();
  };

  if (state.cardsEnabled) beginCardPhase(shooter, proceed);
  else proceed();
}

function current() { return state.players[state.currentPlayer]; }

function respotCue() {
  const cue = state.balls.find((b) => b.num === 0);
  if (!cue) return;
  cue.pocketed = false;
  const pa = playArea(state.dims);
  const rel = toRel({ x: pa.left + pa.w * 0.25, y: pa.cy }, state.dims);
  cue.u = rel.u; cue.v = rel.v; cue.vx = 0; cue.vy = 0;
}

// Re-spot a pocketed ball near the foot spot (nudges to a free nearby cell).
function respotBall(num) {
  const b = state.balls.find((x) => x.num === num);
  if (!b) return;
  b.pocketed = false; b.vx = 0; b.vy = 0;
  const base = { u: 0.75, v: 0.5 };
  const r = unitsFor(state.dims).ballR;
  for (let i = 0; i < 40; i++) {
    const cand = { u: base.u, v: base.v + (i % 2 ? -1 : 1) * 0.04 * Math.ceil(i / 2) };
    const px = toPx(cand, state.dims);
    const clash = state.balls.some((o) => o !== b && !o.pocketed && Math.hypot(...sub(toPx({ u: o.u, v: o.v }, state.dims), px)) < r * 2);
    if (!clash) { b.u = Math.max(0.03, Math.min(0.97, cand.u)); b.v = Math.max(0.05, Math.min(0.95, cand.v)); return; }
  }
  b.u = base.u; b.v = base.v;
}
const sub = (a, b) => [a.x - b.x, a.y - b.y];

function showGameOver(reason) {
  state.gameOver = true;
  state.gameOverReason = reason || state.gameOverReason || 'Game over!';
  if (idleAnim) { cancelAnimationFrame(idleAnim); idleAnim = null; }
  document.getElementById('overlayTitle').textContent = '🎱 Game Over!';
  document.getElementById('overlayMsg').textContent = state.gameOverReason;
  document.getElementById('overlay').classList.remove('hidden');
  sfx('win');
}

function overlapsAnyBall(u, v, self) {
  const base = unitsFor(state.dims).ballR;
  const p = toPx({ u, v }, state.dims);
  return state.balls.some((b) => {
    if (b === self || b.pocketed) return false;
    const bp = toPx({ u: b.u, v: b.v }, state.dims);
    const min = base * (self.size || 1) + base * (b.size || 1) + 2;
    return Math.hypot(bp.x - p.x, bp.y - p.y) < min;
  });
}

function placeCueAt(px, py) {
  if (!isMyTurn()) return;
  const cue = state.balls.find((b) => b.num === 0);
  if (!cue) return;
  const pa = playArea(state.dims);
  const r = unitsFor(state.dims).ballR * (cue.size || 1);
  const x = Math.max(pa.left + r, Math.min(pa.right - r, px));
  const y = Math.max(pa.top + r, Math.min(pa.bottom - r, py));
  const rel = toRel({ x, y }, state.dims);
  if (overlapsAnyBall(rel.u, rel.v, cue)) { showToast("Can't place there"); return; }
  cue.u = rel.u; cue.v = rel.v;
  placingCue = false; updateBallInHandUI();
  state.ballInHand = false;
  setStatus(`${current().name}'s turn`);
  render();
}

// ===================== CARD PHASE =====================
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function drawCards(player) {
  if (player.hand.length >= MAX_HAND) return [];
  const slots = MAX_HAND - player.hand.length;
  const toDraw = Math.min(DRAW_PER_TURN, slots);
  const drawn = [];
  const used = new Set();
  // Pick a random id from `pool` that hasn't been drawn yet this offering, so a
  // single draw never contains duplicate cards.
  const pickUnique = (pool) => {
    const choices = pool.filter((c) => !used.has(c.id));
    if (!choices.length) return null;
    const id = choices[Math.floor(Math.random() * choices.length)].id;
    used.add(id);
    return id;
  };
  const ball = CARD_POOL.filter((c) => c.type === 'ball');
  const table = CARD_POOL.filter((c) => c.type === 'table');
  // Lead with a ball card + a table card for variety, then fill from the whole pool.
  if (toDraw >= 1) { const id = pickUnique(ball); if (id) drawn.push(id); }
  if (toDraw >= 2) { const id = pickUnique(table); if (id) drawn.push(id); }
  while (drawn.length < toDraw) { const id = pickUnique(CARD_POOL); if (!id) break; drawn.push(id); }
  shuffle(drawn);
  for (const id of drawn) if (player.hand.length < MAX_HAND) player.hand.push(id);
  return drawn;
}

// Card phase: the shooter draws into their hand, then plays cards FROM the hand
// (right panel). Nothing fires on draw; a card only plays when its hand entry is
// clicked, and a "now playing" banner makes the active card unmistakable.
function beginCardPhase(playerIdx, onDone) {
  cardPhaseDone = onDone;
  state.cardPhasePlayer = playerIdx;
  const player = state.players[playerIdx];
  const drawn = drawCards(player);
  if (!player.hand.length) { state.cardPhasePlayer = null; cardPhaseDone = null; onDone(); return; }
  cardPhaseActive = true;
  cardPhasePlaysLeft = PLAY_PER_TURN;
  phaseNewIds = new Set(drawn);          // badge freshly drawn cards NEW in the hand
  setStatus(`${player.name}: play cards from your hand, then Done`);
  updateHand();
  updateCardPhaseUI();
}

// Show the prominent ball-in-hand banner whenever the local player must place the
// cue ball after a scratch.
function updateBallInHandUI() {
  const el = document.getElementById('ballInHand');
  if (el) el.classList.toggle('hidden', !placingCue);
}

// Show/hide the card-phase chrome: the "N plays left" tag + Done button by the
// hand, and the "now playing" banner over the table while a pick is pending.
function updateCardPhaseUI() {
  const tag = document.getElementById('cardPhaseTag');
  const hint = document.getElementById('cardPhaseHint');
  const doneBtn = document.getElementById('cardDoneBtn');
  const banner = document.getElementById('nowPlaying');
  if (!cardPhaseActive) {
    [tag, hint, doneBtn, banner].forEach((e) => e && e.classList.add('hidden'));
    return;
  }
  if (pendingPick) {
    const c = cardById(pendingPick.cardId);
    banner.innerHTML = `<span class="np-title">▶ Playing ${c.icon || ''} ${c.name}</span>`
      + `<span class="np-prompt">${pendingPick.prompt}</span>`;
    banner.classList.remove('hidden');
    tag.textContent = 'placing…'; tag.classList.remove('hidden');
    hint.classList.add('hidden');
    doneBtn.classList.add('hidden');
  } else {
    banner.classList.add('hidden');
    const left = cardPhasePlaysLeft;
    tag.textContent = left > 0 ? `${left} play${left > 1 ? 's' : ''} left` : 'no plays left';
    tag.classList.remove('hidden');
    hint.textContent = left > 0 ? 'Click a card to play it.' : 'Out of plays — click Done.';
    hint.classList.remove('hidden');
    doneBtn.textContent = left > 0 ? 'Done' : 'Continue';
    doneBtn.classList.remove('hidden');
  }
}

// Play the hand card at `slot`: pull it from the hand and resolve it (table picks,
// then effect). When it settles we return to the hand for another play, or end.
function playHandCard(slot) {
  if (!cardPhaseActive || pendingPick || cardPhasePlaysLeft <= 0) return;
  const player = state.players[state.cardPhasePlayer];
  const id = player.hand[slot];
  if (!id) return;
  player.hand.splice(slot, 1);
  cardPhasePlaysLeft--;
  cardQueue = [{ id, opts: {}, steps: [...(cardById(id).interactions || [])] }];
  updateHand();
  updateCardPhaseUI();
  processCardQueue();
}

// A played card has fully resolved: back to the hand for another play, or end.
function afterCardResolved() {
  updateHand(); updateEffects(); render();
  const player = state.players[state.cardPhasePlayer];
  if (cardPhasePlaysLeft > 0 && player && player.hand.length) {
    setStatus(`${player.name}: play another card or click Done`);
    updateCardPhaseUI();
  } else {
    endCardPhase();
  }
}

function onCardPhaseDone() { if (!pendingPick) endCardPhase(); }
function onCardPhaseSkip() { if (!pendingPick) endCardPhase(); }

function processCardQueue() {
  if (!cardQueue.length) { afterCardResolved(); return; }
  const item = cardQueue[0];
  if (item.steps.length) {
    const s = item.steps[0];
    pendingPick = { type: s.type, prompt: s.prompt, cardId: item.id };
    pickHover = null; // ghost appears once the cursor moves over the bed
    setStatus(`${state.players[state.cardPhasePlayer].name}: ${s.prompt}`);
    updateCardPhaseUI(); // show the "now playing" banner
    updateHand();        // hand isn't clickable while a pick is in progress
    render();
  } else {
    applyCard(state, item.id, item.opts);
    sfx('cardPlayed', item.id);
    cardQueue.shift();
    updateEffects(); render();
    processCardQueue();
  }
}

// Resolve one table pick during the card phase. Returns true if the click hit a
// valid target (otherwise it's ignored and we keep waiting).
function resolvePick(x, y) {
  const item = cardQueue[0];
  if (!item || !pendingPick) return;
  const r = unitsFor(state.dims).ballR;
  let ok = false;
  if (pendingPick.type === 'ball') {
    const b = state.balls.find((bb) => !bb.pocketed && bb.num !== 0 && hitBall(bb, x, y, r));
    if (b) { item.opts.ball = b.num; ok = true; }
  } else if (pendingPick.type === 'pocket') {
    const pk = pocketLayout(state.dims, state.movedPockets);
    let best = -1, bd = Infinity;
    pk.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < p.r * 2.2 && d < bd) { bd = d; best = i; } });
    if (best >= 0) { item.opts.pocket = best; ok = true; }
  } else if (pendingPick.type === 'rail') {
    const rail = railFromClick(x, y);
    if (rail) { item.opts.rail = rail; ok = true; }
  } else if (pendingPick.type === 'place') {
    const pa = playArea(state.dims);
    if (x > pa.left && x < pa.right && y > pa.top && y < pa.bottom) {
      const rel = toRel({ x, y }, state.dims);
      if (item.id === 'portal') (item.opts.positions ||= []).push(rel);
      else if ((item.id === 'move_hole' || item.id === 'warp_rail') && item.opts.pocket !== undefined) {
        // Can't drop a pocket on top of a ball — it would swallow it for free.
        const pr = unitsFor(state.dims).pocketR;
        const onBall = state.balls.some((b) => {
          if (b.pocketed) return false;
          const bp = toPx({ u: b.u, v: b.v }, state.dims);
          return Math.hypot(bp.x - x, bp.y - y) < pr + r * (b.size || 1);
        });
        if (onBall) { showToast("Can't drop a pocket onto a ball"); return; }
        item.opts.to = rel;
      }
      else item.opts.pos = rel;
      ok = true;
    }
  }
  if (!ok) return;
  item.steps.shift();
  pendingPick = null;
  processCardQueue();
}

function endCardPhase() {
  cardPhaseActive = false; cardPhasePlaysLeft = 0; phaseNewIds = null;
  pendingPick = null; pickHover = null; cardQueue = [];
  updateCardPhaseUI();
  const done = cardPhaseDone; cardPhaseDone = null;
  state.cardPhasePlayer = null;
  updateHand();
  if (done) done();
}

function hitBall(b, x, y, r) {
  const p = toPx({ u: b.u, v: b.v }, state.dims);
  return Math.hypot(p.x - x, p.y - y) < r * (b.size || 1) * 2;
}
function railFromClick(x, y) {
  const c = unitsFor(state.dims).cushion;
  if (y < c) return 'top';
  if (y > state.dims.h - c) return 'bottom';
  if (x < c) return 'left';
  if (x > state.dims.w - c) return 'right';
  return null;
}

// ===================== INPUT =====================
function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function updateAimFromPoint(px, py) {
  const cue = cuePx();
  if (!cue) return;
  aimAngle = Math.atan2(py - cue.y, px - cue.x);
}

function wireInput() {
  canvas.addEventListener('mousemove', (e) => {
    if (!state.started || ballsMoving) return;
    const pos = canvasPos(e);
    if (pendingPick) { pickHover = pos; render(); return; }
    if (placingCue) { render(); return; }
    updateAimFromPoint(pos.x, pos.y);
    render();
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!state.started || ballsMoving || e.button !== 0) return;
    const pos = canvasPos(e);
    if (pendingPick) { resolvePick(pos.x, pos.y); return; }
    if (placingCue) { placeCueAt(pos.x, pos.y); return; }
    if (controlMode === 'mouse') beginCharge();
  });
  window.addEventListener('mouseup', () => { if (controlMode === 'mouse') releaseCharge(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // touch (phone): drag to aim, shot button to charge/fire
  canvas.addEventListener('touchstart', (e) => {
    if (!state.started || ballsMoving) return;
    e.preventDefault();
    const pos = canvasPos(e.touches[0]);
    if (pendingPick) {
      // 'place' picks preview a ghost under the finger and confirm on release;
      // ball/pocket/rail picks resolve on tap.
      if (pendingPick.type === 'place') { pickHover = pos; render(); return; }
      resolvePick(pos.x, pos.y); return;
    }
    if (placingCue) { placeCueAt(pos.x, pos.y); return; }
    phoneDragStart = pos; phoneDragging = false;
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (!state.started || ballsMoving) return;
    e.preventDefault();
    if (pendingPick && pendingPick.type === 'place') { pickHover = canvasPos(e.touches[0]); render(); return; }
    if (!phoneDragStart) return;
    const pos = canvasPos(e.touches[0]);
    if (Math.hypot(pos.x - phoneDragStart.x, pos.y - phoneDragStart.y) > 4) phoneDragging = true;
    if (phoneDragging) { updateAimFromPoint(pos.x, pos.y); render(); }
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (pendingPick && pendingPick.type === 'place' && pickHover) { resolvePick(pickHover.x, pickHover.y); }
    phoneDragStart = null;
  }, { passive: false });

  const shotBtn = document.getElementById('shotBtn');
  shotBtn.addEventListener('pointerdown', () => { if (controlMode === 'phone') { shotBtn.classList.add('charging'); beginCharge(); } });
  shotBtn.addEventListener('pointerup', () => { shotBtn.classList.remove('charging'); releaseCharge(); });
  wireSpinDial();
}

// ===================== UI PANELS =====================
function setStatus(msg) { document.getElementById('statusMsg').textContent = msg; }

function updatePowerBar(p) {
  const bar = document.getElementById('powerBar');
  if (p > 0) {
    bar.style.display = 'flex';
    document.getElementById('powerFillInner').style.width = `${p * 100}%`;
    document.getElementById('powerPct').textContent = `${Math.round(p * 100)}%`;
  } else {
    bar.style.display = 'none';
  }
}

// ---- Spin / English dial ----
let spinDragging = false;
function setSpinFromEvent(e) {
  const dial = document.getElementById('spinDial');
  if (!dial) return;
  const rect = dial.getBoundingClientRect();
  const R = rect.width / 2 - 7; // keep the dot inside the rim
  let dx = (e.clientX - (rect.left + rect.width / 2)) / R;
  let dy = (e.clientY - (rect.top + rect.height / 2)) / R;
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  spin = { x: dx, y: -dy }; // screen-down is back spin, so invert y
  updateSpinDial();
  render();
}
function updateSpinDial() {
  const dial = document.getElementById('spinDial');
  if (!dial) return;
  const dot = document.getElementById('spinDot');
  const R = dial.clientWidth / 2 - 7;
  dot.style.left = `${dial.clientWidth / 2 + spin.x * R}px`;
  dot.style.top = `${dial.clientHeight / 2 - spin.y * R}px`;
  dial.classList.toggle('spin-active', !!(spin.x || spin.y));
}
function wireSpinDial() {
  const dial = document.getElementById('spinDial');
  if (!dial) return;
  dial.addEventListener('mousedown', (e) => { e.preventDefault(); spinDragging = true; setSpinFromEvent(e); });
  window.addEventListener('mousemove', (e) => { if (spinDragging) setSpinFromEvent(e); });
  window.addEventListener('mouseup', () => { spinDragging = false; });
  dial.addEventListener('touchstart', (e) => { e.preventDefault(); setSpinFromEvent(e.touches[0]); }, { passive: false });
  dial.addEventListener('touchmove', (e) => { e.preventDefault(); setSpinFromEvent(e.touches[0]); }, { passive: false });
  // double-click / right-click clears the spin back to centre
  dial.addEventListener('dblclick', () => { spin = { x: 0, y: 0 }; updateSpinDial(); render(); });
  dial.addEventListener('contextmenu', (e) => { e.preventDefault(); spin = { x: 0, y: 0 }; updateSpinDial(); render(); });
  updateSpinDial();
}

function updatePlayers() {
  const el = document.getElementById('playerInfo');
  el.innerHTML = '';
  const swatch = ['#ffd700', '#4a9eff', '#ff6b6b', '#4aff4a'];
  // 8-ball / doubles assign solids vs stripes — show that as the ball icon.
  const groupsShown = state.variant === 'eight' || state.variant === 'doubles';
  state.players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'player-row' + (i === state.currentPlayer ? ' active-turn' : '');
    const label = state.started ? commitmentLabel(state, i) : '';
    const col = swatch[i] || '#888';
    let style;
    if (groupsShown && p.group === 'stripes') {
      // white ball with a coloured equatorial band
      style = `background:linear-gradient(#fbfbfb 0 27%, ${col} 27% 73%, #fbfbfb 73% 100%);`;
    } else if (groupsShown && p.group === 'solids') {
      // solid coloured ball with a highlight
      style = `background:radial-gradient(circle at 34% 30%, #ffffffcc, ${col} 58%);`;
    } else {
      style = `background:${col};`;
    }
    const ttl = (groupsShown && p.group) ? ` title="${p.group}"` : '';
    row.innerHTML = `<div class="player-swatch"${ttl} style="${style}"></div>`
      + `<div class="player-name">${p.name}</div>`
      + `<div class="player-score">${label}</div>`;
    el.appendChild(row);
  });
}

function updateHand() {
  const el = document.getElementById('handArea');
  // During the card phase show the shooter's hand (still the current player);
  // it's interactive then. Otherwise it's a passive display of the turn-holder.
  const pi = state.cardPhasePlayer != null ? state.cardPhasePlayer : state.currentPlayer;
  const p = state.players[pi];
  if (!p || !p.hand.length) { el.innerHTML = '<span style="font-size:11px;color:#555">No cards</span>'; return; }
  const playable = cardPhaseActive && !pendingPick && cardPhasePlaysLeft > 0;
  const exhausted = cardPhaseActive && !pendingPick && cardPhasePlaysLeft <= 0;
  el.innerHTML = '';
  p.hand.forEach((id, slot) => {
    const c = cardById(id); if (!c) return;
    const div = document.createElement('div');
    div.className = 'card-item' + (playable ? ' playable' : '') + (exhausted ? ' disabled' : '');
    const isNew = phaseNewIds && phaseNewIds.has(id) && cardPhaseActive;
    div.innerHTML = `<div class="card-name">${c.icon || ''} ${c.name}`
      + `${isNew ? '<span class="new-badge">NEW</span>' : ''}</div>`
      + `<div class="card-desc">${c.desc}</div>`;
    if (playable) {
      div.title = 'Click to play';
      div.addEventListener('click', () => playHandCard(slot));
    }
    el.appendChild(div);
  });
}

function updateEffects() {
  const el = document.getElementById('effectsDisplay');
  const e = state.activeEffects || {};
  const ps = state.pocketState || {};
  const chips = [];
  const add = (cond, label) => { if (cond) chips.push(label); };
  add(e.fogOfWar, '🌫️ Fog'); add(e.confusion, '🔀 Confusion'); add(e.cloaked != null, '👻 Cloak');
  add(e.sticky, '🍯 Sticky'); add(e.drunk, '🍺 Drunk'); add(e.shortsighted, '🔭 Shortsighted');
  add(e.roidRage, '💢 Roid ≥75%'); add(e.coolHands, '🧊 Cool ≤25%'); add(e.bigBall, '🔵 Big Cue');
  add(e.smallBall, '⚬ Small Cue'); add(e.oilCue, '💧 Oil'); add(e.reverseSpin, '↩️ Reverse');
  add(e.mirror, '🪞 Mirror'); add(e.magnet, '🧲 Magnet'); add(e.turbo, '⚡ Turbo');
  add(e.bouncer, '🔴 Bouncer'); add(e.bearTrap, '🪤 Bear Trap'); add(e.icePatch, '🧊 Ice');
  add(e.mudPatch, '💩 Mud'); add(e.crosswind, '💨 Crosswind');
  add(e.portals && e.portals.length, '🌀 Portal');
  add(e.bounceHouseRail && e.bounceHouseRail.length, '🎪 Bounce: ' + (e.bounceHouseRail || []).join(', '));
  add(e.deadRail && e.deadRail.length, '🪵 Dead: ' + (e.deadRail || []).join(', '));
  Object.keys(ps).forEach((i) => { if (ps[i].blocked) chips.push('🚫 Blocked'); if (ps[i].shrunk) chips.push('🔩 Shrunk'); });
  el.innerHTML = chips.length ? chips.map((c) => `<div class="effect-tag">${c}</div>`).join('')
    : '<span style="font-size:11px;color:#555">None</span>';
}

function guideText(v) {
  const g = {
    eight: '<b>8-Ball</b><br>Pot all of your group (solids 1–7 or stripes 9–15), then the 8-ball to win.',
    nine: '<b>9-Ball</b><br>Always hit the lowest ball first. Pot the 9-ball to win.',
    cutthroat: '<b>Cutthroat (3P)</b><br>Each player owns 5 balls. Last with balls on the table wins.',
    doubles: '<b>Doubles (2v2)</b><br>Teams P1+P3 vs P2+P4, same idea as 8-ball.',
  };
  return g[v] || g.eight;
}
function updateGuide() {
  const v = document.getElementById('variantSelect')?.value || state.variant;
  document.getElementById('guideText').innerHTML = guideText(v);
}

function onVariantChange() {
  updateGuide();
  const v = document.getElementById('variantSelect').value;
  const is3 = v === 'cutthroat', is4 = v === 'doubles';
  document.getElementById('p3nameLabel').style.display = (is3 || is4) ? '' : 'none';
  document.getElementById('p3name').style.display = (is3 || is4) ? '' : 'none';
  document.getElementById('p4nameLabel').style.display = is4 ? '' : 'none';
  document.getElementById('p4name').style.display = is4 ? '' : 'none';
}

function showToast(msg, ms = 1700) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}

// ===================== ONLINE =====================
async function onCreateRoom() {
  const url = document.getElementById('serverUrlInput').value.trim() || window.location.origin;
  online.configure(url);
  const name = document.getElementById('p1name').value || 'Player 1';
  document.getElementById('onlineStatus').textContent = 'Creating room…';
  const d = await online.createRoom(name);
  if (d.code) {
    document.getElementById('roomCodeInput').value = d.code;
    document.getElementById('onlineStatus').textContent = `Room ${d.code} — you are the host. Rack up when your opponent joins.`;
    setInviteUrl(d.code, url);
    online.startPolling(applyOnlineSnapshot);
  } else {
    document.getElementById('onlineStatus').textContent = d.error || 'Could not create room';
  }
}

async function onJoinRoom() {
  const url = document.getElementById('serverUrlInput').value.trim() || window.location.origin;
  online.configure(url);
  const code = document.getElementById('roomCodeInput').value.trim();
  const name = document.getElementById('p2name').value || 'Player 2';
  if (!code) { showToast('Enter a room code'); return; }
  document.getElementById('onlineStatus').textContent = 'Joining…';
  const d = await online.joinRoom(code, name);
  if (d.token) {
    document.getElementById('onlineStatus').textContent = `Joined ${code} as Player ${d.seat + 1}. Waiting for the host to rack…`;
    online.startPolling(applyOnlineSnapshot);
  } else {
    document.getElementById('onlineStatus').textContent = d.error || 'Join failed';
  }
}

function setInviteUrl(code, serverUrl) {
  const pub = document.getElementById('onlinePublicUrlInput').value.trim();
  const base = pub || (window.location.origin + window.location.pathname);
  let url = `${base}?room=${code}`;
  if (serverUrl && serverUrl !== window.location.origin) url += `&server=${encodeURIComponent(serverUrl)}`;
  document.getElementById('inviteUrl').value = url;
  document.getElementById('inviteRow').style.display = 'flex';
}

function copyInvite() {
  const url = document.getElementById('inviteUrl').value;
  if (url && navigator.clipboard) navigator.clipboard.writeText(url).then(() => showToast('Invite copied!')).catch(() => showToast('Copy failed'));
}

// Apply an incoming authoritative snapshot from the opponent.
function applyOnlineSnapshot(snap) {
  applySnapshot(state, snap);
  ballsMoving = false; cardPhaseActive = false; pendingPick = null; cardPhasePlaysLeft = 0; phaseNewIds = null; cardQueue = [];
  updateCardPhaseUI();
  if (state.started) { setSetupVisible(false); document.getElementById('shotBtn').classList.toggle('visible', controlMode === 'phone'); }
  placingCue = state.ballInHand && isMyTurn() && !state.gameOver; updateBallInHandUI();
  if (state.gameOver) {
    showGameOver(state.gameOverReason);
  } else if (isMyTurn()) {
    setStatus(state.ballInHand ? 'Your turn — ball in hand' : 'Your turn');
  } else {
    setStatus(`Waiting for ${state.players[state.currentPlayer]?.name || 'opponent'}…`);
  }
  updatePlayers(); updateHand(); updateEffects(); render(); startIdleLoop();
}

// ===================== BOOT =====================
function boot() {
  canvas = document.getElementById('tableCanvas');
  ctx = canvas.getContext('2d');
  document.addEventListener('pointerdown', () => sfx('unlockFromGesture'), { once: true });
  sizeCanvas();
  wireInput();
  updateGuide();
  setSetupVisible(true);
  render();

  document.getElementById('variantSelect').addEventListener('change', onVariantChange);
  document.getElementById('newGameBtn').addEventListener('click', onNewGame);
  window.addEventListener('resize', () => { sizeCanvas(); render(); });

  // Invite link: ?room=CODE[&server=URL] pre-fills and switches to online.
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) {
    document.getElementById('roomCodeInput').value = params.get('room').toUpperCase();
    if (params.get('server')) document.getElementById('serverUrlInput').value = params.get('server');
    setOnlineMode('online');
  }

  // inline-onclick handlers used by PLAY ME.html
  Object.assign(window, {
    onRackUp, onNewGame, setControlMode, setOnlineMode,
    onCreateRoom, onJoinRoom, copyInvite,
    onCardPhaseDone, onCardPhaseSkip,
    onConfirmYes: () => {}, onConfirmNo: () => {},
  });

  // dev hooks
  window.RR = {
    state, render,
    start: onRackUp,
    shoot: (power, angle) => { aimAngle = angle; shoot(power, angle); },
    isMoving: () => ballsMoving,
    // headless shot: simulate to rest synchronously, then resolve (rAF-independent)
    simShot: (power, angle, sp) => {
      sim = makeSim(state);
      applyShot(sim, power, angle, state.activeEffects, sp || spin);
      state.turn = freshTurn(); state.turn.isBreak = !state.broken;
      const env = { effects: state.activeEffects, pocketState: state.pocketState };
      let f = 0; while (step(sim, pocketsFor(state), 1, state.turn, env) && f < 6000) f++;
      commit(state, sim); ballsMoving = false; resolveShot(); render();
      return { status: document.getElementById('statusMsg').textContent, groups: state.players.map((p) => p.group), pocketed: state.balls.filter((b) => b.pocketed).map((b) => b.num) };
    },
    moveHole(i, u, v) { state.movedPockets[i] = { u, v }; render(); },
    setSize(num, size) { const b = state.balls.find((x) => x.num === num); if (b) { b.size = size; render(); } },
    refreshPanels: () => { updatePlayers(); updateHand(); updateEffects(); },
    // Diagnostic: drive ball `num` at (power, angle) and run pure physics to rest
    // (no rules/respot), returning whether it pocketed and where it ended.
    simBall: (num, power, angle) => {
      const sm = makeSim(state);
      const ball = sm.find((b) => b.num === num);
      if (!ball) return { error: 'no such ball' };
      ball.vx = Math.cos(angle) * power * MAX_SHOT_SPEED;
      ball.vy = Math.sin(angle) * power * MAX_SHOT_SPEED;
      const turn = freshTurn();
      const env = { effects: state.activeEffects, pocketState: state.pocketState };
      let f = 0; while (step(sm, pocketsFor(state), 1, turn, env) && f < 6000) f++;
      syncToState(state, sm);
      const b2 = state.balls.find((b) => b.num === num);
      render();
      return { pocketed: !!b2.pocketed, restU: +b2.u.toFixed(3), restV: +b2.v.toFixed(3), frames: f };
    },
    // card-phase debug
    pick: () => pendingPick,
    queue: () => cardQueue.map((c) => ({ id: c.id, opts: c.opts, steps: c.steps.length })),
    cardPhaseActive: () => cardPhaseActive,
    playHand: (slot) => playHandCard(slot),
    clickRel: (u, v) => { const p = toPx({ u, v }, state.dims); if (pendingPick) resolvePick(p.x, p.y); else if (placingCue) placeCueAt(p.x, p.y); },
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
