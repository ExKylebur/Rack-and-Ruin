// app.js — application entry. Owns the single GameState, the setup flow, input,
// the shot loop, and rendering.
//
// Phase 1b: playable solo. Real ruleset (win/foul nuance), cards, audio and
// online are layered on in later phases. Turn handling here is intentionally
// simple: pot a ball to keep shooting, otherwise the turn passes; a scratch
// re-spots the cue and passes the turn.

import { createGameState, rackBalls } from './state.js';
import { fitCanvas, playArea, toPx, toRel, unitsFor } from './geometry.js';
import { drawTable } from './render/table.js';
import { drawBall } from './render/ball.js';
import { drawAim } from './render/aim.js';
import {
  makeSim, pocketsFor, freshTurn, applyShot, step, syncToState, commit,
} from './physics.js';

let canvas, ctx;
const state = createGameState();

// runtime (non-serialized) UI/loop flags
let controlMode = 'mouse';
let onlineMode = 'local';
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
  for (const b of state.balls) drawBall(ctx, b, state);
  const canAim = state.started && !state.gameOver && !ballsMoving && !placingCue && !!cuePx();
  if (canAim) drawAim(ctx, state, aimAngle, charging ? shotPower : 0);
  if (placingCue) drawCuePlacement();
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
  placingCue = false;
  ballsMoving = false;
  setSetupVisible(false);
  document.getElementById('overlay').classList.add('hidden');
  sizeCanvas();
  rackBalls(state);
  document.getElementById('shotBtn').classList.toggle('visible', controlMode === 'phone');
  setStatus(`${state.players[state.currentPlayer].name} to break`);
  updatePlayers();
  render();
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
    shotPower = Math.min((performance.now() - chargeStart) / 1500, 1);
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
  applyShot(sim, power, angle);
  state.turn = freshTurn();
  ballsMoving = true;
  lastPhysTime = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = Math.min((now - lastPhysTime) / 16.67, 3);
    lastPhysTime = now;
    let moving = false;
    const sub = 3;
    for (let i = 0; i < sub; i++) moving = step(sim, pocketsFor(state), dt / sub, state.turn);
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

// Simplified turn resolution (full ruleset comes in Phase 3).
function resolveShot() {
  const t = state.turn;
  const pottedObject = t.pocketed.filter((n) => n !== 0);
  if (t.cueScratched) {
    respotCue();
    placingCue = true;
    advancePlayer();
    setStatus(`Scratch — ${current().name}: drag the cue ball to place it, then shoot`);
  } else if (pottedObject.length > 0) {
    setStatus(`${current().name} pots ${pottedObject.join(', ')} — shoot again`);
  } else {
    advancePlayer();
    setStatus(`${current().name}'s turn`);
  }
  updatePlayers();
  render();
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
    if (placingCue) { render(); return; }
    updateAimFromPoint(pos.x, pos.y);
    render();
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!state.started || ballsMoving || e.button !== 0) return;
    const pos = canvasPos(e);
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
    // card/confirm overlays (Phase 2) — safe no-ops for now
    onCardPhaseDone: () => {}, onCardPhaseSkip: () => {},
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
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
