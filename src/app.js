// app.js — application entry. Owns the single GameState and the render loop.
//
// NOTE (Phase 1): this is the render-only slice. It racks the balls and draws
// the table from state so the table geometry/scaling can be verified in-browser.
// Physics, input, turn flow, cards and online are wired in subsequent phases.

import { createGameState, rackBalls } from './state.js';
import { fitCanvas } from './geometry.js';
import { drawTable } from './render/table.js';
import { drawBall } from './render/ball.js';

let canvas, ctx;
const state = createGameState();

function sizeCanvas() {
  const center = document.getElementById('centerArea');
  const rect = center.getBoundingClientRect();
  const { w, h } = fitCanvas(Math.max(50, rect.width - 4), Math.max(25, rect.height - 4));
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  state.dims = { w: canvas.width, h: canvas.height };
}

function render() {
  if (!ctx) return;
  drawTable(ctx, state);
  for (const b of state.balls) drawBall(ctx, b, state);
}

function boot() {
  canvas = document.getElementById('tableCanvas');
  ctx = canvas.getContext('2d');

  // Phase 1: auto-start so the table is visible. (Setup flow returns in a later phase.)
  const setup = document.getElementById('setupOverlay');
  if (setup) setup.classList.remove('show');

  state.variant = 'eight';
  state.started = true;
  sizeCanvas();
  rackBalls(state);
  render();

  window.addEventListener('resize', () => { sizeCanvas(); render(); });

  // Dev hooks for verifying render-from-state (Move Hole, warp, big ball).
  window.RR = {
    state,
    render,
    moveHole(i, u, v) { state.movedPockets[i] = { u, v }; render(); },
    setSize(num, size) {
      const b = state.balls.find((x) => x.num === num);
      if (b) { b.size = size; render(); }
    },
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
