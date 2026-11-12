// The hosts' narration on the TV: the script, the queue, the rotation of the variants, the mic.
import { afterEach, describe, expect, it } from 'vitest';

import { micAvailable, micHolder, onMicFree, releaseMic, resetMic, takeMic } from '../../client/src/host/show/mic';
import {
  allBeats,
  beatHoldMs,
  createNarrationQueue,
  createTakePicker,
  introMoment,
  NARRATION,
  NARRATION_MOMENTS,
  POSES,
} from '../../client/src/host/show/narration';
import { cueNarration, isNarratorOn, registerNarrator } from '../../client/src/host/show/narrator-bus';
import { GAME_IDS } from '../../shared/protocol';

import type { NarrationCue, NarrationMoment } from '../../client/src/host/show/narration';

/** Deterministic random in [0, 1). */
function seeded(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

const cue = (id: string, moment: NarrationMoment, at: number, extra: Partial<NarrationCue> = {}): NarrationCue => ({ id, moment, at, ttlMs: 4_000, ...extra });

describe('the script', () => {
  const beats = allBeats();

  it('has 30 to 40 short lines, every moment at least one take', () => {
    expect(beats.length).toBeGreaterThanOrEqual(30);
    expect(beats.length).toBeLessThanOrEqual(40);
    for (const m of NARRATION_MOMENTS) expect(NARRATION[m].takes.length).toBeGreaterThan(0);
    for (const b of beats) {
      expect(Array.from(b.text).length).toBeLessThanOrEqual(55);
      expect(b.text).toMatch(/[.!?]$/);
      expect(POSES).toContain(b.pose);
    }
  });

  it('never puts a guest name inside a line (no placeholders)', () => {
    for (const b of beats) expect(b.text).not.toMatch(/[{}]/);
  });

  it('splits the lines between the two hosts, with banter pairs where A sets up and B answers', () => {
    const a = beats.filter((b) => b.host === 'a').length;
    const b = beats.filter((x) => x.host === 'b').length;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(4);
    const pairs = NARRATION_MOMENTS.flatMap((m) => NARRATION[m].takes.filter((t) => t.length === 2));
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    for (const t of pairs) expect(t.map((x) => x.host)).toEqual(['a', 'b']);
  });

  it("keeps the owner's exclamations", () => {
    const all = beats.map((b) => b.text).join(' ');
    for (const word of ['נודר', 'צדיק!', 'בן פורת יוסף!', 'וואו', 'מחורחר!', 'אחשילי']) expect(all).toContain(word);
  });

  it('has an intro for every game, and the plotzel one starts from חמוד', () => {
    for (const g of GAME_IDS) expect(NARRATION[introMoment(g)].takes.length).toBeGreaterThan(0);
    expect(NARRATION.intro_plotzel.takes[0]?.[0]?.text).toContain('מחמוד לפלוץ');
    expect(NARRATION.intro_ninja.takes.flat().map((b) => b.text).join(' ')).toContain('הפצצות');
  });

  it('holds a beat about 3 to 4 seconds', () => {
    for (const b of beats) {
      expect(beatHoldMs(b.text)).toBeGreaterThanOrEqual(2_800);
      expect(beatHoldMs(b.text)).toBeLessThanOrEqual(4_000);
    }
  });
});

describe('rotation', () => {
  it('never gives the same take twice in a row, and deals every take before repeating', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const picker = createTakePicker(seeded(seed));
      for (const m of NARRATION_MOMENTS) {
        const n = NARRATION[m].takes.length;
        let last = -1;
        const firstRound = new Set<number>();
        for (let i = 0; i < n * 6; i++) {
          const p = picker.pick(m);
          expect(p).not.toBeNull();
          if (p === null) continue;
          if (i < n) firstRound.add(p.index);
          if (n > 1) expect(p.index).not.toBe(last);
          last = p.index;
        }
        expect(firstRound.size).toBe(n);
      }
    }
  });
});

describe('the queue', () => {
  it('says the highest priority first, then the oldest', () => {
    const q = createNarrationQueue();
    q.offer(cue('go', 'go', 0), 0);
    q.offer(cue('reveal', 'reveal', 10), 10);
    q.offer(cue('standings', 'standings', 5), 10);
    q.offer(cue('final10', 'final10', 20, { priority: 9 }), 20);
    // reveal (9) and final10 (9 by override): the older one first
    expect(q.next(30)?.id).toBe('reveal');
    expect(q.next(30)?.id).toBe('final10');
    expect(q.next(30)?.id).toBe('go');
    expect(q.next(30)?.id).toBe('standings');
    expect(q.next(30)).toBeNull();
  });

  it('fires each moment once', () => {
    const q = createNarrationQueue();
    expect(q.offer(cue('intro:3', 'intro_tap', 0), 0)).toBe(true);
    expect(q.offer(cue('intro:3', 'intro_tap', 100), 100)).toBe(false);
    expect(q.next(200)?.id).toBe('intro:3');
    expect(q.offer(cue('intro:3', 'intro_tap', 300), 300)).toBe(false);
    expect(q.next(300)).toBeNull();
    expect(q.seen('intro:3')).toBe(true);
  });

  it('drops a cue whose turn comes too late', () => {
    const q = createNarrationQueue();
    q.offer(cue('go', 'go', 0, { ttlMs: 1_000 }), 0);
    expect(q.next(1_500)).toBeNull();
    expect(q.size()).toBe(0);
    // already stale when offered
    expect(q.offer(cue('late', 'go', 0, { ttlMs: 1_000 }), 5_000)).toBe(false);
  });

  it('drops a cue that is no longer true when its turn comes', () => {
    const q = createNarrationQueue();
    let stillIntro = true;
    q.offer(cue('intro', 'intro_icy', 0, { valid: () => stillIntro }), 0);
    q.offer(cue('go', 'go', 0), 0);
    stillIntro = false;
    expect(q.next(100)?.id).toBe('go');
    expect(q.next(100)).toBeNull();
  });

  it('lets the best cue wait in the queue (peek) until there is room for it', () => {
    const q = createNarrationQueue();
    q.offer(cue('arrive', 'arrive', 0, { ttlMs: 25_000 }), 0);
    expect(q.peek(1_000)?.id).toBe('arrive');
    expect(q.peek(5_000)?.id).toBe('arrive');
    expect(q.size()).toBe(1);
    expect(q.next(6_000)?.id).toBe('arrive');
    expect(q.peek(6_000)).toBeNull();
    // and it still expires
    q.offer(cue('late', 'arrive', 0, { ttlMs: 2_000 }), 0);
    expect(q.peek(2_500)).toBeNull();
  });

  it('keeps at most a few cues, dropping the least important', () => {
    const q = createNarrationQueue(3);
    q.offer(cue('a', 'standings', 0), 0); // 5
    q.offer(cue('b', 'reveal', 1), 1); // 9
    q.offer(cue('c', 'arrive', 2), 2); // 5
    q.offer(cue('d', 'podium', 3), 3); // 8
    expect(q.size()).toBe(3);
    const order = [q.next(10)?.id, q.next(10)?.id, q.next(10)?.id];
    expect(order).toEqual(['b', 'd', 'a']);
  });
});

describe('the mic', () => {
  afterEach(() => resetMic());

  it('lets the narrator cut an ordinary commentator line', () => {
    let cut = 0;
    const c = takeMic('commentator', { yieldNow: () => cut++ });
    expect(c).not.toBeNull();
    expect(micHolder()).toBe('commentator');
    const n = takeMic('narrator');
    expect(n).not.toBeNull();
    expect(cut).toBe(1);
    expect(micHolder()).toBe('narrator');
    // the old token cannot release the narrator's mic
    releaseMic(c);
    expect(micHolder()).toBe('narrator');
    releaseMic(n);
    expect(micHolder()).toBeNull();
  });

  it('never cuts a ceremony line, and never lets the commentator cut the hosts', () => {
    const c = takeMic('commentator', { firm: true, yieldNow: () => undefined });
    expect(micAvailable('narrator')).toBe(false);
    expect(takeMic('narrator')).toBeNull();
    let freed = 0;
    onMicFree(() => freed++);
    releaseMic(c);
    expect(freed).toBe(1);
    const n = takeMic('narrator');
    expect(micAvailable('commentator')).toBe(false);
    expect(takeMic('commentator')).toBeNull();
    releaseMic(n);
    expect(micAvailable('commentator')).toBe(true);
    expect(freed).toBe(1);
  });
});

describe('the bus', () => {
  it('has no narrator until one registers', () => {
    expect(isNarratorOn()).toBe(false);
    expect(cueNarration({ id: 'x', moment: 'go', ttlMs: 1 })).toBe(false);
    const got: string[] = [];
    const off = registerNarrator((c) => got.push(c.id));
    expect(isNarratorOn()).toBe(true);
    expect(cueNarration({ id: 'y', moment: 'go', ttlMs: 1 })).toBe(true);
    off();
    expect(isNarratorOn()).toBe(false);
    expect(got).toEqual(['y']);
  });
});
