/**
 * The show of "שימי טאפ" that does not depend on the player: which booger comes out at
 * every dig, after how many digs the BIG booger comes, when the frenzy starts, which bored
 * faces the doll pulls while nobody taps, and where each booger lands on the glass. All of
 * it is computed up front from the seed and the round length only, so every phone in the
 * room gets exactly the same sequence (the player only decides how far into it they get).
 * Times are ms of round time. Pure: no DOM, no Math.random, no clock.
 */
import { createRng } from '../../kit/rng';

/** Booger characters (indexes into the booger art slots). */
export const BOOGER = {
  Round: 0,
  Stretchy: 1,
  Googly: 2,
  Hairy: 3,
  Golden: 4,
  Boss: 5,
} as const satisfies Record<string, number>;
export type BoogerKind = (typeof BOOGER)[keyof typeof BOOGER];
export const BOOGER_KINDS = 6;

/** Faces the doll pulls while it is bored (nobody taps): indexes into IDLE_FACES of the game. */
export const IDLE_FACE_COUNT = 4;

/** Length of the precomputed booger sequence; it repeats after that (nobody digs 512 times in a minute). */
export const BOOGER_SEQ_LEN = 512;

export interface TapLevel {
  readonly durationMs: number;
  /** Round time at which the frenzy ("last 15 seconds") starts. */
  readonly frenzyFrom: number;
  /** Kind of the booger thrown by dig #i (i from 0), for i < BOOGER_SEQ_LEN (then it repeats). */
  readonly boogers: readonly BoogerKind[];
  /** Dig counts (cumulative, ascending) at which the BIG booger comes out. */
  readonly bigAt: readonly number[];
  /** Bored faces in order (the doll cycles through them while nobody taps). */
  readonly idleFaces: readonly number[];
  /** Short stable string of the whole level (for tests and logs). */
  readonly fingerprint: string;
}

function hash(parts: readonly number[]): string {
  let h = 2166136261;
  for (const n of parts) {
    h ^= Math.round(n * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Normal digs: everything but the boss (the boss only comes at the BIG moments). */
const DIG_WEIGHTS: ReadonlyArray<readonly [BoogerKind, number]> = [
  [BOOGER.Round, 34],
  [BOOGER.Stretchy, 22],
  [BOOGER.Googly, 20],
  [BOOGER.Hairy, 20],
  [BOOGER.Golden, 4],
];
const DIG_WEIGHT_SUM = DIG_WEIGHTS.reduce((s, [, w]) => s + w, 0);

/** First BIG booger after this many digs, then every BIG_GAP digs (both seeded within the range). */
export const BIG_FIRST: readonly [number, number] = [12, 16];
export const BIG_GAP: readonly [number, number] = [18, 26];

export function buildLevel(seed: number, durationMs: number): TapLevel {
  const dur = Math.max(1000, durationMs);
  const root = createRng(seed);
  const frenzyFrom = dur - Math.min(15_000, dur * 0.25);

  // ── booger sequence (no golden twice in a row, never the same character three times) ──
  const rb = root.fork('boogers');
  const boogers: BoogerKind[] = [];
  for (let i = 0; i < BOOGER_SEQ_LEN; i++) {
    let kind: BoogerKind = BOOGER.Round;
    for (let tries = 0; tries < 6; tries++) {
      let x = rb.next() * DIG_WEIGHT_SUM;
      for (const [k, w] of DIG_WEIGHTS) {
        x -= w;
        if (x < 0) {
          kind = k;
          break;
        }
      }
      const a = boogers[i - 1];
      const b = boogers[i - 2];
      if (kind === BOOGER.Golden && a === BOOGER.Golden) continue;
      if (kind === a && kind === b) continue;
      break;
    }
    boogers.push(kind);
  }

  // ── BIG booger thresholds (in digs) ──
  const rg = root.fork('big');
  const bigAt: number[] = [];
  let at = rg.int(BIG_FIRST[0], BIG_FIRST[1]);
  while (at < 2000) {
    bigAt.push(at);
    at += rg.int(BIG_GAP[0], BIG_GAP[1]);
  }

  // ── bored faces ──
  const rf = root.fork('faces');
  const idleFaces: number[] = [];
  let cur = -1;
  for (let i = 0; i < 32; i++) {
    let next = rf.int(0, IDLE_FACE_COUNT - 2);
    if (next >= cur && cur >= 0) next++;
    cur = next;
    idleFaces.push(cur);
  }

  const parts: number[] = [dur, frenzyFrom, ...boogers, ...bigAt.slice(0, 40), ...idleFaces];
  return { durationMs: dur, frenzyFrom, boogers, bigAt, idleFaces, fingerprint: hash(parts) };
}

/** Kind of the booger of dig #i. */
export function boogerOf(level: TapLevel, i: number): BoogerKind {
  return level.boogers[((i % BOOGER_SEQ_LEN) + BOOGER_SEQ_LEN) % BOOGER_SEQ_LEN] ?? BOOGER.Round;
}

/**
 * Cosmetic traits of booger #i (where it lands on the glass, how it spins and slides),
 * a pure function of the seed and the index: the same on every phone, and no state to keep.
 * All values are 0..1; the game scales them.
 */
export interface BoogerTraits {
  readonly u: number;
  readonly v: number;
  readonly spin: number;
  readonly slide: number;
  readonly size: number;
}

function mix(a: number): number {
  let t = a >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function boogerTraits(seed: number, i: number): BoogerTraits {
  const base = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(i + 1, 0xc2b2ae35);
  return {
    u: mix(base),
    v: mix(base + 0x6d2b79f5),
    spin: mix(base + 0x1b873593),
    slide: mix(base + 0x27d4eb2f),
    size: mix(base + 0x165667b1),
  };
}
