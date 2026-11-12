/**
 * Art of "אייסי שימי". Every replaceable picture is a kit file slot under
 * client/public/assets/icy/ (listed in the README there). The placeholders
 * are generic cartoon art; the UI sprites at the bottom (ghost finger, glow)
 * are pre-rendered once so the hot path only calls drawImage.
 */
import { drawFace, loadAssets, paintDrawable, shade } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';

import type { Drawable, FaceExpression, Painter } from '../../kit/assets';

/** Logical box of a face slot in CSS px (pre-rendered at 2x = 256px). */
export const FACE_BOX = 128;
/** Head radius as a share of the face box (the kit face uses 0.46). */
export const HEAD_SHARE = 0.46;

const FACE_COLOR = '#ffc93c';
const INK = '#2b1436';

/** Cartoon face in a red knitted beanie with a pompom. */
function beanieFace(expression: FaceExpression): Painter {
  return (ctx, w, h): void => {
    const r = Math.min(w, h) * HEAD_SHARE;
    const cx = w / 2;
    const cy = h / 2 + r * 0.04;
    drawFace(ctx, cx, cy, r, expression, FACE_COLOR);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(r, r);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = INK;
    // hat dome
    ctx.beginPath();
    ctx.moveTo(-0.9, -0.42);
    ctx.bezierCurveTo(-0.9, -1.25, 0.9, -1.25, 0.9, -0.42);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -1.1, 0, -0.4);
    g.addColorStop(0, '#ff6b8a');
    g.addColorStop(1, '#d81b55');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();
    // knit stripes
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.05;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 0.3, -0.5);
      ctx.quadraticCurveTo(i * 0.22, -0.85, i * 0.12, -1.02);
      ctx.stroke();
    }
    // brim
    roundRectPath(ctx, -0.98, -0.6, 1.96, 0.3, 0.15);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.06;
    ctx.stroke();
    ctx.fillStyle = '#cfe9ff';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.arc(-0.8 + i * 0.267, -0.45, 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    // pompom
    ctx.beginPath();
    ctx.arc(0, -1.12, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
}

/** Ice block texture, tiles horizontally (64x16 logical). */
function iceTilePainter(top: string, body: string, deep: string): Painter {
  return (ctx, w, h): void => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top);
    g.addColorStop(0.35, body);
    g.addColorStop(1, deep);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // block seams at both ends so the tile repeats cleanly
    ctx.fillStyle = 'rgba(20, 40, 90, 0.28)';
    ctx.fillRect(0, h * 0.3, 1.2, h * 0.7);
    ctx.fillRect(w / 2, h * 0.3, 1.2, h * 0.7);
    // shine streaks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w * 0.1, h * 0.75);
    ctx.lineTo(w * 0.22, h * 0.45);
    ctx.moveTo(w * 0.6, h * 0.8);
    ctx.lineTo(w * 0.7, h * 0.5);
    ctx.stroke();
    // snow cap
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h * 0.22);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(w * (0.12 + i * 0.25), h * 0.22, w * 0.08, h * 0.12, 0, 0, Math.PI);
      ctx.fill();
    }
  };
}

/** Vertical ice pillar texture for the side walls (tiles vertically). */
const wallPainter: Painter = (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#5b8fd9');
  g.addColorStop(0.5, '#bfe6ff');
  g.addColorStop(1, '#4a78c4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(20, 40, 100, 0.3)';
  for (let y = 0; y < h; y += h / 4) ctx.fillRect(0, y, w, 1.5);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let y = 0; y < h; y += h / 4) {
    ctx.moveTo(w * 0.3, y + h * 0.05);
    ctx.lineTo(w * 0.45, y + h * 0.16);
  }
  ctx.stroke();
};

/** Stars of the placeholder parallax layer: [x, y, r] in shares of the tile. */
const BG_STARS: ReadonlyArray<readonly [number, number, number]> = [
  [0.08, 0.06, 1.6], [0.3, 0.12, 1.1], [0.62, 0.05, 1.8], [0.9, 0.15, 1.2], [0.2, 0.26, 1.4],
  [0.75, 0.3, 1.0], [0.45, 0.36, 1.7], [0.05, 0.45, 1.1], [0.92, 0.48, 1.6], [0.35, 0.55, 1.0],
  [0.6, 0.62, 1.5], [0.15, 0.7, 1.8], [0.82, 0.72, 1.1], [0.48, 0.8, 1.3], [0.27, 0.9, 1.0],
  [0.7, 0.92, 1.7], [0.95, 0.86, 1.0], [0.55, 0.2, 1.0], [0.4, 0.68, 1.1], [0.1, 0.94, 1.4],
];
/** Ice crystals of the placeholder parallax layer: [x, y, size]. */
const BG_CRYSTALS: ReadonlyArray<readonly [number, number, number]> = [
  [0.18, 0.17, 18], [0.82, 0.4, 26], [0.3, 0.62, 14], [0.74, 0.82, 20], [0.5, 0.9, 10],
];

/**
 * The placeholder parallax pattern (stars + ice crystals) drawn as vectors into the
 * box (0,0)-(w,h): two batched paths. The game draws it live instead of blitting a
 * full-screen transparent picture, which cost ~16 ms a frame on a slow phone.
 */
export function drawBgPattern(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  for (const [x, y, r] of BG_STARS) {
    ctx.moveTo(x * w + r, y * h);
    ctx.arc(x * w, y * h, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 235, 255, 0.2)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [x, y, size] of BG_CRYSTALS) {
    const cx = x * w;
    const cy = y * h;
    for (let i = 0; i < 6; i++) {
      const a = ((i + 1) * Math.PI) / 3;
      const dx = Math.sin(a);
      const dy = -Math.cos(a);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx * size, cy + dy * size);
      // two little barbs at 55% of the arm
      const bx = cx + dx * size * 0.55;
      const by = cy + dy * size * 0.55;
      const px = -dy * size * 0.22;
      const py = dx * size * 0.22;
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + dx * size * 0.2 - px, by + dy * size * 0.2 - py);
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + dx * size * 0.2 + px, by + dy * size * 0.2 + py);
    }
  }
  ctx.stroke();
}

/** Transparent parallax layer: stars and ice crystals; tiles vertically (nothing crosses the top / bottom edge). */
const bgPainter: Painter = (ctx, w, h) => drawBgPattern(ctx, w, h);

export interface IcyArt {
  readonly face: Drawable;
  readonly faceJump: Drawable;
  readonly faceFall: Drawable;
  readonly platform: Drawable;
  readonly milestone: Drawable;
  readonly wall: Drawable;
  readonly bg: Drawable;
  /** UI sprites (not replaceable). */
  readonly finger: Drawable;
  readonly glow: Drawable;
}

const fingerPainter: Painter = (ctx, w, h) => {
  // a rounded "ghost finger": fingertip pointing down with a soft shadow
  ctx.save();
  ctx.translate(w / 2, h / 2);
  const s = Math.min(w, h) / 100;
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  roundRectPath(ctx, -15, -40, 34, 86, 17);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  roundRectPath(ctx, -18, -44, 34, 86, 17);
  ctx.fill();
  ctx.stroke();
  // nail
  ctx.fillStyle = '#ffd6e0';
  roundRectPath(ctx, -10, 14, 18, 20, 8);
  ctx.fill();
  ctx.restore();
};

const glowPainter: Painter = (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  g.addColorStop(0.4, 'rgba(180, 235, 255, 0.35)');
  g.addColorStop(1, 'rgba(180, 235, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};

export async function loadIcyArt(): Promise<IcyArt> {
  const a = await loadAssets('icy', [
    { key: 'face', file: 'face.png', size: FACE_BOX, placeholder: beanieFace('happy') },
    { key: 'faceJump', file: 'face_jump.png', size: FACE_BOX, placeholder: beanieFace('laughing') },
    { key: 'faceFall', file: 'face_fall.png', size: FACE_BOX, placeholder: beanieFace('shocked') },
    { key: 'platform', file: 'platform.png', size: 64, height: 16, fit: 'cover', placeholder: iceTilePainter('#e8f7ff', '#8fd3ff', '#3f7fd6') },
    {
      key: 'milestone',
      file: 'milestone.png',
      size: 64,
      height: 16,
      fit: 'cover',
      placeholder: iceTilePainter('#fff6d6', '#ffd23f', shade('#ff8a3d', -0.1)),
    },
    { key: 'wall', file: 'wall.png', size: 16, height: 128, fit: 'cover', placeholder: wallPainter },
    { key: 'bg', file: 'bg.png', size: 360, height: 640, fit: 'cover', placeholder: bgPainter },
  ]);
  return {
    face: a.face,
    faceJump: a.faceJump,
    faceFall: a.faceFall,
    platform: a.platform,
    milestone: a.milestone,
    wall: a.wall,
    bg: a.bg,
    finger: paintDrawable('finger', fingerPainter, 64, 64),
    glow: paintDrawable('glow', glowPainter, 64, 64),
  };
}
