/**
 * The show of "שימי טאפ" that does not depend on the player: the order of the waiting bits,
 * the slow-player lines and the final-frame gags. All of it is computed up front from the seed
 * and the round length only, so every phone in the room gets exactly the same sequence (the
 * player only decides how far into it they get). Pure: no DOM, no Math.random, no clock.
 */
import { createRng } from '../../kit/rng';

/** The waiting bits: the sneak, the yawn, the knock on the glass, dozing off. */
export const IDLE_BIT = { Sneak: 0, Yawn: 1, Knock: 2, Sleep: 3 } as const satisfies Record<string, number>;
export const IDLE_BITS = 4;
export type IdleBit = (typeof IDLE_BIT)[keyof typeof IDLE_BIT];

/** Slow-player lines, each at most once per round (index into the game's filler lines). */
export const FILLER = { Spa: 0, Icon: 1, Friday: 2 } as const satisfies Record<string, number>;
export type Filler = (typeof FILLER)[keyof typeof FILLER];

/** Small gags of the final frame (one every 2 s): a nod, a little dig (the finger wiggles), a bounce. */
export const ALIVE = { Nod: 0, Wiggle: 1, Bob: 2 } as const satisfies Record<string, number>;
export type Alive = (typeof ALIVE)[keyof typeof ALIVE];

export interface TapLevel {
  readonly durationMs: number;
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

export function buildLevel(seed: number, durationMs: number): TapLevel {
  const dur = Math.max(1000, durationMs);
  const root = createRng(seed);

  // ── waiting bits: seeded rounds of all four (no bit repeats before all four played, and
  // never the same twice in a row across a round boundary) ──
  const ri = root.fork('idle');
  const idleBits: IdleBit[] = [];
  const all: IdleBit[] = [IDLE_BIT.Sneak, IDLE_BIT.Yawn, IDLE_BIT.Knock, IDLE_BIT.Sleep];
  for (let r = 0; r < 5; r++) {
    const order = ri.shuffle(all);
    if (order[0] === idleBits[idleBits.length - 1]) order.push(order.shift() as IdleBit);
    idleBits.push(...order);
  }

  const fillers = root.fork('fillers').shuffle([FILLER.Spa, FILLER.Icon, FILLER.Friday]) as Filler[];

  const ra = root.fork('alive');
  const alive: Alive[] = [];
  let prevA = -1;
  for (let i = 0; i < 32; i++) {
    let a = ra.int(0, 1);
    if (prevA >= 0 && a >= prevA) a++;
    alive.push(a as Alive);
    prevA = a;
  }

  const parts: number[] = [dur, ...idleBits, ...fillers, ...alive];
  return { durationMs: dur, idleBits, fillers, alive, fingerprint: hash(parts) };
}

function mix(a: number): number {
  let t = a >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A seeded 0..1 value for (seed, salt, i): fingerprint rotations and the like. */
export function seeded(seed: number, salt: number, i: number): number {
  return mix(Math.imul((seed | 0) ^ Math.imul(salt + 1, 0x27d4eb2f), 0x85ebca6b) + Math.imul(i + 7, 0xc2b2ae35));
}
