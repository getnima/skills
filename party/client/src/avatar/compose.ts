/**
 * The compositor: a look -> one square picture (plate + doll + accessories), and a cache of
 * object URLs for <img>. Every picture file is loaded once; nothing here throws.
 */
import { decodeLook, lookKey } from '../../../shared/avatar';
import { DOLL, ITEMS, getBg, normalizeLook } from './catalog';
import { frameLook, layoutLook } from './layout';

import type { AvatarLook } from '../../../shared/avatar';
import type { AvatarBg } from './catalog';
import type { AvatarCrop } from './layout';

export type { AvatarCrop } from './layout';

type Source = HTMLImageElement | HTMLCanvasElement;

interface Pic {
  width: number;
  height: number;
  /** mips[k] is the picture at 1 / 2^k of its size (built on demand). */
  mips: Source[];
}

/* ───────────────────────── pictures: loaded once ───────────────────────── */

const pics = new Map<string, Pic>();
const failedAt = new Map<string, number>();
const loading = new Map<string, Promise<Pic | null>>();
/** A picture that failed to load is tried again after this long (weak party wifi). */
const RETRY_MS = 8000;

function loadPic(url: string): Promise<Pic | null> {
  const have = pics.get(url);
  if (have !== undefined) return Promise.resolve(have);
  const failed = failedAt.get(url);
  if (failed !== undefined && Date.now() - failed < RETRY_MS) return Promise.resolve(null);
  const running = loading.get(url);
  if (running !== undefined) return running;
  const p = new Promise<Pic | null>((resolve) => {
    let img: HTMLImageElement;
    try {
      img = new Image();
    } catch {
      resolve(null);
      return;
    }
    const done = (ok: boolean): void => {
      loading.delete(url);
      if (ok && img.naturalWidth > 0) {
        const pic: Pic = { width: img.naturalWidth, height: img.naturalHeight, mips: [img] };
        pics.set(url, pic);
        failedAt.delete(url);
        resolve(pic);
      } else {
        failedAt.set(url, Date.now());
        resolve(null);
      }
    };
    img.decoding = 'async';
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  });
  loading.set(url, p);
  return p;
}

function lookFiles(look: AvatarLook): string[] {
  return [DOLL.file, ...layoutLook(look).map((p) => p.item.file)];
}

/** Loads the doll and every accessory picture (about 4 MB, once). Never rejects. */
export function preloadAvatarAssets(): Promise<void> {
  return Promise.all([DOLL.file, ...ITEMS.map((i) => i.file)].map(loadPic)).then(() => undefined);
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** The smallest half-size copy that is still at least `dw` wide: fast and smooth when drawn tiny. */
function mipFor(pic: Pic, dw: number): Source {
  let k = 0;
  while (pic.width / 2 ** (k + 1) >= dw && pic.width / 2 ** (k + 1) >= 16 && k < 6) k++;
  for (let i = pic.mips.length; i <= k; i++) {
    const prev = pic.mips[i - 1];
    if (prev === undefined) break;
    const c = makeCanvas(pic.width / 2 ** i, pic.height / 2 ** i);
    const g = c.getContext('2d');
    if (g === null) break;
    g.imageSmoothingQuality = 'high';
    g.drawImage(prev, 0, 0, c.width, c.height);
    pic.mips.push(c);
  }
  return pic.mips[Math.min(k, pic.mips.length - 1)] ?? (pic.mips[0] as Source);
}

/* ───────────────────────── plates ───────────────────────── */

const TV_BARS = ['#F2EFE6', '#FFD21F', '#19B5C8', '#3CC85A', '#D63DC9', '#F2361B', '#1E3FD8'];
/** [x, y, radius] in fractions of the plate; kept to the corners and edges, the doll covers the middle. */
const STARS: readonly (readonly [number, number, number])[] = [
  [0.13, 0.14, 0.085], [0.86, 0.11, 0.07], [0.9, 0.42, 0.05], [0.08, 0.5, 0.055], [0.16, 0.86, 0.075],
  [0.86, 0.82, 0.085], [0.5, 0.07, 0.045], [0.68, 0.93, 0.04], [0.33, 0.95, 0.035], [0.3, 0.3, 0.03], [0.72, 0.28, 0.03],
];

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

/** Paints plate `bg` over the square (0, 0)-(size, size). */
export function drawPlate(g: CanvasRenderingContext2D, bgId: number, size: number): void {
  const bg: AvatarBg = getBg(bgId);
  const s = size;
  g.save();
  g.fillStyle = bg.color;
  g.fillRect(0, 0, s, s);
  switch (bg.kind) {
    case 'flat':
      break;
    case 'sunburst': {
      const cx = s / 2;
      const cy = s * 0.56;
      const rays = 12;
      g.fillStyle = '#FFE45A';
      for (let i = 0; i < rays; i++) {
        const a0 = (i / rays) * Math.PI * 2 - 0.09;
        const a1 = a0 + Math.PI / rays;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a0) * s * 1.5, cy + Math.sin(a0) * s * 1.5);
        g.lineTo(cx + Math.cos(a1) * s * 1.5, cy + Math.sin(a1) * s * 1.5);
        g.closePath();
        g.fill();
      }
      const grad = g.createRadialGradient(cx, cy, s * 0.3, cx, cy, s * 0.82);
      grad.addColorStop(0, 'rgba(255,159,10,0)');
      grad.addColorStop(1, 'rgba(255,159,10,.85)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
      break;
    }
    case 'dots': {
      // halftone: a diagonal grid of dots that grow towards the bottom
      const step = Math.max(5, s / 9);
      g.fillStyle = bg.color2 ?? '#F2361B';
      let row = 0;
      for (let y = step * 0.2; y < s + step; y += step * 0.5, row++) {
        const r = step * (0.1 + 0.3 * Math.min(1, Math.max(0, y / s)));
        for (let x = (row % 2) * step * 0.5; x < s + step; x += step) {
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    case 'bars': {
      const n = TV_BARS.length;
      for (let i = 0; i < n; i++) {
        g.fillStyle = TV_BARS[i] ?? '#fff';
        g.fillRect(Math.floor((i * s) / n), 0, Math.ceil(s / n) + 1, s);
      }
      // the lower strip of a test card
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 === 0 ? '#10238C' : '#16120E';
        g.fillRect(Math.floor((i * s) / n), s * 0.8, Math.ceil(s / n) + 1, s * 0.2);
      }
      break;
    }
    case 'stars': {
      g.fillStyle = bg.color2 ?? '#FFD21F';
      for (const [x, y, r] of STARS) {
        starPath(g, x * s, y * s, Math.max(1.5, r * s));
        g.fill();
      }
      break;
    }
    default: {
      const _exhaustive: never = bg.kind;
      void _exhaustive;
    }
  }
  g.restore();
}

/* ───────────────────────── composing ───────────────────────── */

export interface ComposeOptions {
  /** Side of the square canvas in device pixels. */
  size: number;
  /** 'icon' the head (default), 'bust' head and shoulders, 'full' the whole doll. */
  crop?: AvatarCrop;
  /** false = transparent background (a cut-out sticker for a game sprite). Default true. */
  plate?: boolean;
  /** false = no sticker outline around the doll. Default true. */
  outline?: boolean;
}

interface Composed {
  canvas: HTMLCanvasElement;
  /** False when a picture the look needs is not loaded (it was skipped). */
  complete: boolean;
}

let scratch: HTMLCanvasElement | null = null;
let scratch2: HTMLCanvasElement | null = null;

function scratchCtx(which: 1 | 2, size: number): CanvasRenderingContext2D | null {
  let c = which === 1 ? scratch : scratch2;
  if (c === null) {
    c = makeCanvas(size, size);
    if (which === 1) scratch = c;
    else scratch2 = c;
  }
  if (c.width !== size || c.height !== size) {
    c.width = size;
    c.height = size;
  }
  const g = c.getContext('2d');
  if (g === null) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, size, size);
  return g;
}

function composeInner(input: AvatarLook | string, opts: ComposeOptions): Composed {
  const size = Math.max(8, Math.min(2048, Math.round(opts.size)));
  const crop = opts.crop ?? 'icon';
  const look = normalizeLook(typeof input === 'string' ? decodeLook(input) : input);
  const out = makeCanvas(size, size);
  const g = out.getContext('2d');
  if (g === null) return { canvas: out, complete: false };
  if (opts.plate !== false) drawPlate(g, look.bg, size);

  const placed = layoutLook(look);
  const frame = frameLook(look, crop, placed);
  const k = size / frame.w;
  let complete = true;

  // the doll and what it wears go on a layer of their own, so the outline can follow the silhouette
  const lg = scratchCtx(1, size);
  if (lg === null) return { canvas: out, complete: false };
  lg.imageSmoothingQuality = 'high';
  const doll = pics.get(DOLL.file);
  if (doll !== undefined) {
    const dw = DOLL.width * k;
    lg.drawImage(mipFor(doll, dw), -frame.x * k, -frame.y * k, dw, DOLL.height * k);
  } else {
    complete = false;
    drawStandInHead(lg, frame.x, frame.y, k);
  }
  for (const p of placed) {
    const pic = pics.get(p.item.file);
    if (pic === undefined) {
      complete = false;
      continue;
    }
    const dw = p.w * k;
    lg.drawImage(mipFor(pic, dw), (p.x - frame.x) * k, (p.y - frame.y) * k, dw, p.h * k);
  }

  const layer = lg.canvas;
  if (opts.outline !== false) {
    const sg = scratchCtx(2, size);
    if (sg !== null) {
      sg.drawImage(layer, 0, 0);
      sg.globalCompositeOperation = 'source-in';
      sg.fillStyle = opts.plate === false ? '#16120E' : getBg(look.bg).outline;
      sg.fillRect(0, 0, size, size);
      const r = Math.max(1, size * 0.02);
      // a 1 px outline needs only the four straight neighbours; thicker ones need a rounder stamp
      const steps = r <= 1.2 ? 4 : r > 2.5 ? 16 : 8;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        g.drawImage(sg.canvas, Math.cos(a) * r, Math.sin(a) * r);
      }
    }
  }
  g.drawImage(layer, 0, 0);
  return { canvas: out, complete };
}

/** When doll.png is missing: a plain paper head with an ink outline, in the head's place. Depicts nobody. */
function drawStandInHead(g: CanvasRenderingContext2D, fx: number, fy: number, k: number): void {
  const cx = ((DOLL.centerX / 100) * DOLL.width - fx) * k;
  const cy = (0.27 * DOLL.height - fy) * k;
  const rx = 0.36 * DOLL.width * k;
  const ry = 0.2 * DOLL.height * k;
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = '#FFF8E6';
  g.fill();
  g.restore();
}

/**
 * Draws a look now, with the pictures that are already loaded (a picture that is not loaded is
 * skipped; call preloadAvatarAssets() first, or use avatarCanvas()). Returns a new square canvas.
 * Never throws: on any failure the canvas holds a plain plate.
 */
export function composeAvatar(look: AvatarLook | string, opts: ComposeOptions): HTMLCanvasElement {
  try {
    return composeInner(look, opts).canvas;
  } catch {
    return fallbackCanvas(look, opts.size);
  }
}

function fallbackCanvas(look: AvatarLook | string, size: number): HTMLCanvasElement {
  const c = makeCanvas(Math.max(8, Math.min(2048, size || 48)), Math.max(8, Math.min(2048, size || 48)));
  try {
    const g = c.getContext('2d');
    if (g !== null) {
      const l = normalizeLook(typeof look === 'string' ? decodeLook(look) : look);
      drawPlate(g, l.bg, c.width);
      const doll = pics.get(DOLL.file);
      const frame = frameLook({ ...l, head: [], eyes: null, ears: null, face: null, neck: null }, 'icon', []);
      const k = c.width / frame.w;
      if (doll !== undefined) g.drawImage(mipFor(doll, DOLL.width * k), -frame.x * k, -frame.y * k, DOLL.width * k, DOLL.height * k);
      else drawStandInHead(g, frame.x, frame.y, k);
    }
  } catch {
    /* a blank canvas is still a valid answer */
  }
  return c;
}

/**
 * A look as a canvas of exactly `size` device pixels, after its pictures are loaded: a game sprite.
 * `plate: false` gives a cut-out doll on a transparent background. Never rejects.
 */
export async function avatarCanvas(
  look: AvatarLook | string,
  size: number,
  opts: Omit<ComposeOptions, 'size'> = {},
): Promise<HTMLCanvasElement> {
  try {
    const l = normalizeLook(typeof look === 'string' ? decodeLook(look) : look);
    await Promise.all(lookFiles(l).map(loadPic));
    return composeAvatar(l, { ...opts, size });
  } catch {
    return fallbackCanvas(look, size);
  }
}

/* ───────────────────────── caches ───────────────────────── */

/** Device-pixel sizes the caches hold. */
export const AVATAR_BUCKETS: readonly number[] = [48, 96, 192, 384];
/** Most composed pictures kept (least recently used goes first), and their total size. */
export const AVATAR_CACHE_MAX = 600;
export const AVATAR_CACHE_MAX_BYTES = 48 * 1024 * 1024;
/** Most object URLs kept; the least recently used one that nothing holds is revoked first. */
export const AVATAR_URL_MAX = 300;

/** The bucket for a CSS size on this screen. */
export function avatarBucket(cssSize: number, dpr: number = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1): number {
  const want = Math.max(1, cssSize) * Math.min(3, Math.max(1, dpr || 1));
  for (const b of AVATAR_BUCKETS) if (b >= want * 0.92) return b;
  return AVATAR_BUCKETS[AVATAR_BUCKETS.length - 1] ?? 384;
}

interface Bitmap {
  canvas: HTMLCanvasElement;
  bytes: number;
}
interface UrlEntry {
  url: string;
  bytes: number;
  refs: number;
}

const bitmaps = new Map<string, Bitmap>();
let bitmapBytes = 0;
const bitmapPending = new Map<string, Promise<HTMLCanvasElement>>();
const urls = new Map<string, UrlEntry>();
const urlPending = new Map<string, Promise<string>>();
/** Holds asked for before the URL exists. */
const earlyRefs = new Map<string, number>();

interface Request {
  key: string;
  look: AvatarLook;
  bucket: number;
  crop: AvatarCrop;
}

function request(look: AvatarLook | string, size: number, crop: AvatarCrop): Request {
  const l = normalizeLook(typeof look === 'string' ? decodeLook(look) : look);
  const bucket = avatarBucket(size);
  return { key: `${lookKey(l)}|${bucket}|${crop}`, look: l, bucket, crop };
}

function touch<T>(map: Map<string, T>, key: string, e: T): void {
  map.delete(key);
  map.set(key, e);
}

function evictBitmaps(): void {
  for (const [key, b] of bitmaps) {
    if (bitmaps.size <= AVATAR_CACHE_MAX && bitmapBytes <= AVATAR_CACHE_MAX_BYTES) break;
    bitmaps.delete(key);
    bitmapBytes -= b.bytes;
  }
}

function revoke(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

function evictUrls(): void {
  if (urls.size <= AVATAR_URL_MAX) return;
  for (const [key, e] of urls) {
    if (urls.size <= AVATAR_URL_MAX) break;
    if (e.refs > 0) continue;
    urls.delete(key);
    revoke(e.url);
  }
}

/* composing is spread over frames: a full lobby asking for 120 pictures at once must not freeze the TV */
const jobs: (() => void)[] = [];
let pumping = false;
const SLICE_MS = 8;

/**
 * Finished pictures are handed out in batches (when the queue is empty, or every FLUSH_MS):
 * every hand-out repaints the page, and one repaint for 40 new icons costs far less than 40 repaints.
 */
const FLUSH_MS = 120;
let handOut: (() => void)[] = [];
let lastFlush = 0;

function flush(): void {
  const list = handOut;
  handOut = [];
  lastFlush = performance.now();
  for (const fn of list) fn();
}

function pump(): void {
  const start = performance.now();
  while (jobs.length > 0 && performance.now() - start < SLICE_MS) {
    const job = jobs.shift();
    if (job !== undefined) job();
  }
  if (jobs.length === 0 || performance.now() - lastFlush > FLUSH_MS) flush();
  if (jobs.length > 0) yieldThen(pump);
  else pumping = false;
}

let channel: MessageChannel | null = null;
let afterYield: (() => void) | null = null;
/** Like setTimeout(fn, 0) without the 4 ms clamp of nested timers. */
function yieldThen(fn: () => void): void {
  try {
    if (channel === null) {
      channel = new MessageChannel();
      channel.port1.onmessage = () => {
        const f = afterYield;
        afterYield = null;
        if (f !== null) f();
      };
    }
    afterYield = fn;
    channel.port2.postMessage(0);
  } catch {
    setTimeout(fn, 0);
  }
}

function schedule(job: () => void): void {
  jobs.push(job);
  if (pumping) return;
  pumping = true;
  lastFlush = performance.now();
  yieldThen(pump);
}

function produceBitmap(r: Request): Promise<{ canvas: HTMLCanvasElement; complete: boolean }> {
  return Promise.all(lookFiles(r.look).map(loadPic)).then(
    () =>
      new Promise<Composed>((resolve) => {
        schedule(() => {
          let made: Composed;
          try {
            made = composeInner(r.look, { size: r.bucket, crop: r.crop });
          } catch {
            made = { canvas: fallbackCanvas(r.look, r.bucket), complete: false };
          }
          handOut.push(() => resolve(made));
        });
      }),
  );
}

function bitmapFor(r: Request): Promise<HTMLCanvasElement> {
  const hit = bitmaps.get(r.key);
  if (hit !== undefined) {
    touch(bitmaps, r.key, hit);
    return Promise.resolve(hit.canvas);
  }
  const running = bitmapPending.get(r.key);
  if (running !== undefined) return running;
  const p = produceBitmap(r)
    .then((made) => {
      // a picture is missing (404, offline): hand out the simpler picture but do not keep it,
      // so the next request tries again
      if (made.complete) {
        const bytes = made.canvas.width * made.canvas.height * 4;
        bitmaps.set(r.key, { canvas: made.canvas, bytes });
        bitmapBytes += bytes;
        evictBitmaps();
      }
      return made.canvas;
    })
    .catch(() => fallbackCanvas(r.look, r.bucket))
    .finally(() => bitmapPending.delete(r.key));
  bitmapPending.set(r.key, p);
  return p;
}

/**
 * The shared, cached picture of a look as a canvas (bucket-sized, see avatarBucket). This is the
 * cheapest way to show an avatar: draw it into your own canvas with drawImage. Do NOT draw on it
 * or resize it: every caller gets the same canvas. `size` is in CSS pixels. Never rejects.
 */
export function avatarBitmap(look: AvatarLook | string, size: number, crop: AvatarCrop = 'icon'): Promise<HTMLCanvasElement> {
  try {
    return bitmapFor(request(look, size, crop));
  } catch {
    return Promise.resolve(fallbackCanvas(look, avatarBucket(size)));
  }
}

/** The cached picture right now, or null (no work is started). */
export function peekAvatarBitmap(look: AvatarLook | string, size: number, crop: AvatarCrop = 'icon'): HTMLCanvasElement | null {
  try {
    const r = request(look, size, crop);
    const hit = bitmaps.get(r.key);
    if (hit === undefined) return null;
    touch(bitmaps, r.key, hit);
    return hit.canvas;
  } catch {
    return null;
  }
}

/** 1x1 transparent GIF: the answer when even a canvas cannot be made. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function dataUrl(canvas: HTMLCanvasElement): string {
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return BLANK;
  }
}

function blobOf(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/**
 * URL of a look's picture, for an <img src> or a CSS background. `size` is in CSS pixels; the
 * picture is made at the next bucket (48 / 96 / 192 / 384 device px) and shared by every caller.
 * Resolves at once when cached. Never rejects: when a picture cannot be loaded the URL shows the
 * plate with what could be drawn (the bare head). The URL is an object URL that is revoked when
 * the cache is full, unless it is held (holdAvatarUrl / useAvatarUrl): ask again rather than
 * storing it. For lists of many avatars prefer <Avatar /> (it paints the cached canvas, no PNG).
 */
export function avatarUrl(look: AvatarLook | string, size: number, crop: AvatarCrop = 'icon'): Promise<string> {
  let r: Request;
  try {
    r = request(look, size, crop);
  } catch {
    return Promise.resolve(BLANK);
  }
  const hit = urls.get(r.key);
  if (hit !== undefined) {
    touch(urls, r.key, hit);
    return Promise.resolve(hit.url);
  }
  const running = urlPending.get(r.key);
  if (running !== undefined) return running;
  const p = bitmapFor(r)
    .then(async (canvas) => {
      // only pictures that made it into the bitmap cache are complete
      if (bitmaps.get(r.key)?.canvas !== canvas) return dataUrl(canvas);
      const blob = await blobOf(canvas);
      if (blob === null) return dataUrl(canvas);
      const url = URL.createObjectURL(blob);
      urls.set(r.key, { url, bytes: blob.size, refs: earlyRefs.get(r.key) ?? 0 });
      earlyRefs.delete(r.key);
      evictUrls();
      return url;
    })
    .catch(() => BLANK)
    .finally(() => urlPending.delete(r.key));
  urlPending.set(r.key, p);
  return p;
}

/** The cached URL right now, or null (no work is started). */
export function peekAvatarUrl(look: AvatarLook | string, size: number, crop: AvatarCrop = 'icon'): string | null {
  try {
    const r = request(look, size, crop);
    const hit = urls.get(r.key);
    if (hit === undefined) return null;
    touch(urls, r.key, hit);
    return hit.url;
  } catch {
    return null;
  }
}

/**
 * Keeps a look's URL alive (never revoked) until the returned function is called. useAvatarUrl
 * does this for you; call it yourself only if you put avatarUrl() results into long-lived DOM.
 */
export function holdAvatarUrl(look: AvatarLook | string, size: number, crop: AvatarCrop = 'icon'): () => void {
  let key: string;
  try {
    key = request(look, size, crop).key;
  } catch {
    return () => undefined;
  }
  const e = urls.get(key);
  if (e !== undefined) e.refs++;
  else earlyRefs.set(key, (earlyRefs.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const now = urls.get(key);
    if (now !== undefined) {
      now.refs = Math.max(0, now.refs - 1);
      evictUrls();
      return;
    }
    const early = (earlyRefs.get(key) ?? 0) - 1;
    if (early > 0) earlyRefs.set(key, early);
    else earlyRefs.delete(key);
  };
}

export interface AvatarCacheStats {
  /** Composed pictures in memory and their size (width x height x 4). */
  bitmaps: number;
  bitmapBytes: number;
  /** Object URLs (PNG blobs) and their size. */
  urls: number;
  urlBytes: number;
  urlsHeld: number;
  /** Compositions not finished yet. */
  pending: number;
  /** Picture files loaded. */
  pictures: number;
}

/** For the lab and for tests: what the caches hold. */
export function avatarCacheStats(): AvatarCacheStats {
  let urlBytes = 0;
  let urlsHeld = 0;
  for (const e of urls.values()) {
    urlBytes += e.bytes;
    if (e.refs > 0) urlsHeld++;
  }
  return { bitmaps: bitmaps.size, bitmapBytes, urls: urls.size, urlBytes, urlsHeld, pending: bitmapPending.size + urlPending.size + jobs.length, pictures: pics.size };
}

/** Drops every cached picture and every URL that nothing holds (tests; a "new party" reset). */
export function clearAvatarCache(): void {
  bitmaps.clear();
  bitmapBytes = 0;
  for (const [key, e] of urls) {
    if (e.refs > 0) continue;
    urls.delete(key);
    revoke(e.url);
  }
}
