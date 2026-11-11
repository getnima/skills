/**
 * Art of "שימי טאפ". Every replaceable picture is a kit file slot under
 * client/public/assets/tap/ (see the README there); the rest are UI sprites
 * (glow, rays, shadow, ghost hand) pre-rendered once so the hot path only
 * calls drawImage.
 */
import { facePainter, loadAssets, paintDrawable, shade } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';
import { COLORS } from '../../kit/theme';

import type { Drawable, Painter } from '../../kit/assets';

/** Logical box of a face slot in CSS px (pre-rendered at 2x = 600px). */
export const FACE_BOX = 300;
/** Share of the face box the head covers (radius / box). Used for hit testing. */
export const HEAD_RADIUS = 0.46;

const FACE_COLOR = '#ffc93c';
const INK = '#2b1436';

/** Party backdrop: deep purple with a sunburst, soft spots and sparkles. */
const backgroundPainter: Painter = (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2a0f63');
  g.addColorStop(0.55, '#4a1580');
  g.addColorStop(1, '#1a0840');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h * 0.48;
  const rays = 18;
  const far = Math.hypot(w, h);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = a0 + Math.PI / rays;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * far, cy + Math.sin(a0) * far);
    ctx.lineTo(cx + Math.cos(a1) * far, cy + Math.sin(a1) * far);
    ctx.closePath();
    ctx.fill();
  }

  const spot = (x: number, y: number, r: number, color: string): void => {
    const s = ctx.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, color);
    s.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = s;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  spot(w * 0.1, h * 0.12, w * 0.7, 'rgba(255, 61, 139, 0.28)');
  spot(w * 0.95, h * 0.8, w * 0.75, 'rgba(45, 226, 230, 0.2)');
  spot(cx, cy, w * 0.6, 'rgba(255, 210, 63, 0.16)');

  // sparkles in a fixed pattern (art, not gameplay)
  const dots = [
    [0.08, 0.3, 3], [0.88, 0.2, 4], [0.18, 0.72, 3], [0.8, 0.62, 2.5], [0.5, 0.1, 2.5],
    [0.32, 0.88, 3.5], [0.7, 0.92, 2.5], [0.94, 0.42, 3], [0.05, 0.52, 2], [0.62, 0.3, 2],
  ] as const;
  const colors = [COLORS.yellow, COLORS.cyan, COLORS.pink, '#ffffff'];
  dots.forEach(([x, y, r], i) => {
    ctx.fillStyle = colors[i % colors.length] ?? '#fff';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(x * w, y * h, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
};

export const FACE_KEYS = ['face_normal', 'face_happy', 'face_surprised', 'face_angry', 'face_tongue', 'face_wink'] as const;
export type FaceKey = (typeof FACE_KEYS)[number];

export interface TapArt {
  readonly faces: readonly Drawable[];
  readonly nosepick: Drawable;
  readonly background: Drawable;
  readonly glow: Drawable;
  readonly rays: Drawable;
  readonly shadow: Drawable;
  readonly hand: Drawable;
}

export async function loadTapArt(): Promise<TapArt> {
  const slots = await loadAssets('tap', [
    { key: 'face_normal', file: 'face_normal.png', size: FACE_BOX, placeholder: facePainter('normal', FACE_COLOR) },
    { key: 'face_happy', file: 'face_happy.png', size: FACE_BOX, placeholder: facePainter('happy', FACE_COLOR) },
    { key: 'face_surprised', file: 'face_surprised.png', size: FACE_BOX, placeholder: facePainter('surprised', FACE_COLOR) },
    { key: 'face_angry', file: 'face_angry.png', size: FACE_BOX, placeholder: facePainter('angry', FACE_COLOR) },
    { key: 'face_tongue', file: 'face_tongue.png', size: FACE_BOX, placeholder: facePainter('tongue', FACE_COLOR) },
    { key: 'face_wink', file: 'face_wink.png', size: FACE_BOX, placeholder: facePainter('wink', FACE_COLOR) },
    { key: 'face_nosepick', file: 'face_nosepick.png', size: FACE_BOX, placeholder: facePainter('nose-pick', FACE_COLOR) },
    { key: 'background', file: 'background.jpg', size: 430, height: 932, fit: 'cover', placeholder: backgroundPainter },
  ]);
  return {
    faces: FACE_KEYS.map((k) => slots[k]),
    nosepick: slots.face_nosepick,
    background: slots.background,
    glow: paintDrawable('tap_glow', glowPainter, 256),
    rays: paintDrawable('tap_rays', raysPainter, 256),
    shadow: paintDrawable('tap_shadow', shadowPainter, 128, 40),
    hand: paintDrawable('tap_hand', handPainter, 96, 120),
  };
}

/** Golden halo ring (drawn behind the face while it picks its nose). */
const glowPainter: Painter = (ctx, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2;
  const g = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
  g.addColorStop(0, 'rgba(255, 230, 120, 0)');
  g.addColorStop(0.45, 'rgba(255, 220, 80, 0.95)');
  g.addColorStop(0.62, 'rgba(255, 150, 40, 0.55)');
  g.addColorStop(1, 'rgba(255, 120, 40, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
};

/** Sunburst behind the face (tinted by globalAlpha at draw time). */
const raysPainter: Painter = (ctx, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2;
  const n = 14;
  const g = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
  g.addColorStop(0, 'rgba(255, 240, 180, 0.9)');
  g.addColorStop(1, 'rgba(255, 240, 180, 0)');
  ctx.fillStyle = g;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = a0 + Math.PI / n;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
};

const shadowPainter: Painter = (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(8, 2, 24, 0.55)');
  g.addColorStop(1, 'rgba(8, 2, 24, 0)');
  ctx.fillStyle = g;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(1, h / w);
  ctx.beginPath();
  ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
  ctx.restore();
  ctx.fill();
};

/** Ghost hand pointing up with the index finger; the fingertip is at (0.5w, 0.06h). */
const handPainter: Painter = (ctx, w, h) => {
  const skin = '#ffffff';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.fillStyle = skin;
  const fw = w * 0.22;
  // palm (a fist with the index finger up)
  roundRectPath(ctx, w * 0.24, h * 0.46, w * 0.62, h * 0.48, w * 0.2);
  ctx.fill();
  ctx.stroke();
  // index finger
  roundRectPath(ctx, w * 0.5 - fw / 2, h * 0.04, fw, h * 0.6, fw / 2);
  ctx.fill();
  ctx.stroke();
  // thumb
  ctx.save();
  ctx.translate(w * 0.28, h * 0.66);
  ctx.rotate(-0.6);
  roundRectPath(ctx, -fw * 0.45, -h * 0.16, fw * 0.9, h * 0.28, fw * 0.45);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // hide the finger's bottom outline inside the palm, then draw the curled fingers' creases
  ctx.fillStyle = skin;
  ctx.fillRect(w * 0.5 - fw / 2 + 2, h * 0.48, fw - 4, h * 0.14);
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const y = h * (0.6 + i * 0.1);
    ctx.moveTo(w * 0.62, y);
    ctx.lineTo(w * 0.8, y);
  }
  ctx.stroke();
  // nail
  ctx.fillStyle = shade('#ffd6e4', 0);
  roundRectPath(ctx, w * 0.5 - fw * 0.28, h * 0.07, fw * 0.56, h * 0.09, fw * 0.2);
  ctx.fill();
};
