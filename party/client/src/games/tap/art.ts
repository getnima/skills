/**
 * Art of "שימי טאפ". Every replaceable picture is a kit file slot under
 * client/public/assets/tap/ (see the README there) with a procedural placeholder; the
 * stage backdrop (yellow sunburst + halftone) and the bottom tray are painted once per
 * screen size, so the hot path only calls drawImage.
 *
 * The picking is a CLIP: 40 frames cut from one image-to-video take of the doll (the hand
 * rises, the finger slides into the nostril, the eyes close and roll up), all in the one head
 * framing. The game maps its picking depth to a clip position and crossfades the two nearest
 * frames, so the motion never steps (index.ts). A few stills (faces for the waiting bits and
 * the final frame) are crossfaded over the clip.
 */
import { facePainter, loadAssets, paintDrawable } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';
import { halftone, PAL } from './look';

import type { Drawable, Painter } from '../../kit/assets';

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
 * Every head frame is cut once, at load, to this circle (radius as a share of D, centred on
 * the token centre) and filled with the disc colour behind: a plain drawImage is a perfect,
 * opaque porthole, so two frames crossfade cleanly. It sits just under the ink ring (inner
 * edge 0.465 D), and stays inside the ring's outer edge up to a picture scale of 1.065 (the
 * glass press).
 */
export const MASK_R = 0.468;
/** The token's cream disc (also the background colour of the clip). */
export const DISC = '#FFF6E0';

/** Points of a head frame, as shares of its box (measured on the pictures). */
export const FRAME = {
  /** The nostril the finger goes into (the doll's left nostril, right on screen). */
  nostrilX: 0.52,
  nostrilY: 0.665,
  /** Temples and the right ear (steam at the absurd rate, the note when he whistles). */
  templeLX: 0.26,
  templeRX: 0.74,
  templeY: 0.42,
  earRX: 0.83,
} as const;

/**
 * The picking clip: the clip frame (of the 97-frame take, 24 fps) each file pick_NN was cut
 * from (tests/e2e/tap-fluent-frames.py keeps 40, spaced evenly in how much the picture changes).
 */
export const CLIP_SRC: readonly number[] = [0, 5, 8, 10, 12, 13, 15, 17, 18, 21, 24, 28, 32, 36, 40, 45, 48, 50, 52, 54, 56, 58, 61, 63, 65, 68, 70, 72, 73, 75, 77, 78, 80, 82, 83, 85, 87, 89, 92, 96];
/**
 * Picking depth d (0..1) -> clip frame number, piecewise linear through these pairs:
 * 0 the hand is down out of sight, 0.08 the fingertip shows at the chin, 0.35 the fingertip is
 * at the nostril, 0.62 the finger is in to the knuckle, 0.82 the eyes close in bliss, 1 the
 * eyes roll up (the head tilts back a little on the way, in the clip itself).
 */
export const CLIP_KEYS: readonly number[] = [0, 0, 0.08, 6, 0.35, 24, 0.62, 44, 0.82, 66, 1, 96];

/** Still faces (indexes into TapArt.stills). */
export const FR = {
  Surprised: 0,
  Angry: 1,
  Bored: 2,
  Proud: 3,
  Whistle: 4,
  Caught: 5,
  GlassPress: 6,
  Squeeze: 7,
  Double: 8,
} as const satisfies Record<string, number>;
export type FrameId = (typeof FR)[keyof typeof FR];

export const STILL_NAMES: readonly string[] = ['face_surprised', 'face_angry', 'face_bored', 'face_proud', 'face_whistle', 'face_caught', 'face_glass_press', 'face_squeeze', 'pick_double'];

/** Stills with the hand in the picture (the others are crossfaded only while the clip's hand is down). */
export const STILL_HAS_HAND: ReadonlySet<number> = new Set([FR.Caught, FR.Double]);

const FACE_COLOR = '#d9a27a';

export interface TapArt {
  /** The picking clip, by CLIP_SRC index. */
  readonly clip: readonly Drawable[];
  /** Still faces, by FR. */
  readonly stills: readonly Drawable[];
  /** The doll's fist, knuckles to the viewer (knocks on the glass while waiting). */
  readonly fist: Drawable;
  /** Optional stage backdrop file (placeholder = painted sunburst at screen size). */
  readonly background: Drawable;
  /** The waiting screen's "tap here" hand (drawn, not a slot): white, ink outline, pointing up. */
  readonly ghost: Drawable;
}

export async function loadTapArt(): Promise<TapArt> {
  const clipSlots = CLIP_SRC.map((_, i) => {
    const n = String(i).padStart(2, '0');
    return { key: `pick_${n}`, file: `pick_${n}.png`, size: FACE_BOX, placeholder: clipPlaceholder(i / (CLIP_SRC.length - 1)) };
  });
  const [clip, s] = await Promise.all([
    loadAssets('tap', clipSlots),
    loadAssets('tap', [
      { key: 'face_surprised', file: 'face_surprised.png', size: FACE_BOX, placeholder: facePainter('surprised', FACE_COLOR) },
      { key: 'face_angry', file: 'face_angry.png', size: FACE_BOX, placeholder: facePainter('angry', FACE_COLOR) },
      { key: 'face_bored', file: 'face_bored.png', size: FACE_BOX, placeholder: facePainter('dead', FACE_COLOR) },
      { key: 'face_proud', file: 'face_proud.png', size: FACE_BOX, placeholder: facePainter('happy', FACE_COLOR) },
      { key: 'face_whistle', file: 'face_whistle.png', size: FACE_BOX, placeholder: facePainter('wink', FACE_COLOR) },
      { key: 'face_caught', file: 'face_caught.png', size: FACE_BOX, placeholder: clipPlaceholder(0.45) },
      { key: 'face_glass_press', file: 'face_glass_press.png', size: FACE_BOX, placeholder: facePainter('laughing', FACE_COLOR) },
      { key: 'face_squeeze', file: 'face_squeeze.png', size: FACE_BOX, placeholder: facePainter('angry', FACE_COLOR) },
      { key: 'pick_double', file: 'pick_double.png', size: FACE_BOX, placeholder: clipPlaceholder(1) },
      { key: 'fist', file: 'fist.png', size: 128, height: 171, placeholder: fistPainter },
      { key: 'background', file: 'background.jpg', size: 430, height: 932, fit: 'cover', placeholder: (): void => undefined },
    ]),
  ]);
  const clipFrames = clipSlots.map((slot): Drawable => clip[slot.key] ?? paintDrawable(slot.key, slot.placeholder, FACE_BOX));
  const stills = [s.face_surprised, s.face_angry, s.face_bored, s.face_proud, s.face_whistle, s.face_caught, s.face_glass_press, s.face_squeeze, s.pick_double];
  for (const f of [...clipFrames, ...stills]) toToken(f.source);
  return {
    clip: clipFrames,
    stills,
    fist: s.fist,
    background: s.background,
    ghost: paintDrawable('tap_ghost', ghostPainter, 96, 120),
  };
}

/**
 * Cut a head frame's canvas (in place, idempotent) to the token circle in frame space and fill
 * the disc colour behind the picture: an opaque round porthole that a plain drawImage draws,
 * and that crossfades with any other frame without the one below showing through.
 */
function toToken(c: HTMLCanvasElement): void {
  const g = c.getContext('2d');
  if (!g || c.width === 0) return;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath();
  g.arc(c.width * 0.5, (c.height * FRAME_TOP) / FRAME_SCALE, (c.width * MASK_R) / FRAME_SCALE, 0, Math.PI * 2);
  g.globalCompositeOperation = 'destination-in';
  g.fill();
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = DISC;
  g.fill();
  g.restore();
}

/** "Tap here" hand pointing up with the index finger; the fingertip is at (0.5w, 0.04h). */
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

/** Generic face with the finger at picking depth k (0 = no hand, 0.35 at the nostril, 1 deep). */
function clipPlaceholder(k: number): Painter {
  const base = facePainter(k < 0.6 ? 'normal' : 'nose-pick', FACE_COLOR);
  return (ctx, w, h) => {
    base(ctx, w, h);
    if (k < 0.05) return;
    const ny = h * FRAME.nostrilY;
    const tip = k < 0.35 ? h * 1.05 + (ny - h * 1.05) * (k / 0.35) : ny - h * 0.03 * ((k - 0.35) / 0.65);
    drawFinger(ctx, w * FRAME.nostrilX, tip, w * 0.09, h);
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

/** Free the canvases of the art (they are per game instance): phones release canvas memory late. */
export function freeTapArt(art: TapArt): void {
  for (const d of [...art.clip, ...art.stills, art.fist, art.background, art.ghost]) {
    d.source.width = 0;
    d.source.height = 0;
  }
}
