// render/table.js — draws the table FROM state (geometry.js + state.movedPockets
// + state.warp). No hardcoded pocket positions; the cache invalidates whenever
// pockets move or the table warps, so Move Hole / Warp Rail repaint correctly.

import { playArea, pocketLayout, unitsFor, cushions, warpRail } from '../geometry.js';

let _cache = { canvas: null, key: '' };

function geometryKey(state) {
  return JSON.stringify({
    w: Math.round(state.dims.w),
    h: Math.round(state.dims.h),
    moved: state.movedPockets,
    warp: state.warp,
  });
}

// Public: blit the (cached) table image, then a focusing vignette.
export function drawTable(ctx, state) {
  const key = geometryKey(state);
  if (!_cache.canvas || _cache.key !== key) {
    _cache.canvas = buildTableLayer(state);
    _cache.key = key;
  }
  ctx.clearRect(0, 0, state.dims.w, state.dims.h);
  ctx.drawImage(_cache.canvas, 0, 0);

  const { w, h } = state.dims;
  const vig = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.18, w * 0.5, h * 0.5, w * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

function buildTableLayer(state) {
  const { w, h } = state.dims;
  const pa = playArea(state.dims);
  const u = unitsFor(state.dims);
  const pockets = pocketLayout(state.dims, state.movedPockets);

  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  const ctx = cv.getContext('2d');

  // --- 1. Wooden rails fill the whole border --------------------------------
  const wood = ctx.createLinearGradient(0, 0, w, h);
  wood.addColorStop(0, '#6b4427');
  wood.addColorStop(0.5, '#874f29');
  wood.addColorStop(1, '#492a13');
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.globalAlpha = 0.10;
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = `rgba(255,216,168,${0.02 + (Math.sin(y * 0.09) + 1) * 0.012})`;
    ctx.fillRect(0, y, w, 1);
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,225,180,0.18)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(w - 1.5, h - 1.5, 0, 0);

  // --- 2. Green felt bed inside the play area -------------------------------
  ctx.save();
  const felt = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.06, w * 0.5, h * 0.5, w * 0.55);
  felt.addColorStop(0, '#2faf66');
  felt.addColorStop(0.55, '#1d8049');
  felt.addColorStop(1, '#135e36');
  ctx.fillStyle = felt;
  ctx.fillRect(pa.left, pa.top, pa.w, pa.h);
  ctx.beginPath();
  ctx.rect(pa.left, pa.top, pa.w, pa.h);
  ctx.clip();
  const sheen = ctx.createLinearGradient(pa.left, pa.top, pa.right, pa.bottom);
  sheen.addColorStop(0, 'rgba(255,255,255,0.06)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = sheen;
  ctx.fillRect(pa.left, pa.top, pa.w, pa.h);
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 700; i++) {
    const nx = pa.left + ((i * 73) % pa.w);
    const ny = pa.top + ((i * 97) % pa.h);
    ctx.fillStyle = i % 2 === 0 ? '#fff' : '#000';
    ctx.fillRect(nx, ny, 1, 1);
  }
  ctx.restore();
  // shadow where the wooden rail meets the bed
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3;
  ctx.strokeRect(pa.left, pa.top, pa.w, pa.h);

  // --- 3. Cushions: green bumpers on the bed edge, angled into the pockets ---
  drawCushions(ctx, state.dims);
  // Warp Rail: an inward cushion ridge near the anchor pocket (same geom physics uses).
  drawWarp(ctx, state.dims, state.warp);

  // --- 4. Pocket holes (set into the rail at the corners / side midpoints) --
  pockets.forEach((p) => drawPocketHole(ctx, p));

  // --- 5. Rail diamonds + table markings ------------------------------------
  drawDiamonds(ctx, w, h, pa, u);
  drawMarkings(ctx, pa);

  return cv;
}

// A brown wooden cabinet frame as a border ring around the outer edge.
function drawWoodFrame(ctx, w, h, t) {
  ctx.save();
  const wood = ctx.createLinearGradient(0, 0, w, h);
  wood.addColorStop(0, '#5d3c1f');
  wood.addColorStop(0.5, '#7d5230');
  wood.addColorStop(1, '#3e2712');
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(t, t, w - 2 * t, h - 2 * t);
  ctx.fill('evenodd');
  // faint grain on the frame
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(t, t, w - 2 * t, h - 2 * t);
  ctx.clip('evenodd');
  ctx.globalAlpha = 0.10;
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = `rgba(255,216,168,${0.02 + (Math.sin(y * 0.09) + 1) * 0.012})`;
    ctx.fillRect(0, y, w, 1);
  }
  ctx.restore();
  // outer highlight + inner shadow where the frame meets the cloth
  ctx.strokeStyle = 'rgba(255,220,170,0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(t, t, w - 2 * t, h - 2 * t);
  ctx.restore();
}

function drawPocketHole(ctx, p) {
  // outer ring (leather/chrome), then a deep gradient bore
  const ring = ctx.createRadialGradient(p.x - 2, p.y - 2, 3, p.x, p.y, p.r + 5);
  ring.addColorStop(0, 'rgba(80,40,18,0.2)');
  ring.addColorStop(1, 'rgba(20,8,2,0.95)');
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fillStyle = '#040404';
  ctx.fill();

  const bore = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r);
  bore.addColorStop(0, 'rgba(0,0,0,0.15)');
  bore.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  bore.addColorStop(1, 'rgba(0,0,0,0.98)');
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fillStyle = bore;
  ctx.fill();
}

// Draw the cushions from the SAME geometry physics bounces off (geometry.cushions).
// Each cushion is full-depth in the middle of the rail and RECEDES to the rail line
// at each pocket via an angled facing — so the mouth opens toward the pocket and the
// facing funnels the ball in (it does not jut across the hole).
function drawCushions(ctx, dims) {
  for (const c of cushions(dims).list) {
    const [Mlo, Nlo, Nhi, Mhi] = c.poly; // M = rail line (near pockets), N = nose (interior)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(Mlo.x, Mlo.y);
    ctx.lineTo(Nlo.x, Nlo.y);
    ctx.lineTo(Nhi.x, Nhi.y);
    ctx.lineTo(Mhi.x, Mhi.y);
    ctx.closePath();
    // Flat cushion colour (no strong gradient) so the rails read straight/square,
    // not rounded. Edge definition comes from the thin highlight/shadow below.
    ctx.fillStyle = '#1c8a4f';
    ctx.fill();
    ctx.restore();

    // crest + shadow along the bed-facing edges (jaw, nose, jaw)
    const edge = (off, style, lw) => {
      ctx.strokeStyle = style; ctx.lineWidth = lw;
      ctx.beginPath();
      c.faces.forEach((s, i) => {
        if (i === 0) ctx.moveTo(s.x1 + s.nx * off, s.y1 + s.ny * off);
        ctx.lineTo(s.x2 + s.nx * off, s.y2 + s.ny * off);
      });
      ctx.stroke();
    };
    edge(2.2, 'rgba(0,0,0,0.20)', 3);          // shadow onto the bed
    edge(0, 'rgba(205,255,215,0.5)', 1.4);     // bright crest on the bounce faces
  }
}

function drawWarp(ctx, dims, warp) {
  const wr = warpRail(dims, warp);
  if (!wr) return;
  const [baseL, apex, baseR] = wr.poly;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(baseL.x, baseL.y);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(baseR.x, baseR.y);
  ctx.closePath();
  ctx.fillStyle = '#1c8a4f';                  // same cushion green
  ctx.fill();
  // bright crest on the two bed-facing edges + a soft shadow onto the felt
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 4; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(baseL.x, baseL.y); ctx.lineTo(apex.x, apex.y); ctx.lineTo(baseR.x, baseR.y);
  ctx.strokeStyle = 'rgba(120,210,255,0.55)'; ctx.lineWidth = 1.6; ctx.stroke(); // watery tint
  ctx.restore();
}

function drawDiamonds(ctx, w, h, pa, u) {
  const off = u.cushion * 0.5;
  // No diamond at pa.cx on the long rails — that midpoint is the side pocket,
  // and a sight there would sit on top of the recessed hole.
  const spots = [
    [pa.left + pa.w * 0.25, pa.top - off, 0], [pa.left + pa.w * 0.75, pa.top - off, 0],
    [pa.left + pa.w * 0.25, pa.bottom + off, 0], [pa.left + pa.w * 0.75, pa.bottom + off, 0],
    [pa.left - off, pa.top + pa.h * 0.5, Math.PI / 2], [pa.right + off, pa.top + pa.h * 0.5, Math.PI / 2],
  ];
  const s = Math.max(3, u.ballR * 0.4);
  spots.forEach(([x, y, rot]) => {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.lineTo(s * 1.1, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 1.1, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(-s, -s, s, s);
    g.addColorStop(0, 'rgba(255,233,185,0.95)');
    g.addColorStop(1, 'rgba(198,138,63,0.95)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(72,40,18,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  });
}

function drawMarkings(ctx, pa) {
  // foot/head spots
  ctx.fillStyle = 'rgba(245,246,233,0.28)';
  [0.25, 0.75].forEach((fx) => {
    ctx.beginPath();
    ctx.arc(pa.left + pa.w * fx, pa.cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
  // head string
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(pa.left + pa.w * 0.25, pa.top);
  ctx.lineTo(pa.left + pa.w * 0.25, pa.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
}
