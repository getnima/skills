/**
 * Who this phone is, per room code, in localStorage, with the seat (identity, last room,
 * name) mirrored in a small first-party cookie: closing the browser and opening the link
 * again lands in the same seat, and a phone whose localStorage is blocked or empty still
 * finds it in the cookie. Every access is guarded: with both blocked there is simply no
 * resume after a reload.
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
const LOOK_PREFIX = 'party.look.';
const LAST_LOOK_KEY = 'party.lastLook';
/** Longest text accepted as a stored look (shared/avatar.ts AVATAR_ENCODED_MAX). */
const LOOK_MAX_LEN = 48;

/** Same alphabet the server uses (no I, O, L). */
const CODE_RE = new RegExp(`^[A-HJKMNP-Z]{${ROOM_CODE_LEN}}$`);

/** The seat is mirrored in a cookie (see the top); the rest (looks, tips) stays in localStorage only. */
const COOKIE_PREFIX = 'pa_';
const COOKIE_MAX_AGE_S = 2 * 24 * 60 * 60;
function mirrored(key: string): boolean {
  return key.startsWith(KEY_PREFIX) || key === LAST_ROOM_KEY || key === LAST_NAME_KEY;
}

function readCookie(key: string): string | null {
  try {
    const name = `${COOKIE_PREFIX}${encodeURIComponent(key)}=`;
    for (const part of document.cookie.split('; ')) {
      if (part.startsWith(name)) return decodeURIComponent(part.slice(name.length));
    }
  } catch {
    // cookies blocked
  }
  return null;
}

function writeCookie(key: string, value: string | null): void {
  try {
    const name = `${COOKIE_PREFIX}${encodeURIComponent(key)}`;
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      value === null
        ? `${name}=; Max-Age=0; Path=/; SameSite=Lax${secure}`
        : `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // cookies blocked: ignore
  }
}

function read(key: string): string | null {
  let value: string | null = null;
  try {
    value = localStorage.getItem(key);
  } catch {
    value = null;
  }
  return value ?? (mirrored(key) ? readCookie(key) : null);
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: the cookie below still keeps the seat
  }
  if (mirrored(key)) writeCookie(key, value);
}

/**
 * A guest typing the code on a Hebrew keyboard gets Hebrew letters: read them as the
 * Latin keys they sit on (standard Israeli layout), so "שנבג" is ABCD.
 */
const HEBREW_KEYS: Readonly<Record<string, string>> = {
  ש: 'A', נ: 'B', ב: 'C', ג: 'D', ק: 'E', כ: 'F', ע: 'G', י: 'H', ן: 'I', ח: 'J', ל: 'K', ך: 'L', צ: 'M',
  מ: 'N', ם: 'O', פ: 'P', '/': 'Q', ר: 'R', ד: 'S', א: 'T', ו: 'U', ה: 'V', "'": 'W', ס: 'X', ט: 'Y', ז: 'Z',
};

export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? '')
    .trim()
    .replace(/[א-ת/']/g, (ch) => HEBREW_KEYS[ch] ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, ROOM_CODE_LEN);
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
  // the doll belongs to the seat: a new seat in this room starts over (from the last look, below)
  write(LOOK_PREFIX + code, null);
}

/**
 * The guest's doll in one room, kept next to the identity so a reload in the dressing room
 * (or after it) lands exactly where the guest was.
 */
export interface LookMemory {
  /** The look as the phone last had it (an encoded look, shared/avatar.ts). */
  readonly look: string;
  /** The server has not confirmed `look` yet: after a reload it is sent again. */
  readonly pending: boolean;
  /** The guest has been through the dressing room in this room (pressed "done", or a round took over). */
  readonly dressed: boolean;
}

function isLookText(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= LOOK_MAX_LEN && /^[0-9.-]+$/.test(v);
}

export function loadLookMemory(code: string): LookMemory | null {
  const raw = read(LOOK_PREFIX + code);
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof o !== 'object' || o === null || !isLookText(o.look)) return null;
    return { look: o.look, pending: o.pending === true, dressed: o.dressed === true };
  } catch {
    return null;
  }
}

export function saveLookMemory(code: string, mem: LookMemory): void {
  write(LOOK_PREFIX + code, JSON.stringify(mem));
}

/** The doll this phone dressed last, in any room: where a new room's dressing room starts. */
export function loadLastLook(): string | null {
  const v = read(LAST_LOOK_KEY);
  return isLookText(v) ? v : null;
}

export function saveLastLook(look: string): void {
  write(LAST_LOOK_KEY, look);
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
