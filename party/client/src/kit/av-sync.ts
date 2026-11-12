/**
 * The TV's sound and picture delay (AirPlay). The TV page runs on a Mac whose screen is mirrored
 * to an Apple TV, and its sound plays on an AirPlay speaker (the owner's KEF LSX II): the sound
 * comes out about 2 s after the page plays it, the picture a little after the page draws it. The
 * phones have neither delay. Two numbers, set once on the TV's sync screen (av-sync-screen.tsx,
 * from the remote or the TV's keys) and kept in the TV's localStorage:
 *
 * - pictureMs: how much earlier the TV draws what the server clock decides (the intro turning into
 *   the 3-2-1, the digits, GO), so it shows on the TV together with the phones.
 * - soundMs: how much earlier than its PICTURE a timed sound leaves the TV (the 3-2-1 beeps, the
 *   start gong, the ceremony's drum roll and hit, a cutscene's soundtrack). A timed sound leaves
 *   soundMs + pictureMs before its moment, so it is heard on it; the two are set independently
 *   (sound against the TV's picture, picture against a phone) in either order.
 *
 * Until the sound is set by hand it follows what the browser reports for its output device
 * (AudioContext.outputLatency: an AirPlay output can report its buffer), else 0.
 */
import { reportedOutputLatencyMs } from './audio';

import type { ServerClock } from '../net/connection';

export const SOUND_MAX_MS = 4_000;
export const PICTURE_MAX_MS = 3_000;
/** A starting point for an AirPlay speaker (its usual buffer), fine-tuned by ear from there. */
export const AIRPLAY_SOUND_MS = 2_000;

export interface AvSync {
  /** Sound sent this much earlier (ms), when set by hand. */
  readonly soundMs: number;
  /** soundMs was set by hand; otherwise the browser's report is used. */
  readonly soundSet: boolean;
  /** Picture drawn this much earlier (ms). */
  readonly pictureMs: number;
}

const KEY = 'party.avsync.v1';
const NONE: AvSync = { soundMs: 0, soundSet: false, pictureMs: 0 };

function clamp(v: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(v)));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function load(): AvSync {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!isRecord(raw)) return NONE;
    const sound = typeof raw.soundMs === 'number' && Number.isFinite(raw.soundMs) ? clamp(raw.soundMs, SOUND_MAX_MS) : 0;
    const picture = typeof raw.pictureMs === 'number' && Number.isFinite(raw.pictureMs) ? clamp(raw.pictureMs, PICTURE_MAX_MS) : 0;
    return { soundMs: sound, soundSet: raw.soundSet === true, pictureMs: picture };
  } catch {
    return NONE;
  }
}

let current: AvSync | null = null;
const listeners = new Set<() => void>();

export function avSync(): AvSync {
  if (current === null) current = load();
  return current;
}

export function onAvSyncChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function save(next: AvSync): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode: kept for this page only
  }
  for (const fn of listeners) fn();
}

/** The browser's report for its output, rounded to 10 ms (null: none, or under 30 ms). */
export function reportedSoundMs(): number | null {
  const ms = reportedOutputLatencyMs();
  return ms !== null && ms >= 30 ? clamp(Math.round(ms / 10) * 10, SOUND_MAX_MS) : null;
}

/** The sound's own delay against the TV's picture in effect (ms): by hand, else the browser's report. */
export function soundOffsetMs(): number {
  const s = avSync();
  return s.soundSet ? s.soundMs : (reportedSoundMs() ?? 0);
}

/** How long before its moment a timed sound leaves the TV (ms): the sound's offset plus the picture's. */
export function soundLeadMs(): number {
  return soundOffsetMs() + pictureLeadMs();
}

/** The picture delay in effect (ms). */
export function pictureLeadMs(): number {
  return avSync().pictureMs;
}

/**
 * One adjustment, as the remote and the TV's keys send it: 'sound:+20', 'sound:-200',
 * 'sound:=2000', 'picture:+10', 'sound:auto' (back to the browser's report), 'reset'.
 * Returns false for anything else (nothing changes).
 */
export function adjustAvSync(arg: string): boolean {
  const s = avSync();
  if (arg === 'reset') {
    save(NONE);
    return true;
  }
  if (arg === 'sound:auto') {
    save({ ...s, soundMs: 0, soundSet: false });
    return true;
  }
  const m = /^(sound|picture):([+=-])(\d{1,4})$/.exec(arg);
  if (m === null) return false;
  const [, what, op, digits] = m;
  const n = Number(digits);
  if (what === 'sound') {
    const base = soundOffsetMs();
    const v = op === '=' ? n : op === '+' ? base + n : base - n;
    save({ ...s, soundMs: clamp(v, SOUND_MAX_MS), soundSet: true });
  } else {
    const v = op === '=' ? n : op === '+' ? s.pictureMs + n : s.pictureMs - n;
    save({ ...s, pictureMs: clamp(v, PICTURE_MAX_MS) });
  }
  return true;
}

/**
 * The TV's clock for what it draws by the server clock: ahead by the picture delay, so the
 * mirrored picture lands on the server instant. Sounds keep the true clock (soundLeadMs is
 * applied where they are scheduled).
 */
export function pictureClock(clock: ServerClock): ServerClock {
  return {
    now: () => clock.now() + pictureLeadMs(),
    sync: (samples?: number) => clock.sync(samples),
    hint: (serverNow: number) => clock.hint(serverNow),
    get synced() {
      return clock.synced;
    },
  };
}
