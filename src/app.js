// app.js — application entry. Owns the single GameState, the setup flow, input,
// the shot loop, and rendering.
//
// Phase 1b: playable solo. Real ruleset (win/foul nuance), cards, audio and
// online are layered on in later phases. Turn handling here is intentionally
// simple: pot a ball to keep shooting, otherwise the turn passes; a scratch
// re-spots the cue and passes the turn.

import { createGameState, rackBalls } from './state.js';
import { fitCanvas, playArea, pocketLayout, toPx, toRel, unitsFor } from './geometry.js';
import { drawTable } from './render/table.js';
import { drawBall } from './render/ball.js';
import { drawAim } from './render/aim.js';
import { drawEffects, drawPickHighlights } from './render/effects.js';
import {
  makeSim, pocketsFor, freshTurn, applyShot, step, syncToState, commit,
} from './physics.js';
import { CARD_POOL, cardById } from './cards/registry.js';
import { applyCard, clearBallEffects, decayTableEffects } from './cards/effects.js';

const MAX_HAND = 7;
const DRAW_PER_TURN = 3;
const PLAY_PER_TURN = 2;

let canvas, ctx;
const state = createGameState();

// runtime (non-serialized) UI/loop flags
let controlMode = 'mouse';
let onlineMode = 'local';
let cardsEnabled = true;
let ballsMoving = false;
let aimAngle = 0;
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
let cardSelected = [];      // card ids selected to play
let pendingPick = null;     // { type, prompt } currently awaited on the table
let cardQueue = [];         // [{ id, opts, steps:[...] }] being resolved
let cardPhaseDone = null;   // callback to run when the card phase + picks finish
let idleAnim = null;        // low-freq redraw for animated effects/picks

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
  drawEffects(ctx, state);
  for (const b of state.balls) drawBall(ctx, b, state);
  const e = state.activeEffects || {};
  const canAim = state.started && !state.gameOver && !ballsMoving && !placingCue
    && !cardPhaseActive && !pendingPick && !!cuePx();
  if (canAim && !e.shortsighted) {
    const sway = e.drunk ? Math.sin(performance.now() / 280) * 0.16 : 0; // Drunk: wobbly aim
    drawAim(ctx, state, aimAngle + sway, charging ? shotPower : 0);
  }
  if (placingCue) drawCuePlacement();
  if (pendingPick) drawPickHighlights(ctx, state, pendingPick);
}

// Low-frequency redraw so animated effects (portals, pick rings) move while idle.
function startIdleLoop() {
  if (idleAnim) return;
  const tick = () => {
    if (!state.started || state.gameOver) { idleAnim = null; return; }
    const e = state.activeEffects || {};
    const animated = pendingPick || (e.portals && e.portals.length) || (e.drunk && !ballsMoving);
    if (animated && !ballsMoving) render();
    idleAnim = requestAnimationFrame(tick);
  };
  idleAnim = requestAnimationFrame(tick);
}

function drawCuePlacement() {
  const cue = cuePx();
  if (!cue) return;
  const bad = overlapsAnyBall(cue.ball.u, cue.ball.v, cue.ball);
  ctx.save();
  ctx.strokeStyle = bad ? 'rgba(255,60,60,0.85)' : 'rgba(80,255,80,0.8)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
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
  cardsEnabled = document.getElementById('enableCards').checked;
  const names = ['p1name', 'p2name', 'p3name', 'p4name'].map((id, i) =>
    document.getElementById(id).value || `Player ${i + 1}`);
  const n = variantPlayerCount(state.variant);
  state.players = [];
  for (let i = 0; i < n; i++) state.players.push({ name: names[i], group: null, hand: [], seat: i });
  state.currentPlayer = 0;
  startGame();
}

function startGame() {
  state.started = true;
  state.gameOver = false;
  state.movedPockets = {};
  state.activeEffects = {};
  state.pocketState = {};
  state.warp = null;
  state.players.forEach((p) => { p.hand = []; });
  placingCue = false;
  ballsMoving = false;
  cardPhaseActive = false; pendingPick = null; cardSelected = []; cardQueue = [];
  document.getElementById('cardOverlay').classList.add('hidden');
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

function shoot(power, angle) {
  sim = makeSim(state);
  applyShot(sim, power, angle, state.activeEffects);
  state.turn = freshTurn();
  ballsMoving = true;
  lastPhysTime = performance.now();
  const env = { effects: state.activeEffects, pocketState: state.pocketState };
  const tick = () => {
    const now = performance.now();
    const dt = Math.min((now - lastPhysTime) / 16.67, 3);
    lastPhysTime = now;
    let moving = false;
    const sub = 3;
    for (let i = 0; i < sub; i++) moving = step(sim, pocketsFor(state), dt / sub, state.turn, env);
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

// Simplified turn resolution (full ruleset comes in Phase 3). On a lost turn the
// shooter gets a card phase to sabotage the incoming player, then play passes.
function resolveShot() {
  const t = state.turn;
  const pottedObject = t.pocketed.filter((n) => n !== 0);
  const shooter = state.currentPlayer;
  const keep = !t.cueScratched && pottedObject.length > 0;

  clearBallEffects(state); // ball/cue effects last exactly one shot
  if (t.cueScratched) respotCue();

  if (keep) {
    setStatus(`${current().name} pots ${pottedObject.join(', ')} — shoot again`);
    updatePlayers(); updateEffects(); render();
    return;
  }

  const proceed = () => {
    decayTableEffects(state);
    advancePlayer();
    if (t.cueScratched) { placingCue = true; setStatus(`Scratch — ${current().name}: place the cue ball, then shoot`); }
    else setStatus(`${current().name}'s turn`);
    updatePlayers(); updateEffects(); updateHand(); render();
  };

  if (cardsEnabled) beginCardPhase(shooter, proceed);
  else proceed();
}

function current() { return state.players[state.currentPlayer]; }
function advancePlayer() {
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
}

function respotCue() {
  const cue = state.balls.find((b) => b.num === 0);
  if (!cue) return;
  cue.pocketed = false;
  const pa = playArea(state.dims);
  const rel = toRel({ x: pa.left + pa.w * 0.25, y: pa.cy }, state.dims);
  cue.u = rel.u; cue.v = rel.v; cue.vx = 0; cue.vy = 0;
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
  const cue = state.balls.find((b) => b.num === 0);
  if (!cue) return;
  const pa = playArea(state.dims);
  const r = unitsFor(state.dims).ballR * (cue.size || 1);
  const x = Math.max(pa.left + r, Math.min(pa.right - r, px));
  const y = Math.max(pa.top + r, Math.min(pa.bottom - r, py));
  const rel = toRel({ x, y }, state.dims);
  if (overlapsAnyBall(rel.u, rel.v, cue)) { showToast("Can't place there"); return; }
  cue.u = rel.u; cue.v = rel.v;
  placingCue = false;
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
  const ball = CARD_POOL.filter((c) => c.type === 'ball');
  const table = CARD_POOL.filter((c) => c.type === 'table');
  if (toDraw >= 2) { drawn.push(ball[Math.floor(Math.random() * ball.length)].id); drawn.push(table[Math.floor(Math.random() * table.length)].id); }
  while (drawn.length < toDraw) drawn.push(CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)].id);
  shuffle(drawn);
  for (const id of drawn) if (player.hand.length < MAX_HAND) player.hand.push(id);
  return drawn;
}

function beginCardPhase(playerIdx, onDone) {
  cardPhaseDone = onDone;
  state.cardPhasePlayer = playerIdx;
  const player = state.players[playerIdx];
  const drawn = drawCards(player);
  if (!player.hand.length) { state.cardPhasePlayer = null; cardPhaseDone = null; onDone(); return; }
  cardPhaseActive = true; cardSelected = [];
  document.getElementById('cardPhasePlayerName').textContent = player.name;
  document.getElementById('cardPlayLimit').textContent = PLAY_PER_TURN;
  document.getElementById('cardDrawInfo').textContent = drawn.length ? `Drew ${drawn.map((id) => cardById(id).name).join(', ')}.` : '';
  buildCardGrid(player.hand);
  document.getElementById('cardOverlay').classList.remove('hidden');
}

function buildCardGrid(hand) {
  const grid = document.getElementById('cardPickGrid');
  grid.innerHTML = '';
  hand.forEach((id, i) => {
    const c = cardById(id);
    const div = document.createElement('div');
    div.className = 'card-pick-item';
    div.dataset.idx = i;
    div.innerHTML = `<div class="cpicon">${c.icon || ''}</div><div class="cpname">${c.name}</div>`
      + `<div class="cpdesc">${c.desc}</div><div class="cptag">${c.type}</div>`;
    div.addEventListener('click', () => {
      const sel = div.classList.contains('selected');
      if (sel) { div.classList.remove('selected'); cardSelected.splice(cardSelected.indexOf(i), 1); }
      else if (cardSelected.length < PLAY_PER_TURN) { div.classList.add('selected'); cardSelected.push(i); }
    });
    grid.appendChild(div);
  });
}

function onCardPhaseDone() {
  document.getElementById('cardOverlay').classList.add('hidden');
  cardPhaseActive = false;
  const player = state.players[state.cardPhasePlayer];
  // resolve selected hand indices to ids, remove from hand (high->low to keep indices valid)
  const ids = cardSelected.map((i) => player.hand[i]).filter(Boolean);
  cardSelected.slice().sort((a, b) => b - a).forEach((i) => player.hand.splice(i, 1));
  cardSelected = [];
  cardQueue = ids.map((id) => ({ id, opts: {}, steps: [...(cardById(id).interactions || [])] }));
  updateHand();
  processCardQueue();
}

function onCardPhaseSkip() {
  document.getElementById('cardOverlay').classList.add('hidden');
  cardPhaseActive = false; cardSelected = [];
  finishCardPhase();
}

function processCardQueue() {
  if (!cardQueue.length) { finishCardPhase(); return; }
  const item = cardQueue[0];
  if (item.steps.length) {
    const s = item.steps[0];
    pendingPick = { type: s.type, prompt: s.prompt, cardId: item.id };
    setStatus(`${state.players[state.cardPhasePlayer].name}: ${s.prompt}`);
    render();
  } else {
    applyCard(state, item.id, item.opts);
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
      else if (item.id === 'move_hole' && item.opts.pocket !== undefined) item.opts.to = rel;
      else item.opts.pos = rel;
      ok = true;
    }
  }
  if (!ok) return;
  item.steps.shift();
  pendingPick = null;
  processCardQueue();
}

function finishCardPhase() {
  pendingPick = null; cardQueue = [];
  const done = cardPhaseDone; cardPhaseDone = null;
  state.cardPhasePlayer = null;
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
    if (placingCue || pendingPick) { render(); return; }
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
    if (pendingPick) { resolvePick(pos.x, pos.y); return; }
    if (placingCue) { placeCueAt(pos.x, pos.y); return; }
    phoneDragStart = pos; phoneDragging = false;
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (!state.started || ballsMoving || !phoneDragStart) return;
    e.preventDefault();
    const pos = canvasPos(e.touches[0]);
    if (Math.hypot(pos.x - phoneDragStart.x, pos.y - phoneDragStart.y) > 4) phoneDragging = true;
    if (phoneDragging) { updateAimFromPoint(pos.x, pos.y); render(); }
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => { e.preventDefault(); phoneDragStart = null; }, { passive: false });

  const shotBtn = document.getElementById('shotBtn');
  shotBtn.addEventListener('pointerdown', () => { if (controlMode === 'phone') { shotBtn.classList.add('charging'); beginCharge(); } });
  shotBtn.addEventListener('pointerup', () => { shotBtn.classList.remove('charging'); releaseCharge(); });
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

function updatePlayers() {
  const el = document.getElementById('playerInfo');
  el.innerHTML = '';
  const swatch = ['#ffd700', '#4a9eff', '#ff6b6b', '#4aff4a'];
  state.players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'player-row' + (i === state.currentPlayer ? ' active-turn' : '');
    row.innerHTML = `<div class="player-swatch" style="background:${swatch[i] || '#888'}"></div>`
      + `<div class="player-name">${p.name}${p.group ? ` (${p.group})` : ''}</div>`
      + '<div class="player-score"></div>';
    el.appendChild(row);
  });
}

function updateHand() {
  const el = document.getElementById('handArea');
  const p = state.players[state.currentPlayer];
  if (!p || !p.hand.length) { el.innerHTML = '<span style="font-size:11px;color:#555">No cards</span>'; return; }
  el.innerHTML = '';
  p.hand.forEach((id) => {
    const c = cardById(id); if (!c) return;
    const div = document.createElement('div');
    div.className = 'card-item';
    div.innerHTML = `<div class="card-name">${c.icon || ''} ${c.name}</div><div class="card-desc">${c.desc}</div>`;
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
  if (state.warp) chips.push('🌊 Warp');
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

// ===================== BOOT =====================
function boot() {
  canvas = document.getElementById('tableCanvas');
  ctx = canvas.getContext('2d');
  sizeCanvas();
  wireInput();
  updateGuide();
  setSetupVisible(true);
  render();

  document.getElementById('variantSelect').addEventListener('change', onVariantChange);
  document.getElementById('newGameBtn').addEventListener('click', onNewGame);
  window.addEventListener('resize', () => { sizeCanvas(); render(); });

  // inline-onclick handlers used by PLAY ME.html
  Object.assign(window, {
    onRackUp, onNewGame, setControlMode, setOnlineMode,
    onCreateRoom: () => showToast('Online play arrives in a later update.'),
    onJoinRoom: () => showToast('Online play arrives in a later update.'),
    copyInvite: () => {},
    onCardPhaseDone, onCardPhaseSkip,
    onConfirmYes: () => {}, onConfirmNo: () => {},
  });

  // dev hooks
  window.RR = {
    state, render,
    start: onRackUp,
    shoot: (power, angle) => { aimAngle = angle; shoot(power, angle); },
    isMoving: () => ballsMoving,
    moveHole(i, u, v) { state.movedPockets[i] = { u, v }; render(); },
    setSize(num, size) { const b = state.balls.find((x) => x.num === num); if (b) { b.size = size; render(); } },
    // card-phase debug
    pick: () => pendingPick,
    queue: () => cardQueue.map((c) => ({ id: c.id, opts: c.opts, steps: c.steps.length })),
    cardPhaseActive: () => cardPhaseActive,
    selected: () => cardSelected.slice(),
    clickRel: (u, v) => { const p = toPx({ u, v }, state.dims); if (pendingPick) resolvePick(p.x, p.y); else if (placingCue) placeCueAt(p.x, p.y); },
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
