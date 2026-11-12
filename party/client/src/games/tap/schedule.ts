/**
 * The show of "שימי טאפ" that does not depend on the player: which booger comes out at
 * every drip, which drip is the golden one, the order of the waiting bits, the slow-player
 * fillers and the final-frame gags, and where each booger lands on the glass. All of it is
 * computed up front from the seed and the round length only, so every phone in the room
 * gets exactly the same sequence (the player only decides how far into it they get).
 * Pure: no DOM, no Math.random, no clock.
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

/** Length of the precomputed drip sequence; it repeats after that (at most ~95 drips in a sprint). */
export const BOOGER_SEQ_LEN = 256;

/** The waiting bits: the sneak, the yawn, the knock on the glass, falling asleep, the shy booger. */
export const IDLE_BIT = { Sneak: 0, Yawn: 1, Knock: 2, Sleep: 3, Peek: 4 } as const satisfies Record<string, number>;
export const IDLE_BITS = 5;
export type IdleBit = (typeof IDLE_BIT)[keyof typeof IDLE_BIT];

/** Slow-player fillers, each at most once per round. */
export const FILLER = { EyeRoll: 0, Wink: 1, Sniff: 2 } as const satisfies Record<string, number>;
export type Filler = (typeof FILLER)[keyof typeof FILLER];

/** Small gags of the final frame (one every 2 s): a booger slides, the googly one blinks, he nods, the booger on his head bounces. */
export const ALIVE = { Slide: 0, Blink: 1, Nod: 2, Hat: 3 } as const satisfies Record<string, number>;
export type Alive = (typeof ALIVE)[keyof typeof ALIVE];

/** Golden booger: one per player, on a drip between these counted taps (scaled). */
export const GOLDEN_TAPS: readonly [number, number] = [42, 108];

export interface TapLevel {
  readonly durationMs: number;
  /** Kind of the booger of drip #i (i from 0), for i < BOOGER_SEQ_LEN (then it repeats). Never golden or boss. */
  readonly boogers: readonly BoogerKind[];
  /** Index of the drip that is golden instead. */
  readonly goldenDrip: number;
  readonly idleBits: readonly IdleBit[];
  readonly fillers: readonly Filler[];
  readonly alive: readonly Alive[];
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

/** Drip characters: round 40%, googly 25%, hairy 20%, stretchy 15%. */
const DRIP_WEIGHTS: ReadonlyArray<readonly [BoogerKind, number]> = [
  [BOOGER.Round, 40],
  [BOOGER.Googly, 25],
  [BOOGER.Hairy, 20],
  [BOOGER.Stretchy, 15],
];
const DRIP_WEIGHT_SUM = DRIP_WEIGHTS.reduce((s, [, w]) => s + w, 0);

/**
 * `dripEvery` = counted taps per drip (6); `tapScale` scales the golden window.
 */
export function buildLevel(seed: number, durationMs: number, tapScale = 1, dripEvery = 6): TapLevel {
  const dur = Math.max(1000, durationMs);
  const root = createRng(seed);

  // ── drip sequence: weighted, never the same kind twice in a row ──
  const rb = root.fork('boogers');
  const boogers: BoogerKind[] = [];
  for (let i = 0; i < BOOGER_SEQ_LEN; i++) {
    const prev = boogers[i - 1];
    let total = DRIP_WEIGHT_SUM;
    for (const [k, w] of DRIP_WEIGHTS) if (k === prev) total -= w;
    let x = rb.next() * total;
    let kind: BoogerKind = BOOGER.Round;
    for (const [k, w] of DRIP_WEIGHTS) {
      if (k === prev) continue;
      x -= w;
      if (x < 0) {
        kind = k;
        break;
      }
    }
    if (kind === prev) kind = prev === BOOGER.Round ? BOOGER.Googly : BOOGER.Round;
    boogers.push(kind);
  }

  // ── the golden drip: between GOLDEN_TAPS (scaled) counted taps ──
  const rgold = root.fork('golden');
  const lo = Math.max(1, Math.ceil((GOLDEN_TAPS[0] * tapScale) / dripEvery) - 1);
  const hi = Math.max(lo, Math.floor((GOLDEN_TAPS[1] * tapScale) / dripEvery) - 1);
  const goldenDrip = rgold.int(lo, hi);

  // ── waiting bits: seeded rounds of all five (no bit repeats before all five played, and
  // never the same twice in a row across a round boundary) ──
  const ri = root.fork('idle');
  const idleBits: IdleBit[] = [];
  const all: IdleBit[] = [IDLE_BIT.Sneak, IDLE_BIT.Yawn, IDLE_BIT.Knock, IDLE_BIT.Sleep, IDLE_BIT.Peek];
  for (let r = 0; r < 4; r++) {
    const order = ri.shuffle(all);
    if (order[0] === idleBits[idleBits.length - 1]) order.push(order.shift() as IdleBit);
    idleBits.push(...order);
  }

  const fillers = root.fork('fillers').shuffle([FILLER.EyeRoll, FILLER.Wink, FILLER.Sniff]) as Filler[];

  const ra = root.fork('alive');
  const alive: Alive[] = [];
  let prevA = -1;
  for (let i = 0; i < 32; i++) {
    let a = ra.int(0, 2);
    if (prevA >= 0 && a >= prevA) a++;
    alive.push(a as Alive);
    prevA = a;
  }

  const parts: number[] = [dur, goldenDrip, ...boogers.slice(0, 64), ...idleBits, ...fillers, ...alive];
  return { durationMs: dur, boogers, goldenDrip, idleBits, fillers, alive, fingerprint: hash(parts) };
}

/** Kind of the booger of drip #i (the golden drip included). */
export function boogerOf(level: TapLevel, i: number): BoogerKind {
  if (i === level.goldenDrip) return BOOGER.Golden;
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

/** A seeded 0..1 value for (seed, salt, i): fingerprint rotations, digit tilts, sneeze spots. */
export function seeded(seed: number, salt: number, i: number): number {
  return mix(Math.imul((seed | 0) ^ Math.imul(salt + 1, 0x27d4eb2f), 0x85ebca6b) + Math.imul(i + 7, 0xc2b2ae35));
}
