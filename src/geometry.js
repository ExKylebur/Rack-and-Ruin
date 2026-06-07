// geometry.js — table geometry as pure functions of canvas dimensions.
//
// One place owns "where is everything and how big." Physics and rendering both
// derive their numbers here, so they can never disagree (the bug that made Move
// Hole / Warp / Big Ball change physics but not visuals).
//
// Coordinate model (Decision D1): gameplay positions are stored in the state as
// table-RELATIVE units {u, v} in 0..1 of the play area. They become pixels only
// at the edge (physics/render) via toPx(). This keeps state resolution-
// independent so two online players on different screens share identical state.

// Cushion (rail) width as a fraction of canvas width. Uniform on all four sides.
export const CUSHION_FRAC = 0.0455;
// Ball radius as a fraction of PLAY-AREA width (real pool: ~1.1%).
export const BALL_FRAC = 0.0125;
// Corner pocket capture radius / ball radius (real: 4.5" mouth ≈ one ball diameter).
export const POCKET_MULT = 2.0;
// Side pockets run ~12% larger than corners (real: 5" vs 4.5").
export const SIDE_POCKET_MULT = 1.12;

export function unitsFor(dims) {
  const cushion = dims.w * CUSHION_FRAC;
  const playW = dims.w - 2 * cushion;
  const ballR = playW * BALL_FRAC;
  const pocketR = ballR * POCKET_MULT;
  const sidePocketR = pocketR * SIDE_POCKET_MULT;
  return { cushion, playW, ballR, pocketR, sidePocketR };
}

export function playArea(dims) {
  const cushion = dims.w * CUSHION_FRAC;
  return {
    left: cushion,
    top: cushion,
    right: dims.w - cushion,
    bottom: dims.h - cushion,
    w: dims.w - 2 * cushion,
    h: dims.h - 2 * cushion,
    cx: dims.w / 2,
    cy: dims.h / 2,
  };
}

// Choose the largest canvas (within availW x availH) whose PLAY AREA is 2:1,
// the real proportion of an American pool playing surface.
export function fitCanvas(availW, availH) {
  const f = CUSHION_FRAC;
  // Derivation: playW = 2*playH  =>  canvas h = w*(1+2f)/2.
  const wByHeight = (availH * 2) / (1 + 2 * f);
  const w = Math.min(availW, wByHeight);
  const h = (w * (1 + 2 * f)) / 2;
  return { w, h };
}

// Relative {u,v} (0..1 of play area) -> absolute pixels.
export function toPx(rel, dims) {
  const pa = playArea(dims);
  return { x: pa.left + rel.u * pa.w, y: pa.top + rel.v * pa.h };
}

// Absolute pixels -> relative {u,v}.
export function toRel(pt, dims) {
  const pa = playArea(dims);
  return { u: (pt.x - pa.left) / pa.w, v: (pt.y - pa.top) / pa.h };
}

// How far the cushion nose protrudes onto the bed, as a fraction of cushion width.
export const CUSHION_NOSE_FRAC = 0.42;
// Real cushion cut angles at the pockets (degrees of rail/cushion facing).
export const CORNER_CUT_DEG = 142;
export const SIDE_CUT_DEG = 104;

// The cushions as a set of straight bed-facing FACES: each rail span has a flat
// nose plus an angled jaw at each end that funnels the ball into the pocket
// (corner jaws cut at 142°, side jaws at 104°). Physics bounces off these faces
// and render draws the same polygons, so the funnel geometry is shared — no more
// flat rebound near the pockets.
//
// Returns { nose, list: [{ poly:[{x,y}*4], faces:[{x1,y1,x2,y2,nx,ny}*3] }] }
// where `poly` is the cushion outline (for drawing) and `faces` are the three
// bed-facing segments (jaw, nose, jaw) with inward unit normals (for physics).
export function cushions(dims) {
  const pa = playArea(dims);
  const u = unitsFor(dims);
  const nose = u.cushion * CUSHION_NOSE_FRAC;
  // How far from each pocket the cushion's rail end sits (the mouth half-width):
  // bigger = wider opening. Corners get a generously wide mouth.
  const mhCorner = u.pocketR * 1.2;
  const mhSide = u.sidePocketR * 0.95;
  // Along-rail run of the angled facing (bigger = more visibly angled jaw).
  const runCorner = nose * 1.35;
  const runSide = nose * 1.0;
  const cx = pa.cx, cy = pa.cy;

  const pt = (orient, along, coord) => (orient === 'h' ? { x: along, y: coord } : { x: coord, y: along });
  // normal of p1->p2, oriented to point AWAY from the cushion body (toward the
  // bed) by flipping it away from the piece centroid.
  const seg = (p1, p2, ctr) => {
    let nx = -(p2.y - p1.y), ny = p2.x - p1.x;
    const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    if ((mx - ctr.x) * nx + (my - ctr.y) * ny < 0) { nx = -nx; ny = -ny; }
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, nx, ny };
  };

  function span(orient, railC, noseC, lo, hi, rail) {
    const loMh = lo.type === 'corner' ? mhCorner : mhSide;
    const loRun = lo.type === 'corner' ? runCorner : runSide;
    const hiMh = hi.type === 'corner' ? mhCorner : mhSide;
    const hiRun = hi.type === 'corner' ? runCorner : runSide;
    const Mlo = pt(orient, lo.along + loMh, railC);
    const Nlo = pt(orient, lo.along + loMh + loRun, noseC);
    const Nhi = pt(orient, hi.along - hiMh - hiRun, noseC);
    const Mhi = pt(orient, hi.along - hiMh, railC);
    const poly = [Mlo, Nlo, Nhi, Mhi];
    const ctr = poly.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    const tag = (sg) => { sg.rail = rail; return sg; };
    return { rail, poly, faces: [tag(seg(Mlo, Nlo, ctr)), tag(seg(Nlo, Nhi, ctr)), tag(seg(Nhi, Mhi, ctr))] };
  }

  const corner = (along) => ({ along, type: 'corner' });
  const side = (along) => ({ along, type: 'side' });
  const list = [
    span('h', pa.top, pa.top + nose, corner(pa.left), side(cx), 'top'),
    span('h', pa.top, pa.top + nose, side(cx), corner(pa.right), 'top'),
    span('h', pa.bottom, pa.bottom - nose, corner(pa.left), side(cx), 'bottom'),
    span('h', pa.bottom, pa.bottom - nose, side(cx), corner(pa.right), 'bottom'),
    span('v', pa.left, pa.left + nose, corner(pa.top), corner(pa.bottom), 'left'),
    span('v', pa.right, pa.right - nose, corner(pa.top), corner(pa.bottom), 'right'),
  ];
  return { nose, list };
}

// The six pockets in pixels. `moved` maps pocketIndex -> {u,v} for any pocket
// relocated by the Move Hole card; unlisted pockets keep their default spot.
export function pocketLayout(dims, moved = {}) {
  const pa = playArea(dims);
  const u = unitsFor(dims);
  // Side pockets are recessed back INTO the rail (away from the bed) so the hole
  // doesn't bulge into the play area — only its mouth meets the cushion line.
  const sr = u.sidePocketR * 0.55;
  const defaults = [
    { x: pa.left, y: pa.top, r: u.pocketR, label: 'TL' },
    { x: pa.cx, y: pa.top - sr, r: u.sidePocketR, label: 'TM' },
    { x: pa.right, y: pa.top, r: u.pocketR, label: 'TR' },
    { x: pa.left, y: pa.bottom, r: u.pocketR, label: 'BL' },
    { x: pa.cx, y: pa.bottom + sr, r: u.sidePocketR, label: 'BM' },
    { x: pa.right, y: pa.bottom, r: u.pocketR, label: 'BR' },
  ];
  return defaults.map((d, i) => {
    if (moved[i]) {
      const p = toPx(moved[i], dims);
      return { x: p.x, y: p.y, r: d.r, label: d.label, index: i, moved: true };
    }
    return { x: d.x, y: d.y, r: d.r, label: d.label, index: i, moved: false };
  });
}

// Warp Rail: an inward cushion ridge bulging into the bed near an anchor pocket.
// `warp = { anchor: pocketIndex, turns }`. Returns the reflective faces (inward
// normals, like cushions()) plus the render polygon — so physics and render use
// the exact same shape. Returns null when there is no warp.
export function warpRail(dims, warp) {
  if (!warp || warp.anchor == null) return null;
  const pa = playArea(dims);
  const u = unitsFor(dims);
  const p = pocketLayout(dims)[warp.anchor];
  if (!p) return null;

  // Bulge from the nearer long rail (top/bottom), poking toward the bed centre.
  const onTop = p.y < pa.cy;
  const railY = onTop ? pa.top : pa.bottom;
  const inward = onTop ? 1 : -1;             // +y heads into the bed from the top rail
  const halfW = pa.w * 0.16;
  const depth = pa.h * 0.22;
  // Keep the ridge on the bed and clear of the corner pockets.
  const margin = halfW + u.pocketR * 1.1;
  const cx = Math.max(pa.left + margin, Math.min(pa.right - margin, p.x));

  const baseL = { x: cx - halfW, y: railY };
  const apex = { x: cx, y: railY + inward * depth };
  const baseR = { x: cx + halfW, y: railY };
  const ctr = { x: cx, y: railY + inward * depth / 3 }; // triangle centroid

  const seg = (a, b) => {
    let nx = -(b.y - a.y), ny = b.x - a.x;
    const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if ((mx - ctr.x) * nx + (my - ctr.y) * ny < 0) { nx = -nx; ny = -ny; } // point outward
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, nx, ny, rail: 'warp' };
  };

  return { faces: [seg(baseL, apex), seg(apex, baseR)], poly: [baseL, apex, baseR] };
}
