// physics.js — pure pool physics in a FIXED canonical pixel space (CANON), so
// every machine simulates a shot identically (basis for online).
//
// Card effects are read from an optional `env = { effects, pocketState }`:
// friction zones, magnet, crosswind, bouncer, bear trap, portals, per-rail bounce,
// blocked/shrunk pockets, sticky cue, reverse spin. With no env it's plain pool.

import { fitCanvas, playArea, pocketLayout, cushions, toPx, toRel, unitsFor } from './geometry.js';

const CANON = fitCanvas(1000, 1e9);
const PA = playArea(CANON);
const U = unitsFor(CANON);
const CUSH = cushions(CANON);
const FACES = CUSH.list.flatMap((c) => c.faces);

export const BASE_BALL_R = U.ballR;
export const FRICTION = 0.986;
export const WALL_DAMP = 0.72;
export const TANG_DAMP = 0.96;
export const MIN_SPEED = 0.04;
export const MAX_SHOT_SPEED = 38;
export const POCKET_PULL_RADIUS = 1.15;

// zone radii in CANON px
const Z = { ice: U.ballR * 5.3, mud: U.ballR * 4.8, bouncer: U.ballR * 0.95, trap: U.ballR * 1.2, portal: U.ballR * 1.4 };

const zpx = (rel) => toPx(rel, CANON);

export function makeSim(state) {
  return state.balls.map((b) => {
    const p = zpx({ u: b.u, v: b.v });
    return {
      num: b.num, x: p.x, y: p.y, vx: b.vx || 0, vy: b.vy || 0,
      r: BASE_BALL_R * (b.size || 1), size: b.size || 1,
      pocketed: b.pocketed, roll: b.roll || 0,
      heavyweight: !!b.heavyweight, lightweight: !!b.lightweight,
    };
  });
}

export function pocketsFor(state) { return pocketLayout(CANON, state.movedPockets); }
export function freshTurn() { return { firstHit: null, pocketed: [], cueScratched: false }; }

export function applyShot(sim, power, angle, effects = {}) {
  const cue = sim.find((b) => b.num === 0 && !b.pocketed);
  if (!cue) return;
  let p = power;
  if (effects.roidRage) p = Math.max(p, 0.75);
  if (effects.coolHands) p = Math.min(p, 0.25);
  let mult = effects.turbo ? 1.6 : 1;
  cue.vx = Math.cos(angle) * p * MAX_SHOT_SPEED * mult;
  cue.vy = Math.sin(angle) * p * MAX_SHOT_SPEED * mult;
  if (effects.drunk) { cue.vx += (Math.random() - 0.5) * p * 4; cue.vy += (Math.random() - 0.5) * p * 4; }
}

function railDampFor(rail, effects) {
  if (effects.bounceHouseRail && effects.bounceHouseRail.includes(rail)) return WALL_DAMP * 2.2;
  if (effects.deadRail && effects.deadRail.includes(rail)) return 0.1;
  return WALL_DAMP;
}

function collideFace(b, s, effects) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((b.x - s.x1) * dx + (b.y - s.y1) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = s.x1 + t * dx, py = s.y1 + t * dy;
  const ox = b.x - px, oy = b.y - py;
  const d = Math.hypot(ox, oy);
  if (d >= b.r) return;
  let nx, ny;
  if (d > 1e-6) { nx = ox / d; ny = oy / d; } else { nx = s.nx; ny = s.ny; }
  b.x = px + nx * b.r; b.y = py + ny * b.r;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    const damp = railDampFor(s.rail, effects);
    b.vx = (b.vx - vn * nx) * TANG_DAMP - damp * vn * nx;
    b.vy = (b.vy - vn * ny) * TANG_DAMP - damp * vn * ny;
  }
}

function railBounce(b, effects) {
  for (const s of FACES) collideFace(b, s, effects);
  if (b.x - b.r < PA.left)   { b.x = PA.left + b.r;   if (b.vx < 0) b.vx = -b.vx * WALL_DAMP; }
  if (b.x + b.r > PA.right)  { b.x = PA.right - b.r;  if (b.vx > 0) b.vx = -b.vx * WALL_DAMP; }
  if (b.y - b.r < PA.top)    { b.y = PA.top + b.r;    if (b.vy < 0) b.vy = -b.vy * WALL_DAMP; }
  if (b.y + b.r > PA.bottom) { b.y = PA.bottom - b.r; if (b.vy > 0) b.vy = -b.vy * WALL_DAMP; }
}

function pocketCheck(b, pockets, turn, pocketState) {
  for (const p of pockets) {
    const ps = pocketState && pocketState[p.index];
    if (ps && ps.blocked) continue;
    const dx = b.x - p.x, dy = b.y - p.y;
    let cap = p.r * POCKET_PULL_RADIUS;
    if (ps && ps.shrunk) cap *= 0.65;
    if (dx * dx + dy * dy < cap * cap) {
      b.pocketed = true; b.vx = 0; b.vy = 0;
      turn.pocketed.push(b.num);
      if (b.num === 0) turn.cueScratched = true;
      return;
    }
  }
}

const massOf = (b) => (b.heavyweight ? 3 : (b.lightweight ? 0.3 : 1));

function collide(a, b, turn, effects) {
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
  const rev = effects.reverseSpin ? -1 : 1;
  const ca = a.num === 0 ? rev : 1, cb = b.num === 0 ? rev : 1;
  a.vx = (a.vx - imp * mb * nx) * ca; a.vy = (a.vy - imp * mb * ny) * ca;
  b.vx = (b.vx + imp * ma * nx) * cb; b.vy = (b.vy + imp * ma * ny) * cb;
  if (effects.sticky && (a.num === 0 || b.num === 0)) {
    const cue = a.num === 0 ? a : b, obj = a.num === 0 ? b : a;
    if (!cue._stuck) { cue._stuck = true; const k = 0.35; cue.vx = cue.vx * (1 - k) + obj.vx * k; cue.vy = cue.vy * (1 - k) + obj.vy * k; }
  }
  if (turn.firstHit == null) {
    if (a.num === 0) turn.firstHit = b.num;
    else if (b.num === 0) turn.firstHit = a.num;
  }
}

function applyForces(b, dt, effects, pockets) {
  if (effects.magnet) {
    const spd = Math.hypot(b.vx, b.vy);
    if (spd > 0.5) {
      let nd = 1e9, nx = 0, ny = 0;
      for (const p of pockets) { const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < nd) { nd = d; nx = p.x; ny = p.y; } }
      if (nd < 150 && nd > 1e-4) { b.vx += (nx - b.x) / nd * 0.04 * dt; b.vy += (ny - b.y) / nd * 0.04 * dt; }
    }
  }
  if (effects.crosswind) b.x += effects.crosswind * 0.3 * dt;
  if (effects.bouncer) {
    const c = zpx(effects.bouncer); const R = Z.bouncer + b.r;
    const dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy);
    if (d < R && d > 0.01) {
      const nx = dx / d, ny = dy / d;
      b.x = c.x + nx * R; b.y = c.y + ny * R;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 2 * vn * nx * 0.92; b.vy -= 2 * vn * ny * 0.92; }
    }
  }
  if (effects.bearTrap) {
    const c = zpx(effects.bearTrap); const R = Z.trap + b.r;
    if ((b.x - c.x) ** 2 + (b.y - c.y) ** 2 <= R * R && Math.hypot(b.vx, b.vy) > 0.35) { b.vx = 0; b.vy = 0; }
  }
  if (effects.portals && effects.portals.length >= 2) {
    for (let i = 0; i < 2; i++) {
      const pin = zpx(effects.portals[i]); const out = zpx(effects.portals[1 - i]);
      if ((b.x - pin.x) ** 2 + (b.y - pin.y) ** 2 < Z.portal * Z.portal && b._portalCd !== 1 - i) {
        b.x = out.x; b.y = out.y; b._portalCd = i; return;
      }
    }
  } else if (b._portalCd !== undefined) {
    // clear cooldown once clear of any portal
    if (!effects.portals) b._portalCd = undefined;
  }
}

function frictionFor(b, effects) {
  let f = FRICTION;
  if (effects.icePatch) { const c = zpx(effects.icePatch); if ((b.x - c.x) ** 2 + (b.y - c.y) ** 2 < Z.ice * Z.ice) f = 0.9995; }
  if (effects.mudPatch) { const c = zpx(effects.mudPatch); if ((b.x - c.x) ** 2 + (b.y - c.y) ** 2 < Z.mud * Z.mud) f = 0.92; }
  if (b.num === 0 && effects.oilCue) f = Math.max(f, 0.9985);
  return f;
}

export function step(sim, pockets, dt, turn, env = {}) {
  const effects = env.effects || {};
  const pocketState = env.pocketState || null;
  for (const b of sim) {
    if (b.pocketed) continue;
    applyForces(b, dt, effects, pockets);
    if (b.num === 0 && effects.drunk) { b.vx += (Math.random() - 0.5) * 0.3; b.vy += (Math.random() - 0.5) * 0.3; }
    const fr = Math.pow(frictionFor(b, effects), dt);
    b.vx *= fr; b.vy *= fr;
    const spd = Math.hypot(b.vx, b.vy);
    if (spd > MIN_SPEED) b.roll = (b.roll + spd * dt * 0.05) % (Math.PI * 2);
    if (Math.abs(b.vx) < MIN_SPEED && Math.abs(b.vy) < MIN_SPEED) { b.vx = 0; b.vy = 0; }
    else { b.x += b.vx * dt; b.y += b.vy * dt; }
    railBounce(b, effects);
    pocketCheck(b, pockets, turn, pocketState);
  }
  for (let i = 0; i < sim.length; i++) {
    for (let j = i + 1; j < sim.length; j++) {
      if (sim[i].pocketed || sim[j].pocketed) continue;
      collide(sim[i], sim[j], turn, effects);
    }
  }
  return sim.some((b) => !b.pocketed && (Math.abs(b.vx) > MIN_SPEED || Math.abs(b.vy) > MIN_SPEED));
}

export function runToRest(sim, pockets, turn, maxFrames = 6000, env = {}) {
  let f = 0;
  while (step(sim, pockets, 1, turn, env) && f < maxFrames) f++;
  return f;
}

export function syncToState(state, sim) {
  sim.forEach((s, i) => {
    const b = state.balls[i];
    b.pocketed = s.pocketed;
    const rel = toRel({ x: s.x, y: s.y }, CANON);
    b.u = rel.u; b.v = rel.v;
    b.vx = s.vx; b.vy = s.vy; b.roll = s.roll;
  });
}

export function commit(state, sim) {
  syncToState(state, sim);
  state.balls.forEach((b) => { b.vx = 0; b.vy = 0; });
}
