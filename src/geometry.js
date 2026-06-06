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

// The six pockets in pixels. `moved` maps pocketIndex -> {u,v} for any pocket
// relocated by the Move Hole card; unlisted pockets keep their default spot.
export function pocketLayout(dims, moved = {}) {
  const pa = playArea(dims);
  const u = unitsFor(dims);
  const defaults = [
    { x: pa.left, y: pa.top, r: u.pocketR, label: 'TL' },
    { x: pa.cx, y: pa.top, r: u.sidePocketR, label: 'TM' },
    { x: pa.right, y: pa.top, r: u.pocketR, label: 'TR' },
    { x: pa.left, y: pa.bottom, r: u.pocketR, label: 'BL' },
    { x: pa.cx, y: pa.bottom, r: u.sidePocketR, label: 'BM' },
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
