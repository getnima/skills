/**
 * The tower of "אייסי שימי": every floor comes from the round seed, in world
 * units that do not depend on the screen, so every phone climbs the same tower.
 * World: x from 0 to WORLD_W (side walls inside), altitude grows upwards.
 */
import { createRng } from '../../kit/rng';

export const WORLD_W = 400;
/** Thickness of each side wall. */
export const WALL_W = 18;
export const INNER_L = WALL_W;
export const INNER_R = WORLD_W - WALL_W;
/** Visual thickness of a floor slab (its top is the walkable line). */
export const FLOOR_H = 17;
export const MILESTONE_EVERY = 10;
/** Far more than anyone can climb in one round. */
export const FLOOR_COUNT = 2400;

export interface Level {
  readonly count: number;
  /** Altitude of each floor's top, strictly increasing. Floor 0 is the ground. */
  readonly alt: Float64Array;
  /** Center x of each floor. */
  readonly x: Float64Array;
  /** Half width of each floor. */
  readonly half: Float64Array;
  /** Short fingerprint of the layout (for tests: same seed = same hash). */
  readonly hash: string;
}

export function isMilestone(i: number): boolean {
  return i > 0 && i % MILESTONE_EVERY === 0;
}

const FULL_HALF = (INNER_R - INNER_L) / 2;

export function buildLevel(seed: number): Level {
  const rng = createRng(seed).fork('icy-floors');
  const alt = new Float64Array(FLOOR_COUNT);
  const x = new Float64Array(FLOOR_COUNT);
  const half = new Float64Array(FLOOR_COUNT);
  alt[0] = 0;
  x[0] = WORLD_W / 2;
  half[0] = FULL_HALF;
  let prevX = WORLD_W / 2;
  let h = 0x811c9dc5;
  for (let i = 1; i < FLOOR_COUNT; i++) {
    const t = Math.min(1, i / 140);
    // close together at the bottom, further apart higher up
    const gap = 76 + 40 * t + rng.float(-5, 5);
    alt[i] = (alt[i - 1] ?? 0) + gap;
    if (isMilestone(i)) {
      x[i] = WORLD_W / 2;
      half[i] = FULL_HALF;
      // keep the stream identical whatever happens above
      rng.next();
      rng.next();
      continue;
    }
    // wide at the bottom, narrower higher up
    const hw = Math.min(FULL_HALF - 20, (100 - 54 * Math.min(1, i / 130)) * rng.float(0.82, 1.18));
    const lo = INNER_L + hw;
    const hi = INNER_R - hw;
    let cx = rng.float(lo, hi);
    // avoid a floor stacked straight above the previous one
    if (Math.abs(cx - prevX) < 46) cx = cx + 46 * (cx < prevX ? -1 : 1);
    if (cx < lo || cx > hi) cx = Math.min(hi, Math.max(lo, prevX + (prevX < WORLD_W / 2 ? 1 : -1) * 90));
    x[i] = cx;
    half[i] = hw;
    prevX = cx;
    if (i < 400) {
      h ^= Math.round(cx * 10) ^ (Math.round(hw * 10) << 12) ^ (Math.round(alt[i] ?? 0) << 3);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return { count: FLOOR_COUNT, alt, x, half, hash: h.toString(16) };
}

/** Index of the highest floor whose top is at or below `a` (0 when below the ground). */
export function floorAtOrBelow(level: Level, a: number): number {
  let lo = 0;
  let hi = level.count - 1;
  if ((level.alt[hi] ?? 0) <= a) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((level.alt[mid] ?? 0) <= a) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
