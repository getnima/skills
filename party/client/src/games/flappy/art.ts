/**
 * Flappy art slots. Every image lives at client/public/assets/flappy/<file>;
 * a missing file falls back to the placeholder painter below (see README.md
 * in that folder for sizes). Logical sizes are CSS px; files should be 2x.
 */
import { facePainter, loadAssets } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';
import { createRng } from '../../kit/rng';
import { PAL } from './look';

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
  ctx.strokeStyle = PAL.ink;
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
  ctx.strokeStyle = 'rgba(22, 18, 14, 0.3)';
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

/** Golden halo ring (seen slightly from above): flat yellow with an ink outline. */
const haloPainter: Painter = (ctx, w, h) => {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  const rx = w * 0.4;
  const ry = h * 0.27;
  ctx.lineWidth = h * 0.3;
  ctx.strokeStyle = PAL.ink;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = h * 0.14;
  ctx.strokeStyle = PAL.yel;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};

/** Microphone head, pointing UP (the bottom obstacle; the top one is flipped): a chrome ball on a red collar, comic ink outline. */
const micHeadPainter: Painter = (ctx, w, h) => {
  ctx.save();
  const cx = w / 2;
  const lw = Math.max(2.5, w * 0.04);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = lw;
  // neck: joins the pole at the bottom centre
  const neckW = w * 0.3;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(cx - neckW / 2, h * 0.8, neckW, h * 0.2);
  // red collar
  const colY = h * 0.62;
  const colH = h * 0.22;
  roundRectPath(ctx, cx - w * 0.3, colY, w * 0.6, colH, colH * 0.35);
  ctx.fillStyle = PAL.red;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PAL.yel;
  ctx.fillRect(cx - w * 0.3 + lw, colY + colH * 0.38, w * 0.6 - lw * 2, colH * 0.2);
  // the ball
  const rx = w * 0.45;
  const ry = h * 0.36;
  const by = h * 0.37;
  ctx.beginPath();
  ctx.ellipse(cx, by, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#C9CEDA';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // flat two-tone shading + mesh
  ctx.fillStyle = '#8E95A8';
  ctx.beginPath();
  ctx.ellipse(cx + rx * 0.35, by + ry * 0.45, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(22, 18, 14, 0.4)';
  ctx.lineWidth = Math.max(1, w * 0.014);
  const step = w * 0.08;
  for (let d = -w; d < w * 2; d += step) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + h, h);
    ctx.moveTo(d + h, 0);
    ctx.lineTo(d, h);
    ctx.stroke();
  }
  ctx.fillStyle = PAL.white;
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.42, by - ry * 0.42, rx * 0.2, ry * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.ellipse(cx, by, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  // the band around the ball
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - rx, by + ry * 0.08);
  ctx.quadraticCurveTo(cx, by + ry * 0.42, cx + rx, by + ry * 0.08);
  ctx.stroke();
  ctx.restore();
};

/** Stand pole, tiles vertically: flat chrome with ink edges and one red ring per tile. */
const polePainter: Painter = (ctx, w, h) => {
  ctx.fillStyle = '#C9CEDA';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(w * 0.22, 0, w * 0.16, h);
  ctx.fillStyle = '#8E95A8';
  ctx.fillRect(w * 0.62, 0, w * 0.26, h);
  const edge = Math.max(2, w * 0.12);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, 0, edge, h);
  ctx.fillRect(w - edge, 0, edge, h);
  // a ring in the middle of the tile (the edges of the tile stay plain, so it tiles)
  const rh = w * 0.42;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, h * 0.5 - rh / 2, w, rh);
  ctx.fillStyle = PAL.red;
  ctx.fillRect(edge, h * 0.5 - rh / 2 + edge * 0.6, w - edge * 2, rh - edge * 1.2);
};

/** The stage floor, tiles horizontally: a yellow lip with an ink line over a cobalt front with footlights. */
const groundPainter: Painter = (ctx, w, h) => {
  ctx.fillStyle = PAL.cobD;
  ctx.fillRect(0, 0, w, h);
  const lip = h * 0.26;
  ctx.fillStyle = PAL.yel;
  ctx.fillRect(0, 0, w, lip);
  // diagonal red stripes on the lip (period divides the tile width)
  const period = w / 8;
  ctx.fillStyle = PAL.red;
  for (let x = -period; x < w + period; x += period) {
    ctx.beginPath();
    ctx.moveTo(x, lip);
    ctx.lineTo(x + period * 0.5, lip);
    ctx.lineTo(x + period * 0.5 + lip * 0.7, 0);
    ctx.lineTo(x + lip * 0.7, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, 0, w, Math.max(2.5, h * 0.05));
  ctx.fillRect(0, lip - 1, w, Math.max(2.5, h * 0.05));
  // footlights
  const n = 4;
  for (let i = 0; i < n; i++) {
    const cx = (w / n) * (i + 0.5);
    const cy = lip + (h - lip) * 0.5;
    const r = Math.min((h - lip) * 0.24, w / n / 4);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? PAL.yel2 : PAL.white;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.3);
    ctx.strokeStyle = PAL.ink;
    ctx.stroke();
  }
};

/** Comic clouds, tiles horizontally, transparent sky. */
const skylinePainter: Painter = (ctx, w, h) => {
  const rng = createRng(4242);
  const clouds = 4;
  ctx.lineJoin = 'round';
  for (let i = 0; i < clouds; i++) {
    // kept away from the tile's edges so the tile repeats without a cut cloud
    const cw = w * rng.float(0.13, 0.19);
    const cx = (w / clouds) * (i + 0.5) + rng.float(-w * 0.02, w * 0.02);
    const cy = h * rng.float(0.3, 0.7);
    const ch = cw * 0.36;
    const puff = (ox: number, oy: number, r: number): void => {
      ctx.moveTo(cx + ox + r, cy + oy);
      ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
    };
    const shape = (): void => {
      ctx.beginPath();
      puff(-cw * 0.28, ch * 0.1, ch * 0.42);
      puff(0, -ch * 0.18, ch * 0.6);
      puff(cw * 0.28, ch * 0.08, ch * 0.46);
      ctx.rect(cx - cw * 0.4, cy + ch * 0.05, cw * 0.8, ch * 0.42);
    };
    shape();
    ctx.lineWidth = Math.max(4, h * 0.05);
    ctx.strokeStyle = PAL.ink;
    ctx.stroke();
    ctx.fillStyle = i % 2 === 0 ? PAL.white : PAL.paper;
    ctx.fill();
  }
};

/** The stage backdrop: a cobalt sunburst with a halftone fade, flat colours only. */
const backgroundPainter: Painter = (ctx, w, h) => {
  ctx.fillStyle = PAL.cob;
  ctx.fillRect(0, 0, w, h);
  // rays from below the middle of the stage
  const ox = w * 0.5;
  const oy = h * 0.62;
  const R = Math.hypot(w, h);
  const rays = 18;
  ctx.fillStyle = PAL.cobL;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = a0 + Math.PI / rays;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(a0) * R, oy + Math.sin(a0) * R);
    ctx.lineTo(ox + Math.cos(a1) * R, oy + Math.sin(a1) * R);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // halftone dots, denser towards the top and bottom
  const step = Math.max(9, w * 0.026);
  ctx.fillStyle = 'rgba(16, 35, 140, 0.55)';
  ctx.beginPath();
  for (let j = 0, y = 0; y < h + step; j++, y += step) {
    const v = y / h;
    const amount = Math.max(0, Math.abs(v - 0.5) * 2 - 0.25) * 0.9;
    if (amount <= 0.03) continue;
    const r = (step / 2) * Math.min(1, amount);
    for (let x = j % 2 === 0 ? 0 : step / 2; x < w + step; x += step) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
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
