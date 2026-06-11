// render/particles.js — lightweight, purely-cosmetic particle juice. Runtime
// only (never serialized); spawned from physics sound events in app.js and
// drawn last each frame. Self-clocking: updateAndDraw advances by wall time.

const parts = [];
let lastT = 0;

function push(p) {
  if (parts.length > 400) parts.splice(0, parts.length - 400); // hard cap
  parts.push(p);
}

// A ring + a colourful burst when a ball drops into a pocket.
export function spawnPocketDrop(x, y, color) {
  push({ kind: 'ring', x, y, r: 4, vr: 0.09, life: 420, age: 0, color: color || '#ffffff', lw: 2.5 });
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const sp = 0.05 + Math.random() * 0.14;
    push({
      kind: 'dot', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.04,
      drag: 0.94, grav: 0.00012,
      size: 1.2 + Math.random() * 2.2,
      life: 380 + Math.random() * 280, age: 0,
      color: Math.random() < 0.55 ? (color || '#ffffff') : '#ffe9a8',
    });
  }
}

// A small puff of cloth dust where a ball thumps the cushion.
export function spawnRailDust(x, y, impact) {
  const n = Math.round(3 + impact * 5);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 0.015 + Math.random() * 0.05 * impact;
    push({
      kind: 'dot', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      drag: 0.92, grav: 0,
      size: 1 + Math.random() * 1.6,
      life: 240 + Math.random() * 200, age: 0,
      color: 'rgba(225,255,235,0.8)',
    });
  }
}

// A brief white kiss-flash where two balls collide hard.
export function spawnHitFlash(x, y, impact) {
  push({ kind: 'flash', x, y, r: 3 + impact * 7, life: 130, age: 0, color: '#ffffff' });
}

// Metal sparks for the bear trap snapping shut.
export function spawnSparks(x, y) {
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 0.08 + Math.random() * 0.22;
    push({
      kind: 'spark', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      drag: 0.96, grav: 0.0003,
      size: 1 + Math.random() * 1.4,
      life: 260 + Math.random() * 240, age: 0,
      color: Math.random() < 0.5 ? '#ffd24a' : '#fff6d8',
    });
  }
}

// Chalk puff at the cue ball the instant a shot is struck.
export function spawnChalkPuff(x, y, angle, power) {
  const n = 5 + Math.round(power * 6);
  for (let i = 0; i < n; i++) {
    const a = angle + Math.PI + (Math.random() - 0.5) * 1.2; // backwards off the tip
    const sp = 0.02 + Math.random() * 0.06 * (0.4 + power);
    push({
      kind: 'dot', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      drag: 0.9, grav: 0,
      size: 1 + Math.random() * 2,
      life: 200 + Math.random() * 180, age: 0,
      color: 'rgba(150,190,235,0.85)',
    });
  }
}

export function alive() { return parts.length > 0; }
export function clear() { parts.length = 0; lastT = 0; }

export function updateAndDraw(ctx, dims) {
  if (!parts.length) { lastT = 0; return; }
  const now = performance.now();
  const dt = lastT ? Math.min(now - lastT, 64) : 16;
  lastT = now;
  const scale = dims ? dims.w : 1000; // velocities are per-ms in canvas px @1000w

  ctx.save();
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    if (p.age >= p.life) { parts.splice(i, 1); continue; }
    const k = 1 - p.age / p.life; // 1 -> 0
    if (p.kind === 'ring') {
      p.r += p.vr * dt * (scale / 1000);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = k * 0.8;
      ctx.lineWidth = p.lw * k + 0.4;
      ctx.stroke();
    } else if (p.kind === 'flash') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + (1 - k) * 0.8), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = k * 0.5;
      ctx.fill();
    } else {
      const d = Math.pow(p.drag, dt / 16);
      p.vx *= d; p.vy = p.vy * d + (p.grav || 0) * dt;
      p.x += p.vx * dt * (scale / 1000);
      p.y += p.vy * dt * (scale / 1000);
      ctx.globalAlpha = p.kind === 'spark' ? k : k * 0.9;
      if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 26 * (scale / 1000), p.y - p.vy * 26 * (scale / 1000));
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}
