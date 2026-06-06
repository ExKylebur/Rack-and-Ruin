import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  unitsFor,
  playArea,
  fitCanvas,
  pocketLayout,
  toPx,
  toRel,
  CUSHION_NOSE_FRAC,
} from '../src/geometry.js';

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('unitsFor scales linearly with canvas width', () => {
  const u1 = unitsFor({ w: 1000, h: 500 });
  const u2 = unitsFor({ w: 2000, h: 1000 });
  assert.ok(approx(u2.ballR, 2 * u1.ballR), 'ballR doubles');
  assert.ok(approx(u2.cushion, 2 * u1.cushion), 'cushion doubles');
  assert.ok(approx(u2.pocketR, 2 * u1.pocketR), 'pocketR doubles');
});

test('unitsFor: pocket radius ~2x ball radius, side pocket larger', () => {
  const u = unitsFor({ w: 1200, h: 660 });
  assert.ok(approx(u.pocketR, 2 * u.ballR, 1e-9), 'corner pocket = 2x ball radius');
  assert.ok(u.sidePocketR > u.pocketR, 'side pocket larger than corner');
  assert.ok(u.ballR > 0 && u.cushion > 0, 'positive units');
});

test('playArea is inset from the canvas by the cushion', () => {
  const dims = { w: 1000, h: 500 };
  const u = unitsFor(dims);
  const pa = playArea(dims);
  assert.ok(approx(pa.left, u.cushion));
  assert.ok(approx(pa.top, u.cushion));
  assert.ok(approx(pa.right, 1000 - u.cushion));
  assert.ok(approx(pa.bottom, 500 - u.cushion));
  assert.ok(approx(pa.w, 1000 - 2 * u.cushion));
  assert.ok(approx(pa.cx, 500));
  assert.ok(approx(pa.cy, 250));
});

test('fitCanvas yields a 2:1 PLAY AREA that fits the available box', () => {
  const { w, h } = fitCanvas(1600, 900);
  assert.ok(w <= 1600 && h <= 900, 'fits inside available box');
  const pa = playArea({ w, h });
  assert.ok(approx(pa.w / pa.h, 2, 1e-3), `play area aspect ${pa.w / pa.h} should be 2:1`);
});

test('fitCanvas is limited by height when the box is wide', () => {
  const wide = fitCanvas(10000, 600);
  const pa = playArea(wide);
  assert.ok(approx(pa.w / pa.h, 2, 1e-3));
  assert.ok(wide.h <= 600);
});

test('rel<->px round trips within the play area', () => {
  const dims = { w: 1000, h: 540 };
  const pt = { x: 321.5, y: 222.25 };
  const rel = toRel(pt, dims);
  assert.ok(rel.u >= 0 && rel.u <= 1 && rel.v >= 0 && rel.v <= 1);
  const back = toPx(rel, dims);
  assert.ok(approx(back.x, pt.x, 1e-6) && approx(back.y, pt.y, 1e-6));
});

test('pocketLayout: 6 pockets at corners + side midpoints by default', () => {
  const dims = { w: 1000, h: 540 };
  const pa = playArea(dims);
  const u = unitsFor(dims);
  const ins = u.cushion * CUSHION_NOSE_FRAC, insS = ins;
  const pk = pocketLayout(dims);
  assert.equal(pk.length, 6);
  // corners are inset diagonally into the mouth
  assert.ok(approx(pk[0].x, pa.left + ins) && approx(pk[0].y, pa.top + ins), 'TL');
  assert.ok(approx(pk[2].x, pa.right - ins) && approx(pk[2].y, pa.top + ins), 'TR');
  assert.ok(approx(pk[5].x, pa.right - ins) && approx(pk[5].y, pa.bottom - ins), 'BR');
  // side pockets stay centred on the rail, inset slightly into the bed
  assert.ok(approx(pk[1].x, pa.cx) && approx(pk[1].y, pa.top + insS), 'TM');
  assert.ok(approx(pk[4].x, pa.cx) && approx(pk[4].y, pa.bottom - insS), 'BM');
  assert.ok(approx(pk[1].r, u.sidePocketR) && approx(pk[0].r, u.pocketR));
});

test('pocketLayout: a moved pocket overrides its default position', () => {
  const dims = { w: 1000, h: 540 };
  const moved = { 0: { u: 0.5, v: 0.5 } }; // drag TL pocket to play-area centre
  const pk = pocketLayout(dims, moved);
  const center = toPx({ u: 0.5, v: 0.5 }, dims);
  assert.ok(approx(pk[0].x, center.x) && approx(pk[0].y, center.y), 'moved to centre');
  assert.equal(pk[0].moved, true);
  // unmoved pockets keep their (inset) default position
  const pa = playArea(dims);
  const ins = unitsFor(dims).cushion * CUSHION_NOSE_FRAC;
  assert.ok(approx(pk[2].x, pa.right - ins) && approx(pk[2].y, pa.top + ins));
});
