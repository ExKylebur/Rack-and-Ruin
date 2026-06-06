// physics.js — pure pool physics, run in a FIXED canonical pixel space (CANON),
// independent of the display canvas size. State stores relative {u,v}; we lift
// to canonical px to simulate, then write back. Because the space is fixed,
// every machine simulates a shot identically — the basis for online play
// (Decision D2: shooter simulates, then broadcasts the settled state).

import { fitCanvas, playArea, pocketLayout, cushions, toPx, toRel, unitsFor } from './geometry.js';

const CANON = fitCanvas(1000, 1e9);
const PA = playArea(CANON);
const U = unitsFor(CANON);
const FACES = cushions(CANON).list.flatMap((c) => c.faces); // angled cushion faces

export const BASE_BALL_R = U.ballR;
export const FRICTION = 0.986;     // velocity retained per frame
export const WALL_DAMP = 0.72;     // normal velocity retained per rail bounce
export const TANG_DAMP = 0.96;     // tangential velocity retained per rail bounce
export const MIN_SPEED = 0.04;     // below this a ball is considered stopped
export const MAX_SHOT_SPEED = 38;  // px/frame at CANON scale, at full power
export const POCKET_PULL_RADIUS = 1.15; // capture reach (incl. recessed side pockets)

// Build the px working set from state (called at shot start).
export function makeSim(state) {
  return state.balls.map((b) => {
    const p = toPx({ u: b.u, v: b.v }, CANON);
    return {
      num: b.num, x: p.x, y: p.y, vx: b.vx || 0, vy: b.vy || 0,
      r: BASE_BALL_R * (b.size || 1), size: b.size || 1,
      pocketed: b.pocketed, roll: b.roll || 0,
      heavyweight: !!b.heavyweight, lightweight: !!b.lightweight,
    };
  });
}

export function pocketsFor(state) {
  return pocketLayout(CANON, state.movedPockets);
}

export function freshTurn() {
  return { firstHit: null, pocketed: [], cueScratched: false };
}

export function applyShot(sim, power, angle) {
  const cue = sim.find((b) => b.num === 0 && !b.pocketed);
  if (!cue) return;
  cue.vx = Math.cos(angle) * power * MAX_SHOT_SPEED;
  cue.vy = Math.sin(angle) * power * MAX_SHOT_SPEED;
}

// Bounce a ball off one cushion face (a line segment with inward normal). The
// closest-point test means corners/jaw tips deflect correctly, so a ball glancing
// a jaw is funneled toward the pocket instead of rebounding flat.
function collideFace(b, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((b.x - s.x1) * dx + (b.y - s.y1) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = s.x1 + t * dx, py = s.y1 + t * dy;
  let ox = b.x - px, oy = b.y - py;
  const d = Math.hypot(ox, oy);
  if (d >= b.r) return;
  let nx, ny;
  if (d > 1e-6) { nx = ox / d; ny = oy / d; } else { nx = s.nx; ny = s.ny; }
  b.x = px + nx * b.r; b.y = py + ny * b.r;            // push out of the cushion
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {                                         // moving into the face
    b.vx = (b.vx - vn * nx) * TANG_DAMP - WALL_DAMP * vn * nx;
    b.vy = (b.vy - vn * ny) * TANG_DAMP - WALL_DAMP * vn * ny;
  }
}

function railBounce(b) {
  for (const s of FACES) collideFace(b, s);
  // Backstop net at the felt edge: a ball that entered a pocket mouth but wasn't
  // captured rattles back instead of escaping into the rail/wood.
  if (b.x - b.r < PA.left)   { b.x = PA.left + b.r;   if (b.vx < 0) b.vx = -b.vx * WALL_DAMP; }
  if (b.x + b.r > PA.right)  { b.x = PA.right - b.r;  if (b.vx > 0) b.vx = -b.vx * WALL_DAMP; }
  if (b.y - b.r < PA.top)    { b.y = PA.top + b.r;    if (b.vy < 0) b.vy = -b.vy * WALL_DAMP; }
  if (b.y + b.r > PA.bottom) { b.y = PA.bottom - b.r; if (b.vy > 0) b.vy = -b.vy * WALL_DAMP; }
}

function pocketCheck(b, pockets, turn) {
  for (const p of pockets) {
    const dx = b.x - p.x, dy = b.y - p.y;
    const cap = p.r * POCKET_PULL_RADIUS;
    if (dx * dx + dy * dy < cap * cap) {
      b.pocketed = true; b.vx = 0; b.vy = 0;
      turn.pocketed.push(b.num);
      if (b.num === 0) turn.cueScratched = true;
      return;
    }
  }
}

function massOf(b) { return b.heavyweight ? 3 : (b.lightweight ? 0.3 : 1); }

function collide(a, b, turn) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (dist >= min || dist < 1e-4) return;
  const nx = dx / dist, ny = dy / dist;
  const ov = min - dist;
  a.x -= nx * ov * 0.5; a.y -= ny * ov * 0.5;
  b.x += nx * ov * 0.5; b.y += ny * ov * 0.5;
  const dot = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (dot <= 0) return;
  const ma = massOf(a), mb = massOf(b);
  const imp = (2 * dot) / (ma + mb);
  a.vx -= imp * mb * nx; a.vy -= imp * mb * ny;
  b.vx += imp * ma * nx; b.vy += imp * ma * ny;
  if (turn.firstHit == null) {
    if (a.num === 0) turn.firstHit = b.num;
    else if (b.num === 0) turn.firstHit = a.num;
  }
}

// Advance one frame (dt in frame-units). Returns true if anything still moves.
export function step(sim, pockets, dt, turn) {
  for (const b of sim) {
    if (b.pocketed) continue;
    const fr = Math.pow(FRICTION, dt);
    b.vx *= fr; b.vy *= fr;
    const spd = Math.hypot(b.vx, b.vy);
    if (spd > MIN_SPEED) b.roll = (b.roll + spd * dt * 0.05) % (Math.PI * 2);
    if (Math.abs(b.vx) < MIN_SPEED && Math.abs(b.vy) < MIN_SPEED) { b.vx = 0; b.vy = 0; }
    else { b.x += b.vx * dt; b.y += b.vy * dt; }
    railBounce(b);
    pocketCheck(b, pockets, turn);
  }
  for (let i = 0; i < sim.length; i++) {
    for (let j = i + 1; j < sim.length; j++) {
      if (sim[i].pocketed || sim[j].pocketed) continue;
      collide(sim[i], sim[j], turn);
    }
  }
  return sim.some((b) => !b.pocketed && (Math.abs(b.vx) > MIN_SPEED || Math.abs(b.vy) > MIN_SPEED));
}

// Run a shot to rest synchronously (used in tests + headless validation).
export function runToRest(sim, pockets, turn, maxFrames = 6000) {
  let f = 0;
  while (step(sim, pockets, 1, turn) && f < maxFrames) f++;
  return f;
}

// Copy sim positions/velocities back into state (relative coords) for rendering.
export function syncToState(state, sim) {
  sim.forEach((s, i) => {
    const b = state.balls[i];
    b.pocketed = s.pocketed;
    const rel = toRel({ x: s.x, y: s.y }, CANON);
    b.u = rel.u; b.v = rel.v;
    b.vx = s.vx; b.vy = s.vy; b.roll = s.roll;
  });
}

// Final settle: positions written back, velocities zeroed.
export function commit(state, sim) {
  syncToState(state, sim);
  state.balls.forEach((b) => { b.vx = 0; b.vy = 0; });
}
