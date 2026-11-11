/**
 * Who this phone is, per room code, in localStorage. Every access is guarded:
 * private mode / blocked storage simply means no resume after a reload.
 */
import { NAME_MAX_LEN, ROOM_CODE_LEN } from '../../../shared/protocol';

export interface Identity {
  readonly playerId: string;
  readonly secret: string;
  readonly name: string;
  /** Index of a round this player joined too late to play (it plays from the next one). */
  readonly lateRound: number | null;
}

const KEY_PREFIX = 'party.player.';
const LAST_NAME_KEY = 'party.lastName';
const LAST_ROOM_KEY = 'party.lastRoom';
const TIP_KEY = 'party.a2hsTipDismissed';

/** Same alphabet the server uses (no I, O, L). */
const CODE_RE = new RegExp(`^[A-HJKMNP-Z]{${ROOM_CODE_LEN}}$`);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: ignore
  }
}

export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LEN);
}

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code);
}

function isIdentity(v: unknown): v is Identity {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.playerId === 'string' &&
    typeof o.secret === 'string' &&
    typeof o.name === 'string' &&
    (o.lateRound === null || typeof o.lateRound === 'number')
  );
}

export function loadIdentity(code: string): Identity | null {
  const raw = read(KEY_PREFIX + code);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveIdentity(code: string, id: Identity): void {
  write(KEY_PREFIX + code, JSON.stringify(id));
  write(LAST_ROOM_KEY, code);
  write(LAST_NAME_KEY, id.name);
}

export function clearIdentity(code: string): void {
  write(KEY_PREFIX + code, null);
}

export function loadLastName(): string {
  return (read(LAST_NAME_KEY) ?? '').slice(0, NAME_MAX_LEN);
}

export function loadLastRoom(): string {
  return normalizeCode(read(LAST_ROOM_KEY));
}

export function isTipDismissed(): boolean {
  return read(TIP_KEY) === '1';
}

export function dismissTip(): void {
  write(TIP_KEY, '1');
}

/** Best score this tab reported for a round: a reload mid-round never lowers it. */
export function loadRoundScore(code: string, round: number): number {
  try {
    const v = Number(sessionStorage.getItem(`party.score.${code}.${round}`));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function saveRoundScore(code: string, round: number, score: number): void {
  try {
    sessionStorage.setItem(`party.score.${code}.${round}`, String(score));
  } catch {
    // ignore
  }
}
