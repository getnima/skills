/**
 * The party round on top of the ladder: which start words, in which order, and
 * what a ladder is worth. Pure: the sequence depends only on the round seed
 * (kit rng), so every phone gets the same ladders in the same order.
 */
import { createRng } from '../../kit/rng';
import { HEB, TARGET } from './ladder';

import type { Ladder } from './ladder';

// ───────────────────────────── Scoring ─────────────────────────────

/**
 * The scoring table (raw points, higher is better). The owner's rule: the score of a ladder is
 * 80% time and 20% attempts (attempts = the steps taken, against the minimum). No hints.
 */
export const SCORE = {
  /** The most a solved ladder is worth. */
  ladder: 1000,
  /** The part of it for speed. */
  timeShare: 0.8,
  /** The part of it for the number of steps. */
  stepsShare: 0.2,
  /** The speed part runs down to nothing over this much time for every step of par. */
  msPerParStep: 15_000,
} as const;

/** The speed part of a ladder solved after `elapsedMs`: 1 at once, 0 after par x msPerParStep. */
export function speedFactor(par: number, elapsedMs: number): number {
  const allowance = Math.max(1, par) * SCORE.msPerParStep;
  return Math.min(1, Math.max(0, 1 - Math.max(0, elapsedMs) / allowance));
}

/** The steps part: 1 for the minimum (`par`), then par / steps. */
export function stepsFactor(steps: number, par: number): number {
  return steps <= par ? 1 : Math.max(1, par) / steps;
}

/**
 * Points for a ladder solved in `steps` steps (its minimum is `par`) after `elapsedMs` on it:
 * ladder x (80% speed + 20% steps), never less than 1.
 */
export function ladderScore(steps: number, par: number, elapsedMs: number): number {
  const part = SCORE.timeShare * speedFactor(par, elapsedMs) + SCORE.stepsShare * stepsFactor(steps, par);
  return Math.max(1, Math.round(SCORE.ladder * part));
}

// ───────────────────────────── Sequence ─────────────────────────────

/**
 * The owner's openers, in this order, at the start of every round (normalized: no final letters).
 * פוקי is not in the dictionary: it starts a ladder anyway (the first step must be a real word),
 * see startPar / startPath. The seeded puzzles after them start again from the easy end
 * (parBand(0) is the first puzzle after the openers).
 */
export const OPENERS: readonly string[] = ['חמוד', 'פוקי', 'נדיר', 'שימי'];
/**
 * Easy words between the openers (the owner's call, 13.11: two easy words in between, פוקי stays):
 * EASY_AFTER[i] par-2 words, drawn by the round's seed, follow OPENERS[i]. So a round opens
 * חמוד, an easy word, פוקי, an easy word, נדיר, שימי: a breather on each side of the hardest one.
 */
export const EASY_AFTER: readonly number[] = [1, 1, 0, 0];
/** How many puzzles the opening takes: the openers and the easy words between them. */
export const OPENING_LENGTH = OPENERS.length + EASY_AFTER.reduce((a, b) => a + b, 0);

/** Dictionary words one letter away from `w` (for a start word that is not in the dictionary). */
function wordsOneAway(ladder: Ladder, w: string): string[] {
  const out: string[] = [];
  for (let p = 0; p < w.length; p++) {
    for (const ch of HEB) {
      if (ch === w[p]) continue;
      const c = w.slice(0, p) + ch + w.slice(p + 1);
      if (ladder.has(c) && ladder.dist(c) !== undefined) out.push(c);
    }
  }
  return out;
}

/** The first word of the shortest way out of a start word that is not in the dictionary (common words first). */
function bestStep(ladder: Ladder, w: string): string | null {
  let best: string | null = null;
  for (const c of wordsOneAway(ladder, w)) {
    if (best === null) {
      best = c;
      continue;
    }
    const dc = ladder.dist(c) ?? Infinity;
    const db = ladder.dist(best) ?? Infinity;
    if (dc < db || (dc === db && ladder.rank(c) < ladder.rank(best))) best = c;
  }
  return best;
}

/** Par of a start word: the dictionary distance, or one more than its best neighbour's for a word outside it. */
export function startPar(ladder: Ladder, w: string): number | undefined {
  const d = ladder.dist(w);
  if (d !== undefined) return d;
  const n = bestStep(ladder, w);
  const dn = n !== null ? ladder.dist(n) : undefined;
  return dn !== undefined ? dn + 1 : undefined;
}

/** The shortest path from a start word to the goal, both included (works for a word outside the dictionary). */
export function startPath(ladder: Ladder, w: string): string[] {
  if (ladder.has(w)) return ladder.shortestPath(w);
  const n = bestStep(ladder, w);
  return n !== null ? [w, ...ladder.shortestPath(n)] : [w];
}

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
    if (d === undefined || d < 2 || d > MAX_PAR || ladder.cdist(w) !== d || w === TARGET || OPENERS.includes(w) || DEMO_WORDS.includes(w)) return;
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
 * repeats. It always opens with OPENERS, in order, with easy words between them (EASY_AFTER). After
 * that opening, puzzle i of the seeded part draws a par from
 * parBand(i), then a word of that par; when a par runs out the nearest par that
 * still has words is used.
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
  OPENERS.forEach((w, i) => {
    if (startPar(ladder, w) === undefined) return;
    out.push(w);
    for (let k = 0; k < (EASY_AFTER[i] ?? 0); k++) {
      const easy = queues.get(2)?.shift();
      if (easy === undefined) break;
      out.push(easy);
      left--;
    }
  });
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
