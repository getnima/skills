import { COUNTDOWN_MS, GAMES, INTRO_MS } from '../shared/protocol';

import type { GameId } from '../shared/protocol';

/** Lengths of the server-driven phases. Clients never need these: they follow the round fields. */
export interface RoomTiming {
  readonly introMs: number;
  readonly countdownMs: number;
  durationMs(gameId: GameId): number;
}

export const DEFAULT_TIMING: RoomTiming = {
  introMs: INTRO_MS,
  countdownMs: COUNTDOWN_MS,
  durationMs: (gameId: GameId): number => GAMES[gameId].durationMs,
};

function positiveInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * PARTY_TEST_FAST=1: intro 1500ms, countdown 1500ms, every game 12s.
 * PARTY_TEST_DURATION_MS overrides the game length (with or without FAST).
 */
export function timingFromEnv(env: NodeJS.ProcessEnv): RoomTiming {
  const fast = env.PARTY_TEST_FAST === '1' || env.PARTY_TEST_FAST === 'true';
  const duration = positiveInt(env.PARTY_TEST_DURATION_MS) ?? (fast ? 12_000 : null);
  return {
    introMs: fast ? 1_500 : INTRO_MS,
    countdownMs: fast ? 1_500 : COUNTDOWN_MS,
    durationMs: (gameId: GameId): number => duration ?? GAMES[gameId].durationMs,
  };
}

export interface ServerConfig {
  readonly port: number;
  /** socket.io CORS origins; null = any origin. */
  readonly origins: readonly string[] | null;
  readonly timing: RoomTiming;
}

export function configFromEnv(env: NodeJS.ProcessEnv): ServerConfig {
  const port = positiveInt(env.PORT) ?? positiveInt(env.PARTY_SERVER_PORT) ?? 8787;
  const origins = (env.CLIENT_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && o !== '*');
  return { port, origins: origins.length > 0 ? origins : null, timing: timingFromEnv(env) };
}
