// render/aim.js — aim guide: dotted line to the first rail/ball, a ghost cue ball
// resting tangent at the exact contact point, the struck ball's cut line, and the
// cue stick pulled back by power. Drawn in display pixels from the live state.
// Contact uses analytic ray–circle intersection (no discrete stepping), so the
// ghost never clips into the target as you slide the aim around it.

import { playArea, toPx, unitsFor } from '../geometry.js';

function cuePx(state) {
  const cue = state.balls.find((b) => b.num === 0 && !b.pocketed);
  if (!cue) return null;
  const p = toPx({ u: cue.u, v: cue.v }, state.dims);
  const r = unitsFor(state.dims).ballR * (cue.size || 1);
  return { x: p.x, y: p.y, r };
}

export function drawAim(ctx, state, angle, power) {
  const cue = cuePx(state);
  if (!cue) return;
  const pa = playArea(state.dims);
  const base = unitsFor(state.dims).ballR;

  const dx = Math.cos(angle), dy = Math.sin(angle);

  // Distance along the aim ray to the first rail (cue edge inset).
  let railT = state.dims.w * 3;
  if (dx > 1e-9) railT = Math.min(railT, (pa.right - cue.r - cue.x) / dx);
  else if (dx < -1e-9) railT = Math.min(railT, (pa.left + cue.r - cue.x) / dx);
  if (dy > 1e-9) railT = Math.min(railT, (pa.bottom - cue.r - cue.y) / dy);
  else if (dy < -1e-9) railT = Math.min(railT, (pa.top + cue.r - cue.y) / dy);
  if (!(railT > 0)) railT = state.dims.w * 3;

  // Nearest object-ball contact via EXACT ray–circle intersection, so the ghost
  // ball rests perfectly tangent to the target — sliding the aim around a ball no
  // longer clips the ghost inside it (the old discrete march overshot by a step).
  let ballT = Infinity, target = null;
  for (const b of state.balls) {
    if (b.pocketed || b.num === 0) continue;
    const bp = toPx({ u: b.u, v: b.v }, state.dims);
    const br = cue.r + base * (b.size || 1);
    const fx = cue.x - bp.x, fy = cue.y - bp.y;
    const proj = fx * dx + fy * dy;            // f·d (d is a unit vector)
    const c = fx * fx + fy * fy - br * br;
    const disc = proj * proj - c;
    if (disc < 0) continue;                     // ray misses this ball
    const t = -proj - Math.sqrt(disc);          // nearest entering distance
    if (t > 0 && t < ballT) { ballT = t; target = bp; }
  }

  const hit = ballT < railT;
  const stopT = Math.min(ballT, railT);
  const end = { x: cue.x + dx * stopT, y: cue.y + dy * stopT };

  ctx.save();
  // dotted sight line from the cue ball to the contact point
  ctx.strokeStyle = `rgba(255,255,255,${0.38 + power * 0.32})`;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // ghost cue ball at the tangent contact point + the object ball's cut line
  if (hit && target) {
    ctx.beginPath();
    ctx.arc(end.x, end.y, cue.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // the struck ball is driven from the contact point through its own centre
    let ox = target.x - end.x, oy = target.y - end.y;
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    ctx.strokeStyle = 'rgba(140,225,255,0.85)'; // cyan — high contrast on the felt
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(target.x + ox * base * 4, target.y + oy * base * 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // cue stick, butt behind the ball, pulled back with power
  const pull = cue.r * 0.5 + power * cue.r * 3;
  const tipX = cue.x - dx * (cue.r + 2 + pull);
  const tipY = cue.y - dy * (cue.r + 2 + pull);
  const len2 = base * 22; // real cue proportion (~25 ball-diameters long)
  const butX = tipX - dx * len2;
  const butY = tipY - dy * len2;
  const g = ctx.createLinearGradient(tipX, tipY, butX, butY);
  g.addColorStop(0, 'rgba(235,210,145,0.94)');
  g.addColorStop(0.3, 'rgba(188,138,68,0.88)');
  g.addColorStop(1, 'rgba(80,45,15,0.72)');
  ctx.strokeStyle = g;
  ctx.lineWidth = Math.max(3, base * 0.45);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(butX, butY);
  ctx.stroke();
  ctx.restore();
}
