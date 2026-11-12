import { describe, expect, it } from 'vitest';

import { createPickEngine, PICK } from '../../client/src/games/tap/pick';
import { BIG_FIRST, BIG_GAP, BOOGER, BOOGER_SEQ_LEN, boogerOf, boogerTraits, buildLevel } from '../../client/src/games/tap/schedule';
import { GAMES } from '../../shared/protocol';

import type { PickListener } from '../../client/src/games/tap/pick';

const STEP = 1000 / 60;
const D = 60_000;
const MAX = GAMES.tap.maxRaw;

interface Tap {
  t: number;
  face: boolean;
}

/** Run a whole round: taps are queued `batchSteps` steps ahead (1 = 60 Hz, 3 = 20 fps). */
function play(seed: number, taps: readonly Tap[], opts: { batchSteps?: number; dur?: number; on?: PickListener } = {}) {
  const dur = opts.dur ?? D;
  const level = buildLevel(seed, dur);
  const e = createPickEngine(level, MAX, opts.on);
  const batch = opts.batchSteps ?? 1;
  let i = 0;
  const steps = Math.floor(dur / STEP);
  for (let k = 1; k <= steps; k++) {
    // a frame: everything that happened up to the end of this frame is queued first
    if ((k - 1) % batch === 0) {
      const frameEnd = Math.min(steps, k + batch - 1) * STEP;
      while (i < taps.length && (taps[i]?.t ?? Infinity) <= frameEnd) {
        const tp = taps[i++];
        if (tp) e.tap(tp.t, tp.face);
      }
    }
    e.step(k * STEP);
  }
  return e.state;
}

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

/** Taps every `gap(t)` ms from 300 ms until the end; `fingers` taps a few ms apart per beat. */
function rhythm(r: () => number, gap: (t: number) => number, fingers = 1, face: (i: number) => boolean = () => true, dur = D): Tap[] {
  const out: Tap[] = [];
  let t = 300;
  while (t < dur - 250) {
    for (let f = 0; f < fingers; f++) out.push({ t: t + f * (4 + r() * 12), face: face(f) });
    t += gap(t);
  }
  // touches reach the page in time order
  return out.sort((x, y) => x.t - y.t);
}

const players = {
  /** ~3 taps/s, irregular, with lapses and an excited flurry now and then. */
  clumsy: (r: () => number): Tap[] => {
    let flurry = 0;
    return rhythm(
      r,
      () => {
        if (flurry > 0) {
          flurry--;
          return 170 + r() * 60;
        }
        if (r() < 0.04) flurry = 6 + Math.floor(r() * 8);
        if (r() < 0.06) return 500 + r() * 500;
        return 260 + r() * 260;
      },
      1,
      () => r() > 0.05,
    );
  },
  normal: (r: () => number): Tap[] => rhythm(r, () => (r() < 0.02 ? 300 + r() * 200 : 150 + r() * 35)),
  expert: (r: () => number): Tap[] => rhythm(r, () => 95 + r() * 10),
  mash5face: (r: () => number): Tap[] => rhythm(r, () => 230 + r() * 40, 5),
  mash5anywhere: (r: () => number): Tap[] => rhythm(r, () => 230 + r() * 40, 5, () => r() < 0.5),
};

describe('tap schedule', () => {
  it('is a pure function of the seed and the length', () => {
    const a = buildLevel(7, D);
    const b = buildLevel(7, D);
    const c = buildLevel(8, D);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.boogers).toEqual(b.boogers);
    expect(a.bigAt).toEqual(b.bigAt);
    expect(c.fingerprint).not.toBe(a.fingerprint);
    expect(boogerTraits(7, 12)).toEqual(boogerTraits(7, 12));
    expect(boogerTraits(7, 12)).not.toEqual(boogerTraits(7, 13));
  });

  it('booger sequence: no boss in normal digs, no golden twice in a row, no character three times', () => {
    for (const seed of [1, 2, 3, 11, 99]) {
      const lv = buildLevel(seed, D);
      expect(lv.boogers).toHaveLength(BOOGER_SEQ_LEN);
      const counts = new Map<number, number>();
      lv.boogers.forEach((k, i) => {
        counts.set(k, (counts.get(k) ?? 0) + 1);
        expect(k).not.toBe(BOOGER.Boss);
        if (i > 0 && k === BOOGER.Golden) expect(lv.boogers[i - 1]).not.toBe(BOOGER.Golden);
        if (i > 1) expect(k === lv.boogers[i - 1] && k === lv.boogers[i - 2]).toBe(false);
      });
      // every normal character shows up, golden stays rare
      for (const k of [BOOGER.Round, BOOGER.Stretchy, BOOGER.Googly, BOOGER.Hairy, BOOGER.Golden]) expect(counts.get(k) ?? 0).toBeGreaterThan(0);
      expect((counts.get(BOOGER.Golden) ?? 0) / BOOGER_SEQ_LEN).toBeLessThan(0.08);
      expect(boogerOf(lv, BOOGER_SEQ_LEN + 3)).toBe(lv.boogers[3]);
    }
  });

  it('BIG booger thresholds rise in seeded gaps', () => {
    const lv = buildLevel(5, D);
    const first = lv.bigAt[0] ?? 0;
    expect(first).toBeGreaterThanOrEqual(BIG_FIRST[0]);
    expect(first).toBeLessThanOrEqual(BIG_FIRST[1]);
    for (let i = 1; i < 30; i++) {
      const gap = (lv.bigAt[i] ?? 0) - (lv.bigAt[i - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(BIG_GAP[0]);
      expect(gap).toBeLessThanOrEqual(BIG_GAP[1]);
    }
    expect(lv.frenzyFrom).toBe(45_000);
  });
});

describe('tap pick meter and phases', () => {
  it('6 taps/s fills the meter: the finger goes in within ~2 s and stays in', () => {
    const taps = rhythm(mulberry(1), () => 1000 / 6, 1, () => true, 20_000);
    let enteredAt = -1;
    let exits = 0;
    const s = play(1, taps, { dur: 20_000, on: { enter: () => (enteredAt = enteredAt < 0 ? 1 : enteredAt), exit: () => exits++ } });
    expect(enteredAt).toBe(1);
    expect(s.picks).toBe(1);
    expect(exits).toBe(0);
    expect(s.pickingMs).toBeGreaterThan(17_000);
  });

  it('3 regular taps/s never fills it before the frenzy; the hand rises and sinks', () => {
    const taps = rhythm(mulberry(2), () => 1000 / 3, 1, () => true, 40_000);
    const s = play(2, taps);
    expect(s.picks).toBe(0);
    expect(s.digs).toBe(0);
    expect(s.score).toBeGreaterThan(50);
  });

  it('slowing down pulls the finger out and the hand sinks; spamming brings it back', () => {
    // 8/s for 5 s, then 2/s for 4 s, then 8/s again
    const taps: Tap[] = [];
    for (let t = 300; t < 5_300; t += 125) taps.push({ t, face: true });
    for (let t = 5_300; t < 9_300; t += 500) taps.push({ t, face: true });
    for (let t = 9_300; t < 14_000; t += 125) taps.push({ t, face: true });
    const meters: number[] = [];
    const level = buildLevel(3, 20_000);
    const e = createPickEngine(level, MAX, { exit: () => meters.push(e.state.meter) });
    let i = 0;
    const phases = new Set<string>();
    for (let k = 1; k * STEP <= 14_500; k++) {
      while (i < taps.length && (taps[i]?.t ?? 0) <= k * STEP) e.tap(taps[i]!.t, true), i++;
      e.step(k * STEP);
      phases.add(e.state.phase);
    }
    expect(e.state.picks).toBe(2);
    expect(meters[0]).toBeLessThanOrEqual(PICK.EXIT_SINK + 1e-9);
    expect([...phases].sort()).toEqual(['idle', 'picking', 'rising']);
  });

  it('a dig is +5 and throws the seeded booger; the BIG booger comes at the seeded dig count', () => {
    const level = buildLevel(4, D);
    const digs: Array<[number, number, number]> = [];
    const bigs: number[] = [];
    const taps = rhythm(mulberry(4), () => 100, 1, () => true, 12_000);
    play(4, taps, { dur: 12_000, on: { dig: (i, k, p) => digs.push([i, k, p]), bigStart: (i) => bigs.push(i) } });
    expect(digs.length).toBeGreaterThan(40);
    for (const [i, k, p] of digs) {
      expect(k).toBe(boogerOf(level, i));
      expect(p).toBe(k === BOOGER.Golden ? PICK.DIG_POINTS + PICK.GOLDEN_BONUS : PICK.DIG_POINTS);
    }
    expect(bigs.length).toBeGreaterThanOrEqual(1);
  });

  it('the BIG moment: taps pull (+1), the bonus is counted once, the finger stays in', () => {
    let sawPull = 0;
    let bonus = 0;
    const s = play(9, rhythm(mulberry(9), () => 100, 1, () => true, 15_000), {
      dur: 15_000,
      on: { pull: (_i, p) => (sawPull += p), bigStart: (_i, b) => (bonus += b) },
    });
    expect(s.bigBoogers).toBeGreaterThanOrEqual(2);
    expect(bonus).toBe(s.bigBoogers * PICK.BIG_BONUS);
    expect(sawPull).toBeGreaterThan(0);
    expect(s.picks).toBe(1);
  });
});

describe('tap fairness', () => {
  it('same taps = same result at 60 Hz and at 20 fps (taps applied at their own step)', () => {
    for (const [name, mk] of Object.entries(players)) {
      const taps = mk(mulberry(31));
      const a = play(11, taps, { batchSteps: 1 });
      const b = play(11, taps, { batchSteps: 3 });
      const c = play(11, taps, { batchSteps: 6 });
      expect({ name, ...b }).toEqual({ name, ...a });
      expect({ name, ...c }).toEqual({ name, ...a });
    }
  });

  it('a held finger is one tap; the meter drains to nothing', () => {
    const s = play(1, [{ t: 400, face: true }]);
    expect(s.hits).toBe(1);
    expect(s.score).toBe(1);
    expect(s.meter).toBeLessThan(0.001);
    expect(s.phase).toBe('idle');
  });

  it('no steps (a freeze) = nothing drains, nothing scores', () => {
    const level = buildLevel(2, D);
    const e = createPickEngine(level, MAX);
    for (let k = 1; k <= 120; k++) {
      if (k % 10 === 0) e.tap(k * STEP, true);
      e.step(k * STEP);
    }
    const before = { ...e.state };
    e.tap(2_100, true); // queued but its step never comes while frozen
    expect({ ...e.state }).toEqual(before);
  });

  it('five fingers at once count as one or two taps, and never more than HIT_RATE per second', () => {
    const chord: Tap[] = [];
    for (let t = 300; t < 10_300; t += 250) for (let f = 0; f < 5; f++) chord.push({ t: t + f * 8, face: true });
    const s = play(1, chord, { dur: 11_000 });
    expect(s.hits).toBeLessThanOrEqual(40 * 2);
    expect(s.bounces).toBeGreaterThan(s.hits);
    const fast = rhythm(mulberry(5), () => 25, 1, () => true, 11_000); // 40 taps/s
    const f = play(1, fast, { dur: 11_000 });
    expect(f.hits / 10.5).toBeLessThanOrEqual(PICK.HIT_RATE + 0.5);
  });

  it('a miss costs 1 (never below 0) and breaks the combo', () => {
    const s = play(1, [
      { t: 300, face: false },
      { t: 400, face: true },
      { t: 500, face: true },
      { t: 600, face: false },
    ]);
    expect(s.misses).toBe(2);
    expect(s.score).toBe(1);
    expect(s.combo).toBe(0);
  });

  it('players: expert > normal > clumsy > 0 with clear gaps, expert below 60% of maxRaw, mashing below one finger', () => {
    const res: Record<string, number[]> = {};
    for (const seed of [11, 12, 13, 14]) {
      for (const [name, mk] of Object.entries(players)) (res[name] ??= []).push(play(seed, mk(mulberry(seed * 13 + name.length))).score);
    }
    for (let i = 0; i < 4; i++) {
      const c = res.clumsy?.[i] ?? 0;
      const n = res.normal?.[i] ?? 0;
      const x = res.expert?.[i] ?? 0;
      expect(c).toBeGreaterThan(100);
      expect(n).toBeGreaterThan(c * 2);
      expect(x).toBeGreaterThan(n * 1.3);
      expect(x).toBeLessThan(MAX * 0.6);
      expect(res.mash5face?.[i] ?? 0).toBeLessThan(x * 0.75); // five fingers never beat one fast finger
      expect(res.mash5anywhere?.[i] ?? 0).toBeLessThan(n);
    }
  });
});
