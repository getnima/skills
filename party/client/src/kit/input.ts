/**
 * Unified Pointer Events (touch, mouse, pen) with multi-touch.
 * Coordinates are CSS px relative to the target's top-left corner, which for a
 * createGameCanvas(root) canvas is exactly the canvas drawing space.
 * Honors the freeze switch: while the kit is paused every event is dropped and
 * pointers that were down get an `up` with `cancelled: true`.
 */
import { isKitPaused, onKitPause, reportKitError } from './loop';

export interface KitPointer {
  /** Stable while the finger is down. */
  readonly id: number;
  x: number;
  y: number;
  /** Position at the previous event of this pointer (for swipe segments). */
  prevX: number;
  prevY: number;
  readonly startX: number;
  readonly startY: number;
  /** performance.now() at pointer down. Real time: use only for gesture feel, never for game logic. */
  readonly downAt: number;
  /** 'touch' | 'mouse' | 'pen'. */
  readonly type: string;
  /** Set on the `up` of a pointer that did not end normally (freeze, system gesture, blur). */
  cancelled: boolean;
}

export type PointerHandler = (p: KitPointer) => void;

export interface Input {
  /** Each returns an unsubscribe function. */
  onDown(fn: PointerHandler): () => void;
  /** Fires only for pointers that are down (drags), not for mouse hover. */
  onMove(fn: PointerHandler): () => void;
  onUp(fn: PointerHandler): () => void;
  /** Pointers currently down, by id. */
  readonly pointers: ReadonlyMap<number, KitPointer>;
  /** True while at least one pointer is down. */
  isDown(): boolean;
  /** Remove every listener (idempotent). */
  dispose(): void;
}

export function createInput(target: HTMLElement): Input {
  const pointers = new Map<number, KitPointer>();
  const downs = new Set<PointerHandler>();
  const moves = new Set<PointerHandler>();
  const ups = new Set<PointerHandler>();
  let disposed = false;
  let rect = target.getBoundingClientRect();
  let rectAt = 0;

  function origin(): DOMRect {
    const now = performance.now();
    if (now - rectAt > 250) {
      rect = target.getBoundingClientRect();
      rectAt = now;
    }
    return rect;
  }

  function emit(set: Set<PointerHandler>, p: KitPointer): void {
    for (const fn of [...set]) {
      try {
        fn(p);
      } catch (err) {
        reportKitError(err);
      }
    }
  }

  function release(id: number, cancelled: boolean): void {
    const p = pointers.get(id);
    if (!p) return;
    pointers.delete(id);
    p.cancelled = cancelled;
    try {
      if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    } catch {
      // the pointer is already gone
    }
    emit(ups, p);
  }

  function cancelAll(): void {
    for (const id of [...pointers.keys()]) release(id, true);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.cancelable) e.preventDefault();
    if (isKitPaused()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointers.has(e.pointerId)) release(e.pointerId, true);
    rectAt = 0;
    const r = origin();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const p: KitPointer = {
      id: e.pointerId,
      x,
      y,
      prevX: x,
      prevY: y,
      startX: x,
      startY: y,
      downAt: performance.now(),
      type: e.pointerType || 'mouse',
      cancelled: false,
    };
    pointers.set(e.pointerId, p);
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no capturable pointer
    }
    emit(downs, p);
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.cancelable) e.preventDefault();
    if (isKitPaused()) return;
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const r = origin();
    p.prevX = p.x;
    p.prevY = p.y;
    p.x = e.clientX - r.left;
    p.y = e.clientY - r.top;
    emit(moves, p);
  }

  function onPointerUp(e: PointerEvent): void {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const r = origin();
    p.prevX = p.x;
    p.prevY = p.y;
    p.x = e.clientX - r.left;
    p.y = e.clientY - r.top;
    release(e.pointerId, false);
  }

  function onPointerCancel(e: PointerEvent): void {
    release(e.pointerId, true);
  }

  const blockTouch = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
  };

  const offPause = onKitPause((paused) => {
    if (paused) cancelAll();
  });

  const active: AddEventListenerOptions = { passive: false };
  target.addEventListener('pointerdown', onPointerDown, active);
  target.addEventListener('pointermove', onPointerMove, active);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerCancel);
  target.addEventListener('touchmove', blockTouch, active);
  target.addEventListener('contextmenu', blockTouch);
  window.addEventListener('blur', cancelAll);

  function sub(set: Set<PointerHandler>, fn: PointerHandler): () => void {
    set.add(fn);
    return (): void => {
      set.delete(fn);
    };
  }

  return {
    onDown: (fn: PointerHandler): (() => void) => sub(downs, fn),
    onMove: (fn: PointerHandler): (() => void) => sub(moves, fn),
    onUp: (fn: PointerHandler): (() => void) => sub(ups, fn),
    pointers,
    isDown: (): boolean => pointers.size > 0,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      offPause();
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerCancel);
      target.removeEventListener('touchmove', blockTouch);
      target.removeEventListener('contextmenu', blockTouch);
      window.removeEventListener('blur', cancelAll);
      pointers.clear();
      downs.clear();
      moves.clear();
      ups.clear();
    },
  };
}
