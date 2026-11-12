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
 * Every head frame shares one framing (hat top at the top edge, hair 60% wide, chin at the
 * bottom edge), so frames swap without the head jumping. The game draws them clipped to a
 * round token (see index.ts).
 */
export const FACE_BOX = 256;

/**
 * Where a head frame sits in the round token (D = token diameter): drawn FRAME_SCALE * D wide,
 * its top FRAME_TOP * D above the token centre. The frame's bottom edge (the neck cut) is then
 * at the outer edge of the ring, so the cut never shows.
 */
export const FRAME_SCALE = 0.96;
export const FRAME_TOP = 0.46;
/**
 * Every head frame is masked once, at load, to this circle (radius as a share of D, centred
 * on the token centre): the porthole costs nothing per frame and survives the spin. It sits
 * just under the ink ring (inner edge 0.465 D), and stays inside the ring's outer edge up to a
 * picture scale of 1.065 (the glass press).
 */
export const MASK_R = 0.468;

/** Points of a head frame, as shares of its box (measured on the pictures). */
export const FRAME = {
  /** The nostril the finger goes into (the doll's left nostril, right on screen). */
  nostrilX: 0.52,
  nostrilY: 0.665,
  /** The other nostril (the second hand at the absurd rate). */
  nostril2X: 0.455,
  nostril2Y: 0.675,
  /** Fingertip in pick_out (finger just out, strand to the nostril). */
  outTipX: 0.69,
  outTipY: 0.7,
  /** Fingertip in pick_big (finger pulled down to the chin). */
  bigTipX: 0.56,
  bigTipY: 0.93,
  /** Outer edge of the ear on the left of the screen (the fingertip pokes out of it). */
  earX: 0.185,
  earY: 0.6,
  /** Temples (sweat drops) and ears (steam). */
  templeLX: 0.26,
  templeRX: 0.74,
  templeY: 0.42,
  earRX: 0.83,
} as const;

/** Hand sprite: fingertip position as shares of its box (the forearm runs off the bottom). */
export const HAND = { w: 69, h: 200, tipX: 0.74, tipY: 0.0 } as const;

const FACE_COLOR = '#d9a27a';

/** Head frames (indexes into TapArt.frames). */
export const FR = {
  Normal: 0,
  Happy: 1,
  Surprised: 2,
  Angry: 3,
  Tongue: 4,
  Wink: 5,
  Bored: 6,
  Proud: 7,
  NosePick: 8,
  Knuckle: 9,
  Deep: 10,
  Out: 11,
  Big: 12,
  Whistle: 13,
  Caught: 14,
  GlassPress: 15,
  Dizzy: 16,
  Squeeze: 17,
  Double: 18,
} as const satisfies Record<string, number>;
export type FrameId = (typeof FR)[keyof typeof FR];

export const FRAME_NAMES: readonly string[] = [
  'face_normal',
  'face_happy',
  'face_surprised',
  'face_angry',
  'face_tongue',
  'face_wink',
  'face_bored',
  'face_proud',
  'face_nosepick',
  'pick_knuckle',
  'pick_deep',
  'pick_out',
  'pick_big',
  'face_whistle',
  'face_caught',
  'face_glass_press',
  'face_dizzy',
  'face_squeeze',
  'pick_double',
];

export interface TapArt {
  /** Head frames, by FR. */
  readonly frames: readonly Drawable[];
  /** The doll's hand alone, index finger up (the rising hand, the second hand). */
  readonly hand: Drawable;
  /** A toy fingertip pointing up (pokes out of the ear). */
  readonly fingertip: Drawable;
  /** The doll's fist, knuckles to the viewer (knocks on the glass while waiting). */
  readonly fist: Drawable;
  readonly squeegee: Drawable;
  /** Green slime splat seen from above: the decal under every booger on the glass. */
  readonly splat: Drawable;
  /** The round Shimi token (mini Shimi). */
  readonly mini: Drawable;
  /** Booger characters, by BoogerKind. */
  readonly boogers: readonly Drawable[];
  /** Optional stage backdrop file (placeholder = painted sunburst at screen size). */
  readonly background: Drawable;
  /** The waiting screen's ghost finger (drawn, not a slot): white, ink outline, pointing up. */
  readonly ghost: Drawable;
}

export async function loadTapArt(): Promise<TapArt> {
  const [s, sh] = await Promise.all([
    loadAssets('tap', [
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
      { key: 'face_whistle', file: 'face_whistle.png', size: FACE_BOX, placeholder: facePainter('wink', FACE_COLOR) },
      { key: 'face_caught', file: 'face_caught.png', size: FACE_BOX, placeholder: pickPlaceholder(1) },
      { key: 'face_glass_press', file: 'face_glass_press.png', size: FACE_BOX, placeholder: facePainter('laughing', FACE_COLOR) },
      { key: 'face_dizzy', file: 'face_dizzy.png', size: FACE_BOX, placeholder: facePainter('dead', FACE_COLOR) },
      { key: 'face_squeeze', file: 'face_squeeze.png', size: FACE_BOX, placeholder: facePainter('angry', FACE_COLOR) },
      { key: 'pick_double', file: 'pick_double.png', size: FACE_BOX, placeholder: pickPlaceholder(2) },
      { key: 'hand', file: 'hand.png', size: HAND.w, height: HAND.h, placeholder: handPainter },
      { key: 'fingertip_ear', file: 'fingertip_ear.png', size: 64, placeholder: fingertipPainter },
      { key: 'fist', file: 'fist.png', size: 128, height: 171, placeholder: fistPainter },
      { key: 'squeegee', file: 'squeegee.png', size: 192, placeholder: squeegeePainter },
      { key: 'splat', file: 'splat.png', size: 128, placeholder: splatPainter },
      { key: 'booger_round', file: 'booger_round.png', size: 128, placeholder: boogerPainter(BOOGER.Round) },
      { key: 'booger_stretchy', file: 'booger_stretchy.png', size: 32, height: 180, placeholder: boogerPainter(BOOGER.Stretchy) },
      { key: 'booger_googly', file: 'booger_googly.png', size: 128, placeholder: boogerPainter(BOOGER.Googly) },
      { key: 'booger_hairy', file: 'booger_hairy.png', size: 100, height: 132, placeholder: boogerPainter(BOOGER.Hairy) },
      { key: 'booger_golden', file: 'booger_golden.png', size: 128, placeholder: boogerPainter(BOOGER.Golden) },
      { key: 'booger_boss', file: 'booger_boss.png', size: 180, placeholder: boogerPainter(BOOGER.Boss) },
      { key: 'background', file: 'background.jpg', size: 430, height: 932, fit: 'cover', placeholder: (): void => undefined },
    ]),
    loadAssets('shimi', [{ key: 'mini', file: 'faces_round/normal.png', size: 96, placeholder: facePainter('happy', FACE_COLOR) }]),
  ]);
  const frames = [
      s.face_normal,
      s.face_happy,
      s.face_surprised,
      s.face_angry,
      s.face_tongue,
      s.face_wink,
      s.face_bored,
      s.face_proud,
      s.face_nosepick,
      s.pick_knuckle,
      s.pick_deep,
      s.pick_out,
      s.pick_big,
      s.face_whistle,
      s.face_caught,
      s.face_glass_press,
      s.face_dizzy,
      s.face_squeeze,
      s.pick_double,
  ];
  for (const f of frames) maskToToken(f.source);
  return {
    frames,
    hand: s.hand,
    fingertip: s.fingertip_ear,
    fist: s.fist,
    squeegee: s.squeegee,
    splat: s.splat,
    mini: sh.mini,
    boogers: [s.booger_round, s.booger_stretchy, s.booger_googly, s.booger_hairy, s.booger_golden, s.booger_boss],
    background: s.background,
    ghost: paintDrawable('tap_ghost', ghostPainter, 96, 120),
  };
}

/**
 * Cut a head frame's canvas (in place, idempotent) to the token circle in frame space, so the
 * game can draw it with a plain drawImage and get a perfect round porthole.
 */
function maskToToken(c: HTMLCanvasElement): void {
  const g = c.getContext('2d');
  if (!g || c.width === 0) return;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.beginPath();
  g.arc(c.width * 0.5, (c.height * FRAME_TOP) / FRAME_SCALE, (c.width * MASK_R) / FRAME_SCALE, 0, Math.PI * 2);
  g.fill();
  g.restore();
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

/** A round fist with three knuckle lines. */
const fistPainter: Painter = (ctx, w, h) => {
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = 4;
  roundRectPath(ctx, w * 0.3, h * 0.6, w * 0.4, h * 0.38, w * 0.08);
  ctx.fill();
  ctx.stroke();
  roundRectPath(ctx, w * 0.08, h * 0.06, w * 0.84, h * 0.6, w * 0.25);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    ctx.moveTo(w * (0.08 + 0.21 * i), h * 0.1);
    ctx.lineTo(w * (0.08 + 0.21 * i), h * 0.32);
  }
  ctx.stroke();
};

/** A fingertip pointing up (nail at the top). */
const fingertipPainter: Painter = (ctx, w, h) => drawFinger(ctx, w / 2, h * 0.05, w * 0.32, h * 0.9);

/** Yellow handle down, black blade on top. */
const squeegeePainter: Painter = (ctx, w, h) => {
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = PAL.ink;
  ctx.fillStyle = PAL.yel;
  roundRectPath(ctx, w * 0.44, h * 0.2, w * 0.12, h * 0.75, w * 0.05);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#222';
  roundRectPath(ctx, w * 0.08, h * 0.06, w * 0.84, h * 0.16, w * 0.04);
  ctx.fill();
  ctx.stroke();
};

/** A flat green star-shaped splat. */
const splatPainter: Painter = (ctx, w, h) => {
  ctx.fillStyle = '#7ed321';
  ctx.beginPath();
  const n = 7;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = (i % 2 === 0 ? 0.47 : 0.28) * Math.min(w, h);
    const x = w / 2 + Math.cos(a) * r;
    const y = h / 2 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
};

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

