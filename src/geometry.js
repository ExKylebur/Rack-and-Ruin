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
export const CUSHION_NOSE_FRAC = 0.5;
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
  const pk = pocketLayout(dims); // inset pockets (drop-points in the mouths)
  const P = {}; pk.forEach((p) => { P[p.label] = p; });

  const alongOf = (orient, p) => (orient === 'h' ? p.x : p.y);
  const crossOf = (orient, p) => (orient === 'h' ? p.y : p.x);
  const mk = (orient, a, c) => (orient === 'h' ? { x: a, y: c } : { x: c, y: a });
  const seg = (p1, p2, ctr) => {
    let nx = -(p2.y - p1.y), ny = p2.x - p1.x;
    const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    if ((mx - ctr.x) * nx + (my - ctr.y) * ny < 0) { nx = -nx; ny = -ny; }
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, nx, ny };
  };

  // The cushion's bed-facing NOSE is a straight bar between the two pockets, with
  // each end clipped where it meets the (inset) pocket circle. The round holes are
  // drawn on top, carving the angled "mouth". Physics bounces off the nose; balls
  // aimed at a pocket reach the inset drop-point and fall in instead of bouncing.
  function span(orient, railC, noseC, loP, hiP) {
    const offAt = (p, lineC) => Math.sqrt(Math.max(0, p.r * p.r - (lineC - crossOf(orient, p)) ** 2));
    const aLo = alongOf(orient, loP), aHi = alongOf(orient, hiP);
    const Nlo = mk(orient, aLo + offAt(loP, noseC), noseC);
    const Nhi = mk(orient, aHi - offAt(hiP, noseC), noseC);
    const Rlo = mk(orient, aLo + offAt(loP, railC), railC);
    const Rhi = mk(orient, aHi - offAt(hiP, railC), railC);
    const poly = [Nlo, Nhi, Rhi, Rlo];
    const ctr = poly.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    return { poly, faces: [seg(Nlo, Nhi, ctr)] };
  }

  const list = [
    span('h', pa.top, pa.top + nose, P.TL, P.TM),
    span('h', pa.top, pa.top + nose, P.TM, P.TR),
    span('h', pa.bottom, pa.bottom - nose, P.BL, P.BM),
    span('h', pa.bottom, pa.bottom - nose, P.BM, P.BR),
    span('v', pa.left, pa.left + nose, P.TL, P.BL),
    span('v', pa.right, pa.right - nose, P.TR, P.BR),
  ];
  return { nose, list };
}

// The six pockets in pixels. `moved` maps pocketIndex -> {u,v} for any pocket
// relocated by the Move Hole card; unlisted pockets keep their default spot.
export function pocketLayout(dims, moved = {}) {
  const pa = playArea(dims);
  const u = unitsFor(dims);
  // Pocket drop-points sit at the inner cushion corner (one nose-depth into the
  // bed), where the cushion mouths actually open. A ball hugging the rail rides at
  // depth ~nose+ballR, so the capture point must be this deep or the cushions wall
  // the ball out of the corner before it can drop.
  const nose = u.cushion * CUSHION_NOSE_FRAC;
  const ins = nose;   // corner inset, along each axis
  const insS = nose;  // side-pocket inset into the bed
  const defaults = [
    { x: pa.left + ins, y: pa.top + ins, r: u.pocketR, label: 'TL' },
    { x: pa.cx, y: pa.top + insS, r: u.sidePocketR, label: 'TM' },
    { x: pa.right - ins, y: pa.top + ins, r: u.pocketR, label: 'TR' },
    { x: pa.left + ins, y: pa.bottom - ins, r: u.pocketR, label: 'BL' },
    { x: pa.cx, y: pa.bottom - insS, r: u.sidePocketR, label: 'BM' },
    { x: pa.right - ins, y: pa.bottom - ins, r: u.pocketR, label: 'BR' },
  ];
  return defaults.map((d, i) => {
    if (moved[i]) {
      const p = toPx(moved[i], dims);
      return { x: p.x, y: p.y, r: d.r, label: d.label, index: i, moved: true };
    }
    return { x: d.x, y: d.y, r: d.r, label: d.label, index: i, moved: false };
  });
}
