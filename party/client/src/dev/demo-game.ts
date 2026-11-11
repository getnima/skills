/**
 * "Catch" - the reference mini game of the kit (the same code as the example in
 * kit/README.md). Faces fall, tap them for points, never tap the bomb.
 * Run it at /dev.html?game=demo.
 */
import { bombPainter, facePainter, loadAssets } from '../kit/assets';
import { sfx } from '../kit/audio';
import { createGameCanvas } from '../kit/canvas';
import { createFx, lerp } from '../kit/fx';
import { haptic } from '../kit/haptics';
import { createInput } from '../kit/input';
import { createLoop } from '../kit/loop';
import { createRng } from '../kit/rng';
import { COLORS } from '../kit/theme';

import type { GameContext, GameInstance, GameModule } from '../games/types';

interface Thing {
  x: number;
  y: number;
  prevY: number;
  vy: number;
  bomb: boolean;
}

export const game: GameModule = {
  id: 'tap',
  async create(ctx: GameContext): Promise<GameInstance> {
    const view = createGameCanvas(ctx.root);
    const input = createInput(view.canvas);
    const fx = createFx();
    const rng = createRng(ctx.seed).fork('spawn');
    // Real art: client/public/assets/demo/face.png etc. Missing = placeholder.
    const art = await loadAssets('demo', [
      { key: 'face', file: 'face.png', size: 76, placeholder: facePainter('happy') },
      { key: 'bomb', file: 'bomb.png', size: 76, placeholder: bombPainter },
    ]);
    const things: Thing[] = [];
    let score = 0;

    const loop = createLoop({
      update(dt: number): void {
        for (let i = things.length - 1; i >= 0; i--) {
          const t = things[i];
          if (!t) continue;
          t.prevY = t.y;
          t.y += t.vy * dt;
          if (t.y > view.height + 60) things.splice(i, 1);
        }
        fx.update(dt);
      },
      render(alpha: number): void {
        const g = view.ctx;
        view.clear();
        g.save();
        fx.applyShake(g);
        for (const t of things) (t.bomb ? art.bomb : art.face).draw(g, t.x, lerp(t.prevY, t.y, alpha));
        g.restore();
        fx.draw(g);
      },
    });

    // Game-time timer: stands still during a freeze, unlike setInterval.
    loop.every(420, () => {
      const y = ctx.hudHeight - 40;
      things.push({ x: rng.float(50, view.width - 50), y, prevY: y, vy: rng.float(160, 320), bomb: rng.chance(0.2) });
    });

    input.onDown((p) => {
      for (let i = things.length - 1; i >= 0; i--) {
        const t = things[i];
        if (!t || Math.hypot(t.x - p.x, t.y - p.y) > 48) continue;
        things.splice(i, 1);
        if (t.bomb) {
          score = Math.max(0, score - 5);
          fx.shake(14, 400);
          fx.burst(t.x, t.y, { count: 24, colors: [COLORS.orange, COLORS.yellow, '#444'], speed: 420 });
          fx.text(t.x, t.y, '-5', { color: COLORS.red });
          sfx.explode();
          haptic.heavy();
        } else {
          score += 1;
          fx.burst(t.x, t.y, { shape: 'star' });
          fx.text(t.x, t.y, '+1', { color: COLORS.yellow });
          sfx.pop(1 + (score % 8) * 0.05);
          haptic.tap();
        }
        ctx.setScore(score);
        return;
      }
    });

    loop.start();
    return {
      destroy(): void {
        loop.stop();
        input.dispose();
        view.dispose();
      },
    };
  },
};
