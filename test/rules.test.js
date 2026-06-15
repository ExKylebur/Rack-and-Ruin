import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, rackBalls } from '../src/state.js';
import { evaluateTurn, commitmentLabel } from '../src/rules/index.js';

function game(variant, nPlayers) {
  const s = createGameState();
  s.variant = variant;
  rackBalls(s);
  s.players = [];
  for (let i = 0; i < nPlayers; i++) s.players.push({ name: `P${i + 1}`, group: null, hand: [], seat: i });
  s.currentPlayer = 0;
  s.broken = true;
  return s;
}
const pocket = (s, ...nums) => nums.forEach((n) => { const b = s.balls.find((x) => x.num === n); if (b) b.pocketed = true; });
const turn = (o) => ({ firstHit: null, pocketed: [], cueScratched: false, isBreak: false, pocketDrops: {}, ...o });

// ---- 8-ball ----
test('8-ball: first legal pocket assigns groups and keeps the turn', () => {
  const s = game('eight', 2);
  pocket(s, 3); // a solid
  const res = evaluateTurn(s, turn({ firstHit: 1, pocketed: [3] }));
  assert.equal(s.players[0].group, 'solids');
  assert.equal(s.players[1].group, 'stripes');
  assert.equal(res.keepTurn, true);
  assert.equal(res.gameOver, false);
});

test('8-ball: once committed, hitting the other group first is a foul (ball in hand)', () => {
  const s = game('eight', 2);
  s.players[0].group = 'solids'; s.players[1].group = 'stripes';
  const res = evaluateTurn(s, turn({ firstHit: 10, pocketed: [] }));
  assert.equal(res.foul, true);
  assert.equal(res.ballInHand, true);
  assert.equal(res.keepTurn, false);
});

test('8-ball: sinking the 8 before clearing your group loses', () => {
  const s = game('eight', 2);
  s.players[0].group = 'solids'; s.players[1].group = 'stripes';
  pocket(s, 8); // 1-7 still on the table
  const res = evaluateTurn(s, turn({ firstHit: 8, pocketed: [8] }));
  assert.equal(res.gameOver, true);
  assert.equal(res.winner, 1);
});

test('8-ball: clearing your group then sinking the 8 in the CALLED pocket wins', () => {
  const s = game('eight', 2);
  s.players[0].group = 'solids'; s.players[1].group = 'stripes';
  s.calledPocket = 2; // top-right
  pocket(s, 1, 2, 3, 4, 5, 6, 7); // solids cleared (before this shot)
  pocket(s, 8);
  const res = evaluateTurn(s, turn({ firstHit: 8, pocketed: [8], pocketDrops: { 8: 2 } }));
  assert.equal(res.gameOver, true);
  assert.equal(res.winner, 0);
});

test('8-ball: sinking the 8 in the WRONG pocket loses', () => {
  const s = game('eight', 2);
  s.players[0].group = 'solids'; s.players[1].group = 'stripes';
  s.calledPocket = 2;            // called top-right
  pocket(s, 1, 2, 3, 4, 5, 6, 7);
  pocket(s, 8);
  const res = evaluateTurn(s, turn({ firstHit: 8, pocketed: [8], pocketDrops: { 8: 5 } })); // fell in bottom-right
  assert.equal(res.gameOver, true);
  assert.equal(res.winner, 1, 'opponent wins on a wrong-pocket 8');
});

test('8-ball: sinking the 8 with no pocket called loses', () => {
  const s = game('eight', 2);
  s.players[0].group = 'solids'; s.players[1].group = 'stripes';
  s.calledPocket = null;
  pocket(s, 1, 2, 3, 4, 5, 6, 7);
  pocket(s, 8);
  const res = evaluateTurn(s, turn({ firstHit: 8, pocketed: [8], pocketDrops: { 8: 0 } }));
  assert.equal(res.gameOver, true);
  assert.equal(res.winner, 1, 'must call before sinking the 8');
});

// ---- 9-ball ----
test('9-ball: not hitting the lowest ball first is a foul', () => {
  const s = game('nine', 2);
  const res = evaluateTurn(s, turn({ firstHit: 3, pocketed: [] }));
  assert.equal(res.foul, true);
  assert.equal(res.ballInHand, true);
});

test('9-ball: pocketing the 9 off the lowest ball wins', () => {
  const s = game('nine', 2);
  pocket(s, 9);
  const res = evaluateTurn(s, turn({ firstHit: 1, pocketed: [9] }));
  assert.equal(res.gameOver, true);
  assert.equal(res.winner, 0);
});

test('9-ball: an illegally pocketed 9 is re-spotted (no win)', () => {
  const s = game('nine', 2);
  pocket(s, 9);
  const res = evaluateTurn(s, turn({ firstHit: 3, pocketed: [9] })); // wrong first ball
  assert.equal(res.gameOver, false);
  assert.deepEqual(res.respot, [9]);
  assert.equal(res.ballInHand, true);
});

// ---- cutthroat ----
test('cutthroat: hitting your own ball first is a foul', () => {
  const s = game('cutthroat', 3); // P1 owns 1-5
  const res = evaluateTurn(s, turn({ firstHit: 3, pocketed: [] }));
  assert.equal(res.foul, true);
});

test('cutthroat: last player with balls on the table wins', () => {
  const s = game('cutthroat', 3);
  pocket(s, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15); // P2 and P3 wiped out
  const res = evaluateTurn(s, turn({ firstHit: 6, pocketed: [6] }));
  assert.equal(res.gameOver, true);
  assert.equal(res.winner, 0);
});

test('commitmentLabel reflects each variant', () => {
  const e = game('eight', 2); e.players[0].group = 'solids';
  assert.match(commitmentLabel(e, 0), /solids/);
  const n = game('nine', 2);
  assert.match(commitmentLabel(n, 0), /next: 1/);
  const c = game('cutthroat', 3);
  assert.match(commitmentLabel(c, 1), /6–10/);
});
