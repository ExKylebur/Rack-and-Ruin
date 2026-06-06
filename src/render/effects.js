// render/effects.js — overlays for active card effects, drawn from state each
// frame. Zone positions are relative {u,v} -> px via toPx; radii use the same
// ball-radius factors as physics so visuals match the simulation.

import { playArea, pocketLayout, toPx, unitsFor } from '../geometry.js';

const F = { ice: 5.3, mud: 4.8, bouncer: 0.95, trap: 1.2, portal: 1.4 };

export function drawEffects(ctx, state) {
  const e = state.activeEffects || {};
  const r = unitsFor(state.dims).ballR;
  const at = (rel) => toPx(rel, state.dims);

  if (e.icePatch) zone(ctx, at(e.icePatch), r * F.ice, 'rgba(180,220,255,0.22)', 'rgba(180,220,255,0.5)', '🧊');
  if (e.mudPatch) zone(ctx, at(e.mudPatch), r * F.mud, 'rgba(100,60,20,0.36)', 'rgba(140,90,40,0.5)', '💩');

  if (e.bouncer) {
    const p = at(e.bouncer); const rad = r * F.bouncer;
    const g = ctx.createRadialGradient(p.x - 2, p.y - 2, 1, p.x, p.y, rad);
    g.addColorStop(0, '#ff6b5b'); g.addColorStop(1, '#c0392b');
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,150,130,0.7)'; ctx.lineWidth = 2; ctx.stroke();
  }
  if (e.bearTrap) {
    const p = at(e.bearTrap);
    ctx.save(); ctx.globalAlpha = 0.5; ctx.font = `${r * 1.8}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🪤', p.x, p.y); ctx.restore();
  }
  if (e.portals && e.portals.length) {
    const t = performance.now() / 500;
    const cols = ['rgba(120,90,255,', 'rgba(255,90,120,'];
    e.portals.forEach((pp, i) => {
      const p = at(pp); const rad = r * F.portal + Math.sin(t + i * Math.PI) * 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.strokeStyle = cols[i % 2] + '0.8)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = `${r * 1.5}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🌀', p.x, p.y);
    });
  }
  if (e.crosswind) {
    const pa = playArea(state.dims); const cx = pa.cx, cy = pa.top * 0.5;
    const dir = e.crosswind > 0 ? 1 : -1; const len = 24 + Math.abs(e.crosswind) * 18;
    ctx.strokeStyle = 'rgba(180,220,255,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - dir * len, cy); ctx.lineTo(cx + dir * len, cy);
    ctx.moveTo(cx + dir * len, cy); ctx.lineTo(cx + dir * (len - 8), cy - 6);
    ctx.moveTo(cx + dir * len, cy); ctx.lineTo(cx + dir * (len - 8), cy + 6); ctx.stroke();
  }

  // pocket states
  const ps = state.pocketState || {};
  const pk = pocketLayout(state.dims, state.movedPockets);
  pk.forEach((p) => {
    const st = ps[p.index];
    if (!st) return;
    if (st.blocked) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,40,40,0.5)'; ctx.fill();
    }
    if (st.shrunk) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.65, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,90,90,0.6)'; ctx.lineWidth = 2; ctx.stroke();
    }
  });
}

function zone(ctx, p, rad, fill, stroke, emoji) {
  ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji, p.x, p.y);
}

// Highlights shown while the player is making a card target pick.
export function drawPickHighlights(ctx, state, pick) {
  if (!pick) return;
  const r = unitsFor(state.dims).ballR;
  const t = performance.now() / 380;
  ctx.save();
  ctx.fillStyle = 'rgba(255,215,0,0.06)'; ctx.fillRect(0, 0, state.dims.w, state.dims.h);
  if (pick.type === 'ball') {
    for (const b of state.balls) {
      if (b.pocketed || b.num === 0) continue;
      const p = toPx({ u: b.u, v: b.v }, state.dims);
      ctx.beginPath(); ctx.arc(p.x, p.y, r * (b.size || 1) + 4 + Math.sin(t) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,215,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  } else if (pick.type === 'pocket') {
    for (const p of pocketLayout(state.dims, state.movedPockets)) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4 + Math.sin(t) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,215,0,0.7)'; ctx.lineWidth = 2; ctx.stroke();
    }
  } else if (pick.type === 'rail') {
    const pa = playArea(state.dims); const c = unitsFor(state.dims).cushion;
    ctx.fillStyle = 'rgba(255,215,0,0.18)';
    ctx.fillRect(pa.left, 0, pa.w, c); ctx.fillRect(pa.left, state.dims.h - c, pa.w, c);
    ctx.fillRect(0, pa.top, c, pa.h); ctx.fillRect(state.dims.w - c, pa.top, c, pa.h);
  }
  ctx.restore();
}
