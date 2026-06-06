// Rack & Ruin - Core Game Logic
// Physics, turn flow, rulesets, cards, online sync, UI wiring

'use strict';

// ===================== CONSTANTS =====================
const BALL_R = 11;
const FRICTION = 0.986;
const WALL_DAMP = 0.72;   // energy retained per rail bounce
const MIN_SPEED = 0.04;
const MAX_SHOT_POWER = 38;
const MAX_HAND_CARDS = 7;
const AUTO_DRAW_CARDS_PER_TURN = 3;
const PLAY_CARDS_PER_TURN = 2;
const POCKET_PULL_RADIUS = 1.12; // multiplier of pocket radius (physics vs visual)

// Ball colors: index = ball number (0=cue, 1-7 solid, 8=black, 9-15 stripe)
const BALL_COLORS = [
  '#f4f4f4', // 0 cue
  '#f9d03f', // 1 yellow
  '#2563eb', // 2 blue
  '#dc2626', // 3 red
  '#7e22ce', // 4 purple
  '#ea580c', // 5 orange
  '#16a34a', // 6 green
  '#7f1d1d', // 7 maroon
  '#111111', // 8 black
  '#f9d03f', // 9 yellow stripe
  '#2563eb', // 10 blue stripe
  '#dc2626', // 11 red stripe
  '#7e22ce', // 12 purple stripe
  '#ea580c', // 13 orange stripe
  '#16a34a', // 14 green stripe
  '#7f1d1d', // 15 maroon stripe
];

// ===================== STATE =====================
let canvas, ctx;
let W, H, CUSHION_W, POCKET_R;
let balls = [];
let pockets = [];
let players = [];
let currentPlayer = 0;
let variant = 'eight';
let controlMode = 'mouse';
let onlineMode = 'local';
let gameStarted = false;
let cardsEnabled = true;
let debugCardMode = false;
let gameOver = false;
let shooting = false;
let ballsMoving = false;
let aimAngle = 0;
let shotPower = 0;
let charging = false;
let chargeStart = 0;
let phoneDragStart = null;
let phoneDragging = false;
let lastMousePos = { x: 0, y: 0 };

// Turn state
let turnHitOwnBall = false;
let turnPocketedBalls = [];
let turnFoul = false;
let cueBallPlacement = false;
let firstHitBall = null;

// Effects
let activeEffects = {};
let interactionQueue = [];
let pendingInteraction = null;
let confirmCallback = null;
let dontShowAgainKeys = new Set();

// Card phase state
let cardPhaseActive = false;
let cardPhaseCards = [];
let cardPhaseSelected = [];
let cardPhaseDrawn = [];

// Online
let onlineRoom = null;
let onlineToken = null;
let onlinePlayerIdx = -1;
let onlinePolling = false;
let onlineSnapshotVersion = 0;
let onlineApiBase = '';

// Animation
let animFrame = null;
let lastRenderTime = 0;

// ===================== CARD POOL =====================
const CARD_POOL = [
  // Ball-effect cards
  { id: 'fog_of_war',   name: 'Fog of War',    icon: '🌫️', type: 'ball',  desc: 'Only the aim line to the first object ball is shown.',              fn: applyFogOfWar },
  { id: 'heavyweight',  name: 'Heavyweight',   icon: '🏋️', type: 'ball',  desc: 'Pick a ball — it behaves like a much heavier object.',               fn: applyHeavyweight, needsBallPick: true },
  { id: 'lightweight',  name: 'Lightweight',   icon: '🪶',  type: 'ball',  desc: 'Pick a ball — it behaves like a much lighter object.',               fn: applyLightweight, needsBallPick: true },
  { id: 'confusion',    name: 'Confusion',     icon: '🔀', type: 'ball',  desc: 'Pick a ball — it is disguised and flips stripe/solid appearance.',   fn: applyConfusion, needsBallPick: true },
  { id: 'cloak',        name: 'Cloak',         icon: '👻', type: 'ball',  desc: 'Pick a ball — it becomes invisible to your opponent.',               fn: applyCloak, needsBallPick: true },
  { id: 'sticky',       name: 'Sticky',        icon: '🍯', type: 'ball',  desc: 'Cue ball briefly drags the first ball it contacts.',                 fn: applySticky },
  { id: 'drunk',        name: 'Drunk',         icon: '🍺', type: 'ball',  desc: 'Aim line and shot direction wobble ±15° continuously.',              fn: applyDrunk },
  { id: 'shortsighted', name: 'Shortsighted',  icon: '🔭', type: 'ball',  desc: 'No aim guide line or ghost ball shown.',                             fn: applyShortsighted },
  { id: 'roid_rage',    name: 'Roid Rage',     icon: '💢', type: 'ball',  desc: 'Power surges — can never be below 75% this turn.',                  fn: applyRoidRage },
  { id: 'cool_hands',   name: 'Cool Hands',    icon: '🧊', type: 'ball',  desc: 'Power is capped at 25% for this turn.',                             fn: applyCoolHands },
  { id: 'big_ball',     name: 'Big Ball',      icon: '🔵', type: 'ball',  desc: 'Cue ball is 2× normal size — wider hits, more force.',              fn: applyBigBall },
  { id: 'small_ball',   name: 'Small Ball',    icon: '⚬',  type: 'ball',  desc: 'Cue ball is half normal size — weaker, easier to miss.',            fn: applySmallBall },
  { id: 'oil_cue',      name: 'Oil Cue',       icon: '💧', type: 'ball',  desc: 'Cue ball slides further — backspin barely works.',                  fn: applyOilCue },
  { id: 'reverse_spin', name: 'Reverse Spin',  icon: '↩️', type: 'ball',  desc: 'Cue ball English is flipped on contact this turn.',                 fn: applyReverseSpin },
  { id: 'mirror',       name: 'Mirror',        icon: '🪞', type: 'ball',  desc: 'All object balls appear mirrored left-right this turn.',             fn: applyMirror },
  { id: 'magnet',       name: 'Magnet',        icon: '🧲', type: 'ball',  desc: 'All moving balls are pulled slightly toward nearest pocket.',        fn: applyMagnet },
  { id: 'turbo',        name: 'Turbo',         icon: '⚡', type: 'ball',  desc: 'Shot speed is multiplied 1.6× — hard to control.',                  fn: applyTurbo },
  // Table-effect cards
  { id: 'bouncer',      name: 'Bouncer',       icon: '🔴', type: 'table', desc: 'Place a rubber bumper anywhere — you choose the spot.',              fn: applyBouncer, needsTablePlace: true },
  { id: 'bounce_house', name: 'Bounce House',  icon: '🎪', type: 'table', desc: 'Pick a rail — it becomes a rubber band (2.2× bounce).',             fn: applyBounceHouse, needsRailPick: true },
  { id: 'dead_rail',    name: 'Dead Rail',     icon: '🪵', type: 'table', desc: 'Pick a rail — balls barely rebound (0.1× damping).',                fn: applyDeadRail, needsRailPick: true },
  { id: 'bear_trap',    name: 'Bear Trap',     icon: '🪤', type: 'table', desc: 'Place an invisible trap — any ball touching it stops dead.',         fn: applyBearTrap, needsTablePlace: true },
  { id: 'portal',       name: 'Portal',        icon: '🌀', type: 'table', desc: 'Place 2 portals — balls entering one exit the other.',              fn: applyPortal, needsTablePlace: true, placeCount: 2 },
  { id: 'ice_patch',    name: 'Ice Patch',     icon: '🧊', type: 'table', desc: 'Place a frictionless zone anywhere on the table interior.',          fn: applyIcePatch, needsTablePlace: true },
  { id: 'block_pocket', name: 'Block Pocket',  icon: '🚫', type: 'table', desc: 'Seal one pocket — balls bounce off instead of dropping.',           fn: applyBlockPocket, needsPocketPick: true },
  { id: 'open_pocket',  name: 'Open Pocket',   icon: '✅', type: 'table', desc: 'Re-open a previously blocked pocket.',                              fn: applyOpenPocket, needsPocketPick: true },
  { id: 'move_hole',    name: 'Move Hole',     icon: '📍', type: 'table', desc: 'Drag any pocket to a new position on the table.',                   fn: applyMoveHole, needsMoveHole: true },
  { id: 'warp_rail',    name: 'Warp Rail',     icon: '🌊', type: 'table', desc: 'Pick a pocket, then warp the table rails around it.',               fn: applyWarpRail, needsPocketPick: true },
  { id: 'mud_patch',    name: 'Mud Patch',     icon: '💩', type: 'table', desc: 'Place a sticky zone — balls slow sharply when passing through.',    fn: applyMudPatch, needsTablePlace: true },
  { id: 'crosswind',    name: 'Crosswind',     icon: '💨', type: 'table', desc: 'A permanent sideways drift nudges all balls.',                      fn: applyCrosswind },
  { id: 'pocket_shrink',name: 'Pocket Shrink', icon: '🔩', type: 'table', desc: 'Pick a pocket — it shrinks to 65% of normal size.',                 fn: applyPocketShrink, needsPocketPick: true },
  { id: 'earthquake',   name: 'Earthquake',    icon: '🌋', type: 'table', desc: 'All stationary balls are nudged to random new positions.',           fn: applyEarthquake },
];

// ===================== INIT =====================
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('tableCanvas');
  ctx = canvas.getContext('2d');

  // Unlock audio context on first user gesture
  document.addEventListener('pointerdown', () => {
    if (window.RRAudio) window.RRAudio.unlockFromGesture();
  }, { once: true });

  setupCanvasSize();
  window.addEventListener('resize', () => { setupCanvasSize(); if (gameStarted) renderFrame(); });

  setupMouseEvents();
  setupTouchEvents();
  setupButtonHandlers();

  updateGuideCopy();
  setSetupOverlayVisible(true);
  renderFrame();

  // Check for online invite in URL
  const params = new URLSearchParams(window.location.search);
  if (params.get('room')) {
    document.getElementById('roomCodeInput').value = params.get('room').toUpperCase();
    if (params.get('server')) document.getElementById('serverUrlInput').value = params.get('server');
    setOnlineMode('online');
  }
});

function setupCanvasSize() {
  const centerArea = document.getElementById('centerArea');
  const rect = centerArea.getBoundingClientRect();
  const aspect = 2.0;
  let cw = rect.width - 4, ch = rect.height - 4;
  if (cw / ch > aspect) cw = ch * aspect;
  else ch = cw / aspect;
  cw = Math.floor(cw); ch = Math.floor(ch);
  canvas.width = cw; canvas.height = ch;
  W = cw; H = ch;
  CUSHION_W = Math.round(W * 0.055);
  // Pocket radius ≈ 2× ball radius, matching real 4.5" pocket / 2.25" ball ratio
  POCKET_R = Math.round(BALL_R * 2.0);
  if (gameStarted) { repositionPockets(); }
}

function setupButtonHandlers() {
  document.getElementById('debugToggle').addEventListener('click', () => {
    debugCardMode = !debugCardMode;
    document.getElementById('debugToggle').classList.toggle('active', debugCardMode);
  });
  document.getElementById('newGameBtn').addEventListener('click', onNewGame);
}

// ===================== SETUP / GAME START =====================
function setSetupOverlayVisible(show) {
  const el = document.getElementById('setupOverlay');
  el.classList.toggle('show', show);
}

function setControlMode(mode) {
  controlMode = mode;
  document.getElementById('modeMouseBtn').classList.toggle('active', mode === 'mouse');
  document.getElementById('modePhoneBtn').classList.toggle('active', mode === 'phone');
  document.getElementById('shotBtn').classList.toggle('visible', mode === 'phone' && gameStarted);
}

function setOnlineMode(mode) {
  onlineMode = mode;
  document.getElementById('modeLocalBtn').classList.toggle('active', mode === 'local');
  document.getElementById('modeOnlineBtn').classList.toggle('active', mode === 'online');
  const onlineSection = document.getElementById('onlineSetupSection');
  onlineSection.style.display = mode === 'online' ? 'flex' : 'none';
  // Online constrains to 2 players, blocks cutthroat/doubles
  if (mode === 'online') {
    const vs = document.getElementById('variantSelect');
    if (vs.value === 'cutthroat' || vs.value === 'doubles') vs.value = 'eight';
    vs.querySelectorAll('option').forEach(o => {
      o.disabled = (mode === 'online' && (o.value === 'cutthroat' || o.value === 'doubles'));
    });
  } else {
    document.getElementById('variantSelect').querySelectorAll('option').forEach(o => o.disabled = false);
  }
}

function onRackUp() {
  variant = document.getElementById('variantSelect').value;
  controlMode = document.getElementById('modeMouseBtn').classList.contains('active') ? 'mouse' : 'phone';
  cardsEnabled = document.getElementById('enableCards').checked;

  const names = [
    document.getElementById('p1name').value || 'Player 1',
    document.getElementById('p2name').value || 'Player 2',
    document.getElementById('p3name').value || 'Player 3',
    document.getElementById('p4name').value || 'Player 4',
  ];

  const pCount = variant === 'cutthroat' ? 3 : (variant === 'doubles' ? 4 : 2);
  players = [];
  for (let i = 0; i < pCount; i++) {
    players.push({ name: names[i], score: 0, hand: [], group: null, turnsLeft: 1 });
  }

  if (onlineMode === 'online' && !onlineRoom) {
    showToast('Please create or join a room first.');
    return;
  }

  startGame();
}

function startGame() {
  gameOver = false;
  gameStarted = true;
  setSetupOverlayVisible(false);
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('cardOverlay').classList.add('hidden');

  activeEffects = {};
  interactionQueue = [];
  pendingInteraction = null;
  currentPlayer = 0;
  turnPocketedBalls = [];
  turnFoul = false;
  turnHitOwnBall = false;
  firstHitBall = null;
  cueBallPlacement = false;
  ballsMoving = false;
  shooting = false;
  cardPhaseActive = false;

  initPockets();
  rackBalls();
  updatePlayerUI();
  updateStatusMsg(players[currentPlayer].name + "'s turn — break!");
  if (controlMode === 'phone') document.getElementById('shotBtn').classList.add('visible');
  renderFrame();
  startIdleLoop();
}

// Low-frequency idle render loop for animated overlays (portals, drunk sway, etc.)
function startIdleLoop() {
  if (animFrame) return;
  function tick() {
    if (!gameStarted || gameOver) { animFrame = null; return; }
    // Only redraw when there are animated effects active
    const needsAnim = (activeEffects.portals && activeEffects.portals.length > 0)
      || activeEffects.drunk
      || activeEffects.bouncer
      || (activeEffects.bearTrapRevealUntil && performance.now() < activeEffects.bearTrapRevealUntil)
      || pendingInteraction;
    if (needsAnim && !ballsMoving) renderFrame();
    animFrame = requestAnimationFrame(tick);
  }
  animFrame = requestAnimationFrame(tick);
}

function onNewGame() {
  document.getElementById('overlay').classList.add('hidden');
  setSetupOverlayVisible(true);
  updateGuideCopy();
}

// ===================== POCKETS =====================
function pocketDefaults() {
  // Positions match exactly where drawTableLayer renders the pocket circles:
  //   corners at (rail, rail) corners, sides at (W/2, rail)
  const cw = CUSHION_W;
  const pr = POCKET_R || Math.round(BALL_R * 2.0);
  // Side pockets are ~12% larger than corners (real table: 5" vs 4.5")
  const prSide = Math.round(pr * 1.12);
  return [
    { x: cw,     y: cw,     r: pr,     label: 'TL' },
    { x: W / 2,  y: cw,     r: prSide, label: 'TM' },
    { x: W - cw, y: cw,     r: pr,     label: 'TR' },
    { x: cw,     y: H - cw, r: pr,     label: 'BL' },
    { x: W / 2,  y: H - cw, r: prSide, label: 'BM' },
    { x: W - cw, y: H - cw, r: pr,     label: 'BR' },
  ];
}

function initPockets() {
  pockets = pocketDefaults().map(d => ({
    x: d.x, y: d.y, r: d.r,
    origX: d.x, origY: d.y,
  }));
}

function repositionPockets() {
  if (!pockets.length) { initPockets(); return; }
  const defaults = pocketDefaults();
  pockets.forEach((p, i) => {
    p.origX = defaults[i].x; p.origY = defaults[i].y;
    if (!p.moved) { p.x = defaults[i].x; p.y = defaults[i].y; }
    p.r = defaults[i].r;
  });
}

// ===================== BALL SETUP =====================
function rackBalls() {
  balls = [];
  const play = getPlayArea();
  const cueX = play.left + play.w * 0.25;
  const cueY = play.cy;
  const headX = play.left + play.w * 0.65;

  // Cue ball
  balls.push(mkBall(0, cueX, cueY));

  if (variant === 'nine') {
    rackNineBall(headX, play.cy);
  } else {
    rackEightBall(headX, play.cy);
  }
}

function mkBall(num, x, y) {
  return {
    num, x, y,
    vx: 0, vy: 0,
    r: BALL_R,
    c: BALL_COLORS[num] || '#cccccc',
    stripe: num >= 9 && num <= 15,
    roll: 0,
    pocketed: false,
  };
}

function rackEightBall(hx, hy) {
  const nums = getEightBallRackNumbers();
  const rows = [1, 2, 3, 4, 5];
  const spacing = BALL_R * 2.05;
  let idx = 0;
  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col <= row; col++) {
      const x = hx + row * spacing * Math.cos(Math.PI / 6);
      const y = hy + (col - row / 2) * spacing;
      balls.push(mkBall(nums[idx++], x, y));
    }
  }
}

function getEightBallRackNumbers() {
  const solids = [1,2,3,4,5,6,7];
  const stripes = [9,10,11,12,13,14,15];
  const shuffle = (a) => { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
  const sS = shuffle([...solids]), sT = shuffle([...stripes]);
  // Positions: [0]=apex(1-ball), [4]=8-ball(center), [10]=bl corner solid, [14]=br corner stripe (or vice versa)
  const rack = Array(15).fill(0);
  rack[0] = 1; // apex = 1-ball
  rack[4] = 8; // center = 8-ball
  // rear corners: one solid, one stripe
  const cornerSolid = sS.find(n => n !== 1);
  const cornerStripe = sT[0];
  rack[10] = cornerSolid;
  rack[14] = cornerStripe;
  const usedSolids = new Set([1, cornerSolid]);
  const usedStripes = new Set([cornerStripe]);
  const remSolids = solids.filter(n => !usedSolids.has(n));
  const remStripes = stripes.filter(n => !usedStripes.has(n));
  const remaining = shuffle([...remSolids, ...remStripes]);
  let ri = 0;
  for (let i = 0; i < 15; i++) {
    if (rack[i] === 0) rack[i] = remaining[ri++];
  }
  return rack;
}

function rackNineBall(hx, hy) {
  const positions = [
    [0, 0], [-1, -1], [-1, 1], [-2, -2], [-2, 0], [-2, 2], [-3, -1], [-3, 1], [-4, 0]
  ];
  const spacing = BALL_R * 2.05;
  const nums = [1,2,3,4,5,6,7,8,9];
  const shuffle = (a) => { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
  const inner = shuffle([2,3,4,5,6,7,8]);
  const order = [1, ...inner, 9];
  positions.forEach(([col, row], i) => {
    balls.push(mkBall(order[i], hx + col * spacing * Math.cos(Math.PI/6) * (-1), hy + row * spacing * 0.5));
  });
}

function getPlayArea() {
  const cw = CUSHION_W;
  return { left: cw, top: cw, right: W - cw, bottom: H - cw, w: W - cw * 2, h: H - cw * 2, cx: W / 2, cy: H / 2 };
}

// ===================== PHYSICS =====================
function physicsStep(dt) {
  const play = getPlayArea();
  let anyMoving = false;

  // Apply card-based forces
  applyActiveForces(dt);

  for (const b of balls) {
    if (b.pocketed) continue;
    if (Math.abs(b.vx) > MIN_SPEED || Math.abs(b.vy) > MIN_SPEED) anyMoving = true;

    // Ice patch: reduce friction
    let friction = FRICTION;
    if (activeEffects.icePatch) {
      const ip = activeEffects.icePatch;
      const dx = b.x - ip.x, dy = b.y - ip.y;
      if (dx*dx+dy*dy < ip.r*ip.r) friction = 0.9995;
    }
    // Mud patch: increase friction
    if (activeEffects.mudPatch) {
      const mp = activeEffects.mudPatch;
      const dx = b.x - mp.x, dy = b.y - mp.y;
      if (dx*dx+dy*dy < mp.r*mp.r) friction = 0.92;
    }
    // Oil cue: cue ball slides much further
    if (b.num === 0 && activeEffects.oilCue) friction = Math.max(friction, 0.9985);
    // Drunk cue ball
    if (b.num === 0 && activeEffects.drunk) {
      b.vx += (Math.random()-0.5) * 0.3;
      b.vy += (Math.random()-0.5) * 0.3;
    }

    const fr = Math.pow(friction, dt);
    b.vx *= fr;
    b.vy *= fr;

    // Update visual roll angle for renderer
    const spd = Math.hypot(b.vx, b.vy);
    if (spd > MIN_SPEED) {
      b.roll = ((b.roll || 0) + spd * dt * 0.05) % (Math.PI * 2);
    }

    if (Math.abs(b.vx) < MIN_SPEED && Math.abs(b.vy) < MIN_SPEED) {
      b.vx = 0; b.vy = 0;
    } else {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    // Crosswind
    if (activeEffects.crosswind) {
      b.x += activeEffects.crosswind * 0.3 * dt;
    }

    // Rail collisions
    handleRailCollision(b, play);

    // Pocket check
    checkPocket(b);
  }

  // Ball-ball collisions
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], b2 = balls[j];
      if (a.pocketed || b2.pocketed) continue;
      resolveBallCollision(a, b2);
    }
  }

  return anyMoving;
}

function getWallDamp(rail) {
  if (activeEffects.bounceHouseRail && activeEffects.bounceHouseRail.includes(rail)) return WALL_DAMP * 2.2;
  if (activeEffects.deadRail && activeEffects.deadRail.includes(rail)) return 0.10;
  return WALL_DAMP;
}

function getRailKind(rail) {
  if (activeEffects.bounceHouseRail && activeEffects.bounceHouseRail.includes(rail)) return 'bounce_house';
  if (activeEffects.deadRail && activeEffects.deadRail.includes(rail)) return 'dead_rail';
  return 'normal';
}

function handleRailCollision(b, play) {
  const tangDamp = 0.96;

  if (activeEffects.warpCorners) {
    handleWarpedRailCollision(b, play, 1.0);
    return;
  }

  if (b.x - b.r < play.left) {
    b.x = play.left + b.r;
    const damp = getWallDamp('left');
    b.vx = Math.abs(b.vx) * damp;
    b.vy *= tangDamp;
    SFX.railHit(Math.min(Math.abs(b.vx) / 8, 1), getRailKind('left'));
  }
  if (b.x + b.r > play.right) {
    b.x = play.right - b.r;
    const damp = getWallDamp('right');
    b.vx = -Math.abs(b.vx) * damp;
    b.vy *= tangDamp;
    SFX.railHit(Math.min(Math.abs(b.vx) / 8, 1), getRailKind('right'));
  }
  if (b.y - b.r < play.top) {
    b.y = play.top + b.r;
    const damp = getWallDamp('top');
    b.vy = Math.abs(b.vy) * damp;
    b.vx *= tangDamp;
    SFX.railHit(Math.min(Math.abs(b.vy) / 8, 1), getRailKind('top'));
  }
  if (b.y + b.r > play.bottom) {
    b.y = play.bottom - b.r;
    const damp = getWallDamp('bottom');
    b.vy = -Math.abs(b.vy) * damp;
    b.vx *= tangDamp;
    SFX.railHit(Math.min(Math.abs(b.vy) / 8, 1), getRailKind('bottom'));
  }
}

function handleWarpedRailCollision(b, play, _unused) {
  // Simplified warp: use bounding rect of warp corners
  const corners = activeEffects.warpCorners;
  const minX = Math.min(corners[0].x, corners[3].x) + b.r;
  const maxX = Math.max(corners[1].x, corners[2].x) - b.r;
  const minY = Math.min(corners[0].y, corners[1].y) + b.r;
  const maxY = Math.max(corners[2].y, corners[3].y) - b.r;
  if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx) * WALL_DAMP; SFX.railHit(Math.min(Math.abs(b.vx)/8,1),'normal'); }
  if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * WALL_DAMP; SFX.railHit(Math.min(Math.abs(b.vx)/8,1),'normal'); }
  if (b.y < minY) { b.y = minY; b.vy = Math.abs(b.vy) * WALL_DAMP; SFX.railHit(Math.min(Math.abs(b.vy)/8,1),'normal'); }
  if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * WALL_DAMP; SFX.railHit(Math.min(Math.abs(b.vy)/8,1),'normal'); }
}

function resolveBallCollision(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const minDist = a.r + b.r;
  if (dist >= minDist || dist < 0.001) return;

  const nx = dx / dist, ny = dy / dist;
  const overlap = minDist - dist;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
  const dot = dvx * nx + dvy * ny;
  if (dot <= 0) return;

  const massA = a.heavyweight ? 3 : (a.lightweight ? 0.3 : 1);
  const massB = b.heavyweight ? 3 : (b.lightweight ? 0.3 : 1);
  const totalMass = massA + massB;
  const impulse = 2 * dot / totalMass;

  // Reverse spin: applied on cue ball contact (v1: activeEffects.reverseSpin)
  const cueIsA = a.num === 0, cueIsB = b.num === 0;
  const revA = (a.reverseSpin || (cueIsA && activeEffects.reverseSpin)) ? -1 : 1;
  const revB = (b.reverseSpin || (cueIsB && activeEffects.reverseSpin)) ? -1 : 1;

  a.vx = (a.vx - impulse * massB * nx) * revA;
  a.vy = (a.vy - impulse * massB * ny) * revA;
  b.vx = (b.vx + impulse * massA * nx) * revB;
  b.vy = (b.vy + impulse * massA * ny) * revB;

  // Sticky cue ball: drags first object ball it hits (v1 behavior)
  if (activeEffects.sticky && (cueIsA || cueIsB)) {
    const cue = cueIsA ? a : b;
    const obj = cueIsA ? b : a;
    if (!cue._stuck) {
      cue._stuck = true;
      const drag = 0.35;
      cue.vx = cue.vx * (1 - drag) + obj.vx * drag;
      cue.vy = cue.vy * (1 - drag) + obj.vy * drag;
    }
  }

  // Track first hit for turn resolution
  if (!firstHitBall) {
    if (a.num === 0) firstHitBall = b.num;
    else if (b.num === 0) firstHitBall = a.num;
  }

  const speed = Math.abs(dot);
  SFX.ballHit(Math.min(speed / 10, 1));
}

function checkPocket(b) {
  for (let pi = 0; pi < pockets.length; pi++) {
    const p = pockets[pi];
    if (activeEffects.blockedPockets && activeEffects.blockedPockets.includes(pi)) continue;
    const dx = b.x - p.x, dy = b.y - p.y;
    const pr = p.r * POCKET_PULL_RADIUS;
    const shrunk = activeEffects.shrunkPockets && activeEffects.shrunkPockets.includes(pi);
    const open = activeEffects.openPockets && activeEffects.openPockets.includes(pi);
    const effR = shrunk ? pr * 0.65 : (open ? pr * 1.3 : pr);
    if (dx*dx + dy*dy < effR * effR) {
      // Portal
      if (activeEffects.portals && activeEffects.portals.length >= 2) {
        const other = activeEffects.portals.find(pp => Math.abs(pp.x-p.x)>10 || Math.abs(pp.y-p.y)>10);
        if (other) {
          b.x = other.x; b.y = other.y;
          const spd = Math.sqrt(b.vx*b.vx+b.vy*b.vy);
          const ang = Math.random() * Math.PI * 2;
          b.vx = Math.cos(ang) * spd; b.vy = Math.sin(ang) * spd;
          SFX.cardPlayed('portal');
          return;
        }
      }
      pocketBall(b, pi);
      return;
    }
  }
}

function pocketBall(b, pocketIdx) {
  b.pocketed = true;
  b.vx = 0; b.vy = 0;
  turnPocketedBalls.push({ num: b.num, pocket: pocketIdx });
  const kind = b.num === 0 ? 'scratch' : 'legal';
  SFX.pocket(kind);
}

function applyActiveForces(dt) {
  for (const b of balls) {
    if (b.pocketed) continue;

    // Pocket magnet: pull moving balls toward nearest pocket
    if (activeEffects.magnet) {
      const spd = Math.hypot(b.vx, b.vy);
      if (spd > 0.5) {
        let nearestD = 9999, npx = 0, npy = 0;
        pockets.forEach(pk => {
          const d = Math.hypot(b.x - pk.x, b.y - pk.y);
          if (d < nearestD) { nearestD = d; npx = pk.x; npy = pk.y; }
        });
        if (nearestD < 150 && nearestD > 1e-4) {
          b.vx += (npx - b.x) / nearestD * 0.04;
          b.vy += (npy - b.y) / nearestD * 0.04;
        }
      }
    }

    // Bear trap zone: any ball entering stops dead
    if (activeEffects.bearTrapZone) {
      const t = activeEffects.bearTrapZone;
      const rr = b.r + (t.r || 12);
      const dx = b.x - t.x, dy = b.y - t.y;
      if (dx*dx + dy*dy <= rr*rr && Math.hypot(b.vx, b.vy) > 0.35) {
        SFX.railHit(0.5, 'bear_trap');
        b.vx = 0; b.vy = 0;
      }
    }

    // Bouncer: circular bumper placed on table
    if (activeEffects.bouncer) {
      const bmp = activeEffects.bouncer;
      const dx = b.x - bmp.x, dy = b.y - bmp.y;
      const dist = Math.hypot(dx, dy);
      const minD = bmp.r + b.r;
      if (dist < minD && dist > 0.01) {
        const nx = dx / dist, ny = dy / dist;
        b.x = bmp.x + nx * minD;
        b.y = bmp.y + ny * minD;
        const dot = b.vx * nx + b.vy * ny;
        if (dot < 0) {
          b.vx -= 2 * dot * nx * 0.85;
          b.vy -= 2 * dot * ny * 0.85;
          SFX.railHit(Math.min(Math.abs(dot) / 8, 1), 'bounce_house');
        }
      }
    }
  }
}

// ===================== SHOOTING =====================
function shoot(power, angle) {
  if (gameOver || ballsMoving || cueBallPlacement) return;
  const cue = getCueBall();
  if (!cue) return;

  // Apply roid rage minimum power clamp at fire time
  let p = power;
  if (activeEffects.roidRage) p = Math.max(p, 0.75);
  if (activeEffects.coolHands) p = Math.min(p, 0.25);

  let vx = Math.cos(angle) * p * MAX_SHOT_POWER;
  let vy = Math.sin(angle) * p * MAX_SHOT_POWER;

  if (activeEffects.drunk) {
    vx += (Math.random()-0.5) * p * 4;
    vy += (Math.random()-0.5) * p * 4;
  }
  if (activeEffects.turbo) {
    vx *= 1.6;
    vy *= 1.6;
  }

  cue.vx = vx;
  cue.vy = vy;

  firstHitBall = null;
  turnPocketedBalls = [];
  turnFoul = false;
  turnHitOwnBall = false;
  ballsMoving = true;

  SFX.shot(power);
  startPhysicsLoop();
}

let physicsLoopId = null;
let lastPhysicsTime = null;

function startPhysicsLoop() {
  if (physicsLoopId) return;
  lastPhysicsTime = performance.now();

  function step() {
    const now = performance.now();
    const dt = Math.min((now - lastPhysicsTime) / 16.67, 3);
    lastPhysicsTime = now;

    const steps = 3;
    for (let i = 0; i < steps; i++) physicsStep(dt / steps);

    renderFrame();

    const anyMoving = balls.some(b => !b.pocketed && (Math.abs(b.vx) > MIN_SPEED || Math.abs(b.vy) > MIN_SPEED));
    if (anyMoving) {
      physicsLoopId = requestAnimationFrame(step);
    } else {
      physicsLoopId = null;
      ballsMoving = false;
      balls.forEach(b => { b.vx = 0; b.vy = 0; });
      onShotSettled();
    }
  }
  physicsLoopId = requestAnimationFrame(step);
}

function onShotSettled() {
  if (gameOver) return;
  clearBallEffects();
  decayEffectTurns();
  endTurn();
}

// ===================== TURN FLOW =====================
function endTurn() {
  let result;
  if (variant === 'eight') result = evaluateEightBall();
  else if (variant === 'nine') result = evaluateNineBall();
  else if (variant === 'cutthroat') result = evaluateCutthroat();
  else result = evaluateDoubles();

  if (result.gameOver) {
    showGameOver(result.winner, result.reason);
    return;
  }

  resolveTurnFlow(result);
}

function resolveTurnFlow(result) {
  if (result.scratch || result.foul) {
    handleScratch();
    return;
  }

  if (result.keepTurn) {
    updateStatusMsg(players[currentPlayer].name + ' keeps the turn — nice shot!');
    if (cardsEnabled) triggerCardPhaseIfLost(false);
    else { renderFrame(); }
  } else {
    // Switch player
    const prevPlayer = currentPlayer;
    currentPlayer = (currentPlayer + 1) % players.length;
    updateStatusMsg(players[currentPlayer].name + "'s turn");
    if (cardsEnabled) triggerCardPhase(prevPlayer);
    else { renderFrame(); }
  }
  updatePlayerUI();
}

function handleScratch() {
  const cue = getCueBall();
  if (cue) { cue.pocketed = false; }
  cueBallPlacement = true;
  const play = getPlayArea();
  if (cue) { cue.x = play.left + play.w * 0.25; cue.y = play.cy; }
  updateStatusMsg('Foul/Scratch — ' + players[(currentPlayer + 1) % players.length].name + ' places cue ball');
  currentPlayer = (currentPlayer + 1) % players.length;
  updatePlayerUI();
  if (cardsEnabled) triggerCardPhaseIfLost(true);
  renderFrame();
}

function triggerCardPhaseIfLost(lost) {
  // Card phase triggers when turn is LOST (miss, foul) not every shot
  if (lost || turnPocketedBalls.length === 0) {
    triggerCardPhase(currentPlayer);
  } else {
    renderFrame();
  }
}

// ===================== EVALUATORS =====================
function evaluateEightBall() {
  const cue = getCueBall();
  const scratch = turnPocketedBalls.some(p => p.num === 0);
  const p = players[currentPlayer];

  // Group assignment
  if (!p.group) {
    const pocketed = turnPocketedBalls.filter(b => b.num !== 0 && b.num !== 8);
    if (pocketed.length > 0) {
      const firstNum = pocketed[0].num;
      p.group = firstNum <= 7 ? 'solids' : 'stripes';
      const opp = players[(currentPlayer + 1) % 2];
      if (!opp.group) opp.group = p.group === 'solids' ? 'stripes' : 'solids';
    }
  }

  const myNums = p.group === 'solids' ? [1,2,3,4,5,6,7] : (p.group === 'stripes' ? [9,10,11,12,13,14,15] : []);
  const remaining = balls.filter(b => !b.pocketed && b.num !== 0 && b.num !== 8);
  const myBallsLeft = remaining.filter(b => myNums.includes(b.num));
  const oppBallsLeft = remaining.filter(b => !myNums.includes(b.num) && b.num !== 8);

  // 8-ball pocketed
  const eightPocketed = turnPocketedBalls.some(b => b.num === 8);
  if (eightPocketed) {
    if (myBallsLeft.length === 0 && !scratch) {
      return { gameOver: true, winner: currentPlayer, reason: players[currentPlayer].name + ' wins!' };
    } else {
      return { gameOver: true, winner: (currentPlayer + 1) % 2, reason: players[currentPlayer].name + ' sank the 8-ball early! ' + players[(currentPlayer+1)%2].name + ' wins!' };
    }
  }

  const myBallsPocketed = turnPocketedBalls.filter(b => b.num !== 0 && (p.group === 'solids' ? b.num <= 7 : (p.group === 'stripes' ? b.num >= 9 : true)));
  const keepTurn = !scratch && myBallsPocketed.length > 0 && !turnFoul;
  return { scratch, keepTurn };
}

function evaluateNineBall() {
  const scratch = turnPocketedBalls.some(b => b.num === 0);
  const ninePocketed = turnPocketedBalls.some(b => b.num === 9);
  if (ninePocketed && !scratch) {
    return { gameOver: true, winner: currentPlayer, reason: players[currentPlayer].name + ' wins!' };
  }
  // Must hit lowest ball first
  const lowestOnTable = balls.filter(b => !b.pocketed && b.num > 0).sort((a,b) => a.num - b.num)[0];
  const foul = firstHitBall && lowestOnTable && firstHitBall !== lowestOnTable.num;
  const ballsPocketed = turnPocketedBalls.filter(b => b.num !== 0);
  const keepTurn = !scratch && !foul && ballsPocketed.length > 0;
  return { scratch: scratch || foul, keepTurn };
}

function evaluateCutthroat() {
  // Cutthroat: 3 players, each owns a group of 5 balls, last player with balls on table wins
  if (variant !== 'cutthroat') return {};
  // Groups assigned in order: 1-5, 6-10, 11-15
  const groups = [[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15]];
  for (let i = 0; i < 3; i++) {
    const remaining = balls.filter(b => !b.pocketed && groups[i].includes(b.num));
    if (remaining.length === 0) {
      // This player is out; check if only 1 player remains
      const playersAlive = players.filter((p,pi) => balls.filter(b => !b.pocketed && groups[pi].includes(b.num)).length > 0);
      if (playersAlive.length === 1) {
        const wi = players.indexOf(playersAlive[0]);
        return { gameOver: true, winner: wi, reason: players[wi].name + ' wins Cutthroat!' };
      }
    }
  }
  const scratch = turnPocketedBalls.some(b => b.num === 0);
  const pocketed = turnPocketedBalls.filter(b => b.num !== 0);
  const keepTurn = !scratch && pocketed.length > 0;
  return { scratch, keepTurn };
}

function evaluateDoubles() {
  // Doubles: 2v2, teams are players 0+2 vs 1+3
  const teamA = [0, 2], teamB = [1, 3];
  const teamANums = [1,2,3,4,5,6,7], teamBNums = [9,10,11,12,13,14,15];
  const curTeam = teamA.includes(currentPlayer) ? 'A' : 'B';
  const myNums = curTeam === 'A' ? teamANums : teamBNums;
  const pocketed = turnPocketedBalls.filter(b => b.num !== 0 && b.num !== 8 && myNums.includes(b.num));
  const eightPocketed = turnPocketedBalls.some(b => b.num === 8);
  const scratch = turnPocketedBalls.some(b => b.num === 0);
  const remaining = balls.filter(b => !b.pocketed && myNums.includes(b.num));
  if (eightPocketed) {
    if (remaining.length === 0 && !scratch) return { gameOver: true, winner: currentPlayer, reason: 'Team ' + (curTeam === 'A' ? '1&3' : '2&4') + ' wins!' };
    else return { gameOver: true, winner: (teamA.includes(currentPlayer) ? teamB[0] : teamA[0]), reason: 'Early 8-ball sink!' };
  }
  const keepTurn = !scratch && pocketed.length > 0;
  const nextPlayer = teamA.includes(currentPlayer)
    ? (currentPlayer === 0 ? 2 : 0)
    : (currentPlayer === 1 ? 3 : 1);
  return { scratch, keepTurn, nextPlayer };
}

// ===================== CARD PHASE =====================
function triggerCardPhase(playerIdx) {
  if (!cardsEnabled) { renderFrame(); return; }
  const player = players[playerIdx];

  // Draw cards
  drawCardsForPlayer(player);
  if (player.hand.length === 0) { renderFrame(); return; }

  cardPhaseActive = true;
  cardPhaseSelected = [];

  // Show card overlay
  document.getElementById('cardPhasePlayerName').textContent = player.name;
  document.getElementById('cardPlayLimit').textContent = PLAY_CARDS_PER_TURN;

  const drawInfo = cardPhaseDrawn.length > 0 ? `Drew ${cardPhaseDrawn.map(c=>c.name).join(', ')}.` : '';
  document.getElementById('cardDrawInfo').textContent = drawInfo;

  buildCardPickGrid(player.hand, debugCardMode);
  document.getElementById('cardOverlay').classList.remove('hidden');
}

function drawCardsForPlayer(player) {
  if (player.hand.length >= MAX_HAND_CARDS) { cardPhaseDrawn = []; return; }
  const slots = MAX_HAND_CARDS - player.hand.length;
  const toDraw = Math.min(AUTO_DRAW_CARDS_PER_TURN, slots);
  cardPhaseDrawn = [];
  const available = debugCardMode ? CARD_POOL : [...CARD_POOL];

  // Guarantee at least 1 ball + 1 table if slots allow
  const ballCards = available.filter(c => c.type === 'ball');
  const tableCards = available.filter(c => c.type === 'table');
  const drawn = [];

  if (toDraw >= 2 && slots >= 2) {
    const bc = ballCards[Math.floor(Math.random()*ballCards.length)];
    const tc = tableCards[Math.floor(Math.random()*tableCards.length)];
    drawn.push(bc, tc);
  }

  while (drawn.length < toDraw) {
    const pool = available.filter(c => !drawn.includes(c));
    if (!pool.length) break;
    drawn.push(pool[Math.floor(Math.random()*pool.length)]);
  }

  for (const c of drawn) {
    if (player.hand.length < MAX_HAND_CARDS) {
      player.hand.push({ ...c });
      cardPhaseDrawn.push(c);
    }
  }
}

function buildCardPickGrid(hand, fullPick) {
  const grid = document.getElementById('cardPickGrid');
  grid.innerHTML = '';
  const source = fullPick ? CARD_POOL : hand;
  source.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = 'card-pick-item';
    div.dataset.idx = fullPick ? card.id : i;
    div.innerHTML = `<div class="cpicon">${card.icon || ''}</div><div class="cpname">${card.name}</div><div class="cpdesc">${card.desc}</div><div class="cptag">${card.type}</div>`;
    div.addEventListener('click', () => {
      const isSelected = div.classList.contains('selected');
      if (isSelected) {
        div.classList.remove('selected');
        cardPhaseSelected = cardPhaseSelected.filter(c => c.id !== card.id);
      } else if (cardPhaseSelected.length < PLAY_CARDS_PER_TURN) {
        div.classList.add('selected');
        cardPhaseSelected.push(card);
      }
    });
    grid.appendChild(div);
  });
}

function onCardPhaseDone() {
  document.getElementById('cardOverlay').classList.add('hidden');
  cardPhaseActive = false;
  const player = players[currentPlayer === 0 ? players.length - 1 : currentPlayer - 1];

  for (const card of cardPhaseSelected) {
    const idx = player.hand.findIndex(c => c.id === card.id);
    if (idx >= 0) player.hand.splice(idx, 1);
    playCard(card);
  }
  cardPhaseSelected = [];
  updateHandUI();
  processInteractionQueue();
}

function onCardPhaseSkip() {
  document.getElementById('cardOverlay').classList.add('hidden');
  cardPhaseActive = false;
  cardPhaseSelected = [];
  renderFrame();
}

function playCard(card) {
  SFX.cardPlayed(card.id);
  if (card.fn) card.fn(card);
}

function processInteractionQueue() {
  if (interactionQueue.length === 0) {
    updateEffectsUI();
    renderFrame();
    return;
  }
  pendingInteraction = interactionQueue.shift();
  activateInteractionStep(pendingInteraction);
}

function activateInteractionStep(step) {
  const key = step.type + '_' + (step.cardId || '');
  const skip = dontShowAgainKeys.has(key);

  if (!skip) {
    document.getElementById('confirmTitle').textContent = step.title || 'Select';
    document.getElementById('confirmMsg').textContent = step.msg || '';
    document.getElementById('dontShowRow').style.display = step.dontShowOption ? 'flex' : 'none';
    document.getElementById('dontShowAgain').checked = false;
    document.getElementById('selectionConfirmOverlay').classList.remove('hidden');
    confirmCallback = () => {
      if (document.getElementById('dontShowAgain').checked) dontShowAgainKeys.add(key);
      document.getElementById('selectionConfirmOverlay').classList.add('hidden');
      enterInteractionMode(step);
    };
  } else {
    enterInteractionMode(step);
  }
}

function enterInteractionMode(step) {
  updateStatusMsg(step.prompt || 'Make a selection on the table');
  renderFrame();
}

function onConfirmYes() {
  if (confirmCallback) { confirmCallback(); confirmCallback = null; }
}

function onConfirmNo() {
  document.getElementById('selectionConfirmOverlay').classList.add('hidden');
  confirmCallback = null;
  pendingInteraction = null;
  processInteractionQueue();
}

// Handle table clicks during interaction
function handleInteractionClick(x, y) {
  if (!pendingInteraction) return false;
  const step = pendingInteraction;

  if (step.type === 'ball_pick') {
    const b = balls.find(b2 => !b2.pocketed && b2.num !== 0 && Math.hypot(b2.x-x, b2.y-y) < b2.r * 2);
    if (b) {
      step.resolve(b);
      pendingInteraction = null;
      processInteractionQueue();
      return true;
    }
  } else if (step.type === 'pocket_pick') {
    const p = pockets.findIndex(pk => Math.hypot(pk.x-x, pk.y-y) < pk.r * 2.5);
    if (p >= 0) {
      step.resolve(p);
      pendingInteraction = null;
      processInteractionQueue();
      return true;
    }
  } else if (step.type === 'table_place') {
    const play = getPlayArea();
    if (x > play.left && x < play.right && y > play.top && y < play.bottom) {
      step.resolve({ x, y });
      pendingInteraction = null;
      processInteractionQueue();
      return true;
    }
  } else if (step.type === 'rail_pick') {
    const rail = getRailFromClick(x, y);
    if (rail) {
      step.resolve(rail);
      pendingInteraction = null;
      processInteractionQueue();
      return true;
    }
  }
  return false;
}

function getRailFromClick(x, y) {
  const cw = CUSHION_W;
  if (y < cw) return 'top';
  if (y > H - cw) return 'bottom';
  if (x < cw) return 'left';
  if (x > W - cw) return 'right';
  return null;
}

// ===================== CARD EFFECT FUNCTIONS =====================

// Helper: remove a rail from any exclusive rail effect (one effect per rail)
function clearRailEffects(rail) {
  ['bounceHouseRail', 'deadRail'].forEach(k => {
    const arr = activeEffects[k];
    if (Array.isArray(arr)) {
      const i = arr.indexOf(rail);
      if (i !== -1) arr.splice(i, 1);
    }
  });
}

// Build a visual confusion map for targetNum: maps it to a different ball's appearance
function buildConfusionFor(targetNum) {
  const numMap = {}, stripeMap = {};
  const targetBall = balls.find(b => b.num === targetNum);
  if (!targetBall) return { numMap, stripeMap };
  const opposite = balls.filter(b =>
    !b.pocketed && b.num !== 0 && b.num !== 8 && b.num !== targetNum && b.stripe !== targetBall.stripe
  );
  const others = balls.filter(b =>
    !b.pocketed && b.num !== 0 && b.num !== 8 && b.num !== targetNum
  );
  const pool = opposite.length ? opposite : others;
  if (pool.length) {
    const fake = pool[Math.floor(Math.random() * pool.length)];
    numMap[targetNum] = fake.num;
  }
  stripeMap[targetNum] = !targetBall.stripe; // flip stripe/solid appearance
  return { numMap, stripeMap };
}

function applyFogOfWar() { activeEffects.fogOfWar = true; }

function applyHeavyweight() {
  interactionQueue.push({ type: 'ball_pick', cardId: 'heavyweight', title: 'Heavyweight', msg: 'Click a ball to make it heavy.', prompt: 'Click a ball to make it heavy.', dontShowOption: true, resolve: (b) => { b.heavyweight = true; } });
}

function applyLightweight() {
  interactionQueue.push({ type: 'ball_pick', cardId: 'lightweight', title: 'Lightweight', msg: 'Click a ball to make it light.', prompt: 'Click a ball to make it light.', dontShowOption: true, resolve: (b) => { b.lightweight = true; } });
}

function applyConfusion() {
  interactionQueue.push({ type: 'ball_pick', cardId: 'confusion', title: 'Confusion', msg: 'Pick a ball — it will be disguised as a different ball.', prompt: 'Click a ball.', dontShowOption: true, resolve: (b) => {
    const cm = buildConfusionFor(b.num);
    activeEffects.confusionMap = cm.numMap;
    activeEffects.confusionStripeMap = cm.stripeMap;
    activeEffects.confusion = true;
  }});
}

function applyCloak() {
  interactionQueue.push({ type: 'ball_pick', cardId: 'cloak', title: 'Cloak', msg: 'Click one of your balls to cloak it.', prompt: 'Click a ball to cloak.', dontShowOption: true, resolve: (b) => { b.cloaked = true; activeEffects.cloaked = b.num; activeEffects.cloakedBall = b.num; } });
}

// Sticky: cue ball drags first ball it contacts (no ball pick needed — v1 behavior)
function applySticky() { activeEffects.sticky = true; }

function applyDrunk() { activeEffects.drunk = true; }

function applyShortsighted() { activeEffects.shortsighted = true; }

// Roid Rage: minimum power 75% (v1 behavior, not per-ball explosion)
function applyRoidRage() { activeEffects.roidRage = true; }

// Cool Hands: power capped at 25% (v1 behavior)
function applyCoolHands() { activeEffects.coolHands = true; }

// Big/Small Ball: applies to cue ball only (v1 behavior)
function applyBigBall() {
  activeEffects.bigBall = true;
  const cue = getCueBall();
  if (cue) cue.r = BALL_R * 2;
}

function applySmallBall() {
  activeEffects.smallBall = true;
  const cue = getCueBall();
  if (cue) cue.r = BALL_R * 0.5;
}

function applyOilCue() { activeEffects.oilCue = true; }

function applyReverseSpin() { activeEffects.reverseSpin = true; }

// Mirror: all object balls appear mirrored left-right (v1: visual deception)
function applyMirror() { activeEffects.mirror = true; }

// Magnet: pull all moving balls toward nearest pocket (v1 behavior)
function applyMagnet() { activeEffects.magnet = true; }

// Turbo: 1.6× shot speed at fire time (v1 behavior)
function applyTurbo() { activeEffects.turbo = true; }

// Bouncer: place a circular rubber bumper on the table
function applyBouncer() {
  interactionQueue.push({ type: 'table_place', cardId: 'bouncer', title: 'Bouncer', msg: 'Click to place the rubber bumper on the table.', prompt: 'Click anywhere on the table.', dontShowOption: true, resolve: (pos) => {
    activeEffects.bouncer = { x: pos.x, y: pos.y, r: BALL_R * 0.9 };
  }});
}

// Bounce House: pick one rail — it gets 2.2× bounce (v1 per-rail behavior)
function applyBounceHouse() {
  interactionQueue.push({ type: 'rail_pick', cardId: 'bounce_house', title: 'Bounce House', msg: 'Click a rail — it becomes a rubber band (2.2× bounce).', prompt: 'Click a rail.', dontShowOption: true, resolve: (rail) => {
    if (!activeEffects.bounceHouseRail) activeEffects.bounceHouseRail = [];
    clearRailEffects(rail);
    activeEffects.bounceHouseRail.push(rail);
  }});
}

// Dead Rail: pick one rail — 0.1× damping (v1 per-rail behavior)
function applyDeadRail() {
  interactionQueue.push({ type: 'rail_pick', cardId: 'dead_rail', title: 'Dead Rail', msg: 'Click a rail — balls barely rebound off it.', prompt: 'Click a rail.', dontShowOption: true, resolve: (rail) => {
    if (!activeEffects.deadRail) activeEffects.deadRail = [];
    clearRailEffects(rail);
    activeEffects.deadRail.push(rail);
  }});
}

// Bear Trap: place a hidden zone anywhere — stops any ball that touches it
function applyBearTrap() {
  interactionQueue.push({ type: 'table_place', cardId: 'bear_trap', title: 'Bear Trap', msg: 'Click to place the hidden bear trap on the table.', prompt: 'Click anywhere on the table.', dontShowOption: true, resolve: (pos) => {
    activeEffects.bearTrapZone = { x: pos.x, y: pos.y, r: 12 };
    activeEffects.bearTrapRevealUntil = performance.now() + 1500; // show briefly
  }});
}

function applyPortal() {
  activeEffects.portals = [];
  function placePortal() {
    interactionQueue.unshift({ type: 'table_place', cardId: 'portal', title: 'Portal', msg: `Place portal ${activeEffects.portals.length+1} of 2.`, prompt: 'Click on the table to place a portal.', dontShowOption: true, resolve: (pos) => {
      activeEffects.portals.push(pos);
      if (activeEffects.portals.length < 2) placePortal();
    }});
  }
  placePortal();
}

function applyIcePatch() {
  interactionQueue.push({ type: 'table_place', cardId: 'ice_patch', title: 'Ice Patch', msg: 'Click on the table to place the ice patch.', prompt: 'Click on the table.', dontShowOption: true, resolve: (pos) => { activeEffects.icePatch = { ...pos, r: 60 }; } });
}

function applyBlockPocket() {
  interactionQueue.push({ type: 'pocket_pick', cardId: 'block_pocket', title: 'Block Pocket', msg: 'Click a pocket to block.', prompt: 'Click a pocket.', dontShowOption: true, resolve: (pi) => {
    if (!activeEffects.blockedPockets) activeEffects.blockedPockets = [];
    activeEffects.blockedPockets.push(pi);
    if (!activeEffects.blockedPocketsTurns) activeEffects.blockedPocketsTurns = {};
    activeEffects.blockedPocketsTurns[pi] = 2;
  }});
}

function applyOpenPocket() {
  if (!activeEffects.blockedPockets || !activeEffects.blockedPockets.length) {
    showToast('No blocked pockets to open!');
    return;
  }
  interactionQueue.push({ type: 'pocket_pick', cardId: 'open_pocket', title: 'Open Pocket', msg: 'Click a blocked pocket to re-open it.', prompt: 'Click a blocked pocket.', dontShowOption: true, resolve: (pi) => {
    activeEffects.blockedPockets = (activeEffects.blockedPockets || []).filter(i => i !== pi);
    updateEffectsUI();
  }});
}

function applyMoveHole() {
  interactionQueue.push({ type: 'pocket_pick', cardId: 'move_hole', title: 'Move Hole', msg: 'Click a pocket to move.', prompt: 'Click a pocket.', dontShowOption: true, resolve: (pi) => {
    interactionQueue.unshift({ type: 'table_place', cardId: 'move_hole', title: 'Move Hole', msg: 'Click new position for the pocket.', prompt: 'Click new pocket location.', dontShowOption: true, resolve: (pos) => {
      pockets[pi].x = pos.x; pockets[pi].y = pos.y; pockets[pi].moved = true;
    }});
  }});
}

function applyWarpRail() {
  interactionQueue.push({ type: 'pocket_pick', cardId: 'warp_rail', title: 'Warp Rail', msg: 'Click a pocket as the warp anchor point.', prompt: 'Click a pocket.', dontShowOption: true, resolve: (pi) => {
    const p = pockets[pi];
    const cw = CUSHION_W;
    const inset = 20;
    // Warp the table corners toward/away from this pocket
    activeEffects.warpCorners = [
      { x: cw + inset + (pi === 0 || pi === 3 ? 20 : 0), y: cw + inset + (pi === 0 || pi === 2 ? 20 : 0) },
      { x: W - cw - inset - (pi === 2 || pi === 5 ? 20 : 0), y: cw + inset + (pi === 0 || pi === 2 ? 20 : 0) },
      { x: W - cw - inset - (pi === 2 || pi === 5 ? 20 : 0), y: H - cw - inset - (pi === 3 || pi === 5 ? 20 : 0) },
      { x: cw + inset + (pi === 0 || pi === 3 ? 20 : 0), y: H - cw - inset - (pi === 3 || pi === 5 ? 20 : 0) },
    ];
    activeEffects.warpMids = [
      { x: W/2 + (pi === 1 ? 30 : 0), y: cw * 0.5 },
      { x: W/2 + (pi === 4 ? 30 : 0), y: H - cw * 0.5 },
    ];
    activeEffects.warpTurns = 3;
    shiftAllBallsInsideWarp();
  }});
}

function applyMudPatch() {
  interactionQueue.push({ type: 'table_place', cardId: 'mud_patch', title: 'Mud Patch', msg: 'Click on the table to place the mud patch.', prompt: 'Click on the table.', dontShowOption: true, resolve: (pos) => { activeEffects.mudPatch = { ...pos, r: 55 }; } });
}

function applyCrosswind() {
  activeEffects.crosswind = (Math.random() > 0.5 ? 1 : -1) * (0.3 + Math.random() * 0.4);
  activeEffects.crosswindTurns = 2;
}

function applyPocketShrink() {
  interactionQueue.push({ type: 'pocket_pick', cardId: 'pocket_shrink', title: 'Pocket Shrink', msg: 'Click a pocket to shrink.', prompt: 'Click a pocket.', dontShowOption: true, resolve: (pi) => {
    if (!activeEffects.shrunkPockets) activeEffects.shrunkPockets = [];
    activeEffects.shrunkPockets.push(pi);
    if (!activeEffects.shrunkPocketsTurns) activeEffects.shrunkPocketsTurns = {};
    activeEffects.shrunkPocketsTurns[pi] = 3;
  }});
}

function applyEarthquake() {
  const play = getPlayArea();
  balls.forEach(b => {
    if (!b.pocketed) {
      b.x += (Math.random()-0.5) * 60;
      b.y += (Math.random()-0.5) * 60;
      b.x = Math.max(play.left + b.r, Math.min(play.right - b.r, b.x));
      b.y = Math.max(play.top + b.r, Math.min(play.bottom - b.r, b.y));
    }
  });
  SFX.cardPlayed('earthquake');
}

// ===================== EFFECT CLEARING =====================

// Ball effects clear after every turn (boolean flags reset to false/null)
function clearBallEffects() {
  activeEffects.fogOfWar = false;
  activeEffects.confusion = false;
  activeEffects.confusionMap = null;
  activeEffects.confusionStripeMap = null;
  activeEffects.cloaked = null;
  activeEffects.cloakedBall = null;
  activeEffects.sticky = false;
  activeEffects.drunk = false;
  activeEffects.shortsighted = false;
  activeEffects.roidRage = false;
  activeEffects.coolHands = false;
  activeEffects.bigBall = false;
  activeEffects.smallBall = false;
  activeEffects.oilCue = false;
  activeEffects.reverseSpin = false;
  activeEffects.mirror = false;
  activeEffects.magnet = false;
  activeEffects.turbo = false;

  // Reset per-ball properties
  balls.forEach(b => {
    b.foggy = false;
    b.cloaked = false;
    delete b._stuck;
    delete b.heavyweight; delete b.lightweight;
    delete b.oilCue;
    delete b.reverseSpin; delete b.mirror;
    // Restore cue ball size
    if (b.num === 0) b.r = BALL_R;
  });
}

// Table effects with turn counters decay across turns; placed objects persist
function decayEffectTurns() {
  if (activeEffects.crosswindTurns > 0) {
    activeEffects.crosswindTurns--;
    if (activeEffects.crosswindTurns <= 0) { delete activeEffects.crosswind; delete activeEffects.crosswindTurns; }
  }
  if (activeEffects.warpTurns > 0) {
    activeEffects.warpTurns--;
    if (activeEffects.warpTurns <= 0) { delete activeEffects.warpCorners; delete activeEffects.warpMids; delete activeEffects.warpTurns; }
  }

  // Timed pocket effects
  ['blockedPocketsTurns', 'shrunkPocketsTurns'].forEach(key => {
    const arrKey = key === 'blockedPocketsTurns' ? 'blockedPockets' : 'shrunkPockets';
    if (activeEffects[key]) {
      Object.entries(activeEffects[key]).forEach(([pi, t]) => {
        activeEffects[key][pi] = t - 1;
        if (activeEffects[key][pi] <= 0) {
          delete activeEffects[key][pi];
          if (activeEffects[arrKey]) {
            activeEffects[arrKey] = activeEffects[arrKey].filter(p => p !== parseInt(pi));
          }
        }
      });
    }
  });

  updateEffectsUI();
}

function shiftAllBallsInsideWarp() {
  if (!activeEffects.warpCorners) return;
  const play = getPlayArea();
  balls.forEach(b => {
    if (!b.pocketed) {
      b.x = Math.max(play.left + b.r, Math.min(play.right - b.r, b.x));
      b.y = Math.max(play.top + b.r, Math.min(play.bottom - b.r, b.y));
    }
  });
}

// ===================== MIRROR RENDERING =====================
function getMirroredBallRenderPoint(b) {
  // Global mirror: all object balls appear mirrored left-right (v1 behavior)
  if (activeEffects.mirror && b.num !== 0) {
    return { x: 2 * (W / 2) - b.x, y: b.y };
  }
  if (!b.mirror) return { x: b.x, y: b.y };
  const play = getPlayArea();
  const cx = play.cx, cy = play.cy;
  const mx = 2 * cx - b.x;
  const my = 2 * cy - b.y;
  return {
    x: Math.max(play.left + b.r, Math.min(play.right - b.r, mx)),
    y: Math.max(play.top + b.r, Math.min(play.bottom - b.r, my))
  };
}

// ===================== RENDERING =====================
function renderFrame() {
  if (!ctx) return;

  const pr = POCKET_R || Math.round(W * 0.032);
  HDRenderer.drawTableSurface(ctx, { width: W, height: H, rail: CUSHION_W, pocketRadius: pr });

  // Effect overlays
  if (activeEffects.icePatch) drawIcePatchOverlay(activeEffects.icePatch);
  if (activeEffects.mudPatch) drawMudPatchOverlay(activeEffects.mudPatch);
  if (activeEffects.crosswind) drawCrosswindOverlay(activeEffects.crosswind);
  if (activeEffects.portals && activeEffects.portals.length) drawPortalOverlay(activeEffects.portals);
  if (activeEffects.bounceHouseRail && activeEffects.bounceHouseRail.length) drawRailEffectOverlay(activeEffects.bounceHouseRail, 'rgba(255,220,0,0.28)');
  if (activeEffects.deadRail && activeEffects.deadRail.length) drawRailEffectOverlay(activeEffects.deadRail, 'rgba(120,80,30,0.32)');
  if (activeEffects.bouncer) drawBouncerOverlay(activeEffects.bouncer);
  if (activeEffects.bearTrapZone && activeEffects.bearTrapRevealUntil && performance.now() < activeEffects.bearTrapRevealUntil) {
    drawBearTrapZoneOverlay(activeEffects.bearTrapZone, activeEffects.bearTrapRevealUntil);
  }
  drawPocketEffectsOverlay();

  // Aim line drawn before balls so cue stick appears behind
  const cue = getCueBall();
  if (cue && !cue.pocketed && !ballsMoving && !cueBallPlacement && gameStarted && !cardPhaseActive) {
    if (activeEffects.shortsighted) {
      // Shortsighted card: only show the cue stick, no sight line
      drawCueStickOnly(cue, aimAngle, shotPower);
    } else if (activeEffects.drunk) {
      // Drunk card: sight line slowly sways — unreliable aim
      const sway = Math.sin(performance.now() / 280) * 0.16;
      drawAimLine(cue, aimAngle + sway, shotPower);
    } else {
      drawAimLine(cue, aimAngle, shotPower);
    }
  }

  // Draw balls
  const ballOpts = {
    activeEffects,
    baseRadius: BALL_R,
    minVelocity: MIN_SPEED,
    tableWidth: W,
    mirrorPositionForBall: getMirroredBallRenderPoint,
  };
  for (const b of balls) {
    if (b.pocketed) continue;
    if (b.foggy) {
      ctx.save();
      ctx.globalAlpha = 0.14;
      HDRenderer.drawPoolBall(ctx, b, ballOpts);
      ctx.restore();
    } else {
      HDRenderer.drawPoolBall(ctx, b, ballOpts);
    }
  }

  // Cue ball placement indicator
  if (cueBallPlacement && cue) drawCuePlacementIndicator(cue);

  // Interaction highlights
  if (pendingInteraction) {
    drawInteractionHighlight();
    if (pendingInteraction.type === 'ball_pick') drawBallPickRings();
    if (pendingInteraction.type === 'pocket_pick') drawPocketPickHighlights();
    if (pendingInteraction.type === 'rail_pick') drawRailPickHighlights();
  }
}

// ===================== DRAW HELPERS =====================
function drawCueStickOnly(cue, angle, power) {
  const r = cue.r || BALL_R;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const pullback = 5 + power * 30;
  const tipX = cue.x - dx * (r + 2 + pullback);
  const tipY = cue.y - dy * (r + 2 + pullback);
  const butX = tipX - dx * 96;
  const butY = tipY - dy * 96;
  ctx.save();
  const stickGrad = ctx.createLinearGradient(tipX, tipY, butX, butY);
  stickGrad.addColorStop(0, 'rgba(235,210,145,0.94)');
  stickGrad.addColorStop(0.3, 'rgba(188,138,68,0.88)');
  stickGrad.addColorStop(1, 'rgba(80,45,15,0.72)');
  ctx.strokeStyle = stickGrad;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(butX, butY);
  ctx.stroke();
  ctx.restore();
}

function drawAimLine(cue, angle, power) {
  const play = getPlayArea();
  const r = cue.r || BALL_R;
  let x = cue.x, y = cue.y;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const stepSize = 4;
  const maxLen = W * 2.5;
  let len = 0;
  const pts = [{ x, y }];
  let hitBall = null; // ball hit at end of trace

  while (len < maxLen) {
    x += dx * stepSize;
    y += dy * stepSize;
    len += stepSize;
    let stopped = false;

    if (x - r < play.left) { x = play.left + r; stopped = true; }
    else if (x + r > play.right) { x = play.right - r; stopped = true; }
    if (y - r < play.top) { y = play.top + r; stopped = true; }
    else if (y + r > play.bottom) { y = play.bottom - r; stopped = true; }

    for (const b of balls) {
      if (b.pocketed || b.num === 0) continue;
      const br = r + (b.r || BALL_R);
      if ((b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) < br * br) {
        stopped = true;
        hitBall = b;
        break;
      }
    }
    pts.push({ x, y });
    if (stopped) break;
  }

  ctx.save();

  // Sight line — always visible, brighter when charging
  const lineAlpha = 0.38 + power * 0.32;
  ctx.strokeStyle = `rgba(255,255,255,${lineAlpha})`;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ghost cue ball at impact point — shows exactly where the cue ball ends up
  const endPt = pts[pts.length - 1];
  if (hitBall) {
    ctx.beginPath();
    ctx.arc(endPt.x, endPt.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Cue stick — tip near ball, butt behind cursor
  const pullback = 5 + power * 30;
  const tipX = cue.x - dx * (r + 2 + pullback);
  const tipY = cue.y - dy * (r + 2 + pullback);
  const butX = tipX - dx * 96;
  const butY = tipY - dy * 96;

  const stickGrad = ctx.createLinearGradient(tipX, tipY, butX, butY);
  stickGrad.addColorStop(0, 'rgba(235,210,145,0.94)');
  stickGrad.addColorStop(0.3, 'rgba(188,138,68,0.88)');
  stickGrad.addColorStop(1, 'rgba(80,45,15,0.72)');
  ctx.strokeStyle = stickGrad;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(butX, butY);
  ctx.stroke();

  ctx.restore();
}

function drawIcePatchOverlay(patch) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(patch.x, patch.y, patch.r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(180,220,255,0.22)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(180,220,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🧊', patch.x, patch.y);
  ctx.restore();
}

function drawMudPatchOverlay(patch) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(patch.x, patch.y, patch.r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(100,60,20,0.38)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,90,40,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('💩', patch.x, patch.y);
  ctx.restore();
}

function drawCrosswindOverlay(wind) {
  const cx = W / 2, cy = CUSHION_W * 0.55;
  const dir = wind > 0 ? 1 : -1;
  const len = 24 + Math.abs(wind) * 18;
  ctx.save();
  ctx.strokeStyle = 'rgba(180,220,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - dir * len, cy);
  ctx.lineTo(cx + dir * len, cy);
  // arrowhead
  ctx.moveTo(cx + dir * len, cy);
  ctx.lineTo(cx + dir * (len - 8), cy - 6);
  ctx.moveTo(cx + dir * len, cy);
  ctx.lineTo(cx + dir * (len - 8), cy + 6);
  ctx.stroke();
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('💨', cx + dir * (len + 12), cy);
  ctx.restore();
}

function drawRailEffectOverlay(rails, color) {
  const play = getPlayArea();
  ctx.save();
  ctx.fillStyle = color;
  rails.forEach(rail => {
    if (rail === 'top')    ctx.fillRect(play.left, 0,         play.right - play.left, CUSHION_W);
    if (rail === 'bottom') ctx.fillRect(play.left, H - CUSHION_W, play.right - play.left, CUSHION_W);
    if (rail === 'left')   ctx.fillRect(0,         play.top,  CUSHION_W, play.bottom - play.top);
    if (rail === 'right')  ctx.fillRect(W - CUSHION_W, play.top, CUSHION_W, play.bottom - play.top);
  });
  ctx.restore();
}

function drawBouncerOverlay(bmp) {
  const pulse = (performance.now() % 1000) / 1000;
  ctx.save();
  ctx.beginPath();
  ctx.arc(bmp.x, bmp.y, bmp.r, 0, Math.PI * 2);
  const grad = ctx.createRadialGradient(bmp.x - 2, bmp.y - 2, 1, bmp.x, bmp.y, bmp.r);
  grad.addColorStop(0, '#ff6b5b');
  grad.addColorStop(1, '#c0392b');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,150,130,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Pulsing ring
  ctx.beginPath();
  ctx.arc(bmp.x, bmp.y, bmp.r + 4 + pulse * 6, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,100,80,${0.4 * (1 - pulse)})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawBearTrapZoneOverlay(zone, revealUntil) {
  const left = Math.max(1, revealUntil - performance.now());
  const alpha = Math.min(1, left / 900);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🪤', zone.x, zone.y);
  ctx.beginPath();
  ctx.arc(zone.x, zone.y, zone.r + 4, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,80,0,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawPortalOverlay(portals) {
  const t = performance.now() / 500;
  const colors = ['rgba(100,80,255,', 'rgba(255,80,100,'];
  portals.forEach((p, i) => {
    ctx.save();
    const pulse = BALL_R * 1.5 + Math.sin(t + i * Math.PI) * 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
    ctx.strokeStyle = colors[i % 2] + '0.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🌀', p.x, p.y);
    ctx.restore();
  });
}

function drawPocketEffectsOverlay() {
  pockets.forEach((p, pi) => {
    if (activeEffects.blockedPockets && activeEffects.blockedPockets.includes(pi)) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,40,40,0.5)';
      ctx.fill();
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚫', p.x, p.y);
      ctx.restore();
    }
    if (activeEffects.openPockets && activeEffects.openPockets.includes(pi)) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 1.4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(80,255,80,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    if (activeEffects.shrunkPockets && activeEffects.shrunkPockets.includes(pi)) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.65, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,80,80,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  });
}

function drawCuePlacementIndicator(cue) {
  const overlapping = balls.some(b => !b.pocketed && b.num !== 0 && Math.hypot(b.x - cue.x, b.y - cue.y) < b.r + cue.r + 2);
  ctx.save();
  ctx.strokeStyle = overlapping ? 'rgba(255,60,60,0.85)' : 'rgba(80,255,80,0.75)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.arc(cue.x, cue.y, cue.r + 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = overlapping ? 'rgba(255,100,100,0.9)' : 'rgba(100,255,100,0.9)';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(overlapping ? 'INVALID' : 'CLICK TO PLACE', cue.x, cue.y - cue.r - 6);
  ctx.restore();
}

function drawInteractionHighlight() {
  ctx.save();
  ctx.fillStyle = 'rgba(255,215,0,0.06)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawBallPickRings() {
  const t = performance.now() / 380;
  balls.forEach(b => {
    if (b.pocketed) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, (b.r || BALL_R) + 4 + Math.sin(t) * 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,215,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  });
}

function drawPocketPickHighlights() {
  const t = performance.now() / 380;
  pockets.forEach(p => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + 4 + Math.sin(t) * 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,215,0,0.65)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  });
}

function drawRailPickHighlights() {
  const play = getPlayArea();
  ctx.save();
  ctx.fillStyle = 'rgba(255,215,0,0.22)';
  // top
  ctx.fillRect(play.left, 0, play.right - play.left, CUSHION_W);
  // bottom
  ctx.fillRect(play.left, H - CUSHION_W, play.right - play.left, CUSHION_W);
  // left
  ctx.fillRect(0, play.top, CUSHION_W, play.bottom - play.top);
  // right
  ctx.fillRect(W - CUSHION_W, play.top, CUSHION_W, play.bottom - play.top);
  ctx.restore();
}

// ===================== INPUT HANDLING =====================
function setupMouseEvents() {
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function setupTouchEvents() {
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });

  const shotBtn = document.getElementById('shotBtn');
  shotBtn.addEventListener('pointerdown', () => {
    if (controlMode === 'phone' && !ballsMoving && gameStarted && !cueBallPlacement) {
      charging = true; chargeStart = performance.now();
      shotBtn.classList.add('charging');
      chargePowerLoop();
    }
  });
  shotBtn.addEventListener('pointerup', () => {
    if (charging) { charging = false; shotBtn.classList.remove('charging'); fireShot(); }
  });
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function onMouseDown(e) {
  if (!gameStarted) return;
  const pos = getCanvasPos(e);

  if (handleInteractionClick(pos.x, pos.y)) return;

  if (cueBallPlacement) {
    placeCueBall(pos.x, pos.y);
    return;
  }

  if (controlMode === 'mouse') {
    if (e.button === 0 && !ballsMoving) {
      charging = true;
      chargeStart = performance.now();
      chargePowerLoop();
    }
  }
}

function onMouseMove(e) {
  if (!gameStarted) return;
  const pos = getCanvasPos(e);
  lastMousePos = pos;

  const cue = getCueBall();
  if (cue && !cue.pocketed) {
    aimAngle = Math.atan2(pos.y - cue.y, pos.x - cue.x) + Math.PI;
    renderFrame();
  }
}

function onMouseUp(e) {
  if (!gameStarted) return;
  if (controlMode === 'mouse' && charging) {
    charging = false;
    fireShot();
  }
}

function onTouchStart(e) {
  e.preventDefault();
  if (!gameStarted) return;
  const t = e.touches[0];
  const pos = getCanvasPos(t);

  if (handleInteractionClick(pos.x, pos.y)) return;
  if (cueBallPlacement) { placeCueBall(pos.x, pos.y); return; }

  if (controlMode === 'phone') {
    phoneDragStart = pos;
    phoneDragging = false;
  }
}

function onTouchMove(e) {
  e.preventDefault();
  if (!gameStarted) return;
  if (controlMode === 'phone' && phoneDragStart) {
    const t = e.touches[0];
    const pos = getCanvasPos(t);
    const dx = pos.x - phoneDragStart.x, dy = pos.y - phoneDragStart.y;
    if (Math.sqrt(dx*dx+dy*dy) > 5) phoneDragging = true;
    const cue = getCueBall();
    if (cue && phoneDragging) {
      aimAngle = Math.atan2(dy, dx) + Math.PI;
      renderFrame();
    }
  }
}

function onTouchEnd(e) {
  e.preventDefault();
  phoneDragStart = null;
}

let chargePowerAnimId = null;
function chargePowerLoop() {
  if (!charging) return;
  const elapsed = (performance.now() - chargeStart) / 1000;
  let p = Math.min(elapsed / 1.5, 1);
  if (activeEffects.roidRage) p = Math.max(p, 0.75);
  if (activeEffects.coolHands) p = Math.min(p, 0.25);
  shotPower = p;
  updatePowerBar(shotPower);
  chargePowerAnimId = requestAnimationFrame(chargePowerLoop);
}

function fireShot() {
  if (chargePowerAnimId) { cancelAnimationFrame(chargePowerAnimId); chargePowerAnimId = null; }
  const p = shotPower;
  shotPower = 0;
  updatePowerBar(0);
  if (p > 0.02) shoot(p, aimAngle);
}

function placeCueBall(x, y) {
  const cue = getCueBall();
  if (!cue) return;
  const play = getPlayArea();
  // Clamp to play area
  x = Math.max(play.left + cue.r, Math.min(play.right - cue.r, x));
  y = Math.max(play.top + cue.r, Math.min(play.bottom - cue.r, y));
  // Check no overlap
  const overlapping = balls.some(b => !b.pocketed && b.num !== 0 && Math.hypot(b.x-x, b.y-y) < b.r + cue.r + 2);
  if (overlapping) { showToast('Can\'t place there!'); return; }
  cue.x = x; cue.y = y;
  cueBallPlacement = false;
  updateStatusMsg(players[currentPlayer].name + "'s turn");
  renderFrame();
}

// ===================== UI HELPERS =====================
function getCueBall() { return balls.find(b => b.num === 0); }

function updatePlayerUI() {
  const pi = document.getElementById('playerInfo');
  pi.innerHTML = '';
  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'player-row' + (i === currentPlayer ? ' active-turn' : '');
    const swatchColor = ['#ffd700','#4a9eff','#ff6b6b','#4aff4a'][i] || '#888';
    const groupLabel = p.group ? ` (${p.group})` : '';
    const ballsLeft = variant === 'eight' && p.group ? balls.filter(b => !b.pocketed && (p.group === 'solids' ? b.num <= 7 : b.num >= 9)).length : '';
    div.innerHTML = `<div class="player-swatch" style="background:${swatchColor}"></div><div class="player-name">${p.name}${groupLabel}</div><div class="player-score">${ballsLeft !== '' ? ballsLeft + ' left' : ''}</div>`;
    pi.appendChild(div);
  });
}

function updateHandUI() {
  const ha = document.getElementById('handArea');
  const player = players[currentPlayer];
  if (!player || !player.hand.length) {
    ha.innerHTML = '<span style="font-size:11px;color:#555">No cards</span>';
    return;
  }
  ha.innerHTML = '';
  player.hand.forEach(card => {
    const div = document.createElement('div');
    div.className = 'card-item';
    div.innerHTML = `<div class="card-name">${card.icon || ''} ${card.name}</div><div class="card-desc">${card.desc}</div>`;
    ha.appendChild(div);
  });
}

function updateEffectsUI() {
  const ed = document.getElementById('effectsDisplay');
  const ae = activeEffects;
  const chips = [];
  if (ae.fogOfWar)         chips.push('🌫️ Fog of War');
  if (ae.confusion)        chips.push('🔀 Confusion');
  if (ae.cloaked != null)  chips.push('👻 Cloak');
  if (ae.sticky)           chips.push('🍯 Sticky Cue');
  if (ae.drunk)            chips.push('🍺 Drunk');
  if (ae.shortsighted)     chips.push('🔭 Shortsighted');
  if (ae.roidRage)         chips.push('💢 Roid Rage ≥75%');
  if (ae.coolHands)        chips.push('🧊 Cool Hands ≤25%');
  if (ae.bigBall)          chips.push('🔵 Big Cue Ball');
  if (ae.smallBall)        chips.push('⚬ Small Cue Ball');
  if (ae.oilCue)           chips.push('💧 Oil Cue');
  if (ae.reverseSpin)      chips.push('↩️ Reverse Spin');
  if (ae.mirror)           chips.push('🪞 Mirror');
  if (ae.magnet)           chips.push('🧲 Magnet');
  if (ae.turbo)            chips.push('⚡ Turbo');
  if (ae.bouncer)          chips.push('🔴 Bouncer');
  if (ae.bounceHouseRail && ae.bounceHouseRail.length) chips.push('🎪 Bounce House: ' + ae.bounceHouseRail.join(', '));
  if (ae.deadRail && ae.deadRail.length)    chips.push('🪵 Dead Rail: ' + ae.deadRail.join(', '));
  if (ae.bearTrapZone)     chips.push('🪤 Bear Trap');
  if (ae.icePatch)         chips.push('🧊 Ice Patch');
  if (ae.mudPatch)         chips.push('💩 Mud Patch');
  if (ae.portals && ae.portals.length) chips.push('🌀 Portal ×' + ae.portals.length);
  if (ae.blockedPockets && ae.blockedPockets.length) chips.push('🚫 Blocked ×' + ae.blockedPockets.length);
  if (ae.openPockets && ae.openPockets.length) chips.push('✅ Open ×' + ae.openPockets.length);
  if (ae.shrunkPockets && ae.shrunkPockets.length) chips.push('🔩 Shrunk ×' + ae.shrunkPockets.length);
  if (ae.crosswind)        chips.push('💨 Crosswind');
  if (ae.warpCorners)      chips.push('🌊 Warp Rail');
  if (!chips.length) {
    ed.innerHTML = '<span style="font-size:11px;color:#555">None</span>';
    return;
  }
  ed.innerHTML = chips.map(c => `<div class="effect-tag">${c}</div>`).join('');
}

function updateStatusMsg(msg) {
  document.getElementById('statusMsg').textContent = msg;
}

function updatePowerBar(p) {
  const bar = document.getElementById('powerBar');
  const fill = document.getElementById('powerFillInner');
  const pct = document.getElementById('powerPct');
  if (p > 0) {
    bar.style.display = 'flex';
    fill.style.width = (p * 100) + '%';
    pct.textContent = Math.round(p * 100) + '%';
  } else {
    bar.style.display = 'none';
  }
}

function showGameOver(winnerIdx, reason) {
  gameOver = true;
  gameStarted = false;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  document.getElementById('overlayTitle').textContent = '🎱 Game Over!';
  document.getElementById('overlayMsg').textContent = reason || (players[winnerIdx] ? players[winnerIdx].name + ' wins!' : 'Game over!');
  document.getElementById('overlay').classList.remove('hidden');
  SFX.win();
  renderFrame();
}

function showToast(msg, duration = 1800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function copyInvite() {
  const url = document.getElementById('inviteUrl').value;
  if (url) {
    navigator.clipboard.writeText(url).then(() => showToast('Invite URL copied!')).catch(() => showToast('Copy failed'));
  }
}

// ===================== GUIDE TEXT =====================
function getGuideTextForVariant(v) {
  const guides = {
    eight: `<b>8-Ball</b><br>Pocket all your group (solids 1–7 or stripes 9–15) then sink the 8-ball to win.<br><br>Scratch or sinking the 8-ball early = loss. Keep turn by potting your balls.`,
    nine: `<b>9-Ball</b><br>Always hit the lowest numbered ball first. Pocket the 9-ball to win at any time.<br><br>Foul if you miss the lowest ball. Your opponent can re-spot.`,
    cutthroat: `<b>Cutthroat (3P)</b><br>Each player owns a group of 5. Last player with balls still on the table wins.<br><br>You want to pocket <i>your opponents'</i> balls, not your own.`,
    doubles: `<b>Doubles (2v2)</b><br>Teams: P1+P3 vs P2+P4. Same rules as 8-ball but teammates alternate turns.<br><br>Communicate with your partner about strategy!`,
  };
  return guides[v] || guides.eight;
}

function updateGuideCopy() {
  const v = document.getElementById('variantSelect')?.value || variant;
  document.getElementById('guideText').innerHTML = getGuideTextForVariant(v);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('variantSelect').addEventListener('change', () => {
    updateGuideCopy();
    const v = document.getElementById('variantSelect').value;
    const is3p = v === 'cutthroat', is4p = v === 'doubles';
    document.getElementById('p3nameLabel').style.display = (is3p || is4p) ? '' : 'none';
    document.getElementById('p3name').style.display = (is3p || is4p) ? '' : 'none';
    document.getElementById('p4nameLabel').style.display = is4p ? '' : 'none';
    document.getElementById('p4name').style.display = is4p ? '' : 'none';
  });
});

// ===================== ONLINE =====================
async function onCreateRoom() {
  const serverUrl = document.getElementById('serverUrlInput').value.trim() || window.location.origin;
  onlineApiBase = serverUrl;
  const name = document.getElementById('p1name').value || 'Player 1';
  try {
    const res = await fetch(serverUrl + '/api/create-room', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
    const data = await res.json();
    if (data.code) {
      onlineRoom = data.code;
      onlineToken = data.token;
      onlinePlayerIdx = 0;
      document.getElementById('roomCodeInput').value = data.code;
      document.getElementById('onlineStatus').textContent = 'Room created: ' + data.code;
      setInviteUrl(data.code, serverUrl);
      showToast('Room created: ' + data.code);
    }
  } catch(e) { document.getElementById('onlineStatus').textContent = 'Error: ' + e.message; }
}

async function onJoinRoom() {
  const serverUrl = document.getElementById('serverUrlInput').value.trim() || window.location.origin;
  onlineApiBase = serverUrl;
  const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  const name = document.getElementById('p2name').value || 'Player 2';
  if (!code) { showToast('Enter a room code.'); return; }
  try {
    const res = await fetch(serverUrl + '/api/join-room', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ code, name }) });
    const data = await res.json();
    if (data.token) {
      onlineRoom = code;
      onlineToken = data.token;
      onlinePlayerIdx = data.seat;
      document.getElementById('onlineStatus').textContent = 'Joined room: ' + code + ' as player ' + (data.seat + 1);
      showToast('Joined room ' + code);
    } else {
      document.getElementById('onlineStatus').textContent = data.error || 'Join failed';
    }
  } catch(e) { document.getElementById('onlineStatus').textContent = 'Error: ' + e.message; }
}

function setInviteUrl(code, serverUrl) {
  const pubUrl = document.getElementById('onlinePublicUrlInput').value.trim() || serverUrl;
  const origin = window.location.origin + window.location.pathname;
  let url = pubUrl + '?room=' + code;
  if (pubUrl !== serverUrl) url += '&server=' + encodeURIComponent(serverUrl);
  document.getElementById('inviteUrl').value = url;
  document.getElementById('inviteRow').style.display = 'flex';
}

function isLocalCardInteractionWindow() {
  return cardPhaseActive || pendingInteraction !== null;
}

function serializeGameSnapshot() {
  return {
    balls: balls.map(b => ({ ...b })),
    pockets: pockets.map(p => ({ ...p })),
    players: players.map(p => ({ ...p, hand: p.hand.map(c => c.id) })),
    currentPlayer,
    variant,
    activeEffects: JSON.parse(JSON.stringify(activeEffects)),
    gameOver,
    cueBallPlacement,
    started: gameStarted,
    version: onlineSnapshotVersion + 1,
  };
}

async function queueOnlineSync() {
  if (!onlineRoom || !onlineToken) return;
  const snap = serializeGameSnapshot();
  try {
    await fetch(onlineApiBase + '/api/update-state', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ code: onlineRoom, token: onlineToken, state: snap }) });
  } catch(e) {}
}

async function pollOnlineState() {
  if (!onlineRoom || !onlineToken || onlinePolling) return;
  onlinePolling = true;
  try {
    const res = await fetch(`${onlineApiBase}/api/state?code=${onlineRoom}&token=${onlineToken}&since=${onlineSnapshotVersion}&timeout=20000`);
    const data = await res.json();
    if (data.state && data.state.version > onlineSnapshotVersion) {
      applyGameSnapshot(data.state);
    }
  } catch(e) {} finally {
    onlinePolling = false;
    if (onlineRoom) setTimeout(pollOnlineState, 1000);
  }
}

function applyGameSnapshot(snap) {
  onlineSnapshotVersion = snap.version;
  balls = snap.balls.map(b => ({ ...b }));
  pockets = snap.pockets.map(p => ({ ...p }));
  currentPlayer = snap.currentPlayer;
  activeEffects = snap.activeEffects || {};
  gameOver = snap.gameOver || false;
  cueBallPlacement = snap.cueBallPlacement || false;
  players.forEach((p, i) => {
    if (snap.players[i]) {
      p.hand = (snap.players[i].hand || []).map(id => CARD_POOL.find(c => c.id === id)).filter(Boolean);
      p.group = snap.players[i].group;
      p.score = snap.players[i].score;
    }
  });
  if (snap.started && !gameStarted) {
    gameStarted = true;
    setSetupOverlayVisible(false);
  }
  updatePlayerUI();
  updateHandUI();
  updateEffectsUI();
  renderFrame();
}
