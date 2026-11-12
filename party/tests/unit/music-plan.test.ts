import { describe, expect, it } from 'vitest';

import { MUSIC } from '../../client/src/host/music-config';
import { COUNTDOWN_MS, INTRO_MS } from '../../shared/protocol';
import { DEFAULT_PRELUDE_MS, planMusic, preludeOf, resolveGameSlot, songElapsedMs } from '../../client/src/host/music-plan';

import type { MusicSlot } from '../../client/src/host/music-config';
import type { MusicInput } from '../../client/src/host/music-plan';
import type { RoundPublic } from '../../shared/protocol';

const PRELUDE = 10_000;
/** intro begins at 0, play at 10 s, ends at 70 s */
function round(over: Partial<RoundPublic> = {}): RoundPublic {
  return { index: 2, number: 3, gameId: 'tap', seed: 7, startAt: 10_000, countdownMs: 3_000, endAt: 70_000, frozenAt: null, resumeAt: null, finale: null, ...over };
}

const files = (...have: MusicSlot[]) => (slot: MusicSlot): boolean => have.includes(slot);

function input(over: Partial<MusicInput> = {}): MusicInput {
  return { phase: 'intro', round: round(), cutscene: false, now: 0, preludeMs: PRELUDE, hasFile: files('lobby', 'tap', 'round'), ...over };
}

describe('resolveGameSlot', () => {
  it("plays the game's own song, else round.mp3, else nothing", () => {
    expect(resolveGameSlot('tap', files('tap', 'round'))).toBe('tap');
    expect(resolveGameSlot('icy', files('tap', 'round'))).toBe('round');
    expect(resolveGameSlot('icy', files('tap'))).toBeNull();
  });
});

describe('planMusic', () => {
  it('plays the lobby song in the lobby and pauses it under a video', () => {
    const p = planMusic(input({ phase: 'lobby', round: null }));
    expect(p).toMatchObject({ slot: 'lobby', key: 'lobby', run: 'play', volume: MUSIC.lobby.volume, nextAt: null });
    expect(planMusic(input({ phase: 'lobby', round: null, cutscene: true })).run).toBe('pause');
    expect(planMusic(input({ phase: 'lobby', round: null, hasFile: files('tap') })).slot).toBeNull();
  });

  it('is silent while the sound check is open, in results and on the podium', () => {
    expect(planMusic(input({ phase: 'lobby', round: null, soundCheck: true })).slot).toBeNull();
    expect(planMusic(input({ phase: 'results' })).slot).toBeNull();
    expect(planMusic(input({ phase: 'final', round: null })).slot).toBeNull();
    expect(planMusic(input({ phase: null, round: null })).slot).toBeNull();
  });

  it("starts the game's song ducked at startSec when the intro begins", () => {
    const p = planMusic(input({ now: 0 }));
    expect(p).toMatchObject({ slot: 'tap', run: 'play', ducked: true, volume: MUSIC.tap.introVolume, nextAt: 10_000 });
    expect(p.positionSec).toBeCloseTo(MUSIC.tap.startSec, 6);
    expect(planMusic(input({ phase: 'countdown', now: 8_000 })).positionSec).toBeCloseTo(MUSIC.tap.startSec + 8, 6);
  });

  it('goes to the full level once the round starts', () => {
    const p = planMusic(input({ phase: 'playing', now: 25_000 }));
    expect(p).toMatchObject({ ducked: false, volume: MUSIC.tap.volume, nextAt: null });
    expect(p.positionSec).toBeCloseTo(MUSIC.tap.startSec + 25, 6);
    // the countdown phase that the server has not left yet, at startAt: full already (by the clock)
    expect(planMusic(input({ phase: 'countdown', now: 10_000 })).ducked).toBe(false);
  });

  it('falls back to round.mp3 with its own tuning, then to silence', () => {
    const r = round({ gameId: 'ninja' });
    const p = planMusic(input({ phase: 'playing', round: r, now: 20_000 }));
    expect(p).toMatchObject({ slot: 'round', volume: MUSIC.round.volume });
    expect(planMusic(input({ phase: 'playing', round: r, now: 20_000, hasFile: files('lobby') })).slot).toBeNull();
  });

  it('pauses during a freeze at the position of the freeze, whatever the wall clock says', () => {
    const r = round({ frozenAt: 30_000 });
    for (const now of [30_000, 45_000, 99_000]) {
      const p = planMusic(input({ phase: 'playing', round: r, now, cutscene: true }));
      expect(p.run).toBe('pause');
      expect(p.positionSec).toBeCloseTo(MUSIC.tap.startSec + 30, 6);
    }
    // frozenAt without a cutscene (any reason) pauses too
    expect(planMusic(input({ phase: 'playing', round: r, now: 40_000 })).run).toBe('pause');
  });

  it('continues from the freeze point, ducked until resumeAt, then full', () => {
    // frozen at 30 s for 12 s; the server shifted the round by 12 s + the 3 s 3-2-1
    const r = round({ startAt: 25_000, endAt: 85_000, resumeAt: 45_000 });
    const during = planMusic(input({ phase: 'playing', round: r, now: 42_000 }));
    expect(during).toMatchObject({ run: 'play', ducked: true, volume: MUSIC.tap.introVolume, nextAt: 45_000 });
    expect(during.positionSec).toBeCloseTo(MUSIC.tap.startSec + 30, 6);
    const after = planMusic(input({ phase: 'playing', round: { ...r, resumeAt: null }, now: 46_000 }));
    expect(after).toMatchObject({ ducked: false, volume: MUSIC.tap.volume, nextAt: null });
    expect(after.positionSec).toBeCloseTo(MUSIC.tap.startSec + 31, 6);
  });

  it('keeps one key through a round (pause / duck do not restart) and changes it for a new round', () => {
    const a = planMusic(input({ now: 0 })).key;
    expect(planMusic(input({ phase: 'playing', now: 30_000 })).key).toBe(a);
    expect(planMusic(input({ phase: 'playing', now: 30_000, round: round({ frozenAt: 30_000 }), cutscene: true })).key).toBe(a);
    expect(planMusic(input({ round: round({ index: 3, seed: 9 }) })).key).not.toBe(a);
  });
});

describe('preludeOf / songElapsedMs', () => {
  it('reads the intro + countdown length from the first snapshot, also when created frozen', () => {
    expect(preludeOf(round({ startAt: 3_000 }), 0)).toBe(3_000);
    expect(preludeOf(round({ frozenAt: 0 }), 50_000)).toBe(10_000);
    expect(preludeOf(round(), 99_000)).toBe(0);
    expect(DEFAULT_PRELUDE_MS).toBe(INTRO_MS + COUNTDOWN_MS);
  });

  it('counts from the intro and never goes negative', () => {
    expect(songElapsedMs(round(), 0, PRELUDE)).toBe(0);
    expect(songElapsedMs(round(), 40_000, PRELUDE)).toBe(40_000);
    expect(songElapsedMs(round(), 4_000, 3_000)).toBe(0);
  });
});
