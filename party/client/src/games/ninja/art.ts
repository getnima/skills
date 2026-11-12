/**
 * Art of נינג׳ה תבורי. Every replaceable picture is a kit file slot under
 * client/public/assets/ninja/ (see the README there). The golden target defaults to a gold
 * star sticker wearing one of three of the owner's party accessories
 * (client/public/assets/shimi/prop_*.png); without those files it is a gold coin. The bomb's
 * fuse, its sparks, the warning burst and the blade are drawn in code by the game, so they
 * survive an art swap. Everything else the game shows (the stage, juice splats, halves, UI
 * stickers) is pre-rendered once here so the hot path only calls drawImage.
 *
 * Style: the party look (shimi/README.md): flat colours, thick ink outlines, hard highlights,
 * no soft glows.
 */
import { drawFace, loadAssets, paintDrawable, shade } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';
import { KABOOM, PAL, STAR10, halftone, makeLayer, polyPath, stickerShape } from './look';

import type { Drawable, Painter } from '../../kit/assets';

/** Logical box of a target / bomb slot in CSS px (pre-rendered at 2x = 256px). */
export const SPRITE_BOX = 128;
/** Share of the box the round body covers (radius / box), for hit tests and halves. */
export const BODY_RADIUS = 0.42;

const INK = PAL.ink;

export type Inside = 'melon' | 'citrus' | 'apple' | 'stone' | 'arils' | 'berry' | 'gold';

export interface FruitStyle {
  /** Juice color of the splash and the cut edge. */
  readonly juice: string;
  /** Lighter flesh color shown on the cut face. */
  readonly flesh: string;
  /** Skin / rind colour around the cut face. */
  readonly rind: string;
  /** What the cut face shows. */
  readonly inside: Inside;
}

/**
 * Juice and inside of the owner's target_N files (index = variant): watermelon, orange,
 * lemon, pomegranate, strawberry. Change here if other pictures go into those slots.
 */
export const FRUIT_STYLES: readonly FruitStyle[] = [
  { juice: '#ff3b5c', flesh: '#ff6f86', rind: '#2fb35a', inside: 'melon' }, // watermelon
  { juice: '#ff9a1f', flesh: '#ffc061', rind: '#ff9a1f', inside: 'citrus' }, // orange
  { juice: '#ffe03d', flesh: '#fff3a0', rind: '#ffd400', inside: 'citrus' }, // lemon
  { juice: '#d7193f', flesh: '#fbe7c6', rind: '#9e1530', inside: 'arils' }, // pomegranate
  { juice: '#ff2e4d', flesh: '#ff7a8c', rind: '#e8202f', inside: 'berry' }, // strawberry
];
/** Juice and inside of the drawn fallbacks (when a target_N file is missing). */
export const PLACEHOLDER_STYLES: readonly FruitStyle[] = [
  { juice: '#ff3b5c', flesh: '#ff6f86', rind: '#2fb35a', inside: 'melon' }, // watermelon
  { juice: '#ff9a1f', flesh: '#ffc061', rind: '#ff9a1f', inside: 'citrus' }, // orange
  { juice: '#ff4d3d', flesh: '#fff1d6', rind: '#ff3d3d', inside: 'apple' }, // apple
  { juice: '#a347ff', flesh: '#e8d36a', rind: '#8b3dff', inside: 'stone' }, // plum
  { juice: '#ffe03d', flesh: '#fff3a0', rind: '#ffd400', inside: 'citrus' }, // lemon
];
export const GOLD_STYLE: FruitStyle = { juice: '#ffd23f', flesh: '#fff3b0', rind: '#e6a100', inside: 'gold' };

type Mood = 'smile' | 'oh' | 'grin' | 'tongue' | 'cheeky';

/** Tiny cute face on a fruit, in unit space (body radius = 1). */
function fruitFace(ctx: CanvasRenderingContext2D, mood: Mood, dx = 0, dy = 0.08): void {
  ctx.save();
  ctx.translate(dx, dy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // eyes
  for (const ex of [-0.3, 0.3]) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    if (mood === 'cheeky' && ex > 0) {
      ctx.lineWidth = 0.09;
      ctx.strokeStyle = INK;
      ctx.moveTo(ex - 0.12, -0.12);
      ctx.quadraticCurveTo(ex, -0.24, ex + 0.12, -0.12);
      ctx.stroke();
      continue;
    }
    ctx.ellipse(ex, -0.12, 0.1, 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex - 0.03, -0.17, 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
  // cheeks
  ctx.fillStyle = 'rgba(255, 80, 120, 0.45)';
  ctx.beginPath();
  ctx.ellipse(-0.5, 0.08, 0.13, 0.08, 0, 0, Math.PI * 2);
  ctx.ellipse(0.5, 0.08, 0.13, 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  // mouth
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#5a1030';
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  switch (mood) {
    case 'smile':
    case 'cheeky':
      ctx.moveTo(-0.17, 0.12);
      ctx.quadraticCurveTo(0, 0.3, 0.17, 0.12);
      ctx.stroke();
      break;
    case 'oh':
      ctx.ellipse(0, 0.2, 0.09, 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'grin':
      ctx.moveTo(-0.22, 0.1);
      ctx.quadraticCurveTo(0, 0.42, 0.22, 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'tongue':
      ctx.moveTo(-0.18, 0.12);
      ctx.quadraticCurveTo(0, 0.28, 0.18, 0.12);
      ctx.stroke();
      ctx.fillStyle = '#ff6b8f';
      ctx.beginPath();
      ctx.ellipse(0.04, 0.27, 0.08, 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 0.04;
      ctx.stroke();
      break;
    default: {
      const never: never = mood;
      throw new Error(`Unhandled mood: ${String(never)}`);
    }
  }
  ctx.restore();
}

/** Runs `paint` in unit space: (0,0) = box center, 1 = body radius. */
function unit(paint: (ctx: CanvasRenderingContext2D) => void): Painter {
  return (ctx, w, h) => {
    const r = Math.min(w, h) * BODY_RADIUS;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(r, r);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    paint(ctx);
    ctx.restore();
  };
}

/** Flat comic body: base colour, a darker crescent bottom-right, ink outline. */
function body(ctx: CanvasRenderingContext2D, color: string, rx = 1, ry = 1): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shade(color, -0.28);
  ctx.beginPath();
  ctx.ellipse(0.32 * rx, 0.38 * ry, rx * 1.02, ry * 0.98, 0, 0, Math.PI * 2);
  ctx.ellipse(-0.1 * rx, -0.08 * ry, rx * 1.05, ry * 1.02, 0, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** Hard white highlight (flat shapes, no gradient). */
function shine(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(-0.44, -0.5, 0.22, 0.11, -0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-0.66, -0.22, 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color = '#3ddc84'): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(0.22, -0.2, 0.46, 0);
  ctx.quadraticCurveTo(0.22, 0.2, 0, 0);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

const watermelon = unit((ctx) => {
  body(ctx, '#2fb35a');
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, 0.95, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = '#13702f';
  ctx.lineWidth = 0.14;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 0.36, -1.1);
    ctx.bezierCurveTo(i * 0.36 + 0.16, -0.4, i * 0.36 - 0.16, 0.4, i * 0.36, 1.1);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.stroke();
  shine(ctx);
  fruitFace(ctx, 'grin');
});

const orange = unit((ctx) => {
  body(ctx, '#ff9a1f');
  ctx.fillStyle = 'rgba(160, 70, 0, 0.35)';
  const dots = [
    [-0.55, -0.2],
    [0.6, -0.3],
    [-0.2, 0.62],
    [0.45, 0.55],
    [-0.62, 0.35],
    [0.15, -0.7],
    [0.7, 0.18],
  ] as const;
  for (const [x, y] of dots) {
    ctx.beginPath();
    ctx.arc(x, y, 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  shine(ctx);
  leaf(ctx, 0.05, -0.95, -0.5);
  fruitFace(ctx, 'smile');
});

const apple = unit((ctx) => {
  // two-lobed apple outline
  const outline = (): void => {
    ctx.beginPath();
    ctx.moveTo(0, -0.7);
    ctx.bezierCurveTo(0.5, -1.05, 1.08, -0.7, 0.98, 0.05);
    ctx.bezierCurveTo(0.9, 0.7, 0.45, 1.02, 0, 0.88);
    ctx.bezierCurveTo(-0.45, 1.02, -0.9, 0.7, -0.98, 0.05);
    ctx.bezierCurveTo(-1.08, -0.7, -0.5, -1.05, 0, -0.7);
    ctx.closePath();
  };
  outline();
  ctx.fillStyle = '#ff3d3d';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#c81e22';
  ctx.beginPath();
  ctx.ellipse(0.42, 0.45, 1, 0.95, 0, 0, Math.PI * 2);
  ctx.ellipse(-0.06, -0.06, 1.02, 1, 0, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
  outline();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.1;
  ctx.stroke();
  // stem
  ctx.strokeStyle = '#6b3b1a';
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  ctx.moveTo(0, -0.7);
  ctx.quadraticCurveTo(0.04, -0.95, 0.14, -1.06);
  ctx.stroke();
  leaf(ctx, 0.1, -0.92, -0.25);
  shine(ctx);
  fruitFace(ctx, 'oh', 0, 0.12);
});

const plum = unit((ctx) => {
  body(ctx, '#8b3dff', 0.94, 1);
  ctx.strokeStyle = 'rgba(40, 0, 80, 0.55)';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(0.1, -0.95);
  ctx.quadraticCurveTo(0.45, -0.2, 0.2, 0.9);
  ctx.stroke();
  shine(ctx);
  leaf(ctx, -0.02, -0.98, -2.6, '#2fbf6a');
  fruitFace(ctx, 'tongue', -0.12);
});

const lemon = unit((ctx) => {
  // pointy ends
  ctx.fillStyle = '#ffd400';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  ctx.ellipse(-1.02, 0, 0.15, 0.11, 0, 0, Math.PI * 2);
  ctx.ellipse(1.02, 0, 0.15, 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  body(ctx, '#ffe03d', 1, 0.8);
  ctx.fillStyle = 'rgba(180, 130, 0, 0.3)';
  for (const [x, y] of [
    [-0.5, 0.35],
    [0.55, -0.3],
    [0.3, 0.5],
    [-0.65, -0.1],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
  shine(ctx);
  fruitFace(ctx, 'cheeky', 0, 0.02);
});

/** The gold coin (used when neither target_gold.png nor the party props exist). */
const goldPainter = unit((ctx) => {
  ctx.fillStyle = PAL.yel;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAL.org;
  ctx.beginPath();
  ctx.ellipse(0.35, 0.4, 1, 0.95, 0, 0, Math.PI * 2);
  ctx.ellipse(-0.06, -0.06, 1.02, 1, 0, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.arc(0, 0, 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = PAL.yel2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? 0.58 : 0.25;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  shine(ctx);
});

/**
 * Bomb body with a face window in the middle (the real art puts the hosts' faces there; the
 * placeholder is a generic cartoon face). No fuse: the game draws fuse + sparks on top.
 */
const bombPainter = unit((ctx) => {
  ctx.fillStyle = '#26212f';
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#0b0912';
  ctx.beginPath();
  ctx.ellipse(0.35, 0.42, 1, 0.95, 0, 0, Math.PI * 2);
  ctx.ellipse(-0.06, -0.06, 1.02, 1, 0, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.stroke();
  // face window: red ring, ink outline
  ctx.fillStyle = PAL.red;
  ctx.beginPath();
  ctx.arc(0, 0.06, 0.68, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.07;
  ctx.stroke();
  drawFace(ctx, 0, 0.06, 0.56, 'laughing', '#ffc79a');
  // hard highlight
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.arc(0, 0, 0.84, Math.PI * 1.12, Math.PI * 1.36);
  ctx.stroke();
});

/** The slot placeholder of background.jpg (unused: the game paints its stage at device pixels). */
const backgroundPainter: Painter = (ctx, w, h) => {
  ctx.fillStyle = PAL.cobD;
  ctx.fillRect(0, 0, w, h);
};

/**
 * The stage (painted once per canvas size, straight at device pixels): a cobalt TV-show stage
 * with a faint sunburst, a halftone vignette, red side curtains, a string of light bulbs and
 * a stage floor with marquee bulbs. Dark in the middle so bright fruit pops.
 */
export function paintStage(ctx: CanvasRenderingContext2D, w: number, h: number, top: number): void {
  const cx = w / 2;
  const cy = top + (h - top) * 0.42;
  ctx.fillStyle = PAL.cobD;
  ctx.fillRect(0, 0, w, h);
  // sunburst hint
  ctx.fillStyle = '#14299e';
  ctx.beginPath();
  const n = 28;
  const R = Math.hypot(w, h);
  for (let i = 0; i < n; i += 2) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
    ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
    ctx.closePath();
  }
  ctx.fill();
  // halftone vignette (dots grow towards the edges)
  const maxD = Math.hypot(w / 2, h / 2);
  halftone(ctx, 0, 0, w, h, 11, 'rgba(6, 10, 50, 0.55)', (u, v) => {
    const d = Math.hypot((u - 0.5) * w, (v - 0.45) * h) / maxD;
    return (d - 0.38) * 2.1;
  });
  // stage floor
  const fy = h * 0.88;
  ctx.fillStyle = PAL.cob;
  ctx.fillRect(0, fy, w, h - fy);
  ctx.strokeStyle = 'rgba(22, 18, 14, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -6; i <= 6; i++) {
    ctx.moveTo(cx + i * w * 0.09, fy);
    ctx.lineTo(cx + i * w * 0.2, h);
  }
  ctx.stroke();
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, fy - 2, w, 4);
  ctx.fillStyle = PAL.red;
  ctx.fillRect(0, fy + 2, w, Math.max(10, h * 0.018));
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, fy + 2 + Math.max(10, h * 0.018), w, 3);
  // marquee bulbs on the stage edge
  const bulbs = (y: number, r: number, gap: number, colors: readonly string[]): void => {
    let k = 0;
    for (let x = gap / 2; x < w; x += gap, k++) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = colors[k % colors.length] ?? PAL.yel;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = PAL.ink;
      ctx.stroke();
    }
  };
  bulbs(fy + 2 + Math.max(10, h * 0.018) / 2, Math.max(3, h * 0.0045), Math.max(18, w * 0.055), [PAL.yel, PAL.white]);
  // string lights across the top, under the HUD
  const sy = top + (h - top) * 0.05;
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, sy);
  ctx.quadraticCurveTo(w / 2, sy + h * 0.07, w, sy);
  ctx.stroke();
  const lights = [PAL.yel, PAL.pink, PAL.white, PAL.org];
  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    const x = t * w;
    const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * (sy + h * 0.07) + t * t * sy;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x - 2.5, y, 5, 5);
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 5, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = lights[i % lights.length] ?? PAL.yel;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // side curtains
  const cw = Math.max(14, w * 0.055);
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 0 : w - cw;
    ctx.fillStyle = PAL.red;
    ctx.fillRect(x0, 0, cw, fy);
    ctx.fillStyle = PAL.redD;
    for (let k = 0; k < 3; k++) ctx.fillRect(x0 + (k + 0.55) * (cw / 3), 0, cw / 9, fy);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(side === 0 ? cw - 1.5 : w - cw - 1.5, 0, 3, fy);
  }
}

/** Soft round glow kept for the ghost hint only (UI, not part of the stage). */
function dotPainter(color: string): Painter {
  return (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
}

/** Ghost hand of the opening hint: a white glove pointing finger. */
const handPainter: Painter = (ctx, w, h) => {
  const s = Math.min(w, h) / 100;
  ctx.save();
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  // finger (tip at 30, 8)
  roundRectPath(ctx, 22, 6, 17, 48, 8.5);
  ctx.fill();
  ctx.stroke();
  // palm + folded fingers
  ctx.beginPath();
  ctx.moveTo(22, 46);
  ctx.quadraticCurveTo(10, 50, 14, 68);
  ctx.quadraticCurveTo(18, 90, 44, 92);
  ctx.quadraticCurveTo(72, 92, 76, 70);
  ctx.quadraticCurveTo(80, 50, 66, 46);
  ctx.quadraticCurveTo(58, 40, 50, 46);
  ctx.quadraticCurveTo(44, 40, 38, 46);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(50, 46);
  ctx.lineTo(50, 60);
  ctx.moveTo(62, 47);
  ctx.lineTo(62, 60);
  ctx.stroke();
  ctx.restore();
};

/** Golden target skins from the owner's party props (used when target_gold.png is not dropped in). */
const GOLD_PROPS = [
  { key: 'crown', file: 'prop_08_crown.png' },
  { key: 'party', file: 'prop_17_party_hat.png' },
  { key: 'hearts', file: 'prop_09_heart_glasses.png' },
] as const;

/** A gold disc (body-sized, flat, ink outlined) wearing a party prop. */
function goldSkin(key: string, prop: Drawable): Drawable {
  return paintDrawable(
    `gold_${key}`,
    (ctx, w, h) => {
      const r = Math.min(w, h) * BODY_RADIUS;
      const cx = w / 2;
      const cy = h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = PAL.yel;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = PAL.org;
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.35, cy + r * 0.4, r, r * 0.95, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - r * 0.06, cy - r * 0.06, r * 1.02, r, 0, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
      ctx.lineWidth = Math.max(3, r * 0.1);
      ctx.strokeStyle = PAL.ink;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = Math.max(2, r * 0.05);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      const k = Math.min((r * 1.75) / prop.width, (r * 1.5) / prop.height);
      prop.draw(ctx, cx, cy + r * 0.02, prop.width * k, prop.height * k, -0.12);
      // hard highlight
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.5, cy - r * 0.6, r * 0.2, r * 0.09, -0.7, 0, Math.PI * 2);
      ctx.fill();
    },
    SPRITE_BOX,
  );
}

export interface NinjaArt {
  /** target_1..target_5, index = Throw.variant. */
  readonly targets: readonly Drawable[];
  /** Juice / inside per target (the owner's file style, or the drawn fallback's). */
  readonly styles: readonly FruitStyle[];
  /** The golden target's looks (one is picked per throw, by its id: looks only). */
  readonly golds: readonly Drawable[];
  readonly bomb: Drawable;
  readonly background: Drawable;
  readonly hand: Drawable;
  /** UI sprites (pre-rendered, not replaceable). */
  readonly sunburst: HTMLCanvasElement;
  readonly kaboom: HTMLCanvasElement;
  readonly spark: HTMLCanvasElement;
  readonly coin: Drawable;
  /** Which ninja slots hold a real file. */
  readonly real: Readonly<Record<string, boolean>>;
}

/** Yellow / orange rays (behind the golden target), 128 x 128 CSS px. */
function renderSunburst(): HTMLCanvasElement {
  const { canvas, ctx } = makeLayer(128, 128);
  if (!ctx) return canvas;
  const c = 64;
  ctx.beginPath();
  for (let i = 0; i < 16; i += 2) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = ((i + 1) / 16) * Math.PI * 2;
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a0) * 62, c + Math.sin(a0) * 62);
    ctx.lineTo(c + Math.cos(a1) * 62, c + Math.sin(a1) * 62);
    ctx.closePath();
  }
  ctx.fillStyle = PAL.yel;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = PAL.ink;
  ctx.stroke();
  return canvas;
}

export async function loadNinjaArt(): Promise<NinjaArt> {
  const [a, p] = await Promise.all([
    loadAssets('ninja', [
      { key: 'target_1', file: 'target_1.png', size: SPRITE_BOX, placeholder: watermelon },
      { key: 'target_2', file: 'target_2.png', size: SPRITE_BOX, placeholder: orange },
      { key: 'target_3', file: 'target_3.png', size: SPRITE_BOX, placeholder: apple },
      { key: 'target_4', file: 'target_4.png', size: SPRITE_BOX, placeholder: plum },
      { key: 'target_5', file: 'target_5.png', size: SPRITE_BOX, placeholder: lemon },
      { key: 'target_gold', file: 'target_gold.png', size: SPRITE_BOX, placeholder: goldPainter },
      { key: 'bomb', file: 'bomb.png', size: SPRITE_BOX, placeholder: bombPainter },
      { key: 'background', file: 'background.jpg', size: 430, height: 932, fit: 'cover', placeholder: backgroundPainter },
    ]),
    loadAssets(
      'shimi',
      GOLD_PROPS.map((g) => ({ key: g.key, file: g.file, size: 96, placeholder: (): void => undefined })),
    ),
  ]);
  const real: Record<string, boolean> = {};
  for (const [k, d] of Object.entries(a)) real[k] = !d.isPlaceholder;
  let golds: Drawable[] = [a.target_gold];
  if (a.target_gold.isPlaceholder) {
    const skins = GOLD_PROPS.map((g) => p[g.key]).filter((d): d is Drawable => !!d && !d.isPlaceholder);
    if (skins.length > 0) golds = skins.map((d) => goldSkin(d.key, d));
  }
  // the warning burst behind a bomb: red kaboom with an ink outline
  const kb = makeLayer(128, 128);
  if (kb.ctx) {
    stickerShape(kb.ctx, KABOOM, 4, 4, 116, 116, PAL.yel, PAL.ink, 3);
    kb.ctx.translate(64, 64);
    kb.ctx.rotate(0.3);
    stickerShape(kb.ctx, KABOOM, -46, -46, 92, 92, PAL.red, PAL.redD, 2.5);
    kb.ctx.setTransform(2, 0, 0, 2, 0, 0);
  }
  // fuse spark: small yellow star
  const sp = makeLayer(48, 48);
  if (sp.ctx) {
    polyPath(sp.ctx, STAR10, 3, 3, 42, 42);
    sp.ctx.fillStyle = PAL.yel;
    sp.ctx.fill();
    sp.ctx.lineWidth = 2.5;
    sp.ctx.strokeStyle = PAL.ink;
    sp.ctx.stroke();
    sp.ctx.beginPath();
    sp.ctx.arc(24, 24, 6, 0, Math.PI * 2);
    sp.ctx.fillStyle = '#ffffff';
    sp.ctx.fill();
  }
  const targets = [a.target_1, a.target_2, a.target_3, a.target_4, a.target_5];
  return {
    targets,
    styles: targets.map((d, i) => (d.isPlaceholder ? PLACEHOLDER_STYLES[i] : FRUIT_STYLES[i]) ?? GOLD_STYLE),
    golds,
    bomb: a.bomb,
    background: a.background,
    hand: paintDrawable('hand', handPainter, 100),
    sunburst: renderSunburst(),
    kaboom: kb.canvas,
    spark: sp.canvas,
    coin: paintDrawable('coin', dotPainter(PAL.yel), 32),
    real,
  };
}

/**
 * The backdrop pre-scaled once to the canvas' device pixels and then copied 1:1 every
 * frame. A cover-scaled drawImage of a full-screen picture is a resample of every pixel
 * every frame: on a slow phone that alone cost a whole frame (measured at CPU 4x).
 * Redrawn only when the canvas size changes. Draw it first, outside any shake. Without a
 * real background file the stage is painted straight at device pixels (crisp halftone).
 */
export interface Backdrop {
  draw(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, top: number): void;
  dispose(): void;
}

export function createBackdrop(bg: Drawable, overscale = 1): Backdrop {
  let cache: HTMLCanvasElement | null = null;
  let cw = 0;
  let ch = 0;
  return {
    draw(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, top: number): void {
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (!cache || pw !== cw || ph !== ch) {
        cache ??= document.createElement('canvas');
        cw = pw;
        ch = ph;
        cache.width = pw;
        cache.height = ph;
        const c = cache.getContext('2d');
        if (c) {
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (bg.isPlaceholder) paintStage(c, w, h, top);
          else {
            const k = Math.max(w / bg.width, h / bg.height) * overscale;
            bg.draw(c, w / 2, h / 2, bg.width * k, bg.height * k);
          }
        }
      }
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(cache, 0, 0);
      g.restore();
    },
    dispose(): void {
      if (cache) {
        cache.width = 0;
        cache.height = 0;
      }
      cache = null;
    },
  };
}

/** The cut face: rind ring, flesh and the inside pattern of `style`, centred, rx x ry. */
function cutFace(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, style: FruitStyle): void {
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = style.inside === 'melon' ? '#e9fbe3' : style.rind;
  g.fill();
  g.lineWidth = Math.max(3, rx * 0.06);
  g.strokeStyle = INK;
  g.stroke();
  const fx = rx * (style.inside === 'melon' ? 0.84 : 0.88);
  const fy = ry * (style.inside === 'melon' ? 0.76 : 0.82);
  g.beginPath();
  g.ellipse(cx, cy, fx, fy, 0, 0, Math.PI * 2);
  g.fillStyle = style.flesh;
  g.fill();
  g.save();
  g.clip();
  switch (style.inside) {
    case 'melon': {
      g.fillStyle = INK;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3;
        const d = i % 2 === 0 ? 0.55 : 0.3;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * fx * d, cy + Math.sin(a) * fy * d, rx * 0.045, ry * 0.12, a, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'citrus': {
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(2, rx * 0.035);
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * fx, cy + Math.sin(a) * fy);
      }
      g.stroke();
      g.fillStyle = shade(style.juice, 0.15);
      for (let i = 0; i < 10; i++) {
        const a = ((i + 0.5) / 10) * Math.PI * 2;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * fx * 0.55, cy + Math.sin(a) * fy * 0.55, rx * 0.12, ry * 0.18, a, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.ellipse(cx, cy, rx * 0.1, ry * 0.18, 0, 0, Math.PI * 2);
      g.fillStyle = '#ffffff';
      g.fill();
      break;
    }
    case 'apple': {
      g.strokeStyle = 'rgba(160, 110, 40, 0.6)';
      g.lineWidth = Math.max(2, rx * 0.03);
      g.beginPath();
      g.ellipse(cx, cy, fx * 0.42, fy * 0.5, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#6b3b1a';
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(cx + s * fx * 0.17, cy, rx * 0.06, ry * 0.16, s * 0.4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'stone': {
      g.beginPath();
      g.ellipse(cx, cy, fx * 0.36, fy * 0.5, 0, 0, Math.PI * 2);
      g.fillStyle = '#8a4b1c';
      g.fill();
      g.lineWidth = Math.max(2, rx * 0.035);
      g.strokeStyle = INK;
      g.stroke();
      break;
    }
    case 'arils': {
      // white membrane, packed ruby seeds
      g.fillStyle = '#c4122f';
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2 + j * 0.35;
          const d = 0.2 + j * 0.2;
          g.beginPath();
          g.ellipse(cx + Math.cos(a) * fx * d, cy + Math.sin(a) * fy * d, rx * 0.075, ry * 0.17, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.fillStyle = 'rgba(255, 255, 255, 0.7)';
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.35;
        g.fillRect(cx + Math.cos(a) * fx * 0.4 - 2, cy + Math.sin(a) * fy * 0.4 - 2, 4, 3);
      }
      break;
    }
    case 'berry': {
      // pale heart and white veins towards the rim
      g.beginPath();
      g.ellipse(cx, cy, fx * 0.45, fy * 0.5, 0, 0, Math.PI * 2);
      g.fillStyle = '#ffd3da';
      g.fill();
      g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      g.lineWidth = Math.max(2, rx * 0.025);
      g.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a) * fx * 0.45, cy + Math.sin(a) * fy * 0.5);
        g.lineTo(cx + Math.cos(a) * fx * 0.92, cy + Math.sin(a) * fy * 0.92);
      }
      g.stroke();
      break;
    }
    case 'gold': {
      g.fillStyle = '#ffffff';
      polyPath(g, STAR10, cx - rx * 0.32, cy - ry * 0.55, rx * 0.64, ry * 1.1);
      g.fill();
      break;
    }
    default: {
      const never: never = style.inside;
      throw new Error(`Unhandled inside: ${String(never)}`);
    }
  }
  // juice highlight
  g.fillStyle = 'rgba(255, 255, 255, 0.75)';
  g.beginPath();
  g.ellipse(cx - fx * 0.45, cy - fy * 0.35, fx * 0.18, fy * 0.14, -0.3, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/**
 * The two halves of a sliced target, pre-cut once along the picture's own horizontal
 * axis, each showing the whole juicy cut face (rind, flesh, seeds / segments / stone):
 * [upper half, lower half], each a canvas of the full sprite box at 2x. Drawing a half is
 * then one rotated drawImage, not a clip per half per frame.
 */
export function buildHalves(d: Drawable, style: FruitStyle): readonly [HTMLCanvasElement, HTMLCanvasElement] {
  const S = SPRITE_BOX * 2;
  const make = (upper: boolean): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    if (!g) return c;
    g.save();
    g.beginPath();
    g.rect(0, upper ? 0 : S / 2, S, S / 2);
    g.clip();
    d.draw(g, S / 2, S / 2, S, S);
    g.restore();
    const rx = S * BODY_RADIUS * 0.94;
    const ry = S * BODY_RADIUS * 0.34;
    // the face leans towards the viewer: the upper half shows it below its cut, the lower above
    cutFace(g, S / 2, S / 2 + (upper ? ry * 0.15 : -ry * 0.15), rx, ry, style);
    return c;
  };
  return [make(true), make(false)];
}

/** Juice splat decals: flat comic blobs with an ink outline, `count` shapes in `color`, 96 x 96 CSS px each. */
export function buildSplats(color: string, count: number): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let s = 0; s < count; s++) {
    const { canvas, ctx } = makeLayer(96, 96);
    if (ctx) {
      const blob = (k: number, ox: number, oy: number): void => {
        ctx.beginPath();
        const n = 9 + s * 2;
        for (let i = 0; i <= n * 2; i++) {
          const a = (i / (n * 2)) * Math.PI * 2;
          const wob = i % 2 === 0 ? 1 : 0.62 + 0.18 * Math.sin(i * 1.7 + s);
          const r = 30 * k * wob * (1 + 0.12 * Math.sin(a * 3 + s * 2));
          const x = 48 + ox + Math.cos(a) * r;
          const y = 48 + oy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.quadraticCurveTo(48 + ox + Math.cos(a - 0.15) * r * 1.08, 48 + oy + Math.sin(a - 0.15) * r * 1.08, x, y);
        }
        ctx.closePath();
      };
      blob(1, 0, 0);
      // drops around the blob
      for (let i = 0; i < 5; i++) {
        const a = i * 1.37 + s;
        const d = 36 + (i % 2) * 6;
        ctx.moveTo(48 + Math.cos(a) * d + 4 + (i % 3), 48 + Math.sin(a) * d);
        ctx.arc(48 + Math.cos(a) * d, 48 + Math.sin(a) * d, 4 + (i % 3), 0, Math.PI * 2);
      }
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = PAL.ink;
      ctx.stroke();
      // a lighter inner pool
      blob(0.45, -6, -6);
      ctx.fillStyle = shade(color, 0.3);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(36, 36, 6, 3.5, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fill();
    }
    out.push(canvas);
  }
  return out;
}
