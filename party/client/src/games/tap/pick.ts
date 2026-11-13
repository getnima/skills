/**
 * The rules of "שימי טאפ" as a pure state machine. No DOM, no clock, no Math.random: the
 * game feeds it touches stamped with their round time and calls step() once per fixed
 * 60 Hz step, so the same touches give the same score and the same events on every phone
 * and at every frame rate (unit-tested in tests/unit/tap-pick.test.ts).
 *
 * The party's round (TAP, a SHARED sprint): the sprint is the first 20/23 of the round (20 s of
 * 23 s) for everyone, so the clock on the TV is the clock of every phone and the game is over
 * for all of them at the same moment (the owner, 13.11: "the tv says 10s remaining but is
 * over"). Phase 'waiting' lasts until the player's first touch (counted tap #1); whoever has
 * not touched by 8/23 of the round (8 s) is started by the doll itself. Starting late only
 * costs the time that already ran. The last 3/23 (3 s) is a hold: every phone shows its final
 * frame, and then the round ends.
 *
 * The other format (a shape without SHARED; the engine's older tests run it): a personal sprint.
 * The first touch inside the start window starts a sprint of the full length, with no touch it
 * starts by itself when the window runs out, and the rest of the round is the hold.
 *
 * In both, phase 'done' means the score (= counted taps, nothing else) is final.
 *
 * Anti-mash cap: a token bucket (RATE per second, BURST deep) and a minimum gap between
 * counted taps. Touches over the cap "bounce": they count for nothing.
 *
 * The hand level (0..5) is cosmetic: it follows the smoothed tap rate with hysteresis and
 * never touches the score. It lives here because it must be the same on every phone too.
 */

export const TAP = {
  STEP_MS: 1000 / 60,
  /**
   * Shares of ctx.durationMs. The party's round is 23 s: the sprint is its first 20 s, for
   * everyone; a player who has not touched by 8 s is started by the doll; the last 3 s are the
   * hold (the final frame). It was 8 s to start + a personal 20 s + 2 s of hold (30 s): whoever
   * started at once was finished while the TV still showed 10 seconds.
   */
  START_SHARE: 8 / 23,
  SPRINT_SHARE: 20 / 23,
  /** One sprint for everyone, from the round's start (see the header). */
  SHARED: true,
  /** The production sprint the tap thresholds are written for. */
  BASE_SPRINT_MS: 20_000,
  /** Counted taps per second (all fingers together), bucket depth and the minimum gap. */
  RATE: 12,
  BURST: 3,
  MIN_GAP_MS: 25,
  /** Time constant of the tap rate (s): every counted tap adds 1/TAU. */
  TAU_S: 0.6,
  /** The displayed rate is the rate low-passed over this (s). */
  SMOOTH_S: 0.25,
  /** Smoothed rate at which the hand reaches level 1..5 (taps per second). */
  LEVEL_UP: [0.8, 1.8, 2.8, 5, 8],
  /** A level is left downwards only below its threshold minus this. */
  LEVEL_HYST: 0.6,
  /** Minimum ms in a level before going down; once the finger is in (level >= 3), at least this long in. */
  LEVEL_MIN_MS: 300,
  FINGER_IN_MIN_MS: 700,
  /** The last quarter of the sprint ("last 5 seconds"): the finger is locked in at least at this level. */
  LAST_SHARE: 0.25,
  LAST_MIN_LEVEL: 3,
  /** Milestone beats at these counted taps (for a 20 s sprint; scaled by tapScale). */
  // (every set piece starts before the last 5 s for the player it is for: slow 3/s reaches
  // mini Shimi, normal 6/s the king, fast 11/s the cork)
  MILESTONES: [8, 18, 28, 40, 54, 68, 84, 120, 150],
  /** Final rank tiers: under 70 / 70-129 / 130-189 / 190+ (scaled the same way). */
  RANKS: [70, 130, 190],
} as const;

export type TapPhase = 'waiting' | 'sprint' | 'done';

export const MILESTONE_IDS = ['yossi', 'rope', 'ear', 'mini', 'sneeze', 'squeegee', 'king', 'spin', 'cork'] as const;
export type MilestoneId = (typeof MILESTONE_IDS)[number];

export interface TapTiming {
  readonly durationMs: number;
  /** Until here a touch starts the player; then the sprint starts by itself. */
  readonly startWindowMs: number;
  readonly sprintMs: number;
  /** One sprint for everyone: it runs from the round's start to `sprintMs`, whenever a player starts. */
  readonly shared: boolean;
  /** sprintMs / 20 000: tap thresholds are multiplied by it, so short test rounds reach them. */
  readonly tapScale: number;
}

/** How a round is split (shares of its length). Production: TAP; the engine's tests also run another split. */
export interface TapShape {
  readonly START_SHARE: number;
  readonly SPRINT_SHARE: number;
  /** True: the sprint is the first SPRINT_SHARE of the round for everyone. Default: a personal sprint. */
  readonly SHARED?: boolean;
}

export function tapTiming(durationMs: number, shape: TapShape = TAP): TapTiming {
  const dur = Math.max(1000, durationMs);
  const startWindowMs = Math.round(dur * shape.START_SHARE);
  const sprintMs = Math.round(dur * shape.SPRINT_SHARE);
  return { durationMs: dur, startWindowMs, sprintMs, shared: shape.SHARED === true, tapScale: sprintMs / TAP.BASE_SPRINT_MS };
}

/** Scaled thresholds, kept strictly increasing and at least 1 (so every milestone exists). */
export function scaledThresholds(base: readonly number[], tapScale: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const b of base) {
    const v = Math.max(prev + 1, Math.round(b * tapScale));
    out.push(v);
    prev = v;
  }
  return out;
}

/** Final rank 0..3 of a tap count (חוטט מתלמד / מוסמך / דוקטור / האף של המדינה). */
export function rankOf(taps: number, tapScale: number): number {
  const tiers = scaledThresholds(TAP.RANKS, tapScale);
  let r = 0;
  for (const t of tiers) if (taps >= t) r++;
  return r;
}

/** What happened, for the game's visuals and sounds. Called synchronously from step(). */
export interface TapListener {
  /** The sprint started: by the first touch (auto = false, that touch is tap #1) or by itself. */
  start?(auto: boolean, t0: number): void;
  /** A counted tap: `taps` is the new count. */
  tap?(taps: number, t: number): void;
  /** A touch over the cap (nothing counted). */
  bounce?(t: number): void;
  /** A touch after the sprint (counts for nothing). */
  late?(t: number): void;
  /** Counted taps reached milestone #index. */
  milestone?(id: MilestoneId, index: number, taps: number): void;
  /** The hand level changed. */
  level?(from: number, to: number): void;
  /** The last quarter of the sprint began. */
  last?(): void;
  /** The sprint is over: `taps` is final. Fires exactly once. */
  done?(taps: number): void;
}

export interface TapState {
  readonly elapsedMs: number;
  readonly phase: TapPhase;
  /** Round time the sprint started at (-1 while waiting). */
  readonly t0: number;
  /** Round time the sprint ends at (-1 while waiting). */
  readonly endAt: number;
  readonly auto: boolean;
  readonly taps: number;
  readonly bounces: number;
  readonly late: number;
  /** Raw tap rate (taps/s, exponential with TAU). */
  readonly rate: number;
  /** The rate low-passed for display. */
  readonly rateSm: number;
  /** Hand level 0..5. */
  readonly level: number;
  /** The last quarter of the sprint has begun. */
  readonly lastQuarter: boolean;
  /** Round time of the last counted tap (-1 = none). */
  readonly lastTapMs: number;
  /** Milestones reached so far. */
  readonly milestones: number;
}

export interface TapEngine {
  readonly state: TapState;
  readonly timing: TapTiming;
  /** Tap thresholds of the milestones (scaled). */
  readonly milestoneAt: readonly number[];
  /** Queue `n` touches (fingers) at round time `t` (ms). */
  tap(t: number, n?: number): void;
  /**
   * One fixed step at round time `elapsedMs`: every queued touch with t <= elapsedMs (all of
   * them when `flush`, used when the game clock lags the round clock), then the clock.
   */
  step(elapsedMs: number, flush?: boolean): void;
  /** Touches waiting for their step. */
  readonly queued: number;
  /**
   * Continue a sprint this phone already played (the page was reloaded): the sprint keeps
   * its start `t0` and its `taps`, so it still ends where it would have; `done` = it was over.
   * Fires no events. Only while still 'waiting' (before the first step that starts anything).
   */
  resume(t0: number, taps: number, done: boolean): void;
}

const DT = 1 / 60;

/**
 * `joinedAtMs` = round time when this phone started the game: a phone that joins after the
 * start window starts its sprint at once (and it is cut at the end of the round; in the shared
 * format at the end of the sprint, like everyone's).
 */
export function createTapEngine(durationMs: number, on: TapListener = {}, joinedAtMs = 0, shape: TapShape = TAP): TapEngine {
  const timing = tapTiming(durationMs, shape);
  const milestoneAt = scaledThresholds(TAP.MILESTONES, timing.tapScale);
  const decay = Math.exp(-DT / TAP.TAU_S);
  const smooth = 1 - Math.exp(-DT / TAP.SMOOTH_S);
  const queue: number[] = [];
  const st = {
    elapsedMs: 0,
    phase: 'waiting' as TapPhase,
    t0: -1,
    endAt: -1,
    auto: false,
    taps: 0,
    bounces: 0,
    late: 0,
    rate: 0,
    rateSm: 0,
    level: 0,
    lastQuarter: false,
    lastTapMs: -1,
    milestones: 0,
  };
  let tokens: number = TAP.BURST;
  let levelMs = 0;
  let inMs = 0;

  /** Where a sprint that started at `t0` ends: the shared sprint ends for everyone at the same round time. */
  const endOf = (t0: number): number => Math.min(timing.durationMs, timing.shared ? timing.sprintMs : t0 + timing.sprintMs);
  /** Round time the last quarter ("the last 5 seconds") of the running sprint begins at. */
  const lastFrom = (): number => (timing.shared ? st.endAt : st.t0 + timing.sprintMs) - timing.sprintMs * TAP.LAST_SHARE;

  function startSprint(t0: number, auto: boolean): void {
    st.phase = 'sprint';
    st.t0 = t0;
    st.endAt = endOf(t0);
    st.auto = auto;
    on.start?.(auto, t0);
  }

  function counted(t: number): void {
    tokens -= 1;
    st.taps++;
    st.lastTapMs = t;
    st.rate += 1 / TAP.TAU_S;
    on.tap?.(st.taps, t);
    while (st.milestones < milestoneAt.length && st.taps >= (milestoneAt[st.milestones] ?? Infinity)) {
      const i = st.milestones;
      st.milestones++;
      on.milestone?.(MILESTONE_IDS[i] ?? 'cork', i, st.taps);
    }
  }

  function touch(t: number): void {
    if (st.phase === 'waiting') {
      if (t >= timing.startWindowMs) startSprint(timing.startWindowMs, true);
      else {
        startSprint(t, false);
        counted(t);
        return;
      }
    }
    if (st.phase === 'done' || t >= st.endAt) {
      st.late++;
      on.late?.(t);
      return;
    }
    if (t < st.t0) {
      st.bounces++;
      on.bounce?.(t);
      return;
    }
    if (tokens < 1 || (st.lastTapMs >= 0 && t - st.lastTapMs < TAP.MIN_GAP_MS)) {
      st.bounces++;
      on.bounce?.(t);
      return;
    }
    counted(t);
  }

  function setLevel(next: number): void {
    if (next === st.level) return;
    const from = st.level;
    st.level = next;
    levelMs = 0;
    if (next < 3) inMs = 0;
    on.level?.(from, next);
  }

  function stepLevel(e: number): void {
    if (st.phase !== 'sprint') {
      if (st.level !== 0) setLevel(0);
      return;
    }
    levelMs += TAP.STEP_MS;
    if (st.level >= 3) inMs += TAP.STEP_MS;
    const r = st.rateSm;
    const last = e >= lastFrom();
    const floor = last ? TAP.LAST_MIN_LEVEL : 0;
    let up = 0;
    for (let i = 0; i < TAP.LEVEL_UP.length; i++) if (r >= (TAP.LEVEL_UP[i] ?? Infinity)) up = i + 1;
    up = Math.max(up, floor);
    if (up > st.level) {
      setLevel(up);
      return;
    }
    if (st.level <= floor) return;
    const downAt = (TAP.LEVEL_UP[st.level - 1] ?? 0) - TAP.LEVEL_HYST;
    if (r >= downAt || levelMs < TAP.LEVEL_MIN_MS) return;
    if (st.level === 3 && inMs < TAP.FINGER_IN_MIN_MS) return;
    setLevel(Math.max(floor, st.level - 1));
  }

  return {
    get state(): TapState {
      return st;
    },
    timing,
    milestoneAt,
    get queued(): number {
      return queue.length;
    },
    tap(t: number, n = 1): void {
      for (let k = 0; k < n; k++) {
        // keep the queue in time order (touches can arrive a hair out of order)
        let i = queue.length;
        while (i > 0 && (queue[i - 1] ?? 0) > t) i--;
        queue.splice(i, 0, t);
      }
    },
    resume(t0: number, taps: number, done: boolean): void {
      if (st.phase !== 'waiting') return;
      st.phase = done ? 'done' : 'sprint';
      st.t0 = t0;
      st.endAt = endOf(t0);
      st.auto = false;
      st.taps = Math.max(0, Math.round(taps));
      while (st.milestones < milestoneAt.length && st.taps >= (milestoneAt[st.milestones] ?? Infinity)) st.milestones++;
      queue.length = 0;
    },
    step(elapsedMs: number, flush = false): void {
      st.elapsedMs = elapsedMs;
      // a phone that joined after the start window: the sprint starts at once
      if (st.phase === 'waiting' && joinedAtMs >= timing.startWindowMs) startSprint(Math.min(joinedAtMs, timing.durationMs), true);
      st.rate *= decay;
      tokens = Math.min(TAP.BURST, tokens + TAP.RATE * DT);

      let n = 0;
      while (n < queue.length) {
        const t = queue[n] ?? 0;
        if (!flush && t > elapsedMs) break;
        n++;
        touch(t);
      }
      if (n > 0) queue.splice(0, n);

      if (st.phase === 'waiting' && elapsedMs >= timing.startWindowMs) startSprint(timing.startWindowMs, true);
      st.rateSm += (st.rate - st.rateSm) * smooth;
      if (st.phase === 'sprint') {
        if (!st.lastQuarter && elapsedMs >= lastFrom() && st.endAt - elapsedMs > 0) {
          st.lastQuarter = true;
          on.last?.();
        }
        stepLevel(elapsedMs);
        if (elapsedMs >= st.endAt) {
          st.phase = 'done';
          setLevel(0);
          on.done?.(st.taps);
        }
      }
    },
  };
}
