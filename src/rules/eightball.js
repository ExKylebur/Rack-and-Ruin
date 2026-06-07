// rules/eightball.js — 8-ball, and doubles (team groups). Handles open-table group
// assignment, group-first fouls, the 8-ball win/loss, ball-in-hand on fouls.

import { SOLIDS, STRIPES, groupNums, groupOf, onTable } from './index.js';

// team layout: 2-player 8-ball => each seat its own team; doubles => seats 0&2 vs 1&3
function teams(state, variant) {
  if (variant === 'doubles') {
    return { teamOf: (i) => i % 2, members: (t) => state.players.map((_, i) => i).filter((i) => i % 2 === t) };
  }
  return { teamOf: (i) => i, members: (t) => [t] };
}

export function evaluateEight(state, turn, variant) {
  const T = teams(state, variant);
  const cur = state.currentPlayer;
  const curTeam = T.teamOf(cur);
  const oppTeam = 1 - curTeam;
  const p = state.players[cur];
  const teamName = variant === 'doubles' ? `Team ${curTeam === 0 ? '1&3' : '2&4'}` : p.name;
  const oppName = variant === 'doubles' ? `Team ${oppTeam === 0 ? '1&3' : '2&4'}` : state.players[T.members(oppTeam)[0]].name;

  const scratch = turn.cueScratched;
  const potted = turn.pocketed.filter((n) => n !== 0);
  const eightPotted = turn.pocketed.includes(8);
  const preGroup = p.group;          // group at the START of the shot (null = open)
  const open = !preGroup;

  // ---- foul detection (based on the pre-shot group) ----
  let foul = false; let why = '';
  if (scratch) { foul = true; why = 'scratch'; }
  else if (turn.firstHit == null) { foul = true; why = 'no ball hit'; }
  else if (!open) {
    const grp = groupNums(preGroup);
    const pottedOwnThis = potted.filter((n) => grp.includes(n)).length;
    const clearedBeforeShot = onTable(state, grp).length + pottedOwnThis === 0; // group empty pre-shot
    if (clearedBeforeShot) { if (turn.firstHit !== 8) { foul = true; why = 'must hit the 8'; } }
    else if (!grp.includes(turn.firstHit)) { foul = true; why = 'wrong ball first'; }
  } else if (turn.firstHit === 8) { foul = true; why = 'cannot hit the 8 on an open table'; }

  // ---- group assignment (open table, legal, a ball of exactly one group made) ----
  if (open && !foul && potted.length && turn.firstHit !== 8) {
    const madeSolid = potted.some((n) => SOLIDS.includes(n));
    const madeStripe = potted.some((n) => STRIPES.includes(n));
    if (madeSolid !== madeStripe) {
      const g = madeSolid ? 'solids' : 'stripes';
      T.members(curTeam).forEach((i) => { state.players[i].group = g; });
      T.members(oppTeam).forEach((i) => { state.players[i].group = g === 'solids' ? 'stripes' : 'solids'; });
    }
  }
  const group = p.group; // possibly just assigned

  // ---- 8-ball decides the game ----
  if (eightPotted) {
    const ownLeft = group ? onTable(state, groupNums(group)).length : 99;
    const legalWin = !foul && group && ownLeft === 0;
    if (legalWin) return done(true, `${teamName} sinks the 8 — wins!`);
    return done(false, `${teamName} pocketed the 8 early — ${oppName} wins!`);
  }

  // ---- continuation ----
  const ownPotted = group ? potted.filter((n) => groupNums(group).includes(n)) : potted;
  const keepTurn = !foul && ownPotted.length > 0;

  return {
    foul, keepTurn, gameOver: false, winner: null, reason: null,
    ballInHand: foul, respot: [],
    message: foul ? `Foul (${why}) — ${oppName} has ball in hand`
      : keepTurn ? `${teamName} pots ${ownPotted.join(', ')} — continue`
        : `Turn passes to ${oppName}`,
  };

  function done(curWins, reason) {
    const winnerSeat = curWins ? cur : T.members(oppTeam)[0];
    return { foul, keepTurn: false, gameOver: true, winner: winnerSeat, reason, ballInHand: false, respot: [], message: reason };
  }
}
