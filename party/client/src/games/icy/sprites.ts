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
 * A picture with its sticker finish baked around it once (ink outline ring + hard shadow outside
 * its silhouette, nothing behind its inside), at the size it is drawn. `pad*` = the margins
 * around the picture, in the picture's own pixels; `k` = baked pixels per picture pixel.
 */
export interface Baked {
  readonly canvas: HTMLCanvasElement;
  readonly k: number;
  readonly padL: number;
  readonly padT: number;
  readonly padR: number;
  readonly padB: number;
}

/**
 * Bake `pic` (`pw` x `ph` picture px) drawn at `kd` CSS px per picture px, `raster` device px
 * per CSS px, with the finish `fin`. Runs once per layout, never per frame.
 */
export function bakeFinish(src: HTMLCanvasElement, pw: number, ph: number, kd: number, raster: number, fin: StickerFinish, scratch: Scratch): Baked {
  const o = fin.outline;
  const mL = o + 1;
  const mT = o + 1;
  const mR = o + 1 + Math.max(0, fin.shadowX);
  const mB = o + 1 + Math.max(0, fin.shadowY);
  const w = pw * kd;
  const h = ph * kd;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((w + mL + mR) * raster));
  canvas.height = Math.max(1, Math.ceil((h + mT + mB) * raster));
  const g = canvas.getContext('2d');
  const out: Baked = { canvas, k: kd * raster, padL: mL / kd, padT: mT / kd, padR: mR / kd, padB: mB / kd };
  if (!g) return out;
  const { a, b } = scratch;
  const cw = canvas.width;
  const ch = canvas.height;
  if (a.width < cw || a.height < ch) {
    a.width = b.width = Math.max(a.width, cw);
    a.height = b.height = Math.max(a.height, ch);
  }
  const ca = a.getContext('2d');
  const cb = b.getContext('2d');
  if (!ca || !cb) return out;
  ca.setTransform(1, 0, 0, 1, 0, 0);
  ca.clearRect(0, 0, cw, ch);
  cb.setTransform(1, 0, 0, 1, 0, 0);
  cb.clearRect(0, 0, cw, ch);
  ca.imageSmoothingQuality = 'high';
  ca.drawImage(src, mL * raster, mT * raster, w * raster, h * raster);
  // the silhouette, solid (a see-through edge or a faded cap end counts as inside), in ink
  let solid = true;
  try {
    const img = ca.getImageData(0, 0, cw, ch);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const on = (d[i + 3] ?? 0) > 2;
      d[i] = 22;
      d[i + 1] = 18;
      d[i + 2] = 14;
      d[i + 3] = on ? 255 : 0;
    }
    cb.putImageData(img, 0, 0);
  } catch {
    solid = false;
    cb.drawImage(a, 0, 0);
    cb.globalCompositeOperation = 'source-in';
    cb.fillStyle = PAL.ink;
    cb.fillRect(0, 0, cw, ch);
    cb.globalCompositeOperation = 'source-over';
  }
  const stamp = (c: HTMLCanvasElement, x: number, y: number): void => g.drawImage(c, 0, 0, cw, ch, x * raster, y * raster, cw, ch);
  if (fin.shadowAlpha > 0) {
    g.globalAlpha = fin.shadowAlpha;
    stamp(b, fin.shadowX, fin.shadowY);
    g.globalAlpha = 1;
  }
  if (o > 0) {
    const dd = o * 0.7071;
    for (const [x, y] of [[-o, 0], [o, 0], [0, -o], [0, o], [-dd, -dd], [dd, -dd], [-dd, dd], [dd, dd]] as const) stamp(b, x, y);
  }
  // nothing behind the inside: a faded cap end must show the ledge under it, not ink
  if (solid) {
    g.globalCompositeOperation = 'destination-out';
    stamp(b, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
  stamp(a, 0, 0);
  return out;
}

/**
 * Draw a ledge of `w` x `h` CSS px with its top-left at (0, 0) from the baked 3-slice picture
 * (its finish spills outside the box): the caps at their own width, between them whole pieces of
 * the repeating middle (from one cut to the next, starting at a piece picked by `seed`, wrapping
 * around) scaled a little so they fill the gap exactly. `snap` = device pixels per CSS px.
 */
export function drawSlicedLedge(g: CanvasRenderingContext2D, bk: Baked, sl: FloorSlice, w: number, h: number, seed: number, snap: number): void {
  const src = bk.canvas;
  const k = h / sl.h;
  const sk = bk.k;
  const f = sl.feather;
  const capL = sl.capL * k;
  const capR = sl.capR * k;
  const y0 = -bk.padT * k;
  const fh = (bk.padT + sl.h + bk.padB) * k;
  const sh = src.height;
  const px = (v: number): number => Math.round(v * snap) / snap;
  // source x of a picture x, in the baked canvas
  const sx = (v: number): number => (bk.padL + v) * sk;
  if (w <= capL + capR - 2 * f * k + 4) {
    // too short for a middle: the two caps, squeezed
    const half = px(w / 2);
    g.drawImage(src, 0, 0, sx(sl.capL - f), sh, -bk.padL * k, y0, half + bk.padL * k, fh);
    g.drawImage(src, sx(sl.w - sl.capR + f), 0, src.width - sx(sl.w - sl.capR + f), sh, half, y0, w - half + bk.padR * k, fh);
    return;
  }
  // the middle runs under the feathered inner edge of each cap
  const x0 = px(capL - f * k);
  const x1 = px(w - capR + f * k);
  const need = (x1 - x0) / k;
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
    g.drawImage(src, sx(a), 0, len * sk, sh, x, y0, xe - x, fh);
    x = xe;
  }
  g.drawImage(src, 0, 0, sx(sl.capL), sh, -bk.padL * k, y0, capL + bk.padL * k, fh);
  g.drawImage(src, sx(sl.w - sl.capR), 0, src.width - sx(sl.w - sl.capR), sh, w - capR, y0, capR + bk.padR * k, fh);
}

/** The icicle strip baked with an ink outline, one cell at a time (each cell keeps its own margin). */
export interface BakedIcicles {
  readonly cells: readonly Baked[];
}

export function bakeIcicles(strip: Drawable, cellH: number, raster: number, outline: number, scratch: Scratch): BakedIcicles {
  const cw = strip.source.width / ICICLE_CELLS;
  const one = document.createElement('canvas');
  one.width = Math.max(1, Math.round(cw));
  one.height = strip.source.height;
  const g = one.getContext('2d');
  const cells: Baked[] = [];
  const kd = cellH / ICICLE_CELL_H;
  for (let i = 0; i < ICICLE_CELLS && g; i++) {
    g.clearRect(0, 0, one.width, one.height);
    g.drawImage(strip.source, i * cw, 0, cw, strip.source.height, 0, 0, one.width, one.height);
    cells.push(bakeFinish(one, ICICLE_CELL_W, ICICLE_CELL_H, kd, raster, { outline, shadowX: 0, shadowY: 0, shadowAlpha: 0 }, scratch));
  }
  one.width = one.height = 0;
  return { cells };
}

/**
 * Icicles hanging under a ledge of `w` x `h` CSS px whose top-left is (0, 0): a seeded sprinkle
 * of baked cells (`amount` 0..1 = how crowded, `size` = length against the ledge's height).
 * Draw BEFORE the ledge so the roots hide behind its bottom edge.
 */
export function drawIcicles(g: CanvasRenderingContext2D, ic: BakedIcicles, w: number, h: number, seed: number, amount: number, size: number): void {
  const step = h * 0.3;
  const inset = h * 0.45;
  let i = 0;
  for (let x = inset; x < w - inset - step * 0.5; x += step, i++) {
    // clusters: the chance swells and fades along the ledge
    const wave = 0.5 + 0.5 * Math.sin(i * 0.9 + hash(seed, 3) * 6.28);
    if (hash(seed, 11 + i) > amount * (0.35 + wave)) continue;
    const cell = ic.cells[Math.floor(hash(seed, 101 + i) * ICICLE_CELLS) % ICICLE_CELLS];
    if (!cell) continue;
    const ih = h * size * (0.65 + hash(seed, 211 + i) * 0.5);
    const kk = ih / ICICLE_CELL_H;
    const iw = ICICLE_CELL_W * kk;
    const cx = x + (hash(seed, 307 + i) - 0.5) * step * 0.5 - iw / 2 + step / 2;
    const cy = h - Math.max(2, h * 0.1);
    g.drawImage(cell.canvas, cx - cell.padL * kk, cy - cell.padT * kk, (cell.padL + ICICLE_CELL_W + cell.padR) * kk, (cell.padT + ICICLE_CELL_H + cell.padB) * kk);
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
  // the work canvases only ever grow (a resize reallocates); the used corner is cleared instead
  if (a.width < pw || a.height < ph) {
    a.width = b.width = Math.max(a.width, pw);
    a.height = b.height = Math.max(a.height, ph);
  }
  const ca = a.getContext('2d');
  const cb = b.getContext('2d');
  if (!ca || !cb) return;
  ca.setTransform(1, 0, 0, 1, 0, 0);
  ca.clearRect(0, 0, pw, ph);
  cb.setTransform(1, 0, 0, 1, 0, 0);
  cb.clearRect(0, 0, pw, ph);
  ca.setTransform(raster, 0, 0, raster, 0, 0);
  paint(ca);
  // ink silhouette
  cb.drawImage(a, 0, 0, pw, ph, 0, 0, pw, ph);
  cb.globalCompositeOperation = 'source-in';
  cb.fillStyle = PAL.ink;
  cb.fillRect(0, 0, pw, ph);
  cb.globalCompositeOperation = 'source-over';
  const dw = pw / raster;
  const dh = ph / raster;
  const stamp = (src: HTMLCanvasElement, x: number, y: number): void => g.drawImage(src, 0, 0, pw, ph, x, y, dw, dh);
  if (fin.shadowAlpha > 0) {
    g.globalAlpha = fin.shadowAlpha;
    stamp(b, fin.shadowX, fin.shadowY);
    g.globalAlpha = 1;
  }
  if (fin.outline > 0) {
    const o = fin.outline;
    const d = o * 0.7071;
    stamp(b, -o, 0);
    stamp(b, o, 0);
    stamp(b, 0, -o);
    stamp(b, 0, o);
    stamp(b, -d, -d);
    stamp(b, d, -d);
    stamp(b, -d, d);
    stamp(b, d, d);
  }
  stamp(a, 0, 0);
}
