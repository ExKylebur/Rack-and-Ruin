import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, rackBalls, serializeSnapshot, applySnapshot } from '../src/state.js';
import { fitCanvas, toPx, unitsFor } from '../src/geometry.js';

const CANON = fitCanvas(1000, 1e9);

test('createGameState has a serializable, sensible default shape', () => {
  const s = createGameState();
  assert.equal(s.version, 0);
  assert.equal(s.started, false);
  assert.equal(s.variant, 'eight');
  assert.deepEqual(s.movedPockets, {});
  assert.equal(s.cardPhasePlayer, null);
  assert.equal(JSON.stringify(s).includes('function'), false);
});

test('8-ball rack: cue + 15, apex=1, centre=8, all inside play area', () => {
  const s = createGameState();
  rackBalls(s);
  assert.equal(s.balls.length, 16);
  assert.equal(s.balls[0].num, 0, 'first ball is the cue');
  assert.equal(s.balls[1].num, 1, 'apex is the 1-ball');
  assert.equal(s.balls[5].num, 8, 'centre of the rack is the 8-ball');
  for (const b of s.balls) {
    assert.ok(b.u >= 0 && b.u <= 1 && b.v >= 0 && b.v <= 1, `ball ${b.num} in bounds`);
  }
});

test('8-ball rack: no two balls overlap', () => {
  const s = createGameState();
  rackBalls(s);
  const r = unitsFor(CANON).ballR;
  const pts = s.balls.map((b) => toPx({ u: b.u, v: b.v }, CANON));
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      assert.ok(d >= 2 * r - 0.5, `balls ${i},${j} should not overlap (d=${d.toFixed(2)})`);
    }
  }
});

test('9-ball rack: 10 balls numbered 1..9 with 1 at the apex', () => {
  const s = createGameState();
  s.variant = 'nine';
  rackBalls(s);
  assert.equal(s.balls.length, 10);
  const nums = s.balls.map((b) => b.num).sort((a, b) => a - b);
  assert.deepEqual(nums, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(s.balls[1].num, 1, 'apex is the 1-ball');
});

test('serializeSnapshot bumps version and drops velocities', () => {
  const s = createGameState();
  rackBalls(s);
  s.balls[0].vx = 12;
  const snap = serializeSnapshot(s);
  assert.equal(snap.version, 1);
  assert.equal(snap.balls[0].vx, undefined, 'velocity not serialized');
  assert.equal(snap.balls.length, 16);
});

test('snapshot round-trips the table, groups, effects and turn onto a peer', () => {
  const host = createGameState();
  host.variant = 'eight';
  rackBalls(host);
  host.players = [{ name: 'A', group: 'solids', hand: ['drunk'], seat: 0 }, { name: 'B', group: 'stripes', hand: [], seat: 1 }];
  host.currentPlayer = 1;
  host.broken = true;
  host.ballInHand = true;
  host.activeEffects = { magnet: true };
  host.movedPockets = { 0: { u: 0.5, v: 0.5 } };
  host.balls[2].pocketed = true;
  host.balls[1].heavyweight = true;

  const snap = serializeSnapshot(host);
  const peer = createGameState();
  peer.players = [{ name: '?', seat: 0 }, { name: '?', seat: 1 }];
  applySnapshot(peer, snap);

  assert.equal(peer.currentPlayer, 1);
  assert.equal(peer.players[0].group, 'solids');
  assert.deepEqual(peer.players[0].hand, ['drunk']);
  assert.equal(peer.ballInHand, true);
  assert.equal(peer.activeEffects.magnet, true);
  assert.deepEqual(peer.movedPockets, { 0: { u: 0.5, v: 0.5 } });
  assert.equal(peer.balls[2].pocketed, true);
  assert.equal(peer.balls[1].heavyweight, true);
  assert.equal(peer.balls.length, host.balls.length);
});
