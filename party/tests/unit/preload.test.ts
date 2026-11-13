/**
 * The background preloader (client/src/kit/preload.ts): one fetch per file, the order of the
 * queue, pause, retry, refresh, hooks, progress and the kill switch; and the lists it builds from
 * the preload sets (client/src/kit/preload-sets.ts) and the real files under client/public.
 *
 * The engine keeps its queue in the module, so every test imports a fresh copy. The browser is
 * faked: fetch answers when the test says so, Image only counts what was decoded. No network, and
 * where time matters the clock is the test's.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GAME_IDS } from '../../shared/protocol';
import { inPreloadSet, preloadKind, preloadRank } from '../../client/src/kit/preload-sets';

import type { PreloadItem, PreloadProgress } from '../../client/src/kit/preload';

type Engine = typeof import('../../client/src/kit/preload');

const PUBLIC = resolve(import.meta.dirname, '../../client/public');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Every file under client/public/assets and /audio as its public path: what the build-time list holds. */
const LISTED = walk(PUBLIC)
  .map((p) => '/' + relative(PUBLIC, p).split('\\').join('/'))
  .filter((p) => /^\/(assets|audio)\//.test(p));

// ───────────────────────────── the fake browser ─────────────────────────────

interface Call {
  readonly url: string;
  readonly signal: AbortSignal | null;
  /** Answer 200 with a whole file of this many bytes. */
  ok(bytes?: number): void;
  /** Answer with any Response (an error status, a slow body). */
  respond(res: Response): void;
  /** The network fails: fetch rejects. */
  fail(): void;
}

let calls: Call[] = [];
/** Calls the fake has not answered by itself (the test answers them, or answerAll does). */
let open: Call[] = [];
let onCall: ((call: Call) => void) | null = null;
let images: string[] = [];

/** fetch that waits for the test to answer each call; `answer` answers them as they come. */
function installFetch(answer?: (call: Call) => void, opts: { ignoreAbort?: boolean } = {}): void {
  calls = [];
  open = [];
  onCall = answer ?? null;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit): Promise<Response> => {
    return new Promise<Response>((res, rej) => {
      const signal = init?.signal ?? null;
      const call: Call = {
        url,
        signal,
        ok: (bytes = 100) => res(new Response(new Uint8Array(bytes), { headers: { 'content-length': String(bytes) } })),
        respond: (r) => res(r),
        fail: () => rej(new TypeError('Load failed')),
      };
      if (opts.ignoreAbort !== true) signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      calls.push(call);
      if (onCall !== null) onCall(call);
      else open.push(call);
    });
  });
}

/** Answer 200 to the calls still open, and to every later one as it comes. */
function answerAll(): void {
  onCall = (c) => c.ok();
  for (const c of open.splice(0)) c.ok();
}

/** A body sent in chunks, one every `everyMs` (on the faked clock); it can break or go silent on the way. */
function body(
  bytes: number,
  opts: { chunk?: number; everyMs?: number; breakAt?: number; silentAt?: number; signal?: AbortSignal | null; onCancel?: () => void } = {},
): ReadableStream<Uint8Array> {
  const chunk = opts.chunk ?? 10_000;
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    start(c) {
      opts.signal?.addEventListener('abort', () => {
        try {
          c.error(new DOMException('aborted', 'AbortError'));
        } catch {
          // already closed
        }
      });
    },
    async pull(c) {
      if (opts.silentAt !== undefined && sent >= opts.silentAt) return new Promise<void>(() => undefined);
      if (opts.everyMs !== undefined) await new Promise((r) => setTimeout(r, opts.everyMs));
      if (opts.breakAt !== undefined && sent >= opts.breakAt) {
        c.error(new TypeError('network changed'));
        return;
      }
      if (sent >= bytes) {
        c.close();
        return;
      }
      const n = Math.min(chunk, bytes - sent);
      sent += n;
      c.enqueue(new Uint8Array(n));
    },
    cancel() {
      opts.onCancel?.();
    },
  });
}

function sized(bytes: number, stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, { headers: { 'content-length': String(bytes) } });
}

/** Image that records what was decoded. */
function installImage(mode: 'ok' | 'reject' = 'ok'): void {
  images = [];
  class FakeImage {
    decoding = '';
    complete = false;
    naturalWidth = 0;
    private url = '';
    set src(v: string) {
      this.url = v;
      images.push(v);
    }
    get src(): string {
      return this.url;
    }
    decode(): Promise<void> {
      if (mode === 'reject') return Promise.reject(new Error('EncodingError'));
      this.complete = true;
      this.naturalWidth = 10;
      return Promise.resolve();
    }
  }
  vi.stubGlobal('Image', FakeImage);
}

async function fresh(): Promise<Engine> {
  vi.resetModules();
  return import('../../client/src/kit/preload');
}

/** Only the timers the engine waits on are faked: the test still yields with a real setImmediate. */
function fakeClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

const turn = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Let everything that is ready run: promises, streams. No clock moves. */
async function idle(): Promise<void> {
  for (let i = 0; i < 8; i++) await turn();
}

async function until(what: string, cond: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !cond(); i++) await turn();
  if (!cond()) throw new Error(`never happened: ${what}`);
}

function settled(p: Promise<unknown>): () => boolean {
  let over = false;
  void p.then(() => {
    over = true;
  });
  return () => over;
}

const file = (name: string, more: Partial<PreloadItem> = {}): PreloadItem => ({ url: `/t/${name}`, kind: 'data', ...more });
const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `f${String(i).padStart(2, '0')}`);
const urls = (): string[] => calls.map((c) => c.url);

beforeEach(() => {
  installFetch();
  installImage();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ───────────────────────────── the queue ─────────────────────────────

describe('preload: the queue', () => {
  it('fetches each URL once, however often it is named', async () => {
    installFetch((c) => c.ok());
    const m = await fresh();
    const a = m.preload([file('a'), file('a'), file('b')]);
    const b = m.preload([file('b'), file('a')]);
    expect(a.progress().files).toBe(2);
    await Promise.all([a.done, b.done]);
    await m.preload([file('a'), file('b')]).done;
    expect(urls().sort()).toEqual(['/t/a', '/t/b']);
    expect(m.isPreloaded('/t/a')).toBe(true);
    expect(m.isPreloaded('/t/never')).toBe(false);
  });

  it('sends the same-origin cookies, like the <img> that follows (one cache entry for both)', async () => {
    const seen: (RequestInit | undefined)[] = [];
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      seen.push(init);
      return Promise.resolve(new Response(new Uint8Array(4)));
    });
    const m = await fresh();
    await m.preload([file('a')]).done;
    expect(seen[0]?.credentials).toBe('same-origin');
    // a first fetch may be answered by the HTTP cache; a refresh asks the server, so the copy is fresh again
    expect(seen[0]?.cache).toBeUndefined();
    await m.preload([file('a')], { refresh: true }).done;
    expect(seen[1]?.cache).toBe('no-cache');
  });

  it.each([
    ['no page address (a test)', undefined, 6],
    ['https: (HTTP/2 behind Caddy)', 'https:', 6],
    ['plain http: (HTTP/1.1, 6 connections per host)', 'http:', 4],
  ])('keeps a few files in flight at a time: %s', async (_label, protocol, cap) => {
    if (protocol !== undefined) vi.stubGlobal('location', { protocol, search: '' });
    const m = await fresh();
    const batch = m.preload(names(12).map((n) => file(n)));
    await idle();
    expect(calls.length).toBe(cap);
    // one ends, one starts
    calls[0]?.ok();
    await until('the next file starts', () => calls.length === cap + 1);
    await idle();
    expect(calls.length).toBe(cap + 1);
    answerAll();
    await batch.done;
    expect(calls.length).toBe(12);
    expect(batch.progress().failed).toBe(0);
  });

  it('loads by rank, then in the order the files were named', async () => {
    installFetch((c) => c.ok());
    const m = await fresh();
    await m.preload([file('late', { rank: 3 }), file('first', { rank: 1 }), file('mid', { rank: 2 }), file('unranked'), file('first-too', { rank: 1 })]).done;
    expect(urls()).toEqual(['/t/first', '/t/first-too', '/t/mid', '/t/late', '/t/unranked']);
  });

  it('front: ahead of everything queued, and the newest front request first', async () => {
    const m = await fresh();
    const all = m.preload(names(16).map((n) => file(n)));
    await idle();
    expect(urls()).toEqual(['/t/f00', '/t/f01', '/t/f02', '/t/f03', '/t/f04', '/t/f05']);
    // the round that is ending asked for its art; the next intro asks for other files
    const older = m.preload([file('f10'), file('f11')], { front: true });
    const newer = m.preload([file('f14'), file('f15'), file('f02')], { front: true });
    answerAll();
    await Promise.all([all.done, older.done, newer.done]);
    expect(urls().slice(6)).toEqual(['/t/f14', '/t/f15', '/t/f10', '/t/f11', '/t/f06', '/t/f07', '/t/f08', '/t/f09', '/t/f12', '/t/f13']);
  });

  it('paused: only front requests start, files in flight finish, and un-pausing goes on', async () => {
    const m = await fresh();
    m.setPreloadPaused(true);
    const all = m.preload(names(9).map((n) => file(n)));
    await idle();
    expect(calls.length).toBe(0);

    const now = m.preload([file('f07'), file('f08')], { front: true });
    await idle();
    expect(urls()).toEqual(['/t/f07', '/t/f08']);
    calls[0]?.ok();
    calls[1]?.ok();
    await now.done;
    await idle();
    expect(calls.length).toBe(2);
    expect(all.progress().filesDone).toBe(2);

    m.setPreloadPaused(false);
    await idle();
    expect(urls().slice(2)).toEqual(['/t/f00', '/t/f01', '/t/f02', '/t/f03', '/t/f04', '/t/f05']);

    // paused again with six in flight: they finish, nothing new starts
    m.setPreloadPaused(true);
    for (const c of calls.slice(2)) c.ok();
    await until('the six in flight end', () => all.progress().filesDone === 8);
    await idle();
    expect(calls.length).toBe(8);

    m.setPreloadPaused(false);
    await until('the last file starts', () => calls.length === 9);
    calls[8]?.ok();
    await all.done;
    expect(all.progress()).toMatchObject({ files: 9, filesDone: 9, failed: 0, finished: true, fraction: 1 });
  });
});

// ───────────────────────────── progress ─────────────────────────────

describe('preload: progress', () => {
  it('goes by bytes, never back, and ends at exactly 1 (through a size that grows and a file that starts over)', async () => {
    fakeClock();
    let breakOnce = true;
    installFetch((c) => {
      // 100 kB each where the estimate said 2 kB; the second file breaks half way on its first try
      const breakAt = c.url === '/t/b' && breakOnce ? 50_000 : undefined;
      if (breakAt !== undefined) breakOnce = false;
      c.respond(sized(100_000, body(100_000, { everyMs: 50, breakAt, signal: c.signal })));
    });
    const m = await fresh();
    const batch = m.preload([file('a'), file('b'), file('c')]);
    const seen: PreloadProgress[] = [];
    batch.subscribe((p) => seen.push(p));
    const polled: number[] = [];
    const over = settled(batch.done);
    for (let i = 0; i < 400 && !over(); i++) {
      await vi.advanceTimersByTimeAsync(25);
      polled.push(batch.progress().fraction);
    }
    expect(over()).toBe(true);
    expect(calls.length).toBe(4);

    const fractions = seen.map((p) => p.fraction);
    expect(fractions.length).toBeGreaterThan(10);
    for (const list of [fractions, polled]) {
      for (let i = 1; i < list.length; i++) expect(list[i]).toBeGreaterThanOrEqual(list[i - 1] ?? 0);
    }
    // below 1 until the end, and the end is told once
    expect(seen.filter((p) => p.finished).length).toBe(1);
    expect(seen.filter((p) => !p.finished).every((p) => p.fraction < 1)).toBe(true);
    expect(seen.at(-1)).toEqual({ files: 3, filesDone: 3, failed: 0, bytes: 300_000, bytesDone: 300_000, fraction: 1, finished: true });
    expect(batch.progress().fraction).toBe(1);
  });

  it('subscribe tells the progress right away, then about 12 times a second at most; unsubscribe stops it', async () => {
    fakeClock();
    installFetch((c) => c.respond(sized(200_000, body(200_000, { chunk: 1_000, everyMs: 5, signal: c.signal }))));
    const m = await fresh();
    const batch = m.preload([file('a')]);
    const first = vi.fn();
    const second = vi.fn();
    const stop = batch.subscribe(first);
    batch.subscribe(second);
    batch.subscribe(() => {
      throw new Error('a listener that breaks');
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(first.mock.calls[0]?.[0]).toMatchObject({ files: 1, filesDone: 0, fraction: 0, finished: false });

    await vi.advanceTimersByTimeAsync(400);
    const told = first.mock.calls.length;
    expect(told).toBeGreaterThan(2);
    expect(told).toBeLessThanOrEqual(1 + 5);

    stop();
    await vi.advanceTimersByTimeAsync(2_000);
    await batch.done;
    expect(first).toHaveBeenCalledTimes(told);
    expect(second.mock.calls.at(-1)?.[0]).toMatchObject({ fraction: 1, finished: true });

    // after the end: told once, at once, and there is nothing to unsubscribe from
    const late = vi.fn();
    batch.subscribe(late)();
    expect(late).toHaveBeenCalledTimes(1);
    expect(late.mock.calls[0]?.[0]).toMatchObject({ fraction: 1, finished: true });
  });

  it('a batch of zero files is finished at once', async () => {
    const m = await fresh();
    const batch = m.preload([]);
    expect(batch.progress()).toEqual({ files: 0, filesDone: 0, failed: 0, bytes: 0, bytesDone: 0, fraction: 1, finished: true });
    const fn = vi.fn();
    batch.subscribe(fn);
    await batch.done;
    await idle();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(0);
  });

  it('a batch of files that are all loaded is finished at once, with no request', async () => {
    installFetch((c) => c.ok());
    const m = await fresh();
    await m.preload([file('a'), file('b')]).done;
    const again = m.preload([file('a'), file('b')]);
    expect(again.progress()).toMatchObject({ files: 2, filesDone: 2, fraction: 1, finished: true });
    await again.done;
    expect(calls.length).toBe(2);
  });
});

// ───────────────────────────── failures ─────────────────────────────

describe('preload: failures, retry, refresh', () => {
  it('a 404 counts as failed, its body is cancelled, and it is not tried again by itself', async () => {
    fakeClock();
    let cancelled = false;
    installFetch((c) => c.respond(new Response(body(9, { onCancel: () => (cancelled = true) }), { status: 404 })));
    const m = await fresh();
    const after = vi.fn(() => Promise.resolve());
    const batch = m.preload([file('gone.webp', { kind: 'image', decode: true, after })]);
    await batch.done;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(batch.progress()).toMatchObject({ files: 1, filesDone: 1, failed: 1, fraction: 1, finished: true });
    expect(cancelled).toBe(true);
    expect(calls.length).toBe(1);
    expect(m.isPreloaded('/t/gone.webp')).toBe(false);
    // nothing runs for a file that is not there
    expect(images).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it('a network failure is tried once more by itself, about 2 s later', async () => {
    fakeClock();
    const m = await fresh();
    const batch = m.preload([file('a')]);
    const over = settled(batch.done);
    await idle();
    calls[0]?.fail();
    await idle();
    await vi.advanceTimersByTimeAsync(1_900);
    expect(calls.length).toBe(1);
    expect(over()).toBe(false);
    expect(batch.progress()).toMatchObject({ filesDone: 0, failed: 0, finished: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.length).toBe(2);
    calls[1]?.ok();
    await batch.done;
    expect(batch.progress()).toMatchObject({ filesDone: 1, failed: 0, fraction: 1 });
    expect(m.isPreloaded('/t/a')).toBe(true);
  });

  it('a 502 (the server restarting behind Caddy) is tried once more by itself, like a network failure', async () => {
    fakeClock();
    const m = await fresh();
    const batch = m.preload([file('a')]);
    await idle();
    calls[0]?.respond(new Response('bad gateway', { status: 502 }));
    await idle();
    expect(batch.progress()).toMatchObject({ filesDone: 0, failed: 0, finished: false });
    await vi.advanceTimersByTimeAsync(2_100);
    expect(calls.length).toBe(2);
    calls[1]?.ok();
    await batch.done;
    expect(batch.progress()).toMatchObject({ filesDone: 1, failed: 0, fraction: 1 });
  });

  it('gives a file up after that one retry: done resolves, the file counts as failed', async () => {
    fakeClock();
    installFetch((c) => c.fail());
    const m = await fresh();
    const batch = m.preload([file('a'), file('b')]);
    const over = settled(batch.done);
    await vi.advanceTimersByTimeAsync(2_100);
    await idle();
    expect(over()).toBe(true);
    expect(calls.length).toBe(4);
    expect(batch.progress()).toMatchObject({ files: 2, filesDone: 2, failed: 2, fraction: 1, finished: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length).toBe(4);
  });

  it('a request that receives nothing for 15 s is aborted, retried once, then given up on', async () => {
    fakeClock();
    const m = await fresh();
    const batch = m.preload([file('a')]);
    const over = settled(batch.done);
    await vi.advanceTimersByTimeAsync(14_900);
    expect(calls[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(over()).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls.length).toBe(2);
    await vi.advanceTimersByTimeAsync(15_100);
    await idle();
    expect(over()).toBe(true);
    expect(batch.progress()).toMatchObject({ failed: 1, finished: true });
    expect(calls.length).toBe(2);
  });

  it('a body that goes silent is given up on too, even where the request cannot be aborted', async () => {
    fakeClock();
    installFetch((c) => c.respond(sized(100_000, body(100_000, { silentAt: 20_000 }))), { ignoreAbort: true });
    const m = await fresh();
    const batch = m.preload([file('a')]);
    const over = settled(batch.done);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(batch.progress().bytesDone).toBe(20_000);
    expect(over()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100 + 2_000 + 15_100);
    await idle();
    expect(over()).toBe(true);
    expect(batch.progress()).toMatchObject({ failed: 1, finished: true, fraction: 1 });
  });

  it('a file that failed is fetched again when it is asked for again; the old batch keeps its count', async () => {
    fakeClock();
    let online = false;
    installFetch((c) => (online ? c.ok() : c.fail()));
    const m = await fresh();
    const items = [file('a'), file('b')];
    const offline = m.preload(items);
    await vi.advanceTimersByTimeAsync(2_100);
    await offline.done;
    expect(offline.progress().failed).toBe(2);
    expect(calls.length).toBe(4);

    online = true;
    const back = m.preload(items);
    expect(back.progress()).toMatchObject({ filesDone: 0, finished: false });
    await back.done;
    expect(calls.length).toBe(6);
    expect(back.progress()).toMatchObject({ filesDone: 2, failed: 0, fraction: 1 });
    expect(m.isPreloaded('/t/a')).toBe(true);
    expect(offline.progress()).toMatchObject({ filesDone: 2, failed: 2, finished: true });
  });

  it('a file asked for while it waits for its retry is tried at once', async () => {
    fakeClock();
    const m = await fresh();
    const first = m.preload([file('a')]);
    await idle();
    calls[0]?.fail();
    await idle();
    expect(calls.length).toBe(1);
    const second = m.preload([file('a')], { front: true });
    await idle();
    expect(calls.length).toBe(2);
    calls[1]?.ok();
    await Promise.all([first.done, second.done]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.length).toBe(2);
    expect(first.progress().failed).toBe(0);
  });

  it('refresh fetches a loaded file again, without running its decode or its hook again', async () => {
    installFetch((c) => c.ok());
    const m = await fresh();
    const after = vi.fn(() => Promise.resolve());
    const items = [file('a.webp', { kind: 'image', decode: true, after }), file('b')];
    await m.preload(items).done;
    expect([calls.length, images.length, after.mock.calls.length]).toEqual([2, 1, 1]);

    await m.preload(items).done;
    expect(calls.length).toBe(2);

    installFetch();
    const again = m.preload(items, { refresh: true });
    expect(again.progress()).toMatchObject({ filesDone: 0, finished: false });
    await idle();
    expect(urls()).toEqual(['/t/a.webp', '/t/b']);
    // still loaded while the fresh copy is on its way
    expect(m.isPreloaded('/t/a.webp')).toBe(true);
    for (const c of calls) c.ok();
    await again.done;
    expect(again.progress()).toMatchObject({ filesDone: 2, failed: 0, fraction: 1 });
    expect([images.length, after.mock.calls.length]).toEqual([1, 1]);
  });

  it('a refresh that fails leaves the file loaded, and the next request fetches it again', async () => {
    fakeClock();
    installFetch((c) => c.ok());
    const m = await fresh();
    await m.preload([file('a')]).done;
    installFetch((c) => c.fail());
    const stale = m.preload([file('a')], { refresh: true });
    await vi.advanceTimersByTimeAsync(2_100);
    await stale.done;
    expect(stale.progress().failed).toBe(1);
    expect(m.isPreloaded('/t/a')).toBe(true);
    installFetch((c) => c.ok());
    await m.preload([file('a')]).done;
    expect(calls.length).toBe(1);
  });
});

// ───────────────────────────── hooks and decode ─────────────────────────────

describe('preload: `after` and `decode`', () => {
  it('runs `after` once the file is fetched, and the file is done only after it', async () => {
    const m = await fresh();
    let release: () => void = () => undefined;
    const after = vi.fn(() => new Promise<void>((r) => (release = r)));
    const batch = m.preload([file('a', { after })]);
    const over = settled(batch.done);
    await idle();
    expect(after).not.toHaveBeenCalled();
    calls[0]?.ok();
    await until('the hook runs', () => after.mock.calls.length === 1);
    await idle();
    expect(over()).toBe(false);
    release();
    await batch.done;
    expect(batch.progress().failed).toBe(0);
  });

  it('a later `after` in the same call is not dropped (the plain item first, the one with a hook second)', async () => {
    installFetch((c) => c.ok());
    const m = await fresh();
    const after = vi.fn(() => Promise.resolve());
    const batch = m.preload([file('gong.mp3', { kind: 'audio' }), file('gong.mp3', { kind: 'audio', after })]);
    expect(batch.progress().files).toBe(1);
    await batch.done;
    expect(after).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(1);
  });

  it('a later `after` is taken on by a file still queued, and by one in flight', async () => {
    const m = await fresh();
    m.setPreloadPaused(true);
    const plain = m.preload([file('queued'), file('flying')]);
    const forQueued = vi.fn(() => Promise.resolve());
    const forFlying = vi.fn(() => Promise.resolve());
    const first = m.preload([file('queued', { after: forQueued })]);
    m.preload([file('flying')], { front: true });
    await idle();
    expect(urls()).toEqual(['/t/flying']);
    const second = m.preload([file('flying', { after: forFlying })]);
    const over = settled(second.done);
    await idle();
    expect(forFlying).not.toHaveBeenCalled();
    expect(over()).toBe(false);
    calls[0]?.ok();
    await second.done;
    expect(forFlying).toHaveBeenCalledTimes(1);

    m.setPreloadPaused(false);
    await until('the queued file starts', () => calls.length === 2);
    calls[1]?.ok();
    await Promise.all([plain.done, first.done]);
    expect(forQueued).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(2);
  });

  it('a later `after` for a loaded file runs once, with no new fetch, and that batch waits for it', async () => {
    installFetch((c) => c.ok());
    const m = await fresh();
    await m.preload([file('a')]).done;
    let release: () => void = () => undefined;
    const after = vi.fn(() => new Promise<void>((r) => (release = r)));
    const item = file('a', { after });
    const late = m.preload([item]);
    const over = settled(late.done);
    expect(late.progress().finished).toBe(false);
    await until('the hook runs', () => after.mock.calls.length === 1);
    await idle();
    expect(over()).toBe(false);
    release();
    await late.done;
    // the same hook again: it has run
    await m.preload([item]).done;
    await m.preload([item], { refresh: true }).done;
    expect(after).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(2);
  });

  it('a hook that fails does not fail the file, and runs again the next time the file is asked for', async () => {
    installFetch((c) => c.ok());
    const m = await fresh();
    const answers: (() => Promise<unknown>)[] = [
      () => Promise.resolve(false),
      () => Promise.reject(new Error('decoder')),
      () => {
        throw new Error('thrown');
      },
      () => Promise.resolve(true),
    ];
    let run = 0;
    const after = vi.fn(() => (answers[run++] ?? (() => Promise.resolve(true)))());
    const item = file('gong.mp3', { kind: 'audio', after });
    for (let i = 1; i <= 4; i++) {
      const batch = m.preload([item]);
      await batch.done;
      expect(after).toHaveBeenCalledTimes(i);
      expect(batch.progress().failed).toBe(0);
    }
    await m.preload([item]).done;
    expect(after).toHaveBeenCalledTimes(4);
    expect(calls.length).toBe(1);
  });

  it('a hook that never answers is left behind after 15 s', async () => {
    fakeClock();
    installFetch((c) => c.ok());
    const m = await fresh();
    const batch = m.preload([file('a', { after: () => new Promise(() => undefined) })]);
    const over = settled(batch.done);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(over()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    await idle();
    expect(over()).toBe(true);
    expect(batch.progress().failed).toBe(0);
  });

  it('decodes a picture only when asked to, once, after its fetch', async () => {
    const m = await fresh();
    const batch = m.preload([file('plain.webp', { kind: 'image' }), file('kept.webp', { kind: 'image', decode: true }), file('sound.mp3', { kind: 'audio', decode: true })]);
    await idle();
    expect(images).toEqual([]);
    for (const c of calls) c.ok();
    await batch.done;
    expect(images).toEqual(['/t/kept.webp']);

    // asked for later, for a file already loaded: decoded from the cache, no fetch
    await m.preload([file('plain.webp', { kind: 'image', decode: true }), file('kept.webp', { kind: 'image', decode: true })]).done;
    expect(images).toEqual(['/t/kept.webp', '/t/plain.webp']);
    expect(calls.length).toBe(3);
  });

  it('a picture that will not decode is still loaded', async () => {
    installImage('reject');
    installFetch((c) => c.ok());
    const m = await fresh();
    const batch = m.preload([file('odd.webp', { kind: 'image', decode: true })]);
    await batch.done;
    expect(batch.progress().failed).toBe(0);
    expect(m.isPreloaded('/t/odd.webp')).toBe(true);
  });

  it('throws nothing where Image, document, AbortController and location are missing', async () => {
    vi.stubGlobal('Image', undefined);
    vi.stubGlobal('AbortController', undefined);
    installFetch((c) => c.ok());
    const m = await fresh();
    expect(m.fontItems()).toEqual([]);
    const batch = m.preload([file('a.webp', { kind: 'image', decode: true }), ...m.fontItems()]);
    await batch.done;
    expect(batch.progress()).toMatchObject({ files: 1, failed: 0, fraction: 1 });
    expect(calls[0]?.signal).toBeNull();
  });
});

// ───────────────────────────── fonts ─────────────────────────────

describe('preload: fonts', () => {
  function fakeFace(family: string, weight: string, ok = true): FontFace {
    const face = { family, weight, style: 'normal', unicodeRange: 'U+0-10FFFF', load: vi.fn(() => (ok ? Promise.resolve(face) : Promise.reject(new Error('NetworkError')))) };
    return face as unknown as FontFace;
  }

  it("loads the page's own font faces with FontFace.load(), each once, under a key that stays", async () => {
    // the same family and weight declared by two stylesheets: two faces, both loaded
    const faces = [fakeFace('Motaleh', '400'), fakeFace('Rubik', '700'), fakeFace('Motaleh', '400')];
    vi.stubGlobal('document', { fonts: { forEach: (fn: (f: FontFace) => void) => faces.forEach(fn) } });
    const m = await fresh();
    const items = m.fontItems();
    expect(items.map((it) => [it.kind, it.rank])).toEqual([['font', 0], ['font', 0], ['font', 0]]);
    expect(new Set(items.map((it) => it.url)).size).toBe(3);
    await m.preload(items).done;

    // a stylesheet that arrives later puts its face first: the others keep their keys
    const lazy = fakeFace('Motaleh Fill', '400', false);
    faces.unshift(lazy);
    const more = m.fontItems();
    expect(more.slice(1).map((it) => it.url)).toEqual(items.map((it) => it.url));
    const batch = m.preload(more);
    await batch.done;
    expect(batch.progress()).toMatchObject({ files: 4, failed: 1 });
    for (const face of faces) expect(face.load).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(0);
  });
});

// ───────────────────────────── the kill switch ─────────────────────────────

describe('preload: ?preload=0', () => {
  it('preloadEnabled reads the page address', async () => {
    const m = await fresh();
    expect(m.preloadEnabled('')).toBe(true);
    expect(m.preloadEnabled('?room=ABCD')).toBe(true);
    expect(m.preloadEnabled('?preload=1')).toBe(true);
    expect(m.preloadEnabled('?preload=0')).toBe(false);
    expect(m.preloadEnabled('?room=ABCD&preload=0')).toBe(false);
    expect(m.preloadEnabled('preload=0')).toBe(false);
    expect(m.preloadOn()).toBe(true);
  });

  it('off: nothing is fetched, hooked or paused, and every batch is finished with zero files', async () => {
    vi.stubGlobal('location', { protocol: 'https:', search: '?room=ABCD&preload=0' });
    installFetch((c) => c.ok());
    const m = await fresh();
    expect(m.preloadOn()).toBe(false);
    const after = vi.fn(() => Promise.resolve());
    const batch = m.preload([file('a', { after }), file('b.webp', { kind: 'image', decode: true })], { front: true, refresh: true });
    expect(batch.progress()).toEqual({ files: 0, filesDone: 0, failed: 0, bytes: 0, bytesDone: 0, fraction: 1, finished: true });
    m.setPreloadPaused(true);
    m.setPreloadPaused(false);
    await batch.done;
    await m.preloadGameArt('tap');
    await idle();
    expect(calls.length).toBe(0);
    expect(images).toEqual([]);
    expect(after).not.toHaveBeenCalled();
    expect(m.isPreloaded('/t/a')).toBe(false);
  });
});

// ───────────────────────────── what to load ─────────────────────────────

describe('preloadItems: the sets as lists', () => {
  const pathOf = (it: PreloadItem): string => decodeURI(it.url);

  it("the phone list is the phone set of the files on disk, ranked for the phone, and never decoded", async () => {
    const m = await fresh();
    const items = m.preloadItems('phone');
    expect(items.map(pathOf).sort()).toEqual(LISTED.filter((p) => inPreloadSet(p, 'phone')).sort());
    expect(items.length).toBeGreaterThan(100);
    for (const it of items) {
      const path = pathOf(it);
      expect(it.kind, path).toBe(preloadKind(path));
      expect(it.rank, path).toBe(preloadRank(path, 'phone'));
      // about 123 MB of pixels: a phone keeps none of them here
      expect(it.decode, path).toBeUndefined();
      expect(it.after, path).toBeUndefined();
    }
    expect(items.some((it) => it.kind === 'audio' || it.kind === 'video')).toBe(false);
    expect(items.some((it) => /^\/assets\/hosts?\/(?!prize\.)/.test(pathOf(it)))).toBe(false);
  });

  it('the TV list is the TV set; its pictures are decoded and kept, unless a hook takes the file', async () => {
    const m = await fresh();
    const items = m.preloadItems('tv');
    expect(items.map(pathOf).sort()).toEqual(LISTED.filter((p) => inPreloadSet(p, 'tv')).sort());
    for (const it of items) expect(it.decode, it.url).toBe(it.kind === 'image' ? true : undefined);
    // every sound file in the folder: the repository's two samples, and the songs the owner dropped in (those are not in git)
    const audio = items.filter((it) => it.kind === 'audio').map(pathOf).sort();
    expect(audio).toEqual(LISTED.filter((p) => p.startsWith('/audio/') && inPreloadSet(p, 'tv')).sort());
    expect(audio).toEqual(expect.arrayContaining(['/audio/airhorn.mp3', '/audio/gong.mp3']));
    expect(items.some((it) => GAME_IDS.some((id) => it.url.startsWith(`/assets/${id}/`)))).toBe(false);

    const asked: string[] = [];
    const dress = (): Promise<unknown> => Promise.resolve();
    const hooked = m.preloadItems('tv', {
      hook: (path, url, kind) => {
        asked.push(`${kind} ${path} ${url}`);
        if (path === '/assets/host/crown.webp') throw new Error('a hook that cannot be built');
        return path.startsWith('/assets/shimi/') || kind === 'audio' ? dress : undefined;
      },
    });
    expect(asked.length).toBe(items.length);
    expect(asked).toContain('audio /audio/gong.mp3 /audio/gong.mp3');
    for (const it of hooked) {
      const taken = it.url.startsWith('/assets/shimi/') || it.kind === 'audio';
      expect(it.after, it.url).toBe(taken ? dress : undefined);
      expect(it.decode, it.url).toBe(!taken && it.kind === 'image' ? true : undefined);
    }
  });

  it('ranks by what each screen shows first', () => {
    // the TV opens on the lobby: show art, hosts, key art and prize; then the guests' dolls; sound; videos last
    const tv = (p: string): number => preloadRank(p, 'tv');
    expect(tv('/fonts/motaleh.woff2')).toBe(0);
    for (const p of ['/assets/host/curtain.webp', '/assets/hosts/host_a.webp', '/assets/intro/tap.webp', '/assets/host/prize.webp']) {
      expect(tv(p), p).toBeGreaterThan(tv('/fonts/motaleh.woff2'));
      expect(tv(p), p).toBeLessThan(tv('/assets/shimi/doll.webp'));
    }
    expect(tv('/assets/shimi/props/08_crown.webp')).toBe(tv('/assets/shimi/doll.webp'));
    expect(tv('/audio/gong.mp3')).toBeGreaterThan(tv('/assets/shimi/doll.webp'));
    expect(tv('/cutscenes/opening.mp4')).toBeGreaterThan(tv('/audio/gong.mp3'));

    // a phone opens on the dressing room: the doll and the accessories; then key art and prize; then the games
    const phone = (p: string): number => preloadRank(p, 'phone');
    expect(phone('/fonts/motaleh.woff2')).toBe(0);
    expect(phone('/assets/shimi/doll.webp')).toBeGreaterThan(0);
    expect(phone('/assets/shimi/props/08_crown.webp')).toBe(phone('/assets/shimi/doll.webp'));
    for (const p of ['/assets/intro/tap.webp', '/assets/host/prize.webp']) {
      expect(phone(p), p).toBeGreaterThan(phone('/assets/shimi/doll.webp'));
      expect(phone(p), p).toBeLessThan(phone('/assets/tap/fist.webp'));
    }
    for (const id of GAME_IDS) expect(phone(`/assets/${id}/x.webp`), id).toBe(phone('/assets/tap/fist.webp'));
  });

  it('the phone fetches the dressing room before the key art, and the key art before the games', async () => {
    installFetch((c) => c.ok());
    const m = await fresh();
    await m.preload(m.preloadItems('phone')).done;
    const stage = (url: string): number => (url.startsWith('/assets/shimi/') ? 1 : /^\/assets\/(intro|host)\//.test(url) ? 2 : 3);
    const stages = urls().map(stage);
    expect([...stages].sort()).toEqual(stages);
    expect(new Set(stages)).toEqual(new Set([1, 2, 3]));
  });
});

describe('preloadGameArt', () => {
  it("fetches that game's folder only, through a pause, and again at the next intro", async () => {
    installFetch((c) => c.ok());
    const m = await fresh();
    const tap = m.preloadItems('phone').filter((it) => it.url.startsWith('/assets/tap/')).map((it) => it.url);
    expect(tap.length).toBeGreaterThan(10);

    // a round is on: the rest of the phone's files wait
    m.setPreloadPaused(true);
    const all = m.preload(m.preloadItems('phone'));
    await m.preloadGameArt('tap');
    await idle();
    expect(urls().sort()).toEqual([...tap].sort());
    expect(tap.every((url) => m.isPreloaded(url))).toBe(true);
    expect(all.progress().filesDone).toBe(tap.length);

    // the next time the game comes up its art is fetched again: fresh for the whole round
    await m.preloadGameArt('tap');
    expect(calls.length).toBe(tap.length * 2);
    expect(urls().every((url) => url.startsWith('/assets/tap/'))).toBe(true);

    await m.preloadGameArt('no-such-game');
    expect(calls.length).toBe(tap.length * 2);

    m.setPreloadPaused(false);
    await all.done;
    expect(all.progress()).toMatchObject({ failed: 0, fraction: 1 });
    expect(calls.length).toBe(tap.length + m.preloadItems('phone').length);
  });
});

// ───────────────────────────── the two hooks ─────────────────────────────

describe('the hooks the pages attach', () => {
  it('decodeClip: true once the clip is decoded, and a clip that failed to load is tried again', async () => {
    class FakeAudioContext {
      state = 'suspended';
      destination = {};
      createDynamicsCompressor(): unknown {
        return { threshold: { value: 0 }, ratio: { value: 0 }, connect: () => undefined };
      }
      createGain(): unknown {
        return { gain: { value: 0 }, connect: () => undefined };
      }
      addEventListener(): void {
        // statechange: not needed here
      }
      decodeAudioData(buf: ArrayBuffer): Promise<unknown> {
        return Promise.resolve({ duration: 1, bytes: buf.byteLength });
      }
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext, addEventListener: () => undefined });
    let online = false;
    installFetch((c) => (online ? c.ok() : c.fail()));
    vi.resetModules();
    const audio = await import('../../client/src/kit/audio');

    expect(await audio.decodeClip('gong')).toBe(false);
    expect(calls.length).toBe(1);
    // preloadClips (a play) does not try again by itself
    audio.preloadClips(['gong']);
    await idle();
    expect(calls.length).toBe(1);

    online = true;
    expect(await audio.decodeClip('gong')).toBe(true);
    expect(urls()).toEqual(['/audio/gong.mp3', '/audio/gong.mp3']);
    // decoded: kept
    expect(await audio.decodeClip('gong')).toBe(true);
    expect(calls.length).toBe(2);
    // no such file: false, and nothing is asked of the server
    expect(await audio.decodeClip('no_such_clip')).toBe(false);
    expect(calls.length).toBe(2);
  });

  it("loadAvatarPicture: true once the picture is in the compositor's cache, false when it does not load", async () => {
    class LoadingImage {
      decoding = '';
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(v: string) {
        images.push(v);
        queueMicrotask(() => {
          if (v.includes('missing')) this.onerror?.();
          else {
            // small enough that no half-size copy (a canvas) is made
            this.naturalWidth = 16;
            this.naturalHeight = 16;
            this.onload?.();
          }
        });
      }
    }
    images = [];
    vi.stubGlobal('Image', LoadingImage);
    vi.resetModules();
    const avatar = await import('../../client/src/avatar/compose');
    expect(await avatar.loadAvatarPicture('/assets/shimi/doll.webp')).toBe(true);
    expect(await avatar.loadAvatarPicture('/assets/shimi/doll.webp')).toBe(true);
    expect(await avatar.loadAvatarPicture('/assets/shimi/missing.webp')).toBe(false);
    expect(images).toEqual(['/assets/shimi/doll.webp', '/assets/shimi/missing.webp']);
  });
});
