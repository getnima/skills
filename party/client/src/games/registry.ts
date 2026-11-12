import type { GameId } from '../../../shared/protocol';
import type { GameModule } from './types';

/** Lazy per-game chunks: a phone only downloads the game it is about to play. */
const loaders: Record<GameId, () => Promise<{ game: GameModule }>> = {
  tap: () => import('./tap/index'),
  icy: () => import('./icy/index'),
  flappy: () => import('./flappy/index'),
  plotzel: () => import('./plotzel/index'),
  ninja: () => import('./ninja/index'),
};

export async function loadGame(id: GameId): Promise<GameModule> {
  const mod = await loaders[id]();
  return mod.game;
}

/**
 * Warm the chunk during intro/countdown so the round starts instantly. Resolves with whether the
 * chunk is in (never rejects): the phone asks for the game's art only after it, so the pictures
 * do not share a slow link with the code.
 */
export function preloadGame(id: GameId): Promise<boolean> {
  return loaders[id]().then(
    () => true,
    () => false,
  );
}
