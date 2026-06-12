// render/aim.js — aim guide: dotted line to the first rail/ball, a ghost cue ball
// resting tangent at the exact contact point, the struck ball's cut line, and the
// cue stick pulled back by power. Drawn in display pixels from the live state.
// Contact uses analytic ray–circle intersection (no discrete stepping), so the
// ghost never clips into the target as you slide the aim around it.

import { playArea, toPx, unitsFor } from '../geometry.js';
import { JUMP_RANGE_FRAC } from '../physics.js';

function cuePx(state) {
  const cue = state.balls.find((b) => b.num === 0 && !b.pocketed);
  if (!cue) return null;
  const p = toPx({ u: cue.u, v: cue.v }, state.dims);
  const r = unitsFor(state.dims).ballR * (cue.size || 1);
  return { x: p.x, y: p.y, r };
}

export function drawAim(ctx, state, angle, power, jump = false) {
  const cue = cuePx(state);
  if (!cue) return;
  const pa = playArea(state.dims);
  const base = unitsFor(state.dims).ballR;

  const dx = Math.cos(angle), dy = Math.sin(angle);

  // Jump shot armed: show the hop arc + landing spot instead of the roll guide.
  if (jump) {
    drawJumpPreview(ctx, state, cue, dx, dy, power, pa, base);
    return;
  }

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

  // Guide colour shifts white -> gold -> red as power builds.
  const p3 = Math.min(1, Math.max(0, power));
  const lerp = (a, b, k) => Math.round(a + (b - a) * k);
  const gc = p3 < 0.5
    ? [lerp(255, 255, p3 * 2), lerp(255, 201, p3 * 2), lerp(255, 77, p3 * 2)]
    : [255, lerp(201, 77, (p3 - 0.5) * 2), lerp(77, 107, (p3 - 0.5) * 2)];
  const guide = (a) => `rgba(${gc[0]},${gc[1]},${gc[2]},${a})`;

  ctx.save();
  // dotted sight line from the cue ball to the contact point, with a soft glow
  ctx.shadowColor = guide(0.8);
  ctx.shadowBlur = 5 + power * 8;
  ctx.strokeStyle = guide(0.45 + power * 0.4);
  ctx.lineWidth = 1.4;
  ctx.setLineDash([6, 7]);
  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  // ghost cue ball at the tangent contact point + the object ball's cut line
  if (hit && target) {
    ctx.beginPath();
    ctx.arc(end.x, end.y, cue.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
    ctx.strokeStyle = guide(0.65);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    // contact crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(end.x - cue.r * 0.3, end.y); ctx.lineTo(end.x + cue.r * 0.3, end.y);
    ctx.moveTo(end.x, end.y - cue.r * 0.3); ctx.lineTo(end.x, end.y + cue.r * 0.3);
    ctx.stroke();
    // the struck ball is driven from the contact point through its own centre
    let ox = target.x - end.x, oy = target.y - end.y;
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    const cutLen = base * 4;
    const cx2 = target.x + ox * cutLen, cy2 = target.y + oy * cutLen;
    ctx.strokeStyle = 'rgba(140,225,255,0.9)'; // cyan — high contrast on the felt
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(cx2, cy2);
    ctx.stroke();
    ctx.setLineDash([]);
    // arrowhead on the cut line
    ctx.fillStyle = 'rgba(140,225,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(cx2 + ox * base * 0.7, cy2 + oy * base * 0.7);
    ctx.lineTo(cx2 - oy * base * 0.32, cy2 + ox * base * 0.32);
    ctx.lineTo(cx2 + oy * base * 0.32, cy2 - ox * base * 0.32);
    ctx.closePath();
    ctx.fill();
  }

  drawCueStick(ctx, cue, dx, dy, base, power);
  ctx.restore();
}

// Jump-shot preview: a dotted hop arc whose dots rise and fall, the landing
// ring at distance ∝ power (idle shows the max range), and a red X when the
// landing would leave the bed (= scratch). Flies over balls, so no ghost/cut.
function drawJumpPreview(ctx, state, cue, dx, dy, power, pa, base) {
  const p = power > 0.02 ? power : 1; // before charging, preview full range
  const dist = pa.w * JUMP_RANGE_FRAC * p;
  const lx = cue.x + dx * dist, ly = cue.y + dy * dist;
  const off = lx < pa.left + cue.r || lx > pa.right - cue.r
    || ly < pa.top + cue.r || ly > pa.bottom - cue.r;
  const col = off ? '255,95,95' : '255,214,120';

  ctx.save();
  // rising/falling dotted arc
  const n = 15;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const hgt = Math.sin(Math.PI * t);
    ctx.beginPath();
    ctx.arc(cue.x + dx * dist * t, cue.y + dy * dist * t - hgt * cue.r * 1.7,
      1.2 + hgt * 2.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${col},${0.35 + hgt * 0.5})`;
    ctx.fill();
  }
  // landing ring
  ctx.beginPath();
  ctx.arc(lx, ly, cue.r, 0, Math.PI * 2);
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = `rgba(${col},0.95)`;
  ctx.shadowColor = `rgba(${col},0.8)`;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  if (off) { // off the table — that's a scratch
    ctx.strokeStyle = 'rgba(255,95,95,0.95)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(lx - cue.r * 0.55, ly - cue.r * 0.55); ctx.lineTo(lx + cue.r * 0.55, ly + cue.r * 0.55);
    ctx.moveTo(lx + cue.r * 0.55, ly - cue.r * 0.55); ctx.lineTo(lx - cue.r * 0.55, ly + cue.r * 0.55);
    ctx.stroke();
  }
  drawCueStick(ctx, cue, dx, dy, base, power);
  ctx.restore();
}

// A proper two-piece cue: leather tip, white ferrule, maple shaft, brass joint
// ring, dark rosewood butt with a linen wrap. Tapered (thin at the tip).
function drawCueStick(ctx, cue, dx, dy, base, power) {
  const pull = cue.r * 0.5 + power * cue.r * 3;
  const tipX = cue.x - dx * (cue.r + 2 + pull);
  const tipY = cue.y - dy * (cue.r + 2 + pull);
  const len = base * 22; // real cue proportion (~25 ball-diameters long)
  const px = -dy, py = dx; // perpendicular
  const wTip = Math.max(2.2, base * 0.30) / 2;
  const wButt = Math.max(5, base * 0.66) / 2;
  const at = (t, w) => [tipX - dx * len * t + px * w, tipY - dy * len * t + py * w];

  // soft drop shadow under the stick
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = wButt * 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tipX + 2, tipY + 3);
  ctx.lineTo(tipX - dx * len + 2, tipY - dy * len + 3);
  ctx.stroke();
  ctx.restore();

  // tapered body
  const body = ctx.createLinearGradient(tipX, tipY, tipX - dx * len, tipY - dy * len);
  body.addColorStop(0.00, '#e9dcc0');   // ferrule-adjacent pale maple
  body.addColorStop(0.45, '#caa468');   // maple shaft
  body.addColorStop(0.52, '#8a5a28');
  body.addColorStop(0.55, '#caa468');   // brass joint sits here (drawn below)
  body.addColorStop(0.58, '#46260f');   // rosewood butt
  body.addColorStop(0.82, '#2e1709');   // linen wrap zone
  body.addColorStop(1.00, '#1a0d05');
  ctx.beginPath();
  const [ax, ay] = at(0, wTip); const [bx, by] = at(1, wButt);
  const [cx3, cy3] = at(1, -wButt); const [dx3, dy3] = at(0, -wTip);
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx3, cy3); ctx.lineTo(dx3, dy3);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();

  // running highlight along the top edge (cylindrical sheen)
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(1, wTip * 0.8);
  ctx.beginPath();
  const [h1x, h1y] = at(0.02, -wTip * 0.35); const [h2x, h2y] = at(0.95, -wButt * 0.35);
  ctx.moveTo(h1x, h1y); ctx.lineTo(h2x, h2y);
  ctx.stroke();

  // brass joint ring + butt cap
  const band = (t, w, style, lw) => {
    ctx.strokeStyle = style; ctx.lineWidth = lw;
    const [j1x, j1y] = at(t, w); const [j2x, j2y] = at(t, -w);
    ctx.beginPath(); ctx.moveTo(j1x, j1y); ctx.lineTo(j2x, j2y); ctx.stroke();
  };
  const jw = wTip + (wButt - wTip) * 0.55;
  band(0.55, jw, 'rgba(255,214,140,0.9)', 2);
  band(1.0, wButt, 'rgba(8,4,2,0.95)', 3);

  // white ferrule then the blue leather tip at the very front
  const ferruleLen = base * 0.5;
  ctx.strokeStyle = '#f2efe6';
  ctx.lineWidth = wTip * 2;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - dx * ferruleLen, tipY - dy * ferruleLen);
  ctx.stroke();
  ctx.strokeStyle = '#3f74c2';
  ctx.lineWidth = wTip * 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tipX + dx * base * 0.12, tipY + dy * base * 0.12);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
}
