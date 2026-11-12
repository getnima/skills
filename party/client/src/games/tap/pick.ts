/**
 * The rules of "שימי טאפ" as a pure state machine: the pick meter, the phases, the digs,
 * the BIG boogers and the score. No DOM, no clock, no Math.random: the game feeds it
 * taps stamped with their round time and calls step() once per fixed 60 Hz step, so the
 * same taps give the same score on every phone and at every frame rate (unit-tested in
 * tests/unit/tap-pick.test.ts).
 *
 * The meter is a running tap rate: every counted tap adds 1/TAU, and it decays with time
 * constant TAU, so it settles at the player's taps per second (x1.5 in the frenzy).
 * meter = rate / RATE_FULL. Full meter = the finger goes INTO the nostril (picking): from
 * then every counted tap is a dig worth DIG_POINTS and throws a booger. The finger stays in
 * while the rate is at least RATE_HOLD; below it the finger comes out and the hand sinks
 * to EXIT_SINK of the meter, so the player has to spam it back up.
 */
import { BOOGER, boogerOf } from './schedule';

import type { BoogerKind, TapLevel } from './schedule';

export const PICK = {
  STEP_MS: 1000 / 60,
  /** Time constant of the tap rate (s). */
  TAU_S: 0.85,
  /** Taps per second that fill the meter (the finger goes in). */
  RATE_FULL: 5.0,
  /** While picking: below this rate the finger comes out. */
  RATE_HOLD: 4.1,
  /** After the finger came out the meter drops to this share (the hand sinks). */
  EXIT_SINK: 0.55,
  /** Every tap counts this much more for the meter in the frenzy. */
  FRENZY_FILL: 1.5,
  /** Counted taps per second (all fingers together), the bucket size and the minimum gap. */
  HIT_RATE: 12,
  HIT_BURST: 2,
  MIN_GAP_MS: 45,
  /** Combo: x2 at 20, x3 at 40 counted taps in a row; a gap longer than this breaks it. */
  COMBO_STEP: 20,
  MAX_MULT: 3,
  COMBO_GAP_MS: 750,
  /** Points. A tap while the hand rises = the combo multiplier (1..3). */
  DIG_POINTS: 5,
  GOLDEN_BONUS: 5,
  BIG_BONUS: 25,
  MISS_COST: 1,
  /** The BIG booger moment (stretch + pop), game time. The finger stays in during it. */
  BIG_MS: 900,
  /** Below this meter the hand rests and the phase reads 'idle'. */
  IDLE_BELOW: 0.12,
} as const;

export type PickPhase = 'idle' | 'rising' | 'picking';

/** What happened, for the game's visuals and sounds. Called synchronously from step(). */
export interface PickListener {
  /** A counted tap while the hand rises (points = combo multiplier). */
  hit?(points: number, mult: number): void;
  /** A counted tap while picking: dig #index threw booger `kind`. */
  dig?(index: number, kind: BoogerKind, points: number): void;
  /** A tap off the face (points lost, maybe 0). */
  miss?(cost: number, comboLost: number): void;
  /** A tap on the face over the rate cap (no points). */
  bounce?(): void;
  /** The meter filled: the finger goes in. */
  enter?(): void;
  /** The player slowed down: the finger comes out. */
  exit?(): void;
  /** The BIG booger starts coming out (bonus points already counted). */
  bigStart?(index: number, bonus: number): void;
  /** The BIG booger popped out (end of the moment). */
  bigPop?(index: number): void;
  /** The combo multiplier went up. */
  mult?(mult: number): void;
  /** The combo was broken by a slow-down (combo >= 5 only). */
  comboBreak?(combo: number): void;
  /** The frenzy started. */
  frenzy?(): void;
}

export interface PickState {
  readonly elapsedMs: number;
  readonly rate: number;
  readonly meter: number;
  readonly phase: PickPhase;
  readonly picking: boolean;
  readonly frenzy: boolean;
  readonly score: number;
  readonly combo: number;
  readonly mult: number;
  readonly hits: number;
  readonly misses: number;
  readonly bounces: number;
  readonly digs: number;
  readonly bigBoogers: number;
  /** Times the finger went in. */
  readonly picks: number;
  /** Game time spent picking, ms. */
  readonly pickingMs: number;
  /** ms left of the BIG booger moment (0 = none). */
  readonly bigLeftMs: number;
  /** Round time of the last counted tap (-1 = none). */
  readonly lastTapMs: number;
}

export interface PickEngine {
  readonly state: PickState;
  /** Queue a touch at round time `t` (ms). `onFace` = it landed on the doll. */
  tap(t: number, onFace: boolean): void;
  /**
   * One fixed step at round time `elapsedMs`: decay, then every queued tap with t <= elapsedMs
   * (all of them when `flush`, used when the game clock lags the round clock).
   */
  step(elapsedMs: number, flush?: boolean): void;
  /** Taps waiting for their step. */
  readonly queued: number;
}

const DT = 1 / 60;

export function createPickEngine(level: TapLevel, maxRaw: number, on: PickListener = {}): PickEngine {
  const decay = Math.exp(-DT / PICK.TAU_S);
  const queue: Array<{ t: number; face: boolean }> = [];

  const st = {
    elapsedMs: 0,
    rate: 0,
    meter: 0,
    phase: 'idle' as PickPhase,
    picking: false,
    frenzy: false,
    score: 0,
    combo: 0,
    mult: 1,
    hits: 0,
    misses: 0,
    bounces: 0,
    digs: 0,
    bigBoogers: 0,
    picks: 0,
    pickingMs: 0,
    bigLeftMs: 0,
    lastTapMs: -1,
  };
  let tokens: number = PICK.HIT_BURST;
  let bigIdx = 0;

  function addScore(n: number): void {
    st.score = Math.max(0, Math.min(maxRaw, st.score + n));
  }

  function refreshMeter(): void {
    st.meter = Math.min(1, st.rate / PICK.RATE_FULL);
    st.phase = st.picking ? 'picking' : st.meter >= PICK.IDLE_BELOW ? 'rising' : 'idle';
  }

  function counted(t: number): void {
    tokens -= 1;
    st.hits++;
    st.combo++;
    st.lastTapMs = t;
    const mult = Math.min(PICK.MAX_MULT, 1 + Math.floor(st.combo / PICK.COMBO_STEP));
    if (mult > st.mult) {
      st.mult = mult;
      on.mult?.(mult);
    }
    st.mult = mult;
    st.rate += (st.frenzy ? PICK.FRENZY_FILL : 1) / PICK.TAU_S;

    if (st.picking) {
      const index = st.digs;
      st.digs++;
      const kind = boogerOf(level, index);
      const pts = PICK.DIG_POINTS + (kind === BOOGER.Golden ? PICK.GOLDEN_BONUS : 0);
      addScore(pts);
      on.dig?.(index, kind, pts);
      const next = level.bigAt[bigIdx];
      if (next !== undefined && st.digs >= next && st.bigLeftMs <= 0) {
        bigIdx++;
        st.bigBoogers++;
        st.bigLeftMs = PICK.BIG_MS;
        addScore(PICK.BIG_BONUS);
        on.bigStart?.(st.bigBoogers - 1, PICK.BIG_BONUS);
      }
      refreshMeter();
      return;
    }

    addScore(mult);
    on.hit?.(mult, mult);
    if (st.rate >= PICK.RATE_FULL) {
      st.picking = true;
      st.picks++;
      on.enter?.();
    }
    refreshMeter();
  }

  function process(t: number, face: boolean): void {
    if (!face) {
      st.misses++;
      const lost = st.combo;
      const before = st.score;
      if (st.score > 0) addScore(-PICK.MISS_COST);
      st.combo = 0;
      st.mult = 1;
      on.miss?.(before - st.score, lost);
      return;
    }
    if (tokens < 1 || (st.lastTapMs >= 0 && t - st.lastTapMs < PICK.MIN_GAP_MS)) {
      st.bounces++;
      on.bounce?.();
      return;
    }
    counted(t);
  }

  return {
    get state(): PickState {
      return st;
    },
    get queued(): number {
      return queue.length;
    },
    tap(t: number, onFace: boolean): void {
      // keep the queue in time order (touches can arrive a hair out of order)
      let i = queue.length;
      while (i > 0 && (queue[i - 1]?.t ?? 0) > t) i--;
      queue.splice(i, 0, { t, face: onFace });
    },
    step(elapsedMs: number, flush = false): void {
      st.elapsedMs = elapsedMs;
      if (!st.frenzy && elapsedMs >= level.frenzyFrom) {
        st.frenzy = true;
        on.frenzy?.();
      }
      st.rate *= decay;
      tokens = Math.min(PICK.HIT_BURST, tokens + PICK.HIT_RATE * DT);

      let n = 0;
      while (n < queue.length) {
        const q = queue[n];
        if (!q || (!flush && q.t > elapsedMs)) break;
        n++;
        process(q.t, q.face);
      }
      if (n > 0) queue.splice(0, n);

      if (st.bigLeftMs > 0) {
        st.bigLeftMs = Math.max(0, st.bigLeftMs - PICK.STEP_MS);
        if (st.bigLeftMs <= 0) on.bigPop?.(st.bigBoogers - 1);
      }
      if (st.picking) {
        st.pickingMs += PICK.STEP_MS;
        if (st.bigLeftMs <= 0 && st.rate < PICK.RATE_HOLD) {
          st.picking = false;
          st.rate = Math.min(st.rate, PICK.RATE_FULL * PICK.EXIT_SINK);
          on.exit?.();
        }
      }
      if (st.combo > 0 && st.lastTapMs >= 0 && elapsedMs - st.lastTapMs > PICK.COMBO_GAP_MS) {
        if (st.combo >= 5) on.comboBreak?.(st.combo);
        st.combo = 0;
        st.mult = 1;
      }
      refreshMeter();
    },
  };
}
