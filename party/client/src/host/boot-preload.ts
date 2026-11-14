/**
 * What the TV loads ahead (kit/preload.ts): ONE batch, started from main.tsx before the first
 * render, in the background. Nothing waits for it: the room, the QR and the keys come up as they
 * always did, and the batch only draws how far it is (app.tsx: a bar on the boot card, then a
 * thin line on the stage's top edge).
 *
 *   the show's pictures      fetched, then decoded and kept by the engine
 *   the doll, accessories    fetched, then taken by the avatar compositor's own cache
 *   the air horn, the gong   fetched, then decoded by kit/audio
 *   the cutscenes            one file each: the one this browser will play (media.ts)
 *   the fonts                every @font-face of the page
 *
 * One network path per file: the engine fetches it, and the screen's own cache is filled from
 * the warm HTTP cache by the file's hook. So the loaders the page had before (the key art, the
 * avatar files, the clips) do not run beside it. They run only with `?preload=0`, where the
 * engine does nothing and the page loads as it did without it.
 */
import { useEffect, useState } from 'preact/hooks';

import { CUTSCENES } from '../../../shared/cutscenes';
import { loadAvatarPicture, preloadAvatarAssets } from '../avatar';
import { decodeClip } from '../kit/audio';
import { fontItems, preload, preloadItems, preloadOn, preloadRank } from '../kit/preload';
import { cutsceneUrl, preloadSource } from './media';
import { preloadIntroArt } from './show/art';

import type { PreloadBatch, PreloadItem, PreloadKind, PreloadProgress } from '../kit/preload';

/** The clips the show plays from a decoded buffer. Never a song: decoded, a song is tens of MB. */
export const TV_CLIPS: readonly string[] = ['airhorn', 'gong', 'drumroll'];

/** The thin bar waits this long: a refresh with everything in the cache is over before it and never shows it. */
const LATE_MS = 400;

function hookFor(path: string, _url: string, kind: PreloadKind): (() => Promise<unknown>) | undefined {
  if (kind === 'audio') {
    const name = path.replace(/^\/audio\/|\.\w+$/g, '');
    return TV_CLIPS.includes(name) ? () => decodeClip(name) : undefined;
  }
  // the doll and the accessories: the compositor draws them from its own cache, keyed by this very path
  if (path.startsWith('/assets/shimi/')) return () => loadAvatarPicture(path);
  return undefined;
}

/** A cutscene with no file yet is normal: it has no item. */
function cutsceneItems(): PreloadItem[] {
  const out: PreloadItem[] = [];
  for (const def of CUTSCENES) {
    const file = preloadSource(def);
    if (file !== null) out.push({ url: cutsceneUrl(file), kind: 'video', rank: preloadRank(`/cutscenes/${file}`, 'tv') });
  }
  return out;
}

/** Built once: naming the same items again is how a lost file is asked for again (their hooks are already known). */
let items: readonly PreloadItem[] = [];
/** A finished batch of no files until the page starts the real one (and for good with `?preload=0`). */
let batch: PreloadBatch = preload([]);
let startedAt = 0;
let started = false;
/** Told when `batch` is replaced (the start, a retry). */
const watchers = new Set<() => void>();

function run(): void {
  batch = preload(items);
  startedAt = performance.now();
  for (const fn of [...watchers]) fn();
}

/** Start loading the TV's files. Call once, after the page's CSS is in (the fonts are read from it). */
export function startTvPreload(): void {
  if (started) return;
  started = true;
  if (!preloadOn()) {
    // no engine: the page warms what it warmed before it (the clips: app.tsx, after the first render)
    preloadIntroArt();
    void preloadAvatarAssets();
    return;
  }
  items = [...preloadItems('tv', { hook: hookFor }), ...cutsceneItems(), ...fontItems()];
  run();
}

/**
 * Ask again for whatever is still missing, once the first try is over: a file that failed is
 * fetched again, a hook that failed runs again, and what is loaded costs nothing. The page calls
 * it when the connection to the server comes back, which is when a lost file can be had.
 */
export function retryTvPreload(): void {
  if (items.length === 0 || !batch.progress().finished) return;
  run();
}

/** How far the TV's batch is (the tests wait for `finished` and read `failed`: window.__host.preload()). */
export function tvPreloadProgress(): PreloadProgress {
  return batch.progress();
}

export interface TvPreloadView {
  readonly progress: PreloadProgress;
  /** Still loading LATE_MS after it started: the moment to draw the thin bar. */
  readonly late: boolean;
}

/** Follow the batch from a component (it re-renders on progress, about 12 times a second at most). */
export function useTvPreload(): TvPreloadView {
  const [, redraw] = useState(0);
  const [lateFor, setLateFor] = useState<PreloadBatch | null>(null);
  useEffect(() => {
    let off = (): void => undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = (): void => {
      off();
      clearTimeout(timer);
      const b = batch;
      off = b.subscribe(() => redraw((n) => (n + 1) % 1_000_000));
      // a batch that is already over (everything was in the cache) never gets a bar
      timer = b.progress().finished ? undefined : setTimeout(() => setLateFor(b), Math.max(0, startedAt + LATE_MS - performance.now()));
    };
    watch();
    watchers.add(watch);
    return () => {
      watchers.delete(watch);
      off();
      clearTimeout(timer);
    };
  }, []);
  const progress = batch.progress();
  return { progress, late: lateFor === batch && !progress.finished };
}
