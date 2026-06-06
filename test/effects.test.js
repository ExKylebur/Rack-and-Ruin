import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, rackBalls } from '../src/state.js';
import { applyCard, clearBallEffects, decayTableEffects } from '../src/cards/effects.js';
import { CARD_POOL } from '../src/cards/registry.js';

function fresh() { const s = createGameState(); rackBalls(s); return s; }

test('every card id has an applier that does not throw', () => {
  for (const c of CARD_POOL) {
    const s = fresh();
    // supply plausible targets for the interactions the card declares
    const opts = {};
    (c.interactions || []).forEach((it) => {
      if (it.type === 'ball') opts.ball = 3;
      if (it.type === 'pocket') opts.pocket = 0;
      if (it.type === 'rail') opts.rail = 'top';
      if (it.type === 'place') { opts.pos = { u: 0.5, v: 0.5 }; (opts.positions ||= []).push({ u: 0.3, v: 0.3 }); }
    });
    if (c.id === 'move_hole') opts.to = { u: 0.5, v: 0.5 };
    if (c.id === 'portal') opts.positions = [{ u: 0.3, v: 0.3 }, { u: 0.7, v: 0.7 }];
    assert.doesNotThrow(() => applyCard(s, c.id, opts), `applier ${c.id}`);
  }
});

test('big/small ball set the cue size; clearBallEffects resets it', () => {
  const s = fresh();
  applyCard(s, 'big_ball', {});
  assert.equal(s.balls.find((b) => b.num === 0).size, 2);
  clearBallEffects(s);
  assert.equal(s.balls.find((b) => b.num === 0).size, 1);
  assert.equal(s.activeEffects.bigBall, undefined);
});

test('heavyweight tags the chosen ball and clears after the shot', () => {
  const s = fresh();
  applyCard(s, 'heavyweight', { ball: 5 });
  assert.equal(s.balls.find((b) => b.num === 5).heavyweight, true);
  clearBallEffects(s);
  assert.equal(s.balls.find((b) => b.num === 5).heavyweight, undefined);
});

test('move_hole writes a relative override; block_pocket sets pocket state', () => {
  const s = fresh();
  applyCard(s, 'move_hole', { pocket: 2, to: { u: 0.5, v: 0.5 } });
  assert.deepEqual(s.movedPockets[2], { u: 0.5, v: 0.5 });
  applyCard(s, 'block_pocket', { pocket: 1 });
  assert.equal(s.pocketState[1].blocked, true);
});

test('open_pocket clears a block; crosswind decays over turns', () => {
  const s = fresh();
  applyCard(s, 'block_pocket', { pocket: 1 });
  applyCard(s, 'open_pocket', { pocket: 1 });
  assert.equal(s.pocketState[1].blocked, false);

  applyCard(s, 'crosswind', {});
  assert.ok(s.activeEffects.crosswind);
  decayTableEffects(s); // 2 -> 1
  decayTableEffects(s); // 1 -> 0, removed
  assert.equal(s.activeEffects.crosswind, undefined);
});
