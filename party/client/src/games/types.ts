import type { GameId } from '../../../shared/protocol';

/**
 * Contract between the shell (stage) and a mini game.
 *
 * A game is a self-contained module that renders into `ctx.root` and reports a
 * raw score (higher is better). It never talks to the network and never ends
 * the round: the stage owns the clock, the HUD (time left + score) and calls
 * `destroy()` when time is up. The last value passed to `setScore` is final.
 */
export interface GameContext {
  /**
   * Full-viewport element the game owns (position: fixed; inset: 0; no scroll;
   * touch-action: none). The game appends its canvas / DOM here.
   */
  readonly root: HTMLElement;
  /** Identical for every player of the round: derive ALL randomness from it. */
  readonly seed: number;
  readonly durationMs: number;
  /** Remaining round time in ms, synced to the server clock. Never negative. */
  timeLeftMs(): number;
  /**
   * CSS px at the top of `root` covered by the stage HUD (includes the
   * safe-area inset). Keep gameplay and important UI below it.
   */
  readonly hudHeight: number;
  /** CSS px of safe-area inset at the bottom (home indicator). */
  readonly safeBottom: number;
  /** Report the current raw score. Cheap; call as often as it changes. */
  setScore(score: number): void;
  /**
   * Optional: the player cannot improve any more (e.g. solved the word).
   * The stage then shows a "waiting for the others" state.
   */
  finish(): void;
}

export interface GameInstance {
  /** Stop loops, remove listeners, release audio. Must be idempotent. */
  destroy(): void;
}

export interface GameModule {
  readonly id: GameId;
  create(ctx: GameContext): GameInstance | Promise<GameInstance>;
}

/** Stage = HUD + game lifecycle. Implemented in `client/src/play/stage.ts`. */
export interface StageOptions {
  readonly parent: HTMLElement;
  readonly gameId: GameId;
  readonly seed: number;
  readonly durationMs: number;
  /** Server-synced epoch ms. */
  now(): number;
  /** Server epoch ms when the round ends. */
  readonly endAt: number;
  /** Called (already throttled by the stage) whenever the score changed. */
  onScore(score: number): void;
  /**
   * The game called `ctx.finish()` before time was up (nothing left to gain).
   * The shell may send the final score early; `onEnd` still fires at time-up.
   */
  onFinish?(score: number): void;
  /** Called exactly once, when time is up, with the final score. */
  onEnd(finalScore: number): void;
}

export interface Stage {
  getScore(): number;
  /** Tear down without calling `onEnd` (e.g. the host aborted the round). */
  destroy(): void;
}
