/**
 * A flappy pilot, pure (no DOM): used by the unit tests (how long can anybody survive the
 * finale?), by the load-test bots, by the dev harness' simulated field and by the test hook
 * `window.__flappy.autopilot()`.
 *
 * `pilotFlap` is a strong player: it aims at the next gap and, before every step, flies both
 * choices (tap / no tap) ahead with the simple rule and keeps the one that survives longer.
 */
import { FIELD, hitsObstacle, newBird, PASS_BEHIND, PHYS, STEP_HZ, STEP_MS, stepBird } from './course';

import type { Bird, Flight } from './course';

/** The simple rule: tap when the bird is under the line it aims at. */
function greedyFlap(flight: Flight, dist: number, nextIdx: number, b: Bird): boolean {
  const o = flight.get(nextIdx);
  const ahead = o.x - dist;
  // aim a little under the middle of the gap: a tap throws the bird 9 units up
  let target = o.gapY + Math.min(4, o.gap * 0.12);
  if (ahead < -2) {
    // already inside this obstacle: start moving towards the next one
    const n = flight.get(nextIdx + 1);
    target = target + (n.gapY - target) * 0.25;
  }
  target = Math.min(target, FIELD - 12);
  if (b.hover) return ahead < 60;
  return b.y + b.vy * 0.06 > target + 1.5 && b.vy > -20;
}

/** Steps the bird survives from here (at most `horizon`) when it starts with `first` and then follows the simple rule. */
function rollout(flight: Flight, step: number, b0: Bird, first: boolean, horizon: number, ceil: number): number {
  const b: Bird = { y: b0.y, vy: b0.vy, hover: b0.hover };
  let idx = flight.nextIndex(flight.distAt(step));
  for (let k = 0; k < horizon; k++) {
    const s = step + k;
    const dist = flight.distAt(s + 1);
    while (flight.get(idx).x - dist < -PASS_BEHIND) idx++;
    const flap = k === 0 ? first : greedyFlap(flight, dist, idx, b);
    if (stepBird(b, flap, flight, idx, dist, ceil, true)) return k;
  }
  return horizon;
}

/**
 * Should a strong player tap during the step that follows `step`?
 * `horizon` = how far it looks ahead, in steps (default 1.5 s).
 */
export function pilotFlap(flight: Flight, step: number, b: Bird, ceil = 0, horizon = Math.round(STEP_HZ * 1.5)): boolean {
  const dist = flight.distAt(step + 1);
  const idx = flight.nextIndex(dist);
  const want = greedyFlap(flight, dist, idx, b);
  const a = rollout(flight, step, b, want, horizon, ceil);
  if (a >= horizon) return want;
  const other = rollout(flight, step, b, !want, horizon, ceil);
  return other > a ? !want : want;
}

export interface FlightResult {
  /** Step at which the bird went down; null when it was still flying at `maxSteps`. */
  readonly diedAtStep: number | null;
  /** Distance flown at that step (or at maxSteps). */
  readonly dist: number;
  readonly passed: number;
}

/**
 * Fly a whole round with a pilot. `flapAt(step, bird)` decides the tap of each step; the
 * default is the strong pilot. The never-tapping guest is `() => false`.
 */
export function simulateFlight(
  flight: Flight,
  maxSteps: number,
  flapAt: (step: number, bird: Bird, flight: Flight) => boolean = (step, bird, f) => pilotFlap(f, step, bird),
  ceil = 0,
): FlightResult {
  const b = newBird();
  let idx = 0;
  const hoverSteps = Math.round(PHYS.hoverMs / STEP_MS);
  for (let step = 0; step < maxSteps; step++) {
    const dist = flight.distAt(step + 1);
    while (flight.get(idx).x - dist < -PASS_BEHIND) idx++;
    const flap = flapAt(step, b, flight);
    if (b.hover && !flap && step >= hoverSteps) b.hover = false;
    if (stepBird(b, flap, flight, idx, dist, ceil, true)) return { diedAtStep: step + 1, dist, passed: idx };
  }
  return { diedAtStep: null, dist: flight.distAt(maxSteps), passed: idx };
}

/** Exported for tests: is the bird touching anything at this spot? */
export function touches(flight: Flight, dist: number, y: number): boolean {
  return y + PHYS.hitRadius >= FIELD || hitsObstacle(flight, flight.nextIndex(dist), dist, 0, y);
}
