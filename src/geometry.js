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
// The table boundary is a 6-vertex polygon, one vertex per pocket (clockwise:
// TL, TM, TR, BR, BM, BL). Each of the 6 edges between consecutive pockets is a
// cushion. Warp Rail moves a pocket's vertex (moved[i].warp), so the two adjacent
// edges bend to follow it; Move Hole (no warp flag) leaves the boundary straight.
// With default vertices this reproduces the original axis-aligned table exactly.
export function cushions(dims, moved = {}) {
  const pa = playArea(dims);
  const u = unitsFor(dims);
  const nose = u.cushion * CUSHION_NOSE_FRAC;
  // Mouth half-width at each pocket (bigger = wider opening) and the along-rail
  // run of the angled jaw facing (bigger = more visibly angled).
  const mhCorner = u.pocketR * 1.2;
  const mhSide = u.sidePocketR * 0.95;
  const runCorner = nose * 1.35;
  const runSide = nose * 1.0;

  // Boundary vertex for pocket `idx`: its warped position if Warp Rail moved it,
  // else its default rail-line corner/side point.
  const vert = (idx, dx, dy, type) => {
    const m = moved[idx];
    const p = (m && m.warp) ? toPx(m, dims) : { x: dx, y: dy };
    return { x: p.x, y: p.y, type };
  };
  const V = {
    TL: vert(0, pa.left, pa.top, 'corner'),
    TM: vert(1, pa.cx, pa.top, 'side'),
    TR: vert(2, pa.right, pa.top, 'corner'),
    BL: vert(3, pa.left, pa.bottom, 'corner'),
    BM: vert(4, pa.cx, pa.bottom, 'side'),
    BR: vert(5, pa.right, pa.bottom, 'corner'),
  };
  const edges = [
    [V.TL, V.TM, 'top'], [V.TM, V.TR, 'top'],
    [V.TR, V.BR, 'right'],
    [V.BR, V.BM, 'bottom'], [V.BM, V.BL, 'bottom'],
    [V.BL, V.TL, 'left'],
  ];

  // segment with an inward unit normal (oriented to agree with the edge's
  // interior normal so every face pushes toward the bed).
  const seg = (p1, p2, inx, iny, rail) => {
    let nx = -(p2.y - p1.y), ny = p2.x - p1.x;
    const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    if (nx * inx + ny * iny < 0) { nx = -nx; ny = -ny; }
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, nx, ny, rail };
  };

  const buildEdge = (A, B, rail) => {
    let ex = B.x - A.x, ey = B.y - A.y;
    const L = Math.hypot(ex, ey) || 1; ex /= L; ey /= L;       // along-edge unit
    const inx = -ey, iny = ex;                                  // interior normal (CW winding)
    const loMh = A.type === 'corner' ? mhCorner : mhSide;
    const loRun = A.type === 'corner' ? runCorner : runSide;
    const hiMh = B.type === 'corner' ? mhCorner : mhSide;
    const hiRun = B.type === 'corner' ? runCorner : runSide;
    const Mlo = { x: A.x + ex * loMh, y: A.y + ey * loMh };
    const Nlo = { x: A.x + ex * (loMh + loRun) + inx * nose, y: A.y + ey * (loMh + loRun) + iny * nose };
    const Nhi = { x: B.x - ex * (hiMh + hiRun) + inx * nose, y: B.y - ey * (hiMh + hiRun) + iny * nose };
    const Mhi = { x: B.x - ex * hiMh, y: B.y - ey * hiMh };
    return {
      rail, poly: [Mlo, Nlo, Nhi, Mhi],
      faces: [seg(Mlo, Nlo, inx, iny, rail), seg(Nlo, Nhi, inx, iny, rail), seg(Nhi, Mhi, inx, iny, rail)],
    };
  };

  return { nose, list: edges.map(([A, B, rail]) => buildEdge(A, B, rail)) };
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
    { x: pa.cx, y: pa.top - sr, r: u.sidePocketR, label: 'TM', side: true },
    { x: pa.right, y: pa.top, r: u.pocketR, label: 'TR' },
    { x: pa.left, y: pa.bottom, r: u.pocketR, label: 'BL' },
    { x: pa.cx, y: pa.bottom + sr, r: u.sidePocketR, label: 'BM', side: true },
    { x: pa.right, y: pa.bottom, r: u.pocketR, label: 'BR' },
  ];
  return defaults.map((d, i) => {
    const side = !!d.side;
    if (moved[i]) {
      const p = toPx(moved[i], dims);
      return { x: p.x, y: p.y, r: d.r, label: d.label, side, index: i, moved: true };
    }
    return { x: d.x, y: d.y, r: d.r, label: d.label, side, index: i, moved: false };
  });
}
