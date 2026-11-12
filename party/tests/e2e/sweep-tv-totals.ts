/**
 * sweep-tv-totals: "two players never stand on the same total" (shared/scoring.ts, rule 3),
 * checked against computeRoundScores directly.
 *
 * 1. The exact round seen on the TV in sweep-tv-evening (1920x1080, competition 2, אייסי שימי,
 *    2026-11-12T14:12Z): one guest at the game's cap (100,000), everyone else at 50..5,945, so the
 *    points of the others are squeezed into 1..119 and must still be strictly decreasing. דנה and
 *    מיכל end on the same total, 187.
 * 2. How often that happens over whole evenings (30 players, 10 rounds), with and without one
 *    guest far ahead of the rest in a round.
 *
 *   npx tsx tests/e2e/sweep-tv-totals.ts
 */
import { computeRoundScores } from '../../shared/scoring';

import type { RoundEntry } from '../../shared/scoring';

// [name, raw, totalBefore] in round order, from tests/e2e/out/sweep-tv-/full-1920x1080/report.json
const SEEN: readonly (readonly [string, number, number])[] = [
  ['נועה', 100000, 0], ['בוט 12', 5945, 610], ['בוט 3', 4615, 1100], ['בוט 24', 4602, 855], ['בוט 8', 4582, 172],
  ['בוט 18', 4521, 913], ['בוט 10', 4248, 614], ['בוט 25', 4175, 434], ['בוט 22', 3983, 652], ['בוט 17', 3852, 621],
  ['בוט 19', 3625, 545], ['בוט 5', 3323, 834], ['בוט 21', 3273, 970], ['בוט 1', 3136, 800], ['בוט 9', 2821, 279],
  ['בוט 23', 2609, 634], ['בוט 20', 2604, 266], ['בוט 14', 2097, 559], ['בוט 11', 2071, 686], ['בוט 15', 1964, 755],
  ['בוט 7', 1584, 745], ['בוט 6', 1275, 238], ['בוט 16', 1162, 283], ['בוט 2', 1073, 717], ['בוט 4', 1047, 214],
  ['Yossi', 328, 186], ['מיכל', 276, 184], ['דנה', 192, 185], ['עדי', 50, 0], ['בוט 13', 0, 0],
];

function dupTotals(entries: readonly RoundEntry[], scored: Map<string, { points: number }>): string[] {
  const totals = new Map<number, string[]>();
  for (const e of entries) {
    const t = (e.totalBefore ?? 0) + (scored.get(e.id)?.points ?? 0);
    if (t <= 0) continue;
    totals.set(t, [...(totals.get(t) ?? []), e.id]);
  }
  return [...totals.entries()].filter(([, ids]) => ids.length > 1).map(([t, ids]) => `${ids.join(' & ')} on ${t}`);
}

// 1. the round from the TV
{
  const entries: RoundEntry[] = SEEN.map(([id, raw, before], i) => ({ id, raw, reachedAt: raw > 0 ? 1_000 + i : null, joinOrder: i, totalBefore: before }));
  const scored = computeRoundScores(entries);
  const dups = dupTotals(entries, scored);
  console.log(`the TV's round: ${dups.length === 0 ? 'no shared totals' : 'SHARED TOTALS: ' + dups.join('; ')}`);
  for (const id of ['Yossi', 'מיכל', 'דנה', 'עדי']) {
    const e = entries.find((x) => x.id === id)!;
    console.log(`   ${id}: raw ${e.raw}, before ${e.totalBefore}, +${scored.get(id)?.points} → ${(e.totalBefore ?? 0) + (scored.get(id)?.points ?? 0)}`);
  }
}

// 2. whole evenings
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function evenings(n: number, outlier: number): { rounds: number; bad: number; evenings: number; badEvenings: number; example: string | null } {
  let rounds = 0;
  let bad = 0;
  let badEvenings = 0;
  let example: string | null = null;
  for (let ev = 0; ev < n; ev++) {
    const rnd = mulberry(ev * 7919 + outlier);
    const totals = new Map<string, number>();
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`);
    for (const id of ids) totals.set(id, 0);
    let evBad = false;
    for (let r = 0; r < 10; r++) {
      const star = outlier > 1 && rnd() < 0.3 ? Math.floor(rnd() * 30) : -1;
      const mult = outlier;
      const entries: RoundEntry[] = ids.map((id, i) => {
        // a typical spread: a few zeros, most players between 10% and 100% of a typical best
        const raw = rnd() < 0.07 ? 0 : Math.round(1_000 * (0.1 + 0.9 * rnd()) * (i === star ? mult : 1));
        return { id, raw, reachedAt: raw > 0 ? Math.floor(rnd() * 60_000) : null, joinOrder: i, totalBefore: totals.get(id) ?? 0 };
      });
      const scored = computeRoundScores(entries);
      for (const e of entries) totals.set(e.id, (totals.get(e.id) ?? 0) + (scored.get(e.id)?.points ?? 0));
      rounds++;
      const dups = dupTotals(entries, scored);
      if (dups.length > 0) {
        bad++;
        evBad = true;
        example ??= `evening ${ev} round ${r + 1}${star >= 0 ? ` (one guest ${mult}x the rest)` : ''}: ${dups.join('; ')}`;
      }
    }
    if (evBad) badEvenings++;
  }
  return { rounds, bad, evenings: n, badEvenings, example };
}

for (const outlier of [1, 20, 50, 100]) {
  const s = evenings(2_000, outlier);
  console.log(
    `${outlier > 1 ? `one guest ${outlier}x the rest in 30% of rounds` : 'ordinary rounds'}: ${s.bad}/${s.rounds} rounds leave two players on one total; ${s.badEvenings}/${s.evenings} evenings have at least one${s.example ? `\n   e.g. ${s.example}` : ''}`,
  );
}
