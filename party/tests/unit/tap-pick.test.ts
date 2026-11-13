import { describe, expect, it } from 'vitest';

import { GAMES } from '../../shared/protocol';

import { createTapEngine, MILESTONE_IDS, rankOf, scaledThresholds, TAP, tapTiming } from '../../client/src/games/tap/pick';
import { buildLevel, IDLE_BITS } from '../../client/src/games/tap/schedule';
import { CLIP_KEYS, CLIP_SRC } from '../../client/src/games/tap/art';

import type { TapListener } from '../../client/src/games/tap/pick';

const STEP = 1000 / 60;

interface Run {
  taps: number;
  t0: number;
  endAt: number;
  auto: boolean;
  doneCalls: number;
  doneAtStep: number;
  milestones: Array<{ id: string; taps: number; ms: number }>;
  levels: number[];
  maxLevelAfter: (ms: number) => number;
  minLevelBetween: (a: number, b: number) => number;
  bounces: number;
  late: number;
  trace: string;
}

/**
 * Play a whole round: `times` = round times of touches. `mode` 'jit' queues each touch just
 * before the step that covers it, 'ahead' queues everything at the start, 'lag' runs steps in
 * batches of `batch` (a 20 fps phone: 3 steps per frame, the touches of a frame arrive together).
 */
function play(durationMs: number, times: readonly number[], mode: 'jit' | 'ahead' | 'lag' = 'jit', batch = 3, joinedAt = 0): Run {
  const sorted = [...times].sort((a, b) => a - b);
  const r: Run = {
    taps: 0,
    t0: -1,
    endAt: -1,
    auto: false,
    doneCalls: 0,
    doneAtStep: -1,
    milestones: [],
    levels: [],
    maxLevelAfter: () => 0,
    minLevelBetween: () => 0,
    bounces: 0,
    late: 0,
    trace: '',
  };
  let step = 0;
  let now = 0;
  const on: TapListener = {
    milestone: (id, _i, taps) => r.milestones.push({ id, taps, ms: Math.round(now) }),
    done: () => {
      r.doneCalls++;
      r.doneAtStep = step;
    },
  };
  const e = createTapEngine(durationMs, on, joinedAt, CLASSIC);
  const levelAt: Array<[number, number]> = [];
  let qi = 0;
  if (mode === 'ahead') for (const t of sorted) e.tap(t);
  const steps = Math.ceil(durationMs / STEP) + 2;
  const trace: string[] = [];
  for (step = 1; step <= steps; step++) {
    now = joinedAt + step * STEP;
    if (mode === 'jit') {
      while (qi < sorted.length && (sorted[qi] ?? 0) <= now) e.tap(sorted[qi++] ?? 0);
    } else if (mode === 'lag' && step % batch === 1) {
      const frameEnd = now + (batch - 1) * STEP;
      while (qi < sorted.length && (sorted[qi] ?? 0) <= frameEnd) e.tap(sorted[qi++] ?? 0);
    }
    e.step(now);
    levelAt.push([now, e.state.level]);
    if (step % 30 === 0) trace.push(`${step}:${e.state.taps}:${e.state.level}:${e.state.phase}`);
  }
  const s = e.state;
  r.taps = s.taps;
  r.t0 = s.t0;
  r.endAt = s.endAt;
  r.auto = s.auto;
  r.bounces = s.bounces;
  r.late = s.late;
  r.levels = levelAt.map(([, l]) => l);
  r.maxLevelAfter = (ms) => Math.max(0, ...levelAt.filter(([t]) => t >= ms).map(([, l]) => l));
  r.minLevelBetween = (a, b) => Math.min(9, ...levelAt.filter(([t]) => t >= a && t < b).map(([, l]) => l));
  r.trace = trace.join(',');
  return r;
}

/** Steady taps at `hz` from `from` for `forMs` (optionally jittered by a seeded LCG). */
function steady(hz: number, from: number, forMs: number, jitter = 0, seed = 1): number[] {
  const out: number[] = [];
  let x = seed;
  const rnd = (): number => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return x / 4294967296;
  };
  const gap = 1000 / hz;
  for (let t = from; t < from + forMs; t += gap * (1 + (rnd() - 0.5) * jitter)) out.push(Math.round(t * 10) / 10);
  return out;
}

/**
 * The split these tests were written for: a 53 s round, 30 s to start, 20 s of sprint, 3 s of hold.
 * The party's round is shorter now (TAP: 8 + 20 + 2 of 30 s); the engine's rules do not care.
 */
const CLASSIC = { START_SHARE: 30 / 53, SPRINT_SHARE: 20 / 53 };

describe('tap timing', () => {
  it('the party round: 30 s, 8 s to start, 20 s of tapping, 2 s of hold; thresholds as written', () => {
    expect(GAMES.tap.durationMs).toBe(30_000);
    const t = tapTiming(GAMES.tap.durationMs);
    expect(t.startWindowMs).toBe(8_000);
    expect(t.sprintMs).toBe(20_000);
    expect(t.durationMs - t.startWindowMs - t.sprintMs).toBe(2_000);
    expect(t.tapScale).toBe(1);
    // nobody touches: the sprint starts by itself at 8 s and is over at 28 s
    const e = createTapEngine(GAMES.tap.durationMs);
    expect(e.state.phase).toBe('waiting');
    for (let k = 1; k * STEP <= 30_000; k++) e.step(k * STEP);
    expect(e.state).toMatchObject({ phase: 'done', auto: true, taps: 0 });
    expect(Math.round(e.state.t0 / 100) / 10).toBe(8);
    expect(Math.round(e.state.endAt / 100) / 10).toBe(28);
  });

  it('derives the start window (30/53), the sprint (20/53) and the 3/53 hold from the round', () => {
    const t = tapTiming(53_000, CLASSIC);
    expect(t.startWindowMs).toBe(30_000);
    expect(t.sprintMs).toBe(20_000);
    expect(t.durationMs - t.startWindowMs - t.sprintMs).toBe(3_000);
    expect(t.tapScale).toBe(1);
    const s = tapTiming(10_600, CLASSIC);
    expect(s.startWindowMs).toBe(6_000);
    expect(s.sprintMs).toBe(4_000);
    expect(s.tapScale).toBeCloseTo(0.2);
  });

  it('scales thresholds and keeps them strictly increasing', () => {
    expect(scaledThresholds(TAP.MILESTONES, 1)).toEqual([8, 18, 28, 40, 54, 68, 84, 120, 150]);
    const tiny = scaledThresholds(TAP.MILESTONES, 0.05);
    for (let i = 1; i < tiny.length; i++) expect(tiny[i]).toBeGreaterThan(tiny[i - 1] ?? 0);
    expect(tiny[0]).toBeGreaterThanOrEqual(1);
  });

  it('ranks the final count (under 70 / 70-129 / 130-189 / 190+)', () => {
    expect(rankOf(0, 1)).toBe(0);
    expect(rankOf(69, 1)).toBe(0);
    expect(rankOf(70, 1)).toBe(1);
    expect(rankOf(129, 1)).toBe(1);
    expect(rankOf(130, 1)).toBe(2);
    expect(rankOf(190, 1)).toBe(3);
    expect(rankOf(243, 1)).toBe(3);
  });
});

describe('tap engine: the round format', () => {
  it('the first touch starts the sprint and counts as tap #1', () => {
    const r = play(53_000, [5_000]);
    expect(r.t0).toBe(5_000);
    expect(r.auto).toBe(false);
    expect(r.taps).toBe(1);
    expect(r.endAt).toBe(25_000);
  });

  it('starts by itself at the end of the window with 0 taps, and still finishes', () => {
    const r = play(53_000, []);
    expect(r.t0).toBe(30_000);
    expect(r.auto).toBe(true);
    expect(r.taps).toBe(0);
    // 3 s before the end of the round: even the last starter sees the final frame
    expect(r.endAt).toBe(50_000);
    expect(r.doneCalls).toBe(1);
  });

  it('counts a touch at t0 + sprint - 1 and not one at t0 + sprint', () => {
    const r = play(53_000, [1_000, 20_999, 21_000]);
    expect(r.taps).toBe(2);
    expect(r.late).toBe(1);
    const auto = play(53_000, [49_999, 50_000]);
    expect(auto.taps).toBe(1);
  });

  it('finishes exactly 20 s after the start, whenever the player starts', () => {
    for (const start of [1_000, 12_345, 25_000, 29_990]) {
      const r = play(53_000, steady(6, start, 25_000));
      expect(r.endAt - r.t0).toBe(20_000);
      expect(r.doneCalls).toBe(1);
      expect(r.doneAtStep * STEP).toBeGreaterThanOrEqual(r.endAt);
      expect(r.doneAtStep * STEP - r.endAt).toBeLessThan(STEP + 0.01);
    }
  });

  it('a phone that joins after the window starts at once and is cut at the end of the round', () => {
    const r = play(53_000, steady(8, 40_100, 20_000), 'jit', 3, 40_000);
    expect(r.auto).toBe(true);
    expect(r.t0).toBe(40_000);
    expect(r.endAt).toBe(53_000);
    expect(r.taps).toBeLessThanOrEqual(105);
  });

  it('fires done exactly once', () => {
    const r = play(53_000, steady(10, 2_000, 40_000));
    expect(r.doneCalls).toBe(1);
  });
});

describe('tap engine: the anti-mash cap', () => {
  it('never counts more than 243 in a sprint, however many fingers', () => {
    const five: number[] = [];
    for (const t of steady(30, 1_000, 25_000)) for (let f = 0; f < 5; f++) five.push(t + f * 0.3);
    const r = play(53_000, five);
    expect(r.taps).toBeLessThanOrEqual(TAP.BURST + TAP.RATE * 20);
    expect(r.taps).toBeGreaterThan(235);
    const r30 = play(53_000, steady(30, 1_000, 25_000));
    expect(r30.taps).toBeLessThanOrEqual(243);
  });

  it('never caps two fast thumbs (12 taps/s steady, 11 taps/s jittery); a jittery 12/s loses under 1%', () => {
    const r = play(53_000, steady(12, 1_000, 20_000));
    expect(r.bounces).toBe(0);
    expect(r.taps).toBe(240);
    const eleven = play(53_000, steady(11, 1_000, 19_900, 0.5, 7));
    expect(eleven.bounces).toBe(0);
    const jittery = play(53_000, steady(12, 1_000, 19_900, 0.5, 7));
    expect(jittery.bounces).toBeLessThanOrEqual(2);
  });

  it('continues a reloaded sprint: same start, same taps, same end, no events', () => {
    const fired: string[] = [];
    const e = createTapEngine(53_000, { start: () => fired.push('start'), milestone: (id) => fired.push(id), done: () => fired.push('done') }, 0, CLASSIC);
    e.resume(4_000, 37, false);
    expect(e.state.phase).toBe('sprint');
    expect(e.state.endAt).toBe(24_000);
    expect(e.state.taps).toBe(37);
    expect(e.state.milestones).toBe(3);
    for (let i = 1; i * STEP < 30_000; i++) {
      if (i === 900) e.tap(i * STEP);
      e.step(i * STEP);
    }
    expect(e.state.taps).toBe(38);
    expect(e.state.phase).toBe('done');
    expect(fired).toEqual(['done']);
    const f = createTapEngine(53_000, {}, 0, CLASSIC);
    f.resume(4_000, 120, true);
    f.step(25_000);
    expect(f.state.phase).toBe('done');
    expect(f.state.taps).toBe(120);
  });

  it('counts a slow, normal and fast player in order', () => {
    const slow = play(53_000, steady(3, 2_000, 20_000, 0.6, 3)).taps;
    const normal = play(53_000, steady(6, 2_000, 20_000, 0.3, 4)).taps;
    const fast = play(53_000, steady(11, 2_000, 20_000, 0.2, 5)).taps;
    expect(slow).toBeGreaterThan(50);
    expect(slow).toBeLessThan(70);
    expect(normal).toBeGreaterThan(110);
    expect(normal).toBeLessThan(130);
    expect(fast).toBeGreaterThan(200);
    expect(fast).toBeLessThanOrEqual(243);
  });
});

describe('tap engine: determinism', () => {
  it('the same touches give the same result at any step batching', () => {
    const times = steady(9, 3_210, 21_000, 0.7, 42);
    const a = play(53_000, times, 'jit');
    const b = play(53_000, times, 'ahead');
    const c = play(53_000, times, 'lag', 3);
    const d = play(53_000, times, 'lag', 7);
    for (const x of [b, c, d]) {
      expect(x.taps).toBe(a.taps);
      expect(x.milestones).toEqual(a.milestones);
      expect(x.levels).toEqual(a.levels);
      expect(x.trace).toBe(a.trace);
    }
  });
});

describe('tap engine: the smoothed rate and the hand level', () => {
  it('settles at the tap rate', () => {
    const e = createTapEngine(53_000, {}, 0, CLASSIC);
    let t = 0;
    for (let i = 1; i <= 60 * 8; i++) {
      const now = i * STEP;
      while (t <= now) {
        e.tap(t + 1_000);
        t += 1000 / 6;
      }
      e.step(now + 1_000);
    }
    expect(e.state.rate).toBeGreaterThan(5.2);
    expect(e.state.rate).toBeLessThan(7);
    expect(e.state.rateSm).toBeGreaterThan(5.2);
    expect(e.state.rateSm).toBeLessThan(7);
  });

  it('a slow tapper lives in L3 (finger to the knuckle), a normal one in L4, a fast one in L5', () => {
    const mid = (hz: number, j: number, seed: number): number[] => {
      const r = play(53_000, steady(hz, 1_000, 20_000, j, seed));
      // the middle of the sprint (before the last-quarter lock)
      return r.levels.slice(Math.round(5_000 / STEP), Math.round(15_000 / STEP));
    };
    const share = (ls: number[], ok: (l: number) => boolean): number => ls.filter(ok).length / ls.length;
    expect(share(mid(3, 0.2, 1), (l) => l === 3)).toBeGreaterThan(0.85);
    expect(share(mid(6, 0.2, 2), (l) => l === 4)).toBeGreaterThan(0.85);
    expect(share(mid(11, 0.2, 3), (l) => l === 5)).toBeGreaterThan(0.85);
  });

  it('stays in a level at least 300 ms and in the nose at least 700 ms', () => {
    // a burst to the knuckle, then nothing
    const r = play(53_000, steady(5, 1_000, 1_200));
    const levels = r.levels;
    let runStart = 0;
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] !== levels[i - 1]) {
        const prev = levels[i - 1] ?? 0;
        const next = levels[i] ?? 0;
        if (next < prev) expect((i - runStart) * STEP).toBeGreaterThanOrEqual(300 - 0.01);
        runStart = i;
      }
    }
    const firstIn = levels.findIndex((l) => l >= 3);
    if (firstIn >= 0) {
      const out = levels.findIndex((l, i) => i > firstIn && l < 3);
      expect((out - firstIn) * STEP).toBeGreaterThanOrEqual(700 - 0.01);
    }
  });

  it('locks the finger in (at least L3) in the last quarter of the sprint, and drops to 0 after it', () => {
    const r = play(53_000, steady(1.5, 1_000, 22_000));
    expect(r.minLevelBetween(16_100, 21_000)).toBeGreaterThanOrEqual(3);
    expect(r.maxLevelAfter(21_100)).toBe(0);
  });
});

describe('tap engine: the ladder', () => {
  it('fires every milestone once, in order, at the scaled counts', () => {
    const r = play(53_000, steady(12, 1_000, 20_000));
    expect(r.milestones.map((m) => m.id)).toEqual([...MILESTONE_IDS]);
    expect(r.milestones.map((m) => m.taps)).toEqual([8, 18, 28, 40, 54, 68, 84, 120, 150]);
  });

  it('every set piece starts before the last 5 s for its player: slow up to mini Shimi, normal up to the king, fast up to the cork', () => {
    const before = (hz: number): string[] =>
      play(53_000, steady(hz, 1_000, 20_000))
        .milestones.filter((m) => m.ms < 1_000 + 15_000)
        .map((m) => m.id);
    expect(before(3)).toEqual(['yossi', 'rope', 'ear', 'mini']);
    expect(before(6)).toEqual(['yossi', 'rope', 'ear', 'mini', 'sneeze', 'squeegee', 'king']);
    expect(before(11)).toEqual([...MILESTONE_IDS]);
  });

  it('scales with a short test round', () => {
    const r = play(10_600, steady(12, 500, 4_000));
    expect(r.milestones.length).toBe(9);
    expect(r.milestones[0]?.taps).toBe(Math.round(8 * 0.2));
  });
});

describe('tap schedule (seeded gags)', () => {
  it('is the same for the same seed and differs between seeds', () => {
    const a = buildLevel(7, 53_000);
    const b = buildLevel(7, 53_000);
    const c = buildLevel(8, 53_000);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it('plays every waiting bit once before any repeats', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const l = buildLevel(seed, 53_000);
      for (let r = 0; r + IDLE_BITS <= l.idleBits.length; r += IDLE_BITS) {
        expect(new Set(l.idleBits.slice(r, r + IDLE_BITS)).size).toBe(IDLE_BITS);
      }
    }
  });

  it('never repeats a waiting bit or a final-frame gag twice in a row, and uses each filler once', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const l = buildLevel(seed, 53_000);
      for (let i = 1; i < l.idleBits.length; i++) expect(l.idleBits[i]).not.toBe(l.idleBits[i - 1]);
      for (let i = 1; i < l.alive.length; i++) expect(l.alive[i]).not.toBe(l.alive[i - 1]);
      expect([...l.fillers].sort()).toEqual([0, 1, 2]);
    }
  });
});

describe('tap picking clip', () => {
  it('maps the depth 0..1 onto the whole clip, monotone, and every key frame exists', () => {
    expect(CLIP_SRC[0]).toBe(0);
    for (let i = 1; i < CLIP_SRC.length; i++) expect(CLIP_SRC[i] ?? 0).toBeGreaterThan(CLIP_SRC[i - 1] ?? 0);
    expect(CLIP_KEYS[0]).toBe(0);
    expect(CLIP_KEYS[1]).toBe(0);
    expect(CLIP_KEYS[CLIP_KEYS.length - 2]).toBe(1);
    expect(CLIP_KEYS[CLIP_KEYS.length - 1]).toBe(CLIP_SRC[CLIP_SRC.length - 1]);
    for (let i = 2; i < CLIP_KEYS.length; i += 2) {
      expect(CLIP_KEYS[i] ?? 0).toBeGreaterThan(CLIP_KEYS[i - 2] ?? 0);
      expect(CLIP_KEYS[i + 1] ?? 0).toBeGreaterThan(CLIP_KEYS[i - 1] ?? 0);
    }
  });
});
