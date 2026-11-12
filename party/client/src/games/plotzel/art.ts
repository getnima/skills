/**
 * Plotzel art slots (group "plotzel"). Drop real files into
 * client/public/assets/plotzel/ with these names (README there); a missing file
 * uses the procedural placeholder below. Placeholders are generic cartoons.
 */
import { facePainter, loadAssets, shade } from '../../kit/assets';

import type { Drawable, Painter } from '../../kit/assets';

/** The 💨 of the original: a puff of air with speed lines (flies off on every solve). */
export const puffPainter: Painter = (ctx, w, h) => {
  const blobs: ReadonlyArray<readonly [number, number, number]> = [
    [0.62, 0.52, 0.2],
    [0.78, 0.42, 0.15],
    [0.8, 0.62, 0.14],
    [0.5, 0.4, 0.14],
    [0.48, 0.64, 0.13],
    [0.35, 0.52, 0.12],
  ];
  const paint = (fill: string, grow: number, dy: number): void => {
    ctx.fillStyle = fill;
    for (const [x, y, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x * w, y * h + dy, r * w + grow, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const base = '#e9f3ff';
  paint(shade(base, -0.45), Math.max(2, w * 0.03), w * 0.02); // outline + shadow
  paint(base, 0, 0);
  paint('#ffffff', -w * 0.07, -h * 0.05); // highlight
  // speed lines behind the puff (it flies to the left)
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(3, w * 0.05);
  for (const [y, x0, x1] of [
    [0.36, 0.86, 0.98],
    [0.52, 0.93, 0.99],
    [0.68, 0.88, 0.97],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x0 * w, y * h);
    ctx.lineTo(x1 * w, y * h);
    ctx.stroke();
  }
};

/** Soft party backdrop: only used when no real file exists (see index.ts). */
const backgroundPainter: Painter = (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2a1263');
  g.addColorStop(1, '#150a33');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};

export interface PlotzelArt {
  /** Optional full-screen backdrop (cover). Placeholder = the party gradient in CSS. */
  readonly background: Drawable;
  /** Replaces the 💨 that flies off on a solve. */
  readonly puff: Drawable;
  /** The face that pops up on a solve: plotzel/mascot.png, else /assets/shimi/head.png. */
  readonly mascot: Drawable;
}

export async function loadPlotzelArt(): Promise<PlotzelArt> {
  const a = await loadAssets('plotzel', [
    { key: 'background', file: 'background.jpg', size: 195, height: 422, fit: 'cover', placeholder: backgroundPainter },
    { key: 'puff', file: 'puff.png', size: 120, placeholder: puffPainter },
    { key: 'mascot', file: 'mascot.png', size: 96, round: true, placeholder: facePainter('laughing', '#7fe08a') },
  ]);
  // no plotzel/mascot.png: Shimi's head from the party's own pictures, else the cartoon placeholder
  let mascot = a.mascot;
  if (mascot.isPlaceholder) {
    const shimi = await loadAssets('shimi', [{ key: 'head', file: 'head.png', size: 96, placeholder: facePainter('laughing', '#7fe08a') }]);
    mascot = shimi.head;
  }
  return { background: a.background, puff: a.puff, mascot };
}
