import { describe, expect, it } from 'vitest';

import { computeRoundScores, LAST_STANDING_BONUS, MAX_ROUND_POINTS, orderOverall, orderRound, PODIUM_BONUS, rankOverall } from '../../shared/scoring';

import type { RoundEntry, StandingEntry } from '../../shared/scoring';

/** [id, raw, reachedAt?] in join order. Without a time, everybody reached their score at ms 1000. */
function entries(list: Array<[string, number, (number | null)?]>): RoundEntry[] {
  return list.map(([id, raw, at], joinOrder) => ({ id, raw, reachedAt: at === undefined ? 1000 : at, joinOrder }));
}

function scores(list: Array<[string, number, (number | null)?]>): Map<string, { points: number; roundRank: number }> {
  return computeRoundScores(entries(list));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('orderRound', () => {
  it('orders by raw descending, then by who reached the score first, then by join order', () => {
    const order = orderRound(
      entries([
        ['late', 6, 5000],
        ['low', 3, 100],
        ['early', 6, 2000],
        ['sameMsFirstJoin', 4, 700],
        ['sameMsSecondJoin', 4, 700],
        ['zeroA', 0, null],
        ['zeroB', 0, 50],
      ]),
    ).map((e) => e.id);
    expect(order).toEqual(['early', 'late', 'sameMsFirstJoin', 'sameMsSecondJoin', 'low', 'zeroA', 'zeroB']);
  });

  it('puts a scorer without a time after the ones who have one, and never looks at times of zeros', () => {
    const order = orderRound(
      entries([
        ['noTime', 5, null],
        ['timed', 5, 9999],
        ['z1', 0, 900],
        ['z2', 0, 100],
      ]),
    ).map((e) => e.id);
    expect(order).toEqual(['timed', 'noTime', 'z1', 'z2']);
  });

  it('does not depend on the order of the input', () => {
    const list = entries([
      ['a', 6, 30],
      ['b', 6, 10],
      ['c', 6, 20],
      ['d', 0, null],
      ['e', 2, 5],
    ]);
    const want = ['b', 'c', 'a', 'e', 'd'];
    expect(orderRound(list).map((e) => e.id)).toEqual(want);
    expect(orderRound([...list].reverse()).map((e) => e.id)).toEqual(want);
  });
});

describe('computeRoundScores', () => {
  it('scales against the best raw score and adds the podium bonus', () => {
    const s = scores([
      ['a', 200],
      ['b', 100],
      ['c', 50],
      ['d', 20],
    ]);
    expect(s.get('a')).toEqual({ points: MAX_ROUND_POINTS + PODIUM_BONUS[0]!, roundRank: 1 });
    expect(s.get('b')).toEqual({ points: 500 + PODIUM_BONUS[1]!, roundRank: 2 });
    expect(s.get('c')).toEqual({ points: 250 + PODIUM_BONUS[2]!, roundRank: 3 });
    expect(s.get('d')).toEqual({ points: 100, roundRank: 4 });
  });

  it('two players on the same raw: the one who got there first wins, and they get different points', () => {
    const s = scores([
      ['a', 80, 9000],
      ['b', 80, 4000],
      ['c', 40, 100],
    ]);
    expect(s.get('b')).toEqual({ points: 1100, roundRank: 1 });
    expect(s.get('a')).toEqual({ points: 1060, roundRank: 2 });
    expect(s.get('c')).toEqual({ points: 500 + PODIUM_BONUS[2]!, roundRank: 3 });
  });

  it('three on the same raw get the three podium bonuses in the order they got there', () => {
    const s = scores([
      ['a', 6, 300],
      ['b', 6, 100],
      ['c', 6, 200],
    ]);
    expect(s.get('b')).toEqual({ points: 1100, roundRank: 1 });
    expect(s.get('c')).toEqual({ points: 1060, roundRank: 2 });
    expect(s.get('a')).toEqual({ points: 1030, roundRank: 3 });
  });

  it('everyone on the same raw (the four phones on flappy 6): one first place, all points differ by at least 1', () => {
    const s = scores([
      ['a', 6, 40],
      ['b', 6, 10],
      ['c', 6, 30],
      ['d', 6, 20],
      ['e', 6, 50],
      ['f', 6, 60],
    ]);
    expect(['b', 'd', 'c', 'a', 'e', 'f'].map((id) => s.get(id))).toEqual([
      { points: 1100, roundRank: 1 },
      { points: 1060, roundRank: 2 },
      { points: 1030, roundRank: 3 },
      { points: 1000, roundRank: 4 },
      { points: 999, roundRank: 5 },
      { points: 998, roundRank: 6 },
    ]);
  });

  it('a last-one-standing round: the winner gets the bonus on top, everyone else scores as in any round', () => {
    const list = entries([
      ['a', 300, 10],
      ['b', 290, 20],
      ['c', 150, 30],
      ['d', 0, 0],
    ]);
    const plain = computeRoundScores(list);
    const last = computeRoundScores(list, { lastStanding: true });
    expect(LAST_STANDING_BONUS).toBe(300);
    // without it the survivor is 73 points ahead of the one it outlasted by a moment
    expect(plain.get('a')!.points - plain.get('b')!.points).toBe(73);
    expect(last.get('a')).toEqual({ points: MAX_ROUND_POINTS + PODIUM_BONUS[0]! + LAST_STANDING_BONUS, roundRank: 1 });
    for (const id of ['b', 'c', 'd']) expect(last.get(id)).toEqual(plain.get(id));
  });

  it('a last-one-standing round with one scorer (nobody to outlast) has no bonus, and totals stay distinct with it', () => {
    const solo = computeRoundScores(entries([['a', 120, 10], ['b', 0, 0]]), { lastStanding: true });
    expect(solo.get('a')).toEqual({ points: MAX_ROUND_POINTS + PODIUM_BONUS[0]!, roundRank: 1 });
    // the winner's new total would land exactly on c's (who scored nothing): one point less, as everywhere
    const s = computeRoundScores(
      [
        { id: 'a', raw: 50, reachedAt: 10, joinOrder: 0, totalBefore: 0 },
        { id: 'b', raw: 40, reachedAt: 20, joinOrder: 1, totalBefore: 0 },
        { id: 'c', raw: 0, reachedAt: null, joinOrder: 2, totalBefore: MAX_ROUND_POINTS + PODIUM_BONUS[0]! + LAST_STANDING_BONUS },
      ],
      { lastStanding: true },
    );
    expect(s.get('a')!.points).toBe(MAX_ROUND_POINTS + PODIUM_BONUS[0]! + LAST_STANDING_BONUS - 1);
    expect(s.get('b')!.points).toBe(800 + PODIUM_BONUS[1]!);
  });

  it('same raw in the same millisecond: join order decides', () => {
    const s = scores([
      ['first', 6, 500],
      ['second', 6, 500],
      ['third', 6, 500],
      ['fourth', 6, 500],
      ['fifth', 6, 500],
    ]);
    expect(['first', 'second', 'third', 'fourth', 'fifth'].map((id) => s.get(id)?.roundRank)).toEqual([1, 2, 3, 4, 5]);
    expect(['first', 'second', 'third', 'fourth', 'fifth'].map((id) => s.get(id)?.points)).toEqual([1100, 1060, 1030, 1000, 999]);
  });

  it('a tie below the podium costs the later one a single point and pushes down only as far as needed', () => {
    const s = scores([
      ['a', 100],
      ['b', 90],
      ['c', 80],
      ['d1', 70, 10],
      ['d2', 70, 20],
      ['d3', 70, 30],
      ['e', 60],
    ]);
    expect(['d1', 'd2', 'd3', 'e'].map((id) => s.get(id))).toEqual([
      { points: 700, roundRank: 4 },
      { points: 699, roundRank: 5 },
      { points: 698, roundRank: 6 },
      { points: 600, roundRank: 7 },
    ]);
  });

  it('different raw scores that round to the same points still get different points', () => {
    // 4000 and 3999 of 5000 both scale to 800.
    const s = scores([
      ['top', 5000],
      ['x', 4999],
      ['y', 4998],
      ['p', 4000],
      ['q', 3999],
    ]);
    expect(s.get('p')?.points).toBe(800);
    expect(s.get('q')?.points).toBe(799);
  });

  it('never gives a scorer less than 1 point, and tiny scores still differ', () => {
    const s = scores([
      ['big', 5000],
      ['t1', 2, 10],
      ['t2', 1, 10],
      ['t3', 1, 20],
      ['t4', 1, 30],
      ['zero', 0, null],
    ]);
    expect(s.get('big')?.points).toBe(1100);
    const tiny = ['t1', 't2', 't3', 't4'].map((id) => s.get(id)?.points ?? -1);
    expect(tiny.every((p) => p >= 1)).toBe(true);
    expect(new Set(tiny).size).toBe(4);
    expect([...tiny].sort((a, b) => b - a)).toEqual(tiny);
    expect(s.get('zero')).toEqual({ points: 0, roundRank: 6 });
  });

  it('gives zero points (and no bonus) for a zero score', () => {
    const s = scores([
      ['a', 10],
      ['b', 0, null],
    ]);
    expect(s.get('a')?.points).toBe(1100);
    expect(s.get('b')).toEqual({ points: 0, roundRank: 2 });
  });

  it('gives nobody points when everyone scored zero; positions follow join order', () => {
    const s = scores([
      ['a', 0, null],
      ['b', 0, null],
      ['c', 0, null],
    ]);
    expect(s.get('a')).toEqual({ points: 0, roundRank: 1 });
    expect(s.get('b')).toEqual({ points: 0, roundRank: 2 });
    expect(s.get('c')).toEqual({ points: 0, roundRank: 3 });
  });

  it('treats NaN, infinities and negative scores as zero', () => {
    const s = scores([
      ['nan', Number.NaN],
      ['neg', -50],
      ['inf', Number.POSITIVE_INFINITY],
      ['ok', 10],
    ]);
    expect(s.get('ok')).toEqual({ points: 1100, roundRank: 1 });
    expect(['nan', 'neg', 'inf'].map((id) => s.get(id))).toEqual([
      { points: 0, roundRank: 2 },
      { points: 0, roundRank: 3 },
      { points: 0, roundRank: 4 },
    ]);
  });

  it('gives a single player the full score', () => {
    expect(scores([['solo', 3]]).get('solo')).toEqual({ points: 1100, roundRank: 1 });
    expect(scores([['solo', 0, null]]).get('solo')).toEqual({ points: 0, roundRank: 1 });
  });

  it('gives no bonus below third place', () => {
    const s = scores([
      ['a', 100],
      ['b', 90],
      ['c', 80],
      ['d', 70],
      ['e', 60],
    ]);
    expect(s.get('d')).toEqual({ points: 700, roundRank: 4 });
    expect(s.get('e')).toEqual({ points: 600, roundRank: 5 });
  });

  it('returns an empty map for an empty round', () => {
    expect(scores([]).size).toBe(0);
  });

  it('keeps new totals distinct: a scorer who would land on a taken total gets one point less', () => {
    // b would get 560 → 1060 + 560 = 1620, exactly the total c keeps (c scores nothing).
    const s = computeRoundScores([
      { id: 'a', raw: 100, reachedAt: 1, joinOrder: 0, totalBefore: 0 },
      { id: 'b', raw: 50, reachedAt: 2, joinOrder: 1, totalBefore: 1060 },
      { id: 'c', raw: 0, reachedAt: null, joinOrder: 2, totalBefore: 1620 },
    ]);
    expect(s.get('a')?.points).toBe(1100);
    expect(s.get('b')?.points).toBe(559);
    expect(s.get('c')?.points).toBe(0);
  });

  it('A: 1100 + 560 and B: 560 + 1100 do not end on the same total', () => {
    const r2 = computeRoundScores([
      { id: 'a', raw: 50, reachedAt: 2, joinOrder: 0, totalBefore: 1100 },
      { id: 'b', raw: 100, reachedAt: 1, joinOrder: 1, totalBefore: 560 },
    ]);
    expect(r2.get('b')).toEqual({ points: 1100, roundRank: 1 });
    expect(r2.get('a')).toEqual({ points: 559, roundRank: 2 });
  });

  it('two players with identical raw scores in every round end on different totals', () => {
    const total = { a: 0, b: 0 };
    for (let round = 0; round < 5; round++) {
      // a is first in rounds 0, 2, 4 and b in rounds 1, 3: without the distinct-totals step
      // the bonuses could only cancel out over an even number of rounds; check every prefix.
      const s = computeRoundScores([
        { id: 'a', raw: 6, reachedAt: round % 2 === 0 ? 10 : 20, joinOrder: 0, totalBefore: total.a },
        { id: 'b', raw: 6, reachedAt: round % 2 === 0 ? 20 : 10, joinOrder: 1, totalBefore: total.b },
      ]);
      expect(s.get('a')?.points).not.toBe(s.get('b')?.points);
      total.a += s.get('a')?.points ?? 0;
      total.b += s.get('b')?.points ?? 0;
      expect(total.a).not.toBe(total.b);
    }
  });

  it('property: 2000 random rounds with heavy raw collisions (0..6, 2-60 players)', () => {
    const rnd = mulberry32(20261112);
    for (let round = 0; round < 2000; round++) {
      const n = 2 + Math.floor(rnd() * 59);
      const withTotals = rnd() < 0.5;
      const list: RoundEntry[] = [];
      for (let i = 0; i < n; i++) {
        const raw = Math.floor(rnd() * 7);
        list.push({
          id: `p${i}`,
          raw,
          // Few distinct moments on purpose: same raw AND same millisecond happens a lot.
          reachedAt: raw > 0 ? Math.floor(rnd() * 5) : null,
          joinOrder: i,
          ...(withTotals ? { totalBefore: Math.floor(rnd() * 40) * 50 } : {}),
        });
      }
      const s = computeRoundScores(list);
      expect(s.size).toBe(n);
      const order = orderRound(list);
      const scorers = order.filter((e) => e.raw > 0);

      // strict positions: a permutation of 1..n, in the strict order
      expect(order.map((e) => s.get(e.id)?.roundRank)).toEqual(order.map((_, i) => i + 1));
      // the strict order is consistent with raw descending, then time, then join order
      for (let i = 1; i < order.length; i++) {
        const up = order[i - 1]!;
        const down = order[i]!;
        expect(up.raw).toBeGreaterThanOrEqual(down.raw);
        if (up.raw === down.raw && up.raw > 0) {
          expect(up.reachedAt!).toBeLessThanOrEqual(down.reachedAt!);
          if (up.reachedAt === down.reachedAt) expect(up.joinOrder).toBeLessThan(down.joinOrder);
        }
      }
      // no two scorers share points; strictly decreasing down the order; integers >= 1
      const pts = scorers.map((e) => s.get(e.id)?.points ?? -1);
      expect(new Set(pts).size).toBe(pts.length);
      for (let i = 0; i < pts.length; i++) {
        expect(Number.isInteger(pts[i])).toBe(true);
        expect(pts[i]!).toBeGreaterThanOrEqual(1);
        if (i > 0) expect(pts[i]!).toBeLessThan(pts[i - 1]!);
      }
      for (const e of order) if (e.raw <= 0) expect(s.get(e.id)?.points).toBe(0);
      // exactly one winner whenever anybody scored
      const winners = [...s].filter(([id, v]) => v.roundRank === 1 && (list.find((e) => e.id === id)?.raw ?? 0) > 0);
      expect(winners.length).toBe(scorers.length > 0 ? 1 : 0);
      if (scorers.length > 0) {
        expect(winners[0]?.[0]).toBe(scorers[0]?.id);
        expect(pts[0]!).toBeLessThanOrEqual(MAX_ROUND_POINTS + PODIUM_BONUS[0]!);
        if (!withTotals) expect(pts[0]).toBe(MAX_ROUND_POINTS + PODIUM_BONUS[0]!);
      }
      // nobody gets more than the plain formula gives for their position
      scorers.forEach((e, i) => {
        const plain = Math.round((MAX_ROUND_POINTS * e.raw) / scorers[0]!.raw) + (PODIUM_BONUS[i] ?? 0);
        if (plain >= scorers.length) expect(s.get(e.id)!.points).toBeLessThanOrEqual(plain + scorers.length);
      });
    }
  });

  it('a runaway leader squeezing the rest to a few points still leaves no two totals equal (the TV round of 14:12Z)', () => {
    // [name, raw, totalBefore] in round order: before the fix דנה and מיכל both ended on 187
    const seen: Array<[string, number, number]> = [
      ['נועה', 100000, 0], ['בוט 12', 5945, 610], ['בוט 3', 4615, 1100], ['בוט 24', 4602, 855], ['בוט 8', 4582, 172],
      ['בוט 18', 4521, 913], ['בוט 10', 4248, 614], ['בוט 25', 4175, 434], ['בוט 22', 3983, 652], ['בוט 17', 3852, 621],
      ['בוט 19', 3625, 545], ['בוט 5', 3323, 834], ['בוט 21', 3273, 970], ['בוט 1', 3136, 800], ['בוט 9', 2821, 279],
      ['בוט 23', 2609, 634], ['בוט 20', 2604, 266], ['בוט 14', 2097, 559], ['בוט 11', 2071, 686], ['בוט 15', 1964, 755],
      ['בוט 7', 1584, 745], ['בוט 6', 1275, 238], ['בוט 16', 1162, 283], ['בוט 2', 1073, 717], ['בוט 4', 1047, 214],
      ['Yossi', 328, 186], ['מיכל', 276, 184], ['דנה', 192, 185], ['עדי', 50, 0], ['בוט 13', 0, 0],
    ];
    const list: RoundEntry[] = seen.map(([id, raw, totalBefore], i) => ({ id, raw, reachedAt: raw > 0 ? 1_000 + i : null, joinOrder: i, totalBefore }));
    const s = computeRoundScores(list);
    const totals = list.map((e) => (e.totalBefore ?? 0) + (s.get(e.id)?.points ?? 0)).filter((t) => t > 0);
    expect(new Set(totals).size).toBe(totals.length);
    const pts = list.filter((e) => e.raw > 0).map((e) => s.get(e.id)!.points);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!).toBeLessThan(pts[i - 1]!);
    expect(pts[pts.length - 1]!).toBeGreaterThanOrEqual(1);
  });

  it('property: 400 evenings of 30 guests where one guest scores 20x / 50x / 100x the rest in 30% of rounds never share a total', () => {
    const bad: string[] = [];
    for (const mult of [20, 50, 100]) {
      const rnd = mulberry32(4242 + mult);
      for (let ev = 0; ev < 400; ev++) {
        const totals = new Array<number>(30).fill(0);
        for (let round = 0; round < 10; round++) {
          const star = rnd() < 0.3 ? Math.floor(rnd() * 30) : -1;
          const list: RoundEntry[] = totals.map((totalBefore, i) => {
            const raw = rnd() < 0.07 ? 0 : Math.round(1_000 * (0.1 + 0.9 * rnd()) * (i === star ? mult : 1));
            return { id: String(i), raw, reachedAt: raw > 0 ? Math.floor(rnd() * 60_000) : null, joinOrder: i, totalBefore };
          });
          const s = computeRoundScores(list);
          const pts = orderRound(list)
            .filter((e) => e.raw > 0)
            .map((e) => s.get(e.id)?.points ?? 0);
          if (pts.some((p, i) => p < 1 || (i > 0 && p >= pts[i - 1]!))) bad.push(`${mult}x evening ${ev} round ${round + 1}: points not strictly decreasing`);
          totals.forEach((_, i) => (totals[i]! += s.get(String(i))?.points ?? 0));
          const nonZero = totals.filter((t) => t > 0);
          if (new Set(nonZero).size !== nonZero.length) bad.push(`${mult}x evening ${ev} round ${round + 1}: two guests on one total`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('property: 300 random competitions of 5 rounds never leave two scorers on the same total', () => {
    const rnd = mulberry32(77);
    for (let comp = 0; comp < 300; comp++) {
      const n = 2 + Math.floor(rnd() * 59);
      const totals = new Array<number>(n).fill(0);
      for (let round = 0; round < 5; round++) {
        const list: RoundEntry[] = totals.map((totalBefore, i) => {
          const raw = Math.floor(rnd() * 7);
          return { id: String(i), raw, reachedAt: raw > 0 ? Math.floor(rnd() * 5) : null, joinOrder: i, totalBefore };
        });
        const s = computeRoundScores(list);
        totals.forEach((_, i) => (totals[i]! += s.get(String(i))?.points ?? 0));
        const nonZero = totals.filter((t) => t > 0);
        expect(new Set(nonZero).size).toBe(nonZero.length);
      }
    }
  });
});

describe('rankOverall', () => {
  function standing(id: string, total: number, wins: number, best: number, lastPos: number | null, joinOrder: number): StandingEntry {
    return { id, total, wins, best, lastPos, joinOrder };
  }

  it('orders by total first', () => {
    const ranks = rankOverall([standing('a', 10, 5, 10, 1, 0), standing('b', 30, 0, 30, 3, 1), standing('c', 20, 0, 20, 2, 2)]);
    expect(Object.fromEntries(ranks)).toEqual({ b: 1, c: 2, a: 3 });
  });

  it('breaks equal totals by round wins, then best round, then last round position, then join order', () => {
    // all on 1600
    expect(orderOverall([standing('noWin', 1600, 0, 900, 1, 0), standing('win', 1600, 1, 800, 5, 1)])).toEqual(['win', 'noWin']);
    expect(orderOverall([standing('best800', 1600, 1, 800, 1, 0), standing('best1100', 1600, 1, 1100, 5, 1)])).toEqual(['best1100', 'best800']);
    expect(orderOverall([standing('pos4', 1600, 1, 1100, 4, 0), standing('pos2', 1600, 1, 1100, 2, 1)])).toEqual(['pos2', 'pos4']);
    expect(orderOverall([standing('absent', 1600, 1, 1100, null, 0), standing('pos9', 1600, 1, 1100, 9, 1)])).toEqual(['pos9', 'absent']);
    expect(orderOverall([standing('joinedSecond', 1600, 1, 1100, 2, 7), standing('joinedFirst', 1600, 1, 1100, 2, 3)])).toEqual(['joinedFirst', 'joinedSecond']);
  });

  it('everyone on zero before the first round: join order', () => {
    const ranks = rankOverall([standing('c', 0, 0, 0, null, 2), standing('a', 0, 0, 0, null, 0), standing('b', 0, 0, 0, null, 1)]);
    expect(Object.fromEntries(ranks)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('is always a permutation of 1..n, whatever the collisions', () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rnd() * 60);
      const list = Array.from({ length: n }, (_, j) =>
        standing(`p${j}`, Math.floor(rnd() * 3) * 500, Math.floor(rnd() * 2), Math.floor(rnd() * 2) * 500, rnd() < 0.3 ? null : 1 + Math.floor(rnd() * 3), j),
      );
      const ranks = rankOverall(list);
      expect([...ranks.values()].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, j) => j + 1));
      const byRank = [...list].sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0));
      for (let j = 1; j < n; j++) expect(byRank[j]!.total).toBeLessThanOrEqual(byRank[j - 1]!.total);
    }
  });

  it('handles an empty list', () => {
    expect(rankOverall([]).size).toBe(0);
  });
});
