/**
 * Things of "שימי טאפ" painted ONCE into small offscreen canvases (and only blitted in the hot
 * path): the fingerprint, the counter panel, a music note. No gradients, shadows or text measuring per frame.
 */
import { roundRectPath } from '../../kit/canvas';
import { makeLayer, PAL } from './look';

export interface Layer {
  readonly canvas: HTMLCanvasElement;
  /** Logical size (CSS px). */
  readonly w: number;
  readonly h: number;
}

function layer(w: number, h: number, scale: number, paint: (c: CanvasRenderingContext2D) => void): Layer {
  const { canvas, ctx } = makeLayer(w, h, scale);
  if (ctx) paint(ctx);
  return { canvas, w, h };
}

export function freeLayer(l: Layer | null): void {
  if (!l) return;
  l.canvas.width = 0;
  l.canvas.height = 0;
}

/** Pale fingerprint smudge, 26 x 34. */
export function paintFingerprint(): Layer {
  const w = 26;
  const h = 34;
  return layer(w, h, 2, (c) => {
    c.fillStyle = 'rgba(240, 242, 248, 0.6)';
    c.beginPath();
    c.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(170, 176, 190, 0.55)';
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i <= 4; i++) {
      const rx = (w / 2 - 2) * (i / 4.4);
      const ry = (h / 2 - 2) * (i / 4.4);
      c.moveTo(w / 2 + rx, h / 2 + ry * 0.15);
      c.ellipse(w / 2, h / 2 + ry * 0.15, rx, ry, 0, 0, Math.PI * 1.75);
    }
    c.stroke();
  });
}

/** A music note (two beamed eighths) drawn as a path, ink outline. */
export function paintNote(size: number): Layer {
  return layer(size, size, 2, (c) => {
    const s = size;
    c.lineJoin = 'round';
    c.fillStyle = PAL.cob;
    c.strokeStyle = PAL.ink;
    c.lineWidth = Math.max(1.5, s * 0.06);
    // beam
    c.beginPath();
    c.moveTo(s * 0.38, s * 0.12);
    c.lineTo(s * 0.86, s * 0.04);
    c.lineTo(s * 0.86, s * 0.18);
    c.lineTo(s * 0.38, s * 0.26);
    c.closePath();
    c.fill();
    c.stroke();
    // stems
    c.fillRect(s * 0.36, s * 0.16, s * 0.06, s * 0.56);
    c.fillRect(s * 0.82, s * 0.08, s * 0.06, s * 0.56);
    // heads
    for (const [x, y] of [
      [0.28, 0.74],
      [0.74, 0.66],
    ] as const) {
      c.beginPath();
      c.ellipse(s * x, s * y, s * 0.15, s * 0.11, -0.4, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  });
}

/** The counter panel (cobalt, red marquee strip with bulbs on top). */
export function paintCounter(w: number, h: number, scale: number): Layer {
  return layer(w, h, scale, (c) => {
    c.fillStyle = PAL.cobD;
    c.fillRect(0, 0, w, h);
    c.fillStyle = PAL.red;
    c.fillRect(0, 0, w, 10);
    c.fillStyle = PAL.ink;
    c.fillRect(0, 0, w, 2.5);
    c.fillRect(0, 10, w, 2.5);
    const n = Math.max(6, Math.round(w / 26));
    c.lineWidth = 1.3;
    c.strokeStyle = PAL.ink;
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * w;
      c.fillStyle = i % 2 === 0 ? PAL.yel : PAL.white;
      c.beginPath();
      c.arc(x, 6.2, 2.6, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  });
}

/** Rounded bar frame helper (hard ink shadow + white well + ink outline), drawn live (cheap rects). */
export function drawBarWell(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = PAL.ink;
  roundRectPath(g, x + 3, y + 3, w, h, h / 2);
  g.fill();
  g.fillStyle = PAL.white;
  roundRectPath(g, x, y, w, h, h / 2);
  g.fill();
}
