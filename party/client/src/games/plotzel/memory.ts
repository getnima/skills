/**
 * What this phone did in the current Plotzel round, kept in sessionStorage so a
 * reload or a remount mid-round (iOS dropping the tab, a reconnect) resumes it:
 * the builtin switch, a self-report, the builtin rows. Keyed by the round seed;
 * an entry older than a round can last is ignored. Storage can be missing or
 * throw (private mode, blocked site data): then nothing is remembered and the
 * game works as before.
 */
export type ReportChoice = number | 'fail';

export interface RoundMemory {
  /** The player switched from the embed to the builtin game. */
  readonly builtin?: boolean;
  /** Self-report of the embed bar: the choice, the raw score it gave and the round time left it was timed at. */
  readonly report?: { readonly which: ReportChoice; readonly score: number; readonly leftMs: number } | null;
  /** Builtin: the submitted rows (base letters), in order. */
  readonly rows?: readonly string[];
  /** Builtin: the raw score of the last submitted row (kept so a resume does not re-time a solve). */
  readonly score?: number;
}

interface Stored extends RoundMemory {
  readonly at: number;
}

const PREFIX = 'plotzel:v1:';
/** How long after its last write a memory is trusted: the round plus cutscenes plus slack. */
const SLACK_MS = 10 * 60_000;

/** The max age for recallRound / rememberRound of a round of `durationMs`. */
export function memoryAge(durationMs: number): number {
  return Math.max(0, durationMs) + SLACK_MS;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function key(seed: number): string {
  return `${PREFIX}${Math.floor(seed)}`;
}

/** The memory of the round with `seed`, or {} (also when it is older than `maxAgeMs`). */
export function recallRound(seed: number, maxAgeMs: number): RoundMemory {
  const s = storage();
  if (s === null) return {};
  try {
    const raw = s.getItem(key(seed));
    if (raw === null) return {};
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return {};
    const rec = v as Partial<Stored>;
    if (typeof rec.at !== 'number' || Date.now() - rec.at > maxAgeMs) return {};
    const out: { builtin?: boolean; report?: RoundMemory['report']; rows?: string[]; score?: number } = {};
    if (rec.builtin === true) out.builtin = true;
    const rep = rec.report;
    if (rep && typeof rep.score === 'number' && typeof rep.leftMs === 'number' && (rep.which === 'fail' || (typeof rep.which === 'number' && rep.which >= 1 && rep.which <= 6))) {
      out.report = { which: rep.which, score: rep.score, leftMs: rep.leftMs };
    }
    if (Array.isArray(rec.rows) && rec.rows.every((r) => typeof r === 'string')) out.rows = [...rec.rows];
    if (typeof rec.score === 'number' && Number.isFinite(rec.score)) out.score = rec.score;
    return out;
  } catch {
    return {};
  }
}

/** Merge `patch` into the memory of the round with `seed`. Never throws. */
export function rememberRound(seed: number, maxAgeMs: number, patch: RoundMemory): void {
  const s = storage();
  if (s === null) return;
  try {
    const prev = recallRound(seed, maxAgeMs);
    const next: Stored = { ...prev, ...patch, at: Date.now() };
    s.setItem(key(seed), JSON.stringify(next));
  } catch {
    // quota / blocked: the round still works, it is just not resumable
  }
}
