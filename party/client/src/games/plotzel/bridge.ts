/**
 * The postMessage bridge the embedded Plotzel site talks to us with.
 * Shape (see client/public/plotzel-bridge/README.md):
 *   { source: 'plotzel', type: 'progress' | 'solved' | 'failed',
 *     tries?: 1..6, greens?: 0..5, yellows?: 0..5, score?: 0..1500 }
 * Anything else is ignored; out-of-range fields are dropped.
 */
import { MAX_TRIES, SOLVED_MAX, WORD_LEN } from './logic';

export type BridgeType = 'progress' | 'solved' | 'failed';

export interface BridgeMessage {
  readonly type: BridgeType;
  readonly tries: number | null;
  readonly greens: number | null;
  readonly yellows: number | null;
  readonly score: number | null;
}

function isBridgeType(v: unknown): v is BridgeType {
  return v === 'progress' || v === 'solved' || v === 'failed';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function intIn(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
}

/** Absent = null; present but invalid = INVALID (the whole message is dropped). */
const INVALID = Symbol('invalid');

function optionalInt(v: unknown, min: number, max: number): number | null | typeof INVALID {
  if (v === undefined || v === null) return null;
  return intIn(v, min, max) ?? INVALID;
}

/**
 * A validated bridge message, or null when `data` is not one. A field that is
 * present but has the wrong type or range rejects the whole message, and a
 * `solved` needs `tries` or `score`.
 */
export function parseBridgeMessage(data: unknown): BridgeMessage | null {
  if (!isRecord(data) || data.source !== 'plotzel') return null;
  const type = data.type;
  if (!isBridgeType(type)) return null;
  const tries = optionalInt(data.tries, 1, MAX_TRIES);
  const greens = optionalInt(data.greens, 0, WORD_LEN);
  const yellows = optionalInt(data.yellows, 0, WORD_LEN);
  if (tries === INVALID || greens === INVALID || yellows === INVALID) return null;
  if ((greens ?? 0) + (yellows ?? 0) > WORD_LEN) return null;
  let score: number | null = null;
  if (data.score !== undefined && data.score !== null) {
    const raw = data.score;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > SOLVED_MAX) return null;
    score = Math.round(raw);
  }
  if (type === 'solved' && tries === null && score === null) return null;
  return { type, tries, greens, yellows, score };
}
