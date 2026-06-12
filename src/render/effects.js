// render/effects.js — overlays for active card effects, drawn from state each
// frame. Zone positions are relative {u,v} -> px via toPx; radii use the same
// ball-radius factors as physics so visuals match the simulation.

import { playArea, pocketLayout, toPx, unitsFor, cushions } from '../geometry.js';

const F = { ice: 5.3, mud: 4.8, bouncer: 0.95, trap: 1.2, portal: 1.4 };

export function drawEffects(ctx, state) {
  const e = state.activeEffects || {};
  const r = unitsFor(state.dims).ballR;
  const at = (rel) => toPx(rel, state.dims);
  const t = performance.now();

  // Rail treatments first (over the cushions, under everything else).
  drawRailEffects(ctx, state, e, t);
  if (e.crosswind) drawCrosswind(ctx, state, e.crosswind, t);     // table-wide breeze
  if (e.magnet) drawMagnetField(ctx, state, t);

  if (e.icePatch) drawIce(ctx, at(e.icePatch), r * F.ice, t);
  if (e.mudPatch) drawMud(ctx, at(e.mudPatch), r * F.mud, t);
  if (e.bouncer) drawBouncer(ctx, at(e.bouncer), r * F.bouncer, t);
  if (e.bearTrap) drawBearTrap(ctx, at(e.bearTrap), r * F.trap, t, !!e.bearTrap.sprung);
  if (e.portals && e.portals.length) {
    e.portals.forEach((pp, i) => drawPortal(ctx, at(pp), r * F.portal, t, i));
  }

  // pocket states — reshape the actual opening, not just tint it
  const ps = state.pocketState || {};
  const pk = pocketLayout(state.dims, state.movedPockets);
  const pa = playArea(state.dims);
  pk.forEach((p) => {
    const st = ps[p.index];
    if (!st) return;
    // inward unit vector: from the pocket toward the table centre
    let ix = pa.cx - p.x, iy = pa.cy - p.y;
    const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il;

    if (st.shrunk) {
      // Fill the outer bore with the dark rim colour so the visible opening is
      // plainly smaller (matches the tightened capture radius in physics).
      const inner = p.r * 0.6;
      const g = ctx.createRadialGradient(p.x, p.y, inner, p.x, p.y, p.r + 4);
      g.addColorStop(0, 'rgba(28,13,5,0)');
      g.addColorStop(0.3, 'rgba(30,14,6,0.97)');
      g.addColorStop(1, 'rgba(44,22,10,0.98)');
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, inner, 0, Math.PI * 2);
      ctx.fillStyle = '#040404'; ctx.fill();
      // pulsing constriction ring
      const sq = (Math.sin(t / 300) + 1) / 2;
      ctx.strokeStyle = `rgba(255,${130 + sq * 60},${130 + sq * 60},${0.5 + sq * 0.4})`;
      ctx.lineWidth = 1.5 + sq;
      ctx.shadowColor = 'rgba(255,120,120,0.8)'; ctx.shadowBlur = 8 + sq * 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (st.blocked) {
      // A physical barrier laid across the mouth (perpendicular to the inward
      // direction), nudged slightly onto the bed so it reads as a wall.
      const tx = -iy, ty = ix;            // tangent across the opening
      const half = p.r * 0.95;
      const bx = p.x + ix * p.r * 0.25, by = p.y + iy * p.r * 0.25;
      const a = { x: bx - tx * half, y: by - ty * half };
      const b = { x: bx + tx * half, y: by + ty * half };
      ctx.save();
      ctx.lineCap = 'round';
      // red danger glow under the barrier
      ctx.shadowColor = 'rgba(255,50,50,0.85)'; ctx.shadowBlur = 12 + Math.sin(t / 260) * 5;
      ctx.strokeStyle = 'rgba(18,9,3,0.95)'; ctx.lineWidth = p.r * 0.62;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(214,42,42,0.96)'; ctx.lineWidth = p.r * 0.42;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // marching hazard ticks across the bar
      ctx.strokeStyle = 'rgba(255,222,120,0.92)'; ctx.lineWidth = 2;
      const march = (t / 700) % 0.4;
      for (let s = -0.8 + march; s <= 0.81; s += 0.4) {
        const cx = bx + tx * half * s, cy = by + ty * half * s;
        ctx.beginPath();
        ctx.moveTo(cx - ix * p.r * 0.22, cy - iy * p.r * 0.22);
        ctx.lineTo(cx + ix * p.r * 0.22, cy + iy * p.r * 0.22);
        ctx.stroke();
      }
      ctx.restore();
    }
  });
}

// Fog of War: black out the whole table except a narrow sight beam running from
// the cue ball along the current aim line to the first object ball it would reach,
// plus a soft pool of light around the cue ball and the target. Built on an
// offscreen layer so overlapping reveal shapes simply punch one clean hole.
export function drawFog(ctx, state, aimAngle) {
  const cue = state.balls.find((b) => b.num === 0 && !b.pocketed);
  if (!cue) return;
  const { w, h } = state.dims;
  const r = unitsFor(state.dims).ballR;
  const pa = playArea(state.dims);
  const c = toPx({ u: cue.u, v: cue.v }, state.dims);

  // March along the aim line to the first object ball (or the rail).
  const dx = Math.cos(aimAngle), dy = Math.sin(aimAngle);
  const stepLen = Math.max(3, r * 0.5);
  const maxLen = Math.hypot(w, h);
  let x = c.x, y = c.y, len = 0, end = { x: c.x, y: c.y };
  while (len < maxLen) {
    x += dx * stepLen; y += dy * stepLen; len += stepLen;
    end = { x, y };
    if (x < pa.left || x > pa.right || y < pa.top || y > pa.bottom) break;
    let hit = false;
    for (const b of state.balls) {
      if (b.pocketed || b.num === 0) continue;
      const bp = toPx({ u: b.u, v: b.v }, state.dims);
      const br = r + r * (b.size || 1);
      if ((bp.x - x) ** 2 + (bp.y - y) ** 2 < br * br) { hit = true; break; }
    }
    if (hit) break;
  }

  const fog = document.createElement('canvas');
  fog.width = Math.max(1, Math.round(w));
  fog.height = Math.max(1, Math.round(h));
  const fc = fog.getContext('2d');
  fc.fillStyle = 'rgba(2,4,8,0.95)';
  fc.fillRect(0, 0, w, h);

  fc.globalCompositeOperation = 'destination-out';
  const glow = (px, py, rad) => {
    const g = fc.createRadialGradient(px, py, rad * 0.35, px, py, rad);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fc.fillStyle = g;
    fc.beginPath(); fc.arc(px, py, rad, 0, Math.PI * 2); fc.fill();
  };
  glow(c.x, c.y, r * 3.4);     // light around the cue ball
  glow(end.x, end.y, r * 3.2); // light on the target
  // tapered beam down the aim line
  const nx = -dy, ny = dx, w0 = r * 1.6, w1 = r * 2.6;
  fc.fillStyle = 'rgba(0,0,0,1)';
  fc.beginPath();
  fc.moveTo(c.x + nx * w0, c.y + ny * w0);
  fc.lineTo(end.x + nx * w1, end.y + ny * w1);
  fc.lineTo(end.x - nx * w1, end.y - ny * w1);
  fc.lineTo(c.x - nx * w0, c.y - ny * w0);
  fc.closePath(); fc.fill();
  fc.globalCompositeOperation = 'source-over';

  ctx.drawImage(fog, 0, 0);
}

// A stable pseudo-random in [0,1) from an integer seed (so textures don't shimmer).
function rnd(seed) { const s = Math.sin(seed * 12.9898) * 43758.5453; return s - Math.floor(s); }

// ---- Ice patch: a frosted, glinting sheet of ice -------------------------------
function drawIce(ctx, p, rad, t) {
  ctx.save();
  ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.clip();
  const g = ctx.createRadialGradient(p.x - rad * 0.3, p.y - rad * 0.3, rad * 0.1, p.x, p.y, rad);
  g.addColorStop(0, 'rgba(232,248,255,0.95)');
  g.addColorStop(0.55, 'rgba(160,212,242,0.82)');
  g.addColorStop(1, 'rgba(120,180,224,0.6)');
  ctx.fillStyle = g; ctx.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
  // crystalline facets
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const e = rad * (0.55 + rnd(i + 1) * 0.45);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(a) * e, p.y + Math.sin(a) * e);
    ctx.lineTo(p.x + Math.cos(a + 0.4) * e * 0.5, p.y + Math.sin(a + 0.4) * e * 0.5);
    ctx.stroke();
  }
  // travelling glint
  const gl = (Math.sin(t / 650) + 1) / 2;
  ctx.globalAlpha = 0.25 + gl * 0.45;
  ctx.beginPath();
  ctx.ellipse(p.x - rad * 0.2, p.y - rad * 0.28, rad * 0.55, rad * 0.22, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.restore();
  // frosty halo + rim
  ctx.save();
  ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(210,240,255,0.95)'; ctx.lineWidth = 2.2;
  ctx.shadowColor = 'rgba(150,220,255,0.9)'; ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.restore();
  // twinkling star sparkles
  for (let i = 0; i < 4; i++) {
    const tw = Math.max(0, Math.sin(t / 240 + i * 1.9));
    if (tw < 0.25) continue;
    const a = rnd(i + 11) * Math.PI * 2, d = rnd(i + 17) * rad * 0.7;
    const sx = p.x + Math.cos(a) * d, sy = p.y + Math.sin(a) * d, s = (1.5 + rnd(i) * 2.5) * tw;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * tw})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(sx - s, sy); ctx.lineTo(sx + s, sy);
    ctx.moveTo(sx, sy - s); ctx.lineTo(sx, sy + s);
    ctx.stroke();
    ctx.restore();
  }
  glyph(ctx, '❄️', p.x, p.y, rad * 0.5, 0.9);
}

// ---- Mud patch: wet, lumpy, bubbling mud ---------------------------------------
function drawMud(ctx, p, rad, t) {
  ctx.save();
  ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.clip();
  const g = ctx.createRadialGradient(p.x - rad * 0.25, p.y - rad * 0.25, rad * 0.1, p.x, p.y, rad);
  g.addColorStop(0, 'rgba(96,64,34,0.97)');
  g.addColorStop(0.7, 'rgba(68,44,22,0.96)');
  g.addColorStop(1, 'rgba(48,30,14,0.92)');
  ctx.fillStyle = g; ctx.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
  // lumps
  for (let i = 0; i < 10; i++) {
    const a = rnd(i + 3) * Math.PI * 2, d = rnd(i + 9) * rad * 0.8;
    const lx = p.x + Math.cos(a) * d, ly = p.y + Math.sin(a) * d, lr = rad * (0.12 + rnd(i + 5) * 0.18);
    ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? 'rgba(58,38,18,0.8)' : 'rgba(110,76,40,0.6)'; ctx.fill();
  }
  // slow rising bubbles — some pop with a tiny splat ring
  for (let i = 0; i < 7; i++) {
    const ph = (t / 1400 + i * 0.19) % 1;
    const bx = p.x + (rnd(i + 1) - 0.5) * rad * 1.3;
    const by = p.y + rad * 0.6 - ph * rad * 1.2;
    const br = rad * 0.09 * (1 - ph * 0.4);
    if (ph > 0.92) { // pop!
      ctx.beginPath(); ctx.arc(bx, by, br * 2.4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(150,110,60,${(1 - ph) * 5})`; ctx.lineWidth = 1.2; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(150,110,60,${0.55 * (1 - ph)})`; ctx.fill();
      ctx.beginPath(); ctx.arc(bx - br * 0.3, by - br * 0.3, br * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,180,120,${0.4 * (1 - ph)})`; ctx.fill();
    }
  }
  ctx.restore();
  // oozing edge: the outline slowly undulates
  ctx.save();
  ctx.beginPath();
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 24) {
    const rr = rad * (1 + Math.sin(a * 5 + t / 700) * 0.025);
    const x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr;
    a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(40,26,12,0.95)'; ctx.lineWidth = 2.5;
  ctx.shadowColor = 'rgba(30,18,8,0.8)'; ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.restore();
  glyph(ctx, '🟤', p.x, p.y, rad * 0.5, 0.7);
}

// ---- Bouncer: a glossy rubber bumper -------------------------------------------
function drawBouncer(ctx, p, rad, t) {
  const pulse = 1 + Math.sin(t / 220) * 0.05;
  const R = rad * pulse;
  ctx.save();
  // neon impact ring radiating outwards
  const ring = (t / 900) % 1;
  ctx.beginPath(); ctx.arc(p.x, p.y, R * (1.1 + ring * 1.3), 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,110,90,${(1 - ring) * 0.55})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath(); ctx.arc(p.x, p.y, R + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,10,6,0.9)'; ctx.fill();             // dark rubber base
  const g = ctx.createRadialGradient(p.x - R * 0.35, p.y - R * 0.4, R * 0.1, p.x, p.y, R);
  g.addColorStop(0, '#ff8a78'); g.addColorStop(0.6, '#e0452f'); g.addColorStop(1, '#a31f12');
  ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.shadowColor = 'rgba(255,90,60,0.8)'; ctx.shadowBlur = 14;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.ellipse(p.x - R * 0.28, p.y - R * 0.34, R * 0.34, R * 0.18, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();        // glossy highlight
  ctx.restore();
}

// ---- Bear trap: two toothed jaws that SNAP shut when sprung ---------------------
let trapSnapAt = null; // wall-clock ms when the current trap first showed sprung
function drawBearTrap(ctx, p, rad, t, sprung) {
  if (sprung) { if (trapSnapAt == null) trapSnapAt = t; } else trapSnapAt = null;
  // close 0 = set/open, 1 = fully snapped (over ~160 ms, with a tiny overshoot)
  let close = 0;
  if (sprung) {
    const k = Math.min((t - trapSnapAt) / 160, 1);
    close = k < 0.85 ? k / 0.85 : 1 - (k - 0.85) / 0.15 * 0.06; // slam + settle
  }
  const R = rad * 1.7;
  const open = R * 0.62;                 // half-gap of the jaws when set
  const gap = open * (1 - close);        // teeth tips meet at the centreline
  ctx.save();
  ctx.translate(p.x, p.y);
  // ground / spring base
  ctx.beginPath(); ctx.ellipse(0, 0, R * 0.98, R * 0.92, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(28,28,32,0.5)'; ctx.fill();
  // round pressure plate
  ctx.beginPath(); ctx.arc(0, 0, R * 0.3, 0, Math.PI * 2);
  const pg = ctx.createRadialGradient(-R * 0.08, -R * 0.08, R * 0.04, 0, 0, R * 0.3);
  pg.addColorStop(0, '#8a4a1e'); pg.addColorStop(1, '#3c2210');
  ctx.fillStyle = pg; ctx.fill();
  // top jaw (teeth point down) and bottom jaw (teeth point up)
  const halfW = R * 0.9, toothLen = R * 0.55, n = 6;
  for (const sy of [-1, 1]) {
    const baseY = sy * (gap + toothLen);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#9aa0a8'; ctx.lineWidth = R * 0.16;
    ctx.beginPath();
    ctx.moveTo(-halfW, baseY);
    ctx.quadraticCurveTo(0, baseY + sy * R * 0.22, halfW, baseY);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = R * 0.04; ctx.stroke();
    ctx.fillStyle = '#cdd2d8';
    for (let i = 0; i < n; i++) {
      const x = -halfW + ((i + 0.5) / n) * halfW * 2;
      ctx.beginPath();
      ctx.moveTo(x - R * 0.1, baseY);
      ctx.lineTo(x + R * 0.1, baseY);
      ctx.lineTo(x + (i % 2 ? 1 : -1) * R * 0.03, sy * gap); // tip toward centre
      ctx.closePath(); ctx.fill();
    }
  }
  // a flash on the moment of the snap
  if (sprung && close > 0.5 && close < 1) {
    ctx.globalAlpha = (1 - close) * 1.2;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
  }
  ctx.restore();
}

// ---- Portal: a swirling vortex -------------------------------------------------
function drawPortal(ctx, p, rad, t, i) {
  const col = i % 2 ? [255, 90, 150] : [120, 130, 255];
  const rgb = `${col[0]},${col[1]},${col[2]}`;
  const spin = t / 360 * (i % 2 ? -1 : 1);
  ctx.save();
  ctx.translate(p.x, p.y);
  // event-horizon glow bleeding onto the felt
  const halo = ctx.createRadialGradient(0, 0, rad * 0.6, 0, 0, rad * 1.9);
  halo.addColorStop(0, `rgba(${rgb},0.30)`);
  halo.addColorStop(1, `rgba(${rgb},0)`);
  ctx.beginPath(); ctx.arc(0, 0, rad * 1.9, 0, Math.PI * 2); ctx.fillStyle = halo; ctx.fill();
  const core = ctx.createRadialGradient(0, 0, 1, 0, 0, rad);
  core.addColorStop(0, `rgba(255,255,255,0.95)`);
  core.addColorStop(0.25, `rgba(${rgb},0.95)`);
  core.addColorStop(0.6, `rgba(${rgb},0.4)`);
  core.addColorStop(1, 'rgba(10,5,25,0.9)');
  ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fillStyle = core; ctx.fill();
  // spiral arms
  ctx.strokeStyle = `rgba(255,255,255,0.85)`; ctx.lineWidth = 1.7;
  for (let a = 0; a < 2; a++) {
    ctx.beginPath();
    for (let s = 0; s <= 1; s += 0.08) {
      const ang = spin + a * Math.PI + s * 6;
      const rr = s * rad;
      const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
      s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // bright rim + counter-rotating outer dashed ring
  ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.lineWidth = 2.2;
  ctx.shadowColor = `rgba(${rgb},0.9)`; ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.rotate(-spin * 0.7);
  ctx.beginPath(); ctx.arc(0, 0, rad * 1.35, 0, Math.PI * 2);
  ctx.setLineDash([rad * 0.45, rad * 0.4]);
  ctx.strokeStyle = `rgba(${rgb},0.55)`; ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ---- Crosswind: drifting streaks blowing across the table ----------------------
function drawCrosswind(ctx, state, strength, t) {
  const pa = playArea(state.dims);
  const dir = strength > 0 ? 1 : -1;
  ctx.save();
  ctx.beginPath(); ctx.rect(pa.left, pa.top, pa.w, pa.h); ctx.clip();
  ctx.lineCap = 'round';
  const rows = 9, span = Math.abs(strength) * 90 + 80;
  for (let i = 0; i < rows; i++) {
    const y = pa.top + pa.h * ((i + 0.5) / rows) + Math.sin(t / 900 + i * 2.1) * 6;
    const phase = ((t / 1300) + i * 0.13) % 1;
    const x = pa.left - span + phase * (pa.w + span * 2);
    const xx = dir > 0 ? x : pa.right - (x - pa.left);
    const len = span * (0.5 + (i % 3) * 0.18);
    const a = Math.sin(phase * Math.PI) * 0.9;
    // comet streak: bright head fading down the tail
    const g = ctx.createLinearGradient(xx, y, xx + dir * len, y);
    g.addColorStop(0, `rgba(205,232,255,0)`);
    g.addColorStop(0.8, `rgba(215,238,255,${a * 0.5})`);
    g.addColorStop(1, `rgba(255,255,255,${a * 0.9})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.2 + (i % 2);
    ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx + dir * len, y); ctx.stroke();
    // arrowhead on the streak's leading tip
    const hx = xx + dir * len, hs = 3.5 + (i % 2) * 1.5;
    ctx.fillStyle = `rgba(255,255,255,${a * 0.85})`;
    ctx.beginPath();
    ctx.moveTo(hx + dir * hs, y);
    ctx.lineTo(hx - dir * hs * 0.6, y - hs * 0.65);
    ctx.lineTo(hx - dir * hs * 0.6, y + hs * 0.65);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// ---- Magnet: pulsing field arcs around every pocket ----------------------------
function drawMagnetField(ctx, state, t) {
  ctx.save();
  for (const p of pocketLayout(state.dims, state.movedPockets)) {
    // rings collapsing INTO the pocket — reads as suction, not radiation
    for (let k = 0; k < 3; k++) {
      const ph = 1 - ((t / 1100 + k / 3) % 1); // 1 -> 0, shrinking
      const rr = p.r * (1.2 + ph * 2.6);
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(120,200,255,${(1 - ph) * 0.4})`;
      ctx.lineWidth = 1.4 + (1 - ph) * 1.2;
      ctx.stroke();
    }
    // glowing core ring on the pocket mouth
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.15, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(140,215,255,0.75)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(120,200,255,0.9)'; ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// ---- Rail treatments: Bounce House (rubber band) & Dead Rail (rotted) -----------
function drawRailEffects(ctx, state, e, t) {
  const bh = e.bounceHouseRail || [];
  const dr = e.deadRail || [];
  if (!bh.length && !dr.length) return;
  const list = cushions(state.dims).list;
  for (const span of list) {
    if (bh.includes(span.rail)) drawRubberRail(ctx, span, t);
    if (dr.includes(span.rail)) drawRottedRail(ctx, span);
  }
}

// the bed-facing crest of a cushion span: jaw -> nose -> jaw endpoints
function crest(span) {
  const f = span.faces;
  return [
    { x: f[0].x1, y: f[0].y1 }, { x: f[0].x2, y: f[0].y2 },
    { x: f[1].x2, y: f[1].y2 }, { x: f[2].x2, y: f[2].y2 },
  ];
}

function drawRubberRail(ctx, span, t) {
  const pts = crest(span);
  const n = span.faces[1]; // nose normal points into the bed
  const wob = Math.sin(t / 130) * 2.2; // vibrating band
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const draw = (off, style, w) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = p.x + n.nx * (off + wob), y = p.y + n.ny * (off + wob);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = style; ctx.lineWidth = w; ctx.stroke();
  };
  draw(1.5, 'rgba(20,10,40,0.6)', 7);            // shadow
  ctx.shadowColor = 'rgba(255,95,166,0.95)'; ctx.shadowBlur = 12; // neon glow
  draw(1.5, '#ff5fa6', 6);                        // rubber band
  ctx.shadowBlur = 0;
  draw(0.2, 'rgba(255,210,235,0.9)', 1.6);        // highlight
  ctx.restore();
}

function drawRottedRail(ctx, span) {
  const pts = crest(span);
  const n = span.faces[1];
  ctx.save();
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  // base rotted wood band
  ctx.beginPath();
  pts.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x + n.nx, p.y + n.ny) : ctx.lineTo(p.x + n.nx, p.y + n.ny); });
  ctx.strokeStyle = '#4a3a22'; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = 'rgba(30,24,12,0.9)'; ctx.lineWidth = 6; ctx.setLineDash([5, 4]); ctx.stroke();
  ctx.setLineDash([]);
  // patches of moss/decay
  const seg = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  for (let i = 0; i < 5; i++) {
    const a = pts[i % (pts.length - 1)], b = pts[(i % (pts.length - 1)) + 1];
    const c = seg(a, b, rnd(i + 2));
    ctx.beginPath(); ctx.arc(c.x + n.nx, c.y + n.ny, 2 + rnd(i + 7) * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? 'rgba(70,90,40,0.7)' : 'rgba(20,16,8,0.8)'; ctx.fill();
  }
  // splintering cracks reaching out of the dead wood
  ctx.strokeStyle = 'rgba(15,10,4,0.85)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) {
    const a = pts[i % (pts.length - 1)], b = pts[(i % (pts.length - 1)) + 1];
    const c = seg(a, b, rnd(i + 23));
    const jag = 4 + rnd(i + 31) * 5;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + n.nx * jag + (rnd(i) - 0.5) * 6, c.y + n.ny * jag + (rnd(i + 3) - 0.5) * 6);
    ctx.lineTo(c.x + n.nx * jag * 1.9 + (rnd(i + 5) - 0.5) * 8, c.y + n.ny * jag * 1.9 + (rnd(i + 9) - 0.5) * 8);
    ctx.stroke();
  }
  ctx.restore();
}

function glyph(ctx, emoji, x, y, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji, x, y);
  ctx.restore();
}

// A glyph on a small dark glow-chip so status badges pop against any felt art.
function badge(ctx, emoji, x, y, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.beginPath();
  ctx.arc(x, y, size * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,12,22,0.72)';
  ctx.shadowColor = 'rgba(255,225,140,0.55)';
  ctx.shadowBlur = 7;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji, x, y + size * 0.04);
  ctx.restore();
}

// Status badges drawn OVER the balls: per-ball weight markers + cue-ball effect
// glyphs (turbo bolt, roid, cool, oil, reverse, sticky, drunk). Kept on top so
// they read clearly while the zone art sits beneath the balls.
export function drawEffectBadges(ctx, state) {
  const e = state.activeEffects || {};
  const r = unitsFor(state.dims).ballR;
  const t = performance.now();

  for (const b of state.balls) {
    if (b.pocketed || e.cloaked === b.num) continue;
    if (!b.heavyweight && !b.lightweight) continue;
    let p = toPx({ u: b.u, v: b.v }, state.dims);
    if (e.mirror && b.num !== 0) p = { x: state.dims.w - p.x, y: p.y };
    badge(ctx, b.heavyweight ? '🏋️' : '🪶', p.x, p.y + r * 1.55, r * 0.95, 0.95);
  }

  const cue = state.balls.find((b) => b.num === 0 && !b.pocketed);
  if (!cue || e.cloaked === 0) return;
  let p = toPx({ u: cue.u, v: cue.v }, state.dims);
  const cr = r * (cue.size || 1);
  if (e.turbo) drawBolt(ctx, p.x, p.y, cr, t);

  const badges = [];
  if (e.roidRage) badges.push('💢');
  if (e.coolHands) badges.push('🧊');
  if (e.oilCue) badges.push('💧');
  if (e.reverseSpin) badges.push('↩️');
  if (e.sticky) badges.push('🍯');
  if (e.drunk) badges.push('🍺');
  badges.forEach((g, i) => {
    const x = p.x + (i - (badges.length - 1) / 2) * cr * 1.25;
    badge(ctx, g, x, p.y - cr * 1.85, cr * 0.85, 0.96);
  });
}

// A glowing lightning bolt on the cue ball for Turbo.
function drawBolt(ctx, x, y, r, t) {
  const flick = 0.55 + 0.45 * Math.abs(Math.sin(t / 110));
  const s = r * 1.05;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = flick;
  ctx.beginPath();
  ctx.moveTo(0.06 * s, -0.62 * s);
  ctx.lineTo(-0.26 * s, 0.06 * s);
  ctx.lineTo(-0.02 * s, 0.06 * s);
  ctx.lineTo(-0.12 * s, 0.62 * s);
  ctx.lineTo(0.30 * s, -0.16 * s);
  ctx.lineTo(0.05 * s, -0.16 * s);
  ctx.closePath();
  ctx.fillStyle = '#ffe23a';
  ctx.shadowColor = '#fff27a'; ctx.shadowBlur = 9;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1; ctx.strokeStyle = '#9a7400'; ctx.stroke();
  ctx.restore();
}

// Highlights shown while the player is making a card target pick.
export function drawPickHighlights(ctx, state, pick) {
  if (!pick) return;
  const r = unitsFor(state.dims).ballR;
  const t = performance.now() / 380;
  ctx.save();
  ctx.fillStyle = 'rgba(255,215,0,0.06)'; ctx.fillRect(0, 0, state.dims.w, state.dims.h);
  if (pick.type === 'ball') {
    for (const b of state.balls) {
      if (b.pocketed || b.num === 0) continue;
      const p = toPx({ u: b.u, v: b.v }, state.dims);
      ctx.beginPath(); ctx.arc(p.x, p.y, r * (b.size || 1) + 4 + Math.sin(t) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,215,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  } else if (pick.type === 'pocket') {
    for (const p of pocketLayout(state.dims, state.movedPockets)) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4 + Math.sin(t) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,215,0,0.7)'; ctx.lineWidth = 2; ctx.stroke();
    }
  } else if (pick.type === 'rail') {
    const pa = playArea(state.dims); const c = unitsFor(state.dims).cushion;
    ctx.fillStyle = 'rgba(255,215,0,0.18)';
    ctx.fillRect(pa.left, 0, pa.w, c); ctx.fillRect(pa.left, state.dims.h - c, pa.w, c);
    ctx.fillRect(0, pa.top, c, pa.h); ctx.fillRect(state.dims.w - c, pa.top, c, pa.h);
  }
  ctx.restore();
}

// Live preview for a 'place' pick: a ghost of the effect follows the cursor so
// the player sees exactly what they're about to drop before clicking. `opts`
// carries the in-progress card options (e.g. already-placed portal positions).
export function drawPlacementGhost(ctx, state, pick, hover, opts = {}) {
  if (!pick || pick.type !== 'place' || !hover) return;
  const u = unitsFor(state.dims);
  const r = u.ballR;
  const pa = playArea(state.dims);
  const x = Math.max(pa.left, Math.min(pa.right, hover.x));
  const y = Math.max(pa.top, Math.min(pa.bottom, hover.y));
  const id = pick.cardId;

  const ghostZone = (rad, fill, stroke, emoji) => {
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `${r * 1.4}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(emoji, x, y);
  };

  ctx.save();
  ctx.globalAlpha = 0.7;
  if (id === 'move_hole' || id === 'warp_rail') {
    // A ball under the drop point makes the placement invalid (rejected on click).
    const onBall = state.balls.some((b) => {
      if (b.pocketed) return false;
      const bp = toPx({ u: b.u, v: b.v }, state.dims);
      return Math.hypot(bp.x - x, bp.y - y) < u.pocketR + r * (b.size || 1);
    });
    // Warp Rail: preview the two rails bending from their neighbours to the cursor.
    if (id === 'warp_rail' && opts.pocket != null) {
      const dv = (i) => {
        const m = state.movedPockets && state.movedPockets[i];
        if (m && m.warp) return toPx(m, state.dims);
        return [{ x: pa.left, y: pa.top }, { x: pa.cx, y: pa.top }, { x: pa.right, y: pa.top },
          { x: pa.left, y: pa.bottom }, { x: pa.cx, y: pa.bottom }, { x: pa.right, y: pa.bottom }][i];
      };
      const NEIGH = { 0: [3, 1], 1: [0, 2], 2: [1, 5], 5: [2, 4], 4: [5, 3], 3: [4, 0] };
      const ns = NEIGH[opts.pocket] || [];
      ctx.strokeStyle = 'rgba(120,230,150,0.85)'; ctx.lineWidth = 3; ctx.setLineDash([7, 5]);
      ns.forEach((ni) => { const v = dv(ni); ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(x, y); ctx.stroke(); });
      ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.arc(x, y, u.pocketR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4,4,4,0.7)'; ctx.fill();
    ctx.strokeStyle = onBall ? 'rgba(255,60,60,0.95)' : 'rgba(255,215,0,0.9)';
    ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
  } else if (id === 'bouncer') {
    ctx.beginPath(); ctx.arc(x, y, r * F.bouncer, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(192,57,43,0.55)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,150,130,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
  } else if (id === 'bear_trap') {
    ctx.font = `${r * 1.8}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🪤', x, y);
  } else if (id === 'ice_patch') {
    ghostZone(r * F.ice, 'rgba(180,220,255,0.22)', 'rgba(180,220,255,0.6)', '🧊');
  } else if (id === 'mud_patch') {
    ghostZone(r * F.mud, 'rgba(100,60,20,0.4)', 'rgba(140,90,40,0.6)', '💩');
  } else if (id === 'portal') {
    // Show any already-placed portal of this pair, linked to the ghost endpoint.
    const placed = opts.positions || [];
    if (placed.length) {
      const p0 = toPx(placed[0], state.dims);
      ctx.beginPath(); ctx.arc(p0.x, p0.y, r * F.portal, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120,90,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = `${r * 1.5}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🌀', p0.x, p0.y);
      ctx.strokeStyle = 'rgba(180,150,255,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 6]);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.arc(x, y, r * F.portal, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,90,120,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `${r * 1.5}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🌀', x, y);
  }
  ctx.restore();
}
