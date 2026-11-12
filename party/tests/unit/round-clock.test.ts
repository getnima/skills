import { describe, expect, it } from 'vitest';

import { roundTime } from '../../shared/round-clock';

import type { RoundPublic } from '../../shared/protocol';

function round(over: Partial<RoundPublic> = {}): RoundPublic {
  return { index: 0, number: 1, gameId: 'tap', seed: 1, startAt: 10_000, endAt: 70_000, frozenAt: null, resumeAt: null, finale: null, ...over };
}

describe('roundTime', () => {
  it('is negative before the start and counts down to the end', () => {
    expect(roundTime(round(), 7_000)).toEqual({ elapsedMs: -3_000, leftMs: 63_000, frozen: false, resumeInMs: 0 });
    expect(roundTime(round(), 25_000)).toEqual({ elapsedMs: 15_000, leftMs: 45_000, frozen: false, resumeInMs: 0 });
  });

  it('never reports negative time left', () => {
    const t = roundTime(round(), 80_000);
    expect(t.leftMs).toBe(0);
    expect(t.elapsedMs).toBe(70_000);
  });

  it('stands still while frozen, whatever the wall clock says', () => {
    const r = round({ frozenAt: 30_000 });
    for (const now of [30_000, 45_000, 500_000]) {
      const t = roundTime(r, now);
      expect(t.elapsedMs).toBe(20_000);
      expect(t.leftMs).toBe(40_000);
      expect(t.resumeInMs).toBe(0);
    }
    expect(roundTime(r, 45_000).frozen).toBe(true);
  });

  it('stands still through the 3-2-1 after a freeze and then continues where it stopped', () => {
    // Frozen at 30_000 (elapsed 20_000) for 12s, resumed at 42_000 with a 3s countdown.
    const delta = 45_000 - 30_000;
    const r = round({ startAt: 10_000 + delta, endAt: 70_000 + delta, resumeAt: 45_000 });
    expect(roundTime(r, 42_000)).toEqual({ elapsedMs: 20_000, leftMs: 40_000, frozen: true, resumeInMs: 3_000 });
    expect(roundTime(r, 44_000)).toEqual({ elapsedMs: 20_000, leftMs: 40_000, frozen: true, resumeInMs: 1_000 });
    expect(roundTime(r, 45_000)).toEqual({ elapsedMs: 20_000, leftMs: 40_000, frozen: false, resumeInMs: 0 });
    expect(roundTime(r, 46_000)).toEqual({ elapsedMs: 21_000, leftMs: 39_000, frozen: false, resumeInMs: 0 });
  });

  it('prefers frozenAt over a stale resumeAt', () => {
    const t = roundTime(round({ frozenAt: 20_000, resumeAt: 50_000 }), 21_000);
    expect(t.elapsedMs).toBe(10_000);
    expect(t.resumeInMs).toBe(0);
  });
});
