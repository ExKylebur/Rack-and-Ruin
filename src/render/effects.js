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

  // pocket states — reshape the actual opening, not just tint it
  const ps = state.pocketState || {};
  const pk = pocketLayout(state.dims, state.movedPockets);
  const pa = playArea(state.dims);
  pk.forEach((p) => {
    const st = ps[p.index];
    if (!st) return;
    // inward unit vector: from the pocket toward the table centre
    let ix = pa.cx - p.x, iy = pa.cy - p.y;
    const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il;

    if (st.shrunk) {
      // Fill the outer bore with the dark rim colour so the visible opening is
      // plainly smaller (matches the tightened capture radius in physics).
      const inner = p.r * 0.6;
      const g = ctx.createRadialGradient(p.x, p.y, inner, p.x, p.y, p.r + 4);
      g.addColorStop(0, 'rgba(28,13,5,0)');
      g.addColorStop(0.3, 'rgba(30,14,6,0.97)');
      g.addColorStop(1, 'rgba(44,22,10,0.98)');
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, inner, 0, Math.PI * 2);
      ctx.fillStyle = '#040404'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,140,140,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    if (st.blocked) {
      // A physical barrier laid across the mouth (perpendicular to the inward
      // direction), nudged slightly onto the bed so it reads as a wall.
      const tx = -iy, ty = ix;            // tangent across the opening
      const half = p.r * 0.95;
      const bx = p.x + ix * p.r * 0.25, by = p.y + iy * p.r * 0.25;
      const a = { x: bx - tx * half, y: by - ty * half };
      const b = { x: bx + tx * half, y: by + ty * half };
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(18,9,3,0.95)'; ctx.lineWidth = p.r * 0.62;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(214,42,42,0.96)'; ctx.lineWidth = p.r * 0.42;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // hazard ticks across the bar
      ctx.strokeStyle = 'rgba(255,222,120,0.9)'; ctx.lineWidth = 2;
      for (let s = -0.6; s <= 0.61; s += 0.4) {
        const cx = bx + tx * half * s, cy = by + ty * half * s;
        ctx.beginPath();
        ctx.moveTo(cx - ix * p.r * 0.22, cy - iy * p.r * 0.22);
        ctx.lineTo(cx + ix * p.r * 0.22, cy + iy * p.r * 0.22);
        ctx.stroke();
      }
      ctx.restore();
    }
  });
}

// Fog of War: black out the whole table except a narrow sight beam running from
// the cue ball along the current aim line to the first object ball it would reach,
// plus a soft pool of light around the cue ball and the target. Built on an
// offscreen layer so overlapping reveal shapes simply punch one clean hole.
export function drawFog(ctx, state, aimAngle) {
  const cue = state.balls.find((b) => b.num === 0 && !b.pocketed);
  if (!cue) return;
  const { w, h } = state.dims;
  const r = unitsFor(state.dims).ballR;
  const pa = playArea(state.dims);
  const c = toPx({ u: cue.u, v: cue.v }, state.dims);

  // March along the aim line to the first object ball (or the rail).
  const dx = Math.cos(aimAngle), dy = Math.sin(aimAngle);
  const stepLen = Math.max(3, r * 0.5);
  const maxLen = Math.hypot(w, h);
  let x = c.x, y = c.y, len = 0, end = { x: c.x, y: c.y };
  while (len < maxLen) {
    x += dx * stepLen; y += dy * stepLen; len += stepLen;
    end = { x, y };
    if (x < pa.left || x > pa.right || y < pa.top || y > pa.bottom) break;
    let hit = false;
    for (const b of state.balls) {
      if (b.pocketed || b.num === 0) continue;
      const bp = toPx({ u: b.u, v: b.v }, state.dims);
      const br = r + r * (b.size || 1);
      if ((bp.x - x) ** 2 + (bp.y - y) ** 2 < br * br) { hit = true; break; }
    }
    if (hit) break;
  }

  const fog = document.createElement('canvas');
  fog.width = Math.max(1, Math.round(w));
  fog.height = Math.max(1, Math.round(h));
  const fc = fog.getContext('2d');
  fc.fillStyle = 'rgba(2,4,8,0.95)';
  fc.fillRect(0, 0, w, h);

  fc.globalCompositeOperation = 'destination-out';
  const glow = (px, py, rad) => {
    const g = fc.createRadialGradient(px, py, rad * 0.35, px, py, rad);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fc.fillStyle = g;
    fc.beginPath(); fc.arc(px, py, rad, 0, Math.PI * 2); fc.fill();
  };
  glow(c.x, c.y, r * 3.4);     // light around the cue ball
  glow(end.x, end.y, r * 3.2); // light on the target
  // tapered beam down the aim line
  const nx = -dy, ny = dx, w0 = r * 1.6, w1 = r * 2.6;
  fc.fillStyle = 'rgba(0,0,0,1)';
  fc.beginPath();
  fc.moveTo(c.x + nx * w0, c.y + ny * w0);
  fc.lineTo(end.x + nx * w1, end.y + ny * w1);
  fc.lineTo(end.x - nx * w1, end.y - ny * w1);
  fc.lineTo(c.x - nx * w0, c.y - ny * w0);
  fc.closePath(); fc.fill();
  fc.globalCompositeOperation = 'source-over';

  ctx.drawImage(fog, 0, 0);
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

// Live preview for a 'place' pick: a ghost of the effect follows the cursor so
// the player sees exactly what they're about to drop before clicking. `opts`
// carries the in-progress card options (e.g. already-placed portal positions).
export function drawPlacementGhost(ctx, state, pick, hover, opts = {}) {
  if (!pick || pick.type !== 'place' || !hover) return;
  const u = unitsFor(state.dims);
  const r = u.ballR;
  const pa = playArea(state.dims);
  const x = Math.max(pa.left, Math.min(pa.right, hover.x));
  const y = Math.max(pa.top, Math.min(pa.bottom, hover.y));
  const id = pick.cardId;

  const ghostZone = (rad, fill, stroke, emoji) => {
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `${r * 1.4}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(emoji, x, y);
  };

  ctx.save();
  ctx.globalAlpha = 0.7;
  if (id === 'move_hole' || id === 'warp_rail') {
    // A ball under the drop point makes the placement invalid (rejected on click).
    const onBall = state.balls.some((b) => {
      if (b.pocketed) return false;
      const bp = toPx({ u: b.u, v: b.v }, state.dims);
      return Math.hypot(bp.x - x, bp.y - y) < u.pocketR + r * (b.size || 1);
    });
    ctx.beginPath(); ctx.arc(x, y, u.pocketR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4,4,4,0.7)'; ctx.fill();
    ctx.strokeStyle = onBall ? 'rgba(255,60,60,0.95)' : 'rgba(255,215,0,0.9)';
    ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
  } else if (id === 'bouncer') {
    ctx.beginPath(); ctx.arc(x, y, r * F.bouncer, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(192,57,43,0.55)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,150,130,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
  } else if (id === 'bear_trap') {
    ctx.font = `${r * 1.8}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🪤', x, y);
  } else if (id === 'ice_patch') {
    ghostZone(r * F.ice, 'rgba(180,220,255,0.22)', 'rgba(180,220,255,0.6)', '🧊');
  } else if (id === 'mud_patch') {
    ghostZone(r * F.mud, 'rgba(100,60,20,0.4)', 'rgba(140,90,40,0.6)', '💩');
  } else if (id === 'portal') {
    // Show any already-placed portal of this pair, linked to the ghost endpoint.
    const placed = opts.positions || [];
    if (placed.length) {
      const p0 = toPx(placed[0], state.dims);
      ctx.beginPath(); ctx.arc(p0.x, p0.y, r * F.portal, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120,90,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = `${r * 1.5}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🌀', p0.x, p0.y);
      ctx.strokeStyle = 'rgba(180,150,255,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 6]);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.arc(x, y, r * F.portal, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,90,120,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `${r * 1.5}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🌀', x, y);
  }
  ctx.restore();
}
