/**
 * Which picture each throw of נינג׳ה תבורי wears. LOOKS ONLY.
 *
 * The schedule (waves.ts) decides what is thrown, when and where; nothing here is read by
 * the rules. A throw's picture is derived from the finished schedule alone (its order and
 * launch times), so every phone shows the same food on the same throw, and a phone that
 * joins late (and skips throws) still agrees with the others. The schedule's own rng is
 * never touched: this file has its own little generator, seeded from the schedule.
 *
 * - An ordinary target ('fruit' in the schedule) is one of the 11 foods, dealt from a
 *   shuffled bag of all 11 (then a new bag, never opening with the food just shown): no
 *   food comes twice before every other has come once.
 * - Now and then (about one in JOKE_EVERY) it is a joke item instead: the plastic chair or
 *   the flip-flop, taking turns. Same points, same hit circle: a joke for the eyes only.
 * - Bombs take turns between the two hosts: A, B, A, B (which host opens depends on the
 *   schedule, so neither is always first).
 * - The golden target has one look (the gold falafel trophy).
 */
import type { Throw } from './waves';

/** The food targets, in the order of client/public/assets/ninja/food/README.md. */
export const FOOD_KEYS = ['shawarma', 'hummus', 'sabich', 'falafel', 'bourekas', 'shakshuka', 'schnitzel', 'sufganiya', 'pickle', 'limonana', 'peanut_puffs'] as const;
/** The joke items (rare ordinary targets). */
export const JOKE_KEYS = ['garden_chair', 'flip_flop'] as const;
/** Skin index of an ordinary target: 0..FOOD_KEYS.length - 1 = food, then the joke items. */
export const TARGET_KEYS = [...FOOD_KEYS, ...JOKE_KEYS] as const;
export type TargetKey = (typeof TARGET_KEYS)[number];
/** The two host bombs; skin index of a bomb. */
export const BOMB_KEYS = ['bomb_host_a', 'bomb_host_b'] as const;

/** One joke item in every this many ordinary targets. */
export const JOKE_EVERY = 16;
/** The first ordinary targets of a round are always food. */
export const JOKE_FREE_START = 6;

/**
 * The skin of every throw of `schedule`, by its index: an index into TARGET_KEYS for an
 * ordinary target, into BOMB_KEYS for a bomb, 0 for the golden one. Pure and looks only: the
 * schedule is not changed and no shared rng is used.
 */
export function buildSkins(schedule: readonly Throw[]): Uint8Array {
  // own generator (mulberry32), seeded from the schedule itself
  let seed = 2166136261;
  for (const th of schedule) {
    seed = Math.imul(seed ^ th.atMs, 16777619);
    seed = Math.imul(seed ^ (th.variant + 31 * Math.round(th.x * 10000)), 16777619);
  }
  let a = seed >>> 0;
  const rnd = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n: number): number => Math.min(n - 1, Math.floor(rnd() * n));

  const foods = FOOD_KEYS.length;
  const bag = new Uint8Array(foods);
  let left = 0;
  let last = -1;
  /** Next food of the bag; a new bag never opens with the food the last one closed with. */
  const deal = (): number => {
    if (left === 0) {
      for (let i = 0; i < foods; i++) bag[i] = i;
      for (let i = foods - 1; i > 0; i--) {
        const j = below(i + 1);
        const t = bag[i] ?? 0;
        bag[i] = bag[j] ?? 0;
        bag[j] = t;
      }
      if (bag[foods - 1] === last) {
        const j = below(foods - 1);
        const t = bag[foods - 1] ?? 0;
        bag[foods - 1] = bag[j] ?? 0;
        bag[j] = t;
      }
      left = foods;
    }
    left--;
    last = bag[left] ?? 0;
    return last;
  };

  const out = new Uint8Array(schedule.length);
  let bombTurn = below(BOMB_KEYS.length);
  let jokeTurn = below(JOKE_KEYS.length);
  let ordinary = 0;
  let jokeBlock = -1;
  let jokeAt = -1;
  for (let i = 0; i < schedule.length; i++) {
    const kind = schedule[i]?.kind;
    if (kind === 'bomb') {
      out[i] = bombTurn;
      bombTurn = (bombTurn + 1) % BOMB_KEYS.length;
    } else if (kind === 'fruit') {
      const n = ordinary++;
      const block = n < JOKE_FREE_START ? -1 : Math.floor((n - JOKE_FREE_START) / JOKE_EVERY);
      if (block !== jokeBlock) {
        jokeBlock = block;
        // not at a block's edges: two joke items never come back to back
        jokeAt = JOKE_FREE_START + block * JOKE_EVERY + 2 + below(JOKE_EVERY - 4);
      }
      if (block >= 0 && n === jokeAt) {
        out[i] = foods + jokeTurn;
        jokeTurn = (jokeTurn + 1) % JOKE_KEYS.length;
      } else {
        out[i] = deal();
      }
    }
  }
  return out;
}
