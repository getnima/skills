/**
 * Plotzel art slots. Drop real files into client/public/assets/plotzel/ with
 * these names (see the README there); missing files use the placeholders.
 */
import { facePainter, loadAssets, shade } from '../../kit/assets';

import type { Drawable, Painter } from '../../kit/assets';

const CLOUD_GREEN = '#7fe08a';

/** A fluffy green stink cloud with two little wiggle lines. */
export const cloudPainter: Painter = (ctx, w, h) => {
  const puffs: ReadonlyArray<readonly [number, number, number]> = [
    [0.3, 0.6, 0.22],
    [0.5, 0.45, 0.27],
    [0.7, 0.58, 0.21],
    [0.42, 0.68, 0.2],
    [0.6, 0.7, 0.19],
  ];
  const draw = (fill: string, grow: number, dy: number): void => {
    ctx.fillStyle = fill;
    for (const [x, y, r] of puffs) {
      ctx.beginPath();
      ctx.arc(x * w, y * h + dy, r * w + grow, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  draw(shade(CLOUD_GREEN, -0.45), 3, 2); // outline / shadow
  draw(CLOUD_GREEN, 0, 0);
  draw(shade(CLOUD_GREEN, 0.35), -0.09 * w, -0.05 * h); // highlight
  ctx.strokeStyle = shade(CLOUD_GREEN, -0.4);
  ctx.lineWidth = Math.max(2, w * 0.035);
  ctx.lineCap = 'round';
  for (const x of [0.4, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(x * w, 0.2 * h);
    ctx.bezierCurveTo((x - 0.06) * w, 0.14 * h, (x + 0.06) * w, 0.08 * h, x * w, 0.02 * h);
    ctx.stroke();
  }
};

export interface PlotzelArt {
  readonly cloud: Drawable;
  readonly mascot: Drawable;
  readonly mascotHappy: Drawable;
  readonly mascotOops: Drawable;
}

export async function loadPlotzelArt(): Promise<PlotzelArt> {
  const a = await loadAssets('plotzel', [
    { key: 'cloud', file: 'cloud.png', size: 96, placeholder: cloudPainter },
    { key: 'mascot', file: 'mascot.png', size: 64, round: true, placeholder: facePainter('wink', '#7fe08a') },
    { key: 'mascotHappy', file: 'mascot-happy.png', size: 64, round: true, placeholder: facePainter('laughing', '#7fe08a') },
    { key: 'mascotOops', file: 'mascot-oops.png', size: 64, round: true, placeholder: facePainter('shocked', '#7fe08a') },
  ]);
  return { cloud: a.cloud, mascot: a.mascot, mascotHappy: a.mascotHappy, mascotOops: a.mascotOops };
}
