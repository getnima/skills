/**
 * Art of נינג׳ה תבורי. Every replaceable picture is a kit file slot under
 * client/public/assets/ninja/ (see the README there). The bomb's fuse, its
 * sparks, the warning glow and the blade are drawn in code by the game, so
 * they survive an art swap. UI sprites (glows, ghost hand) are pre-rendered
 * once here so the hot path only calls drawImage.
 */
import { drawFace, loadAssets, paintDrawable, shade } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';

import type { Drawable, Painter } from '../../kit/assets';

/** Logical box of a target / bomb slot in CSS px (pre-rendered at 2x = 256px). */
export const SPRITE_BOX = 128;
/** Share of the box the round body covers (radius / box), for hit tests and halves. */
export const BODY_RADIUS = 0.42;

const INK = '#2b1436';

export interface FruitStyle {
  /** Juice color of the splash and the cut edge. */
  readonly juice: string;
  /** Lighter flesh color shown on the cut edge. */
  readonly flesh: string;
}

/** Juice per target_N (index = variant). Stays when real art replaces the placeholder. */
export const FRUIT_STYLES: readonly FruitStyle[] = [
  { juice: '#ff3b5c', flesh: '#ff8fa3' }, // watermelon
  { juice: '#ff9a1f', flesh: '#ffd08a' }, // orange
  { juice: '#ff4d3d', flesh: '#fff1d6' }, // apple
  { juice: '#a347ff', flesh: '#e2b8ff' }, // plum
  { juice: '#ffe03d', flesh: '#fff6b8' }, // lemon
];
export const GOLD_STYLE: FruitStyle = { juice: '#ffd23f', flesh: '#fff3b0' };

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
      ctx.lineWidth = 0.08;
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
  ctx.fillStyle = 'rgba(255, 80, 120, 0.4)';
  ctx.beginPath();
  ctx.ellipse(-0.5, 0.08, 0.13, 0.08, 0, 0, Math.PI * 2);
  ctx.ellipse(0.5, 0.08, 0.13, 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  // mouth
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#5a1030';
  ctx.lineWidth = 0.07;
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

function body(ctx: CanvasRenderingContext2D, color: string, rx = 1, ry = 1): void {
  const g = ctx.createRadialGradient(-0.35, -0.4, 0.05, 0, 0, 1.1);
  g.addColorStop(0, shade(color, 0.4));
  g.addColorStop(0.55, color);
  g.addColorStop(1, shade(color, -0.3));
  ctx.fillStyle = g;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function shine(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.ellipse(-0.42, -0.5, 0.2, 0.11, -0.7, 0, Math.PI * 2);
  ctx.fill();
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color = '#3ddc84'): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.05;
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
  ctx.arc(0, 0, 0.96, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = '#13702f';
  ctx.lineWidth = 0.13;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 0.36, -1.1);
    ctx.bezierCurveTo(i * 0.36 + 0.16, -0.4, i * 0.36 - 0.16, 0.4, i * 0.36, 1.1);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.arc(0, 0, 0.96, 0, Math.PI * 2);
  ctx.stroke();
  shine(ctx);
  fruitFace(ctx, 'grin');
});

const orange = unit((ctx) => {
  body(ctx, '#ff9a1f');
  ctx.fillStyle = 'rgba(160, 70, 0, 0.25)';
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
    ctx.arc(x, y, 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
  shine(ctx);
  leaf(ctx, 0.05, -0.92, -0.5);
  fruitFace(ctx, 'smile');
});

const apple = unit((ctx) => {
  // two-lobed apple outline
  const g = ctx.createRadialGradient(-0.35, -0.4, 0.05, 0, 0, 1.1);
  g.addColorStop(0, '#ff8a7a');
  g.addColorStop(0.55, '#ff3d3d');
  g.addColorStop(1, '#a3121c');
  ctx.fillStyle = g;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(0, -0.7);
  ctx.bezierCurveTo(0.5, -1.05, 1.08, -0.7, 0.98, 0.05);
  ctx.bezierCurveTo(0.9, 0.7, 0.45, 1.02, 0, 0.88);
  ctx.bezierCurveTo(-0.45, 1.02, -0.9, 0.7, -0.98, 0.05);
  ctx.bezierCurveTo(-1.08, -0.7, -0.5, -1.05, 0, -0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // stem
  ctx.strokeStyle = '#6b3b1a';
  ctx.lineWidth = 0.1;
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
  ctx.strokeStyle = 'rgba(40, 0, 80, 0.4)';
  ctx.lineWidth = 0.06;
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
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.ellipse(-1.02, 0, 0.14, 0.1, 0, 0, Math.PI * 2);
  ctx.ellipse(1.02, 0, 0.14, 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  body(ctx, '#ffe03d', 1, 0.8);
  ctx.fillStyle = 'rgba(180, 130, 0, 0.22)';
  for (const [x, y] of [
    [-0.5, 0.35],
    [0.55, -0.3],
    [0.3, 0.5],
    [-0.65, -0.1],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
  shine(ctx);
  fruitFace(ctx, 'cheeky', 0, 0.02);
});

const goldPainter = unit((ctx) => {
  // gold coin with a star, rim and shine
  const g = ctx.createRadialGradient(-0.35, -0.45, 0.05, 0, 0, 1.1);
  g.addColorStop(0, '#fff6c2');
  g.addColorStop(0.45, '#ffd23f');
  g.addColorStop(1, '#c47a00');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#6b3d00';
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120, 70, 0, 0.55)';
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.arc(0, 0, 0.8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff3a8';
  ctx.strokeStyle = '#9a5a00';
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? 0.6 : 0.26;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.beginPath();
  ctx.ellipse(-0.45, -0.5, 0.22, 0.1, -0.7, 0, Math.PI * 2);
  ctx.fill();
});

/**
 * Bomb body with a face window in the middle (the real art puts the hosts'
 * faces there). No fuse: the game draws fuse + sparks on top.
 */
const bombPainter = unit((ctx) => {
  const g = ctx.createRadialGradient(-0.35, -0.4, 0.05, 0, 0.1, 1.1);
  g.addColorStop(0, '#6a6485');
  g.addColorStop(0.45, '#2a2638');
  g.addColorStop(1, '#0b0912');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // rivets band
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.arc(0, 0, 0.88, 0, Math.PI * 2);
  ctx.stroke();
  // face window
  ctx.fillStyle = '#ff4d5e';
  ctx.beginPath();
  ctx.arc(0, 0.06, 0.66, 0, Math.PI * 2);
  ctx.fill();
  drawFace(ctx, 0, 0.06, 0.58, 'laughing', '#ffc79a');
  // shine
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, 0.82, Math.PI * 1.1, Math.PI * 1.38);
  ctx.stroke();
});

/** Optional backdrop: a night dojo with a big moon and bamboo. */
const backgroundPainter: Painter = (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#12062e');
  g.addColorStop(0.5, '#33106b');
  g.addColorStop(1, '#5a1a6e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // moon
  const mx = w * 0.7;
  const my = h * 0.24;
  const mr = w * 0.16;
  const halo = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 2.4);
  halo.addColorStop(0, 'rgba(255, 210, 120, 0.22)');
  halo.addColorStop(1, 'rgba(255, 210, 120, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);
  const mg = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
  mg.addColorStop(0, '#fff6dc');
  mg.addColorStop(1, '#f2c98a');
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(200, 120, 40, 0.18)';
  for (const [x, y, r] of [
    [-0.3, -0.2, 0.18],
    [0.25, 0.15, 0.24],
    [-0.1, 0.45, 0.12],
  ] as const) {
    ctx.beginPath();
    ctx.arc(mx + x * mr, my + y * mr, r * mr, 0, Math.PI * 2);
    ctx.fill();
  }

  // stars
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  const stars = [
    [0.08, 0.06],
    [0.22, 0.16],
    [0.4, 0.05],
    [0.12, 0.3],
    [0.9, 0.08],
    [0.33, 0.24],
    [0.52, 0.14],
    [0.95, 0.44],
    [0.06, 0.48],
  ] as const;
  for (const [x, y] of stars) {
    ctx.beginPath();
    ctx.arc(x * w, y * h, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // far mountains
  ctx.fillStyle = '#2a0c55';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.72);
  ctx.lineTo(w * 0.2, h * 0.58);
  ctx.lineTo(w * 0.38, h * 0.68);
  ctx.lineTo(w * 0.62, h * 0.52);
  ctx.lineTo(w * 0.85, h * 0.66);
  ctx.lineTo(w, h * 0.6);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1e0841';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.8);
  ctx.lineTo(w * 0.3, h * 0.7);
  ctx.lineTo(w * 0.55, h * 0.78);
  ctx.lineTo(w * 0.8, h * 0.72);
  ctx.lineTo(w, h * 0.78);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // bamboo on both sides
  const bamboo = (x: number, width: number, lean: number): void => {
    ctx.save();
    ctx.translate(x, h);
    ctx.rotate(lean);
    ctx.fillStyle = '#0f3b2a';
    roundRectPath(ctx, -width / 2, -h * 1.1, width, h * 1.1, width / 2);
    ctx.fill();
    ctx.fillStyle = '#0a2a1e';
    for (let y = -h * 0.12; y > -h * 1.1; y -= h * 0.11) ctx.fillRect(-width / 2, y, width, width * 0.22);
    ctx.restore();
  };
  bamboo(w * 0.04, w * 0.05, 0.03);
  bamboo(w * 0.12, w * 0.035, -0.02);
  bamboo(w * 0.95, w * 0.055, -0.04);
  bamboo(w * 0.87, w * 0.03, 0.02);

  // wooden floor
  const fy = h * 0.9;
  const fg = ctx.createLinearGradient(0, fy, 0, h);
  fg.addColorStop(0, '#5b2a1a');
  fg.addColorStop(1, '#2a120a');
  ctx.fillStyle = fg;
  ctx.fillRect(0, fy, w, h - fy);
  ctx.fillStyle = 'rgba(255, 200, 150, 0.12)';
  ctx.fillRect(0, fy, w, 2);
};

/** Soft round glow (white core); tinted by drawing with globalAlpha / composite. */
function glowPainter(rgb: string): Painter {
  return (ctx, w, h) => {
    const r = Math.min(w, h) / 2;
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
    g.addColorStop(0, `rgba(${rgb}, 1)`);
    g.addColorStop(0.45, `rgba(${rgb}, 0.45)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
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

export interface NinjaArt {
  /** target_1..target_5, index = Throw.variant. */
  readonly targets: readonly Drawable[];
  readonly gold: Drawable;
  readonly bomb: Drawable;
  readonly background: Drawable;
  readonly glowRed: Drawable;
  readonly glowGold: Drawable;
  readonly glowWhite: Drawable;
  readonly hand: Drawable;
}

export async function loadNinjaArt(): Promise<NinjaArt> {
  const a = await loadAssets('ninja', [
    {
      key: 'target_1',
      file: 'target_1.png',
      size: SPRITE_BOX,
      placeholder: watermelon,
    },
    {
      key: 'target_2',
      file: 'target_2.png',
      size: SPRITE_BOX,
      placeholder: orange,
    },
    {
      key: 'target_3',
      file: 'target_3.png',
      size: SPRITE_BOX,
      placeholder: apple,
    },
    {
      key: 'target_4',
      file: 'target_4.png',
      size: SPRITE_BOX,
      placeholder: plum,
    },
    {
      key: 'target_5',
      file: 'target_5.png',
      size: SPRITE_BOX,
      placeholder: lemon,
    },
    {
      key: 'target_gold',
      file: 'target_gold.png',
      size: SPRITE_BOX,
      placeholder: goldPainter,
    },
    {
      key: 'bomb',
      file: 'bomb.png',
      size: SPRITE_BOX,
      placeholder: bombPainter,
    },
    {
      key: 'background',
      file: 'background.jpg',
      size: 430,
      height: 932,
      fit: 'cover',
      placeholder: backgroundPainter,
    },
  ]);
  return {
    targets: [a.target_1, a.target_2, a.target_3, a.target_4, a.target_5],
    gold: a.target_gold,
    bomb: a.bomb,
    background: a.background,
    glowRed: paintDrawable('glow_red', glowPainter('255, 60, 80'), 96),
    glowGold: paintDrawable('glow_gold', glowPainter('255, 215, 80'), 96),
    glowWhite: paintDrawable('glow_white', glowPainter('255, 255, 255'), 64),
    hand: paintDrawable('hand', handPainter, 100),
  };
}
