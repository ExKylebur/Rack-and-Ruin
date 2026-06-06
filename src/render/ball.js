// render/ball.js — draws one ball FROM state. Radius = base ballR * ball.size,
// so Big Ball (size 2) / Small Ball (size 0.5) render correctly at any
// resolution. Position comes from the ball's relative {u,v}.

import { toPx, unitsFor } from '../geometry.js';

function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function hexToRgb(hex) {
  const raw = (hex || '').replace('#', '');
  if (raw.length !== 6) return [128, 128, 128];
  const n = parseInt(raw, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shiftHex(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${clamp255(r + amt)},${clamp255(g + amt)},${clamp255(b + amt)})`;
}

export function drawBall(ctx, ball, state) {
  if (ball.pocketed) return;
  const ae = state.activeEffects || {};
  if (ae.cloaked === ball.num) return; // invisible to opponent

  const base = unitsFor(state.dims).ballR;
  const r = base * (ball.size || 1);

  // Position (with optional left-right mirror of object balls).
  let pos = toPx({ u: ball.u, v: ball.v }, state.dims);
  if (ae.mirror && ball.num !== 0) {
    pos = { x: state.dims.w - pos.x, y: pos.y };
  }
  const { x: drawX, y: drawY } = pos;

  // Confusion: show a different number / flipped stripe.
  const confused = ae.confusion && ae.confusionMap && ball.num !== 0 && ball.num !== 8;
  const shownNum = confused ? (ae.confusionMap[ball.num] ?? ball.num) : ball.num;
  const shownStripe = (ae.confusion && ae.confusionStripeMap && ae.confusionStripeMap[ball.num] !== undefined)
    ? ae.confusionStripeMap[ball.num] : ball.stripe;

  const speed = Math.hypot(ball.vx, ball.vy);
  const axis = (speed > 0.04 ? Math.atan2(ball.vy, ball.vx) : 0) + (ball.roll || 0);

  // Grounded shadow.
  ctx.beginPath();
  ctx.ellipse(drawX + 2, drawY + r * 0.9, r * 0.72, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();

  ctx.save();
  ctx.translate(drawX, drawY);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();

  const color = ball.c || '#cccccc';
  if (shownNum === 0) {
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#f0f0ef'); g.addColorStop(1, '#b7b7b7');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
  } else if (shownStripe) {
    const shell = ctx.createRadialGradient(-r * 0.28, -r * 0.3, r * 0.08, 0, 0, r);
    shell.addColorStop(0, '#fcfcfb'); shell.addColorStop(0.62, '#edece7'); shell.addColorStop(1, '#cfcdc8');
    ctx.fillStyle = shell;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.save();
    ctx.rotate(axis);
    const sg = ctx.createLinearGradient(-r, 0, r, 0);
    sg.addColorStop(0, shiftHex(color, -20)); sg.addColorStop(0.45, color); sg.addColorStop(1, shiftHex(color, -36));
    ctx.fillStyle = sg;
    ctx.fillRect(-r, -r * 0.54, r * 2, r * 1.08);
    ctx.restore();
  } else {
    const sg = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.08, 0, 0, r);
    sg.addColorStop(0, shiftHex(color, 58)); sg.addColorStop(0.38, color); sg.addColorStop(1, shiftHex(color, -58));
    ctx.fillStyle = sg;
    ctx.fillRect(-r, -r, r * 2, r * 2);
  }

  // rim shading for spherical depth
  const rim = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
  rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(0.72, 'rgba(0,0,0,0.08)'); rim.addColorStop(1, 'rgba(0,0,0,0.24)');
  ctx.fillStyle = rim;
  ctx.fillRect(-r, -r, r * 2, r * 2);

  // number decal
  if (shownNum > 0) {
    const decal = ctx.createRadialGradient(-r * 0.05, -r * 0.05, r * 0.02, 0, 0, r * 0.46);
    decal.addColorStop(0, 'rgba(255,255,255,0.98)'); decal.addColorStop(1, 'rgba(230,229,221,0.9)');
    ctx.fillStyle = decal;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d0d0d';
    ctx.font = `bold ${(shownNum > 9 ? 0.5 : 0.62) * r}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(shownNum), 0, 0);
  }

  // specular highlight
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.34, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.64)';
  ctx.fill();
  ctx.restore();

  // outer rim line
  ctx.beginPath();
  ctx.arc(drawX, drawY, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
}
