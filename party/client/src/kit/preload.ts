/**
 * Load the pictures, sounds, videos and fonts a screen will show, ahead of time, with progress.
 *
 *   const batch = preload([...preloadItems('phone'), ...fontItems()]);
 *   batch.subscribe((p) => draw(p.fraction));   // 0..1, by bytes, never goes back
 *   await batch.done;                            // every file loaded or given up on
 *
 * Each file is fetched once (at most CONCURRENCY at a time, so the first screen's files are not
 * queued behind a video), which puts it in the HTTP cache, and then:
 *   image  decoded (img.decode()); the Image is kept, so a later <img> or canvas draws from memory
 *   audio  `after` runs (the TV decodes its clips through kit/audio's cache)
 *   video  nothing more: the <video> plays it from the HTTP cache
 *   font   FontFace.load() on the page's own @font-face rules (fontItems())
 * A file that fails, or stalls for STALL_MS, counts as done: nothing here waits forever and
 * nothing throws. The same URL asked twice is loaded once; asking again with `front` moves it to
 * the head of the queue (a game's art when its intro starts: preloadGameArt).
 */
import { publicFilePaths, publicUrl } from './files';
import { ESTIMATED_BYTES, inPreloadSet, preloadKind, preloadRule } from './preload-sets';

import type { PreloadKind, PreloadTarget } from './preload-sets';

export type { PreloadKind, PreloadTarget } from './preload-sets';

export interface PreloadItem {
  /** A URL, or a key for a font face. */
  readonly url: string;
  readonly kind: PreloadKind;
  /** Lower loads first. */
  readonly rank?: number;
  /** Runs once the file is fetched (e.g. decode an audio clip); the file counts as done after it. */
  readonly after?: () => Promise<unknown>;
  /** A font face: loaded with FontFace.load() instead of a fetch. */
  readonly face?: FontFace;
}

export interface PreloadProgress {
  readonly files: number;
  /** Loaded or given up on. */
  readonly filesDone: number;
  readonly failed: number;
  /** Bytes: the real size once a response says it, an estimate before. */
  readonly bytes: number;
  readonly bytesDone: number;
  /** 0..1 by bytes; it never goes back (an estimate that grows does not pull the bar back). */
  readonly fraction: number;
  readonly finished: boolean;
}

export interface PreloadBatch {
  /** Resolves when every file of the batch is loaded or given up on. Never rejects. */
  readonly done: Promise<void>;
  progress(): PreloadProgress;
  /** Called on progress (at most about 12 times a second) and once at the end. Returns the unsubscribe. */
  subscribe(fn: (p: PreloadProgress) => void): () => void;
}

const CONCURRENCY = 6;
/** A file that receives nothing for this long is given up on (it stays in the queue's past, never blocks). */
const STALL_MS = 15_000;
/** A picture that does not decode within this long is left to the browser. */
const DECODE_MS = 10_000;
const NOTIFY_MS = 80;

type EntryState = 'queued' | 'running' | 'done' | 'failed';

interface Entry {
  readonly item: PreloadItem;
  readonly seq: number;
  rank: number;
  state: EntryState;
  /** Expected bytes (the response's length once known). */
  size: number;
  got: number;
  readonly done: Promise<void>;
  finish: () => void;
}

const entries = new Map<string, Entry>();
const queue: Entry[] = [];
let running = 0;
let seq = 0;
/** Decoded pictures, kept referenced so the browser keeps them ready for the screens that use them. */
const kept: HTMLImageElement[] = [];

// ───────────────────────────── progress listeners ─────────────────────────────

const batches = new Set<BatchImpl>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifySoon(): void {
  if (notifyTimer !== null) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const b of batches) b.emit();
  }, NOTIFY_MS);
}

class BatchImpl implements PreloadBatch {
  readonly done: Promise<void>;
  private readonly list: readonly Entry[];
  private readonly listeners = new Set<(p: PreloadProgress) => void>();
  private shown = 0;
  private settled = false;

  constructor(list: readonly Entry[]) {
    this.list = list;
    this.done = Promise.all(list.map((e) => e.done)).then(() => {
      this.settled = true;
      this.emit();
      this.listeners.clear();
      batches.delete(this);
    });
  }

  progress(): PreloadProgress {
    let bytes = 0;
    let bytesDone = 0;
    let filesDone = 0;
    let failed = 0;
    for (const e of this.list) {
      bytes += e.size;
      if (e.state === 'done' || e.state === 'failed') {
        bytesDone += e.size;
        filesDone += 1;
        if (e.state === 'failed') failed += 1;
      } else bytesDone += Math.min(e.got, e.size);
    }
    const finished = this.settled || filesDone === this.list.length;
    const raw = finished ? 1 : bytes > 0 ? bytesDone / bytes : 0;
    this.shown = Math.max(this.shown, Math.min(raw, finished ? 1 : 0.99));
    return { files: this.list.length, filesDone, failed, bytes, bytesDone, fraction: this.shown, finished };
  }

  subscribe(fn: (p: PreloadProgress) => void): () => void {
    if (this.settled) {
      fn(this.progress());
      return () => undefined;
    }
    this.listeners.add(fn);
    batches.add(this);
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) batches.delete(this);
    };
  }

  emit(): void {
    if (this.listeners.size === 0) return;
    const p = this.progress();
    for (const fn of this.listeners) {
      try {
        fn(p);
      } catch {
        // a listener must never break loading
      }
    }
  }
}

// ───────────────────────────── loading ─────────────────────────────

function byPriority(a: Entry, b: Entry): number {
  return a.rank - b.rank || a.seq - b.seq;
}

function pump(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const e = queue.shift();
    if (e === undefined) break;
    running += 1;
    e.state = 'running';
    void load(e)
      .then(
        (ok) => ok,
        () => false,
      )
      .then((ok) => {
        running -= 1;
        e.state = ok ? 'done' : 'failed';
        if (e.got > 0) e.size = Math.max(e.got, ok ? 0 : e.size);
        e.finish();
        notifySoon();
        pump();
      });
  }
}

/** Fetch the whole file (into the HTTP cache), counting bytes as they arrive. */
async function fetchCounting(e: Entry): Promise<boolean> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let stall = setTimeout(() => ctrl?.abort(), STALL_MS);
  const alive = (): void => {
    clearTimeout(stall);
    stall = setTimeout(() => ctrl?.abort(), STALL_MS);
  };
  try {
    const res = await fetch(e.item.url, { credentials: 'same-origin', signal: ctrl?.signal });
    if (!res.ok) return false;
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > 0) e.size = len;
    const reader = res.body?.getReader();
    if (reader === undefined) {
      const buf = await res.arrayBuffer();
      e.got = buf.byteLength;
      return true;
    }
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      e.got += chunk.value.byteLength;
      alive();
      notifySoon();
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(stall);
  }
}

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

function decodeImage(url: string): Promise<boolean> {
  let img: HTMLImageElement;
  try {
    img = new Image();
  } catch {
    return Promise.resolve(false);
  }
  img.decoding = 'async';
  const loaded =
    typeof img.decode === 'function'
      ? new Promise<boolean>((resolve) => {
          img.src = url;
          img.decode().then(
            () => resolve(true),
            () => resolve(img.complete && img.naturalWidth > 0),
          );
        })
      : new Promise<boolean>((resolve) => {
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        });
  return within(loaded, DECODE_MS).then((ok) => {
    if (ok === true) kept.push(img);
    return ok === true;
  });
}

async function load(e: Entry): Promise<boolean> {
  const { item } = e;
  if (item.face !== undefined) {
    const face = item.face;
    const ok = await within(
      face.load().then(() => true),
      STALL_MS,
    );
    e.got = e.size;
    return ok === true;
  }
  const fetched = await fetchCounting(e);
  if (!fetched) return false;
  if (item.kind === 'image') {
    // the bytes are in; a picture that will not decode is still in the cache
    await decodeImage(item.url);
  }
  if (item.after !== undefined) await within(item.after(), STALL_MS);
  return true;
}

function entryFor(item: PreloadItem): Entry {
  const have = entries.get(item.url);
  if (have !== undefined) return have;
  let finish = (): void => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const e: Entry = { item, seq: seq++, rank: item.rank ?? 5, state: 'queued', size: ESTIMATED_BYTES[item.kind], got: 0, done, finish };
  entries.set(item.url, e);
  queue.push(e);
  return e;
}

/**
 * Load these files (each URL once per page) and follow their progress. `front`: ahead of
 * everything already queued (what the next screen needs right now).
 */
export function preload(items: readonly PreloadItem[], opts: { readonly front?: boolean } = {}): PreloadBatch {
  const list: Entry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const e = entryFor(item);
    if (opts.front === true && e.state === 'queued') e.rank = -1;
    list.push(e);
  }
  queue.sort(byPriority);
  pump();
  return new BatchImpl(list);
}

// ───────────────────────────── what to load ─────────────────────────────

/**
 * The public files of a set (kit/preload-sets.ts), from the build-time file list: pictures and
 * sounds. Videos and fonts are not in that list: the TV adds its videos, fontItems() the fonts.
 */
export function preloadItems(target: PreloadTarget): PreloadItem[] {
  const out: PreloadItem[] = [];
  for (const path of publicFilePaths()) {
    if (!inPreloadSet(path, target)) continue;
    out.push({ url: publicUrl(path), kind: preloadKind(path), rank: preloadRule(path)?.rank ?? 5 });
  }
  return out;
}

/** Every @font-face of this page (every family, weight and script range its CSS declares). */
export function fontItems(): PreloadItem[] {
  const out: PreloadItem[] = [];
  try {
    let i = 0;
    document.fonts.forEach((face) => {
      out.push({ url: `font:${i++}:${face.family}:${face.weight}:${face.style}:${face.unicodeRange}`, kind: 'font', rank: 0, face });
    });
  } catch {
    // no FontFaceSet: the CSS loads the fonts when text needs them
  }
  return out;
}

/** True once a URL has been loaded by the preloader. */
export function isPreloaded(url: string): boolean {
  return entries.get(url)?.state === 'done';
}

/**
 * A game's own art (client/public/assets/<gameId>/), first in the queue: called while the game's
 * intro runs, so the round starts with every picture in memory (already loaded: resolves at once).
 */
export function preloadGameArt(gameId: string): Promise<void> {
  const prefix = publicUrl(`/assets/${gameId}/`);
  return preload(
    preloadItems('phone').filter((it) => it.url.startsWith(prefix)),
    { front: true },
  ).done;
}
