/**
 * Fixed-timestep game loop + the global freeze switch.
 *
 * Game time advances ONLY through fixed 60Hz steps, so a freeze of any length
 * (cutscene on the TV) resumes exactly where it stopped. While the kit is
 * paused every loop keeps rendering the frozen frame and runs no update.
 */

// ───────────────────────────── Freeze switch ─────────────────────────────

type PauseListener = (paused: boolean) => void;

let kitPaused = false;
const pauseListeners = new Set<PauseListener>();

/** Freeze / unfreeze every kit loop, timer, tween, particle and input. Called by the stage. */
export function setKitPaused(paused: boolean): void {
  if (paused === kitPaused) return;
  kitPaused = paused;
  for (const fn of [...pauseListeners]) {
    try {
      fn(paused);
    } catch (err) {
      reportKitError(err);
    }
  }
}

export function isKitPaused(): boolean {
  return kitPaused;
}

/** Subscribe to freeze changes (for what the kit does not own). Returns an unsubscribe. */
export function onKitPause(fn: PauseListener): () => void {
  pauseListeners.add(fn);
  return (): void => {
    pauseListeners.delete(fn);
  };
}

// ───────────────────────────── Error funnel ─────────────────────────────

let errorHandler: ((err: unknown) => void) | null = null;

/** The stage installs this: an exception inside a loop stops that loop and lands here. */
export function setKitErrorHandler(fn: ((err: unknown) => void) | null): void {
  errorHandler = fn;
}

export function reportKitError(err: unknown): void {
  console.error('[kit]', err);
  if (errorHandler) errorHandler(err);
}

// ───────────────────────────── Loop ─────────────────────────────

/** Updates per second of game time. */
export const STEP_HZ = 60;
/** Length of one fixed step in seconds: the `dt` every update receives. */
export const STEP_S = 1 / STEP_HZ;
/** Length of one fixed step in ms. */
export const STEP_MS = 1000 / STEP_HZ;

const MAX_FRAME_MS = 100;

export interface LoopOptions {
  /** One fixed step of game logic. `dt` is always STEP_S (1/60 s). */
  update(dt: number): void;
  /** Draw. `alpha` in [0,1) = how far we are into the next step (for interpolation). */
  render?(alpha: number): void;
}

export interface Loop {
  start(): void;
  /** Stops for good (idempotent). Pending timers are dropped. */
  stop(): void;
  readonly running: boolean;
  /** Game time in ms: fixed steps done * STEP_MS. Stands still during a freeze. */
  readonly timeMs: number;
  /** Number of fixed steps done. */
  readonly steps: number;
  /** Run `fn` once after `ms` of GAME time. Returns a cancel function. */
  after(ms: number, fn: () => void): () => void;
  /** Run `fn` every `ms` of GAME time. Returns a cancel function. */
  every(ms: number, fn: () => void): () => void;
}

interface Timer {
  at: number;
  readonly interval: number;
  readonly fn: () => void;
  dead: boolean;
}

export function createLoop(opts: LoopOptions): Loop {
  let running = false;
  let stopped = false;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let steps = 0;
  const timers: Timer[] = [];

  function timeMs(): number {
    return steps * STEP_MS;
  }

  function runTimers(): void {
    const now = timeMs();
    let dead = 0;
    for (let i = 0; i < timers.length; i++) {
      const t = timers[i];
      if (!t) continue;
      if (!t.dead && t.at <= now + 1e-6) {
        if (t.interval > 0) t.at += t.interval;
        else t.dead = true;
        t.fn();
      }
      if (t.dead) dead++;
    }
    if (dead > 0) {
      let w = 0;
      for (let i = 0; i < timers.length; i++) {
        const t = timers[i];
        if (t && !t.dead) timers[w++] = t;
      }
      timers.length = w;
    }
  }

  function frame(now: number): void {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    let dt = now - last;
    last = now;
    if (dt < 0) dt = 0;
    if (dt > MAX_FRAME_MS) dt = MAX_FRAME_MS;
    try {
      if (!kitPaused) {
        acc += dt;
        while (acc >= STEP_MS && running) {
          acc -= STEP_MS;
          steps++;
          runTimers();
          if (!running) break;
          opts.update(STEP_S);
        }
      }
      if (running && opts.render) opts.render(acc / STEP_MS);
    } catch (err) {
      stop();
      reportKitError(err);
    }
  }

  function onVisibility(): void {
    if (!running) return;
    cancelAnimationFrame(raf);
    if (document.visibilityState === 'visible') {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function start(): void {
    if (running || stopped) return;
    running = true;
    last = performance.now();
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState !== 'hidden') raf = requestAnimationFrame(frame);
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    running = false;
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVisibility);
    timers.length = 0;
  }

  function addTimer(ms: number, interval: number, fn: () => void): () => void {
    const t: Timer = { at: timeMs() + Math.max(0, ms), interval, fn, dead: false };
    timers.push(t);
    return (): void => {
      t.dead = true;
    };
  }

  return {
    start,
    stop,
    get running(): boolean {
      return running;
    },
    get timeMs(): number {
      return timeMs();
    },
    get steps(): number {
      return steps;
    },
    after: (ms: number, fn: () => void): (() => void) => addTimer(ms, 0, fn),
    every: (ms: number, fn: () => void): (() => void) => addTimer(ms, Math.max(STEP_MS, ms), fn),
  };
}
