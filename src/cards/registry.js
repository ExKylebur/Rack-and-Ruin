// cards/registry.js — the card catalogue (metadata only). IDs are STABLE: online
// snapshots serialize hands by id, so never rename one.
//
// `interactions` lists the table picks a card needs before it resolves; the app
// collects them, then calls the matching effect in effects.js with the targets.
//   pick types: 'ball' | 'pocket' | 'rail' | 'place'

export const CARD_POOL = [
  // ---- Ball-effect cards ----
  { id: 'fog_of_war',   name: 'Fog of War',   icon: '🌫️', type: 'ball',  desc: 'Opponent only sees the aim line to the first object ball.' },
  { id: 'heavyweight',  name: 'Heavyweight',  icon: '🏋️', type: 'ball',  desc: 'Pick a ball — it behaves much heavier.', interactions: [{ type: 'ball', prompt: 'Click a ball to make it heavy.' }] },
  { id: 'lightweight',  name: 'Lightweight',  icon: '🪶',  type: 'ball',  desc: 'Pick a ball — it behaves much lighter.', interactions: [{ type: 'ball', prompt: 'Click a ball to make it light.' }] },
  { id: 'confusion',    name: 'Confusion',    icon: '🔀', type: 'ball',  desc: 'Pick a ball — it is disguised as another.', interactions: [{ type: 'ball', prompt: 'Click a ball to disguise.' }] },
  { id: 'cloak',        name: 'Cloak',        icon: '👻', type: 'ball',  desc: 'Pick a ball — invisible to your opponent.', interactions: [{ type: 'ball', prompt: 'Click a ball to cloak.' }] },
  { id: 'sticky',       name: 'Sticky',       icon: '🍯', type: 'ball',  desc: 'Cue ball drags the first ball it contacts.' },
  { id: 'drunk',        name: 'Drunk',        icon: '🍺', type: 'ball',  desc: 'Aim and shot direction wobble all turn.' },
  { id: 'shortsighted', name: 'Shortsighted', icon: '🔭', type: 'ball',  desc: 'No aim guide line or ghost ball shown.' },
  { id: 'roid_rage',    name: 'Roid Rage',    icon: '💢', type: 'ball',  desc: 'Power can never drop below 75% this turn.' },
  { id: 'cool_hands',   name: 'Cool Hands',   icon: '🧊', type: 'ball',  desc: 'Power is capped at 25% this turn.' },
  { id: 'big_ball',     name: 'Big Ball',     icon: '🔵', type: 'ball',  desc: 'Cue ball is 2× size — wider hits, more force.' },
  { id: 'small_ball',   name: 'Small Ball',   icon: '⚬',  type: 'ball',  desc: 'Cue ball is half size — weaker, easy to miss.' },
  { id: 'oil_cue',      name: 'Oil Cue',      icon: '💧', type: 'ball',  desc: 'Cue ball slides further — little friction.' },
  { id: 'reverse_spin', name: 'Reverse Spin', icon: '↩️', type: 'ball',  desc: 'Cue ball English is flipped on contact.' },
  { id: 'magnet',       name: 'Magnet',       icon: '🧲', type: 'ball',  desc: 'Moving balls are pulled toward the nearest pocket.' },
  { id: 'turbo',        name: 'Turbo',        icon: '⚡', type: 'ball',  desc: 'Shot speed ×1.6 — hard to control.' },
  // ---- Table-effect cards ----
  { id: 'bouncer',      name: 'Bouncer',      icon: '🔴', type: 'table', desc: 'Place a rubber bumper anywhere.', interactions: [{ type: 'place', prompt: 'Click to place the bumper.' }] },
  { id: 'bounce_house', name: 'Bounce House', icon: '🎪', type: 'table', desc: 'Pick a rail — 2.2× bounce.', interactions: [{ type: 'rail', prompt: 'Click a rail.' }] },
  { id: 'dead_rail',    name: 'Dead Rail',    icon: '🪵', type: 'table', desc: 'Pick a rail — balls barely rebound.', interactions: [{ type: 'rail', prompt: 'Click a rail.' }] },
  { id: 'bear_trap',    name: 'Bear Trap',    icon: '🪤', type: 'table', desc: 'Place a hidden trap — stops any ball that touches it.', interactions: [{ type: 'place', prompt: 'Click to place the trap.' }] },
  { id: 'portal',       name: 'Portal',       icon: '🌀', type: 'table', desc: 'Place 2 portals — balls entering one exit the other.', interactions: [{ type: 'place', prompt: 'Place portal 1 of 2.' }, { type: 'place', prompt: 'Place portal 2 of 2.' }] },
  { id: 'ice_patch',    name: 'Ice Patch',    icon: '🧊', type: 'table', desc: 'Place a frictionless zone.', interactions: [{ type: 'place', prompt: 'Click to place the ice patch.' }] },
  { id: 'block_pocket', name: 'Block Pocket', icon: '🚫', type: 'table', desc: 'Seal one pocket — balls bounce off it.', interactions: [{ type: 'pocket', prompt: 'Click a pocket to block.' }] },
  { id: 'open_pocket',  name: 'Open Pocket',  icon: '✅', type: 'table', desc: 'Re-open a blocked pocket.', interactions: [{ type: 'pocket', prompt: 'Click a blocked pocket.' }] },
  { id: 'move_hole',    name: 'Move Hole',    icon: '📍', type: 'table', desc: 'Drag any pocket to a new spot.', interactions: [{ type: 'pocket', prompt: 'Click a pocket to move.' }, { type: 'place', prompt: 'Click its new position.' }] },
  { id: 'warp_rail',    name: 'Warp Rail',    icon: '🌊', type: 'table', desc: 'Drag a pocket — its rails bend to follow it (not onto a ball).', interactions: [{ type: 'pocket', prompt: 'Click a pocket to grab.' }, { type: 'place', prompt: 'Drag it anywhere — the rail follows.' }] },
  { id: 'mud_patch',    name: 'Mud Patch',    icon: '💩', type: 'table', desc: 'Place a sticky zone — balls slow sharply.', interactions: [{ type: 'place', prompt: 'Click to place the mud patch.' }] },
  { id: 'crosswind',    name: 'Crosswind',    icon: '💨', type: 'table', desc: 'A permanent sideways drift nudges all balls.' },
  { id: 'pocket_shrink',name: 'Pocket Shrink',icon: '🔩', type: 'table', desc: 'Pick a pocket — shrinks to 65%.', interactions: [{ type: 'pocket', prompt: 'Click a pocket to shrink.' }] },
  { id: 'earthquake',   name: 'Earthquake',   icon: '🌋', type: 'table', desc: 'All stationary balls are jolted to new spots.' },
];

export const CARD_BY_ID = Object.fromEntries(CARD_POOL.map((c) => [c.id, c]));
export const cardById = (id) => CARD_BY_ID[id] || null;
