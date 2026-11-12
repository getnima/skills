/**
 * The phone's dressing rules (client/src/player/dressing-state.ts): when the dressing room
 * opens, what "dressed" means, what a reload / reconnect keeps, and the test switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOOK_SEND_INTERVAL_MS } from '../../shared/protocol';
import { canonicalLook, createDressing, dressStepEnabled } from '../../client/src/player/dressing-state';
import { createLookSender } from '../../client/src/player/look-sender';

import type { Dressing, DressingSnap } from '../../client/src/player/dressing-state';
import type { LookMemory } from '../../client/src/player/identity';

const FANCY = '1.8.8-17.9.0.11.7';
const PIRATE = '1.3.3.0.0.0.0';
const SOMBRERO = '1.5.12.0.0.11.0';
const RANDOM = '1.4.2.5.0.0.7';

/** A phone: its storage survives a "reload" (a new Dressing on the same store), the server is a variable. */
interface Phone {
  d: Dressing;
  readonly store: Map<string, LookMemory>;
  lastLook: string | null;
  /** What the "server" has for this player. */
  server: string;
  online: boolean;
  readonly sent: string[];
  readonly snaps: DressingSnap[];
  reload(): void;
}

function phone(opts: { step?: boolean; lastLook?: string | null } = {}): Phone {
  const p: Phone = {
    d: undefined as unknown as Dressing,
    store: new Map(),
    lastLook: opts.lastLook ?? null,
    server: RANDOM,
    online: true,
    sent: [],
    snaps: [],
    reload: () => {
      const sender = createLookSender({
        send: (look, done) => {
          p.sent.push(look);
          const online = p.online;
          setTimeout(() => {
            if (!online) return done(false);
            p.server = look;
            p.d.confirmed(look, look);
            done(true);
          }, 20);
        },
        ready: () => p.online,
        intervalMs: LOOK_SEND_INTERVAL_MS,
        retryMs: 1_000,
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        onPending: (pending) => p.d.pending(pending),
      });
      p.d = createDressing({
        sender,
        stepEnabled: opts.step ?? true,
        load: (code) => p.store.get(code) ?? null,
        save: (code, mem) => void p.store.set(code, mem),
        loadLast: () => p.lastLook,
        saveLast: (look) => {
          p.lastLook = look;
        },
        onChange: (s) => p.snaps.push(s),
      });
    },
  };
  p.reload();
  return p;
}

/** The app's rule (app.tsx): the dressing room shows in the lobby for a guest who is not dressed or asked for it. */
function showsDressingRoom(p: Phone, phase: string): boolean {
  const s = p.d.snap();
  return phase === 'lobby' && (s.dressing || !s.dressed);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the test switch', () => {
  it('a real phone gets the dressing room; an automated browser skips it unless asked', () => {
    expect(dressStepEnabled('?room=ABCD', false)).toBe(true);
    expect(dressStepEnabled('', false)).toBe(true);
    expect(dressStepEnabled('?room=ABCD', true)).toBe(false);
    expect(dressStepEnabled('?room=ABCD&dress=1', true)).toBe(true);
    expect(dressStepEnabled('?dress=0&room=ABCD', false)).toBe(false);
    expect(dressStepEnabled('?dress=yes', false)).toBe(true);
    expect(dressStepEnabled('?dress=yes', true)).toBe(false);
  });
});

describe('canonicalLook', () => {
  it('gives the stored form of a look and null for nothing', () => {
    expect(canonicalLook(FANCY)).toBe(FANCY);
    expect(canonicalLook('1.03.8.0.0.0.0')).toBe('1.3.8.0.0.0.0');
    expect(canonicalLook(null)).toBeNull();
    expect(canonicalLook('')).toBeNull();
    expect(canonicalLook(7)).toBeNull();
    expect(canonicalLook('hello')).toBeNull();
    expect(canonicalLook('1.0.0')).toBeNull();
    expect(canonicalLook('1.0.0.0.0.0.0')).toBe('1.0.0.0.0.0.0');
  });
});

describe('a new guest', () => {
  it('first time on this phone: no look is sent with the join, the server picks, the dressing room opens in the lobby', () => {
    const p = phone();
    expect(p.d.joinLook()).toBeUndefined();
    p.d.joined('ABCD', RANDOM, true);
    expect(p.d.snap()).toEqual({ look: RANDOM, dressed: false, dressing: false });
    expect(showsDressingRoom(p, 'lobby')).toBe(true);
    expect(p.sent).toEqual([]);
  });

  it('dressing: every change is remembered at once and sent throttled; "done" closes the room', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.setLook(PIRATE);
    expect(p.d.snap().look).toBe(PIRATE);
    expect(p.store.get('ABCD')).toEqual({ look: PIRATE, pending: true, dressed: false });
    expect(p.lastLook).toBe(PIRATE);
    vi.advanceTimersByTime(60);
    p.d.setLook(FANCY);
    vi.advanceTimersByTime(60);
    p.d.setLook(SOMBRERO);
    expect(p.sent).toEqual([PIRATE]);
    p.d.close();
    // "done" does not wait for the interval
    expect(p.sent).toEqual([PIRATE, SOMBRERO]);
    vi.advanceTimersByTime(50);
    expect(p.server).toBe(SOMBRERO);
    expect(p.d.snap()).toEqual({ look: SOMBRERO, dressed: true, dressing: false });
    expect(p.store.get('ABCD')).toEqual({ look: SOMBRERO, pending: false, dressed: true });
    expect(showsDressingRoom(p, 'lobby')).toBe(false);
  });

  it('the waiting room can open the dressing room again, and it closes the same way', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.close();
    p.d.open();
    expect(showsDressingRoom(p, 'lobby')).toBe(true);
    p.d.setLook(FANCY);
    p.d.close();
    expect(showsDressingRoom(p, 'lobby')).toBe(false);
    vi.advanceTimersByTime(50);
    expect(p.server).toBe(FANCY);
  });

  it('a guest who dressed at an earlier party brings that doll to the new room', () => {
    const p = phone({ lastLook: FANCY });
    expect(p.d.joinLook()).toBe(FANCY);
    p.server = FANCY;
    p.d.joined('WXYZ', FANCY, true);
    expect(p.d.snap()).toEqual({ look: FANCY, dressed: false, dressing: false });
    // a broken stored look is not sent
    const q = phone({ lastLook: 'not-a-look' });
    expect(q.d.joinLook()).toBeUndefined();
    // the bare doll is a look when the guest chose it
    expect(phone({ lastLook: '1.0.0.0.0.0.0' }).d.joinLook()).toBe('1.0.0.0.0.0.0');
    const r = phone({ lastLook: '' });
    expect(r.d.joinLook()).toBeUndefined();
  });

  it('with the test switch off the guest counts as dressed from the join', () => {
    const p = phone({ step: false });
    p.d.joined('ABCD', RANDOM, true);
    expect(p.d.snap()).toEqual({ look: RANDOM, dressed: true, dressing: false });
    expect(showsDressingRoom(p, 'lobby')).toBe(false);
    p.d.open();
    expect(showsDressingRoom(p, 'lobby')).toBe(true);
  });
});

describe('a round takes over', () => {
  it('the owner starts a round while the guest is dressing: closed at once, the latest look goes out now, dressed', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.phase('lobby');
    p.d.setLook(PIRATE);
    vi.advanceTimersByTime(40);
    p.d.setLook(FANCY);
    expect(p.sent).toEqual([PIRATE]);
    p.d.phase('intro');
    expect(showsDressingRoom(p, 'intro')).toBe(false);
    expect(p.sent).toEqual([PIRATE, FANCY]);
    expect(p.d.snap()).toEqual({ look: FANCY, dressed: true, dressing: false });
    // the room's own last report on unmount (a change it had not reported yet) is sent without waiting
    p.d.setLook(SOMBRERO);
    vi.advanceTimersByTime(25);
    expect(p.sent).toEqual([PIRATE, FANCY, SOMBRERO]);
    vi.advanceTimersByTime(50);
    expect(p.server).toBe(SOMBRERO);
    // back in the lobby after the round: the waiting room, not the dressing room
    p.d.phase('lobby');
    expect(showsDressingRoom(p, 'lobby')).toBe(false);
  });

  it('a re-opened dressing room is closed by a round too', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.close();
    p.d.phase('intro');
    p.d.phase('results');
    p.d.phase('lobby');
    p.d.open();
    p.d.setLook(PIRATE);
    p.d.phase('intro');
    expect(p.d.snap().dressing).toBe(false);
    expect(p.sent).toEqual([PIRATE]);
    p.d.phase('lobby');
    expect(showsDressingRoom(p, 'lobby')).toBe(false);
  });

  it('a late joiner (the round is running): no dressing room now, it opens at the next lobby', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.phase('playing');
    expect(showsDressingRoom(p, 'playing')).toBe(false);
    expect(p.d.snap().dressed).toBe(false);
    p.d.phase('results');
    expect(showsDressingRoom(p, 'results')).toBe(false);
    expect(p.d.snap().dressed).toBe(false);
    p.d.phase('lobby');
    expect(showsDressingRoom(p, 'lobby')).toBe(true);
    // results straight into the next round: still waiting for a lobby
    p.d.phase('lobby');
    expect(showsDressingRoom(p, 'lobby')).toBe(true);
  });

  it('a joiner during the intro or the results is treated the same', () => {
    for (const first of ['intro', 'countdown', 'results', 'final'] as const) {
      const p = phone();
      p.d.joined('ABCD', RANDOM, true);
      p.d.phase(first);
      expect(showsDressingRoom(p, first)).toBe(false);
      expect(p.d.snap().dressed).toBe(false);
      p.d.phase('lobby');
      expect(showsDressingRoom(p, 'lobby')).toBe(true);
    }
  });
});

describe('reload and reconnect', () => {
  it('a reload in the dressing room: still in the dressing room, with the look', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.setLook(PIRATE);
    vi.advanceTimersByTime(100);
    expect(p.server).toBe(PIRATE);
    p.reload();
    p.d.joined('ABCD', p.server, false);
    expect(p.d.snap()).toEqual({ look: PIRATE, dressed: false, dressing: false });
    expect(showsDressingRoom(p, 'lobby')).toBe(true);
  });

  it('a reload after "done": the waiting room, with the look', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.setLook(FANCY);
    p.d.close();
    vi.advanceTimersByTime(100);
    p.reload();
    p.d.joined('ABCD', p.server, false);
    expect(p.d.snap()).toEqual({ look: FANCY, dressed: true, dressing: false });
    expect(showsDressingRoom(p, 'lobby')).toBe(false);
  });

  it('a reload right after a tap, before the look was sent: the phone sends it after the resume', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.setLook(PIRATE);
    vi.advanceTimersByTime(100);
    p.d.setLook(FANCY); // waits for the interval...
    expect(p.server).toBe(PIRATE);
    p.reload(); // ...and the page reloads
    p.d.joined('ABCD', p.server, false);
    expect(p.d.snap().look).toBe(FANCY);
    vi.advanceTimersByTime(100);
    expect(p.server).toBe(FANCY);
    expect(p.store.get('ABCD')).toEqual({ look: FANCY, pending: false, dressed: false });
  });

  it('changes made while offline are sent when the link is back; the server look does not overwrite them', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.setLook(PIRATE);
    vi.advanceTimersByTime(100);
    p.online = false;
    p.d.setLook(FANCY);
    p.d.setLook(SOMBRERO);
    vi.advanceTimersByTime(5_000);
    expect(p.server).toBe(PIRATE);
    p.online = true;
    p.d.joined('ABCD', p.server, false);
    expect(p.d.snap().look).toBe(SOMBRERO);
    vi.advanceTimersByTime(100);
    expect(p.server).toBe(SOMBRERO);
    expect(p.sent.at(-1)).toBe(SOMBRERO);
  });

  it('nothing pending: the server look is what the phone shows after a resume', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.setLook(PIRATE);
    p.d.close();
    vi.advanceTimersByTime(100);
    // (cannot happen with one phone per seat, but the server is the truth)
    p.server = FANCY;
    p.d.joined('ABCD', p.server, false);
    expect(p.d.snap().look).toBe(FANCY);
    const sentBefore = p.sent.length;
    vi.advanceTimersByTime(1_000);
    expect(p.sent.length).toBe(sentBefore);
    expect(p.d.snap().dressed).toBe(true);
  });

  it('a seat with no look memory (storage blocked, or from before this feature) is not dressed', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, false);
    expect(p.d.snap()).toEqual({ look: RANDOM, dressed: false, dressing: false });
  });

  it('storage blocked: a reconnect inside the same page still remembers everything', () => {
    const p = phone();
    p.store.set = () => p.store; // writes are lost
    p.d.joined('ABCD', RANDOM, true);
    p.d.setLook(PIRATE);
    p.d.close();
    vi.advanceTimersByTime(100);
    p.d.joined('ABCD', p.server, false);
    expect(p.d.snap()).toEqual({ look: PIRATE, dressed: true, dressing: false });
  });

  it('a new seat (kicked and back, or a new room): starts over, from the doll the guest dressed last', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.setLook(FANCY);
    p.d.close();
    p.d.open();
    vi.advanceTimersByTime(100);
    expect(p.d.joinLook()).toBe(FANCY);
    p.server = FANCY;
    p.d.joined('ABCD', FANCY, true);
    expect(p.d.snap()).toEqual({ look: FANCY, dressed: false, dressing: false });
    // the phase before the new seat does not count: joining into a running round is a late join
    p.d.phase('playing');
    expect(p.d.snap().dressed).toBe(false);
  });

  it('a reload while a round starts: the guest never finished, the dressing room comes back at the next lobby', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.phase('lobby');
    p.reload();
    p.d.joined('ABCD', p.server, false);
    p.d.phase('intro');
    expect(p.d.snap().dressed).toBe(false);
    p.d.phase('results');
    p.d.phase('lobby');
    expect(showsDressingRoom(p, 'lobby')).toBe(true);
  });

  it('a reconnect inside the page while a round started: the round took over', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.phase('lobby');
    p.d.setLook(PIRATE);
    // the phone was locked; the first snapshot after the resume is already the intro
    p.d.joined('ABCD', p.server, false);
    p.d.phase('intro');
    expect(p.d.snap().dressed).toBe(true);
  });
});

describe('what the screens hear', () => {
  it('onChange fires only when something changed', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    const n = p.snaps.length;
    p.d.setLook(RANDOM);
    p.d.phase('lobby');
    p.d.phase('lobby');
    expect(p.snaps.length).toBe(n);
    p.d.setLook(PIRATE);
    p.d.setLook(PIRATE);
    expect(p.snaps.length).toBe(n + 1);
    p.d.open();
    p.d.open();
    expect(p.snaps.length).toBe(n + 2);
  });

  it('a look that is not a look is ignored', () => {
    const p = phone();
    p.d.joined('ABCD', RANDOM, true);
    p.d.setLook('');
    expect(p.d.snap().look).toBe(RANDOM);
    expect(p.sent).toEqual([]);
  });
});
