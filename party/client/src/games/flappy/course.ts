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
  gravity: 265,
  flapVy: -80,
  maxFall: 125,
  /** Visual radius of the face. */
  radius: 5.4,
  /** Collision radius (a bit forgiving). */
  hitRadius: 4.1,
  /** Distance from the bird to the first obstacle when a run starts. */
  firstLead: 62,
  /** Width of the microphone head (the wide part at the gap edge) and its height. */
  headW: 14,
  headH: 11,
  /** Width of the pole. */
  poleW: 6.2,
} as const;

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
  return clamp((i - 4) / 26, 0, 1);
}

/** Scroll speed in units per second, from the distance flown in this run. */
export function speedAt(dist: number): number {
  return lerp(29, 41, clamp((dist - 120) / 1300, 0, 1));
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
    const gap = lerp(44, 29, t) + rng.float(-1.2, 1.2);
    const spacing = lerp(58, 45, t) + rng.float(-2.5, 2.5);
    const margin = 9;
    const lo = margin + gap / 2;
    const hi = FIELD - margin - gap / 2;
    let gapY: number;
    if (!prev) {
      gapY = rng.float(FIELD * 0.42, FIELD * 0.58);
    } else {
      // limit the jump from the previous gap so every course is fair
      const maxJump = lerp(14, 30, t);
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
