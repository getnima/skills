/**
 * The party round on top of the ladder: which start words, in which order, and
 * what a ladder is worth. Pure: the sequence depends only on the round seed
 * (kit rng), so every phone gets the same ladders in the same order.
 */
import { createRng } from '../../kit/rng';
import { TARGET } from './ladder';

import type { Ladder } from './ladder';

// ───────────────────────────── Scoring ─────────────────────────────

/** The scoring table (raw points, higher is better). */
export const SCORE = {
  /** Every solved ladder. */
  solve: 300,
  /** Solved in exactly par steps ("מושלם!"). */
  perfect: 100,
  /** Solved in par + 1 steps. */
  near: 50,
  /** Per hint level used on that ladder. */
  hint: 30,
  /** A solved ladder is never worth less than this. */
  floor: 100,
} as const;

/** Points for a solved ladder: `steps` taken, its `par`, hint levels used. */
export function ladderScore(steps: number, par: number, hints: number): number {
  const bonus = steps <= par ? SCORE.perfect : steps === par + 1 ? SCORE.near : 0;
  return Math.max(SCORE.floor, SCORE.solve + bonus - SCORE.hint * Math.max(0, hints));
}

// ───────────────────────────── Sequence ─────────────────────────────

/** Words of the first-puzzle demo (חלום → חלוץ): never a start word, it would give the answer away. */
export const DEMO_WORDS: readonly string[] = ['חלומ', 'חלוצ'];
/** Par-2 starts come from the common list: only the clearly common ones (the curated starts go to rank 3369). */
const PAR2_MAX_RANK = 3400;
const MAX_PAR = 5;

/** Allowed pars for the puzzle at `index` (0-based): 2, then 2-3, then 3-4, later 4-5. */
export function parBand(index: number): readonly number[] {
  if (index <= 0) return [2];
  if (index === 1) return [2, 3];
  if (index <= 5) return [3, 4];
  return [4, 5];
}

/**
 * Start words by par. Every candidate has a path through common words that is
 * as short as the true minimum (CDIST = DIST), so "מושלם" never needs an obscure
 * word: par 3-5 = the original's curated starts, par 2 = common words.
 */
export function startPools(ladder: Ladder): Map<number, string[]> {
  const pools = new Map<number, string[]>();
  const add = (w: string): void => {
    const d = ladder.dist(w);
    if (d === undefined || d < 2 || d > MAX_PAR || ladder.cdist(w) !== d || w === TARGET || DEMO_WORDS.includes(w)) return;
    const list = pools.get(d) ?? [];
    if (!list.includes(w)) list.push(w);
    pools.set(d, list);
  };
  for (const w of ladder.starts) if (ladder.dist(w) !== 2) add(w);
  for (const w of ladder.common) if (ladder.dist(w) === 2 && ladder.rank(w) <= PAR2_MAX_RANK) add(w);
  return pools;
}

const cache = new Map<number, readonly string[]>();

/**
 * Every start word of the round with `seed`, in play order (normalized), no
 * repeats. Puzzle i draws a par from parBand(i), then a word of that par; when
 * a par runs out the nearest par that still has words is used.
 */
export function roundSequence(seed: number, ladder: Ladder): readonly string[] {
  const hit = cache.get(seed);
  if (hit) return hit;
  const rng = createRng(seed).fork('plotzel-sequence');
  const pools = startPools(ladder);
  const pars = [...pools.keys()].sort((a, b) => a - b);
  const queues = new Map<number, string[]>();
  for (const p of pars) queues.set(p, rng.shuffle(pools.get(p) ?? []));
  let left = 0;
  for (const q of queues.values()) left += q.length;
  const out: string[] = [];
  for (let i = 0; left > 0; i++) {
    const band = parBand(i);
    let par = band[rng.int(0, band.length - 1)] ?? 2;
    if ((queues.get(par)?.length ?? 0) === 0) {
      const inBand = band.find((p) => (queues.get(p)?.length ?? 0) > 0);
      const nearest = [...pars]
        .filter((p) => (queues.get(p)?.length ?? 0) > 0)
        .sort((a, b) => Math.abs(a - par) - Math.abs(b - par) || b - a)[0];
      par = inBand ?? nearest ?? par;
    }
    const w = queues.get(par)?.shift();
    if (w === undefined) break;
    out.push(w);
    left--;
  }
  cache.set(seed, out);
  return out;
}
