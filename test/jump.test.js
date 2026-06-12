// Jump shot + CCD anti-tunneling + oil friction + warp-blocking regression tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCanvas, playArea, warpBlocksPocket } from '../src/geometry.js';
import {
  makeSim, freshTurn, applyShot, runToRest, BASE_BALL_R, MAX_SHOT_SPEED,
} from '../src/physics.js';

const CANON = fitCanvas(1000, 1e9);
const PA = playArea(CANON);

const ball = (num, x, y, vx = 0, vy = 0) => ({
  num, x, y, vx, vy, r: BASE_BALL_R, size: 1, pocketed: false, roll: 0, air: 0, airTotal: 0,
});

test('jump shot clears an interposed ball and lands beyond it', () => {
  const cue = ball(0, PA.left + 120, PA.top + 150);
  const blocker = ball(5, PA.left + 170, PA.top + 150);
  const sim = [cue, blocker];
  applyShot(sim, 0.5, 0, {}, { x: 0, y: 0 }, true); // jump, half power -> ~28% of table
  const turn = freshTurn();
  runToRest(sim, [], turn, 6000);
  assert.equal(turn.firstHit, null, 'flew clean over the blocker — no contact');
  assert.equal(blocker.x, PA.left + 170, 'blocker undisturbed');
  assert.ok(cue.x > blocker.x + 2 * BASE_BALL_R, 'cue landed beyond the blocker');
  assert.ok(!cue.pocketed, 'cue stayed on the table');
});

test('full-power jump over the rail leaves the table = scratch', () => {
  const cue = ball(0, PA.right - 80, PA.top + 200, 0, 0);
  const sim = [cue];
  applyShot(sim, 1, 0, {}, { x: 0, y: 0 }, true); // flying right, way past the rail
  const turn = freshTurn();
  runToRest(sim, [], turn, 6000);
  assert.ok(cue.pocketed, 'cue left the table');
  assert.ok(turn.cueScratched, 'recorded as a scratch');
});

test('a non-jump shot still cannot pass through the rails', () => {
  const cue = ball(0, PA.right - 80, PA.top + 200, MAX_SHOT_SPEED, 0);
  const sim = [cue];
  const turn = freshTurn();
  runToRest(sim, [], turn, 6000);
  assert.ok(!cue.pocketed && cue.x < PA.right, 'bounced back inside the bed');
});

test('extreme thin cut at full speed still makes contact (no tunneling)', () => {
  // The aim line passes the target at 95% of the combined radii — a ~13px-wide
  // contact window that a 38px/frame Euler step used to skip entirely.
  const off = 2 * BASE_BALL_R * 0.95;
  const cue = ball(0, PA.left + 150, PA.top + 220, MAX_SHOT_SPEED, 0);
  const obj = ball(7, PA.left + 450, PA.top + 220 + off);
  const sim = [cue, obj];
  const turn = freshTurn();
  runToRest(sim, [], turn, 6000);
  assert.equal(turn.firstHit, 7, 'thin-cut contact registered');
  assert.ok(Math.abs(obj.vx) + Math.abs(obj.vy) > 0 || obj.x !== PA.left + 450, 'target ball was moved');
});

test('oil cue: slicker than felt but stops well before the frame cap', () => {
  // (positions aren't comparable — the oiled cue crosses the table and banks off
  // rails — so compare how long each takes to come to rest instead)
  const cue = ball(0, PA.left + 60, PA.cy, 0, 0);
  const sim = [cue];
  applyShot(sim, 0.25, 0, { oilCue: true });
  const oiled = runToRest(sim, [], freshTurn(), 6000, { effects: { oilCue: true } });
  const cue2 = ball(0, PA.left + 60, PA.cy, 0, 0);
  const sim2 = [cue2];
  applyShot(sim2, 0.25, 0, {});
  const plain = runToRest(sim2, [], freshTurn(), 6000);
  assert.ok(oiled > plain * 2, `oil drifts much longer than felt (${oiled} vs ${plain} frames)`);
  assert.ok(oiled < 3600, `oil shot settles reasonably fast (took ${oiled} frames; pre-tune ~4500)`);
});

// ---- Warp Rail: a bend must not seal another pocket ----
test('warpBlocksPocket allows a modest warp near its own corner', () => {
  assert.equal(warpBlocksPocket(CANON, {}, 5, { u: 0.82, v: 0.78 }), -1);
});

test('warpBlocksPocket flags a drop crowding another pocket (screenshot bug)', () => {
  // BR dragged to just under the TR pocket — the mouths crowd and the bent
  // rails wall TR off (the exact configuration from the user's screenshot).
  const blocked = warpBlocksPocket(CANON, {}, 5, { u: 0.97, v: 0.12 });
  assert.equal(blocked, 2, `expected TR (2), got ${blocked}`);
});

test('warpBlocksPocket flags a bent rail lying across a distant mouth', () => {
  // BR dragged to just left of the top-middle pocket: the long TR->drop rail
  // runs right under the TM mouth and seals it.
  const blocked = warpBlocksPocket(CANON, {}, 5, { u: 0.42, v: 0.02 });
  assert.equal(blocked, 1, `expected TM (1), got ${blocked}`);
});

test('warpBlocksPocket leaves a bend through open felt alone', () => {
  assert.equal(warpBlocksPocket(CANON, {}, 5, { u: 0.55, v: 0.5 }), -1);
});
