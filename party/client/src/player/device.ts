/**
 * Phone-only device glue for the player page (not the games): the "turn the phone
 * upright" overlay, Android fullscreen that comes back after it was lost, and the
 * portrait lock while fullscreen.
 */
import { enterFullscreen } from '../kit/mobile';

function isEditable(el: Element | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** True when the device is turned sideways (not just a short window: an open keyboard makes the page wider than tall). */
function isLandscape(): boolean {
  try {
    const t = screen.orientation?.type;
    if (typeof t === 'string') return t.startsWith('landscape');
  } catch {
    // ignore
  }
  const legacy = (window as Window & { orientation?: number }).orientation;
  if (typeof legacy === 'number') return Math.abs(legacy) === 90;
  return window.innerWidth > window.innerHeight;
}

/** A phone, not a tablet or a laptop: the short side of the screen is phone-sized. */
function isPhoneSized(): boolean {
  const short = Math.min(screen.width || window.innerWidth, screen.height || window.innerHeight);
  return short < 560;
}

let watching = false;

/**
 * Keeps `html.pp-landscape` while a phone is held sideways. The overlay it shows
 * only covers the page: the round clock is the server's and keeps running, and the
 * game under it gets its size back when the phone is turned upright again.
 * Never while a field has focus (the on-screen keyboard is not a rotation).
 */
export function watchOrientation(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const root = document.documentElement;
  const update = (): void => {
    const on = isLandscape() && isPhoneSized() && !isEditable(document.activeElement);
    root.classList.toggle('pp-landscape', on);
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => {
    update();
    setTimeout(update, 300);
  });
  try {
    screen.orientation?.addEventListener('change', update);
  } catch {
    // ignore
  }
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => setTimeout(update, 50));
}

let fullscreenWanted = false;

function hasFullscreenApi(): boolean {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: unknown };
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

function lockPortrait(): void {
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (document.fullscreenElement && typeof o?.lock === 'function') void o.lock('portrait').catch(() => undefined);
  } catch {
    // unsupported: the overlay covers it
  }
}

/**
 * From the join tap (a user gesture). Android Chrome: fullscreen without the
 * address bar, locked upright. iPhone: no Fullscreen API, nothing happens.
 */
export function goFullscreen(): void {
  if (!hasFullscreenApi()) return;
  fullscreenWanted = true;
  void enterFullscreen().then(lockPortrait);
}

let reentryReady = false;

/**
 * Android drops fullscreen when the guest switches apps, locks the phone or
 * presses back. The next tap outside a running game puts it back (a tap is the
 * only thing allowed to); inside a game it waits, so the canvas never jumps
 * under a finger mid-round.
 */
export function keepFullscreen(): void {
  if (reentryReady || typeof window === 'undefined') return;
  reentryReady = true;
  window.addEventListener(
    'pointerup',
    (e: PointerEvent): void => {
      if (!fullscreenWanted || e.pointerType === 'mouse' || document.fullscreenElement) return;
      if (document.querySelector('.pa-stage') !== null) return;
      if (isEditable(document.activeElement)) return;
      void enterFullscreen().then(lockPortrait);
    },
    { capture: true, passive: true },
  );
}
