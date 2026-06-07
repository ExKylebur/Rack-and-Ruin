// rules/nineball.js — always hit the lowest ball first; pocket the 9 (legally,
// combos allowed) to win; fouls give ball-in-hand; an illegally pocketed 9 re-spots.

export function evaluateNine(state, turn) {
  const cur = state.currentPlayer;
  const p = state.players[cur];
  const opp = state.players[(cur + 1) % 2];
  const scratch = turn.cueScratched;
  const potted = turn.pocketed.filter((n) => n !== 0);
  const ninePotted = turn.pocketed.includes(9);

  // lowest ball that was on the table at the START of the shot
  const preNums = state.balls.filter((b) => !b.pocketed && b.num > 0).map((b) => b.num).concat(potted);
  const preLowest = preNums.length ? Math.min(...preNums) : null;

  let foul = false; let why = '';
  if (scratch) { foul = true; why = 'scratch'; }
  else if (turn.firstHit == null) { foul = true; why = 'no ball hit'; }
  else if (preLowest != null && turn.firstHit !== preLowest) { foul = true; why = `must hit the ${preLowest} first`; }

  if (ninePotted) {
    if (!foul) return { foul: false, keepTurn: false, gameOver: true, winner: cur, reason: `${p.name} pockets the 9 — wins!`, ballInHand: false, respot: [], message: `${p.name} wins!` };
    return { foul: true, keepTurn: false, gameOver: false, winner: null, reason: null, ballInHand: true, respot: [9], message: `Foul (${why}) — the 9 is re-spotted, ${opp.name} has ball in hand` };
  }

  const keepTurn = !foul && potted.length > 0;
  return {
    foul, keepTurn, gameOver: false, winner: null, reason: null, ballInHand: foul, respot: [],
    message: foul ? `Foul (${why}) — ${opp.name} has ball in hand`
      : keepTurn ? `${p.name} pots ${potted.join(', ')} — continue`
        : `Turn passes to ${opp.name}`,
  };
}
