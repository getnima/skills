/**
 * Art file slots with procedural placeholders.
 *
 * A game (or the TV show) declares slots; loadAssets() uses the real file
 * client/public/assets/<group>/<file> when it exists (also the same base name
 * with .png / .webp / .jpg / .jpeg / .svg) and otherwise the slot's
 * placeholder painter. A missing file costs no request, logs nothing and
 * delays nothing. Tomorrow's real art is dropped into that folder: no code
 * change.
 */
import { roundRectPath } from './canvas';
import { findPublicFile } from './files';

/** Draws into the box (0, 0)-(w, h) in CSS px. */
export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export interface AssetSlot<K extends string = string> {
  readonly key: K;
  /** File name inside /assets/<group>/, e.g. 'face-happy.png'. */
  readonly file: string;
  /** Logical width in CSS px (and height, unless `height` is given). */
  readonly size: number;
  readonly height?: number;
  /** How a real image fills the slot box: 'contain' (default, keeps everything) or 'cover' (crops). */
  readonly fit?: 'contain' | 'cover';
  /** Clip a real image to a circle (handy for photo faces). Placeholders are not clipped. */
  readonly round?: boolean;
  placeholder: Painter;
}

export interface Drawable {
  readonly key: string;
  /** Pre-rendered at 2x: draw it at any size up to about twice the slot size. */
  readonly source: HTMLCanvasElement;
  /** Logical size in CSS px (the slot's size). */
  readonly width: number;
  readonly height: number;
  /** True when no real file was found and the placeholder painter was used. */
  readonly isPlaceholder: boolean;
  /** URL for <img src> / CSS background: the real file, or a data: URL of the placeholder. */
  readonly url: string;
  /**
   * Draw CENTERED on (cx, cy). `w` / `h` default to the logical size (giving
   * only `w` keeps the aspect ratio); `rotation` in radians.
   */
  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, w?: number, h?: number, rotation?: number): void;
}

const RASTER_SCALE = 2;
const IMAGE_EXTS = ['png', 'webp', 'jpg', 'jpeg', 'svg'] as const;
const LOAD_TIMEOUT_MS = 4000;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * RASTER_SCALE));
  canvas.height = Math.max(1, Math.round(h * RASTER_SCALE));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.scale(RASTER_SCALE, RASTER_SCALE);
  return { canvas, ctx };
}

function makeDrawable(key: string, source: HTMLCanvasElement, width: number, height: number, fileUrl: string | null): Drawable {
  let dataUrl: string | null = null;
  return {
    key,
    source,
    width,
    height,
    isPlaceholder: fileUrl === null,
    get url(): string {
      if (fileUrl !== null) return fileUrl;
      if (dataUrl === null) dataUrl = source.toDataURL('image/png');
      return dataUrl;
    },
    draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, w?: number, h?: number, rotation?: number): void {
      const dw = w ?? width;
      const dh = h ?? (w === undefined ? height : (w * height) / width);
      if (rotation) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation);
        ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(source, cx - dw / 2, cy - dh / 2, dw, dh);
      }
    },
  };
}

/** Render a painter into a Drawable right now (no file lookup). */
export function paintDrawable(key: string, painter: Painter, width: number, height: number = width): Drawable {
  const { canvas, ctx } = makeCanvas(width, height);
  try {
    painter(ctx, width, height);
  } catch (err) {
    console.error('[kit] placeholder painter failed:', key, err);
  }
  return makeDrawable(key, canvas, width, height, null);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok && img.naturalWidth > 0 ? img : null);
    };
    const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
    img.decoding = 'async';
    img.onload = (): void => finish(true);
    img.onerror = (): void => finish(false);
    img.src = url;
  });
}

async function loadSlot(group: string, slot: AssetSlot): Promise<Drawable> {
  const w = slot.size;
  const h = slot.height ?? slot.size;
  const url = findPublicFile(`/assets/${group}/${slot.file}`, IMAGE_EXTS);
  if (url !== null) {
    const img = await loadImage(url);
    if (img) {
      try {
        const { canvas, ctx } = makeCanvas(w, h);
        // an SVG without intrinsic size reports 0: treat it as the slot box
        const iw = img.naturalWidth || w;
        const ih = img.naturalHeight || h;
        const scale = slot.fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        if (slot.round) {
          ctx.beginPath();
          ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          ctx.clip();
        }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        return makeDrawable(slot.key, canvas, w, h, url);
      } catch {
        // fall through to the placeholder
      }
    }
  }
  return paintDrawable(slot.key, slot.placeholder, w, h);
}

/**
 * Load every slot of a group. Resolves with one Drawable per slot key; never
 * rejects (a broken or slow file falls back to its placeholder).
 *
 *   const art = await loadAssets('tap', [
 *     { key: 'face', file: 'face.png', size: 220, placeholder: facePainter('normal') },
 *   ]);
 *   art.face.draw(ctx, x, y);
 */
export async function loadAssets<const S extends readonly AssetSlot[]>(
  group: string,
  slots: S,
): Promise<Record<S[number]['key'], Drawable>> {
  const list = await Promise.all(slots.map((slot) => loadSlot(group, slot)));
  const out: Record<string, Drawable> = {};
  for (const d of list) out[d.key] = d;
  return out as Record<S[number]['key'], Drawable>;
}

/** URL of the real file of a slot when it exists, else null. Sync; for DOM code that wants its own fallback. */
export function assetFileUrl(group: string, file: string): string | null {
  return findPublicFile(`/assets/${group}/${file}`, IMAGE_EXTS);
}

// ───────────────────────────── Placeholder painters ─────────────────────────────

export const FACE_EXPRESSIONS = [
  'normal',
  'happy',
  'surprised',
  'angry',
  'tongue',
  'wink',
  'nose-pick',
  'dead',
  'laughing',
  'shocked',
] as const;
export type FaceExpression = (typeof FACE_EXPRESSIONS)[number];

/** Lighten (amount > 0) or darken (amount < 0) a #rrggbb color; amount in -1..1. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return hex;
  const n = parseInt(m[1], 16);
  const target = amount >= 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(amount));
  const ch = (v: number): number => Math.round(v + (target - v) * k);
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

const INK = '#2b1436';

/**
 * Generic cartoon face (nobody in particular), centered on (cx, cy) with head
 * radius r. Leave ~10% margin around it for the outline and the extras.
 */
export function drawFace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  expression: FaceExpression = 'normal',
  color = '#ffc93c',
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r, r);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // head
  const grad = ctx.createRadialGradient(-0.3, -0.4, 0.1, 0, 0, 1.05);
  grad.addColorStop(0, shade(color, 0.35));
  grad.addColorStop(0.6, color);
  grad.addColorStop(1, shade(color, -0.22));
  ctx.fillStyle = grad;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.arc(0, 0, 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // cheeks
  ctx.fillStyle = 'rgba(255, 90, 120, 0.32)';
  ctx.beginPath();
  ctx.ellipse(-0.58, 0.22, 0.16, 0.1, 0, 0, Math.PI * 2);
  ctx.ellipse(0.58, 0.22, 0.16, 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  const eyeY = -0.2;
  const eyeX = 0.36;

  const openEye = (x: number, ry: number, pupil: number, lookX = 0, lookY = 0): void => {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.ellipse(x, eyeY, 0.2, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x + lookX, eyeY + lookY, pupil, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + lookX - pupil * 0.3, eyeY + lookY - pupil * 0.35, pupil * 0.3, 0, Math.PI * 2);
    ctx.fill();
  };
  /** Closed happy eye: an arc pointing up (dir -1) or down (dir 1). */
  const arcEye = (x: number, dir: number): void => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(x - 0.19, eyeY - dir * 0.05);
    ctx.quadraticCurveTo(x, eyeY + dir * 0.2, x + 0.19, eyeY - dir * 0.05);
    ctx.stroke();
  };
  const crossEye = (x: number): void => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(x - 0.15, eyeY - 0.15);
    ctx.lineTo(x + 0.15, eyeY + 0.15);
    ctx.moveTo(x + 0.15, eyeY - 0.15);
    ctx.lineTo(x - 0.15, eyeY + 0.15);
    ctx.stroke();
  };
  /** Squeezed eye: > or <. */
  const squeezeEye = (x: number, dir: number): void => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(x - dir * 0.16, eyeY - 0.14);
    ctx.lineTo(x + dir * 0.12, eyeY);
    ctx.lineTo(x - dir * 0.16, eyeY + 0.14);
    ctx.stroke();
  };
  const brow = (x: number, tilt: number, lift: number): void => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.08;
    const side = x < 0 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(x - 0.2, eyeY - 0.36 - lift + side * tilt);
    ctx.lineTo(x + 0.2, eyeY - 0.36 - lift - side * tilt);
    ctx.stroke();
  };
  const smile = (width: number, depth: number, y = 0.42): void => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(-width, y);
    ctx.quadraticCurveTo(0, y + depth, width, y);
    ctx.stroke();
  };
  /** Open mouth: half disc with teeth on top and a tongue hill. */
  const openMouth = (width: number, depth: number, y = 0.34): void => {
    ctx.fillStyle = '#5a1030';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(-width, y);
    ctx.quadraticCurveTo(0, y + depth * 2, width, y);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-width, y, width * 2, depth * 0.3);
    ctx.fillStyle = '#ff6b8f';
    ctx.beginPath();
    ctx.ellipse(0, y + depth * 1.05, width * 0.55, depth * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.stroke();
  };
  const tongueOut = (x: number, y: number, len: number, angle = 0): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = '#ff6b8f';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(-0.13, 0);
    ctx.lineTo(-0.13, len - 0.13);
    ctx.arc(0, len - 0.13, 0.13, Math.PI, 0, true);
    ctx.lineTo(0.13, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0.04);
    ctx.lineTo(0, len - 0.16);
    ctx.stroke();
    ctx.restore();
  };
  const nose = (): void => {
    ctx.fillStyle = shade(color, -0.2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.045;
    ctx.beginPath();
    ctx.ellipse(0, 0.1, 0.13, 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };

  switch (expression) {
    case 'normal':
      openEye(-eyeX, 0.24, 0.1);
      openEye(eyeX, 0.24, 0.1);
      nose();
      smile(0.3, 0.2);
      break;
    case 'happy':
      arcEye(-eyeX, -1);
      arcEye(eyeX, -1);
      nose();
      openMouth(0.42, 0.24);
      break;
    case 'surprised':
      brow(-eyeX, 0, 0.1);
      brow(eyeX, 0, 0.1);
      openEye(-eyeX, 0.29, 0.07);
      openEye(eyeX, 0.29, 0.07);
      nose();
      ctx.fillStyle = '#5a1030';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.ellipse(0, 0.52, 0.15, 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'angry':
      openEye(-eyeX, 0.18, 0.1, 0.03, 0.02);
      openEye(eyeX, 0.18, 0.1, -0.03, 0.02);
      brow(-eyeX, -0.13, -0.14);
      brow(eyeX, -0.13, -0.14);
      nose();
      smile(0.3, -0.2, 0.56);
      break;
    case 'tongue':
      openEye(-eyeX, 0.24, 0.1);
      squeezeEye(eyeX, -1);
      nose();
      smile(0.34, 0.16, 0.4);
      tongueOut(0.06, 0.47, 0.34, -0.15);
      break;
    case 'wink':
      openEye(-eyeX, 0.24, 0.1, 0.03, 0);
      arcEye(eyeX, -1);
      brow(-eyeX, 0.06, 0.06);
      nose();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(-0.26, 0.46);
      ctx.quadraticCurveTo(0.1, 0.64, 0.36, 0.36);
      ctx.stroke();
      break;
    case 'nose-pick': {
      openEye(-eyeX, 0.24, 0.1, 0.06, -0.1);
      openEye(eyeX, 0.24, 0.1, 0.06, -0.1);
      brow(-eyeX, 0.08, 0.06);
      brow(eyeX, -0.04, 0.02);
      nose();
      // a pleased little mouth, pushed aside
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(-0.42, 0.5);
      ctx.quadraticCurveTo(-0.28, 0.62, -0.1, 0.52);
      ctx.stroke();
      // the hand: a fist with one finger going up the nose
      const skin = shade(color, 0.18);
      ctx.fillStyle = skin;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.055;
      ctx.save();
      ctx.translate(0.07, 0.16);
      ctx.rotate(0.5);
      roundRectPath(ctx, -0.075, 0, 0.15, 0.5, 0.075);
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, -0.24, 0.42, 0.5, 0.4, 0.16);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.08, 0.5);
      ctx.lineTo(-0.08, 0.68);
      ctx.moveTo(0.08, 0.5);
      ctx.lineTo(0.08, 0.68);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'dead':
      crossEye(-eyeX);
      crossEye(eyeX);
      nose();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(-0.32, 0.5);
      ctx.bezierCurveTo(-0.16, 0.4, -0.08, 0.6, 0.08, 0.5);
      ctx.bezierCurveTo(0.16, 0.44, 0.24, 0.54, 0.32, 0.5);
      ctx.stroke();
      tongueOut(0.2, 0.5, 0.3, -0.5);
      break;
    case 'laughing':
      squeezeEye(-eyeX, 1);
      squeezeEye(eyeX, -1);
      nose();
      openMouth(0.48, 0.3, 0.3);
      // tears
      ctx.fillStyle = '#6fd3ff';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.04;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.66, -0.2);
        ctx.quadraticCurveTo(side * 0.86, 0.02, side * 0.72, 0.08);
        ctx.quadraticCurveTo(side * 0.58, 0.04, side * 0.66, -0.2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'shocked': {
      // blue forehead of doom
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, 0.91, 0, Math.PI * 2);
      ctx.clip();
      const doom = ctx.createLinearGradient(0, -0.95, 0, -0.25);
      doom.addColorStop(0, 'rgba(60, 90, 220, 0.75)');
      doom.addColorStop(1, 'rgba(60, 90, 220, 0)');
      ctx.fillStyle = doom;
      ctx.fillRect(-1, -1, 2, 0.8);
      ctx.restore();
      brow(-eyeX, 0.1, 0.14);
      brow(eyeX, 0.1, 0.14);
      openEye(-eyeX, 0.31, 0.045);
      openEye(eyeX, 0.31, 0.045);
      nose();
      ctx.fillStyle = '#5a1030';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.06;
      roundRectPath(ctx, -0.3, 0.34, 0.6, 0.36, 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-0.24, 0.37, 0.48, 0.09);
      ctx.fillRect(-0.24, 0.58, 0.48, 0.09);
      break;
    }
    default: {
      const _exhaustive: never = expression;
      throw new Error(`Unhandled expression: ${String(_exhaustive)}`);
    }
  }
  ctx.restore();
}

/** Painter of a cartoon face filling the slot box. */
export function facePainter(expression: FaceExpression = 'normal', color = '#ffc93c'): Painter {
  return (ctx, w, h): void => drawFace(ctx, w / 2, h / 2, Math.min(w, h) * 0.46, expression, color);
}

/** Round black bomb with a lit fuse. */
export const bombPainter: Painter = (ctx, w, h) => {
  const s = Math.min(w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(s / 2, s / 2);
  ctx.lineCap = 'round';
  // fuse
  ctx.strokeStyle = '#c9a26b';
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  ctx.moveTo(0.28, -0.52);
  ctx.quadraticCurveTo(0.42, -0.86, 0.66, -0.74);
  ctx.stroke();
  // cap
  ctx.fillStyle = '#4b4560';
  ctx.strokeStyle = '#12101c';
  ctx.lineWidth = 0.05;
  ctx.save();
  ctx.translate(0.24, -0.5);
  ctx.rotate(0.45);
  roundRectPath(ctx, -0.17, -0.12, 0.34, 0.24, 0.05);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // body
  const g = ctx.createRadialGradient(-0.26, -0.2, 0.05, 0, 0.12, 0.74);
  g.addColorStop(0, '#6a6485');
  g.addColorStop(0.45, '#2a2638');
  g.addColorStop(1, '#0d0b14');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(-0.04, 0.16, 0.68, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // shine
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.arc(-0.04, 0.16, 0.5, Math.PI * 1.08, Math.PI * 1.4);
  ctx.stroke();
  // spark
  ctx.translate(0.68, -0.74);
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const rr = i % 2 === 0 ? 0.24 : 0.09;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff5a2a';
  ctx.beginPath();
  ctx.arc(0, 0, 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

/** Golden crown with three gems. */
export const crownPainter: Painter = (ctx, w, h) => {
  const s = Math.min(w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(s / 2, s / 2);
  ctx.lineJoin = 'round';
  const g = ctx.createLinearGradient(0, -0.6, 0, 0.6);
  g.addColorStop(0, '#fff07a');
  g.addColorStop(0.5, '#ffc21a');
  g.addColorStop(1, '#e08a00');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#7a4300';
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.moveTo(-0.8, 0.56);
  ctx.lineTo(-0.88, -0.34);
  ctx.lineTo(-0.44, 0.06);
  ctx.lineTo(0, -0.62);
  ctx.lineTo(0.44, 0.06);
  ctx.lineTo(0.88, -0.34);
  ctx.lineTo(0.8, 0.56);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e08a00';
  ctx.fillRect(-0.78, 0.36, 1.56, 0.1);
  const gem = (x: number, y: number, r: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  };
  ctx.lineWidth = 0.045;
  gem(-0.88, -0.38, 0.1, '#ff3d8b');
  gem(0, -0.66, 0.12, '#2de2e6');
  gem(0.88, -0.38, 0.1, '#ff3d8b');
  gem(0, 0.18, 0.13, '#ff4d5e');
  gem(-0.46, 0.22, 0.08, '#3ddc84');
  gem(0.46, 0.22, 0.08, '#3ddc84');
  ctx.restore();
};

/** Chunky five-point star. */
export function starPainter(color = '#ffd23f'): Painter {
  return (ctx, w, h): void => {
    const s = Math.min(w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2 + s * 0.03);
    ctx.scale(s / 2, s / 2);
    ctx.lineJoin = 'round';
    const g = ctx.createRadialGradient(-0.2, -0.3, 0.05, 0, 0, 0.95);
    g.addColorStop(0, shade(color, 0.5));
    g.addColorStop(0.6, color);
    g.addColorStop(1, shade(color, -0.2));
    ctx.fillStyle = g;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 === 0 ? 0.88 : 0.44;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
}
