/**
 * Art of "שימי טאפ". Every replaceable picture is a kit file slot under
 * client/public/assets/tap/ (see the README there) with a procedural placeholder; the
 * stage backdrop (yellow sunburst + halftone) and the bottom tray are painted once per
 * screen size, so the hot path only calls drawImage.
 */
import { facePainter, loadAssets, paintDrawable } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';
import { BOOGER } from './schedule';
import { halftone, makeLayer, PAL } from './look';

import type { Drawable, Painter } from '../../kit/assets';
import type { BoogerKind } from './schedule';

/**
 * Logical box of a head frame in CSS px (pre-rendered at 2x = 512 px, the size of the files).
 * Every head frame shares one framing (hat top at 0.5%, hair 60% wide, chin at the bottom),
 * so frames swap without the head jumping.
 */
export const FACE_BOX = 256;

/** Points of a head frame, as shares of its box (measured on the pictures). */
export const FRAME = {
  /** The nostril the finger goes into. */
  nostrilX: 0.52,
  nostrilY: 0.665,
  /** Fingertip in pick_out (finger just out, strand to the nostril). */
  outTipX: 0.69,
  outTipY: 0.7,
  /** Fingertip in pick_big (finger pulled down to the chin). */
  bigTipX: 0.56,
  bigTipY: 0.93,
  /** Centre and radius of the tap target (the whole head, hat to chin). */
  hitX: 0.5,
  hitY: 0.5,
  hitR: 0.4,
} as const;

/** Hand sprite: fingertip position as shares of its box (the forearm runs off the bottom). */
export const HAND = { w: 69, h: 200, tipX: 0.74, tipY: 0.0 } as const;

const FACE_COLOR = '#d9a27a';

/** Reaction faces (indexes): what the doll does when it is not picking. */
export const FACE = {
  Normal: 0,
  Happy: 1,
  Surprised: 2,
  Angry: 3,
  Tongue: 4,
  Wink: 5,
  Bored: 6,
  Proud: 7,
} as const satisfies Record<string, number>;

/** Picking frames (indexes into TapArt.pick). */
export const PICKF = {
  Enter: 0,
  Knuckle: 1,
  Deep: 2,
  Out: 3,
  Big: 4,
} as const satisfies Record<string, number>;

export interface TapArt {
  /** Reaction faces, by FACE. */
  readonly faces: readonly Drawable[];
  /** Picking frames (the doll's own hand in the picture), by PICKF. */
  readonly pick: readonly Drawable[];
  /** The doll's hand alone, index finger up (the rising phase). */
  readonly hand: Drawable;
  /** Booger characters, by BoogerKind. */
  readonly boogers: readonly Drawable[];
  /** Optional stage backdrop file (placeholder = painted sunburst at screen size). */
  readonly background: Drawable;
  /** The teaching hint's ghost finger (drawn, not a slot): white, ink outline, pointing up. */
  readonly ghost: Drawable;
}

export async function loadTapArt(): Promise<TapArt> {
  const s = await loadAssets('tap', [
    { key: 'face_normal', file: 'face_normal.png', size: FACE_BOX, placeholder: facePainter('normal', FACE_COLOR) },
    { key: 'face_happy', file: 'face_happy.png', size: FACE_BOX, placeholder: facePainter('laughing', FACE_COLOR) },
    { key: 'face_surprised', file: 'face_surprised.png', size: FACE_BOX, placeholder: facePainter('surprised', FACE_COLOR) },
    { key: 'face_angry', file: 'face_angry.png', size: FACE_BOX, placeholder: facePainter('angry', FACE_COLOR) },
    { key: 'face_tongue', file: 'face_tongue.png', size: FACE_BOX, placeholder: facePainter('tongue', FACE_COLOR) },
    { key: 'face_wink', file: 'face_wink.png', size: FACE_BOX, placeholder: facePainter('wink', FACE_COLOR) },
    { key: 'face_bored', file: 'face_bored.png', size: FACE_BOX, placeholder: facePainter('dead', FACE_COLOR) },
    { key: 'face_proud', file: 'face_proud.png', size: FACE_BOX, placeholder: facePainter('happy', FACE_COLOR) },
    { key: 'face_nosepick', file: 'face_nosepick.png', size: FACE_BOX, placeholder: pickPlaceholder(0) },
    { key: 'pick_knuckle', file: 'pick_knuckle.png', size: FACE_BOX, placeholder: pickPlaceholder(1) },
    { key: 'pick_deep', file: 'pick_deep.png', size: FACE_BOX, placeholder: pickPlaceholder(2) },
    { key: 'pick_out', file: 'pick_out.png', size: FACE_BOX, placeholder: pickPlaceholder(3) },
    { key: 'pick_big', file: 'pick_big.png', size: FACE_BOX, placeholder: pickPlaceholder(4) },
    { key: 'hand', file: 'hand.png', size: HAND.w, height: HAND.h, placeholder: handPainter },
    { key: 'booger_round', file: 'booger_round.png', size: 128, placeholder: boogerPainter(BOOGER.Round) },
    { key: 'booger_stretchy', file: 'booger_stretchy.png', size: 32, height: 180, placeholder: boogerPainter(BOOGER.Stretchy) },
    { key: 'booger_googly', file: 'booger_googly.png', size: 128, placeholder: boogerPainter(BOOGER.Googly) },
    { key: 'booger_hairy', file: 'booger_hairy.png', size: 100, height: 132, placeholder: boogerPainter(BOOGER.Hairy) },
    { key: 'booger_golden', file: 'booger_golden.png', size: 128, placeholder: boogerPainter(BOOGER.Golden) },
    { key: 'booger_boss', file: 'booger_boss.png', size: 180, placeholder: boogerPainter(BOOGER.Boss) },
    { key: 'background', file: 'background.jpg', size: 430, height: 932, fit: 'cover', placeholder: (): void => undefined },
  ]);
  return {
    faces: [s.face_normal, s.face_happy, s.face_surprised, s.face_angry, s.face_tongue, s.face_wink, s.face_bored, s.face_proud],
    pick: [s.face_nosepick, s.pick_knuckle, s.pick_deep, s.pick_out, s.pick_big],
    hand: s.hand,
    boogers: [s.booger_round, s.booger_stretchy, s.booger_googly, s.booger_hairy, s.booger_golden, s.booger_boss],
    background: s.background,
    ghost: paintDrawable('tap_ghost', ghostPainter, 96, 120),
  };
}

/** Ghost hand pointing up with the index finger; the fingertip is at (0.5w, 0.04h). */
const ghostPainter: Painter = (ctx, w, h) => {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = PAL.ink;
  ctx.fillStyle = PAL.white;
  const fw = w * 0.22;
  roundRectPath(ctx, w * 0.24, h * 0.46, w * 0.62, h * 0.48, w * 0.2);
  ctx.fill();
  ctx.stroke();
  roundRectPath(ctx, w * 0.5 - fw / 2, h * 0.04, fw, h * 0.6, fw / 2);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.translate(w * 0.28, h * 0.66);
  ctx.rotate(-0.6);
  roundRectPath(ctx, -fw * 0.45, -h * 0.16, fw * 0.9, h * 0.28, fw * 0.45);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.fillRect(w * 0.5 - fw / 2 + 2, h * 0.48, fw - 4, h * 0.14);
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const y = h * (0.6 + i * 0.1);
    ctx.moveTo(w * 0.62, y);
    ctx.lineTo(w * 0.8, y);
  }
  ctx.stroke();
};

// ───────────────────────────── Placeholders ─────────────────────────────

const SKIN = '#e8b48c';

/** A drawn finger (fingertip at (x, y), pointing up) for the placeholders. */
function drawFinger(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, len: number): void {
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = Math.max(2, w * 0.12);
  roundRectPath(ctx, x - w / 2, y, w, len, w / 2);
  ctx.fill();
  ctx.stroke();
}

/** Generic face with a finger (enter / knuckle / deep), a strand (out) or a long strand (big). */
function pickPlaceholder(stage: number): Painter {
  const base = facePainter('nose-pick', FACE_COLOR);
  const plain = facePainter(stage === 4 ? 'surprised' : 'wink', FACE_COLOR);
  return (ctx, w, h) => {
    (stage >= 3 ? plain : base)(ctx, w, h);
    const nx = w * FRAME.nostrilX;
    const ny = h * FRAME.nostrilY;
    if (stage >= 3) {
      const tx = w * (stage === 4 ? FRAME.bigTipX : FRAME.outTipX);
      const ty = h * (stage === 4 ? FRAME.bigTipY : FRAME.outTipY);
      ctx.strokeStyle = '#8fd13a';
      ctx.lineCap = 'round';
      ctx.lineWidth = w * 0.03;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.quadraticCurveTo((nx + tx) / 2, ty + h * 0.06, tx, ty);
      ctx.stroke();
      drawFinger(ctx, tx, ty, w * 0.09, h);
      return;
    }
    drawFinger(ctx, nx, ny - h * (0.01 + stage * 0.02), w * 0.09, h);
  };
}

/** Index finger up + fist + forearm (fingertip at HAND.tipX, top). */
const handPainter: Painter = (ctx, w, h) => {
  ctx.lineJoin = 'round';
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = 3;
  roundRectPath(ctx, w * 0.12, h * 0.4, w * 0.76, h * 0.7, w * 0.3);
  ctx.fill();
  ctx.stroke();
  roundRectPath(ctx, w * 0.05, h * 0.18, w * 0.9, h * 0.3, w * 0.3);
  ctx.fill();
  ctx.stroke();
  drawFinger(ctx, w * HAND.tipX, h * HAND.tipY + 2, w * 0.24, h * 0.3);
};

/** Cartoon booger: a green blob with a face; the variants differ in shape and extras. */
function boogerPainter(kind: BoogerKind): Painter {
  return (ctx, w, h) => {
    const gold = kind === BOOGER.Golden;
    const fill = gold ? '#ffcf3a' : kind === BOOGER.Hairy ? '#8aa53a' : '#86d93a';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, w * 0.04);
    ctx.strokeStyle = PAL.ink;
    ctx.fillStyle = fill;
    if (kind === BOOGER.Stretchy) {
      roundRectPath(ctx, w * 0.35, h * 0.02, w * 0.3, h * 0.7, w * 0.15);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.84, w * 0.46, h * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.58, w * 0.44, h * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const eye = (x: number, r: number): void => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, h * 0.5, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PAL.ink;
      ctx.beginPath();
      ctx.arc(x + r * 0.3, h * 0.52, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    };
    const big = kind === BOOGER.Googly || kind === BOOGER.Boss;
    eye(w * 0.36, w * (big ? 0.12 : 0.06));
    eye(w * 0.64, w * (big ? 0.12 : 0.06));
    if (kind === BOOGER.Hairy) {
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.22);
      ctx.quadraticCurveTo(w * 0.7, h * 0.1, w * 0.55, h * 0.02);
      ctx.stroke();
    }
    if (kind === BOOGER.Boss) {
      ctx.fillStyle = '#ffcf3a';
      ctx.beginPath();
      ctx.moveTo(w * 0.35, h * 0.24);
      ctx.lineTo(w * 0.35, h * 0.08);
      ctx.lineTo(w * 0.43, h * 0.16);
      ctx.lineTo(w * 0.5, h * 0.05);
      ctx.lineTo(w * 0.57, h * 0.16);
      ctx.lineTo(w * 0.65, h * 0.08);
      ctx.lineTo(w * 0.65, h * 0.24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  };
}

// ───────────────────────────── Stage backdrop ─────────────────────────────

/** Yellow sunburst from (cx, cy), orange towards the edges, with halftone dots. */
export function paintSunburst(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number): void {
  ctx.fillStyle = PAL.yel;
  ctx.fillRect(0, 0, w, h);
  const far = Math.hypot(w, h);
  const rays = 22;
  ctx.fillStyle = PAL.yel2;
  ctx.beginPath();
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = a0 + Math.PI / rays;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * far, cy + Math.sin(a0) * far);
    ctx.lineTo(cx + Math.cos(a1) * far, cy + Math.sin(a1) * far);
    ctx.closePath();
  }
  ctx.fill();
  // towards orange at the edges (the one gradient of the look, painted once)
  const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.25, cx, cy, far * 0.62);
  g.addColorStop(0, 'rgba(255, 159, 10, 0)');
  g.addColorStop(1, 'rgba(255, 159, 10, 0.75)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // halftone: dots grow towards the edges
  const maxD = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  halftone(ctx, 0, 0, w, h, 11, 'rgba(242, 54, 27, 0.16)', (u, v) => {
    const d = Math.hypot(u * w - cx, v * h - cy) / maxD;
    return (d - 0.35) * 1.6;
  });
}

/**
 * The backdrop painted once per canvas size into a device-pixel cache and then copied 1:1
 * every frame (a full-screen resample every frame cost a whole frame on a slow phone).
 * Uses the background file when there is one, else the sunburst centred on (cx(w,h), cy(w,h)).
 */
export interface Backdrop {
  draw(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, cx: number, cy: number): void;
  dispose(): void;
}

export function createBackdrop(bg: Drawable): Backdrop {
  let cache: HTMLCanvasElement | null = null;
  let key = '';
  return {
    draw(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, cx: number, cy: number): void {
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      const k = `${pw}x${ph}@${Math.round(cx)},${Math.round(cy)}`;
      if (!cache || k !== key) {
        cache ??= document.createElement('canvas');
        key = k;
        cache.width = pw;
        cache.height = ph;
        const c = cache.getContext('2d');
        if (c) {
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (bg.isPlaceholder) paintSunburst(c, w, h, cx, cy);
          else {
            const s = Math.max(w / bg.width, h / bg.height);
            bg.draw(c, w / 2, h / 2, bg.width * s, bg.height * s);
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

// ───────────────────────────── Bottom tray ─────────────────────────────

export const TRAY_H = 78;

/** The cobalt tray at the bottom (the doll's "desk"): band, ink rule, marquee lights. Painted once per size. */
export function paintTray(w: number, h: number): HTMLCanvasElement {
  const { canvas, ctx } = makeLayer(w, h);
  if (!ctx) return canvas;
  ctx.fillStyle = PAL.cobD;
  ctx.fillRect(0, 0, w, h);
  // marquee strip on top: red band with bulbs
  ctx.fillStyle = PAL.red;
  ctx.fillRect(0, 0, w, 14);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, 14, w, 3);
  ctx.fillRect(0, 0, w, 3);
  const n = Math.max(6, Math.round(w / 26));
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * w;
    ctx.fillStyle = i % 2 === 0 ? PAL.yel : PAL.white;
    ctx.beginPath();
    ctx.arc(x, 8.5, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PAL.ink;
    ctx.stroke();
  }
  // perspective lines of the desk
  ctx.strokeStyle = 'rgba(79, 108, 255, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -4; i <= 4; i++) {
    ctx.moveTo(w / 2 + i * w * 0.07, 17);
    ctx.lineTo(w / 2 + i * w * 0.26, h);
  }
  ctx.stroke();
  return canvas;
}
