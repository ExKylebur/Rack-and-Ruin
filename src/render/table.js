// render/table.js — draws the table FROM state (geometry.js + state.movedPockets).
// No hardcoded pocket positions; the cache invalidates whenever pockets move, so
// Move Hole / Warp Rail (both relocate a pocket) repaint correctly.

import { playArea, pocketLayout, unitsFor, cushions } from '../geometry.js';

let _cache = { canvas: null, key: '' };

function geometryKey(state) {
  return JSON.stringify({
    w: Math.round(state.dims.w),
    h: Math.round(state.dims.h),
    moved: state.movedPockets,
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
  wood.addColorStop(0, '#5e3a1c');
  wood.addColorStop(0.35, '#7d4d24');
  wood.addColorStop(0.65, '#6a3f1c');
  wood.addColorStop(1, '#3c2410');
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, w, h);
  // wood grain: layered drifting bands, denser and warmer than before
  ctx.save();
  for (let y = 0; y < h; y += 2) {
    const wave = Math.sin(y * 0.085) * 0.5 + Math.sin(y * 0.021 + 2.1) * 0.5;
    ctx.fillStyle = `rgba(255,206,150,${0.014 + (wave + 1) * 0.014})`;
    ctx.fillRect(0, y, w, 1);
  }
  for (let x = 0; x < w; x += 7) {
    ctx.fillStyle = `rgba(30,14,4,${0.03 + ((x * 13) % 17) / 17 * 0.04})`;
    ctx.fillRect(x, 0, 1, h);
  }
  ctx.restore();
  // outer bevel: highlight on top/left, deep shadow at the rim
  ctx.strokeStyle = 'rgba(255,222,170,0.22)'; ctx.lineWidth = 2; ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  // brass inlay line running around the rail surface
  const inset = u.cushion * 0.32;
  ctx.strokeStyle = 'rgba(255,210,130,0.30)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

  // --- 2. Tournament felt bed inside the play area --------------------------
  ctx.save();
  const felt = ctx.createRadialGradient(w * 0.5, h * 0.42, w * 0.05, w * 0.5, h * 0.5, w * 0.58);
  felt.addColorStop(0, '#2fb86c');
  felt.addColorStop(0.5, '#1e8d50');
  felt.addColorStop(0.85, '#15693c');
  felt.addColorStop(1, '#0f5430');
  ctx.fillStyle = felt;
  ctx.fillRect(pa.left, pa.top, pa.w, pa.h);
  ctx.beginPath();
  ctx.rect(pa.left, pa.top, pa.w, pa.h);
  ctx.clip();
  // brushed nap: faint diagonal weave instead of random speckle
  ctx.globalAlpha = 0.05;
  ctx.lineWidth = 1;
  for (let d = -pa.h; d < pa.w; d += 5) {
    ctx.strokeStyle = (d / 5) % 2 ? 'rgba(255,255,255,0.5)' : 'rgba(0,40,16,0.6)';
    ctx.beginPath();
    ctx.moveTo(pa.left + d, pa.top);
    ctx.lineTo(pa.left + d + pa.h, pa.bottom);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // directional sheen (the room light raking across the cloth)
  const sheen = ctx.createLinearGradient(pa.left, pa.top, pa.right, pa.bottom);
  sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = sheen;
  ctx.fillRect(pa.left, pa.top, pa.w, pa.h);
  // subtle felt watermark in the centre
  ctx.save();
  ctx.translate(pa.cx, pa.cy);
  ctx.globalAlpha = 0.075;
  ctx.strokeStyle = '#dfffe9';
  ctx.lineWidth = 2;
  const wmR = Math.min(pa.h * 0.27, pa.w * 0.12);
  ctx.beginPath(); ctx.arc(0, 0, wmR, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, wmR * 0.82, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#dfffe9';
  ctx.font = `400 ${wmR * 0.62}px 'Bebas Neue', Outfit, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('R&R', 0, wmR * 0.04);
  ctx.restore();
  // soft inner shadow cast by the rails onto the cloth
  const ish = u.cushion * 1.1;
  const edges = [
    [pa.left, pa.top, pa.w, ish, 0, 1], [pa.left, pa.bottom - ish, pa.w, ish, 0, -1],
    [pa.left, pa.top, ish, pa.h, 1, 0], [pa.right - ish, pa.top, ish, pa.h, -1, 0],
  ];
  for (const [ex, ey, ew, eh, dx, dy] of edges) {
    const g = ctx.createLinearGradient(ex + (dx < 0 ? ew : 0), ey + (dy < 0 ? eh : 0),
      ex + (dx > 0 ? ew : dx < 0 ? 0 : 0), ey + (dy > 0 ? eh : dy < 0 ? 0 : 0));
    g.addColorStop(0, 'rgba(0,12,4,0.30)');
    g.addColorStop(1, 'rgba(0,12,4,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ex, ey, ew, eh);
  }
  ctx.restore();
  // crisp seam where the wooden rail meets the bed
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2.5;
  ctx.strokeRect(pa.left, pa.top, pa.w, pa.h);

  // --- 3. Cushions: green bumpers on the bed edge, angled into the pockets ---
  drawCushions(ctx, state.dims, state.movedPockets);

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
  // leather collar around the bore
  const ring = ctx.createRadialGradient(p.x - 2, p.y - 3, 2, p.x, p.y, p.r + 6);
  ring.addColorStop(0, 'rgba(96,50,22,0.35)');
  ring.addColorStop(0.6, 'rgba(46,22,9,0.9)');
  ring.addColorStop(1, 'rgba(14,6,2,0.97)');
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  // thin brass trim on the collar
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 4.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,205,130,0.22)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // the bore itself: pitch black with depth falloff
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fillStyle = '#030303';
  ctx.fill();
  const bore = ctx.createRadialGradient(p.x + p.r * 0.18, p.y + p.r * 0.22, 1, p.x, p.y, p.r);
  bore.addColorStop(0, 'rgba(28,24,20,0.5)');
  bore.addColorStop(0.5, 'rgba(8,6,5,0.85)');
  bore.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fillStyle = bore;
  ctx.fill();
  // crescent of light catching the upper-left inner lip
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(p.x - p.r * 0.16, p.y - p.r * 0.2, p.r * 0.97, Math.PI * 0.85, Math.PI * 1.7);
  ctx.strokeStyle = 'rgba(180,200,190,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

// Draw the cushions from the SAME geometry physics bounces off (geometry.cushions).
// Each cushion is full-depth in the middle of the rail and RECEDES to the rail line
// at each pocket via an angled facing — so the mouth opens toward the pocket and the
// facing funnels the ball in (it does not jut across the hole).
function drawCushions(ctx, dims, moved) {
  for (const c of cushions(dims, moved).list) {
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
    ctx.fillStyle = '#1f9456';
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
    // mother-of-pearl sight with a cool iridescent sheen
    const g = ctx.createLinearGradient(-s, -s, s, s);
    g.addColorStop(0, 'rgba(255,255,255,0.96)');
    g.addColorStop(0.45, 'rgba(226,232,244,0.95)');
    g.addColorStop(0.7, 'rgba(196,206,228,0.95)');
    g.addColorStop(1, 'rgba(168,150,182,0.92)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(40,22,8,0.65)'; ctx.lineWidth = 1; ctx.stroke();
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
