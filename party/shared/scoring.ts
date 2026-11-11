/**
 * Competition scoring. Pure functions, shared by server (authoritative) and tests.
 *
 * Per round, every player's raw in-game score is scaled against the best raw
 * score of that round to 0..MAX_ROUND_POINTS, and the top three get a small
 * podium bonus. Ties share a rank and a bonus.
 */

export const MAX_ROUND_POINTS = 1000;
export const PODIUM_BONUS: readonly number[] = [100, 60, 30];

export interface RoundScore {
  readonly points: number;
  /** 1-based, competition ranking ("1224"): ties share a rank. */
  readonly roundRank: number;
}

/** Competition ranking over `value` descending. Returns id → 1-based rank. */
export function rankDescending<K>(entries: ReadonlyArray<readonly [K, number]>): Map<K, number> {
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const ranks = new Map<K, number>();
  let rank = 0;
  let prev: number | null = null;
  sorted.forEach(([id, value], i) => {
    if (prev === null || value !== prev) {
      rank = i + 1;
      prev = value;
    }
    ranks.set(id, rank);
  });
  return ranks;
}

/**
 * @param raws playerId → raw score of the round (players who did not play: 0 or absent).
 */
export function computeRoundScores(raws: ReadonlyMap<string, number>): Map<string, RoundScore> {
  const clean: Array<readonly [string, number]> = [...raws].map(([id, raw]) => [
    id,
    Number.isFinite(raw) && raw > 0 ? raw : 0,
  ]);
  const best = clean.reduce((m, [, raw]) => Math.max(m, raw), 0);
  const ranks = rankDescending(clean);
  const out = new Map<string, RoundScore>();
  for (const [id, raw] of clean) {
    const roundRank = ranks.get(id) ?? clean.length;
    if (raw <= 0 || best <= 0) {
      out.set(id, { points: 0, roundRank });
      continue;
    }
    const scaled = Math.round((MAX_ROUND_POINTS * raw) / best);
    const bonus = PODIUM_BONUS[roundRank - 1] ?? 0;
    out.set(id, { points: scaled + bonus, roundRank });
  }
  return out;
}
