// render/table.js — draws the table FROM state (geometry.js + state.movedPockets
// + state.warp). No hardcoded pocket positions; the cache invalidates whenever
// pockets move or the table warps, so Move Hole / Warp Rail repaint correctly.

import { playArea, pocketLayout, unitsFor, CUSHION_NOSE_FRAC } from '../geometry.js';

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

  // --- 1. Cloth: the whole surface (rails + bed) is green felt -----------
  const cloth = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.06, w * 0.5, h * 0.5, w * 0.62);
  cloth.addColorStop(0, '#2faf66');
  cloth.addColorStop(0.55, '#1d8049');
  cloth.addColorStop(1, '#135e36');
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, w, h);

  // subtle bed weave + sheen, clipped to the play area
  ctx.save();
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

  // --- 2. Wooden cabinet frame around the outside ------------------------
  drawWoodFrame(ctx, w, h, u.cushion * 0.34);

  // --- 3. Cushions: raised green bumpers with jaws that funnel pockets ---
  drawCushions(ctx, state.dims);

  // --- 4. Pocket holes (on top, so the cushion jaws meet the mouth) ------
  pockets.forEach((p) => drawPocketHole(ctx, p));

  // --- 5. Rail diamonds + table markings ---------------------------------
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

// Cushions, drawn to match a real table: chunky green bumpers whose bed-facing
// nose runs close to each pocket, with an angled FACING cut at the pocket (corner
// jaws ~142 deg, side jaws ~104 deg). The pocket holes are painted on top, so they
// carve the mouth. (The physics funnel lives in geometry.cushions(); this is the
// visual, kept deliberately full-bodied so bumpers don't look starved next to the
// holes.)
function drawCushions(ctx, dims) {
  const pa = playArea(dims);
  const u = unitsFor(dims);
  const pkt = pocketLayout(dims);
  const P = {}; pkt.forEach((p) => { P[p.label] = p; });
  const cd = u.cushion * CUSHION_NOSE_FRAC;    // match the physics bounce-line depth
  const runC = cd / Math.tan((180 - 142) * Math.PI / 180); // corner facing run (~1.3*cd)
  const runS = cd / Math.tan((180 - 104) * Math.PI / 180); // side facing run (~0.25*cd)
  const mnC = u.pocketR * 0.30;   // how close the nose runs to a corner pocket
  const mnS = u.sidePocketR * 0.45;

  const endOf = (p) => (p.r === u.sidePocketR ? { mn: mnS, run: runS } : { mn: mnC, run: runC });
  const span = (orient, railC, bedC, loP, hiP) => {
    const lo = endOf(loP), hi = endOf(hiP);
    const aLo = orient === 'h' ? loP.x : loP.y;
    const aHi = orient === 'h' ? hiP.x : hiP.y;
    const mk = (a, c) => (orient === 'h' ? { x: a, y: c } : { x: c, y: a });
    const noseLo = mk(aLo + lo.mn, bedC);
    const railLo = mk(aLo + lo.mn + lo.run, railC);
    const noseHi = mk(aHi - hi.mn, bedC);
    const railHi = mk(aHi - hi.mn - hi.run, railC);
    drawCushionPoly(ctx, railLo, noseLo, noseHi, railHi, railC, bedC, orient);
  };

  span('h', pa.top, pa.top + cd, P.TL, P.TM);
  span('h', pa.top, pa.top + cd, P.TM, P.TR);
  span('h', pa.bottom, pa.bottom - cd, P.BL, P.BM);
  span('h', pa.bottom, pa.bottom - cd, P.BM, P.BR);
  span('v', pa.left, pa.left + cd, P.TL, P.BL);
  span('v', pa.right, pa.right - cd, P.TR, P.BR);
}

function drawCushionPoly(ctx, railLo, noseLo, noseHi, railHi, railC, bedC, orient) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(railLo.x, railLo.y);
  ctx.lineTo(noseLo.x, noseLo.y);
  ctx.lineTo(noseHi.x, noseHi.y);
  ctx.lineTo(railHi.x, railHi.y);
  ctx.closePath();
  const g = orient === 'h'
    ? ctx.createLinearGradient(0, railC, 0, bedC)
    : ctx.createLinearGradient(railC, 0, bedC, 0);
  g.addColorStop(0, '#0b4327');   // recessed at the rail
  g.addColorStop(0.55, '#1f8a4f');
  g.addColorStop(1, '#3bc673');   // bright crest at the nose
  ctx.fillStyle = g;
  ctx.fill();
  // shadow the raised nose casts onto the bed
  const sign = Math.sign(bedC - railC);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (orient === 'h') { ctx.moveTo(noseLo.x, noseLo.y + sign * 2); ctx.lineTo(noseHi.x, noseHi.y + sign * 2); }
  else { ctx.moveTo(noseLo.x + sign * 2, noseLo.y); ctx.lineTo(noseHi.x + sign * 2, noseHi.y); }
  ctx.stroke();
  // bright crest along the bed-facing edges (nose + the two angled facings)
  ctx.strokeStyle = 'rgba(205,255,215,0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(railLo.x, railLo.y);
  ctx.lineTo(noseLo.x, noseLo.y);
  ctx.lineTo(noseHi.x, noseHi.y);
  ctx.lineTo(railHi.x, railHi.y);
  ctx.stroke();
  ctx.restore();
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
