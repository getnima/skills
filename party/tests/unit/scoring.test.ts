import { describe, expect, it } from 'vitest';

import { computeRoundScores, MAX_ROUND_POINTS, PODIUM_BONUS, rankDescending } from '../../shared/scoring';

function scores(entries: Array<[string, number]>): Map<string, { points: number; roundRank: number }> {
  return computeRoundScores(new Map(entries));
}

describe('rankDescending', () => {
  it('uses competition ranking: ties share a rank and the next rank is skipped', () => {
    const ranks = rankDescending([
      ['a', 10],
      ['b', 30],
      ['c', 10],
      ['d', 5],
      ['e', 30],
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ b: 1, e: 1, a: 3, c: 3, d: 5 });
  });

  it('handles an empty list', () => {
    expect(rankDescending([]).size).toBe(0);
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

  it('gives tied players the same rank and the same bonus', () => {
    const s = scores([
      ['a', 80],
      ['b', 80],
      ['c', 40],
    ]);
    expect(s.get('a')).toEqual(s.get('b'));
    expect(s.get('a')).toEqual({ points: 1100, roundRank: 1 });
    // Two players share first place, so the next one is third.
    expect(s.get('c')).toEqual({ points: 500 + PODIUM_BONUS[2]!, roundRank: 3 });
  });

  it('gives zero points (and no bonus) for a zero score', () => {
    const s = scores([
      ['a', 10],
      ['b', 0],
    ]);
    expect(s.get('a')?.points).toBe(1100);
    expect(s.get('b')).toEqual({ points: 0, roundRank: 2 });
  });

  it('gives nobody points when everyone scored zero', () => {
    const s = scores([
      ['a', 0],
      ['b', 0],
      ['c', 0],
    ]);
    for (const id of ['a', 'b', 'c']) expect(s.get(id)).toEqual({ points: 0, roundRank: 1 });
  });

  it('treats NaN, infinities and negative scores as zero', () => {
    const s = scores([
      ['nan', Number.NaN],
      ['neg', -50],
      ['inf', Number.POSITIVE_INFINITY],
      ['ok', 10],
    ]);
    expect(s.get('ok')).toEqual({ points: 1100, roundRank: 1 });
    for (const id of ['nan', 'neg', 'inf']) expect(s.get(id)).toEqual({ points: 0, roundRank: 2 });
  });

  it('gives a single player the full score', () => {
    expect(scores([['solo', 3]]).get('solo')).toEqual({ points: 1100, roundRank: 1 });
    expect(scores([['solo', 0]]).get('solo')).toEqual({ points: 0, roundRank: 1 });
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
});
