// cards/effects.js — pure card appliers. apply(state, id, opts) mutates the state
// (activeEffects / balls / movedPockets / warp / pocketState). `opts` carries the
// table picks the card needed (collected by the app from registry.interactions):
//   { ball: num } | { pocket: idx } | { rail } | { pos:{u,v} } | { positions:[..] } | { to:{u,v} }
//
// No DOM, no globals, no randomness leaking outside — so effects are testable and
// safe to run identically on both clients for online play.

const ae = (state) => (state.activeEffects ||= {});
const ballByNum = (state, num) => state.balls.find((b) => b.num === num);
const cueBall = (state) => state.balls.find((b) => b.num === 0);

// Build a confusion disguise for one ball: show a different ball's number and flip
// its stripe/solid look. Prefers a ball of the opposite group.
function buildConfusion(state, targetNum) {
  const t = ballByNum(state, targetNum);
  if (!t) return { numMap: {}, stripeMap: {} };
  const opposite = state.balls.filter((b) => !b.pocketed && b.num !== 0 && b.num !== 8 && b.num !== targetNum && b.stripe !== t.stripe);
  const others = state.balls.filter((b) => !b.pocketed && b.num !== 0 && b.num !== 8 && b.num !== targetNum);
  const pool = opposite.length ? opposite : others;
  const numMap = {}, stripeMap = {};
  if (pool.length) numMap[targetNum] = pool[Math.floor(Math.random() * pool.length)].num;
  stripeMap[targetNum] = !t.stripe;
  return { numMap, stripeMap };
}

const APPLIERS = {
  // ---- ball / cue modifiers ----
  fog_of_war: (s) => { ae(s).fogOfWar = true; },
  heavyweight: (s, o) => { const b = ballByNum(s, o.ball); if (b) b.heavyweight = true; },
  lightweight: (s, o) => { const b = ballByNum(s, o.ball); if (b) b.lightweight = true; },
  confusion: (s, o) => {
    const c = buildConfusion(s, o.ball);
    ae(s).confusion = true; ae(s).confusionMap = c.numMap; ae(s).confusionStripeMap = c.stripeMap;
  },
  cloak: (s, o) => { ae(s).cloaked = o.ball; },
  sticky: (s) => { ae(s).sticky = true; },
  drunk: (s) => { ae(s).drunk = true; },
  shortsighted: (s) => { ae(s).shortsighted = true; },
  roid_rage: (s) => { ae(s).roidRage = true; },
  cool_hands: (s) => { ae(s).coolHands = true; },
  big_ball: (s) => { ae(s).bigBall = true; const c = cueBall(s); if (c) c.size = 2; },
  small_ball: (s) => { ae(s).smallBall = true; const c = cueBall(s); if (c) c.size = 0.5; },
  oil_cue: (s) => { ae(s).oilCue = true; },
  reverse_spin: (s) => { ae(s).reverseSpin = true; },
  mirror: (s) => { ae(s).mirror = true; },
  magnet: (s) => { ae(s).magnet = true; },
  turbo: (s) => { ae(s).turbo = true; },

  // ---- table zones / rails / pockets ----
  bouncer: (s, o) => { ae(s).bouncer = { ...o.pos }; },
  bounce_house: (s, o) => { (ae(s).bounceHouseRail ||= []); clearRail(s, o.rail); s.activeEffects.bounceHouseRail.push(o.rail); },
  dead_rail: (s, o) => { (ae(s).deadRail ||= []); clearRail(s, o.rail); s.activeEffects.deadRail.push(o.rail); },
  bear_trap: (s, o) => { ae(s).bearTrap = { ...o.pos }; },
  portal: (s, o) => { ae(s).portals = (o.positions || []).map((p) => ({ ...p })); },
  ice_patch: (s, o) => { ae(s).icePatch = { ...o.pos }; },
  mud_patch: (s, o) => { ae(s).mudPatch = { ...o.pos }; },
  crosswind: (s) => { ae(s).crosswind = (Math.random() > 0.5 ? 1 : -1) * (0.3 + Math.random() * 0.4); ae(s).crosswindTurns = 2; },
  block_pocket: (s, o) => { pstate(s, o.pocket).blocked = true; pstate(s, o.pocket).blockedTurns = 2; },
  open_pocket: (s, o) => { const p = s.pocketState && s.pocketState[o.pocket]; if (p) { p.blocked = false; delete p.blockedTurns; } },
  pocket_shrink: (s, o) => { pstate(s, o.pocket).shrunk = true; pstate(s, o.pocket).shrunkTurns = 3; },
  move_hole: (s, o) => { (s.movedPockets ||= {})[o.pocket] = { ...o.to }; },
  warp_rail: (s, o) => {
    // Simple warp: nudge the play-area corners in/out around the chosen pocket.
    const k = 0.04;
    s.warp = {
      anchor: o.pocket,
      corners: [
        { u: k, v: k }, { u: 1 - k, v: k }, { u: 1 - k, v: 1 - k }, { u: k, v: 1 - k },
      ],
      turns: 3,
    };
  },
  earthquake: (s) => {
    for (const b of s.balls) {
      if (b.pocketed) continue;
      b.u = Math.max(0.03, Math.min(0.97, b.u + (Math.random() - 0.5) * 0.06));
      b.v = Math.max(0.05, Math.min(0.95, b.v + (Math.random() - 0.5) * 0.10));
    }
  },
};

function clearRail(s, rail) {
  for (const k of ['bounceHouseRail', 'deadRail']) {
    const arr = s.activeEffects[k];
    if (Array.isArray(arr)) { const i = arr.indexOf(rail); if (i !== -1) arr.splice(i, 1); }
  }
}
function pstate(s, idx) {
  (s.pocketState ||= {});
  return (s.pocketState[idx] ||= {});
}

export function applyCard(state, id, opts = {}) {
  const fn = APPLIERS[id];
  if (fn) fn(state, opts);
}

// Ball/cue effects last for exactly one opponent shot; cleared after the shot settles.
export function clearBallEffects(state) {
  const e = state.activeEffects || {};
  for (const k of ['fogOfWar', 'confusion', 'confusionMap', 'confusionStripeMap', 'cloaked',
    'sticky', 'drunk', 'shortsighted', 'roidRage', 'coolHands', 'bigBall', 'smallBall',
    'oilCue', 'reverseSpin', 'mirror', 'magnet', 'turbo']) {
    delete e[k];
  }
  for (const b of state.balls) {
    delete b.heavyweight; delete b.lightweight;
    if (b.num === 0) b.size = 1;
  }
}

// Table effects with turn counters decay across turns; placed objects persist.
export function decayTableEffects(state) {
  const e = state.activeEffects || {};
  if (e.crosswindTurns > 0 && --e.crosswindTurns <= 0) { delete e.crosswind; delete e.crosswindTurns; }
  if (state.warp && state.warp.turns > 0 && --state.warp.turns <= 0) state.warp = null;
  const ps = state.pocketState || {};
  for (const idx of Object.keys(ps)) {
    const p = ps[idx];
    if (p.blockedTurns > 0 && --p.blockedTurns <= 0) { p.blocked = false; delete p.blockedTurns; }
    if (p.shrunkTurns > 0 && --p.shrunkTurns <= 0) { p.shrunk = false; delete p.shrunkTurns; }
  }
}
