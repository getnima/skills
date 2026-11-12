/**
 * What this phone did in the current round, kept in sessionStorage so a reload
 * (iOS dropping the tab, a reconnect) resumes it. Keyed by the round seed; an
 * entry older than a round can last is ignored. Storage can be missing or throw
 * (private mode, blocked site data): then nothing is remembered and the game
 * works as before. Date.now() here only ages the entry, it never touches play.
 */
export interface PuzzleResult {
  /** Start word (normalized). */
  readonly start: string;
  readonly par: number;
  /** Steps taken; null = skipped. */
  readonly steps: number | null;
  /** Round time spent on it, ms (what the speed part of the score used). */
  readonly ms: number;
  readonly points: number;
}

export interface Snapshot {
  /** Index into the round sequence of the puzzle being played. */
  readonly idx: number;
  /** Words of that puzzle so far (normalized, the start first). */
  readonly words: readonly string[];
  /** Game time already spent on that puzzle (the skip unlocks at 15 s). */
  readonly spentMs: number;
  /** Round time left (ms) when that puzzle began: the score's clock. Null = it has not begun yet. */
  readonly leftAtStartMs: number | null;
  /** Raw score so far. */
  readonly score: number;
  readonly results: readonly PuzzleResult[];
}

const PREFIX = 'plotzel:v4:';
/** The round plus cutscenes plus slack. */
const MAX_AGE_MS = 15 * 60_000;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isResult(v: unknown): v is PuzzleResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return isStr(r.start) && isNum(r.par) && (r.steps === null || isNum(r.steps)) && isNum(r.ms) && isNum(r.points);
}

/** The snapshot of the round with `seed`, or null (none, unreadable or too old). */
export function loadSnapshot(seed: number): Snapshot | null {
  const s = storage();
  if (s === null) return null;
  try {
    const raw = s.getItem(PREFIX + Math.floor(seed));
    if (raw === null) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v !== 'object' || v === null || !isNum(v.at) || Date.now() - v.at > MAX_AGE_MS) return null;
    const { idx, words, spentMs, leftAtStartMs, score, results } = v;
    if (!isNum(idx) || !Array.isArray(words) || !words.every(isStr) || !isNum(spentMs) || !isNum(score)) return null;
    if (!(leftAtStartMs === null || isNum(leftAtStartMs)) || !Array.isArray(results) || !results.every(isResult)) return null;
    return { idx, words, spentMs, leftAtStartMs, score, results };
  } catch {
    return null;
  }
}

/** Store the snapshot of the round with `seed`. Never throws. */
export function saveSnapshot(seed: number, snap: Snapshot): void {
  const s = storage();
  if (s === null) return;
  try {
    s.setItem(PREFIX + Math.floor(seed), JSON.stringify({ ...snap, at: Date.now() }));
  } catch {
    // quota / blocked: the round still works, it is just not resumable
  }
}
