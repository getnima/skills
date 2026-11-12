/**
 * The flappy flight: a seeded, endless course AND the clock that scrolls it.
 *
 * Everything is in field units: the play field (HUD bottom to ground top) is FIELD units
 * tall on every phone, so the same seed gives the same course, the same gaps and the same
 * physics on a 320x568 and a 430x932 screen.
 *
 * One life, one flight for the whole room: the distance flown is a pure function of the
 * ROUND TIME (fixed 60 Hz steps since GO), never of a phone's frame rate, so at the same
 * round time every phone is at the same point of the same course. The finale ("only 3
 * left") makes the course harder as a pure function of (seed, time since the finale began).
 *
 * No DOM in here: the game, the unit tests and the load-test bots all import this file.
 */

/** Fixed steps per second of round time, and the length of one step. */
export const STEP_HZ = 60;
export const STEP_S = 1 / STEP_HZ;
export const STEP_MS = 1000 / STEP_HZ;

/** Height of the play field in units. */
export const FIELD = 100;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Physics, in units and seconds. */
export const PHYS = {
  gravity: 240,
  flapVy: -66,
  /** Terminal fall speed: low enough that a late tap (a first-timer reacts in 0.25-0.4 s) can still save the bird. */
  maxFall: 75,
  /** Visual radius of the face. */
  radius: 5.4,
  /** Collision radius: about 60% of the face's drawn radius, so grazing a stand with the cheek is fine. */
  hitRadius: 3.6,
  /** Distance from the bird to the first obstacle at GO. */
  firstLead: 78,
  /** Width of the microphone head (the wide part at the gap edge) and its height. */
  headW: 14,
  headH: 11,
  /** Width of the pole. */
  poleW: 6.2,
  /** Where the bird hangs before the first tap (units from the field top). */
  hoverY: 42,
  /** The bird hangs in the air for this long after GO (or until the first tap); then it falls. */
  hoverMs: 1_500,
  /** After a reload / a long stall the bird is put back in the middle of the next gap, untouchable and hanging, for this long (or until a tap). */
  rejoinGraceMs: 600,
} as const;

/** Course tuning knobs (field units). Every phone builds the same course from them. */
export const TUNE = {
  /** Gap height at the start and at full (pre-finale) difficulty. */
  gapStart: 60,
  gapEnd: 27,
  /** Horizontal distance between obstacles at the start and at full difficulty. */
  spacingStart: 58,
  spacingEnd: 45,
  /** Largest change of the gap's height from one obstacle to the next. */
  jumpStart: 6,
  jumpEnd: 30,
  /** Obstacles before the course starts to get harder, and how many it takes to reach full difficulty. */
  easyCount: 3,
  rampCount: 30,
  /** Scroll speed (units/s) at GO and at full speed (reached after `speedRampDist` units). */
  speedStart: 29,
  speedEnd: 41,
  speedRampFrom: 120,
  speedRampDist: 1300,
} as const;

/**
 * The finale: every FINALE.stageS seconds since it began the course takes one more step.
 * Stage n (0, 1, 2 ...): gaps at most gap0 - n * gapStep, the gap may move at least
 * jump0 + n * jumpStep from one obstacle to the next, obstacles at most
 * spacing0 - n * spacingStep apart; and the scroll speed is multiplied by
 * 1 + speedPerS * seconds (continuously). At stage 10 (25 s) a gap is narrower than the
 * bird: nobody flies past that.
 */
export const FINALE = {
  stageS: 2.5,
  gap0: 34,
  gapStep: 3,
  gapMin: 4,
  jump0: 18,
  jumpStep: 3,
  jumpMax: 46,
  spacing0: 50,
  spacingStep: 1.5,
  spacingMin: 36,
  speedPerS: 0.012,
  speedBoostMax: 1.45,
} as const;

export interface FinaleDifficulty {
  /** Stage number, 0 at the moment the finale begins. */
  readonly stage: number;
  /** Largest gap an obstacle may have. */
  readonly gap: number;
  /** The gap's centre may move at least this much between obstacles. */
  readonly jump: number;
  /** Largest distance between two obstacles. */
  readonly spacing: number;
  /** Scroll speed multiplier. */
  readonly speed: number;
}

/**
 * Difficulty `tauS` seconds after the finale began (tauS >= 0). Pure and monotonic:
 * gap and spacing never grow, jump and speed never shrink.
 */
export function finaleDifficulty(tauS: number): FinaleDifficulty {
  const t = Math.max(0, tauS);
  const stage = Math.floor(t / FINALE.stageS + 1e-9);
  return {
    stage,
    gap: Math.max(FINALE.gapMin, FINALE.gap0 - stage * FINALE.gapStep),
    jump: Math.min(FINALE.jumpMax, FINALE.jump0 + stage * FINALE.jumpStep),
    spacing: Math.max(FINALE.spacingMin, FINALE.spacing0 - stage * FINALE.spacingStep),
    speed: Math.min(FINALE.speedBoostMax, 1 + FINALE.speedPerS * t),
  };
}

/** Seconds after the finale began at which every new gap is narrower than the bird's hit circle. */
export const FINALE_IMPOSSIBLE_S = (Math.ceil((FINALE.gap0 + 1.2 - 2 * PHYS.hitRadius) / FINALE.gapStep) + 0) * FINALE.stageS;

export interface Obstacle {
  /** Index in the course (0 = first). */
  readonly i: number;
  /** World x of the obstacle's center line, in units from GO. */
  readonly x: number;
  /** Center of the gap, units from the field top. */
  readonly gapY: number;
  /** Gap height in units. */
  readonly gap: number;
}

/** 0 at the start of the course, 1 at full pre-finale difficulty. */
function rampOf(i: number): number {
  return clamp((i - TUNE.easyCount) / TUNE.rampCount, 0, 1);
}

/** Pre-finale scroll speed in units per second, from the distance flown. */
export function baseSpeed(dist: number): number {
  return lerp(TUNE.speedStart, TUNE.speedEnd, clamp((dist - TUNE.speedRampFrom) / TUNE.speedRampDist, 0, 1));
}

/** Three independent floats in [0, 1) for obstacle `i` of `seed` (stateless, so any obstacle can be rebuilt alone). */
function noise3(seed: number, i: number): [number, number, number] {
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b) ^ 0x5f1a99) | 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next();
  return [next(), next(), next()];
}

export interface Flight {
  readonly seed: number;
  /** Step (round time / STEP_MS) at which the finale begins, or null when there is none (yet). */
  readonly finaleStep: number | null;
  /**
   * Set (or clear) the finale. The course before it never changes; obstacles that the bird
   * reaches after it are rebuilt. Safe to call any number of times with the same value.
   */
  setFinale(step: number | null): void;
  /** Distance flown after `step` fixed steps of round time. */
  distAt(step: number): number;
  /** Scroll speed (units/s) during the step that follows `step`. */
  speedAt(step: number): number;
  /** First step at which the distance is at least `x`. */
  stepAtDist(x: number): number;
  /** Obstacle i (built on demand; fixed for a given seed and finale step). */
  get(i: number): Obstacle;
  /** Index of the first obstacle the bird (at distance `dist`) has not fully passed. */
  nextIndex(dist: number): number;
}

/** The bird has passed an obstacle once the obstacle's centre is this far behind it. */
export const PASS_BEHIND = PHYS.poleW / 2 + PHYS.hitRadius;

export function createFlight(seed: number): Flight {
  /** dists[k] = distance after k steps. */
  const dists: number[] = [0];
  const list: Obstacle[] = [];
  /** arrive[i] = step at which the bird reaches obstacle i's centre line. */
  const arrive: number[] = [];
  let finaleStep: number | null = null;

  function speedAt(step: number): number {
    const d = distAt(step);
    const boost = finaleStep !== null && step > finaleStep ? finaleDifficulty((step - finaleStep) * STEP_S).speed : 1;
    return baseSpeed(d) * boost;
  }

  function distAt(step: number): number {
    const k = Math.max(0, Math.floor(step));
    while (dists.length <= k) {
      const j = dists.length - 1;
      const d = dists[j] ?? 0;
      const boost = finaleStep !== null && j > finaleStep ? finaleDifficulty((j - finaleStep) * STEP_S).speed : 1;
      dists.push(d + baseSpeed(d) * boost * STEP_S);
    }
    return dists[k] ?? 0;
  }

  function stepAtDist(x: number): number {
    if (x <= 0) return 0;
    while ((dists[dists.length - 1] ?? 0) < x) distAt(dists.length + 120);
    let lo = 0;
    let hi = dists.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((dists[mid] ?? 0) >= x) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  function grow(): void {
    const i = list.length;
    const prev = list[i - 1];
    const [u1, u2, u3] = noise3(seed, i);
    const t = rampOf(i);
    let gap = lerp(TUNE.gapStart, TUNE.gapEnd, t);
    let spacing = lerp(TUNE.spacingStart, TUNE.spacingEnd, t);
    let maxJump = lerp(TUNE.jumpStart, TUNE.jumpEnd, t);
    if (prev && finaleStep !== null) {
      // the difficulty of the moment the bird flies through the obstacle before this one
      const tau = ((arrive[i - 1] ?? 0) - finaleStep) * STEP_S;
      if (tau >= 0) {
        const f = finaleDifficulty(tau);
        gap = Math.min(gap, f.gap);
        spacing = Math.min(spacing, f.spacing);
        maxJump = Math.max(maxJump, f.jump);
      }
    }
    gap += (u1 * 2 - 1) * 1.2;
    spacing += (u2 * 2 - 1) * 2.5;
    const margin = 9;
    const lo = margin + gap / 2;
    const hi = FIELD - margin - gap / 2;
    let gapY: number;
    if (!prev) {
      gapY = lerp(FIELD * 0.42, FIELD * 0.58, u3);
    } else {
      // limit the jump from the previous gap so every course is fair
      gapY = clamp(lerp(lo, hi, u3), prev.gapY - maxJump, prev.gapY + maxJump);
      gapY = clamp(gapY, lo, hi);
    }
    const x = prev ? prev.x + spacing : PHYS.firstLead;
    list.push({ i, x, gapY, gap });
    arrive.push(stepAtDist(x));
  }

  function get(i: number): Obstacle {
    while (list.length <= i) grow();
    const o = list[i];
    if (!o) throw new Error('flappy course: bad index');
    return o;
  }

  return {
    seed,
    get finaleStep(): number | null {
      return finaleStep;
    },
    setFinale(step: number | null): void {
      const next = step === null ? null : Math.max(0, Math.round(step));
      if (next === finaleStep) return;
      // Nothing up to the earlier of the two finale steps depends on either of them.
      const keep = Math.min(finaleStep ?? Number.POSITIVE_INFINITY, next ?? Number.POSITIVE_INFINITY);
      finaleStep = next;
      if (dists.length > keep + 2) dists.length = keep + 2;
      // obstacle i depends on the finale when the bird reaches obstacle i-1 at or after it
      let cut = list.length;
      for (let i = 1; i < list.length; i++) {
        if ((arrive[i - 1] ?? 0) >= keep) {
          cut = i;
          break;
        }
      }
      list.length = Math.min(list.length, cut);
      arrive.length = list.length;
      // arrival steps of the kept obstacles are before `keep`: still right
    },
    distAt,
    speedAt,
    stepAtDist,
    get,
    nextIndex(dist: number): number {
      let i = 0;
      // obstacles are 36+ units apart: a linear walk is at most a few hundred cheap steps
      while (get(i).x - dist < -PASS_BEHIND) i++;
      return i;
    },
  };
}

// ───────────────────────────── Collision ─────────────────────────────

/** Is the point (cx, cy) closer than r to the rectangle (0 inside)? */
function circleHitsRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number): boolean {
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/**
 * Does the bird (circle of PHYS.hitRadius at x = bx relative to the bird's column,
 * y = by, field units) touch an obstacle near `nextIdx` after flying `dist`? Pure.
 */
export function hitsObstacle(course: Pick<Flight, 'get'>, nextIdx: number, dist: number, bx: number, by: number): boolean {
  const r = PHYS.hitRadius;
  const hw = PHYS.headW * 0.42;
  const hh = PHYS.headH * 0.78;
  const pw = PHYS.poleW / 2;
  const from = Math.max(0, nextIdx - 1);
  for (let i = from; i <= nextIdx + 1; i++) {
    const o = course.get(i);
    const ox = o.x - dist;
    if (ox - PHYS.headW > bx + r || ox + PHYS.headW < bx - r) continue;
    const gapTop = o.gapY - o.gap / 2;
    const gapBot = o.gapY + o.gap / 2;
    // heads (the dome's rounded top is covered by the circle test's corners)
    if (circleHitsRect(bx, by, r, ox - hw, gapTop - hh, hw * 2, hh)) return true;
    if (circleHitsRect(bx, by, r, ox - hw, gapBot, hw * 2, hh)) return true;
    // poles
    if (circleHitsRect(bx, by, r, ox - pw, -400, pw * 2, gapTop - hh + 400)) return true;
    if (circleHitsRect(bx, by, r, ox - pw, gapBot + hh, pw * 2, 400)) return true;
  }
  return false;
}

// ───────────────────────────── The bird ─────────────────────────────

export interface Bird {
  y: number;
  vy: number;
  /** Hanging in the air (no gravity): before the first tap, and during the rejoin grace. */
  hover: boolean;
}

export function newBird(): Bird {
  return { y: PHYS.hoverY, vy: 0, hover: true };
}

/**
 * One fixed step of the bird. `ceil` is the top of the visible sky in field units (<= 0).
 * Returns true when the bird is down: it touched the ground or (when `canHit`) an obstacle.
 */
export function stepBird(b: Bird, flap: boolean, flight: Pick<Flight, 'get'>, nextIdx: number, dist: number, ceil: number, canHit: boolean): boolean {
  if (flap) {
    b.hover = false;
    b.vy = PHYS.flapVy;
  }
  if (b.hover) return false;
  b.vy = Math.min(PHYS.maxFall, b.vy + PHYS.gravity * STEP_S);
  b.y += b.vy * STEP_S;
  const top = ceil + PHYS.radius * 0.6;
  if (b.y < top) {
    b.y = top;
    if (b.vy < 0) b.vy = 0;
  }
  if (b.y + PHYS.hitRadius >= FIELD) {
    b.y = FIELD - PHYS.hitRadius;
    return true;
  }
  return canHit && hitsObstacle(flight, nextIdx, dist, 0, b.y);
}

// ───────────────────────────── Survival score ─────────────────────────────

/** Raw score of an elimination round: the distance flown, in tenths of a unit (at least 1 once in the air). */
export function survivalRaw(dist: number): number {
  return Math.max(1, Math.round(dist * 10));
}

/** Obstacles passed after flying `dist` (the friendly number on the game screen). */
export function obstaclesPassed(flight: Flight, dist: number): number {
  return flight.nextIndex(dist);
}
