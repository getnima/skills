/**
 * Picture sprites of the icy tower: ledges assembled from a 3-slice picture, icicles, and the
 * "sticker" finish (ink outline + hard shadow cut from the picture's own silhouette) that makes
 * a toy photo sit with the comic UI. Everything here runs when a sprite is first needed, never
 * per frame: the game only blits the results. Pure drawing, no game state.
 */
import { ICICLE_CELLS, ICICLE_CELL_H, ICICLE_CELL_W } from './art';
import { PAL } from './look';

import type { Drawable } from '../../kit/assets';
import type { FloorSlice } from './art';

/** Two work canvases shared by every pre-render of one game instance. */
export interface Scratch {
  readonly a: HTMLCanvasElement;
  readonly b: HTMLCanvasElement;
  dispose(): void;
}

export function createScratch(): Scratch {
  const a = document.createElement('canvas');
  const b = document.createElement('canvas');
  a.width = a.height = b.width = b.height = 1;
  return {
    a,
    b,
    dispose(): void {
      a.width = a.height = b.width = b.height = 0;
    },
  };
}

function hash(a: number, b: number): number {
  let h = Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35);
  h ^= h >>> 13;
  return (Math.imul(h, 0x27d4eb2f) >>> 0) / 4294967296;
}

/**
 * Draw a ledge of `w` x `h` CSS px with its top-left at (0, 0) from the 3-slice picture `pic`:
 * the caps at their own width, between them whole pieces of the repeating middle (from one cut
 * to the next, starting at a piece picked by `seed`, wrapping around) scaled a little so they
 * fill the gap exactly. `snap` = device pixels per CSS px (piece edges land on whole pixels).
 */
export function drawSlicedLedge(g: CanvasRenderingContext2D, pic: Drawable, sl: FloorSlice, w: number, h: number, seed: number, snap: number): void {
  const src = pic.source;
  const fx = src.width / sl.w;
  const sh = src.height;
  const k = h / sl.h;
  const f = sl.feather;
  const capL = sl.capL * k;
  const capR = sl.capR * k;
  const px = (v: number): number => Math.round(v * snap) / snap;
  g.imageSmoothingQuality = 'high';
  if (w <= capL + capR - 2 * f * k + 4) {
    // too short for a middle: the two caps, squeezed
    const half = px(w / 2);
    g.drawImage(src, 0, 0, (sl.capL - f) * fx, sh, 0, 0, half, h);
    g.drawImage(src, (sl.w - sl.capR + f) * fx, 0, (sl.capR - f) * fx, sh, half, 0, w - half, h);
    return;
  }
  // the middle runs under the feathered inner edge of each cap
  const x0 = px(capL - f * k);
  const x1 = px(w - capR + f * k);
  const need = (x1 - x0) / k;
  // pieces of the middle, in picture pixels
  const edges: number[] = [sl.capL, ...sl.cuts, sl.w - sl.capR];
  const n = edges.length - 1;
  const first = Math.floor(hash(seed, 7) * n) % n;
  // start at the seeded piece; if its run would have to stretch or squeeze too much, try the
  // next starts and keep the one that fits best
  let start = first;
  let total = 1;
  let count = 1;
  let bestFit = Infinity;
  for (let t = 0; t < n; t++) {
    const st = (first + t) % n;
    let tot = 0;
    let cnt = 0;
    for (let i = 0; i < 64; i++) {
      const j = (st + i) % n;
      const len = (edges[j + 1] ?? 0) - (edges[j] ?? 0);
      // stop when one more piece would overshoot by more than stopping here undershoots
      if (cnt > 0 && Math.abs(tot + len - need) > Math.abs(tot - need)) break;
      tot += len;
      cnt++;
    }
    const fit = Math.abs(Math.log(need / tot));
    if (fit < bestFit) {
      bestFit = fit;
      start = st;
      total = tot;
      count = cnt;
    }
    if (fit < 0.2) break;
  }
  const s = need / total;
  let x = x0;
  let run = 0;
  for (let i = 0; i < count; i++) {
    const j = (start + i) % n;
    const a = edges[j] ?? 0;
    const len = (edges[j + 1] ?? 0) - a;
    run += len;
    const xe = i === count - 1 ? x1 : px(x0 + run * s * k);
    g.drawImage(src, a * fx, 0, len * fx, sh, x, 0, xe - x, h);
    x = xe;
  }
  g.drawImage(src, 0, 0, sl.capL * fx, sh, 0, 0, capL, h);
  g.drawImage(src, (sl.w - sl.capR) * fx, 0, sl.capR * fx, sh, w - capR, 0, capR, h);
}

/**
 * Icicles hanging under a ledge of `w` x `h` CSS px whose top-left is (0, 0): a seeded sprinkle
 * of cells from the strip (`amount` 0..1 = how crowded, `size` = length against the ledge's
 * height). Draw BEFORE the ledge so the roots hide behind its bottom edge.
 */
export function drawIcicles(g: CanvasRenderingContext2D, strip: Drawable, w: number, h: number, seed: number, amount: number, size: number): void {
  const src = strip.source;
  const cw = src.width / ICICLE_CELLS;
  const step = h * 0.3;
  const inset = h * 0.45;
  let i = 0;
  for (let x = inset; x < w - inset - step * 0.5; x += step, i++) {
    // clusters: the chance swells and fades along the ledge
    const wave = 0.5 + 0.5 * Math.sin(i * 0.9 + hash(seed, 3) * 6.28);
    if (hash(seed, 11 + i) > amount * (0.35 + wave)) continue;
    const cell = Math.floor(hash(seed, 101 + i) * ICICLE_CELLS) % ICICLE_CELLS;
    const kk = size * (0.65 + hash(seed, 211 + i) * 0.5);
    const ih = h * kk;
    const iw = (ih * ICICLE_CELL_W) / ICICLE_CELL_H;
    g.drawImage(src, cell * cw, 0, cw, src.height, x + (hash(seed, 307 + i) - 0.5) * step * 0.5 - iw / 2 + step / 2, h - Math.max(2, h * 0.1), iw, ih);
  }
}

export interface StickerFinish {
  /** Ink outline width in CSS px (0 = none). */
  readonly outline: number;
  /** Hard shadow offset in CSS px and its opacity (0 = none). */
  readonly shadowX: number;
  readonly shadowY: number;
  readonly shadowAlpha: number;
}

/**
 * Paint a picture with the sticker finish into `g` at (0, 0): `paint` draws the picture into a
 * work canvas of `w` x `h` CSS px, then its silhouette is stamped in ink around it (outline)
 * and offset under it (hard shadow), and the picture goes on top. `raster` = device px per CSS px.
 */
export function stampSticker(g: CanvasRenderingContext2D, scratch: Scratch, w: number, h: number, raster: number, fin: StickerFinish, paint: (c: CanvasRenderingContext2D) => void): void {
  const { a, b } = scratch;
  const pw = Math.max(1, Math.ceil(w * raster));
  const ph = Math.max(1, Math.ceil(h * raster));
  // setting the size clears the canvas
  a.width = pw;
  a.height = ph;
  b.width = pw;
  b.height = ph;
  const ca = a.getContext('2d');
  const cb = b.getContext('2d');
  if (!ca || !cb) return;
  ca.setTransform(raster, 0, 0, raster, 0, 0);
  paint(ca);
  // ink silhouette
  cb.drawImage(a, 0, 0);
  cb.globalCompositeOperation = 'source-in';
  cb.fillStyle = PAL.ink;
  cb.fillRect(0, 0, pw, ph);
  cb.globalCompositeOperation = 'source-over';
  const dw = pw / raster;
  const dh = ph / raster;
  if (fin.shadowAlpha > 0) {
    g.globalAlpha = fin.shadowAlpha;
    g.drawImage(b, fin.shadowX, fin.shadowY, dw, dh);
    g.globalAlpha = 1;
  }
  if (fin.outline > 0) {
    const o = fin.outline;
    const d = o * 0.7071;
    g.drawImage(b, -o, 0, dw, dh);
    g.drawImage(b, o, 0, dw, dh);
    g.drawImage(b, 0, -o, dw, dh);
    g.drawImage(b, 0, o, dw, dh);
    g.drawImage(b, -d, -d, dw, dh);
    g.drawImage(b, d, -d, dw, dh);
    g.drawImage(b, -d, d, dw, dh);
    g.drawImage(b, d, d, dw, dh);
  }
  g.drawImage(a, 0, 0, dw, dh);
}
