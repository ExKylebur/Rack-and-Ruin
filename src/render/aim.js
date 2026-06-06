// render/aim.js — aim guide: dotted trajectory (with one rail/▢ ball stop),
// a ghost cue ball at the contact point, and the cue stick pulled back by power.
// Drawn in display pixels from the live state.

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
  const step = Math.max(3, base * 0.35);
  const maxLen = state.dims.w * 2.5;

  let x = cue.x, y = cue.y, len = 0;
  const pts = [{ x, y }];
  let hit = false;

  while (len < maxLen) {
    x += dx * step; y += dy * step; len += step;
    let stop = false;
    if (x - cue.r < pa.left) { x = pa.left + cue.r; stop = true; }
    else if (x + cue.r > pa.right) { x = pa.right - cue.r; stop = true; }
    if (y - cue.r < pa.top) { y = pa.top + cue.r; stop = true; }
    else if (y + cue.r > pa.bottom) { y = pa.bottom - cue.r; stop = true; }

    for (const b of state.balls) {
      if (b.pocketed || b.num === 0) continue;
      const bp = toPx({ u: b.u, v: b.v }, state.dims);
      const br = cue.r + base * (b.size || 1);
      if ((bp.x - x) ** 2 + (bp.y - y) ** 2 < br * br) { hit = true; stop = true; break; }
    }
    pts.push({ x, y });
    if (stop) break;
  }

  ctx.save();
  // dotted sight line
  ctx.strokeStyle = `rgba(255,255,255,${0.38 + power * 0.32})`;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.setLineDash([]);

  // ghost cue ball at the contact point
  if (hit) {
    const e = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(e.x, e.y, cue.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // cue stick, butt behind the ball, pulled back with power
  const pull = cue.r * 0.5 + power * cue.r * 3;
  const tipX = cue.x - dx * (cue.r + 2 + pull);
  const tipY = cue.y - dy * (cue.r + 2 + pull);
  const len2 = base * 8.5;
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
