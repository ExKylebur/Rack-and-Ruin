// render/ball.js — draws one ball FROM state. Radius = base ballR * ball.size,
// so Big Ball (size 2) / Small Ball (size 0.5) render correctly at any
// resolution. Position comes from the ball's relative {u,v}.
//
// Shading model (cheap but reads as a glossy sphere): layered soft contact
// shadow, 3-stop body gradient lit from the upper-left, a green bounce light
// from the felt at the base, a fresnel rim, then a broad sheen + hard glint.

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

  const pos = toPx({ u: ball.u, v: ball.v }, state.dims);
  const { x: drawX, y: drawY } = pos;

  // Confusion: show a different number / flipped stripe.
  const confused = ae.confusion && ae.confusionMap && ball.num !== 0 && ball.num !== 8;
  const shownNum = confused ? (ae.confusionMap[ball.num] ?? ball.num) : ball.num;
  const shownStripe = (ae.confusion && ae.confusionStripeMap && ae.confusionStripeMap[ball.num] !== undefined)
    ? ae.confusionStripeMap[ball.num] : ball.stripe;

  const speed = Math.hypot(ball.vx, ball.vy);
  const axis = (speed > 0.04 ? Math.atan2(ball.vy, ball.vx) : 0) + (ball.roll || 0);

  // Jump shot: while airborne the ball lifts, grows, and its shadow stays on
  // the felt — a parabolic arc over the flight (air counts down to 0).
  const airT = (ball.airTotal > 0 && ball.air > 0) ? 1 - ball.air / ball.airTotal : 0;
  const lift = airT > 0 ? Math.sin(Math.PI * airT) : 0;
  const rDraw = r * (1 + 0.42 * lift);
  const yDraw = drawY - lift * r * 1.9;

  // Grounded contact shadow: a tight dark core inside a soft wide penumbra.
  // While airborne it shrinks, fades and trails behind the lifted ball.
  ctx.beginPath();
  ctx.ellipse(drawX + r * 0.16, drawY + r * 0.88, r * (1 - 0.3 * lift), r * 0.3 * (1 - 0.3 * lift), 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${0.16 * (1 - 0.55 * lift)})`;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(drawX + r * 0.1, drawY + r * 0.88, r * 0.7 * (1 - 0.3 * lift), r * 0.2 * (1 - 0.3 * lift), 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${0.3 * (1 - 0.55 * lift)})`;
  ctx.fill();

  ctx.save();
  ctx.translate(drawX, yDraw);
  if (lift > 0) ctx.scale(rDraw / r, rDraw / r); // grow the whole sphere in flight
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();

  const color = ball.c || '#cccccc';
  if (shownNum === 0) {
    const g = ctx.createRadialGradient(-r * 0.32, -r * 0.36, r * 0.08, 0, 0, r * 1.05);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#f3f2ee'); g.addColorStop(0.8, '#cfccc4'); g.addColorStop(1, '#a8a49a');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
  } else if (shownStripe) {
    const shell = ctx.createRadialGradient(-r * 0.3, -r * 0.34, r * 0.08, 0, 0, r * 1.05);
    shell.addColorStop(0, '#ffffff'); shell.addColorStop(0.55, '#efeee8'); shell.addColorStop(0.85, '#d4d1c8'); shell.addColorStop(1, '#b3afa4');
    ctx.fillStyle = shell;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.save();
    ctx.rotate(axis);
    const sg = ctx.createLinearGradient(-r, 0, r, 0);
    sg.addColorStop(0, shiftHex(color, -26)); sg.addColorStop(0.42, shiftHex(color, 12)); sg.addColorStop(1, shiftHex(color, -44));
    ctx.fillStyle = sg;
    ctx.fillRect(-r, -r * 0.54, r * 2, r * 1.08);
    // crisp band edges so the stripe doesn't bleed into the shell
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-r, -r * 0.56, r * 2, r * 0.05);
    ctx.fillRect(-r, r * 0.51, r * 2, r * 0.05);
    ctx.restore();
  } else {
    const sg = ctx.createRadialGradient(-r * 0.32, -r * 0.36, r * 0.06, 0, 0, r * 1.05);
    sg.addColorStop(0, shiftHex(color, 72)); sg.addColorStop(0.36, shiftHex(color, 14)); sg.addColorStop(0.78, shiftHex(color, -34)); sg.addColorStop(1, shiftHex(color, -76));
    ctx.fillStyle = sg;
    ctx.fillRect(-r, -r, r * 2, r * 2);
  }

  // bounce light from the felt at the base of the sphere
  const felt = ctx.createRadialGradient(0, r * 0.95, r * 0.1, 0, r * 0.95, r * 1.05);
  felt.addColorStop(0, 'rgba(80,200,120,0.20)');
  felt.addColorStop(1, 'rgba(80,200,120,0)');
  ctx.fillStyle = felt;
  ctx.fillRect(-r, -r, r * 2, r * 2);

  // fresnel rim for spherical depth
  const rim = ctx.createRadialGradient(0, 0, r * 0.45, 0, 0, r);
  rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(0.7, 'rgba(0,0,0,0.07)'); rim.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = rim;
  ctx.fillRect(-r, -r, r * 2, r * 2);

  // number decal
  if (shownNum > 0) {
    const decal = ctx.createRadialGradient(-r * 0.06, -r * 0.08, r * 0.02, 0, 0, r * 0.48);
    decal.addColorStop(0, 'rgba(255,255,255,0.99)'); decal.addColorStop(0.8, 'rgba(246,245,238,0.96)'); decal.addColorStop(1, 'rgba(222,220,210,0.92)');
    ctx.fillStyle = decal;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = Math.max(0.6, r * 0.04);
    ctx.stroke();
    ctx.fillStyle = '#15130f';
    ctx.font = `800 ${(shownNum > 9 ? 0.5 : 0.6) * r}px Outfit, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(shownNum), 0, r * 0.03);
  }

  // broad glossy sheen + hard glint (the "window light")
  ctx.save();
  ctx.rotate(-0.55);
  const sheen = ctx.createRadialGradient(-r * 0.32, -r * 0.3, 0, -r * 0.32, -r * 0.3, r * 0.62);
  sheen.addColorStop(0, 'rgba(255,255,255,0.5)');
  sheen.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.3, r * 0.55, r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.36, r * 0.11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  // faint secondary glint opposite (table-light bounce)
  ctx.beginPath();
  ctx.arc(r * 0.34, r * 0.3, r * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();
  ctx.restore();

  // soft dark outline grounds the ball against the bright felt
  ctx.beginPath();
  ctx.arc(drawX, yDraw, rDraw, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(0.8, r * 0.05);
  ctx.stroke();
}
