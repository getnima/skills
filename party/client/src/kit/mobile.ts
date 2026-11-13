/** Phone browser taming: no zoom, no scroll bounce, exact viewport height, fullscreen, wake lock. */

let viewportReady = false;

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** iPhone / iPad: every browser there is WebKit, and its keyboard never resizes the page. */
function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, textarea, select, label, [role="button"]') !== null;
}

/** The opted-in scroller a touch is in: `.kit-scroll` (a vertical list) or `.kit-scroll-x` (a horizontal strip), else null. */
function scrollerOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest('.kit-scroll, .kit-scroll-x') : null;
}

/**
 * Can `el` still scroll the way a finger moving by (dx, dy) pushes it? Along its own axis only: a vertical
 * list never takes a sideways drag and a horizontal strip never an up-down one. RTL strips count from the right
 * (their scrollLeft runs from 0 down to minus the overflow).
 */
export function canScrollWith(el: Element, horizontal: boolean, dx: number, dy: number): boolean {
  if (horizontal) {
    if (Math.abs(dy) > Math.abs(dx)) return false;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1 || dx === 0) return false;
    const rtl = getComputedStyle(el).direction === 'rtl';
    // how far from the strip's start edge it is, 0..max
    const pos = rtl ? -el.scrollLeft : el.scrollLeft;
    // a finger moving right shows what is to the left: the far end of an RTL strip, the start of an LTR one
    const toLeft = dx > 0;
    return rtl === toLeft ? pos < max - 1 : pos > 1;
  }
  if (Math.abs(dx) > Math.abs(dy)) return false;
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 1 || dy === 0) return false;
  // a finger moving down shows what is above
  return dy > 0 ? el.scrollTop > 1 : el.scrollTop < max - 1;
}

/** Touches that start this close to a side of the screen are claimed: there the browser's back / forward swipe lives. */
const EDGE_PX = 22;

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

  // No drag ever reaches the browser: no scroll bounce, no pull-to-refresh, no URL bar sliding in, no
  // two-finger zoom, no back / forward swipe. A finger scrolls only inside an opted-in scroller, along its
  // axis, and only while that scroller can still move that way. The first move of a gesture decides it
  // for the whole gesture (once a scroll has begun the browser no longer lets a page cancel it).
  let gesture: { readonly el: Element | null; readonly x: number; readonly y: number; decided: boolean; allow: boolean } | null = null;
  // a touch that started at a side edge (claimed, so its click is ours to send)
  let edgeTap: { readonly target: EventTarget | null; readonly x: number; readonly y: number; moved: boolean } | null = null;
  document.addEventListener(
    'touchstart',
    (e: TouchEvent): void => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t) {
        gesture = null;
        edgeTap = null;
        return;
      }
      gesture = { el: scrollerOf(e.target), x: t.clientX, y: t.clientY, decided: false, allow: false };
      edgeTap = null;
      if ((t.clientX < EDGE_PX || t.clientX > window.innerWidth - EDGE_PX) && !isEditable(e.target) && e.cancelable) {
        e.preventDefault();
        edgeTap = { target: e.target, x: t.clientX, y: t.clientY, moved: false };
      }
    },
    active,
  );
  document.addEventListener(
    'touchmove',
    (e: TouchEvent): void => {
      const t = e.touches[0];
      const g = gesture;
      if (edgeTap && t && Math.hypot(t.clientX - edgeTap.x, t.clientY - edgeTap.y) > 10) edgeTap.moved = true;
      if (e.touches.length > 1 || !t || !g || g.el === null) {
        stop(e);
        return;
      }
      if (!g.decided) {
        const dx = t.clientX - g.x;
        const dy = t.clientY - g.y;
        if (dx === 0 && dy === 0) return;
        g.decided = true;
        g.allow = canScrollWith(g.el, g.el.classList.contains('kit-scroll-x'), dx, dy);
      }
      if (!g.allow) stop(e);
    },
    active,
  );
  document.addEventListener(
    'touchend',
    (e: TouchEvent): void => {
      // a tap that started at a side edge: the browser sends no click for it (its touchstart was claimed)
      const tap = edgeTap;
      edgeTap = null;
      if (e.touches.length === 0) gesture = null;
      if (tap === null || tap.moved || !(tap.target instanceof Element)) return;
      const control = tap.target.closest<HTMLElement>('button, a, label, [role="button"], [role="tab"], summary');
      if (control !== null && !(control instanceof HTMLButtonElement && control.disabled)) control.click();
    },
    active,
  );
  document.addEventListener('touchcancel', () => {
    gesture = null;
    edgeTap = null;
  });

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
  const ios = isIOS();
  const apply = (): void => {
    const editing = isEditable(document.activeElement);
    // iPhone, a field has focus: the page keeps the height it had. Safari there never resizes the
    // page for the keyboard, it slides the page up to show the field (as on every site). Making the
    // app as short as the visible part at that moment left it above the visible part, out of
    // sight: the guest typed a name into an empty screen. Android resizes the page itself
    // (interactive-widget=resizes-content), so there the app does follow the keyboard.
    if (!(ios && editing)) {
      const h = vv ? vv.height : window.innerHeight;
      if (h > 0) root.style.setProperty('--app-h', `${Math.round(h * 100) / 100}px`);
    }
    // The keyboard is gone: put the page back where iOS slid it from.
    if (!editing && (window.scrollX !== 0 || window.scrollY !== 0 || (vv !== null && vv.offsetTop > 0.5))) window.scrollTo(0, 0);
  };
  apply();
  if (vv) {
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
  }
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 250));
  window.addEventListener('scroll', apply, { passive: true });
  // After a field loses focus the keyboard is still sliding away: look again once it is down
  // (iPhone Safari does not always report the last step).
  document.addEventListener('focusout', () => {
    for (const ms of [60, 350, 800, 1500]) setTimeout(apply, ms);
  });
  if (/[?&]vvdebug=1(&|$)/.test(window.location.search)) showViewportDebug();
}

/**
 * ?vvdebug=1: small rulers down the left edge with the numbers the browser reports about the
 * visible part of the page. For a screenshot from a real phone with the keyboard up (no
 * simulator shows that keyboard to an automated browser).
 */
function showViewportDebug(): void {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:0;z-index:2147483647;pointer-events:none;direction:ltr';
  const rows: HTMLElement[] = [];
  for (let y = 0; y < 1400; y += 70) {
    const row = document.createElement('div');
    row.style.cssText = `position:absolute;left:0;top:${y}px;font:9px/11px ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,.72);padding:0 3px;white-space:nowrap`;
    box.appendChild(row);
    rows.push(row);
  }
  document.documentElement.appendChild(box);
  setInterval(() => {
    const vv = window.visualViewport;
    const el = document.activeElement;
    const r = el instanceof HTMLElement && isEditable(el) ? el.getBoundingClientRect() : null;
    const n = (v: number | undefined): string => (v === undefined ? '?' : String(Math.round(v)));
    const text =
      `ih${n(window.innerHeight)} ch${n(document.documentElement.clientHeight)} vh${n(vv?.height)} vt${n(vv?.offsetTop)} pt${n(vv?.pageTop)} ` +
      `sy${n(window.scrollY)} ah${getComputedStyle(document.documentElement).getPropertyValue('--app-h').trim()} f${r ? `${n(r.top)}-${n(r.bottom)}` : '-'}`;
    rows.forEach((row, i) => {
      row.textContent = `y${i * 70} ${text}`;
    });
  }, 250);
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
