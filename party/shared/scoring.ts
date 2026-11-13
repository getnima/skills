/**
 * Competition scoring. Pure functions, shared by server (authoritative) and tests.
 *
 * There are no ties, anywhere:
 *
 * 1. Round order (strict). Raw score descending; on the same raw score whoever
 *    REACHED it first is ahead (`reachedAt`, server time of the last change to
 *    the final raw score); on the same millisecond, whoever joined the party
 *    first. Players who scored nothing (raw <= 0) come after every scorer, by
 *    join order, and get 0 points.
 * 2. Round points. Scaled against the best raw score of the round to
 *    0..MAX_ROUND_POINTS, plus a podium bonus for the first three places of the
 *    strict order. Walking down the strict order every scorer gets at least one
 *    point less than the scorer above (and never less than 1), so no two
 *    scorers get the same points in a round. In a last-one-standing game (flappy) the
 *    winner outlasts the runner-up by a moment only (the round ends when one is left), so
 *    the raw scores say almost nothing about it: the winner gets LAST_STANDING_BONUS on top.
 * 3. Totals. When the totals before the round are given, a scorer whose new
 *    total would land exactly on somebody else's total gets one point less (or
 *    as many as it takes), so two players never stand on the same total unless
 *    neither has ever scored. When every number between the scorer above and
 *    the room the scorers below need is taken (a runaway leader squeezes the
 *    rest down to a few points each), the scorer climbs to the first free total
 *    above and the scorers above it move up just as far as the order needs.
 * 4. Overall rank (strict): total, then round wins, then best single round,
 *    then position in the most recent round, then join order.
 */

export const MAX_ROUND_POINTS = 1000;
export const PODIUM_BONUS: readonly number[] = [100, 60, 30];
/**
 * A last-one-standing round (GameMeta.mode 'elimination'): what its winner gets on top of the
 * round's points, when it outlasted at least one other scorer (the owner, 13.11: "the last one
 * stays alive gets a nice portion of points, not just 1 more").
 */
export const LAST_STANDING_BONUS = 300;

export interface RoundScoring {
  /** The round is a last-one-standing game: its winner gets LAST_STANDING_BONUS (rule 2). */
  readonly lastStanding?: boolean;
}

export interface RoundEntry {
  readonly id: string;
  /** Raw in-game score of the round (did not play: 0). */
  readonly raw: number;
  /** Server ms at which `raw` was reached; null for a player who scored nothing. */
  readonly reachedAt: number | null;
  /** Smaller = joined the party earlier. Unique per player. */
  readonly joinOrder: number;
  /** Cumulative points before this round. When given, new totals are kept distinct (rule 3). */
  readonly totalBefore?: number;
}

export interface RoundScore {
  readonly points: number;
  /** 1-based strict position in the round: 1..n, no repeats (scorers first). */
  readonly roundRank: number;
}

function cleanRaw(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** The strict order of a round (rule 1): scorers first, best first. */
export function orderRound<E extends RoundEntry>(entries: readonly E[]): E[] {
  return [...entries].sort((a, b) => {
    const ra = cleanRaw(a.raw);
    const rb = cleanRaw(b.raw);
    if (ra !== rb) return rb - ra;
    if (ra > 0) {
      const ta = a.reachedAt ?? Number.POSITIVE_INFINITY;
      const tb = b.reachedAt ?? Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta < tb ? -1 : 1;
    }
    return a.joinOrder - b.joinOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** Points and strict position of every entry of one round (rules 1-3). */
export function computeRoundScores(entries: readonly RoundEntry[], scoring: RoundScoring = {}): Map<string, RoundScore> {
  const order = orderRound(entries);
  const scorers = order.filter((e) => cleanRaw(e.raw) > 0);
  const best = scorers.length > 0 ? cleanRaw(scorers[0]!.raw) : 0;
  const winnerBonus = scoring.lastStanding === true && scorers.length >= 2 ? LAST_STANDING_BONUS : 0;

  // Totals that are already taken: players who score nothing keep theirs.
  const taken = new Set<number>();
  for (const e of order) {
    if (cleanRaw(e.raw) <= 0 && e.totalBefore !== undefined) taken.add(e.totalBefore);
  }
  const isFree = (e: RoundEntry, p: number): boolean => e.totalBefore === undefined || !taken.has(e.totalBefore + p);
  const take = (e: RoundEntry, p: number): void => {
    if (e.totalBefore !== undefined) taken.add(e.totalBefore + p);
  };

  /** Points of the scorers, in the strict order (a later scorer may still move the ones above it up). */
  const pts: number[] = [];
  scorers.forEach((e, i) => {
    // Enough room below for every remaining scorer to get a different, positive number.
    const floor = scorers.length - i;
    const target = Math.round((MAX_ROUND_POINTS * cleanRaw(e.raw)) / best) + (PODIUM_BONUS[i] ?? 0) + (i === 0 ? winnerBonus : 0);
    const ceil = i === 0 ? Number.POSITIVE_INFINITY : pts[i - 1]! - 1;
    let points = Math.min(ceil, Math.max(target, floor));
    if (!isFree(e, points)) {
      let free: number | null = null;
      for (let p = points - 1; p >= floor && free === null; p--) if (isFree(e, p)) free = p;
      for (let p = points + 1; p <= ceil && p <= points + scorers.length && free === null; p++) if (isFree(e, p)) free = p;
      if (free !== null) {
        points = free;
      } else {
        // Every total in reach is taken: climb past the scorer above to the first free total,
        // then move the scorers above up, each to its first free total over the one below it.
        // The leader has no ceiling, so this always ends.
        points = Number.isFinite(ceil) ? ceil + 1 : points + 1;
        while (!isFree(e, points)) points++;
      }
    }
    pts.push(points);
    take(e, points);
    for (let j = i - 1; j >= 0 && pts[j]! <= pts[j + 1]!; j--) {
      const up = scorers[j]!;
      if (up.totalBefore !== undefined) taken.delete(up.totalBefore + pts[j]!);
      let q = pts[j + 1]! + 1;
      while (!isFree(up, q)) q++;
      pts[j] = q;
      take(up, q);
    }
  });

  const out = new Map<string, RoundScore>();
  order.forEach((e, i) => out.set(e.id, { points: i < scorers.length ? pts[i]! : 0, roundRank: i + 1 }));
  return out;
}

export interface StandingEntry {
  readonly id: string;
  readonly total: number;
  /** Rounds won so far. */
  readonly wins: number;
  /** Best points in a single round so far. */
  readonly best: number;
  /** Strict position in the most recent round; null before the first round or for someone who was not there. */
  readonly lastPos: number | null;
  readonly joinOrder: number;
}

/** Ids in strict overall order (rule 4), leader first. */
export function orderOverall(entries: readonly StandingEntry[]): string[] {
  return [...entries]
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.wins - a.wins ||
        b.best - a.best ||
        (a.lastPos ?? Number.MAX_SAFE_INTEGER) - (b.lastPos ?? Number.MAX_SAFE_INTEGER) ||
        a.joinOrder - b.joinOrder ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((e) => e.id);
}

/** id → strict overall rank, 1..n with no repeats. */
export function rankOverall(entries: readonly StandingEntry[]): Map<string, number> {
  const ranks = new Map<string, number>();
  orderOverall(entries).forEach((id, i) => ranks.set(id, i + 1));
  return ranks;
}
