/**
 * What every socket of this page last heard about the running round: the round itself
 * (with `finale`) and the latest `scores` message (with `active` and `out`).
 *
 * A read-only side channel for views that are only handed a scores map (the TV's
 * PlayingScene): `connect()` taps every socket it creates into it. Nothing here talks to
 * the network; with no socket (the show demo page) it simply stays empty.
 */
import type { RoundPublic } from '../../../shared/protocol';

export interface RoundFeed {
  /** The round of the latest `state` (null between rounds). */
  readonly round: RoundPublic | null;
  /** Latest `scores` message of that round: participants still playing, and who is out. Null before the first. */
  readonly active: number | null;
  readonly out: readonly string[];
  /** Estimated server time (ms) for `roundTime()`: Date.now() + the offset of the last state. */
  now(): number;
}

interface FeedSocket {
  on(event: 'state', fn: (state: { round: RoundPublic | null; serverNow: number }) => void): unknown;
  on(event: 'scores', fn: (msg: { round: number; active?: number; out?: readonly string[] }) => void): unknown;
}

let round: RoundPublic | null = null;
let active: number | null = null;
let out: readonly string[] = [];
let offset = 0;

const feed: RoundFeed = {
  get round(): RoundPublic | null {
    return round;
  },
  get active(): number | null {
    return active;
  },
  get out(): readonly string[] {
    return out;
  },
  now: (): number => Date.now() + offset,
};

export function roundFeed(): RoundFeed {
  return feed;
}

/** Called by connect() for every socket. */
export function tapRoundFeed(socket: FeedSocket): void {
  socket.on('state', (state) => {
    const next = state.round ?? null;
    if (next === null || round === null || next.index !== round.index) {
      active = null;
      out = [];
    }
    round = next;
    // good to a network delay; the 3-2-1 of the finale needs no better
    if (Number.isFinite(state.serverNow)) offset = state.serverNow - Date.now();
  });
  socket.on('scores', (msg) => {
    if (round === null || msg.round !== round.index) return;
    active = typeof msg.active === 'number' ? msg.active : null;
    out = Array.isArray(msg.out) ? msg.out : [];
  });
}
