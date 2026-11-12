/**
 * The party look (retro TV game show / comic sticker, see client/public/assets/shimi/README.md):
 * palette, the Motaleh display font, star-burst shapes and pre-rendered "sticker" text.
 *
 * Everything here is drawn ONCE into small offscreen canvases (2x raster, like the kit's
 * slots) and then only blitted by the game: no text measuring, no gradients, no shadows
 * in the hot path. tap, icy and ninja carry identical copies (games/tap/look.ts ...): the kit
 * has no display-type helper yet, and the kit is not ours to change.
 */
import { drawText, roundRectPath } from '../../kit/canvas';
import { FONT } from '../../kit/theme';

export const PAL = {
  yel: '#FFD21F',
  yel2: '#FFE45A',
  org: '#FF9F0A',
  red: '#F2361B',
  redD: '#B5200A',
  cob: '#1E3FD8',
  cobD: '#10238C',
  cobL: '#4F6CFF',
  ink: '#16120E',
  paper: '#FFF8E6',
  pink: '#FF7EB6',
  white: '#FFFFFF',
} as const satisfies Record<string, string>;

// ───────────────────────────── Display font ─────────────────────────────

const FONT_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/fonts/motaleh.woff2`;
const FONT_TIMEOUT_MS = 1500;
/** Motaleh's glyphs minus ז and the digits (same as the CSS @font-face rules). */
const MOTALEH_RANGE = 'U+0020-002F, U+003A-0040, U+005B-0060, U+007B-007E, U+00A0-00BF, U+0590-05D5, U+05D7-05FF, U+2010-2027, U+20AA';
const FONT_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/fonts`;

/**
 * Heavy Rubik for ז and the digits only, under its own family, so canvas text keeps the heavy look.
 * Uses the page's CSS faces when it has them (the phone page does), else adds its own. Never rejects.
 */
function loadFill(): Promise<void> {
  try {
    let faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Motaleh Fill');
    if (faces.length === 0) {
      faces = [
        new FontFace('Motaleh Fill', `url(${FONT_BASE}/rubik-hebrew.woff2) format('woff2')`, { weight: '800', display: 'swap', unicodeRange: 'U+05D6' }),
        new FontFace('Motaleh Fill', `url(${FONT_BASE}/rubik-latin.woff2) format('woff2')`, { weight: '800', display: 'swap', unicodeRange: 'U+0030-0039' }),
      ];
      for (const f of faces) document.fonts.add(f);
    }
    return Promise.all(faces.map((f) => f.load().catch(() => undefined))).then(() => undefined);
  } catch {
    return Promise.resolve(); // no FontFace API: the system font draws those glyphs
  }
}
/** Motaleh is ready: wait a little for the fill glyphs too (stickers are drawn once and cached). */
function afterFill(fill: Promise<void>, done: () => void): void {
  let called = false;
  const once = (): void => {
    if (called) return;
    called = true;
    done();
  };
  void fill.then(once);
  setTimeout(once, 700);
}

let fontPromise: Promise<boolean> | null = null;
let fontOk = false;

/**
 * Load Motaleh once per page (FontFace API). Resolves true when it is usable, false when
 * it failed or took too long (the kit font is used then). Never rejects.
 */
export function loadDisplayFont(): Promise<boolean> {
  if (fontPromise) return fontPromise;
  fontPromise = new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      fontOk = ok;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), FONT_TIMEOUT_MS);
    try {
      if (typeof FontFace === 'undefined' || !document.fonts) {
        clearTimeout(timer);
        finish(false);
        return;
      }
      const fill = loadFill();
      for (const f of document.fonts) {
        if (f.family.replace(/["']/g, '') === 'Motaleh' && f.status === 'loaded') {
          clearTimeout(timer);
          afterFill(fill, () => finish(true));
          return;
        }
      }
      // not ז (it reads as ב) and not the digits (2 reads as Z): those fall through to the next font
      const face = new FontFace('Motaleh', `url(${FONT_URL}) format('woff2')`, { display: 'swap', unicodeRange: MOTALEH_RANGE });
      face
        .load()
        .then((f) => {
          document.fonts.add(f);
          clearTimeout(timer);
          afterFill(fill, () => finish(true));
        })
        .catch(() => {
          clearTimeout(timer);
          finish(false);
        });
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
  return fontPromise;
}

/** ctx.font for display text: Motaleh (Hebrew + digits) with the kit font behind it. */
export function displayFont(px: number): string {
  return fontOk ? `${px}px Motaleh, 'Motaleh Fill', 'Party Rubik', Rubik, ${FONT}` : `900 ${px}px ${FONT}`;
}

// ───────────────────────────── Shapes ─────────────────────────────

/** Star-burst polygons of the source page, as [x, y] pairs in 0..1 of the box. */
export const STAR14: readonly number[] = [
  0.5, 0, 0.587, 0.12, 0.717, 0.05, 0.743, 0.195, 0.891, 0.188, 0.851, 0.331, 0.987, 0.389, 0.89, 0.5, 0.987, 0.611, 0.851, 0.669, 0.891,
  0.812, 0.743, 0.805, 0.717, 0.95, 0.587, 0.88, 0.5, 1, 0.413, 0.88, 0.283, 0.95, 0.257, 0.805, 0.109, 0.812, 0.149, 0.669, 0.013, 0.611,
  0.11, 0.5, 0.013, 0.389, 0.149, 0.331, 0.109, 0.188, 0.257, 0.195, 0.283, 0.05, 0.413, 0.12,
];
export const STAR10: readonly number[] = [
  0.55, 0.002, 0.633, 0.198, 0.833, 0.127, 0.785, 0.334, 0.989, 0.394, 0.828, 0.533, 0.958, 0.701, 0.746, 0.72, 0.752, 0.932, 0.57, 0.822, 0.45,
  0.998, 0.367, 0.802, 0.167, 0.873, 0.215, 0.666, 0.011, 0.606, 0.172, 0.467, 0.042, 0.299, 0.254, 0.28, 0.248, 0.068, 0.43, 0.178,
];
export const KABOOM: readonly number[] = [
  0.5, 0, 0.58, 0.22, 0.78, 0.06, 0.74, 0.3, 0.98, 0.22, 0.84, 0.44, 1, 0.58, 0.78, 0.64, 0.88, 0.88, 0.64, 0.76, 0.54, 1, 0.44, 0.78, 0.22,
  0.94, 0.26, 0.7, 0, 0.72, 0.14, 0.52, 0, 0.32, 0.24, 0.32, 0.18, 0.08, 0.4, 0.22,
];

/** Polygon path (beginPath included) of `poly` stretched over the box (x, y, w, h). */
export function polyPath(ctx: CanvasRenderingContext2D, poly: readonly number[], x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  for (let i = 0; i < poly.length; i += 2) {
    const px = x + (poly[i] ?? 0) * w;
    const py = y + (poly[i + 1] ?? 0) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Flat sticker shape: hard ink shadow, fill, ink outline. */
export function stickerShape(ctx: CanvasRenderingContext2D, poly: readonly number[], x: number, y: number, w: number, h: number, fill: string, shadow: string = PAL.ink, line = 3): void {
  const d = Math.max(2, Math.min(w, h) * 0.05);
  polyPath(ctx, poly, x + d, y + d, w, h);
  ctx.fillStyle = shadow;
  ctx.fill();
  polyPath(ctx, poly, x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = line;
  ctx.strokeStyle = PAL.ink;
  ctx.stroke();
}

// ───────────────────────────── Sticker text ─────────────────────────────

const RASTER = 2;

export interface Sticker {
  readonly canvas: HTMLCanvasElement;
  /** Logical size in CSS px; draw centred with blit(). */
  readonly w: number;
  readonly h: number;
}

export interface StickerStyle {
  /** Font px. */
  readonly size: number;
  readonly fill?: string;
  /** Hard shadow colour (the second step is always ink). Null = none. */
  readonly shadow?: string | null;
  /** Ink outline width as a share of the size (default 0.16). */
  readonly outline?: number;
  /** Second, smaller line under the first (same style, white). */
  readonly sub?: string;
  readonly subFill?: string;
  /** Star-burst behind the text: its fill colour. */
  readonly burst?: string;
  /** Skew (default 0.12 ≈ 7°) and tilt (default -0.035 rad). */
  readonly skew?: number;
  readonly tilt?: number;
}

function measure(ctx: CanvasRenderingContext2D, text: string, px: number): number {
  ctx.font = displayFont(px);
  return ctx.measureText(text).width;
}

/**
 * Render display text as a sticker into `reuse` (or a new canvas): yellow (or `fill`) text,
 * ink outline, a two-step hard shadow (colour, then ink), skewed and tilted, optionally on a
 * star-burst. Call when the text changes, never per frame.
 */
export function renderSticker(text: string, st: StickerStyle, reuse?: HTMLCanvasElement | null): Sticker {
  const canvas = reuse ?? document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const size = st.size;
  const subSize = Math.round(size * 0.55);
  if (!ctx) return { canvas, w: 1, h: 1 };
  const tw = measure(ctx, text, size);
  const sw = st.sub ? measure(ctx, st.sub, subSize) : 0;
  const outline = (st.outline ?? 0.16) * size;
  const textW = Math.max(tw, sw);
  const textH = size * 1.15 + (st.sub ? subSize * 1.15 : 0);
  const skew = st.skew ?? 0.12;
  const tilt = st.tilt ?? -0.035;
  const pad = outline + size * 0.18 + Math.abs(skew) * textH * 0.5;
  let w = textW + pad * 2;
  let h = textH + pad * 2 + Math.abs(tilt) * textW;
  if (st.burst) {
    const b = Math.max(w, h) * 1.12;
    w = Math.max(w * 1.3, b);
    h = Math.max(h * 1.45, b * 0.8);
  }
  w = Math.ceil(w);
  h = Math.ceil(h);
  canvas.width = Math.round(w * RASTER);
  canvas.height = Math.round(h * RASTER);
  ctx.setTransform(RASTER, 0, 0, RASTER, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (st.burst) stickerShape(ctx, STAR14, w * 0.02, h * 0.02, w * 0.92, h * 0.92, st.burst, PAL.ink, Math.max(2.5, size * 0.07));
  ctx.translate(w / 2, h / 2);
  ctx.rotate(tilt);
  ctx.transform(1, 0, -skew, 1, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const y1 = st.sub ? -subSize * 0.55 : 0;
  const y2 = size * 0.62;
  const lines: Array<[string, number, number, string]> = [[text, size, y1, st.fill ?? PAL.yel]];
  if (st.sub) lines.push([st.sub, subSize, y1 + y2, st.subFill ?? PAL.white]);
  const shadow = st.shadow === undefined ? PAL.red : st.shadow;
  for (const [t, px, y, fill] of lines) {
    ctx.font = displayFont(px);
    const ol = (st.outline ?? 0.16) * px;
    ctx.lineWidth = ol;
    if (shadow) {
      // the two-step hard shadow: colour, then ink further out
      ctx.strokeStyle = PAL.ink;
      ctx.fillStyle = PAL.ink;
      drawText(ctx, t, px * 0.09, y + px * 0.11, true);
      ctx.strokeStyle = shadow;
      ctx.fillStyle = shadow;
      drawText(ctx, t, px * 0.05, y + px * 0.06, true);
    }
    ctx.strokeStyle = PAL.ink;
    ctx.fillStyle = fill;
    drawText(ctx, t, 0, y, true);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, w, h };
}

/** Draw a sticker centred on (x, y), scaled by `k`. */
export function blit(ctx: CanvasRenderingContext2D, s: Sticker, x: number, y: number, k = 1): void {
  const w = s.w * k;
  const h = s.h * k;
  ctx.drawImage(s.canvas, x - w / 2, y - h / 2, w, h);
}

/**
 * A small cache of pre-rendered canvases by key (bounded: the oldest canvas is recycled into
 * the next render). For values that change now and then (floor numbers, combo counts,
 * callouts), never per frame.
 */
export interface StickerCache {
  /** The cached sticker for `key`, rendered by `make` (which may reuse `old`) on a miss. */
  get(key: string, make: (old: HTMLCanvasElement | null) => Sticker): Sticker;
  dispose(): void;
  readonly size: number;
}

export function createStickerCache(cap = 16): StickerCache {
  const map = new Map<string, Sticker>();
  return {
    get(key: string, make: (old: HTMLCanvasElement | null) => Sticker): Sticker {
      const hit = map.get(key);
      if (hit) {
        map.delete(key);
        map.set(key, hit);
        return hit;
      }
      let reuse: HTMLCanvasElement | null = null;
      if (map.size >= cap) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) {
          reuse = map.get(oldest)?.canvas ?? null;
          map.delete(oldest);
        }
      }
      const s = make(reuse);
      map.set(key, s);
      return s;
    },
    dispose(): void {
      for (const s of map.values()) {
        s.canvas.width = 0;
        s.canvas.height = 0;
      }
      map.clear();
    },
    get size(): number {
      return map.size;
    },
  };
}

/**
 * A chip: rounded box with an ink border and a hard ink shadow, display text inside
 * (`text` in `fg`, optional smaller `sub` line under it).
 */
export function renderChip(text: string, px: number, bg: string, fg: string, reuse?: HTMLCanvasElement | null, sub?: string): Sticker {
  const canvas = reuse ?? document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, w: 1, h: 1 };
  ctx.font = displayFont(px);
  let tw = ctx.measureText(text).width;
  const subPx = Math.round(px * 0.62);
  if (sub) {
    ctx.font = displayFont(subPx);
    tw = Math.max(tw, ctx.measureText(sub).width);
  }
  const bw = Math.ceil(tw + px * 1.1);
  const bh = Math.ceil(px * (sub ? 1.95 : 1.45));
  const sh = Math.max(3, Math.round(px * 0.16));
  const w = bw + sh + 3;
  const h = bh + sh + 3;
  canvas.width = w * RASTER;
  canvas.height = h * RASTER;
  ctx.setTransform(RASTER, 0, 0, RASTER, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const r = Math.min(bh / 2, px * 0.6);
  roundRectPath(ctx, 1.5 + sh, 1.5 + sh, bw, bh, r);
  ctx.fillStyle = PAL.ink;
  ctx.fill();
  roundRectPath(ctx, 1.5, 1.5, bw, bh, r);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, px * 0.14);
  ctx.strokeStyle = PAL.ink;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.font = displayFont(px);
  drawText(ctx, text, 1.5 + bw / 2, 1.5 + (sub ? bh * 0.38 : bh / 2 + px * 0.05));
  if (sub) {
    ctx.font = displayFont(subPx);
    drawText(ctx, sub, 1.5 + bw / 2, 1.5 + bh * 0.76);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, w, h };
}

/** Offscreen canvas at `scale` raster for a w x h CSS px box, with the transform set. */
export function makeLayer(w: number, h: number, scale = RASTER): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(scale, 0, 0, scale, 0, 0);
  return { canvas, ctx };
}

/** Halftone dots over a box: radius grows with `amount(x, y)` (0..1). One path, one fill. */
export function halftone(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step: number, color: string, amount: (u: number, v: number) => number): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let j = 0, yy = y; yy < y + h + step; j++, yy += step) {
    const off = j % 2 === 0 ? 0 : step / 2;
    for (let xx = x + off; xx < x + w + step; xx += step) {
      const a = amount((xx - x) / w, (yy - y) / h);
      if (a <= 0.02) continue;
      const r = (step / 2) * Math.min(1, a);
      ctx.moveTo(xx + r, yy);
      ctx.arc(xx, yy, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}
