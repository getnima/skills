import type { GameId } from '../../../shared/protocol';

/**
 * Contract between the shell (stage) and a mini game.
 *
 * A game is a self-contained module that renders into `ctx.root` and reports a
 * raw score (higher is better). It never talks to the network and never ends
 * the round: the stage owns the clock, the HUD (time left + score) and calls
 * `destroy()` when time is up. The last value passed to `setScore` is final.
 */
/** One participant of an elimination round, as the game's spectator view shows it. */
export interface FieldPlayer {
  readonly id: string;
  readonly name: string;
  /** PlayerPublic.avatar. */
  readonly avatar: number;
  /** Already out (the server has its final). */
  readonly out: boolean;
  readonly me: boolean;
}

/** Who is still in, in an elimination round (from the server's `scores` broadcast). */
export interface RoundField {
  /** Every participant in the strict live order (best first): place = index + 1. */
  readonly players: readonly FieldPlayer[];
  /**
   * This phone is already out of this round, with this final raw score (it crashed before a
   * reload, or the server counted it out): the game must start as a spectator. Null otherwise.
   */
  readonly outRaw: number | null;
}

export interface GameContext {
  /**
   * Full-viewport element the game owns (position: fixed; inset: 0; no scroll;
   * touch-action: none). The game appends its canvas / DOM here.
   */
  readonly root: HTMLElement;
  /** Identical for every player of the round: derive ALL randomness from it. */
  readonly seed: number;
  readonly durationMs: number;
  /**
   * Remaining round time in ms, synced to the server clock. Never negative.
   * Stands still while the round is frozen (a cutscene is playing on the TV).
   */
  timeLeftMs(): number;
  /** True while the round is frozen. */
  isPaused(): boolean;
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
  /**
   * Optional: the game shows its own clock (e.g. a personal sprint inside the round). The HUD
   * displays `leftMs` (bar = leftMs / totalMs, totalMs defaults to the round length) instead
   * of the round clock, without the stage's urgent ticks (the game plays its own countdown);
   * null restores the round clock. The round still ends at the round clock. Cheap: call every step.
   */
  setClock?(leftMs: number | null, totalMs?: number): void;
  /**
   * Elimination rounds: participants still playing (this one included while it is in), or
   * null when unknown (no message yet, the dev harness). Missing outside elimination rounds.
   */
  activePlayers?(): number | null;
  /**
   * Elimination rounds: ms of ROUND time until the finale begins; 0 or negative once it has
   * begun; null when no finale is set (yet). Stands still while the round is frozen.
   */
  finaleInMs?(): number | null;
  /** Elimination rounds: the field for the "out" view (names of who is still in), or null when unknown. */
  field?(): RoundField | null;
}

export interface GameInstance {
  /** Stop loops, remove listeners, release audio. Must be idempotent. */
  destroy(): void;
  /**
   * The round froze (cutscene) / continues. The stage already freezes every
   * kit loop, tween and input through `setKitPaused`, so a game whose time
   * comes only from the kit loop needs nothing here. Implement it for what the
   * kit does not own: setTimeout chains, CSS animations, audio loops.
   */
  setPaused?(paused: boolean): void;
}

export interface GameModule {
  readonly id: GameId;
  create(ctx: GameContext): GameInstance | Promise<GameInstance>;
}

export interface RoundClockSample {
  /** Remaining round time in ms (never negative). */
  readonly leftMs: number;
  /** The round is frozen: pause the game, keep everything as it is. */
  readonly frozen: boolean;
}

/** Stage = HUD + game lifecycle. Implemented in `client/src/play/stage.ts`. */
export interface StageOptions {
  readonly parent: HTMLElement;
  readonly gameId: GameId;
  readonly seed: number;
  readonly durationMs: number;
  /**
   * Round clock, polled by the stage every frame. The shell derives it from
   * `roundTime()` (shared/round-clock.ts) and the server clock.
   */
  clock(): RoundClockSample;
  /** Called (already throttled by the stage) whenever the score changed. */
  onScore(score: number): void;
  /**
   * The game called `ctx.finish()` before time was up (nothing left to gain).
   * The shell may send the final score early; `onEnd` still fires at time-up.
   */
  onFinish?(score: number): void;
  /** Called exactly once, when `leftMs` reaches 0 while not frozen, with the final score. */
  onEnd(finalScore: number): void;
  /** Elimination rounds: where the stage gets GameContext.activePlayers / finaleInMs / field from. */
  readonly elimination?: {
    activePlayers(): number | null;
    finaleInMs(): number | null;
    field(): RoundField | null;
  };
}

export interface Stage {
  getScore(): number;
  /** Tear down without calling `onEnd` (e.g. the host aborted the round). */
  destroy(): void;
}
