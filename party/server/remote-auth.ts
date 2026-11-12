/**
 * The phone remote's gate, as pure parts the socket adapter wires together:
 * the password check (constant time), the guess throttle (per socket and per
 * IP address), the relay rate limit and payload check, the room choice and
 * the client address behind a proxy. No sockets, no globals; time is passed in.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { RELAY_MAX_BYTES } from '../shared/protocol';

import type { RelayData } from '../shared/protocol';
import type { RemoteThrottleConfig } from './config';

/** Longer than any real password: the work per try stays bounded. */
export const PASSWORD_MAX_LEN = 256;

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/**
 * True only for a non-empty string equal to `expected`. Both sides are hashed
 * first, so the comparison takes the same time whatever the length or the
 * first wrong character.
 */
export function checkPassword(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length === 0 || given.length > PASSWORD_MAX_LEN) return false;
  if (expected.length === 0) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

// ───────────────────────────── Guess throttle ─────────────────────────────

interface KeyRecord {
  /** Times of the wrong tries inside the current window. */
  fails: number[];
  /** Locked until this time (0 = not locked). */
  lockedUntil: number;
  /** Locks so far: the next lock lasts lockMs * 2^locks. */
  locks: number;
  lastFailAt: number;
}

export type ThrottleVerdict = { readonly ok: true } | { readonly ok: false; readonly retryMs: number };

/** A key that saw no wrong try for this long forgets its lock history. */
const FORGET_AFTER_MS = 15 * 60_000;

/**
 * Wrong passwords per key (a socket id, an IP address): `maxFails` within
 * `windowMs` lock the key for `lockMs`; every further lock doubles, up to
 * `maxLockMs`. A try is refused while ANY of its keys is locked.
 */
export class GuessThrottle {
  private readonly keys = new Map<string, KeyRecord>();

  constructor(private readonly cfg: RemoteThrottleConfig) {}

  /** May a try with these keys go ahead now? */
  check(keys: readonly string[], now: number): ThrottleVerdict {
    let wait = 0;
    for (const key of keys) {
      const rec = this.keys.get(key);
      if (rec !== undefined && rec.lockedUntil > now) wait = Math.max(wait, rec.lockedUntil - now);
    }
    return wait > 0 ? { ok: false, retryMs: wait } : { ok: true };
  }

  /** Records a wrong try. Returns the lock it caused (retryMs) when this try locked a key. */
  fail(keys: readonly string[], now: number): ThrottleVerdict {
    let wait = 0;
    for (const key of keys) {
      let rec = this.keys.get(key);
      if (rec !== undefined && now - rec.lastFailAt > FORGET_AFTER_MS && rec.lockedUntil <= now) rec = undefined;
      if (rec === undefined) {
        rec = { fails: [], lockedUntil: 0, locks: 0, lastFailAt: now };
        this.keys.set(key, rec);
      }
      rec.lastFailAt = now;
      rec.fails = rec.fails.filter((t) => now - t < this.cfg.windowMs);
      rec.fails.push(now);
      if (rec.fails.length >= this.cfg.maxFails) {
        const ms = Math.min(this.cfg.maxLockMs, this.cfg.lockMs * 2 ** rec.locks);
        rec.locks += 1;
        rec.fails = [];
        rec.lockedUntil = now + ms;
        wait = Math.max(wait, ms);
      }
    }
    return wait > 0 ? { ok: false, retryMs: wait } : { ok: true };
  }

  /** A right password: these keys start over. */
  succeed(keys: readonly string[]): void {
    for (const key of keys) this.keys.delete(key);
  }

  /** Drops keys with nothing left to remember. Returns how many are kept. */
  sweep(now: number): number {
    for (const [key, rec] of this.keys) {
      if (rec.lockedUntil > now) continue;
      if (now - rec.lastFailAt > Math.max(this.cfg.windowMs, FORGET_AFTER_MS)) this.keys.delete(key);
    }
    return this.keys.size;
  }

  get size(): number {
    return this.keys.size;
  }
}

/** Hebrew "wait N seconds", rounded up. */
export function waitText(retryMs: number): string {
  const s = Math.max(1, Math.ceil(retryMs / 1000));
  return `יותר מדי ניסיונות. נסו שוב בעוד ${s === 1 ? 'שנייה' : `${s} שניות`}`;
}

// ───────────────────────────── Relay ─────────────────────────────

/** At most `max` events per `windowMs` (a sliding window over the last events). */
export class RateLimiter {
  private readonly times: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs = 1_000,
  ) {}

  /** Counts this event; false when it is over the limit (and then it is not counted). */
  take(now: number): boolean {
    while (this.times.length > 0 && now - (this.times[0] ?? now) >= this.windowMs) this.times.shift();
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * A relay payload as it may be forwarded: a plain JSON object of at most
 * `maxBytes` once serialized. Returns a fresh copy (nothing the sender built
 * reaches the other side), or null.
 */
export function cleanRelayData(value: unknown, maxBytes: number = RELAY_MAX_BYTES): RelayData | null {
  if (!isPlainObject(value)) return null;
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes) return null;
  const copy: unknown = JSON.parse(text);
  return isPlainObject(copy) ? (copy as RelayData) : null;
}

// ───────────────────────────── Room choice ─────────────────────────────

export interface RoomCandidate {
  readonly code: string;
  /** A TV page is attached right now. */
  readonly screen: boolean;
  /** Last time a TV page attached (server ms). */
  readonly activeAt: number;
}

export type RoomChoice =
  | { readonly kind: 'room'; readonly code: string }
  | { readonly kind: 'choose'; readonly rooms: readonly string[] }
  | { readonly kind: 'none'; readonly rooms: readonly string[] };

/** The codes of the rooms whose TV is connected, most recently active first. */
export function screenRooms(rooms: readonly RoomCandidate[]): string[] {
  return rooms
    .filter((r) => r.screen)
    .sort((a, b) => b.activeAt - a.activeAt || (a.code < b.code ? -1 : 1))
    .map((r) => r.code);
}

/**
 * Which room a remote attaches to. With a code: that room when it exists (its
 * TV may be away for a moment). Without: the one room whose TV is connected;
 * several -> the remote must choose; none -> open the TV page first.
 */
export function chooseRoom(rooms: readonly RoomCandidate[], code: string | null): RoomChoice {
  const live = screenRooms(rooms);
  if (code !== null) {
    if (rooms.some((r) => r.code === code)) return { kind: 'room', code };
    return { kind: 'none', rooms: live };
  }
  if (live.length === 1) return { kind: 'room', code: live[0] as string };
  if (live.length > 1) return { kind: 'choose', rooms: live };
  return { kind: 'none', rooms: [] };
}

// ───────────────────────────── Client address ─────────────────────────────

function stripMapped(addr: string): string {
  const a = addr.trim();
  return a.startsWith('::ffff:') ? a.slice(7) : a;
}

/** Loopback, private and link-local addresses: a reverse proxy in front of us, never a guest on the internet. */
export function isProxyAddress(addr: string): boolean {
  const a = stripMapped(addr).toLowerCase();
  if (a === '::1' || a === 'localhost' || a.startsWith('127.')) return true;
  if (a.startsWith('10.') || a.startsWith('192.168.') || a.startsWith('169.254.')) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m !== null && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
}

/**
 * The guest's address for the per-IP throttle: the socket's peer, or, when the
 * peer is a local reverse proxy (Caddy on the VM, Cloud Run's front end), the
 * first X-Forwarded-For entry it passed on.
 */
export function clientAddress(peer: string | undefined, forwarded: string | string[] | undefined): string {
  const direct = stripMapped(peer ?? '');
  const header = Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '');
  const first = header.split(',').map((s) => stripMapped(s)).find((s) => s.length > 0);
  if ((direct.length === 0 || isProxyAddress(direct)) && first !== undefined) return first.slice(0, 64);
  return direct.length > 0 ? direct : 'unknown';
}
