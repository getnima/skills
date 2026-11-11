/** DPR-aware full-size canvas. All drawing coordinates are CSS px. */

const MAX_DPR = 2;

export interface GameCanvas {
  readonly canvas: HTMLCanvasElement;
  /** Already scaled: draw in CSS px. Do not call setTransform() without restoring. */
  readonly ctx: CanvasRenderingContext2D;
  /** Logical size in CSS px. Read every frame: it changes on resize / rotation. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Called after every size change with the new logical size. Returns an unsubscribe. */
  onResize(fn: (width: number, height: number) => void): () => void;
  /** Clear the whole canvas. */
  clear(): void;
  /** Remove the canvas and its listeners (idempotent). */
  dispose(): void;
}

/** Create a canvas that fills `root` (which must have a size) and follows its size. */
export function createGameCanvas(root: HTMLElement): GameCanvas {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none';
  // Hebrew pages are RTL and a canvas inherits that: "+5" would draw as "5+".
  // Canvas text is LTR by default here; use drawText() for mixed / Hebrew strings.
  canvas.dir = 'ltr';
  root.appendChild(canvas);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Canvas 2D is not available');
  const ctx: CanvasRenderingContext2D = context;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let disposed = false;
  const listeners = new Set<(w: number, h: number) => void>();

  function measure(notify: boolean): void {
    if (disposed) return;
    const w = Math.max(1, Math.round(root.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.round(root.clientHeight || window.innerHeight));
    const d = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
    if (w === width && h === height && d === dpr) return;
    width = w;
    height = h;
    dpr = d;
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (notify) for (const fn of [...listeners]) fn(w, h);
  }

  const onWindow = (): void => measure(true);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure(true)) : null;
  ro?.observe(root);
  window.addEventListener('resize', onWindow);
  window.addEventListener('orientationchange', onWindow);
  measure(false);

  return {
    canvas,
    ctx,
    get width(): number {
      return width;
    },
    get height(): number {
      return height;
    },
    get dpr(): number {
      return dpr;
    },
    onResize(fn: (w: number, h: number) => void): () => void {
      listeners.add(fn);
      return (): void => {
        listeners.delete(fn);
      };
    },
    clear(): void {
      ctx.clearRect(0, 0, width, height);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ro?.disconnect();
      window.removeEventListener('resize', onWindow);
      window.removeEventListener('orientationchange', onWindow);
      listeners.clear();
      canvas.remove();
    },
  };
}

/**
 * Rounded-rectangle path (beginPath included). Use this instead of
 * ctx.roundRect(), which older iPhones (iOS 15) do not have.
 */
export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const HEBREW = /[\u0590-\u05FF]/;

/**
 * fillText (and strokeText when `stroke` is true) with the right direction:
 * RTL for strings that contain Hebrew, LTR otherwise ("+5", "x3").
 */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, stroke = false): void {
  const dir: CanvasDirection = HEBREW.test(text) ? 'rtl' : 'ltr';
  if (ctx.direction !== dir) ctx.direction = dir;
  if (stroke) ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}
