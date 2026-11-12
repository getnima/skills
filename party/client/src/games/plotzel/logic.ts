/**
 * Pure Plotzel rules shared by the builtin game and the embed bridge:
 * letter normalisation, count-based guess evaluation, the answer pick and the
 * raw score formulas. No DOM, no clock.
 */
import { createRng } from '../../kit/rng';
import { WORDS } from './words';

export const WORD_LEN = 5;
export const MAX_TRIES = 6;
/** Best partial credit of an unsolved word. */
export const PARTIAL_MAX = 300;
export const GREEN_POINTS = 60;
export const YELLOW_POINTS = 20;
/** Highest possible raw score (solved on the first try at the first instant). */
export const SOLVED_MAX = 1500;
/** Lowest possible raw score of a solve (sixth try, no time left): every solve beats every fail. */
export const SOLVED_MIN = 500;
/**
 * A finished fail (all six rows used, or the player reported "לא הצלחתי") is
 * worth at least this much, so trying beats not playing; colours on top of it
 * can reach PARTIAL_MAX, which stays below SOLVED_MIN.
 */
export const FAIL_MIN = 100;
/**
 * A self-reported solve is timed at the player's first tap on the bar plus
 * this much: about the time it takes to look down from the game and find the
 * number, so a self-report is worth the same as the builtin / bridge solve at
 * the same moment.
 */
export const SELF_REPORT_GRACE_MS = 2_000;

export type LetterState = 'correct' | 'present' | 'absent';

/** The 22 base letters, in keyboard-free alphabetical order. */
export const BASE_LETTERS: readonly string[] = [...'אבגדהוזחטיכלמנסעפצקרשת'];

const TO_BASE: Readonly<Record<string, string>> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
const TO_FINAL: Readonly<Record<string, string>> = { כ: 'ך', מ: 'ם', נ: 'ן', פ: 'ף', צ: 'ץ' };
const BASE_SET = new Set(BASE_LETTERS);

/** One letter to its base form (ך → כ). Non-Hebrew input is returned as is. */
export function normalizeLetter(ch: string): string {
  return TO_BASE[ch] ?? ch;
}

/** A word to base letters only (שולחן → שולחנ). */
export function normalizeWord(word: string): string {
  let out = '';
  for (const ch of word) out += normalizeLetter(ch);
  return out;
}

/** True for one of the 22 base letters or a final form. */
export function isHebrewLetter(ch: string): boolean {
  return BASE_SET.has(normalizeLetter(ch));
}

/** How a base letter is shown at `index`: the final form in the last position. */
export function displayLetter(base: string, index: number, length = WORD_LEN): string {
  const b = normalizeLetter(base);
  if (index === length - 1) return TO_FINAL[b] ?? b;
  return b;
}

/**
 * Classic count-based evaluation: greens first, then yellows only while the
 * answer still has unmatched copies of that letter.
 */
export function evaluateGuess(guess: string, answer: string): LetterState[] {
  const g = [...normalizeWord(guess)];
  const a = [...normalizeWord(answer)];
  const out: LetterState[] = g.map(() => 'absent');
  const left = new Map<string, number>();
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    if (ai === undefined) continue;
    if (g[i] === ai) out[i] = 'correct';
    else left.set(ai, (left.get(ai) ?? 0) + 1);
  }
  for (let i = 0; i < g.length; i++) {
    const gi = g[i];
    if (gi === undefined || out[i] === 'correct') continue;
    const n = left.get(gi) ?? 0;
    if (n > 0) {
      out[i] = 'present';
      left.set(gi, n - 1);
    }
  }
  return out;
}

export function countStates(states: readonly LetterState[]): { greens: number; yellows: number } {
  let greens = 0;
  let yellows = 0;
  for (const s of states) {
    if (s === 'correct') greens++;
    else if (s === 'present') yellows++;
  }
  return { greens, yellows };
}

/** Partial credit of an unsolved word: greens x 60 + yellows x 20, at most 300. */
export function partialScore(greens: number, yellows: number): number {
  const g = Math.max(0, Math.floor(greens));
  const y = Math.max(0, Math.floor(yellows));
  return Math.min(PARTIAL_MAX, g * GREEN_POINTS + y * YELLOW_POINTS);
}

/** A finished fail: the best row's colours, but never below FAIL_MIN. */
export function failedScore(greens: number, yellows: number): number {
  return Math.max(FAIL_MIN, partialScore(greens, yellows));
}

/** Solved on try `tries` (1..6): 1000 - (tries-1) x 100 + round(500 x timeLeft / duration). */
export function solvedScore(tries: number, timeLeftMs: number, durationMs: number): number {
  const n = Math.min(MAX_TRIES, Math.max(1, Math.floor(tries)));
  const frac = durationMs > 0 ? Math.min(1, Math.max(0, timeLeftMs / durationMs)) : 0;
  return 1000 - (n - 1) * 100 + Math.round(500 * frac);
}

/**
 * The self-report bar's raw score. `which` = tries (1..6) or 'fail';
 * `leftMsAtFirstTap` = round time left when the player first touched the bar
 * for this report (SELF_REPORT_GRACE_MS is credited back for looking down).
 */
export function selfReportScore(which: number | 'fail', leftMsAtFirstTap: number, durationMs: number): number {
  if (which === 'fail') return FAIL_MIN;
  return solvedScore(which, Math.min(durationMs, Math.max(0, leftMsAtFirstTap) + SELF_REPORT_GRACE_MS), durationMs);
}

/** The answer of a round: the same word on every phone for the same seed. */
export function pickAnswer(seed: number, words: readonly string[] = WORDS): string {
  const rng = createRng(seed).fork('plotzel-word');
  return rng.pick(words);
}

/** Which state wins for a keyboard key that has been seen in several places. */
export function betterState(a: LetterState | undefined, b: LetterState): LetterState {
  const rank: Record<LetterState, number> = { absent: 0, present: 1, correct: 2 };
  if (a === undefined) return b;
  return rank[b] > rank[a] ? b : a;
}
