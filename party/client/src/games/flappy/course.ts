/**
 * The flappy course: a seeded, endless list of obstacle pairs.
 *
 * Everything is in field units: the play field (HUD bottom to ground top) is
 * FIELD units tall on every phone, so the same seed gives the same course, the
 * same gaps and the same physics on a 360x640 and a 430x932 screen.
 * Every run of the round flies the SAME course from obstacle 0 (gentle start),
 * and every player of the room gets the same one.
 */
import { clamp, lerp } from '../../kit/fx';
import { createRng } from '../../kit/rng';

import type { Rng } from '../../kit/rng';

/** Height of the play field in units. */
export const FIELD = 100;

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
  /** Distance from the bird to the first obstacle when a run starts. */
  firstLead: 62,
  /** Width of the microphone head (the wide part at the gap edge) and its height. */
  headW: 14,
  headH: 11,
  /** Width of the pole. */
  poleW: 6.2,
} as const;

/** Course tuning knobs (field units). Every phone builds the same course from them. */
export const TUNE = {
  /** Gap height at the start and at full difficulty. */
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
  /** Scroll speed (units/s) at the start of a run and at full speed. */
  speedStart: 29,
  speedEnd: 41,
};

export interface Obstacle {
  /** Index in the course (0 = first). */
  readonly i: number;
  /** World x of the obstacle's center line, in units from the run start. */
  readonly x: number;
  /** Center of the gap, units from the field top. */
  readonly gapY: number;
  /** Gap height in units. */
  readonly gap: number;
}

/** 0 at the start of a run, 1 at full difficulty. */
function rampOf(i: number): number {
  return clamp((i - TUNE.easyCount) / TUNE.rampCount, 0, 1);
}

/** Scroll speed in units per second, from the distance flown in this run. */
export function speedAt(dist: number): number {
  return lerp(TUNE.speedStart, TUNE.speedEnd, clamp((dist - 120) / 1300, 0, 1));
}

export interface Course {
  /** Obstacle i (generated on demand, then cached: never changes). */
  get(i: number): Obstacle;
  readonly seed: number;
}

export function createCourse(seed: number): Course {
  const rng: Rng = createRng(seed).fork('flappy-course');
  const list: Obstacle[] = [];

  function grow(): void {
    const i = list.length;
    const prev = list[i - 1];
    const t = rampOf(i);
    // gaps start generous, then narrow
    const gap = lerp(TUNE.gapStart, TUNE.gapEnd, t) + rng.float(-1.2, 1.2);
    const spacing = lerp(TUNE.spacingStart, TUNE.spacingEnd, t) + rng.float(-2.5, 2.5);
    const margin = 9;
    const lo = margin + gap / 2;
    const hi = FIELD - margin - gap / 2;
    let gapY: number;
    if (!prev) {
      gapY = rng.float(FIELD * 0.42, FIELD * 0.58);
    } else {
      // limit the jump from the previous gap so every course is fair
      const maxJump = lerp(TUNE.jumpStart, TUNE.jumpEnd, t);
      const want = rng.float(lo, hi);
      gapY = clamp(want, prev.gapY - maxJump, prev.gapY + maxJump);
      gapY = clamp(gapY, lo, hi);
    }
    const x = prev ? prev.x + spacing : PHYS.firstLead;
    list.push({ i, x, gapY, gap });
  }

  return {
    seed,
    get(i: number): Obstacle {
      while (list.length <= i) grow();
      const o = list[i];
      if (!o) throw new Error('flappy course: bad index');
      return o;
    },
  };
}

/** Is the point (cx, cy) closer than r to the rectangle (0 inside)? */
function circleHitsRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number): boolean {
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/**
 * Does the bird (circle of PHYS.hitRadius at x = bx relative to the bird's
 * column, y = by, field units) touch an obstacle near `nextIdx` after flying
 * `dist`? Pure, shared by the game and the QA simulation.
 */
export function hitsObstacle(course: Course, nextIdx: number, dist: number, bx: number, by: number): boolean {
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
