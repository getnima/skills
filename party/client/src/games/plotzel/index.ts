/**
 * Plotzel (פלוצל) slot. One switch (config.ts) picks the implementation:
 * 'embed' = the owner's live site in an iframe (default), 'builtin' = ours.
 */
import { createBuiltin } from './builtin';
import { resolvePlotzelConfig } from './config';
import { createEmbed } from './embed';

import type { GameContext, GameInstance, GameModule } from '../types';

export const game: GameModule = {
  id: 'plotzel',
  create(ctx: GameContext): Promise<GameInstance> {
    const cfg = resolvePlotzelConfig();
    return cfg.mode === 'builtin' ? createBuiltin(ctx) : createEmbed(ctx, cfg);
  },
};
