/**
 * Plotzel (word ladder to פלוץ): the port in client/src/games/plotzel/ladder.ts
 * against the owner's original source, an independent brute-force BFS, the
 * seeded round sequence and the scoring table.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COMMON, DICT, STARTS } from '../../client/src/games/plotzel/data';
import { checkStep, diffCount, diffPos, disp, getLadder, norm, TARGET, TARGET_D, unpack } from '../../client/src/games/plotzel/ladder';
import { DEMO_WORDS, ladderScore, OPENER, parBand, roundSequence, SCORE } from '../../client/src/games/plotzel/round';
import { GAMES } from '../../shared/protocol';

const ORIGINAL = resolve(import.meta.dirname, '../../client/src/games/plotzel/original/plotzel.netlify.app.html');
const HEB = 'אבגדהוזחטיכלמנסעפצקרשת';

function originalData(): { dict: string; common: string; starts: string } {
  const line = readFileSync(ORIGINAL, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('const DATA = '));
  if (line === undefined) throw new Error('DATA line not found in the original');
  return JSON.parse(line.slice('const DATA = '.length).replace(/;\s*$/, '')) as { dict: string; common: string; starts: string };
}

/** The original's graph code, copied as-is (string buckets, string Maps), as the reference. */
function originalGraph(): { DIST: Map<string, number>; CDIST: Map<string, number>; bestNext: (w: string) => string | null; neighbors: (w: string) => string[] } {
  const DICTSET = new Set(unpack(DICT));
  const RANK = new Map(unpack(COMMON).map((w, i) => [w, i] as const));
  const rank = (w: string): number => RANK.get(w) ?? 1e9;
  const keysOf = (w: string): string[] => [0, 1, 2, 3].map((i) => w.slice(0, i) + '_' + w.slice(i + 1));
  const buckets = new Map<string, string[]>();
  for (const w of DICTSET)
    for (const k of keysOf(w)) {
      let a = buckets.get(k);
      if (!a) buckets.set(k, (a = []));
      a.push(w);
    }
  const neighbors = (w: string): string[] => {
    const out: string[] = [];
    for (const k of keysOf(w)) for (const n of buckets.get(k) ?? []) if (n !== w) out.push(n);
    return out;
  };
  const bfs = (allowed: (w: string) => boolean): Map<string, number> => {
    const d = new Map([[TARGET, 0]]);
    const q = [TARGET];
    for (let h = 0; h < q.length; h++) {
      const w = q[h] as string;
      for (const n of neighbors(w))
        if (!d.has(n) && allowed(n)) {
          d.set(n, (d.get(w) ?? 0) + 1);
          q.push(n);
        }
    }
    return d;
  };
  const DIST = bfs(() => true);
  const isCommon = (n: string): boolean => n === TARGET || RANK.has(n);
  const CDIST = bfs(isCommon);
  const bestNext = (w: string): string | null => {
    const d = DIST.get(w) ?? NaN;
    const common = CDIST.get(w) === d;
    let best: string | null = null;
    for (const n of neighbors(w)) {
      if (common ? !isCommon(n) || CDIST.get(n) !== d - 1 : DIST.get(n) !== d - 1) continue;
      if (best === null || rank(n) < rank(best) || (rank(n) === rank(best) && n < best)) best = n;
    }
    return best;
  };
  return { DIST, CDIST, bestNext, neighbors };
}

/** Independent BFS from `start` to the goal: neighbors by trying every letter in every position. */
const DICT_SET = new Set(unpack(DICT));
function bruteDistance(start: string, allowed: (w: string) => boolean): number | undefined {
  const dict = DICT_SET;
  if (!dict.has(start)) return undefined;
  const seen = new Set([start]);
  let frontier = [start];
  for (let d = 0; frontier.length > 0; d++) {
    if (frontier.includes(TARGET)) return d;
    const next: string[] = [];
    for (const w of frontier)
      for (let p = 0; p < 4; p++)
        for (const c of HEB) {
          const n = w.slice(0, p) + c + w.slice(p + 1);
          if (n !== w && dict.has(n) && !seen.has(n) && allowed(n)) {
            seen.add(n);
            next.push(n);
          }
        }
    frontier = next;
  }
  return undefined;
}

const ladder = getLadder();
const ref = originalGraph();

describe('plotzel data', () => {
  it('is the original DATA, verbatim', () => {
    const o = originalData();
    expect(DICT).toBe(o.dict);
    expect(COMMON).toBe(o.common);
    expect(STARTS).toBe(o.starts);
  });

  it('unpacks to the original sizes', () => {
    expect(unpack(DICT)).toHaveLength(22468);
    expect(unpack(COMMON)).toHaveLength(8999);
    expect(unpack(STARTS)).toHaveLength(599);
    expect(ladder.dictSize).toBe(22468);
    expect(ladder.commonSize).toBe(8999);
    expect(ladder.starts).toHaveLength(599);
    expect(ladder.has(TARGET)).toBe(true);
    expect(unpack(DICT).every((w) => w.length === 4 && [...w].every((c) => HEB.includes(c)))).toBe(true);
  });
});

describe('plotzel letters', () => {
  it('disp puts only the 4th letter in its final form', () => {
    expect(TARGET_D).toBe('פלוץ');
    expect(disp('פלוצ')).toBe('פלוץ');
    expect(disp('חלומ')).toBe('חלום');
    expect(disp('חלונ')).toBe('חלון');
    expect(disp('ארוכ')).toBe('ארוך');
    expect(disp('אלופ')).toBe('אלוף');
    expect(disp('מכמנ')).toBe('מכמן'); // the inner מ and כ stay regular
    expect(disp('פשוט')).toBe('פשוט'); // no final form
    expect(disp('פלו')).toBe('פלו'); // a partial word is shown as typed
    expect(disp('')).toBe('');
  });

  it('norm turns every final letter back', () => {
    expect(norm('פלוץ')).toBe('פלוצ');
    expect(norm('ךםןףץ')).toBe('כמנפצ');
    expect(norm('חלום')).toBe('חלומ');
    expect(norm(disp('ארוכ'))).toBe('ארוכ');
    expect(diffCount('חלומ', 'חלוצ')).toBe(1);
    expect(diffPos('חלומ', 'חלוצ')).toBe(3);
    expect(diffPos('פלוצ', 'פלוצ')).toBe(-1);
  });
});

describe('plotzel graph', () => {
  const sample = [...ladder.starts.slice(0, 40), ...roundSequence(1, ladder).slice(0, 12), 'חלומ', 'פשוט', 'ערוצ'];

  it('par (BFS) equals an independent brute-force BFS', () => {
    const picks = [...new Set(sample)].slice(0, 14);
    expect(picks.length).toBeGreaterThanOrEqual(10);
    for (const w of picks) {
      expect(ladder.dist(w), disp(w)).toBe(bruteDistance(w, () => true));
      expect(ladder.cdist(w), disp(w)).toBe(bruteDistance(w, (n) => n === TARGET || ladder.isCommon(n)));
    }
  }, 60_000);

  it('DIST, CDIST, neighbors and bestNext equal the original code', () => {
    let reached = 0;
    for (const w of unpack(DICT)) {
      expect(ladder.dist(w)).toBe(ref.DIST.get(w));
      expect(ladder.cdist(w)).toBe(ref.CDIST.get(w));
      if (ref.DIST.has(w)) reached++;
    }
    expect(reached).toBe(22428);
    const words = unpack(DICT);
    for (let i = 0; i < words.length; i += 37) {
      const w = words[i] as string;
      expect(ladder.neighbors(w)).toEqual(ref.neighbors(w));
      if (ref.DIST.has(w) && w !== TARGET) expect(ladder.bestNext(w), disp(w)).toBe(ref.bestNext(w));
    }
  }, 60_000);

  it('every shortestPath step is a one-letter change to a dictionary word and ends at פלוץ', () => {
    for (const w of new Set([...ladder.starts, ...roundSequence(7, ladder).slice(0, 30)])) {
      const p = ladder.shortestPath(w);
      expect(p[0]).toBe(w);
      expect(p[p.length - 1]).toBe(TARGET);
      expect(p.length - 1).toBe(ladder.dist(w));
      for (let i = 1; i < p.length; i++) {
        expect(diffCount(p[i] as string, p[i - 1] as string)).toBe(1);
        expect(ladder.has(p[i] as string)).toBe(true);
      }
    }
    expect(ladder.shortestPath(TARGET)).toEqual([TARGET]);
  });
});

describe('plotzel step validation (the original submit)', () => {
  const words = ['חלומ'];
  it('rejects with the same reasons and messages', () => {
    expect(checkStep(ladder, 'חלו', words)).toEqual({ ok: false, reason: 'short', message: 'צריך 4 אותיות' });
    expect(checkStep(ladder, '', words)).toMatchObject({ ok: false, reason: 'short' });
    expect(checkStep(ladder, 'חלומ', words)).toEqual({ ok: false, reason: 'same', message: 'זו אותה מילה' });
    expect(checkStep(ladder, 'פלוצ', words)).toEqual({ ok: false, reason: 'multi', message: 'משנים רק אות אחת בכל צעד' });
    expect(checkStep(ladder, 'חלומ'.slice(0, 3) + 'ת', ['חלומ'])).toMatchObject({ ok: true }); // חלות is a word
    const unknown = 'חלוא';
    expect(ladder.has(unknown)).toBe(false);
    expect(checkStep(ladder, unknown, words)).toEqual({ ok: false, reason: 'unknown', message: 'חלוא לא נמצאת במילון' });
    expect(checkStep(ladder, 'חלומ', ['חלומ', 'חלוצ'])).toEqual({ ok: false, reason: 'repeat', message: 'כבר השתמשתם בחלום' });
    expect(checkStep(ladder, 'חלוצ', words)).toEqual({ ok: true, word: 'חלוצ', solved: false });
    expect(checkStep(ladder, 'פלוצ', ['חלומ', 'חלוצ'])).toEqual({ ok: true, word: 'פלוצ', solved: true });
  });

  it('checks in the original order: same word before dictionary, dictionary before repeat', () => {
    expect(checkStep(ladder, 'חלוא', ['חלוא'])).toMatchObject({ reason: 'same' });
    expect(checkStep(ladder, 'חלאא', ['חלומ'])).toMatchObject({ reason: 'multi' });
  });
});

describe('plotzel round sequence', () => {
  it('is the same for the same seed and different for another seed', () => {
    expect(roundSequence(42, ladder).slice(0, 30)).toEqual(roundSequence(42, ladder).slice(0, 30));
    const a = roundSequence(1001, ladder).slice(0, 20).join();
    const b = roundSequence(1002, ladder).slice(0, 20).join();
    expect(a).not.toBe(b);
  });

  it('always opens with שימי (the owner\'s opener), a real 5-step ladder to פלוץ', () => {
    expect(OPENER).toBe('שימי');
    expect(ladder.has(OPENER)).toBe(true);
    expect(ladder.dist(OPENER)).toBe(5);
    const path = ladder.shortestPath(OPENER);
    expect(path[0]).toBe(OPENER);
    expect(path[path.length - 1]).toBe(TARGET);
    expect(path.length).toBe(6);
    for (const seed of [1, 7, 99, 123456, 987654321]) expect(roundSequence(seed, ladder)[0]).toBe(OPENER);
  });

  it('after the opener: no repeats, only words with a common path as short as par, and the par ramp from the easy end', () => {
    for (const seed of [1, 7, 99, 123456, 987654321]) {
      const seq = roundSequence(seed, ladder);
      expect(seq.length).toBeGreaterThan(300);
      expect(new Set(seq).size).toBe(seq.length);
      for (const w of DEMO_WORDS) expect(seq).not.toContain(w);
      seq.slice(1).forEach((w, i) => {
        const par = ladder.dist(w);
        expect(par).toBeDefined();
        expect(ladder.cdist(w)).toBe(par);
        if (i < 60) expect(parBand(i), `${seed}#${i + 1} ${disp(w)} par ${par}`).toContain(par);
      });
      expect(ladder.dist(seq[1] as string)).toBe(2);
    }
  });
});

describe('plotzel scoring', () => {
  it('follows the table', () => {
    expect(ladderScore(3, 3)).toBe(400); // perfect
    expect(ladderScore(4, 3)).toBe(350); // par + 1
    expect(ladderScore(5, 3)).toBe(300);
    expect(ladderScore(9, 3)).toBe(300);
    expect(ladderScore(5, 5)).toBe(SCORE.solve + SCORE.perfect); // the opener, solved in its 5 steps
    expect(ladderScore(6, 5)).toBe(SCORE.solve + SCORE.near);
  });

  it('maxRaw sits above what a fast expert can reach', () => {
    expect(GAMES.plotzel.maxRaw).toBeGreaterThan(20 * (SCORE.solve + SCORE.perfect));
    expect(GAMES.plotzel.durationMs).toBe(120_000);
  });
});
