/**
 * Load the pictures, sounds, videos and fonts a page will show, ahead of time, in the background.
 * Nothing here is a screen and nothing waits for it: a page starts a batch, goes on as before, and
 * may draw the batch's progress where it has room (the TV: its boot card, then a thin bar).
 *
 *   const batch = preload([...preloadItems('phone', { hook }), ...fontItems()]);
 *   batch.subscribe((p) => draw(p.fraction));   // now, then on progress: 0..1 by bytes, never back
 *   void batch.done;                            // every file loaded or given up on; never rejects
 *
 * One network path per file: each file is fetched once (a few at a time: CONCURRENCY), which puts
 * it in the HTTP cache, and then what the item asked for runs, off that warm cache:
 *   after   the screen's own cache takes the file: kit/audio decodes a clip (decodeClip), the
 *           avatar compositor takes a doll / accessory picture (loadAvatarPicture)
 *   decode  img.decode() and the Image is kept, so a later <img> draws from memory. The TV asks
 *           for it (preloadItems('tv')); a phone never does: its set is about 123 MB of pixels,
 *           enough to get the tab killed on an older iPhone
 *   face    a font: FontFace.load() on the page's own @font-face rules (fontItems()), no fetch
 * A video gets nothing more: the <video> plays it from the HTTP cache.
 *
 * Asking again is how everything else is done; the same URL is one entry for the life of the page:
 *   a file that failed    is fetched again (after a network failure or a stall it is also tried
 *                         again by itself, once, RETRY_MS later; not after a 404)
 *   { refresh: true }     a loaded file is fetched again (the HTTP cache answers, or a 304), so
 *                         it is fresh for the next minutes; its decode and hooks do not run again
 *   { front: true }       ahead of everything queued, the newest such request first (a game's art
 *                         when its intro starts: preloadGameArt)
 *   a new `after`         is never dropped: taken on by a file that has not started, else run once
 *                         when its fetch has succeeded
 * setPreloadPaused(true) holds everything back but the front requests (a phone during a round).
 * `?preload=0` in the page address turns all of it off (preloadOn()).
 *
 * A file that fails, or receives nothing for STALL_MS, counts as done for its batch: nothing here
 * waits forever and nothing throws. Tests: tests/unit/preload.test.ts.
 */
import { publicFilePaths, publicUrl } from './files';
import { DEFAULT_RANK, ESTIMATED_BYTES, inPreloadSet, preloadKind, preloadRank } from './preload-sets';

import type { PreloadKind, PreloadTarget } from './preload-sets';

export { preloadRank } from './preload-sets';
export type { PreloadKind, PreloadTarget } from './preload-sets';

export interface PreloadItem {
  /** A URL, or a key for a font face. */
  readonly url: string;
  readonly kind: PreloadKind;
  /** Lower loads first (preloadRank). */
  readonly rank?: number;
  /**
   * Runs once the file is fetched (fill the screen's own cache from the warm HTTP cache); the file
   * counts as done after it. It has succeeded unless it rejects, resolves to `false` or takes
   * longer than STALL_MS: then it runs again the next time the file is asked for.
   */
  readonly after?: () => Promise<unknown>;
  /** A picture: img.decode() after the fetch, and keep the Image. The TV only (see the header). */
  readonly decode?: boolean;
  /** A font face: loaded with FontFace.load() instead of a fetch. */
  readonly face?: FontFace;
}

export interface PreloadOptions {
  /** Ahead of everything queued, and let through while the queue is paused. */
  readonly front?: boolean;
  /** Fetch a file that is already loaded once more, so the HTTP cache holds a fresh copy. */
  readonly refresh?: boolean;
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
  /**
   * Called right away with the progress so far, then on progress (at most about 12 times a
   * second) and once at the end. Returns the unsubscribe.
   */
  subscribe(fn: (p: PreloadProgress) => void): () => void;
}

export interface PreloadItemsOptions {
  /**
   * The `after` of a file, or undefined for none: asked once per file of the set, with its public
   * path ('/audio/gong.mp3'), its URL and its kind. A picture with a hook is not decoded here.
   */
  readonly hook?: (path: string, url: string, kind: PreloadKind) => (() => Promise<unknown>) | undefined;
}

/** A file that receives nothing for this long is given up on (it never blocks the queue). */
const STALL_MS = 15_000;
/** A picture that does not decode within this long is left to the browser. */
const DECODE_MS = 10_000;
/** A file lost to the network (not to an error status) is tried once more after this long. */
const RETRY_MS = 2_000;
const NOTIFY_MS = 80;

/** `?preload=0` turns the preloader off: the page then loads its files as it did without it. */
export function preloadEnabled(search: string): boolean {
  try {
    return new URLSearchParams(search).get('preload') !== '0';
  } catch {
    return true;
  }
}

function pageLocation(): { readonly search: string; readonly protocol: string } {
  try {
    if (typeof location !== 'undefined') return { search: String(location.search ?? ''), protocol: String(location.protocol ?? '') };
  } catch {
    // no page (a test, a worker): everything on
  }
  return { search: '', protocol: '' };
}

const PAGE = pageLocation();
/** Read once: a page that rewrites its address later keeps the choice it was opened with. */
const ON = preloadEnabled(PAGE.search);
/**
 * Caddy serves https: over HTTP/2, where 6 at a time only bounds the latency. The plain http:
 * fallback address is HTTP/1.1 with 6 connections per host: 4 leaves two for the game's own
 * requests (its code chunk, a picture a screen needs now).
 */
const CONCURRENCY = PAGE.protocol === 'http:' ? 4 : 6;

/** False when the page was opened with `?preload=0`: preload() then loads nothing. */
export function preloadOn(): boolean {
  return ON;
}

type Hook = () => Promise<unknown>;
type EntryState = 'queued' | 'running' | 'done' | 'failed';
/** How a run ended. 'net': the network (fetch rejected, stall); 'http': an answer that is final. */
type Outcome = 'ok' | 'net' | 'http';

interface Entry {
  readonly url: string;
  readonly kind: PreloadKind;
  readonly face: FontFace | undefined;
  readonly seq: number;
  readonly rank: number;
  /** 0, or the number of the newest front request that named it: higher starts first. */
  front: number;
  state: EntryState;
  /** The fetch succeeded at least once: the file is in the HTTP cache. */
  loaded: boolean;
  /** The next run fetches (a new file, a retry, a refresh); false: it only does the work still owed. */
  fetch: boolean;
  wantDecode: boolean;
  decoded: boolean;
  /** Every `after` given for the file → whether it has succeeded (false: still owed). */
  readonly hooks: Map<Hook, boolean>;
  /** Automatic retries left for the current request. */
  retries: number;
  /** Waiting for the automatic retry: 'queued', but not in the queue yet. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Expected bytes (the response's length once known). */
  size: number;
  got: number;
  /** The current request: resolves with whether the file is loaded, once it is or is given up on. */
  done: Promise<boolean>;
  finish: (ok: boolean) => void;
}

const entries = new Map<string, Entry>();
const queue: Entry[] = [];
let running = 0;
let seq = 0;
let frontCalls = 0;
let paused = false;
/** Decoded pictures (`decode`), kept referenced so the browser keeps them ready for the screens that show them. */
const kept: HTMLImageElement[] = [];

// ───────────────────────────── progress listeners ─────────────────────────────

const batches = new Set<BatchImpl>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifySoon(): void {
  // nobody is listening (a phone draws no progress): no timer per chunk
  if (notifyTimer !== null || batches.size === 0) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const b of batches) b.emit();
  }, NOTIFY_MS);
}

function tell(fn: (p: PreloadProgress) => void, p: PreloadProgress): void {
  try {
    fn(p);
  } catch {
    // a listener must never break loading
  }
}

class BatchImpl implements PreloadBatch {
  readonly done: Promise<void>;
  private readonly list: readonly Entry[];
  /**
   * How each file ended for THIS batch (undefined: not yet). An entry can be asked for again
   * later (a retry, a refresh), which must not reopen a batch that has already counted it.
   */
  private readonly results: (boolean | undefined)[];
  private readonly listeners = new Set<(p: PreloadProgress) => void>();
  private shown = 0;
  /** The last progress, frozen once every file has ended. */
  private final: PreloadProgress | null = null;

  constructor(list: readonly Entry[]) {
    this.list = list;
    this.results = list.map((e) => (e.state === 'done' ? true : e.state === 'failed' ? false : undefined));
    const waits: Promise<void>[] = [];
    list.forEach((e, i) => {
      if (this.results[i] !== undefined) return;
      waits.push(
        e.done.then((ok) => {
          this.results[i] = ok;
        }),
      );
    });
    if (waits.length === 0) {
      // nothing to wait for (no files, or all of them ended before): finished from the first look
      this.final = this.measure();
      this.done = Promise.resolve();
      return;
    }
    this.done = Promise.all(waits).then(() => {
      const p = this.measure();
      this.final = p;
      for (const fn of this.listeners) tell(fn, p);
      this.listeners.clear();
      batches.delete(this);
    });
  }

  private measure(): PreloadProgress {
    let bytes = 0;
    let bytesDone = 0;
    let filesDone = 0;
    let failed = 0;
    this.list.forEach((e, i) => {
      const result = this.results[i];
      bytes += e.size;
      if (result !== undefined) {
        bytesDone += e.size;
        filesDone += 1;
        if (!result) failed += 1;
      } else bytesDone += Math.min(e.got, e.size);
    });
    const finished = filesDone === this.list.length;
    const raw = finished ? 1 : bytes > 0 ? bytesDone / bytes : 0;
    this.shown = Math.max(this.shown, Math.min(raw, finished ? 1 : 0.99));
    return { files: this.list.length, filesDone, failed, bytes, bytesDone, fraction: this.shown, finished };
  }

  progress(): PreloadProgress {
    return this.final ?? this.measure();
  }

  subscribe(fn: (p: PreloadProgress) => void): () => void {
    tell(fn, this.progress());
    if (this.final !== null) return () => undefined;
    this.listeners.add(fn);
    batches.add(this);
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) batches.delete(this);
    };
  }

  emit(): void {
    if (this.listeners.size === 0 || this.final !== null) return;
    const p = this.measure();
    for (const fn of this.listeners) tell(fn, p);
  }
}

// ───────────────────────────── loading ─────────────────────────────

/** Front requests first, the newest of them first; then by rank; then in the order the files were named. */
function byPriority(a: Entry, b: Entry): number {
  return b.front - a.front || a.rank - b.rank || a.seq - b.seq;
}

function pump(): void {
  while (running < CONCURRENCY) {
    const e = queue[0];
    // the queue is sorted with the front requests at its head: behind a plain one there is no front one
    if (e === undefined || (paused && e.front === 0)) return;
    queue.shift();
    running += 1;
    e.state = 'running';
    void run(e);
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

/** Fetch the whole file (into the HTTP cache), counting bytes as they arrive. */
async function fetchCounting(e: Entry): Promise<Outcome> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  // The stall also ends the wait by itself: where a fetch cannot be aborted, the file is still given up on.
  let giveUp = (): void => undefined;
  const gaveUp = new Promise<'stall'>((resolve) => {
    giveUp = () => resolve('stall');
  });
  const onStall = (): void => {
    giveUp();
    try {
      ctrl?.abort();
    } catch {
      // given up on either way
    }
  };
  let stall = setTimeout(onStall, STALL_MS);
  const alive = (): void => {
    clearTimeout(stall);
    stall = setTimeout(onStall, STALL_MS);
  };
  e.got = 0;
  try {
    // A refresh asks the server (a 304): only that starts the cached copy's five fresh minutes over.
    // The plain cache mode would answer from the copy and leave it to go stale in the middle of the round.
    const init: RequestInit = { credentials: 'same-origin', signal: ctrl?.signal ?? null };
    if (e.loaded) init.cache = 'no-cache';
    const res = await Promise.race([fetch(e.url, init), gaveUp]);
    if (res === 'stall') return 'net';
    if (!res.ok) {
      // an error page is not read: its connection is free for the next file at once
      void res.body?.cancel().catch(() => undefined);
      // 5xx / 429: the server is restarting or busy (Caddy answers 502 for the 2 s a restart takes),
      // which passes like a network failure; a 404 is final
      return res.status >= 500 || res.status === 429 ? 'net' : 'http';
    }
    alive();
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > 0) e.size = len;
    const reader = res.body?.getReader();
    if (reader === undefined) {
      const buf = await Promise.race([res.arrayBuffer(), gaveUp]);
      if (buf === 'stall') return 'net';
      e.got = buf.byteLength;
      return 'ok';
    }
    for (;;) {
      const chunk = await Promise.race([reader.read(), gaveUp]);
      if (chunk === 'stall') {
        void reader.cancel().catch(() => undefined);
        return 'net';
      }
      if (chunk.done) break;
      e.got += chunk.value.byteLength;
      alive();
      notifySoon();
    }
    return 'ok';
  } catch {
    return 'net';
  } finally {
    clearTimeout(stall);
  }
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

function runHook(hook: Hook): Promise<boolean> {
  let p: Promise<unknown>;
  try {
    p = Promise.resolve(hook());
  } catch {
    return Promise.resolve(false);
  }
  return within(
    p.then((v) => v !== false),
    STALL_MS,
  ).then((ok) => ok === true);
}

function owedHook(e: Entry, tried: ReadonlySet<Hook>): Hook | null {
  for (const [hook, ok] of e.hooks) if (!ok && !tried.has(hook)) return hook;
  return null;
}

/** One run of an entry: the fetch (when this run has one), then the decode and the hooks still owed. */
async function run(e: Entry): Promise<void> {
  let outcome: Outcome = 'http';
  try {
    if (e.face !== undefined) {
      // FontFace.load() gives one answer per face for the life of the page: nothing to retry
      const ok = e.loaded || (await within(e.face.load().then(() => true), STALL_MS)) === true;
      e.got = e.size;
      outcome = ok ? 'ok' : 'http';
    } else outcome = e.fetch ? await fetchCounting(e) : 'ok';
    if (outcome === 'ok') {
      e.loaded = true;
      e.fetch = false;
      // What is owed, one at a time. A wish that arrives while this runs (a later preload() naming
      // the file) is seen by the next turn of the loop; each is tried once per run.
      const tried = new Set<Hook>();
      let decodeTried = false;
      for (;;) {
        if (e.wantDecode && !e.decoded && !decodeTried) {
          decodeTried = true;
          // the bytes are in: a picture that will not decode is still in the cache
          e.decoded = await decodeImage(e.url);
          continue;
        }
        const hook = owedHook(e, tried);
        if (hook === null) break;
        tried.add(hook);
        if (await runHook(hook)) e.hooks.set(hook, true);
      }
    }
  } catch {
    outcome = 'http';
  }
  // No await between the loop's last look and here: a wish cannot slip in unseen.
  running -= 1;
  settle(e, outcome);
  pump();
}

function settle(e: Entry, outcome: Outcome): void {
  if (outcome === 'net' && e.retries > 0) {
    // weak party wifi, a phone between wifi and mobile data: once more, shortly
    e.retries -= 1;
    e.state = 'queued';
    e.timer = setTimeout(() => {
      e.timer = null;
      enqueue(e);
      pump();
    }, RETRY_MS);
    return;
  }
  const ok = outcome === 'ok';
  e.state = ok ? 'done' : 'failed';
  e.front = 0;
  if (e.got > 0) e.size = Math.max(e.got, ok ? 0 : e.size);
  e.finish(ok);
  notifySoon();
}

function enqueue(e: Entry): void {
  queue.push(e);
  queue.sort(byPriority);
}

/** A new request for an entry: a new `done`, one automatic retry, into the queue. */
function request(e: Entry, fetchIt: boolean): void {
  e.state = 'queued';
  e.fetch = fetchIt;
  e.retries = 1;
  e.done = new Promise<boolean>((resolve) => {
    e.finish = resolve;
  });
  queue.push(e);
}

function owes(e: Entry): boolean {
  if (e.wantDecode && !e.decoded) return true;
  for (const ok of e.hooks.values()) if (!ok) return true;
  return false;
}

function entryFor(item: PreloadItem, front: number, refresh: boolean): Entry {
  let e = entries.get(item.url);
  const isNew = e === undefined;
  if (e === undefined) {
    e = {
      url: item.url,
      kind: item.kind,
      face: item.face,
      seq: seq++,
      rank: item.rank ?? DEFAULT_RANK,
      front: 0,
      state: 'queued',
      loaded: false,
      fetch: true,
      wantDecode: false,
      decoded: false,
      hooks: new Map(),
      retries: 1,
      timer: null,
      size: ESTIMATED_BYTES[item.kind],
      got: 0,
      done: Promise.resolve(false),
      finish: () => undefined,
    };
    entries.set(item.url, e);
  }
  // The wishes of every item are kept, whichever came first: a queued file takes them on, a
  // running one sees them before it ends, a finished one is run again for them alone (below).
  if (item.after !== undefined && !e.hooks.has(item.after)) e.hooks.set(item.after, false);
  if (item.decode === true && e.kind === 'image') e.wantDecode = true;

  if (isNew) request(e, true);
  else if (e.state === 'failed') request(e, true);
  else if (e.state === 'done') {
    if (refresh && e.face === undefined) request(e, true);
    else if (owes(e)) request(e, false);
  } else if (e.state === 'queued') {
    if (refresh && e.face === undefined) e.fetch = true;
    if (e.timer !== null) {
      // asked for while it waits for its automatic retry: that retry is now
      clearTimeout(e.timer);
      e.timer = null;
      queue.push(e);
    }
  }
  // only a file that still has a run ahead of it (or under way, for its retry) moves to the front
  if (front > 0 && (e.state === 'queued' || e.state === 'running')) e.front = front;
  return e;
}

/**
 * Load these files in the background and follow their progress. Each URL is one entry for the
 * life of the page: naming it again never fetches a loaded file twice, it retries a failed one,
 * and it runs an `after` (or a `decode`) the file has not done yet.
 *   front    ahead of everything queued, the newest front request first, and let through while
 *            the queue is paused: what the next screen needs right now
 *   refresh  also fetch the loaded files once more (cheap: the HTTP cache, or a 304), so the
 *            cache is fresh; their decode and hooks do not run again
 * With `?preload=0` it loads nothing and returns a finished batch of zero files.
 */
export function preload(items: readonly PreloadItem[], opts: PreloadOptions = {}): PreloadBatch {
  if (!ON) return new BatchImpl([]);
  const front = opts.front === true ? ++frontCalls : 0;
  const list: Entry[] = [];
  const seen = new Set<Entry>();
  for (const item of items) {
    const e = entryFor(item, front, opts.refresh === true);
    if (seen.has(e)) continue;
    seen.add(e);
    list.push(e);
  }
  queue.sort(byPriority);
  // the batch reads each entry's request before anything can end it
  const batch = new BatchImpl(list);
  pump();
  return batch;
}

/**
 * Hold the queue back (true) or let it run (false). While paused only front requests start;
 * files already on their way finish. A phone pauses while a round is on (intro, countdown, play),
 * so the round's frames do not share the network and the decoder with art for later.
 */
export function setPreloadPaused(value: boolean): void {
  if (!ON || paused === value) return;
  paused = value;
  if (!paused) pump();
}

// ───────────────────────────── what to load ─────────────────────────────

/**
 * The public files of a set (kit/preload-sets.ts), from the build-time file list: pictures and
 * sounds, ranked for that screen. Videos and fonts are not in that list: the TV adds its videos
 * (rank: preloadRank('/cutscenes/x.mp4', 'tv')), fontItems() the fonts.
 * `hook` gives a file its `after`. A TV picture without one is decoded and kept; a phone picture
 * never is.
 */
export function preloadItems(target: PreloadTarget, opts: PreloadItemsOptions = {}): PreloadItem[] {
  const out: PreloadItem[] = [];
  for (const path of publicFilePaths()) {
    if (!inPreloadSet(path, target)) continue;
    const url = publicUrl(path);
    const kind = preloadKind(path);
    const rank = preloadRank(path, target);
    let after: Hook | undefined;
    try {
      after = opts.hook?.(path, url, kind);
    } catch {
      // a hook that cannot be built: the file is still fetched
    }
    if (after !== undefined) out.push({ url, kind, rank, after });
    else if (target === 'tv' && kind === 'image') out.push({ url, kind, rank, decode: true });
    else out.push({ url, kind, rank });
  }
  return out;
}

/** One key per FontFace object, the same on every call (a stylesheet loaded later adds faces, it does not rename them). */
const faceKeys: WeakMap<FontFace, string> | null = typeof WeakMap === 'function' ? new WeakMap() : null;
let faceCount = 0;

/**
 * Every @font-face of this page (every family, weight and script range its CSS declares). Call it
 * once the page's CSS is in (after the first render), and again after a lazy stylesheet: the faces
 * already loaded cost nothing.
 */
export function fontItems(): PreloadItem[] {
  const out: PreloadItem[] = [];
  try {
    document.fonts.forEach((face) => {
      let url = faceKeys?.get(face);
      if (url === undefined) {
        url = `font:${faceCount++}:${face.family}:${face.weight}:${face.style}:${face.unicodeRange}`;
        faceKeys?.set(face, url);
      }
      out.push({ url, kind: 'font', rank: 0, face });
    });
  } catch {
    // no FontFaceSet: the CSS loads the fonts when text needs them
  }
  return out;
}

/** True once a URL has been fetched by the preloader (it stays true while the file is refreshed). */
export function isPreloaded(url: string): boolean {
  return entries.get(url)?.loaded === true;
}

/**
 * A game's own art (client/public/assets/<gameId>/), first in the queue and through a pause:
 * called when the game's intro starts, so the round opens with every picture in the HTTP cache.
 * It also refreshes the pictures loaded earlier (the server keeps art fresh for five minutes), so
 * none of them has to ask the server again in the middle of the round. Resolves when all of them
 * are loaded or given up on; never rejects.
 */
export function preloadGameArt(gameId: string): Promise<void> {
  const prefix = publicUrl(`/assets/${gameId}/`);
  return preload(
    preloadItems('phone').filter((it) => it.url.startsWith(prefix)),
    { front: true, refresh: true },
  ).done;
}
