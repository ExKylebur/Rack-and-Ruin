// rules/cutthroat.js — 3 players own fixed sets (1-5 / 6-10 / 11-15). You must hit
// an OPPONENT's ball first; last player with balls on the table wins; a foul
// re-spots one ball for each opponent (eliminated players can rejoin).

import { CUTTHROAT_SETS, onTable } from './index.js';

export function evaluateCutthroat(state, turn) {
  const cur = state.currentPlayer;
  const p = state.players[cur];
  const mine = CUTTHROAT_SETS[cur];
  const scratch = turn.cueScratched;
  const potted = turn.pocketed.filter((n) => n !== 0);

  let foul = false; let why = '';
  if (scratch) { foul = true; why = 'scratch'; }
  else if (turn.firstHit == null) { foul = true; why = 'no ball hit'; }
  else if (mine.includes(turn.firstHit)) { foul = true; why = 'hit your own ball first'; }

  // alive = seats that still have a ball on the table (post-shot)
  const alive = state.players.map((_, i) => i).filter((i) => onTable(state, CUTTHROAT_SETS[i]).length > 0);
  if (!foul && alive.length === 1) {
    return { foul: false, keepTurn: false, gameOver: true, winner: alive[0], reason: `${state.players[alive[0]].name} wins Cutthroat!`, ballInHand: false, respot: [], message: `${state.players[alive[0]].name} wins!` };
  }

  // foul: re-spot one downed ball for each opponent (rejoin mechanic)
  const respot = [];
  if (foul) {
    state.players.forEach((_, i) => {
      if (i === cur) return;
      const down = CUTTHROAT_SETS[i].find((n) => { const b = state.balls.find((x) => x.num === n); return b && b.pocketed; });
      if (down) respot.push(down);
    });
  }

  const keepTurn = !foul && potted.length > 0;
  return {
    foul, keepTurn, gameOver: false, winner: null, reason: null, ballInHand: foul, respot,
    message: foul ? `Foul (${why}) — ball in hand to the next player`
      : keepTurn ? `${p.name} pots ${potted.join(', ')} — continue`
        : `${p.name}'s turn ends`,
  };
}
