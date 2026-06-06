const TABLE_CACHE = {
  canvas: null,
  key: '',
};

function traceFeltPath(ctx, width, height, rail, pocketRadius) {
  // Corner pockets use base jaw; side pockets are ~12% larger
  const jaw = pocketRadius + 8;
  const sideJaw = Math.round(pocketRadius * 1.12) + 8;

  ctx.beginPath();
  ctx.moveTo(rail + jaw,          rail);            // TL corner, top edge
  ctx.lineTo(width / 2 - sideJaw, rail);            // approach T side pocket
  ctx.lineTo(width / 2,           rail + sideJaw);  // T side pocket dip
  ctx.lineTo(width / 2 + sideJaw, rail);            // leave T side pocket
  ctx.lineTo(width - rail - jaw,  rail);            // TR corner, top edge
  ctx.lineTo(width - rail,        rail + jaw);      // TR corner, right edge
  ctx.lineTo(width - rail,        height - rail - jaw); // BR corner, right edge
  ctx.lineTo(width - rail - jaw,  height - rail);   // BR corner, bottom edge
  ctx.lineTo(width / 2 + sideJaw, height - rail);   // approach B side pocket
  ctx.lineTo(width / 2,           height - rail - sideJaw); // B side pocket dip
  ctx.lineTo(width / 2 - sideJaw, height - rail);   // leave B side pocket
  ctx.lineTo(rail + jaw,          height - rail);   // BL corner, bottom edge
  ctx.lineTo(rail,                height - rail - jaw); // BL corner, left edge
  ctx.lineTo(rail,                rail + jaw);      // TL corner, left edge
  ctx.closePath();

  return jaw;
}

function drawTableLayer(width, height, rail, pocketRadius) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const jaw = pocketRadius + 8;
  // Side pockets (index 1, 4) are ~12% larger than corners, matching real table specs
  const sidePR = Math.round(pocketRadius * 1.12);
  const pockets = [
    [rail,         rail,          pocketRadius], // TL corner
    [width / 2,    rail,          sidePR],       // T side
    [width - rail, rail,          pocketRadius], // TR corner
    [rail,         height - rail, pocketRadius], // BL corner
    [width / 2,    height - rail, sidePR],       // B side
    [width - rail, height - rail, pocketRadius], // BR corner
  ];

  ctx.clearRect(0, 0, width, height);

  // Outer rail body with richer wood tone.
  const railGrad = ctx.createLinearGradient(0, 0, width, height);
  railGrad.addColorStop(0, '#3a210f');
  railGrad.addColorStop(0.46, '#6f4526');
  railGrad.addColorStop(1, '#2a1709');
  ctx.fillStyle = railGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle wood grain streaks.
  ctx.save();
  ctx.globalAlpha = 0.12;
  for (let y = 0; y < height; y += 3) {
    const wobble = Math.sin((y * 0.23) + 1.9) * 0.5;
    const alpha = 0.015 + ((Math.sin(y * 0.09) + 1) * 0.015);
    ctx.fillStyle = `rgba(255, 214, 164, ${alpha})`;
    ctx.fillRect(0, y + wobble, width, 1);
  }
  ctx.restore();

  // Metallic edge accents.
  ctx.fillStyle = 'rgba(250, 220, 156, 0.2)';
  ctx.fillRect(0, 0, width, 2);
  ctx.fillRect(0, 0, 2, height);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, height - 2, width, 2);
  ctx.fillRect(width - 2, 0, 2, height);

  // Felt surface.
  traceFeltPath(ctx, width, height, rail, pocketRadius);
  const feltGrad = ctx.createRadialGradient(width * 0.5, height * 0.5, width * 0.08, width * 0.5, height * 0.5, width * 0.62);
  feltGrad.addColorStop(0, '#2db367');
  feltGrad.addColorStop(0.52, '#1d7f49');
  feltGrad.addColorStop(1, '#0f4a2c');
  ctx.fillStyle = feltGrad;
  ctx.fill();

  // Felt weave and sheen.
  ctx.save();
  traceFeltPath(ctx, width, height, rail, pocketRadius);
  ctx.clip();

  const sheen = ctx.createLinearGradient(rail, rail, width - rail, height - rail);
  sheen.addColorStop(0, 'rgba(255,255,255,0.085)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = sheen;
  ctx.fillRect(rail, rail, width - rail * 2, height - rail * 2);

  for (let x = rail; x < width - rail; x += 6) {
    const alpha = x % 12 === 0 ? 0.038 : 0.02;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(x, rail, 1, height - rail * 2);
  }

  for (let y = rail; y < height - rail; y += 5) {
    const alpha = 0.016 + ((Math.sin(y * 0.3) + 1) * 0.008);
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fillRect(rail, y, width - rail * 2, 1);
  }

  // Deterministic micro-noise dots.
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 520; i++) {
    const nx = rail + ((i * 73) % (width - rail * 2));
    const ny = rail + ((i * 97) % (height - rail * 2));
    ctx.fillStyle = i % 2 === 0 ? '#fff' : '#000';
    ctx.fillRect(nx, ny, 1, 1);
  }
  ctx.restore();

  // Cushion rails.
  traceFeltPath(ctx, width, height, rail, pocketRadius);
  ctx.strokeStyle = '#1f6f3d';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'miter';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(7, 26, 15, 0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(176, 255, 176, 0.17)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Rail diamonds.
  const diamonds = [
    [width * 0.24, rail * 0.55, 0],
    [width * 0.5, rail * 0.55, 0],
    [width * 0.76, rail * 0.55, 0],
    [width * 0.24, height - rail * 0.55, 0],
    [width * 0.5, height - rail * 0.55, 0],
    [width * 0.76, height - rail * 0.55, 0],
    [rail * 0.55, height * 0.25, Math.PI / 2],
    [rail * 0.55, height * 0.75, Math.PI / 2],
    [width - rail * 0.55, height * 0.25, Math.PI / 2],
    [width - rail * 0.55, height * 0.75, Math.PI / 2],
  ];

  diamonds.forEach(([x, y, rot]) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -4.5);
    ctx.lineTo(5, 0);
    ctx.lineTo(0, 4.5);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    const dGrad = ctx.createLinearGradient(-5, -4, 5, 4);
    dGrad.addColorStop(0, 'rgba(255,233,185,0.95)');
    dGrad.addColorStop(1, 'rgba(198,138,63,0.95)');
    ctx.fillStyle = dGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(72,40,18,0.65)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  });

  // Pockets with rings and depth.
  pockets.forEach(([px, py, pr]) => {
    const ringGrad = ctx.createRadialGradient(px - 2, py - 2, 3, px, py, pr + 6);
    ringGrad.addColorStop(0, 'rgba(80,40,18,0.15)');
    ringGrad.addColorStop(1, 'rgba(30,12,3,0.95)');
    ctx.beginPath();
    ctx.arc(px, py, pr + 5, 0, Math.PI * 2);
    ctx.fillStyle = ringGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = '#020202';
    ctx.fill();

    const depth = ctx.createRadialGradient(px, py, 1, px, py, pr);
    depth.addColorStop(0, 'rgba(0,0,0,0.1)');
    depth.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    depth.addColorStop(1, 'rgba(0,0,0,0.95)');
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = depth;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px - 2, py - 2, pr * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill();
  });

  // Spot markers and head-string line.
  ctx.fillStyle = 'rgba(245, 246, 233, 0.28)';
  ctx.beginPath();
  ctx.arc(width * 0.25, height / 2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width * 0.72, height / 2, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(width * 0.25, rail + jaw);
  ctx.lineTo(width * 0.25, height - rail - jaw);
  ctx.stroke();
  ctx.setLineDash([]);

  return canvas;
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hexToRgb(hex) {
  const raw = (hex || '').replace('#', '');
  if (raw.length !== 6) return [128, 128, 128];
  const n = parseInt(raw, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shiftHex(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${clamp255(r + amt)}, ${clamp255(g + amt)}, ${clamp255(b + amt)})`;
}

function drawSpinDial(ctx, canvas, spinX, spinY) {
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const r = width / 2 - 5;

  ctx.clearRect(0, 0, width, height);

  const ring = ctx.createRadialGradient(cx, cy, 8, cx, cy, r);
  ring.addColorStop(0, '#f8f2de');
  ring.addColorStop(0.72, '#ddd4c0');
  ring.addColorStop(1, '#8f8574');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();

  const rim = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  rim.addColorStop(0, 'rgba(255,255,255,0.45)');
  rim.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(18, 20, 19, 0.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 2);
  ctx.lineTo(cx, cy + r - 2);
  ctx.moveTo(cx - r + 2, cy);
  ctx.lineTo(cx + r - 2, cy);
  ctx.stroke();

  const guideR = r * 0.78;
  ctx.beginPath();
  ctx.arc(cx, cy, guideR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.setLineDash([2, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TOP', cx, cy - r + 11);
  ctx.fillText('BTM', cx, cy + r - 3);
  ctx.textAlign = 'left';
  ctx.fillText('L', cx - r + 4, cy + 3);
  ctx.textAlign = 'right';
  ctx.fillText('R', cx + r - 4, cy + 3);

  const px = cx + spinX * guideR;
  const py = cy + spinY * guideR;
  const pin = ctx.createRadialGradient(px - 2, py - 3, 2, px, py, 9);
  pin.addColorStop(0, '#ffe4b7');
  pin.addColorStop(0.25, '#ef7059');
  pin.addColorStop(1, '#8a1d18');

  ctx.beginPath();
  ctx.arc(px, py, 8, 0, Math.PI * 2);
  ctx.fillStyle = pin;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(px - 2, py - 2, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fill();
}

function drawTableSurface(ctx, { width, height, rail, pocketRadius }) {
  const key = `${width}x${height}:${rail}:${pocketRadius}`;
  if (!TABLE_CACHE.canvas || TABLE_CACHE.key !== key) {
    TABLE_CACHE.canvas = drawTableLayer(width, height, rail, pocketRadius);
    TABLE_CACHE.key = key;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(TABLE_CACHE.canvas, 0, 0);

  // Global vignette to push focus toward center table action.
  const vignette = ctx.createRadialGradient(width * 0.5, height * 0.5, width * 0.18, width * 0.5, height * 0.5, width * 0.72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function drawPoolBall(ctx, ball, options) {
  if (ball.pocketed) return;

  const { activeEffects, baseRadius, minVelocity, tableWidth, mirrorPositionForBall } = options;
  if (activeEffects.cloaked === ball.num) return;

  const isConfused = activeEffects.confusion && activeEffects.confusionMap && ball.num !== 0 && ball.num !== 8;
  const shownNum = isConfused ? (activeEffects.confusionMap[ball.num] || ball.num) : ball.num;
  const shownStripe = (
    activeEffects.confusion &&
    activeEffects.confusionStripeMap &&
    ball.num !== 0 &&
    ball.num !== 8 &&
    activeEffects.confusionStripeMap[ball.num] !== undefined
  ) ? activeEffects.confusionStripeMap[ball.num] : ball.stripe;

  const r = ball.num === 0 ? (ball._r || baseRadius) : (ball.r || baseRadius);
  const speed = Math.hypot(ball.vx, ball.vy);
  const rollDir = speed > minVelocity ? Math.atan2(ball.vy, ball.vx) : 0;
  const rollAngle = ball.roll || 0;
  const axis = rollDir + rollAngle;
  let drawX = ball.x;
  let drawY = ball.y;
  if (activeEffects.mirror && ball.num !== 0) {
    if (typeof mirrorPositionForBall === 'function') {
      const mirrored = mirrorPositionForBall(ball, r + 0.6);
      if (mirrored && Number.isFinite(mirrored.x) && Number.isFinite(mirrored.y)) {
        drawX = mirrored.x;
        drawY = mirrored.y;
      } else {
        drawX = tableWidth - ball.x;
      }
    } else {
      drawX = tableWidth - ball.x;
    }
  }

  // Grounded shadow.
  ctx.beginPath();
  ctx.ellipse(drawX + 2, drawY + r * 0.9, r * 0.72, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();

  if (shownNum === 0 && activeEffects.glassCue) {
    ctx.beginPath();
    ctx.arc(drawX, drawY, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  ctx.save();
  ctx.translate(drawX, drawY);

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();

  const ballColor = ball.c || '#cccccc';

  if (shownNum === 0) {
    const cueGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    cueGrad.addColorStop(0, '#ffffff');
    cueGrad.addColorStop(0.5, '#f0f0ef');
    cueGrad.addColorStop(1, '#b7b7b7');
    ctx.fillStyle = cueGrad;
    ctx.fillRect(-r, -r, r * 2, r * 2);

    if (speed > 0.45) {
      ctx.save();
      ctx.rotate(axis);
      ctx.beginPath();
      ctx.arc(0, -r * 0.55, r * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(170, 170, 170, 0.6)';
      ctx.fill();
      ctx.restore();
    }
  } else {
    if (shownStripe) {
      const shell = ctx.createRadialGradient(-r * 0.28, -r * 0.3, r * 0.08, 0, 0, r);
      shell.addColorStop(0, '#fcfcfb');
      shell.addColorStop(0.62, '#edece7');
      shell.addColorStop(1, '#cfcdc8');
      ctx.fillStyle = shell;
      ctx.fillRect(-r, -r, r * 2, r * 2);

      ctx.save();
      ctx.rotate(axis);
      const stripeGrad = ctx.createLinearGradient(-r, 0, r, 0);
      stripeGrad.addColorStop(0, shiftHex(ballColor, -20));
      stripeGrad.addColorStop(0.45, ballColor);
      stripeGrad.addColorStop(1, shiftHex(ballColor, -36));
      ctx.fillStyle = stripeGrad;
      ctx.fillRect(-r, -r * 0.54, r * 2, r * 1.08);
      ctx.restore();
    } else {
      const solid = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.08, 0, 0, r);
      solid.addColorStop(0, shiftHex(ballColor, 58));
      solid.addColorStop(0.38, ballColor);
      solid.addColorStop(1, shiftHex(ballColor, -58));
      ctx.fillStyle = solid;
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }

    // Rolling tint band to imply spinning volume.
    ctx.save();
    ctx.rotate(axis);
    const sweep = ctx.createLinearGradient(-r, -r, r, r);
    sweep.addColorStop(0, 'rgba(255,255,255,0.2)');
    sweep.addColorStop(0.5, 'rgba(255,255,255,0)');
    sweep.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = sweep;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }

  // Rim shading for spherical depth.
  const rimShade = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
  rimShade.addColorStop(0, 'rgba(0,0,0,0)');
  rimShade.addColorStop(0.72, 'rgba(0,0,0,0.08)');
  rimShade.addColorStop(1, 'rgba(0,0,0,0.24)');
  ctx.fillStyle = rimShade;
  ctx.fillRect(-r, -r, r * 2, r * 2);

  if (shownNum > 0) {
    const decal = ctx.createRadialGradient(-r * 0.05, -r * 0.05, r * 0.02, 0, 0, r * 0.46);
    decal.addColorStop(0, 'rgba(255,255,255,0.98)');
    decal.addColorStop(1, 'rgba(230,229,221,0.9)');
    ctx.fillStyle = decal;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.44, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0d0d0d';
    ctx.font = `bold ${shownNum > 9 ? 5.6 : 6.8}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(shownNum), 0, 0);
  }

  // Specular highlight.
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.34, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.64)';
  ctx.fill();

  ctx.restore();

  // Outer shell rim.
  ctx.beginPath();
  ctx.arc(drawX, drawY, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
}

window.HDRenderer = {
  drawPoolBall,
  drawSpinDial,
  drawTableSurface,
};
