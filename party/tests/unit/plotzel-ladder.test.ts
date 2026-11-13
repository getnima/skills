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
import { DEMO_WORDS, EASY_AFTER, ladderScore, OPENERS, OPENING_LENGTH, parBand, roundSequence, SCORE, speedFactor, startPar, startPath, stepsFactor } from '../../client/src/games/plotzel/round';
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
    // (startPath / startPar cover the openers, one of which is outside the dictionary)
    for (const w of new Set([...ladder.starts, ...roundSequence(7, ladder).slice(0, 30)])) {
      const p = startPath(ladder, w);
      expect(p[0]).toBe(w);
      expect(p[p.length - 1]).toBe(TARGET);
      expect(p.length - 1).toBe(startPar(ladder, w));
      for (let i = 1; i < p.length; i++) {
        expect(diffCount(p[i] as string, p[i - 1] as string)).toBe(1);
        expect(ladder.has(p[i] as string)).toBe(true);
      }
      if (ladder.has(w)) expect(p).toEqual(ladder.shortestPath(w));
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

  it('opens with the owner\'s four words in order, an easy word on each side of פוקי: חמוד, easy, פוקי, easy, נדיר, שימי', () => {
    expect(OPENERS).toEqual(['חמוד', 'פוקי', 'נדיר', 'שימי']);
    expect(EASY_AFTER).toEqual([1, 1, 0, 0]);
    expect(OPENING_LENGTH).toBe(6);
    const easy = new Set<string>();
    for (const seed of [1, 7, 99, 123456, 987654321]) {
      const head = roundSequence(seed, ladder).slice(0, OPENING_LENGTH);
      expect([head[0], head[2], head[4], head[5]]).toEqual([...OPENERS]);
      // the two words in between: two steps from the goal, through common words, and not the same word twice
      for (const w of [head[1] as string, head[3] as string]) {
        expect(ladder.dist(w), disp(w)).toBe(2);
        expect(ladder.cdist(w), disp(w)).toBe(2);
        expect(OPENERS).not.toContain(w);
        easy.add(w);
      }
      expect(head[1]).not.toBe(head[3]);
    }
    // drawn by the seed: not the same pair in every round
    expect(easy.size).toBeGreaterThan(2);
    // the minimum steps of each
    expect(OPENERS.map((w) => startPar(ladder, w))).toEqual([3, 5, 5, 5]);
    // every opener has a real way to פלוץ, one letter at a time, through dictionary words after the start
    for (const w of OPENERS) {
      const path = startPath(ladder, w);
      expect(path[0]).toBe(w);
      expect(path[path.length - 1]).toBe(TARGET);
      expect(path.length - 1).toBe(startPar(ladder, w));
      for (let k = 1; k < path.length; k++) {
        expect(ladder.has(path[k] as string), `${disp(path[k] as string)} in the dictionary`).toBe(true);
        expect(diffCount(path[k] as string, path[k - 1] as string)).toBe(1);
      }
    }
  });

  it('פוקי is not in the dictionary but still starts a ladder: its first step must be a real word', () => {
    expect(ladder.has('פוקי')).toBe(false);
    expect(ladder.dist('פוקי')).toBeUndefined();
    expect(checkStep(ladder, 'פסקי', ['פוקי'])).toMatchObject({ ok: true });
    expect(checkStep(ladder, 'פוקא', ['פוקי'])).toMatchObject({ ok: false });
  });

  it('after the opening: no repeats, only words with a common path as short as par, and the par ramp from the easy end', () => {
    for (const seed of [1, 7, 99, 123456, 987654321]) {
      const seq = roundSequence(seed, ladder);
      expect(seq.length).toBeGreaterThan(300);
      expect(new Set(seq).size).toBe(seq.length);
      for (const w of DEMO_WORDS) expect(seq).not.toContain(w);
      seq.slice(OPENING_LENGTH).forEach((w, i) => {
        const par = ladder.dist(w);
        expect(par).toBeDefined();
        expect(ladder.cdist(w)).toBe(par);
        if (i < 60) expect(parBand(i), `${seed}#${i + OPENING_LENGTH} ${disp(w)} par ${par}`).toContain(par);
      });
      expect(ladder.dist(seq[OPENING_LENGTH] as string)).toBe(2);
    }
  });
});

describe('plotzel scoring: 80% time, 20% attempts (the owner\'s rule)', () => {
  it('a ladder is worth at most 1000: 800 for speed and 200 for steps', () => {
    expect(SCORE.ladder * SCORE.timeShare).toBe(800);
    expect(SCORE.ladder * SCORE.stepsShare).toBe(200);
    expect(SCORE.timeShare + SCORE.stepsShare).toBe(1);
    expect(ladderScore(3, 3, 0)).toBe(1000); // at once, in the minimum
  });

  it('the speed part runs down in a straight line over 15 s per step of par, then stays at 0', () => {
    expect(speedFactor(2, 0)).toBe(1);
    expect(speedFactor(2, 15_000)).toBe(0.5);
    expect(speedFactor(2, 30_000)).toBe(0);
    expect(speedFactor(2, 90_000)).toBe(0);
    expect(speedFactor(5, 30_000)).toBeCloseTo(0.6, 10); // שימי: 75 s
    expect(speedFactor(3, -5)).toBe(1);
    expect(ladderScore(2, 2, 15_000)).toBe(600); // 400 speed + 200 steps
    expect(ladderScore(2, 2, 30_000)).toBe(200); // steps only
    expect(ladderScore(2, 2, 999_999)).toBe(200);
  });

  it('the steps part is full for the minimum, then par / steps', () => {
    expect(stepsFactor(3, 3)).toBe(1);
    expect(stepsFactor(2, 3)).toBe(1); // cannot happen (par is the true minimum); never above 1
    expect(stepsFactor(6, 3)).toBe(0.5);
    expect(ladderScore(4, 3, 0)).toBe(950); // 800 + 200 x 3/4
    expect(ladderScore(6, 3, 0)).toBe(900);
    expect(ladderScore(5, 5, 37_500)).toBe(600); // the opener, half of its 75 s, in its 5 steps
  });

  it('time weighs four times as much as steps, and a solved ladder is never worth 0', () => {
    // all the time gone, perfect steps = 200; no time gone, endless steps tends to 800
    expect(ladderScore(3, 3, 10 ** 9)).toBe(200);
    expect(ladderScore(3000, 3, 0)).toBe(800);
    expect(ladderScore(3000, 3, 10 ** 9)).toBeGreaterThanOrEqual(1);
    // faster is never worse, fewer steps is never worse
    for (const par of [2, 3, 4, 5]) {
      let prev = Infinity;
      for (let ms = 0; ms <= 100_000; ms += 250) {
        const v = ladderScore(par, par, ms);
        expect(v).toBeLessThanOrEqual(prev);
        prev = v;
      }
      for (let steps = par; steps < par + 8; steps++) expect(ladderScore(steps + 1, par, 5000)).toBeLessThanOrEqual(ladderScore(steps, par, 5000));
    }
  });

  it('maxRaw sits above what a fast expert can reach', () => {
    // a bot typing shortest paths at 4 keys/s solves about 20 ladders in 120 s, each close to the full 1000
    expect(GAMES.plotzel.maxRaw).toBeGreaterThanOrEqual(1.4 * 20 * SCORE.ladder);
    expect(GAMES.plotzel.durationMs).toBe(120_000);
  });
});
