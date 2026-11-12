/** Phone browser taming: no zoom, no scroll bounce, exact viewport height, fullscreen, wake lock. */

let viewportReady = false;

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, textarea, select, label, [role="button"]') !== null;
}

/** A finger may scroll inside an element that opted in: `.kit-scroll` (a vertical list) or `.kit-scroll-x` (a horizontal strip). */
function inScroller(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.kit-scroll, .kit-scroll-x') !== null;
}

/**
 * Idempotent. Blocks pinch zoom, double-tap zoom, the context menu,
 * pull-to-refresh and scroll bounce, and keeps the CSS variable --app-h equal
 * to the visible viewport height (URL bar, on-screen keyboard).
 */
export function initMobileViewport(): void {
  if (viewportReady || typeof window === 'undefined') return;
  viewportReady = true;
  const active: AddEventListenerOptions = { passive: false };
  const stop = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
  };

  // iOS pinch
  document.addEventListener('gesturestart', stop, active);
  document.addEventListener('gesturechange', stop, active);
  document.addEventListener('gestureend', stop, active);

  // scroll bounce, pull-to-refresh, two-finger zoom
  document.addEventListener(
    'touchmove',
    (e: TouchEvent): void => {
      if (e.touches.length > 1 || !inScroller(e.target)) stop(e);
    },
    active,
  );

  // double-tap zoom (kept off real controls so their click still fires)
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e: TouchEvent): void => {
      const now = performance.now();
      if (now - lastTouchEnd < 350 && !isInteractive(e.target)) stop(e);
      lastTouchEnd = now;
    },
    active,
  );
  document.addEventListener('dblclick', stop, active);

  // long-press menu, image drag, desktop ctrl+wheel zoom
  document.addEventListener('contextmenu', (e: Event): void => {
    if (!isEditable(e.target)) stop(e);
  });
  document.addEventListener('dragstart', stop);
  document.addEventListener('selectstart', (e: Event): void => {
    if (!isEditable(e.target)) stop(e);
  });
  window.addEventListener(
    'wheel',
    (e: WheelEvent): void => {
      if (e.ctrlKey) stop(e);
    },
    active,
  );

  const vv = window.visualViewport;
  const root = document.documentElement;
  const apply = (): void => {
    const h = vv ? vv.height : window.innerHeight;
    if (h > 0) root.style.setProperty('--app-h', `${Math.round(h * 100) / 100}px`);
    // iOS scrolls the fixed page when the keyboard opens: put it back.
    if (!isEditable(document.activeElement) && (window.scrollX !== 0 || window.scrollY !== 0)) window.scrollTo(0, 0);
  };
  apply();
  if (vv) {
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
  }
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 250));
  window.addEventListener('scroll', apply, { passive: true });
  document.addEventListener('focusout', () => setTimeout(apply, 60));
}

/**
 * Call from a user gesture. Uses the Fullscreen API where it exists (Android);
 * a silent no-op elsewhere (iPhone Safari has none) and when already
 * fullscreen or launched from the home screen. Never throws or rejects.
 */
export async function enterFullscreen(): Promise<void> {
  try {
    if (typeof document === 'undefined' || isStandalone() || document.fullscreenElement) return;
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    if (typeof el.requestFullscreen === 'function') await el.requestFullscreen({ navigationUI: 'hide' });
    else if (typeof el.webkitRequestFullscreen === 'function') await el.webkitRequestFullscreen();
  } catch {
    // denied or unsupported: the page works without it
  }
}

let wakeWanted = false;
let wakeListening = false;
let wakeLock: WakeLockSentinel | null = null;

async function acquireWakeLock(): Promise<void> {
  try {
    if (!wakeWanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // low battery, unsupported, not allowed: ignore
  }
}

/** Keep the screen on (Screen Wake Lock), re-acquired when the tab becomes visible again. Never throws. */
export async function keepAwake(): Promise<void> {
  wakeWanted = true;
  if (!wakeListening && typeof document !== 'undefined') {
    wakeListening = true;
    document.addEventListener('visibilitychange', () => {
      void acquireWakeLock();
    });
  }
  await acquireWakeLock();
}

/** True when launched from the home screen (installed web app). */
export function isStandalone(): boolean {
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;
  } catch {
    return false;
  }
}

export interface SafeArea {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Safe-area insets in CSS px, measured now (they change with orientation). */
export function getSafeArea(): SafeArea {
  if (typeof document === 'undefined' || !document.body) return { top: 0, right: 0, bottom: 0, left: 0 };
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const px = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const area: SafeArea = {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
  probe.remove();
  return area;
}
