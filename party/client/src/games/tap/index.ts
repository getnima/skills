import type { GameContext, GameInstance, GameModule } from '../types';

// Placeholder: replaced by the real game.
export const game: GameModule = {
  id: 'tap',
  create(ctx: GameContext): GameInstance {
    const el = document.createElement('div');
    el.textContent = 'tap';
    el.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;font:700 48px system-ui;color:#fff';
    ctx.root.appendChild(el);
    let score = 0;
    const onTap = (): void => ctx.setScore(++score);
    ctx.root.addEventListener('pointerdown', onTap);
    return {
      destroy(): void {
        ctx.root.removeEventListener('pointerdown', onTap);
        el.remove();
      },
    };
  },
};
