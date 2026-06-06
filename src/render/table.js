// render/table.js — draws the table FROM state (geometry.js + state.movedPockets
// + state.warp). No hardcoded pocket positions; the cache invalidates whenever
// pockets move or the table warps, so Move Hole / Warp Rail repaint correctly.

import { playArea, pocketLayout, unitsFor } from '../geometry.js';

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

  // --- 1. Rail / frame: warm wood with a subtle grain --------------------
  const wood = ctx.createLinearGradient(0, 0, w, h);
  wood.addColorStop(0, '#3a210f');
  wood.addColorStop(0.46, '#6f4526');
  wood.addColorStop(1, '#2a1709');
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = `rgba(255,214,164,${0.015 + (Math.sin(y * 0.09) + 1) * 0.012})`;
    ctx.fillRect(0, y + Math.sin(y * 0.23 + 1.9) * 0.5, w, 1);
  }
  ctx.restore();
  // bevel edges
  ctx.fillStyle = 'rgba(250,220,156,0.18)';
  ctx.fillRect(0, 0, w, 2); ctx.fillRect(0, 0, 2, h);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, h - 2, w, 2); ctx.fillRect(w - 2, 0, 2, h);

  // --- 2. Pocket holes (drawn BENEATH the felt) --------------------------
  pockets.forEach((p) => drawPocketHole(ctx, p));

  // --- 3. Felt over the play rectangle, then carve the pockets out -------
  ctx.save();
  const felt = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.08, w * 0.5, h * 0.5, w * 0.62);
  felt.addColorStop(0, '#2db367');
  felt.addColorStop(0.52, '#1d7f49');
  felt.addColorStop(1, '#0f4a2c');
  ctx.fillStyle = felt;
  ctx.fillRect(pa.left, pa.top, pa.w, pa.h);

  // weave + sheen, clipped to the play rect
  ctx.save();
  ctx.beginPath();
  ctx.rect(pa.left, pa.top, pa.w, pa.h);
  ctx.clip();
  const sheen = ctx.createLinearGradient(pa.left, pa.top, pa.right, pa.bottom);
  sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = sheen;
  ctx.fillRect(pa.left, pa.top, pa.w, pa.h);
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 520; i++) {
    const nx = pa.left + ((i * 73) % pa.w);
    const ny = pa.top + ((i * 97) % pa.h);
    ctx.fillStyle = i % 2 === 0 ? '#fff' : '#000';
    ctx.fillRect(nx, ny, 1, 1);
  }
  ctx.restore();

  // carve the pocket mouths out of the felt so holes read as openings
  ctx.globalCompositeOperation = 'destination-out';
  pockets.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  // --- 4. Cushion noses (raised bumpers, broken at the pockets) ----------
  drawCushions(ctx, pa, u, pockets);

  // --- 5. Rail diamonds + table markings ---------------------------------
  drawDiamonds(ctx, w, h, pa, u);
  drawMarkings(ctx, pa);

  return cv;
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

// Cushion noses inset slightly into the play area, ending a gap short of each
// pocket. Top and bottom rails are split by the side pocket.
function drawCushions(ctx, pa, u, pockets) {
  const t = u.cushion * 0.42;          // nose thickness
  const gap = u.pocketR * 1.15;        // clearance from a pocket centre
  const noseFill = (x1, y1, x2, y2) => {
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, '#0e5a34');
    g.addColorStop(0.5, '#1f8a4f');
    g.addColorStop(1, '#0c4427');
    return g;
  };
  // pocket x/y by label for gap maths
  const P = {}; pockets.forEach((p) => { P[p.label] = p; });

  // top: two segments (left & right of the middle pocket)
  bar(ctx, P.TL.x + gap, pa.top, P.TM.x - gap, pa.top + t, noseFill);
  bar(ctx, P.TM.x + gap, pa.top, P.TR.x - gap, pa.top + t, noseFill);
  // bottom
  bar(ctx, P.BL.x + gap, pa.bottom - t, P.BM.x - gap, pa.bottom, noseFill);
  bar(ctx, P.BM.x + gap, pa.bottom - t, P.BR.x - gap, pa.bottom, noseFill);
  // left & right (single segment each)
  bar(ctx, pa.left, P.TL.y + gap, pa.left + t, P.BL.y - gap, noseFill);
  bar(ctx, pa.right - t, P.TR.y + gap, pa.right, P.BR.y - gap, noseFill);
}

function bar(ctx, x1, y1, x2, y2, fillFor) {
  const x = Math.min(x1, x2), y = Math.min(y1, y2);
  const wd = Math.abs(x2 - x1), ht = Math.abs(y2 - y1);
  if (wd <= 0 || ht <= 0) return;
  ctx.fillStyle = fillFor(x1, y1, x2, y2);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, wd, ht, Math.min(wd, ht) * 0.35);
  else ctx.rect(x, y, wd, ht);
  ctx.fill();
  // top highlight on the nose
  ctx.fillStyle = 'rgba(176,255,176,0.14)';
  ctx.fillRect(x, y, wd, Math.max(1, ht * 0.18));
}

function drawDiamonds(ctx, w, h, pa, u) {
  const off = u.cushion * 0.5;
  const spots = [
    [pa.left + pa.w * 0.25, pa.top - off, 0], [pa.cx, pa.top - off, 0], [pa.left + pa.w * 0.75, pa.top - off, 0],
    [pa.left + pa.w * 0.25, pa.bottom + off, 0], [pa.cx, pa.bottom + off, 0], [pa.left + pa.w * 0.75, pa.bottom + off, 0],
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
