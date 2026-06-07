// rules/index.js — turn evaluation per variant. evaluateTurn(state, turn) reads the
// settled shot (turn.firstHit, turn.pocketed[], turn.cueScratched, turn.isBreak),
// may commit groups onto state.players, and returns:
//   { foul, keepTurn, gameOver, winner, reason, ballInHand, respot:[nums], message }
//
// Researched against WPA 8-ball/9-ball and standard cutthroat rules.

import { evaluateEight } from './eightball.js';
import { evaluateNine } from './nineball.js';
import { evaluateCutthroat } from './cutthroat.js';

export const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
export const STRIPES = [9, 10, 11, 12, 13, 14, 15];
export const groupNums = (g) => (g === 'solids' ? SOLIDS : g === 'stripes' ? STRIPES : []);
export const groupOf = (n) => (n >= 1 && n <= 7 ? 'solids' : n >= 9 && n <= 15 ? 'stripes' : null);
export const onTable = (state, nums) => state.balls.filter((b) => !b.pocketed && nums.includes(b.num));
export const lowestOnTable = (state) => {
  const ns = state.balls.filter((b) => !b.pocketed && b.num > 0).map((b) => b.num);
  return ns.length ? Math.min(...ns) : null;
};

// Cutthroat fixed sets, one per seat.
export const CUTTHROAT_SETS = [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]];

export function evaluateTurn(state, turn) {
  if (state.variant === 'nine') return evaluateNine(state, turn);
  if (state.variant === 'cutthroat') return evaluateCutthroat(state, turn);
  if (state.variant === 'doubles') return evaluateEight(state, turn, 'doubles');
  return evaluateEight(state, turn, 'eight');
}

// The next seat to play after a passed turn (skips eliminated cutthroat players).
export function nextPlayer(state) {
  const n = state.players.length;
  let i = (state.currentPlayer + 1) % n;
  if (state.variant === 'cutthroat') {
    for (let k = 0; k < n; k++) {
      const set = CUTTHROAT_SETS[i];
      if (onTable(state, set).length > 0) break; // still has balls -> alive
      i = (i + 1) % n;
    }
  }
  return i;
}

// Short label shown next to a player's name describing their commitment.
export function commitmentLabel(state, idx) {
  const p = state.players[idx];
  if (state.variant === 'nine') {
    const low = lowestOnTable(state);
    return low ? `next: ${low}` : '';
  }
  if (state.variant === 'cutthroat') {
    const set = CUTTHROAT_SETS[idx];
    const left = onTable(state, set).length;
    return `${set[0]}–${set[set.length - 1]} (${left} left)`;
  }
  // eight / doubles
  if (!p.group) return 'open';
  const left = onTable(state, groupNums(p.group)).length;
  return `${p.group} (${left} left)`;
}
