/**
 * Flappy art slots. Every image lives at client/public/assets/flappy/<file>;
 * a missing file falls back to the placeholder painter below (see README.md
 * in that folder for sizes). Logical sizes are CSS px; files should be 2x.
 */
import { facePainter, loadAssets, shade } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';
import { createRng } from '../../kit/rng';
import { COLORS } from '../../kit/theme';

import type { AssetSlot, Drawable, Painter } from '../../kit/assets';

const FACE_COLOR = '#ffc93c';

// ───────────────────────────── Painters ─────────────────────────────

/** A white angel wing, its root at the left middle, tip to the right. */
const wingPainter: Painter = (ctx, w, h) => {
  ctx.save();
  ctx.lineJoin = 'round';
  const rootX = w * 0.06;
  const rootY = h * 0.5;
  // three feather lobes
  const lobes = [
    { x: 0.95, y: 0.28, r: 0.2 },
    { x: 0.78, y: 0.58, r: 0.2 },
    { x: 0.56, y: 0.8, r: 0.17 },
  ];
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2b1436';
  ctx.lineWidth = Math.max(2, h * 0.07);
  ctx.beginPath();
  ctx.moveTo(rootX, rootY - h * 0.2);
  ctx.quadraticCurveTo(w * 0.45, 0, w * 0.96, h * 0.1);
  ctx.quadraticCurveTo(w * 1.0, h * 0.35, w * 0.86, h * 0.45);
  ctx.quadraticCurveTo(w * 0.92, h * 0.68, w * 0.7, h * 0.72);
  ctx.quadraticCurveTo(w * 0.7, h * 0.94, w * 0.46, h * 0.92);
  ctx.quadraticCurveTo(w * 0.2, h * 0.86, rootX, rootY + h * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // inner feather lines
  ctx.strokeStyle = 'rgba(120, 90, 180, 0.45)';
  ctx.lineWidth = Math.max(1.5, h * 0.045);
  ctx.lineCap = 'round';
  for (const l of lobes) {
    ctx.beginPath();
    ctx.moveTo(w * 0.2, rootY);
    ctx.quadraticCurveTo(w * (l.x - 0.25), h * l.y, w * (l.x - 0.08), h * (l.y + l.r * 0.2));
    ctx.stroke();
  }
  ctx.restore();
};

/** Golden halo ring (seen slightly from above). */
const haloPainter: Painter = (ctx, w, h) => {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  const rx = w * 0.42;
  const ry = h * 0.3;
  ctx.lineWidth = h * 0.22;
  ctx.strokeStyle = 'rgba(255, 230, 120, 0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = h * 0.13;
  ctx.strokeStyle = '#ffd23f';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = h * 0.05;
  ctx.strokeStyle = '#fff6c8';
  ctx.beginPath();
  ctx.ellipse(0, -ry * 0.12, rx * 0.92, ry * 0.8, 0, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.restore();
};

/** Microphone head, pointing UP (the bottom obstacle; the top one is flipped). */
const micHeadPainter: Painter = (ctx, w, h) => {
  ctx.save();
  const cx = w / 2;
  const ink = '#1b0c33';
  const lw = Math.max(2, w * 0.035);
  // neck: tapers into the pole at the bottom
  const neckTop = h * 0.66;
  ctx.fillStyle = '#2d2d3a';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.2, neckTop);
  ctx.lineTo(cx + w * 0.2, neckTop);
  ctx.lineTo(cx + w * 0.2, h);
  ctx.lineTo(cx - w * 0.2, h);
  ctx.closePath();
  ctx.fill();
  // neon band
  const bandY = h * 0.58;
  const bandH = h * 0.13;
  ctx.shadowColor = COLORS.pink;
  ctx.shadowBlur = w * 0.08;
  ctx.fillStyle = COLORS.pink;
  roundRectPath(ctx, cx - w * 0.36, bandY, w * 0.72, bandH, bandH * 0.4);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = lw;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  roundRectPath(ctx, cx - w * 0.3, bandY + bandH * 0.18, w * 0.6, bandH * 0.22, bandH * 0.1);
  ctx.fill();
  // grille: a dome
  const gr = w * 0.44;
  const gy = bandY;
  const grad = ctx.createLinearGradient(cx - gr, 0, cx + gr, 0);
  grad.addColorStop(0, '#7d7f93');
  grad.addColorStop(0.35, '#f4f5ff');
  grad.addColorStop(0.6, '#c3c6d8');
  grad.addColorStop(1, '#5d5f73');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx - gr, gy);
  ctx.bezierCurveTo(cx - gr, gy - h * 0.72, cx + gr, gy - h * 0.72, cx + gr, gy);
  ctx.closePath();
  ctx.fill();
  // mesh
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(40, 40, 60, 0.35)';
  ctx.lineWidth = Math.max(1, w * 0.016);
  const step = w * 0.085;
  for (let d = -w; d < w * 2; d += step) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + h, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(d + h, 0);
    ctx.lineTo(d, h);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - gr * 0.38, gy - h * 0.34, gr * 0.16, h * 0.1, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = lw;
  ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.moveTo(cx - gr, gy);
  ctx.bezierCurveTo(cx - gr, gy - h * 0.72, cx + gr, gy - h * 0.72, cx + gr, gy);
  ctx.stroke();
  ctx.restore();
};

/** Chrome stand pole, tiles vertically. */
const polePainter: Painter = (ctx, w, h) => {
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#3b3c4c');
  grad.addColorStop(0.28, '#d9dbea');
  grad.addColorStop(0.42, '#ffffff');
  grad.addColorStop(0.7, '#8f92a8');
  grad.addColorStop(1, '#30313f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(27, 12, 51, 0.85)';
  ctx.fillRect(0, 0, Math.max(1.5, w * 0.06), h);
  ctx.fillRect(w - Math.max(1.5, w * 0.06), 0, Math.max(1.5, w * 0.06), h);
  // a joint ring per tile
  ctx.fillStyle = 'rgba(27, 12, 51, 0.35)';
  ctx.fillRect(0, h * 0.5 - w * 0.06, w, w * 0.12);
};

/** Glowing dance floor strip, tiles horizontally. */
const groundPainter: Painter = (ctx, w, h) => {
  ctx.fillStyle = '#1a0b3d';
  ctx.fillRect(0, 0, w, h);
  const top = h * 0.16;
  const cols = 8;
  const rows = 3;
  const cw = w / cols;
  const rh = (h - top) / rows;
  const tiles = [COLORS.pink, COLORS.cyan, COLORS.yellow, COLORS.purple, COLORS.green, COLORS.orange];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = tiles[(c * 2 + r * 3) % tiles.length] ?? COLORS.pink;
      const lit = (c + r) % 2 === 0;
      ctx.fillStyle = lit ? color : shade(color, -0.62);
      roundRectPath(ctx, c * cw + 2, top + r * rh + 2, cw - 4, rh - 4, 4);
      ctx.fill();
      if (lit) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        roundRectPath(ctx, c * cw + 5, top + r * rh + 4, cw * 0.4, rh * 0.22, 2);
        ctx.fill();
      }
    }
  }
  // neon edge on top
  const edge = ctx.createLinearGradient(0, 0, 0, top);
  edge.addColorStop(0, '#ffffff');
  edge.addColorStop(0.35, COLORS.pink);
  edge.addColorStop(1, shade(COLORS.pink, -0.5));
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, top);
  ctx.fillStyle = '#1b0c33';
  ctx.fillRect(0, top - 2, w, 2);
};

/** City / party-hall silhouettes with lit windows, tiles horizontally, transparent sky. */
const skylinePainter: Painter = (ctx, w, h) => {
  const rng = createRng(4242);
  let x = 0;
  const colors = ['#2b1663', '#341a75', '#26135a'];
  while (x < w) {
    let bw = rng.float(w * 0.07, w * 0.14);
    if (x + bw > w - w * 0.05) bw = w - x; // the last block ends exactly at the edge: seamless tile
    const bh = rng.float(h * 0.35, h * 0.95);
    const top = h - bh;
    ctx.fillStyle = colors[rng.int(0, colors.length - 1)] ?? '#2b1663';
    ctx.fillRect(x, top, bw + 0.5, bh);
    if (rng.chance(0.3)) {
      // antenna with a red light
      ctx.fillRect(x + bw * 0.48, top - h * 0.08, Math.max(1, bw * 0.05), h * 0.08);
      ctx.fillStyle = COLORS.red;
      ctx.beginPath();
      ctx.arc(x + bw * 0.5, top - h * 0.08, Math.max(1.5, h * 0.02), 0, Math.PI * 2);
      ctx.fill();
    }
    const winW = Math.max(2, bw * 0.14);
    const winH = Math.max(2, h * 0.045);
    for (let wy = top + h * 0.06; wy < h - winH; wy += winH * 2.2) {
      for (let wx = x + bw * 0.14; wx < x + bw - winW; wx += winW * 2) {
        if (!rng.chance(0.42)) continue;
        ctx.fillStyle = rng.chance(0.75) ? 'rgba(255, 210, 63, 0.75)' : 'rgba(255, 61, 139, 0.7)';
        ctx.fillRect(wx, wy, winW, winH);
      }
    }
    x += bw;
  }
};

/** Party night sky: gradient, stars, a moon and two spotlight beams. */
const backgroundPainter: Painter = (ctx, w, h) => {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0d0628');
  sky.addColorStop(0.45, '#2a1263');
  sky.addColorStop(0.78, '#6a1e7d');
  sky.addColorStop(1, '#c2366f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // spotlight beams
  const beams = [
    { x: w * 0.12, a: 0.32, c: 'rgba(45, 226, 230, 0.10)' },
    { x: w * 0.9, a: -0.38, c: 'rgba(255, 61, 139, 0.11)' },
  ];
  for (const b of beams) {
    ctx.save();
    ctx.translate(b.x, h);
    ctx.rotate(b.a);
    ctx.fillStyle = b.c;
    ctx.beginPath();
    ctx.moveTo(-w * 0.03, 0);
    ctx.lineTo(w * 0.03, 0);
    ctx.lineTo(w * 0.22, -h * 1.1);
    ctx.lineTo(-w * 0.22, -h * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // stars
  const rng = createRng(77);
  for (let i = 0; i < 90; i++) {
    const sx = rng.float(0, w);
    const sy = rng.float(0, h * 0.7);
    const r = rng.float(0.6, 1.8);
    ctx.fillStyle = `rgba(255,255,255,${rng.float(0.35, 0.95).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // moon
  const mx = w * 0.76;
  const my = h * 0.2;
  const mr = Math.min(w, h) * 0.09;
  const glow = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 3);
  glow.addColorStop(0, 'rgba(255, 240, 200, 0.35)');
  glow.addColorStop(1, 'rgba(255, 240, 200, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(mx - mr * 3, my - mr * 3, mr * 6, mr * 6);
  ctx.fillStyle = '#fff1c9';
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(200, 170, 120, 0.35)';
  ctx.beginPath();
  ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.2, 0, Math.PI * 2);
  ctx.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.14, 0, Math.PI * 2);
  ctx.fill();
};

// ───────────────────────────── Slots ─────────────────────────────

/** Logical sizes (CSS px). Real files should be twice as large. */
export const SLOT_SIZES = {
  face: 128,
  wing: { w: 64, h: 48 },
  halo: { w: 64, h: 24 },
  head: { w: 140, h: 110 },
  pole: { w: 48, h: 192 },
  ground: { w: 256, h: 64 },
  skyline: { w: 512, h: 160 },
  background: { w: 430, h: 932 },
} as const;

const SLOTS = [
  { key: 'face', file: 'face.png', size: SLOT_SIZES.face, placeholder: facePainter('happy', FACE_COLOR) },
  { key: 'face_flap', file: 'face_flap.png', size: SLOT_SIZES.face, placeholder: facePainter('laughing', FACE_COLOR) },
  { key: 'face_dead', file: 'face_dead.png', size: SLOT_SIZES.face, placeholder: facePainter('dead', FACE_COLOR) },
  { key: 'wing', file: 'wing.png', size: SLOT_SIZES.wing.w, height: SLOT_SIZES.wing.h, placeholder: wingPainter },
  { key: 'halo', file: 'halo.png', size: SLOT_SIZES.halo.w, height: SLOT_SIZES.halo.h, placeholder: haloPainter },
  { key: 'obstacle', file: 'obstacle.png', size: SLOT_SIZES.head.w, height: SLOT_SIZES.head.h, placeholder: micHeadPainter },
  { key: 'obstacle_pole', file: 'obstacle_pole.png', size: SLOT_SIZES.pole.w, height: SLOT_SIZES.pole.h, fit: 'cover', placeholder: polePainter },
  { key: 'ground', file: 'ground.png', size: SLOT_SIZES.ground.w, height: SLOT_SIZES.ground.h, fit: 'cover', placeholder: groundPainter },
  { key: 'skyline', file: 'skyline.png', size: SLOT_SIZES.skyline.w, height: SLOT_SIZES.skyline.h, placeholder: skylinePainter },
  {
    key: 'background',
    file: 'background.jpg',
    size: SLOT_SIZES.background.w,
    height: SLOT_SIZES.background.h,
    fit: 'cover',
    placeholder: backgroundPainter,
  },
] as const satisfies readonly AssetSlot[];

export type FlappyArt = Record<(typeof SLOTS)[number]['key'], Drawable>;

export function loadFlappyArt(): Promise<FlappyArt> {
  return loadAssets('flappy', SLOTS);
}
