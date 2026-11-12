/**
 * The phone's background loading: what the preloader (kit/preload.ts) fetches on a guest's phone,
 * and when. Nothing here is a screen and nothing waits for it: the guest types a name, dresses
 * and plays exactly as without it, and the files arrive behind that.
 *
 *   before the name   the doll and the accessories, while the guest types (warmDressingPictures:
 *                     welcome.tsx decides whether, by the dressing step's switch)
 *   in the room       the whole phone set, in the order the phone shows it: the fonts, the doll
 *                     and the accessories, the key art and the prize, the games' art
 *   a round           the queue is held (intro, countdown, play): only the game being played
 *                     loads, at the front, once its code is in (IntroScreen). A phone that opens
 *                     or reloads in the middle of a round starts nothing until the round is over.
 *
 * A doll or accessory file goes on into the avatar compositor's own cache (loadAvatarPicture), so
 * one loader fetches it and the dressing room draws from it. Nothing else is decoded here: a
 * phone that kept every picture decoded would hold about 123 MB of pixels.
 *
 * `?preload=0` (preloadOn() false): none of it runs, and the page warms its files as it did
 * before the preloader (preloadAvatarAssets here; the callers keep their own old warm-ups).
 */
import { useEffect, useState } from 'preact/hooks';

import { loadAvatarPicture, preloadAvatarAssets } from '../avatar';
import { fontItems, preload, preloadItems, preloadOn, setPreloadPaused } from '../kit/preload';

import type { PreloadBatch, PreloadItem } from '../kit/preload';

/** The doll and the accessories: client/public/assets/shimi/doll.* and shimi/props/ (kit/preload-sets.ts). */
const DOLL_DIR = '/assets/shimi/';
/** The thin bar shows only for loading that takes longer than this (a warm cache finishes sooner). */
const BAR_AFTER_MS = 400;
/** How long the full bar stays before it goes. */
const BAR_DONE_MS = 300;

/**
 * The phone set, built once: the same items (and the same hooks) are named again to try the
 * files that failed, and a hook that is the same function never runs twice for a file.
 */
let phoneItems: readonly PreloadItem[] | null = null;

function items(): readonly PreloadItem[] {
  phoneItems ??= preloadItems('phone', {
    hook: (path) => (path.startsWith(DOLL_DIR) ? () => loadAvatarPicture(path) : undefined),
  });
  return phoneItems;
}

/**
 * The doll and every accessory picture, ahead of the dressing room (the join screen calls it
 * while the guest types). The same entries the room's background loading names later: each file
 * is fetched once.
 */
export function warmDressingPictures(): void {
  if (!preloadOn()) {
    void preloadAvatarAssets();
    return;
  }
  // only the doll and the accessories have a hook
  preload(items().filter((it) => it.after !== undefined));
}

interface Background {
  readonly batch: PreloadBatch;
  readonly startedAt: number;
}

let background: Background | null = null;
let held = false;
const watchers = new Set<() => void>();

/**
 * Hold the queue for the length of a round (the screen is the intro, the countdown or the game),
 * let it run on every other screen. The App derives the value from the screen it shows, before
 * the paint, so no file for later starts once the round's first screen is up.
 */
export function holdPreload(roundOn: boolean): void {
  if (!preloadOn()) return;
  held = roundOn;
  setPreloadPaused(roundOn);
}

/**
 * Called by the App with where the phone is, every time it changes:
 *   inRoom   joined, with the room's state in hand, and no round on this phone's screen
 *   online   the socket is up (with no network every file would fail at once)
 * It starts the background loading the first time both hold. Loading that ended with files
 * missing (a moment without network) is started again at the next call: the files that are in
 * cost nothing.
 */
export function syncPreload(inRoom: boolean, online: boolean): void {
  if (!preloadOn() || !inRoom || !online || held) return;
  if (background !== null) {
    const p = background.batch.progress();
    if (!p.finished || p.failed === 0) return;
  }
  // the fonts are read from the page's CSS now: it is in long before a guest is in a room
  background = { batch: preload([...items(), ...fontItems()]), startedAt: performance.now() };
  for (const fn of watchers) fn();
}

/** The background loading as the end-to-end scripts read it (window.__player.preload). */
export interface PreloadDebug {
  /** False with `?preload=0`: nothing below ever changes. */
  readonly on: boolean;
  /** The room's background loading has started (not before the join, not in the middle of a round). */
  readonly started: boolean;
  readonly files: number;
  /** Loaded or given up on. */
  readonly filesDone: number;
  readonly failed: number;
  readonly finished: boolean;
  /** Held for a round: only the current game's art loads. */
  readonly paused: boolean;
}

export function preloadDebug(): PreloadDebug {
  const p = background?.batch.progress();
  return {
    on: preloadOn(),
    started: background !== null,
    files: p?.files ?? 0,
    filesDone: p?.filesDone ?? 0,
    failed: p?.failed ?? 0,
    finished: p?.finished ?? false,
    paused: held,
  };
}

/**
 * How full the thin bar is (0..1), or null for no bar. There is one only while `active` (the App
 * says on which screens) and the background loading is unfinished and has been at it for
 * BAR_AFTER_MS; it fills up and goes when the loading ends.
 */
export function usePreloadBar(active: boolean): number | null {
  const [fraction, setFraction] = useState<number | null>(null);
  useEffect(() => {
    if (!active) {
      setFraction(null);
      return undefined;
    }
    let off = (): void => undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const follow = (): void => {
      off();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      setFraction(null);
      const bg = background;
      if (bg === null || bg.batch.progress().finished) return;
      timer = setTimeout(
        () => {
          // done inside the wait (a warm cache, one file fetched again): no bar at all
          if (bg.batch.progress().finished) return;
          off = bg.batch.subscribe((p) => {
            setFraction(p.fraction);
            if (p.finished) timer = setTimeout(() => setFraction(null), BAR_DONE_MS);
          });
        },
        Math.max(0, bg.startedAt + BAR_AFTER_MS - performance.now()),
      );
    };
    follow();
    // the loading can start (or start again) while the screen is up
    watchers.add(follow);
    return (): void => {
      watchers.delete(follow);
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [active]);
  return fraction;
}
