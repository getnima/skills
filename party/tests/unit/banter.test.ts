// The hosts talking a round through on the TV: the lines (shape, voice, both hosts, any guest)
// and the director (when to talk, about whom, what is still true).
import { afterEach, describe, expect, it } from 'vitest';

import { BANTER, BANTER_KINDS, BANTER_PRIORITY, banterStillTrue, createBanterDirector, fillBanter, mentionsOf, resetBanterMemory } from '../../client/src/host/show/banter';
import { makeMoment, MOMENT_TYPES } from '../../client/src/host/show/moments';
import { NARRATION, POSES } from '../../client/src/host/show/narration';
import { GAME_IDS } from '../../shared/protocol';

import type { BanterEntry, BanterLine, BanterRace } from '../../client/src/host/show/banter';

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

const beats = BANTER_KINDS.flatMap((kind) => BANTER[kind].flatMap((take) => take.map((beat) => ({ ...beat, kind }))));
const who = (id: string, name = id): { id: string; name: string } => ({ id, name });
const entries = (...scores: number[]): BanterEntry[] => scores.map((score, i) => ({ id: `p${i}`, name: `P${i}`, score }));
const race = (extra: Partial<BanterRace> = {}): BanterRace => ({ gameId: 'tap', elimination: false, elapsedMs: 20_000, leftMs: 30_000, frozen: false, entries: entries(90, 70, 50, 30, 10), ...extra });

afterEach(() => resetBanterMemory());

describe('the lines', () => {
  it('has takes for every race moment but the last ten seconds, for the falls, the quiet and every game', () => {
    for (const kind of BANTER_KINDS) expect(BANTER[kind].length, kind).toBeGreaterThan(0);
    for (const m of MOMENT_TYPES) if (m !== 'final10') expect(BANTER_KINDS).toContain(m);
    for (const g of GAME_IDS) expect(BANTER[g].length, g).toBeGreaterThanOrEqual(2);
    expect(beats.length).toBeGreaterThanOrEqual(90);
  });

  it('keeps every line short enough for the margin under the timer, with only the two name slots', () => {
    for (const b of beats) {
      expect(b.text, b.text).toMatch(/[.!?]$/);
      expect(POSES).toContain(b.pose);
      expect(b.text.replace(/\{[ab]\}/g, '')).not.toMatch(/[{}]/);
      // a name of six letters in place of each slot
      expect(Array.from(b.text.replace(/\{[ab]\}/g, 'שמוליק')).length, b.text).toBeLessThanOrEqual(46);
    }
  });

  it('gives both hosts the same share, in banter pairs that start from either side', () => {
    const a = beats.filter((b) => b.host === 'a').length;
    const b = beats.filter((x) => x.host === 'b').length;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(6);
    const pairs = BANTER_KINDS.flatMap((k) => BANTER[k].filter((t) => t.length === 2));
    expect(pairs.length).toBeGreaterThanOrEqual(40);
    for (const t of pairs) expect(t[0]?.host).not.toBe(t[1]?.host);
    expect(pairs.some((t) => t[0]?.host === 'a')).toBe(true);
    expect(pairs.some((t) => t[0]?.host === 'b')).toBe(true);
  });

  it('names the guest the take is about in every take about somebody', () => {
    for (const kind of BANTER_KINDS) {
      if (kind === 'room') continue;
      for (const take of BANTER[kind]) expect(take.some((beat) => beat.text.includes('{a}')), `${kind}: ${take[0]?.text}`).toBe(true);
    }
    for (const take of BANTER.room) for (const beat of take) expect(beat.text).not.toMatch(/\{[ab]\}/);
  });

  it('fits any guest: a name is never the subject of a gendered verb', () => {
    const gendered = ['מוביל', 'מובילה', 'עוקף', 'עוקפת', 'עקף', 'עקפה', 'קפץ', 'קפצה', 'נפל', 'נפלה', 'חתך', 'חתכה', 'מנצח', 'מנצחת', 'עלה', 'עלתה', 'ירד', 'ירדה', 'טס', 'טסה', 'חזר', 'חזרה', 'אחרון', 'אחרונה', 'ראשון', 'ראשונה'];
    for (const b of beats) {
      for (const m of b.text.matchAll(/\{[ab]\}\s+([^\s.,!?]+)/g)) expect(gendered, b.text).not.toContain(m[1]);
      expect(b.text, b.text).not.toMatch(/(^|\s)אתה(\s|$)/);
    }
  });

  it("speaks in the owner's voice and keeps his rules", () => {
    const all = beats.map((b) => b.text).join(' ');
    for (const word of ['נודר', 'בן פורת יוסף!', 'מחורחר']) expect(all).toContain(word);
    for (const word of ['נזלת', 'חוטט', 'פלוץ ', 'גרבץ']) expect(all).not.toContain(word);
  });

  it('stays under the big moments of the show, so calm mode mutes it', () => {
    for (const kind of BANTER_KINDS) {
      expect(BANTER_PRIORITY[kind]).toBeLessThan(NARRATION.final10.priority);
      expect(BANTER_PRIORITY[kind]).toBeLessThanOrEqual(NARRATION.go.priority);
    }
  });

  it('fills the names', () => {
    expect(fillBanter('{a} מול {b}! צמוד!', { a: 'דנה', b: 'אבי' })).toBe('דנה מול אבי! צמוד!');
  });
});

describe('the director', () => {
  it('talks about a new leader, then waits before the next one', () => {
    const d = createBanterDirector(seeded(3));
    const first = d.moment(makeMoment('lead', who('p1'), who('p0')), 1_000);
    expect(first?.kind).toBe('lead');
    expect(first?.a?.id).toBe('p1');
    expect(BANTER.lead).toContain(first?.take);
    expect(d.moment(makeMoment('lead', who('p2'), who('p1')), 4_000)).toBeNull();
    expect(d.moment(makeMoment('lead', who('p2'), who('p1')), 9_000)).not.toBeNull();
    // the demo's buttons skip the waits
    expect(d.moment(makeMoment('lead', who('p3'), who('p2')), 9_100, true)).not.toBeNull();
    expect(d.moment(makeMoment('final10'), 9_200, true)).toBeNull();
  });

  it('leaves a guest alone for a few seconds after a jab, unless they are the news', () => {
    const d = createBanterDirector(seeded(5));
    expect(d.moment(makeMoment('zero', who('p4')), 1_000)).not.toBeNull();
    expect(d.moment(makeMoment('jump', who('p4')), 2_000)).toBeNull();
    expect(d.moment(makeMoment('lead', who('p4'), who('p0')), 2_100)).not.toBeNull();
    expect(d.moment(makeMoment('jump', who('p4')), 12_000)).not.toBeNull();
  });

  it('only takes a line about a second guest when there is one', () => {
    for (let seed = 1; seed <= 30; seed++) {
      resetBanterMemory();
      const d = createBanterDirector(seeded(seed));
      for (let i = 0; i < 12; i++) {
        const line = d.moment(makeMoment('lead', who(`p${i}`)), i * 10_000);
        expect(line).not.toBeNull();
        expect(line?.b).toBeNull();
        for (const beat of line?.take ?? []) expect(beat.text).not.toContain('{b}');
      }
    }
  });

  it('deals every take of a kind before repeating, across the rounds, never the same twice in a row', () => {
    const n = BANTER.out.length;
    let last: unknown = null;
    const seen = new Set<unknown>();
    for (let round = 0; round < 4; round++) {
      const d = createBanterDirector(seeded(11 + round));
      for (let i = 0; i < n; i++) {
        const line = d.out(who(`p${round}${i}`), false, i * 3_000);
        expect(line).not.toBeNull();
        expect(line?.take).not.toBe(last);
        last = line?.take;
        if (round === 0) seen.add(line?.take);
      }
    }
    expect(seen.size).toBe(n);
  });

  it('puts a take that went unsaid back, so it is said next and nobody counts as named', () => {
    const d = createBanterDirector(seeded(21));
    const first = d.out(who('p1'), false, 1_000);
    expect(first).not.toBeNull();
    expect(mentionsOf('p1')).toBe(1);
    if (first === null) return;
    d.unsay(first);
    expect(mentionsOf('p1')).toBe(0);
    // no wait either: nothing was said
    const again = d.out(who('p2'), false, 1_100);
    expect(again?.take).toBe(first.take);
  });

  it('says the first fall as such, and a burst of falls once', () => {
    const d = createBanterDirector(seeded(7));
    expect(d.out(who('p1'), true, 1_000)?.kind).toBe('firstOut');
    expect(d.out(who('p2'), false, 1_100)?.kind).toBe('out');
    expect(d.out(who('p3'), false, 1_300)).toBeNull();
    expect(d.out(who('p3'), false, 4_000)?.kind).toBe('out');
  });

  it('fills a quiet race, but not too early, not at the end, not frozen, not while the hosts talk', () => {
    const d = createBanterDirector(seeded(9));
    expect(d.ambient(race(), 2_000, 1_000)).toBeNull();
    expect(d.ambient(race({ elapsedMs: 3_000 }), 5_000, 1_000)).toBeNull();
    expect(d.ambient(race({ leftMs: 10_000 }), 5_000, 1_000)).toBeNull();
    expect(d.ambient(race({ frozen: true }), 5_000, 1_000)).toBeNull();
    expect(d.ambient(race(), 5_000, 1_000)).not.toBeNull();
    // a take still waiting for room on the screen is not doubled
    expect(d.ambient(race(), 5_000, 2_000)).toBeNull();
    expect(d.ambient(race(), 5_000, 6_000)).not.toBeNull();
  });

  it('gets around to everybody, and never names somebody who fell', () => {
    const d = createBanterDirector(seeded(13));
    const list = entries(90, 80, 70, 60, 50, 40, 30, 20);
    const named = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const line = d.ambient(race({ entries: list }), 5_000, i * 5_000);
      if (line?.a) named.add(line.a.id);
    }
    expect(named.size).toBe(list.length);
    const counts = list.map((e) => mentionsOf(e.id));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(6);

    resetBanterMemory();
    const d2 = createBanterDirector(seeded(17));
    const air: BanterEntry[] = list.map((e, i) => ({ ...e, score: 0, out: i % 2 === 0 }));
    for (let i = 0; i < 30; i++) {
      const line = d2.ambient(race({ gameId: 'flappy', elimination: true, entries: air }), 5_000, i * 5_000);
      expect(line).not.toBeNull();
      if (line?.a) expect(air.find((e) => e.id === line.a?.id)?.out).toBe(false);
      expect(['flappy', 'room']).toContain(line?.kind);
    }
  });
});

describe('still true when its turn comes', () => {
  const line = (kind: BanterLine['kind'], a: string | null, b: string | null = null): BanterLine => ({ kind, index: 0, take: [], a: a === null ? null : who(a), b: b === null ? null : who(b), priority: 4 });

  it('drops a leader, an overtake, a zero or a last place that is no longer so', () => {
    const now = entries(90, 70, 0);
    expect(banterStillTrue(line('lead', 'p0'), now)).toBe(true);
    expect(banterStillTrue(line('lead', 'p1'), now)).toBe(false);
    expect(banterStillTrue(line('overtake', 'p0', 'p1'), now)).toBe(true);
    expect(banterStillTrue(line('overtake', 'p1', 'p0'), now)).toBe(false);
    expect(banterStillTrue(line('zero', 'p2'), now)).toBe(true);
    expect(banterStillTrue(line('zero', 'p1'), now)).toBe(false);
    expect(banterStillTrue(line('last', 'p2'), now)).toBe(true);
    expect(banterStillTrue(line('last', 'p1'), now)).toBe(false);
    expect(banterStillTrue(line('room', null), now)).toBe(true);
    // somebody who left the room is not talked about
    expect(banterStillTrue(line('jump', 'gone'), now)).toBe(false);
  });

  it('never talks about somebody who fell as if still in the air', () => {
    const air: BanterEntry[] = [
      { id: 'p0', name: 'P0', score: 0 },
      { id: 'p1', name: 'P1', score: 0, out: true },
    ];
    expect(banterStillTrue(line('flappy', 'p0'), air)).toBe(true);
    expect(banterStillTrue(line('flappy', 'p1'), air)).toBe(false);
    expect(banterStillTrue(line('out', 'p1'), air)).toBe(true);
  });
});
