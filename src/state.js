// state.js — the single source of truth.
//
// Everything (physics, cards, render, network) reads and mutates THIS object.
// Render is a pure function of it. Positions are stored in table-relative units
// {u,v} in 0..1 of the play area (Decision D1) so the state is resolution-
// independent and serializes cleanly for online play.
//
// Ball radius is stored as a `size` multiplier of the base ball radius, not in
// pixels — so Big Ball / Small Ball are just `size: 2` / `size: 0.5` and render
// correctly at any resolution.

import { fitCanvas, playArea, toRel, unitsFor } from './geometry.js';

// Ball colours: index = ball number (0=cue, 1-7 solid, 8 black, 9-15 stripe).
export const BALL_COLORS = [
  '#f4f4f4', '#f9d03f', '#2563eb', '#dc2626', '#7e22ce', '#ea580c', '#16a34a',
  '#7f1d1d', '#111111', '#f9d03f', '#2563eb', '#dc2626', '#7e22ce', '#ea580c',
  '#16a34a', '#7f1d1d',
];

// Canonical dimensions used only to lay out the rack in relative coords. Because
// the play area is always 2:1 and units scale linearly with width, the resulting
// {u,v} are independent of the actual canvas size.
const CANON = fitCanvas(1000, 1e9); // -> { w: 1000, h: ~545.5 }

export function createGameState() {
  return {
    version: 0,
    started: false,
    gameOver: false,
    gameOverReason: '',
    broken: false,         // has the opening break been taken?
    ballInHand: false,     // incoming player may place the cue anywhere
    cardsEnabled: true,
    variant: 'eight',
    dims: { w: 0, h: 0 },
    balls: [],
    movedPockets: {},      // pocketIndex -> {u,v}; Move Hole / Warp Rail write here
    pocketState: {},        // pocketIndex -> {blocked,shrunk,open} flags
    players: [],            // { name, group, hand:[cardId], seat }
    currentPlayer: 0,
    cardPhasePlayer: null,  // explicit; replaces fragile currentPlayer±1 math
    activeEffects: {},
    turn: { firstHit: null, pocketed: [], foul: false },
  };
}

function mkBall(num, u, v) {
  return {
    num, u, v,
    vx: 0, vy: 0,         // px/frame, ephemeral (only non-zero mid-shot)
    size: 1,              // radius multiplier of base ballR
    c: BALL_COLORS[num] || '#cccccc',
    stripe: num >= 9 && num <= 15,
    roll: 0,
    pocketed: false,
  };
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// 8-ball: apex = 1, centre = 8, one solid + one stripe in the rear corners,
// the rest randomised (a legal-looking constrained rack).
export function eightBallRackNumbers() {
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const rack = Array(15).fill(0);
  rack[0] = 1;   // apex
  rack[4] = 8;   // centre
  const cornerSolid = shuffle([...solids]).find((n) => n !== 1);
  const cornerStripe = shuffle([...stripes])[0];
  rack[10] = cornerSolid;
  rack[14] = cornerStripe;
  const used = new Set([1, 8, cornerSolid, cornerStripe]);
  const remaining = shuffle([...solids, ...stripes].filter((n) => !used.has(n)));
  let ri = 0;
  for (let i = 0; i < 15; i++) if (rack[i] === 0) rack[i] = remaining[ri++];
  return rack;
}

function relAt(px) {
  return toRel(px, CANON);
}

function rackEight(balls, headX, headY, spacing) {
  const nums = eightBallRackNumbers();
  let idx = 0;
  const cos30 = Math.cos(Math.PI / 6);
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const x = headX + row * spacing * cos30;
      const y = headY + (col - row / 2) * spacing;
      const rel = relAt({ x, y });
      balls.push(mkBall(nums[idx++], rel.u, rel.v));
    }
  }
}

function rackNine(balls, headX, headY, spacing) {
  const positions = [
    [0, 0], [-1, -1], [-1, 1], [-2, -2], [-2, 0], [-2, 2], [-3, -1], [-3, 1], [-4, 0],
  ];
  const inner = shuffle([2, 3, 4, 5, 6, 7, 8]);
  const order = [1, ...inner, 9];
  const cos30 = Math.cos(Math.PI / 6);
  positions.forEach(([col, row], i) => {
    const x = headX + col * spacing * cos30 * -1;
    const y = headY + row * spacing * 0.5;
    const rel = relAt({ x, y });
    balls.push(mkBall(order[i], rel.u, rel.v));
  });
}

export function rackBalls(state) {
  const pa = playArea(CANON);
  const u = unitsFor(CANON);
  const spacing = u.ballR * 2.05;
  const balls = [];
  // Cue ball at the head-spot quarter; rack apex at ~65% down the table.
  const cueRel = relAt({ x: pa.left + pa.w * 0.25, y: pa.cy });
  balls.push(mkBall(0, cueRel.u, cueRel.v));
  const headX = pa.left + pa.w * 0.65;
  if (state.variant === 'nine') rackNine(balls, headX, pa.cy, spacing);
  else rackEight(balls, headX, pa.cy, spacing);
  state.balls = balls;
}

// ---- Serialization (online snapshots) -------------------------------------
// State is already plain data; we strip ephemeral velocities and reference the
// card pool by id only. Card ids must stay stable across versions.
export function serializeSnapshot(state) {
  return {
    version: (state.version || 0) + 1,
    started: state.started,
    gameOver: state.gameOver,
    gameOverReason: state.gameOverReason || '',
    broken: state.broken,
    ballInHand: state.ballInHand,
    cardsEnabled: state.cardsEnabled,
    variant: state.variant,
    balls: state.balls.map((b) => ({
      num: b.num, u: b.u, v: b.v, size: b.size, stripe: b.stripe,
      pocketed: b.pocketed,
      heavyweight: !!b.heavyweight, lightweight: !!b.lightweight,
    })),
    movedPockets: state.movedPockets,
    pocketState: state.pocketState,
    players: state.players.map((p) => ({
      name: p.name, group: p.group, seat: p.seat,
      hand: (p.hand || []).map((c) => (typeof c === 'string' ? c : c.id)),
    })),
    currentPlayer: state.currentPlayer,
    activeEffects: state.activeEffects,
  };
}

// Apply a received snapshot onto the live state (replaces the table & turn). Pure
// data — UI/render is the caller's job.
export function applySnapshot(state, snap) {
  state.version = snap.version;
  state.started = snap.started;
  state.gameOver = snap.gameOver;
  state.gameOverReason = snap.gameOverReason || '';
  state.broken = snap.broken;
  state.ballInHand = snap.ballInHand;
  if (snap.cardsEnabled !== undefined) state.cardsEnabled = snap.cardsEnabled;
  state.variant = snap.variant;
  state.balls = snap.balls.map((b) => ({
    num: b.num, u: b.u, v: b.v, vx: 0, vy: 0, size: b.size ?? 1,
    c: BALL_COLORS[b.num] || '#cccccc', stripe: b.stripe, roll: 0,
    pocketed: b.pocketed, heavyweight: !!b.heavyweight, lightweight: !!b.lightweight,
  }));
  state.movedPockets = snap.movedPockets || {};
  state.pocketState = snap.pocketState || {};
  state.activeEffects = snap.activeEffects || {};
  state.currentPlayer = snap.currentPlayer;
  (snap.players || []).forEach((sp, i) => {
    if (!state.players[i]) state.players[i] = { name: sp.name, seat: i };
    state.players[i].name = sp.name;
    state.players[i].group = sp.group;
    state.players[i].hand = (sp.hand || []).slice();
  });
}
