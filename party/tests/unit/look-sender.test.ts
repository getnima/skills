/** The phone's look sender: the latest look, a few times per second at most, never lost. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOOK_SEND_INTERVAL_MS } from '../../shared/protocol';
import { createLookSender } from '../../client/src/player/look-sender';

import type { LookSender } from '../../client/src/player/look-sender';

interface Rig {
  readonly sender: LookSender;
  /** Every send: the look and the time. */
  readonly sent: Array<{ look: string; at: number }>;
  readonly pending: boolean[];
  online: boolean;
  /** How the "server" answers: after `ackMs`, settled or not. */
  ackMs: number;
  answers: boolean;
}

function rig(): Rig {
  const r: Rig = {
    sent: [],
    pending: [],
    online: true,
    ackMs: 20,
    answers: true,
    sender: createLookSender({
      send: (look, done) => {
        r.sent.push({ look, at: Date.now() });
        const answers = r.answers;
        // no answer = the socket's own timeout, 2 s later
        setTimeout(() => done(answers), answers ? r.ackMs : 2_000);
      },
      ready: () => r.online,
      intervalMs: LOOK_SEND_INTERVAL_MS,
      retryMs: 1_000,
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onPending: (p) => r.pending.push(p),
    }),
  };
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('look sender', () => {
  it('the first change goes out at once', () => {
    const r = rig();
    r.sender.set('a');
    expect(r.sent.map((s) => s.look)).toEqual(['a']);
    expect(r.sender.pending()).toBe(true);
    vi.advanceTimersByTime(r.ackMs);
    expect(r.sender.pending()).toBe(false);
    expect(r.pending).toEqual([true, false]);
  });

  it('a burst of taps: the latest look, at most one send per interval', () => {
    const r = rig();
    const t0 = Date.now();
    // a change every 30 ms for 3 seconds
    for (let i = 0; i < 100; i++) {
      r.sender.set(`look-${i}`);
      vi.advanceTimersByTime(30);
    }
    vi.advanceTimersByTime(2_000);
    const n = r.sent.length;
    expect(n).toBeLessThanOrEqual(Math.ceil(3_000 / LOOK_SEND_INTERVAL_MS) + 1);
    expect(n).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < n; i++) expect((r.sent[i] as { at: number }).at - (r.sent[i - 1] as { at: number }).at).toBeGreaterThanOrEqual(LOOK_SEND_INTERVAL_MS);
    // the first tap was not delayed, the last look is the one that ends up on the server
    expect((r.sent[0] as { at: number }).at).toBe(t0);
    expect(r.sent.at(-1)?.look).toBe('look-99');
    expect(r.sender.pending()).toBe(false);
  });

  it('the last change of a burst is sent within one interval of the tap', () => {
    const r = rig();
    r.sender.set('a');
    vi.advanceTimersByTime(40);
    r.sender.set('b');
    const tapAt = Date.now();
    vi.advanceTimersByTime(LOOK_SEND_INTERVAL_MS);
    expect(r.sent.map((s) => s.look)).toEqual(['a', 'b']);
    expect((r.sent[1] as { at: number }).at - tapAt).toBeLessThanOrEqual(LOOK_SEND_INTERVAL_MS);
  });

  it('never two sends at the same time: a slow answer holds the next look back', () => {
    const r = rig();
    r.ackMs = 900;
    r.sender.set('a');
    vi.advanceTimersByTime(100);
    r.sender.set('b');
    vi.advanceTimersByTime(100);
    r.sender.set('c');
    vi.advanceTimersByTime(600);
    expect(r.sent.map((s) => s.look)).toEqual(['a']);
    vi.advanceTimersByTime(200);
    expect(r.sent.map((s) => s.look)).toEqual(['a', 'c']);
    vi.advanceTimersByTime(1_000);
    expect(r.sender.pending()).toBe(false);
  });

  it('flush sends the waiting look now (the dressing room closed, a round is starting)', () => {
    const r = rig();
    r.sender.set('a');
    vi.advanceTimersByTime(50);
    r.sender.set('b');
    expect(r.sent.map((s) => s.look)).toEqual(['a']);
    r.sender.flush();
    expect(r.sent.map((s) => s.look)).toEqual(['a', 'b']);
    // while a send is on its way, flush makes the next one follow the answer at once
    r.ackMs = 300;
    r.sender.set('c');
    vi.advanceTimersByTime(LOOK_SEND_INTERVAL_MS);
    expect(r.sent.at(-1)?.look).toBe('c');
    r.sender.set('d');
    r.sender.flush();
    vi.advanceTimersByTime(300);
    expect(r.sent.at(-1)?.look).toBe('d');
    expect((r.sent.at(-1) as { at: number }).at - (r.sent.at(-2) as { at: number }).at).toBe(300);
  });

  it('offline: nothing is sent, the look waits, and goes out on flush when the link is back', () => {
    const r = rig();
    r.online = false;
    r.sender.set('a');
    r.sender.set('b');
    vi.advanceTimersByTime(10_000);
    expect(r.sent).toEqual([]);
    expect(r.sender.pending()).toBe(true);
    r.online = true;
    r.sender.flush();
    expect(r.sent.map((s) => s.look)).toEqual(['b']);
    vi.advanceTimersByTime(r.ackMs);
    expect(r.sender.pending()).toBe(false);
    expect(r.pending).toEqual([true, false]);
  });

  it('no answer: the look is sent again until the server answers', () => {
    const r = rig();
    r.answers = false;
    r.sender.set('a');
    vi.advanceTimersByTime(2_000 + 1_000);
    expect(r.sent.map((s) => s.look)).toEqual(['a', 'a']);
    expect(r.sender.pending()).toBe(true);
    r.answers = true;
    vi.advanceTimersByTime(2_000 + 1_000);
    expect(r.sent.map((s) => s.look)).toEqual(['a', 'a', 'a']);
    vi.advanceTimersByTime(r.ackMs);
    expect(r.sender.pending()).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(r.sent).toHaveLength(3);
  });

  it('a look changed while unanswered: the newest one is what gets retried', () => {
    const r = rig();
    r.answers = false;
    r.sender.set('a');
    vi.advanceTimersByTime(500);
    r.sender.set('b');
    r.answers = true;
    vi.advanceTimersByTime(2_500 + 1_000);
    expect(r.sent.map((s) => s.look)).toEqual(['a', 'b']);
    vi.advanceTimersByTime(r.ackMs);
    expect(r.sender.pending()).toBe(false);
  });

  it('reset forgets what is waiting, and a late answer to an old send changes nothing', () => {
    const r = rig();
    r.ackMs = 500;
    r.sender.set('a');
    r.sender.reset();
    expect(r.sender.pending()).toBe(false);
    r.sender.set('b');
    // the interval still holds after a reset
    expect(r.sent.map((s) => s.look)).toEqual(['a']);
    vi.advanceTimersByTime(LOOK_SEND_INTERVAL_MS);
    expect(r.sent.map((s) => s.look)).toEqual(['a', 'b']);
    // the answer to 'a' arrives (500 ms after it was sent): 'b' is still the one on its way
    vi.advanceTimersByTime(500 - LOOK_SEND_INTERVAL_MS);
    expect(r.sender.pending()).toBe(true);
    vi.advanceTimersByTime(LOOK_SEND_INTERVAL_MS - 1);
    expect(r.sender.pending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(r.sender.pending()).toBe(false);
  });

  it('setting the same look again while it is on its way does not send it twice', () => {
    const r = rig();
    r.sender.set('a');
    r.sender.set('a');
    vi.advanceTimersByTime(1_000);
    expect(r.sent.map((s) => s.look)).toEqual(['a']);
  });
});
