/**
 * One microphone for the whole TV: the narrator (the two hosts in their poses, ../narrator.tsx)
 * and the commentator (the small head with the live lines, funny.tsx) never talk at the same time,
 * so two speech bubbles are never on screen together.
 *
 * Whoever takes the free mic speaks. The narrator may cut an ordinary commentator line short (its
 * moments are the big ones); a commentator line said with `force` (a ceremony beat) is never cut,
 * and the narrator waits for it. The commentator never cuts the narrator: it waits for the mic.
 * Module state, no DOM: one TV page, one mic.
 */
export type MicUser = 'narrator' | 'commentator';

interface Holder {
  readonly who: MicUser;
  /** A forced commentator line: the narrator may not cut it. */
  readonly firm: boolean;
  /** Called when the narrator takes the mic from this holder: stop talking now. */
  readonly yieldNow: (() => void) | null;
  readonly token: number;
}

let holder: Holder | null = null;
let nextToken = 1;
const waiters = new Set<() => void>();

function notifyFree(): void {
  for (const fn of [...waiters]) fn();
}

/** Who is talking now, or null. */
export function micHolder(): MicUser | null {
  return holder?.who ?? null;
}

/** Could `who` take the mic now (free, already theirs, or the narrator over an ordinary line)? */
export function micAvailable(who: MicUser): boolean {
  const h = holder;
  return h === null || h.who === who || (who === 'narrator' && !h.firm);
}

export interface TakeMicOptions {
  /** Commentator only: a forced ceremony line that the narrator may not cut. */
  readonly firm?: boolean;
  /** Commentator only: stop talking at once (the narrator takes over). */
  readonly yieldNow?: () => void;
}

/**
 * Take the mic for `who`. Returns a token (pass it to `releaseMic`) or null when the mic is not
 * available: the other user holds it and may not be cut. Taking it again while holding it is fine.
 */
export function takeMic(who: MicUser, opts: TakeMicOptions = {}): number | null {
  const h = holder;
  if (h !== null && h.who !== who) {
    if (who === 'commentator' || h.firm) return null;
    // the narrator cuts an ordinary commentator line
    holder = null;
    h.yieldNow?.();
  }
  const token = nextToken++;
  holder = { who, firm: opts.firm === true, yieldNow: opts.yieldNow ?? null, token };
  return token;
}

/** Give the mic back (only the holder with this token can). */
export function releaseMic(token: number | null): void {
  if (token === null || holder === null || holder.token !== token) return;
  holder = null;
  notifyFree();
}

/** Called once (and unsubscribed) the next time the mic is released. */
export function onMicFree(fn: () => void): () => void {
  const once = (): void => {
    waiters.delete(once);
    fn();
  };
  waiters.add(once);
  return () => {
    waiters.delete(once);
  };
}

/** Tests only: forget everything. */
export function resetMic(): void {
  holder = null;
  waiters.clear();
}
