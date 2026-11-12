/**
 * A flappy pilot, pure (no DOM): used by the unit tests (how long can anybody survive the
 * finale?), by the load-test bots, by the dev harness' simulated field and by the test hook
 * `window.__flappy.autopilot()`.
 *
 * `pilotFlap` is a strong player: it aims at the next gap and, before every step, flies both
 * choices (tap / no tap) ahead with the simple rule and keeps the one that survives longer.
 */
import { createFlight, FIELD, hitsObstacle, newBird, PASS_BEHIND, PHYS, STEP_HZ, STEP_MS, stepBird } from './course';

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

/** A seeded float in [0, 1) for (seed, n): stateless, so a pilot's lapses do not depend on call order. */
function unit(seed: number, n: number): number {
  let t = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(n + 11, 0x85ebca6b)) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * A party guest: the strong pilot with lapses. Every quarter of a second there is a chance
 * (higher for a low `skill`, 0..1) that the thumb freezes for 0.25-0.6 s or taps once too
 * often. skill 1 never lapses; skill 0 lapses about once a second.
 */
export function guestPilot(seed: number, skill: number): (step: number, bird: Bird, flight: Flight) => boolean {
  const perSlot = (1 - clamp01(skill)) * 0.28 + 0.004;
  const SLOT = 15;
  return (step, bird, flight) => {
    const slot = Math.floor(step / SLOT);
    // a lapse that began in one of the last slots may still be running
    for (let k = 0; k < 3; k++) {
      const s = slot - k;
      if (s < 2 || unit(seed, s) >= perSlot) continue;
      const kind = unit(seed, s + 50_000);
      const len = Math.round((0.25 + unit(seed, s + 90_000) * 0.35) * STEP_HZ);
      const from = s * SLOT;
      if (kind < 0.8) {
        if (step < from + len) return false; // frozen thumb
      } else if (step === from || step === from + 6) return true; // nervous double tap
    }
    return pilotFlap(flight, step, bird, 0, 45);
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface FieldRun {
  /** Step at which each player went down (null: still flying at the cap), by player index. */
  readonly diedAt: ReadonlyArray<number | null>;
  /** Step at which the finale began (null: never). */
  readonly finaleStep: number | null;
  /** Step at which the server ends the round. */
  readonly endStep: number;
}

/**
 * A whole elimination round with `skills.length` guests, by the server's rules: the finale
 * is announced when `threshold` are left (3 s ahead) or at `latestStep`, everyone flies the
 * same course, and the round ends 1.5 s after one is left (or at `capSteps`).
 */
export function simulateField(seed: number, skills: readonly number[], capSteps: number, latestStep: number, smallFieldStep: number): FieldRun {
  const n = skills.length;
  const threshold = n >= 5 ? 3 : n - 1;
  const lead = 3 * STEP_HZ;
  const fly = (finale: number | null, i: number): number | null => {
    const f = createFlightFor(seed, finale);
    return simulateFlight(f, capSteps, guestPilot(seed * 131 + i * 977 + 5, skills[i] ?? 0.5)).diedAtStep;
  };
  // first without a finale: when does the count drop to the threshold?
  const plain = skills.map((_, i) => fly(null, i));
  let finaleStep: number | null = null;
  if (n <= 2) finaleStep = smallFieldStep;
  else {
    const sorted = plain.map((d) => d ?? Number.POSITIVE_INFINITY).sort((a, b) => a - b);
    const drop = sorted[n - threshold - 1] ?? Number.POSITIVE_INFINITY; // the crash that leaves `threshold`
    finaleStep = Math.min(drop + lead, latestStep);
    if (!Number.isFinite(finaleStep)) finaleStep = null;
  }
  // whoever is still flying when the finale begins flies it (nothing before it changes)
  const diedAt = plain.map((d, i) => (finaleStep !== null && (d === null || d > finaleStep) ? fly(finaleStep, i) : d));
  const order = diedAt.map((d) => d ?? Number.POSITIVE_INFINITY).sort((a, b) => a - b);
  const secondLast = n >= 2 ? (order[n - 2] ?? Number.POSITIVE_INFINITY) : (order[0] ?? Number.POSITIVE_INFINITY);
  const endStep = Math.min(capSteps, secondLast + Math.round(1.5 * STEP_HZ));
  return { diedAt, finaleStep, endStep };
}

function createFlightFor(seed: number, finale: number | null): Flight {
  const f = createFlight(seed);
  f.setFinale(finale);
  return f;
}
