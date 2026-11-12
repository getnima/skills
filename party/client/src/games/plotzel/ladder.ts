/**
 * The word ladder of the owner's game (original/plotzel.netlify.app.html), ported
 * verbatim in behaviour. Pure: no DOM, no timers, no randomness.
 *
 * Words are 4 letters, always handled in their normalized form (no final
 * letters: פלוצ, not פלוץ); `disp()` turns the 4th letter into its final form
 * for the screen. The graph links words that differ in exactly one position.
 *
 *   DIST   true minimum number of steps to פלוץ over the whole dictionary (= par)
 *   CDIST  the same, walking common words only (the original's hint / shown path)
 *
 * The original builds string buckets and string Maps; this port keeps the same
 * iteration order (dictionary order inside every bucket, positions 0..3) on
 * typed arrays, so neighbors / bestNext / shortestPath return exactly what the
 * original returns, in a fraction of the time. The graph is built once, on the
 * first getLadder() call.
 */
import { COMMON, DICT, STARTS } from './data';

/** The 22 base letters; the packed data stores letter i as String.fromCharCode(97 + i). */
export const HEB = 'אבגדהוזחטיכלמנסעפצקרשת';
export const FINAL_OF: Readonly<Record<string, string>> = { כ: 'ך', מ: 'ם', נ: 'ן', פ: 'ף', צ: 'ץ' };
export const REGULAR_OF: Readonly<Record<string, string>> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
export const WORD_LEN = 4;
/** The goal, normalized. */
export const TARGET = 'פלוצ';

/** Packed string → words (4 letters each), like the original's unpack(). */
export function unpack(s: string): string[] {
  let o = '';
  for (let i = 0; i < s.length; i++) o += HEB[s.charCodeAt(i) - 97] ?? '';
  return o.match(/.{4}/g) ?? [];
}

/** Final letters → regular letters (ץ → צ). */
export function norm(w: string): string {
  return [...w].map((c) => REGULAR_OF[c] ?? c).join('');
}

/** A normalized word for the screen: the 4th letter in its final form (פלוצ → פלוץ). */
export function disp(w: string): string {
  const last = w[3];
  const fin = w.length === 4 && last !== undefined ? FINAL_OF[last] : undefined;
  return fin !== undefined ? w.slice(0, 3) + fin : w;
}

/** The goal as shown: פלוץ. */
export const TARGET_D = disp(TARGET);

/** Number of positions where a and b differ. */
export function diffCount(a: string, b: string): number {
  return [...a].filter((c, i) => c !== b[i]).length;
}

/** First position where a and b differ (-1 when equal). */
export function diffPos(a: string, b: string): number {
  return [...a].findIndex((c, i) => c !== b[i]);
}

/** One of the 22 base letters or a final letter (which normalizes). */
export function isHebLetter(ch: string): boolean {
  return ch.length === 1 && (HEB.includes(ch) || REGULAR_OF[ch] !== undefined);
}

/** 'צעד אחד' / 'N צעדים' (the original's stepsText). */
export function stepsText(n: number): string {
  return n === 1 ? 'צעד אחד' : `${n} צעדים`;
}

// ───────────────────────────── The graph ─────────────────────────────

export interface Ladder {
  /** Unique dictionary words (22468). */
  readonly dictSize: number;
  /** Common words (8999). */
  readonly commonSize: number;
  /** The original's curated start words, in their order (599). */
  readonly starts: readonly string[];
  /** Common words, most common first. */
  readonly common: readonly string[];
  has(w: string): boolean;
  /** The goal or a common word (the original's isCommon). */
  isCommon(w: string): boolean;
  /** Position in the common list, 1e9 for an uncommon word. */
  rank(w: string): number;
  /** Words one letter away, in the original's order. */
  neighbors(w: string): string[];
  /** Minimum steps to the goal over the whole dictionary (undefined: unreachable / not a word). */
  dist(w: string): number | undefined;
  /** Minimum steps to the goal through common words only. */
  cdist(w: string): number | undefined;
  /** The original's bestNext: the next word of a shortest path, common words preferred. */
  bestNext(w: string): string | null;
  /** The original's shortestPath: from `w` to the goal, both included. */
  shortestPath(w: string): string[];
}

const LETTERS = 22;
const NO_RANK = 1e9;

function codeOf(w: string): number {
  if (w.length !== WORD_LEN) return -1;
  let code = 0;
  for (let i = 0; i < WORD_LEN; i++) {
    const c = HEB.indexOf(w.charAt(i));
    if (c < 0) return -1;
    code = code * LETTERS + c;
  }
  return code;
}

function buildLadder(): Ladder {
  // ── words (unique, first occurrence order = the original's Set order) ──
  const idByCode = new Int32Array(LETTERS ** WORD_LEN).fill(-1);
  const letters: number[] = [];
  const words: string[] = [];
  const total = Math.floor(DICT.length / WORD_LEN);
  for (let w = 0; w < total; w++) {
    let code = 0;
    for (let i = 0; i < WORD_LEN; i++) code = code * LETTERS + (DICT.charCodeAt(w * WORD_LEN + i) - 97);
    if (idByCode[code] !== -1) continue;
    idByCode[code] = words.length;
    for (let i = 0; i < WORD_LEN; i++) letters.push(DICT.charCodeAt(w * WORD_LEN + i) - 97);
    words.push(DICT.slice(w * WORD_LEN, w * WORD_LEN + WORD_LEN));
  }
  const n = words.length;
  const L = Uint8Array.from(letters);
  const text: string[] = new Array<string>(n);
  for (let w = 0; w < n; w++) {
    let s = '';
    for (let i = 0; i < WORD_LEN; i++) s += HEB[L[w * WORD_LEN + i] ?? 0];
    text[w] = s;
  }
  const idOf = (w: string): number => {
    const c = codeOf(w);
    return c < 0 ? -1 : (idByCode[c] ?? -1);
  };

  // ── buckets: one per (word with one position blanked); members in dictionary order ──
  const KB = LETTERS + 1; // digit 22 = the blank
  const keyCount = KB ** WORD_LEN;
  const keyOf = (w: number, p: number): number => {
    let k = 0;
    for (let i = 0; i < WORD_LEN; i++) k = k * KB + (i === p ? LETTERS : (L[w * WORD_LEN + i] ?? 0));
    return k;
  };
  const start = new Int32Array(keyCount + 1);
  const keys = new Int32Array(n * WORD_LEN);
  for (let w = 0; w < n; w++) {
    for (let p = 0; p < WORD_LEN; p++) {
      const k = keyOf(w, p);
      keys[w * WORD_LEN + p] = k;
      start[k + 1] = (start[k + 1] ?? 0) + 1;
    }
  }
  for (let k = 0; k < keyCount; k++) start[k + 1] = (start[k + 1] ?? 0) + (start[k] ?? 0);
  const fill = start.slice(0, keyCount);
  const members = new Int32Array(n * WORD_LEN);
  for (let w = 0; w < n; w++) {
    for (let p = 0; p < WORD_LEN; p++) {
      const k = keys[w * WORD_LEN + p] ?? 0;
      const at = fill[k] ?? 0;
      members[at] = w;
      fill[k] = at + 1;
    }
  }

  // ── common words: rank like the original's Map (a later duplicate overwrites the value) ──
  const commonWords = unpack(COMMON);
  const rankOf = new Int32Array(n).fill(NO_RANK);
  const commonSet = new Set<string>();
  commonWords.forEach((w, i) => {
    commonSet.add(w);
    const id = idOf(w);
    if (id >= 0) rankOf[id] = i;
  });
  const commonList = [...commonSet];
  const target = idOf(TARGET);
  const isCommonId = (id: number): boolean => id === target || (rankOf[id] ?? NO_RANK) < NO_RANK;

  // ── BFS from the goal ──
  function bfs(allowed: (id: number) => boolean): Int8Array {
    const d = new Int8Array(n).fill(-1);
    const q = new Int32Array(n);
    let tail = 0;
    if (target < 0) return d;
    d[target] = 0;
    q[tail++] = target;
    for (let h = 0; h < tail; h++) {
      const w = q[h] ?? 0;
      const next = (d[w] ?? 0) + 1;
      for (let p = 0; p < WORD_LEN; p++) {
        const k = keys[w * WORD_LEN + p] ?? 0;
        const end = start[k + 1] ?? 0;
        for (let j = start[k] ?? 0; j < end; j++) {
          const m = members[j] ?? 0;
          if (m === w || d[m] !== -1 || !allowed(m)) continue;
          d[m] = next;
          q[tail++] = m;
        }
      }
    }
    return d;
  }
  const DIST = bfs(() => true);
  const CDIST = bfs(isCommonId);

  function neighborIds(w: number): number[] {
    const out: number[] = [];
    for (let p = 0; p < WORD_LEN; p++) {
      const k = keys[w * WORD_LEN + p] ?? 0;
      const end = start[k + 1] ?? 0;
      for (let j = start[k] ?? 0; j < end; j++) {
        const m = members[j] ?? 0;
        if (m !== w) out.push(m);
      }
    }
    return out;
  }
  const distOf = (arr: Int8Array, id: number): number | undefined => {
    const v = id >= 0 ? (arr[id] ?? -1) : -1;
    return v < 0 ? undefined : v;
  };

  function bestNextId(w: number): number {
    const d = distOf(DIST, w);
    if (d === undefined) return -1;
    const common = distOf(CDIST, w) === d;
    let best = -1;
    for (const m of neighborIds(w)) {
      if (common ? !isCommonId(m) || distOf(CDIST, m) !== d - 1 : distOf(DIST, m) !== d - 1) continue;
      const rm = rankOf[m] ?? NO_RANK;
      const rb = best < 0 ? NO_RANK : (rankOf[best] ?? NO_RANK);
      if (best < 0 || rm < rb || (rm === rb && (text[m] ?? '') < (text[best] ?? ''))) best = m;
    }
    return best;
  }

  return {
    dictSize: n,
    commonSize: commonSet.size,
    starts: unpack(STARTS),
    common: commonList,
    has: (w: string): boolean => idOf(w) >= 0,
    isCommon: (w: string): boolean => w === TARGET || commonSet.has(w),
    rank: (w: string): number => {
      const id = idOf(w);
      return id < 0 ? NO_RANK : (rankOf[id] ?? NO_RANK);
    },
    neighbors: (w: string): string[] => {
      const id = idOf(w);
      return id < 0 ? [] : neighborIds(id).map((m) => text[m] ?? '');
    },
    dist: (w: string): number | undefined => distOf(DIST, idOf(w)),
    cdist: (w: string): number | undefined => distOf(CDIST, idOf(w)),
    bestNext: (w: string): string | null => {
      const id = idOf(w);
      const b = id < 0 ? -1 : bestNextId(id);
      return b < 0 ? null : (text[b] ?? null);
    },
    shortestPath: (w: string): string[] => {
      const p = [w];
      let id = idOf(w);
      // a word with no path (not reachable) returns just itself; the original would loop
      for (let guard = 0; id >= 0 && id !== target && guard < 64; guard++) {
        id = bestNextId(id);
        if (id < 0) break;
        p.push(text[id] ?? '');
      }
      return p;
    },
  };
}

let built: Ladder | null = null;
let builtMs = 0;

/** The graph, built on the first call (about 10-40 ms on a phone; see README). */
export function getLadder(): Ladder {
  if (built === null) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    built = buildLadder();
    builtMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }
  return built;
}

/** How long the one graph build took (ms), 0 before it ran. */
export function ladderBuildMs(): number {
  return builtMs;
}

// ───────────────────────────── A step (the original's submit) ─────────────────────────────

export type RejectReason = 'short' | 'same' | 'multi' | 'unknown' | 'repeat';

export type StepResult =
  | { readonly ok: true; readonly word: string; readonly solved: boolean }
  | { readonly ok: false; readonly reason: RejectReason; readonly message: string };

/**
 * Check `typed` (normalized) as the next word after `words` (normalized, the
 * start first). Same order and Hebrew messages as the original's submit().
 */
export function checkStep(ladder: Ladder, typed: string, words: readonly string[]): StepResult {
  if (typed.length < WORD_LEN) return { ok: false, reason: 'short', message: 'צריך 4 אותיות' };
  const prev = words[words.length - 1] ?? '';
  const d = diffCount(typed, prev);
  if (d === 0) return { ok: false, reason: 'same', message: 'זו אותה מילה' };
  if (d > 1) return { ok: false, reason: 'multi', message: 'משנים רק אות אחת בכל צעד' };
  if (!ladder.has(typed)) return { ok: false, reason: 'unknown', message: `${disp(typed)} לא נמצאת במילון` };
  if (words.includes(typed)) return { ok: false, reason: 'repeat', message: `כבר השתמשתם ב${disp(typed)}` };
  return { ok: true, word: typed, solved: typed === TARGET };
}

// ───────────────────────────── Hints (the original's hint) ─────────────────────────────

const ORDINALS = ['הראשונה', 'השנייה', 'השלישית', 'הרביעית'] as const;

/** Level 1 = which letter to change, level 2 = the word itself. */
export function hintText(level: 1 | 2, pos: number, next: string): string {
  return level === 1 ? `החליפו את האות ${ORDINALS[pos] ?? ''}` : `נסו: ${disp(next)}`;
}
