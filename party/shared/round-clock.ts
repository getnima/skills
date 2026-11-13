import { clockTailMs } from './protocol';

import type { RoundPublic } from './protocol';

export interface RoundTime {
  /** Round time elapsed since `startAt`; negative before the round starts. */
  readonly elapsedMs: number;
  /** Round time left until `endAt`; never negative. */
  readonly leftMs: number;
  /** The round clock stands still (cutscene, or the 3-2-1 after one). */
  readonly frozen: boolean;
  /** Ms until the game continues after a cutscene (the 3-2-1); 0 when not resuming. */
  readonly resumeInMs: number;
}

/**
 * The one way to read a round's clock. `now` is SERVER time
 * (createServerClock().now() on clients, Date.now() on the server).
 *
 * Freeze model: while `frozenAt` is set, time stands still there. On resume
 * the server shifts startAt/endAt forward by the frozen duration and, during
 * `playing`, sets `resumeAt` a few seconds ahead: until then time stands still
 * at `resumeAt`, which maps to exactly the elapsed time at the freeze.
 */
export function roundTime(round: RoundPublic, now: number): RoundTime {
  let t = now;
  let resumeInMs = 0;
  if (round.frozenAt !== null) {
    t = round.frozenAt;
  } else if (round.resumeAt !== null && now < round.resumeAt) {
    t = round.resumeAt;
    resumeInMs = round.resumeAt - now;
  }
  return {
    elapsedMs: t - round.startAt,
    leftMs: Math.max(0, round.endAt - t),
    frozen: t !== now,
    resumeInMs,
  };
}

/** Length of the part of a round its clock counts for people: the round without its hold (GameMeta.holdMs). */
export function shownDurationMs(round: RoundPublic): number {
  const whole = round.endAt - round.startAt;
  return Math.max(0, whole - clockTailMs(round.gameId, whole));
}

/**
 * The time left a clock for people shows (the TV, the remote): it reaches zero when nobody can
 * score any more, which in a game with a hold (GameMeta.holdMs) is before `round.endAt`.
 */
export function shownLeftMs(round: RoundPublic, time: RoundTime): number {
  return Math.max(0, time.leftMs - clockTailMs(round.gameId, round.endAt - round.startAt));
}
