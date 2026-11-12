import { describe, expect, it } from 'vitest';

import { chaseParts, chaseText, liveStanding, plainChase, shortName } from '../../client/src/play/standing';

import type { ScoresList } from '../../client/src/play/standing';

const NAMES: Record<string, string> = {
  a: 'דנה',
  b: 'רון',
  c: 'Mike',
  d: '🦄 יוני',
  e: 'אביגיל-רוזנבלום',
  f: 'Maximilian1234',
};
const nameOf = (id: string): string | undefined => NAMES[id];

const LIST: ScoresList = [
  ['a', 300],
  ['b', 260],
  ['c', 260],
  ['d', 40],
  ['e', 0],
];

describe('liveStanding', () => {
  it('first: place 1, leads the next by the gap', () => {
    const s = liveStanding(LIST, 'a', nameOf);
    expect(s).toEqual({ place: 1, count: 5, score: 300, chase: { kind: 'lead', rival: { id: 'b', name: 'רון', gap: 40 } } });
    expect(plainChase(chaseText(s?.chase ?? null))).toBe('מוביל/ה! +40 על רון');
  });

  it('middle: chases the player just ahead', () => {
    const s = liveStanding(LIST, 'd', nameOf);
    expect(s?.place).toBe(4);
    expect(s?.count).toBe(5);
    expect(s?.chase).toEqual({ kind: 'behind', rival: { id: 'c', name: 'Mike', gap: 220 } });
    expect(plainChase(chaseText(s?.chase ?? null))).toBe('עוד 220 ל־Mike');
  });

  it('last: chases the one above, even on 0', () => {
    const s = liveStanding(LIST, 'e', nameOf);
    expect(s?.place).toBe(5);
    expect(s?.chase).toEqual({ kind: 'behind', rival: { id: 'd', name: '🦄 יוני', gap: 40 } });
  });

  it('alone: a place, no chase', () => {
    expect(liveStanding([['a', 12]], 'a', nameOf)).toEqual({ place: 1, count: 1, score: 12, chase: null });
  });

  it('not in the list (joined late): null', () => {
    expect(liveStanding(LIST, 'zz', nameOf)).toBeNull();
    expect(liveStanding([], 'a', nameOf)).toBeNull();
  });

  it('equal scores keep the order the server gave (who reached it first is ahead)', () => {
    const b = liveStanding(LIST, 'b', nameOf);
    const c = liveStanding(LIST, 'c', nameOf);
    expect(b?.place).toBe(2);
    expect(c?.place).toBe(3);
    expect(c?.chase).toEqual({ kind: 'behind', rival: { id: 'b', name: 'רון', gap: 0 } });
    expect(plainChase(chaseText(c?.chase ?? null))).toBe('צמוד ל־רון!');
    // the same pairs in the other order: the other way round
    const flipped: ScoresList = [
      ['c', 260],
      ['b', 260],
    ];
    expect(liveStanding(flipped, 'b', nameOf)?.place).toBe(2);
    expect(liveStanding(flipped, 'c', nameOf)?.chase).toEqual({ kind: 'lead', rival: { id: 'b', name: 'רון', gap: 0 } });
    expect(plainChase(chaseText(liveStanding(flipped, 'c', nameOf)?.chase ?? null))).toBe('מוביל/ה! רון צמוד/ה');
  });

  it('nobody scored yet: places by join order, no chase line', () => {
    const zero: ScoresList = [
      ['a', 0],
      ['b', 0],
    ];
    expect(liveStanding(zero, 'b', nameOf)).toEqual({ place: 2, count: 2, score: 0, chase: null });
    expect(liveStanding(zero, 'a', nameOf)?.chase).toBeNull();
  });

  it('names: long ones are cut by graphemes, emoji / Latin kept, unknown ids get a placeholder', () => {
    const list: ScoresList = [
      ['f', 90],
      ['e', 50],
      ['x', 10],
    ];
    expect(liveStanding(list, 'e', nameOf)?.chase?.rival.name).toBe('Maximilian1…');
    expect(liveStanding(list, 'f', nameOf)?.chase?.rival.name).toBe('אביגיל-רוזנ…');
    expect(liveStanding(list, 'x', nameOf)?.chase?.rival.name).toBe('אביגיל-רוזנ…');
    expect(liveStanding([['x', 5], ['y', 1]], 'y', nameOf)?.chase?.rival.name).toBe('מישהו');
  });

  it('big gaps are grouped, the number is LTR-isolated and the name first-strong-isolated', () => {
    const s = liveStanding(
      [
        ['a', 12_345],
        ['c', 10],
      ],
      'a',
      nameOf,
    );
    const text = chaseText(s?.chase ?? null);
    expect(text).toBe('מוביל/ה! ⁦+12,335⁩ על ⁨Mike⁩');
    expect(chaseParts(s!.chase!)).toEqual({ lead: 'מוביל/ה! ', num: '+12,335', mid: ' על ', name: 'Mike', tail: '' });
    expect(chaseText(null)).toBe('');
  });
});

describe('shortName', () => {
  it('never splits an emoji', () => {
    expect(shortName('👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦', 3)).toBe('👨‍👩‍👧‍👦👨‍👩‍👧‍👦…');
    expect(shortName('אבג', 3)).toBe('אבג');
  });
  it('collapses spaces, empty becomes a placeholder', () => {
    expect(shortName('  רון   כהן ')).toBe('רון כהן');
    expect(shortName('   ')).toBe('מישהו');
  });
});
