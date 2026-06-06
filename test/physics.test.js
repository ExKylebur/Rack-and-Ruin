import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, rackBalls } from '../src/state.js';
import { fitCanvas, playArea, cushions } from '../src/geometry.js';
import {
  makeSim, pocketsFor, freshTurn, applyShot, step, runToRest,
  BASE_BALL_R, MIN_SPEED,
} from '../src/physics.js';

const CANON = fitCanvas(1000, 1e9);
const PA = playArea(CANON);
const CU = cushions(CANON);

function freshState() {
  const s = createGameState();
  rackBalls(s);
  return s;
}

test('a struck ball eventually comes to rest', () => {
  const s = freshState();
  const sim = makeSim(s);
  const turn = freshTurn();
  applyShot(sim, 1, 0); // full power, straight right
  const frames = runToRest(sim, pocketsFor(s), turn, 6000);
  assert.ok(frames < 6000, 'shot settles before the frame cap');
  const cue = sim.find((b) => b.num === 0);
  if (!cue.pocketed) {
    assert.ok(Math.hypot(cue.vx, cue.vy) <= MIN_SPEED, 'cue is at rest');
  }
});

test('a ball bounces back off the right rail', () => {
  // place a lone ball moving right, clear of any pocket
  const sim = [{ num: 2, x: 500, y: 270, vx: 8, vy: 0, r: BASE_BALL_R, size: 1, pocketed: false, roll: 0 }];
  const pockets = []; // no pockets -> isolate the rail
  const turn = freshTurn();
  let bounced = false;
  for (let i = 0; i < 400 && !bounced; i++) {
    step(sim, pockets, 1, turn);
    if (sim[0].vx < 0) bounced = true;
  }
  assert.ok(bounced, 'velocity reversed after hitting the rail');
});

test('the cue ball drops when sent into a pocket (scratch)', () => {
  const s = freshState();
  const pockets = pocketsFor(s);
  const corner = pockets[0]; // TL
  const sim = [{
    num: 0, x: corner.x + 40, y: corner.y + 40, r: BASE_BALL_R, size: 1,
    vx: -6, vy: -6, pocketed: false, roll: 0,
  }];
  const turn = freshTurn();
  runToRest(sim, pockets, turn, 600);
  assert.ok(sim[0].pocketed, 'cue ball pocketed');
  assert.ok(turn.pocketed.includes(0) && turn.cueScratched, 'scratch recorded');
});

test('cue transfers motion to a target ball and records first hit', () => {
  const cue = { num: 0, x: 200, y: 270, vx: 10, vy: 0, r: BASE_BALL_R, size: 1, pocketed: false, roll: 0 };
  const obj = { num: 3, x: 200 + 2 * BASE_BALL_R - 0.5, y: 270, vx: 0, vy: 0, r: BASE_BALL_R, size: 1, pocketed: false, roll: 0 };
  const sim = [cue, obj];
  const turn = freshTurn();
  step(sim, [], 1, turn);
  assert.equal(turn.firstHit, 3, 'first object ball hit is the 3');
  assert.ok(obj.vx > 1, 'target ball gained forward velocity');
  assert.ok(cue.vx < 10, 'cue ball slowed');
});

test('a ball rebounds off the cushion nose, inset from the felt edge', () => {
  const nose = CU.list[0].faces[0]; // top-left span: the straight nose face
  const x = (nose.x1 + nose.x2) / 2;
  const noseY = nose.y1; // = PA.top + nose depth
  const b = { num: 2, x, y: PA.top + 90, vx: 0, vy: -8, r: BASE_BALL_R, size: 1, pocketed: false, roll: 0 };
  const sim = [b];
  const turn = freshTurn();
  for (let i = 0; i < 300 && b.vy <= 0; i++) step(sim, [], 1, turn);
  assert.ok(b.vy > 0, 'rebounded');
  const expected = noseY + b.r; // nose line, NOT PA.top + r (the felt/wood edge)
  assert.ok(Math.abs(b.y - expected) < 2.5, `bounced at nose ${b.y.toFixed(1)} ~ ${expected.toFixed(1)}`);
  assert.ok(expected > PA.top + b.r + 2, 'nose line is genuinely inset from the felt edge');
});

test('the cushion nose is flat and clipped short of the pockets', () => {
  const span = CU.list[0];        // top-left span (TL -> TM)
  const nose = span.faces[0];
  assert.ok(Math.abs(nose.y1 - nose.y2) < 1e-6, 'nose runs parallel to the rail');
  assert.ok(nose.ny > 0.9, 'nose normal points straight into the bed');
  // the nose stops well inside the corner pocket, leaving an open mouth
  assert.ok(nose.x1 > PA.left + BASE_BALL_R, 'nose is clipped away from the corner');
});

test('a ball rolling along the rail into a corner is funneled in, not bounced back', () => {
  const pockets = pocketsFor({ movedPockets: {} });
  const nose = CU.list[0].faces[0];
  // start just off the nose near the corner end, rolling toward the corner pocket
  const b = {
    num: 0, x: nose.x1 + 4, y: nose.y1 + BASE_BALL_R + 1,
    vx: -7, vy: 0, r: BASE_BALL_R, size: 1, pocketed: false, roll: 0,
  };
  const sim = [b];
  const turn = freshTurn();
  runToRest(sim, pockets, turn, 600);
  assert.ok(b.pocketed && turn.pocketed.includes(0), 'rail-runner dropped into the corner pocket');
});

test('a ball aimed at a pocket mouth passes the cushion and drops', () => {
  const pockets = pocketsFor({ movedPockets: {} });
  const b = { num: 0, x: PA.left + (PA.right - PA.left) / 2, y: PA.top + 120, vx: 0, vy: -10, r: BASE_BALL_R, size: 1, pocketed: false, roll: 0 };
  const sim = [b];
  const turn = freshTurn();
  runToRest(sim, pockets, turn, 500);
  assert.ok(b.pocketed, 'dropped into the side pocket through the open mouth');
});

test('a near head-on equal-mass hit transfers most speed to the target', () => {
  const cue = { num: 0, x: 200, y: 270, vx: 10, vy: 0, r: BASE_BALL_R, size: 1, pocketed: false, roll: 0 };
  const obj = { num: 3, x: 200 + 2 * BASE_BALL_R - 0.5, y: 270, vx: 0, vy: 0, r: BASE_BALL_R, size: 1, pocketed: false, roll: 0 };
  const sim = [cue, obj];
  step(sim, [], 1, freshTurn());
  assert.ok(obj.vx > cue.vx, 'target leaves faster than the cue after a straight hit');
});
