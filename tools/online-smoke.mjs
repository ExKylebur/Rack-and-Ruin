// tools/online-smoke.mjs — second client for the live 2-client online test.
// Speaks the exact same HTTP protocol as src/online/client.js against a running
// server, while a real browser drives the host seat. Run:
//   node tools/online-smoke.mjs <ROOMCODE> [serverUrl]
// It joins the room, then walks the handshake below, printing PASS/FAIL lines:
//   1. waits for the host's rack snapshot (version >= 1, 16 balls, started)
//   2. waits for the host's foul shot (turn passes to seat 1, ball in hand,
//      and the host's sabotage card visible in activeEffects)
//   3. takes its own "turn": places the cue, hands the turn back, pushes the
//      snapshot for the host browser to apply.

const code = (process.argv[2] || '').toUpperCase();
const api = (process.argv[3] || 'http://localhost:8000').replace(/\/$/, '');
if (!code) { console.error('usage: node tools/online-smoke.mjs <ROOMCODE>'); process.exit(2); }

const out = (tag, msg, extra) => console.log(`${tag} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
let failures = 0;
const check = (cond, msg, extra) => { if (cond) out('PASS', msg); else { failures++; out('FAIL', msg, extra); } };

async function post(path, body) {
  const res = await fetch(api + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

// Long-poll until the room state satisfies `pred` (or time out).
async function waitFor(token, since, pred, label, ms = 90000) {
  const t0 = Date.now();
  let cur = since;
  while (Date.now() - t0 < ms) {
    const res = await fetch(`${api}/api/state?code=${code}&token=${token}&since=${cur}&timeout=20000`);
    const data = await res.json();
    if (data.state && data.state.version > cur) {
      cur = data.state.version;
      if (pred(data.state)) return data.state;
      out('....', `${label}: got v${cur}, predicate not yet true; keep waiting`);
    }
  }
  failures++;
  out('FAIL', `${label}: timed out after ${ms}ms (last seen v${cur})`);
  return null;
}

const d = await post('/api/join-room', { code, name: 'Smoke Joiner' });
check(!!d.token && d.seat === 1, `joined room ${code} as seat 1`, d);
if (!d.token) { process.exitCode = 1; } else { await run(d.token); }
out('DONE', `online smoke finished with ${failures} failure(s)`);
process.exitCode = failures ? 1 : 0;

async function run(token) {

  // --- 1. the rack -------------------------------------------------------
  const rack = await waitFor(token, 0, (s) => s.started, 'rack snapshot');
  if (rack) {
    check(rack.balls && rack.balls.length === 16, `rack has 16 balls (got ${rack.balls && rack.balls.length})`);
    check(rack.currentPlayer === 0, 'host (seat 0) to break');
    check(Array.isArray(rack.players) && rack.players.length === 2, 'two players in snapshot');
  }

  // --- 2. host fouls + plays Crosswind -----------------------------------
  const afterFoul = await waitFor(token, rack ? rack.version : 0,
    (s) => s.currentPlayer === 1, 'host foul passes the turn');
  if (afterFoul) {
    check(afterFoul.ballInHand === true, 'joiner has ball in hand after the scratch/foul');
    check(afterFoul.activeEffects && afterFoul.activeEffects.crosswind !== undefined,
      'host sabotage (crosswind) crossed over', afterFoul.activeEffects);
  }

  // --- 3. joiner's turn: place cue, hand turn back ------------------------
  if (afterFoul) {
    const mine = JSON.parse(JSON.stringify(afterFoul));
    const cue = mine.balls.find((b) => b.num === 0);
    cue.u = 0.31; cue.v = 0.42; cue.pocketed = false;
    mine.ballInHand = false;
    mine.currentPlayer = 0;
    mine.version = afterFoul.version + 1;
    const r = await post('/api/update-state', { code, token, state: mine });
    check(r && r.ok !== false && !r.error, `pushed joiner snapshot v${mine.version}`, r);
  }
}
