/**
 * The seeded throw schedule of נינג׳ה תבורי.
 *
 * Pure: the same seed and round length give the same list on every phone.
 * Everything is in FIELD units: x 0..1 across the play column, y 0..1 from
 * the bottom of the HUD to the bottom safe edge (y grows downwards), so every
 * phone sees the same arcs whatever its size.
 */
import { createRng } from '../../kit/rng';

import type { Rng } from '../../kit/rng';

export type ThrowKind = 'fruit' | 'gold' | 'bomb';

export interface Throw {
  /** Game time of the launch, ms since the game started. */
  readonly atMs: number;
  readonly kind: ThrowKind;
  /** Which target_N art (0..4) for a fruit. */
  readonly variant: number;
  /** Launch point (below the bottom edge). */
  readonly x: number;
  readonly y: number;
  /** Field units per second; vy < 0 = up. */
  readonly vx: number;
  readonly vy: number;
  /** Radians per second. */
  readonly spin: number;
  /** Index of the wave the throw belongs to. */
  readonly wave: number;
}

/** Field units per second squared (downwards). */
export const GRAVITY = 1.25;
/** Launch height: just below the bottom edge. */
export const LAUNCH_Y = 1.14;
/** No launch in the last stretch of the round: nothing could be sliced any more. */
const LAST_LAUNCH_BEFORE_END_MS = 1500;
const FIRST_WAVE_MS = 650;
export const TARGET_VARIANTS = 5;
const MAX_GOLD = 3;

type Pattern = 'scatter' | 'fan' | 'stream' | 'cluster';

/** Upward speed that peaks at field height `peakY`. */
function vyForPeak(peakY: number): number {
  return -Math.sqrt(2 * GRAVITY * (LAUNCH_Y - peakY));
}

/** Seconds from launch until the throw falls back to the launch height. */
function flightS(vy: number): number {
  return (-2 * vy) / GRAVITY;
}

interface Slot {
  readonly x: number;
  readonly endX: number;
  readonly peakY: number;
  readonly delayMs: number;
}

function slotsFor(pattern: Pattern, n: number, rng: Rng): Slot[] {
  const out: Slot[] = [];
  switch (pattern) {
    case 'scatter': {
      for (let i = 0; i < n; i++) {
        out.push({
          x: rng.float(0.14, 0.86),
          endX: rng.float(0.1, 0.9),
          peakY: rng.float(0.12, 0.4),
          delayMs: rng.int(0, 90),
        });
      }
      break;
    }
    case 'fan': {
      const cx = rng.float(0.4, 0.6);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        out.push({
          x: cx + rng.float(-0.04, 0.04),
          endX: 0.1 + t * 0.8,
          peakY: rng.float(0.12, 0.3),
          delayMs: i * 70 + rng.int(0, 30),
        });
      }
      break;
    }
    case 'stream': {
      const leftToRight = rng.chance(0.5);
      const step = rng.int(150, 230);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const x = 0.16 + (leftToRight ? t : 1 - t) * 0.68;
        out.push({
          x,
          endX: x + (leftToRight ? 1 : -1) * rng.float(0.05, 0.18),
          peakY: rng.float(0.14, 0.36),
          delayMs: i * step,
        });
      }
      break;
    }
    case 'cluster': {
      // side by side at the same height: one swipe through all of them is a combo
      const width = Math.min(0.62, 0.15 * n);
      const cx = rng.float(0.5 - (0.7 - width) / 2, 0.5 + (0.7 - width) / 2);
      const drift = rng.float(-0.12, 0.12);
      const peak = rng.float(0.16, 0.34);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const x = cx - width / 2 + t * width;
        out.push({
          x,
          endX: x + drift,
          peakY: peak + rng.float(-0.025, 0.025),
          delayMs: rng.int(0, 30),
        });
      }
      break;
    }
    default: {
      const never: never = pattern;
      throw new Error(`Unhandled pattern: ${String(never)}`);
    }
  }
  return out;
}

function pickPattern(rng: Rng, p: number, n: number): Pattern {
  if (n <= 1) return 'scatter';
  const r = rng.next();
  if (n >= 3 && r < 0.3) return 'cluster';
  if (r < 0.5) return 'fan';
  if (r < 0.72 && p > 0.15) return 'stream';
  return 'scatter';
}

/** Build the whole schedule for one round, sorted by launch time. */
export function buildSchedule(seed: number, durationMs: number): Throw[] {
  const rng = createRng(seed).fork('ninja-waves');
  const out: Throw[] = [];
  const lastLaunch = Math.max(FIRST_WAVE_MS, durationMs - LAST_LAUNCH_BEFORE_END_MS);
  let gold = 0;
  let goldForced = false;
  let t = FIRST_WAVE_MS;
  let wave = 0;

  while (t <= lastLaunch) {
    const p = Math.min(1, t / durationMs);
    let n: number;
    let bombs = 0;
    if (wave === 0) {
      n = 1; // the tutorial throw: one slow fruit in the middle
    } else {
      const lo = Math.floor(1 + p * 3.3);
      const hi = Math.min(6, Math.floor(2 + p * 4.6));
      n = rng.int(lo, Math.max(lo, hi));
      if (p >= 0.2 && p < 0.5) bombs = rng.chance(0.35) ? 1 : 0;
      else if (p >= 0.5 && p < 0.75) bombs = rng.chance(0.6) ? 1 : 0;
      else if (p >= 0.75) bombs = rng.chance(0.45) ? 2 : 1;
    }
    bombs = Math.min(bombs, Math.max(0, n - 1));
    const pattern = wave === 0 ? 'scatter' : pickPattern(rng, p, n);
    const slots = wave === 0 ? [{ x: 0.5, endX: 0.56, peakY: 0.26, delayMs: 0 }] : slotsFor(pattern, n, rng);
    // which slots carry bombs (a cluster keeps its bombs at the ends, so a combo stays possible)
    const bombAt = new Set<number>();
    if (bombs > 0) {
      if (pattern === 'cluster') {
        bombAt.add(n - 1);
        if (bombs > 1) bombAt.add(0);
      } else {
        const order = rng.shuffle(slots.map((_, i) => i));
        for (let i = 0; i < bombs; i++) {
          const k = order[i];
          if (k !== undefined) bombAt.add(k);
        }
      }
    }
    // one golden throw is guaranteed past the middle; a few more may come by chance
    let goldAt = -1;
    if (wave > 0 && gold < MAX_GOLD) {
      const forced = !goldForced && p >= 0.55;
      if (forced || (p > 0.12 && rng.chance(0.07))) {
        const free: number[] = [];
        for (let i = 0; i < n; i++) if (!bombAt.has(i)) free.push(i);
        if (free.length > 0) {
          goldAt = rng.pick(free);
          gold++;
          goldForced = true;
        }
      }
    }

    let longest = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s) continue;
      const kind: ThrowKind = bombAt.has(i) ? 'bomb' : i === goldAt ? 'gold' : 'fruit';
      // gold flies a little higher and faster
      const peakY = kind === 'gold' ? Math.max(0.1, s.peakY - 0.06) : s.peakY;
      const vy = wave === 0 ? vyForPeak(peakY) * 0.97 : vyForPeak(peakY);
      const flight = flightS(vy);
      const vx = (s.endX - s.x) / flight;
      const at = t + s.delayMs;
      if (at > lastLaunch) continue;
      out.push({
        atMs: at,
        kind,
        variant: rng.int(0, TARGET_VARIANTS - 1),
        x: s.x,
        y: LAUNCH_Y,
        vx,
        vy,
        spin: rng.float(1.2, 3.6) * (rng.chance(0.5) ? 1 : -1) * (kind === 'bomb' ? 0.35 : 1),
        wave,
      });
      longest = Math.max(longest, s.delayMs);
    }

    const gap = wave === 0 ? 1550 : Math.round(1500 - p * 620) + rng.int(-120, 150);
    t += longest + gap;
    wave++;
  }
  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}

/** Short stable fingerprint of a schedule (determinism checks). */
export function scheduleSignature(list: readonly Throw[]): string {
  let h = 2166136261;
  for (const th of list) {
    const s = `${th.atMs}|${th.kind}|${th.variant}|${th.x.toFixed(4)}|${th.vx.toFixed(4)}|${th.vy.toFixed(4)}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return `${list.length}:${h.toString(16)}`;
}
