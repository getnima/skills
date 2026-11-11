/**
 * Seeded deterministic RNG (mulberry32). Every phone gets the same round seed,
 * so the same calls in the same order give the same level everywhere.
 * Never use Math.random() for anything that affects gameplay.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Random element (throws on an empty array). */
  pick<T>(items: readonly T[]): T;
  /** True with probability `p` (0..1). */
  chance(p: number): boolean;
  /** New shuffled array; the input is not modified. */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * Independent stream derived from the ORIGINAL seed and the label, no matter
   * how many numbers were already drawn: use one per concern
   * (rng.fork('level'), rng.fork('fx')) so they cannot disturb each other.
   */
  fork(label: string): Rng;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mix(a: number): number {
  let x = a | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export function createRng(seed: number): Rng {
  const seed0 = mix(Math.floor(seed) | 0);
  let a = seed0;

  function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const rng: Rng = {
    next,
    float: (min: number, max: number): number => min + next() * (max - min),
    int: (min: number, max: number): number => Math.floor(min + next() * (max - min + 1)),
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
    chance: (p: number): boolean => next() < p,
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
    fork: (label: string): Rng => createRng(seed0 ^ hashString(label)),
  };
  return rng;
}
