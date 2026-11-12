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

/** Guess throttle of the remote password (per socket and per IP address). */
export interface RemoteThrottleConfig {
  /** This many wrong passwords within `windowMs` lock the key... */
  readonly maxFails: number;
  readonly windowMs: number;
  /** ...for `lockMs`, doubled on every repeat lock, up to `maxLockMs`. */
  readonly lockMs: number;
  readonly maxLockMs: number;
}

export const DEFAULT_REMOTE_THROTTLE: RemoteThrottleConfig = {
  maxFails: 5,
  windowMs: 60_000,
  lockMs: 30_000,
  maxLockMs: 5 * 60_000,
};

/** The owner's choice; a deploy overrides it with PARTY_REMOTE_PASSWORD. Server only: never sent to any client. */
const DEFAULT_REMOTE_PASSWORD = 'kioso3tbh';

export interface ServerConfig {
  readonly port: number;
  /** socket.io CORS origins; null = any origin. */
  readonly origins: readonly string[] | null;
  readonly timing: RoomTiming;
  /** Unlocks the phone remote (/remote). Never logged, never in a state, an ack or an error message. Default: remoteFromEnv({}). */
  readonly remotePassword?: string;
  readonly remoteThrottle?: RemoteThrottleConfig;
}

/**
 * PARTY_REMOTE_PASSWORD (trimmed; empty = the default).
 * PARTY_TEST_REMOTE_LOCK_MS: tests only, a shorter first lock (and max lock) of the guess throttle.
 */
export function remoteFromEnv(env: NodeJS.ProcessEnv): { remotePassword: string; remoteThrottle: RemoteThrottleConfig } {
  const fromEnv = (env.PARTY_REMOTE_PASSWORD ?? '').trim();
  const testLock = positiveInt(env.PARTY_TEST_REMOTE_LOCK_MS);
  return {
    remotePassword: fromEnv.length > 0 ? fromEnv : DEFAULT_REMOTE_PASSWORD,
    remoteThrottle:
      testLock === null ? DEFAULT_REMOTE_THROTTLE : { ...DEFAULT_REMOTE_THROTTLE, lockMs: testLock, maxLockMs: Math.max(testLock, testLock * 4) },
  };
}

export function configFromEnv(env: NodeJS.ProcessEnv): ServerConfig {
  const port = positiveInt(env.PORT) ?? positiveInt(env.PARTY_SERVER_PORT) ?? 8787;
  const origins = (env.CLIENT_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && o !== '*');
  return { port, origins: origins.length > 0 ? origins : null, timing: timingFromEnv(env), ...remoteFromEnv(env) };
}
