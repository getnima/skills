/** The remote's gate as pure parts: password, guess throttle, relay limits, room choice, client address, config. */
import { describe, expect, it } from 'vitest';

import { RELAY_MAX_BYTES } from '../../shared/protocol';
import { configFromEnv, DEFAULT_REMOTE_THROTTLE, remoteFromEnv } from '../../server/config';
import { checkPassword, chooseRoom, cleanRelayData, clientAddress, GuessThrottle, PASSWORD_MAX_LEN, RateLimiter, screenRooms, waitText } from '../../server/remote-auth';

const PW = 'kioso3tbh';

describe('checkPassword', () => {
  it('accepts exactly the password', () => {
    expect(checkPassword(PW, PW)).toBe(true);
  });
  it('refuses a wrong, a near, a padded and an upper-cased password', () => {
    for (const bad of ['kioso3tb', 'kioso3tbhh', ' kioso3tbh', 'KIOSO3TBH', 'kioso3tbH', 'x']) expect(checkPassword(bad, PW)).toBe(false);
  });
  it('refuses empty, very long and non-string input without throwing', () => {
    expect(checkPassword('', PW)).toBe(false);
    expect(checkPassword('a'.repeat(PASSWORD_MAX_LEN + 1), PW)).toBe(false);
    expect(checkPassword(PW + 'a'.repeat(100_000), PW)).toBe(false);
    for (const v of [undefined, null, 0, 123, true, {}, [], [PW], { toString: () => PW }, Symbol('x')]) expect(checkPassword(v, PW)).toBe(false);
  });
  it('never accepts anything when the expected password is empty', () => {
    expect(checkPassword('', '')).toBe(false);
    expect(checkPassword('a', '')).toBe(false);
  });
});

describe('GuessThrottle', () => {
  const cfg = { maxFails: 5, windowMs: 60_000, lockMs: 30_000, maxLockMs: 300_000 };
  const keys = ['socket:a', 'ip:1.2.3.4'];

  it('four wrong tries are fine, the fifth locks for 30 s', () => {
    const t = new GuessThrottle(cfg);
    let now = 1_000;
    for (let i = 0; i < 4; i++) {
      expect(t.check(keys, now).ok).toBe(true);
      expect(t.fail(keys, now)).toEqual({ ok: true });
      now += 1_000;
    }
    expect(t.fail(keys, now)).toEqual({ ok: false, retryMs: 30_000 });
    expect(t.check(keys, now + 1)).toEqual({ ok: false, retryMs: 29_999 });
    expect(t.check(keys, now + 29_999).ok).toBe(false);
    expect(t.check(keys, now + 30_000).ok).toBe(true);
  });

  it('wrong tries spread over more than the window never lock', () => {
    const t = new GuessThrottle(cfg);
    let now = 0;
    for (let i = 0; i < 20; i++) {
      expect(t.fail(keys, now).ok).toBe(true);
      now += 15_001; // 4 tries per minute at most
    }
  });

  it('every repeat lock doubles, up to 5 minutes', () => {
    const t = new GuessThrottle(cfg);
    let now = 0;
    const locks: number[] = [];
    for (let round = 0; round < 6; round++) {
      let verdict = t.fail(keys, now);
      for (let i = 1; i < 5; i++) verdict = t.fail(keys, now);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        locks.push(verdict.retryMs);
        now += verdict.retryMs;
      }
    }
    expect(locks).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });

  it('one locked key is enough: another socket from the same IP waits too, another IP does not', () => {
    const t = new GuessThrottle(cfg);
    for (let i = 0; i < 5; i++) t.fail(['socket:a', 'ip:9.9.9.9'], 0);
    expect(t.check(['socket:b', 'ip:9.9.9.9'], 10).ok).toBe(false);
    expect(t.check(['socket:a', 'ip:8.8.8.8'], 10).ok).toBe(false);
    expect(t.check(['socket:c', 'ip:8.8.8.8'], 10).ok).toBe(true);
  });

  it('five sockets from one IP, one try each, lock the IP', () => {
    const t = new GuessThrottle(cfg);
    let last = t.fail(['socket:1', 'ip:5.5.5.5'], 0);
    for (let i = 2; i <= 5; i++) last = t.fail([`socket:${i}`, 'ip:5.5.5.5'], i);
    expect(last.ok).toBe(false);
    expect(t.check(['socket:6', 'ip:5.5.5.5'], 10).ok).toBe(false);
  });

  it('a right password clears the keys it names; sweep forgets old keys', () => {
    const t = new GuessThrottle(cfg);
    for (let i = 0; i < 4; i++) t.fail(keys, 0);
    t.succeed(['socket:a']);
    expect(t.fail(['socket:a'], 1).ok).toBe(true);
    expect(t.size).toBe(2);
    expect(t.sweep(60 * 60_000)).toBe(0);
  });

  it('the wait text rounds up and never says the password', () => {
    expect(waitText(29_001)).toContain('30');
    expect(waitText(1)).toContain('שנייה');
    expect(waitText(30_000)).not.toContain(PW);
  });
});

describe('RateLimiter', () => {
  it('20 per second, then refuses until the window slides', () => {
    const r = new RateLimiter(20, 1_000);
    for (let i = 0; i < 20; i++) expect(r.take(100 + i)).toBe(true);
    expect(r.take(500)).toBe(false);
    expect(r.take(1_099)).toBe(false);
    expect(r.take(1_100)).toBe(true);
    expect(r.take(1_100)).toBe(false);
  });
});

describe('cleanRelayData', () => {
  it('passes a small JSON object through as a fresh copy', () => {
    const data = { t: 'model', model: { a: [1, 'x', null, true], b: { c: 2 } } };
    const out = cleanRelayData(data);
    expect(out).toEqual(data);
    expect(out).not.toBe(data);
  });
  it('refuses non-objects, arrays, class instances and oversized payloads', () => {
    for (const v of [undefined, null, 1, 'x', true, [], [1], new Date(), new Map(), Buffer.from('x')]) expect(cleanRelayData(v)).toBeNull();
    expect(cleanRelayData({ big: 'x'.repeat(RELAY_MAX_BYTES) })).toBeNull();
    expect(cleanRelayData({ ok: 'x'.repeat(RELAY_MAX_BYTES - 20) })).not.toBeNull();
    // multi-byte characters count in bytes
    expect(cleanRelayData({ he: 'ש'.repeat(RELAY_MAX_BYTES / 2) })).toBeNull();
  });
  it('refuses cycles and BigInt without throwing', () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(cleanRelayData(cyc)).toBeNull();
    expect(cleanRelayData({ n: BigInt(1) })).toBeNull();
  });
});

describe('room choice', () => {
  const room = (code: string, screen: boolean, activeAt: number) => ({ code, screen, activeAt });

  it('no rooms, or no TV anywhere: none (open the TV page first)', () => {
    expect(chooseRoom([], null)).toEqual({ kind: 'none', rooms: [] });
    expect(chooseRoom([room('ABCD', false, 5)], null)).toEqual({ kind: 'none', rooms: [] });
  });
  it('exactly one room with a TV: that one, whatever else exists', () => {
    expect(chooseRoom([room('ABCD', false, 9), room('WXYZ', true, 1)], null)).toEqual({ kind: 'room', code: 'WXYZ' });
  });
  it('several rooms with a TV: choose, most recently active first', () => {
    expect(chooseRoom([room('AAAA', true, 1), room('BBBB', true, 3), room('CCCC', false, 9), room('DDDD', true, 2)], null)).toEqual({
      kind: 'choose',
      rooms: ['BBBB', 'DDDD', 'AAAA'],
    });
  });
  it('a known code wins even while its TV is away; an unknown code lists the live rooms', () => {
    expect(chooseRoom([room('AAAA', false, 1), room('BBBB', true, 3)], 'AAAA')).toEqual({ kind: 'room', code: 'AAAA' });
    expect(chooseRoom([room('BBBB', true, 3)], 'ZZZZ')).toEqual({ kind: 'none', rooms: ['BBBB'] });
  });
  it('screenRooms lists only rooms with a TV', () => {
    expect(screenRooms([room('A', false, 1), room('B', true, 2)])).toEqual(['B']);
  });
});

describe('clientAddress', () => {
  it('a direct guest is its peer address', () => {
    expect(clientAddress('203.0.113.7', undefined)).toBe('203.0.113.7');
    expect(clientAddress('::ffff:203.0.113.7', '1.1.1.1')).toBe('203.0.113.7');
  });
  it('behind a local proxy: the forwarded address', () => {
    expect(clientAddress('127.0.0.1', '198.51.100.4')).toBe('198.51.100.4');
    expect(clientAddress('::1', '198.51.100.4, 10.0.0.1')).toBe('198.51.100.4');
    expect(clientAddress('169.254.1.1', ['198.51.100.9'])).toBe('198.51.100.9');
  });
  it('a LAN phone with no proxy header is its LAN address', () => {
    expect(clientAddress('192.168.1.23', undefined)).toBe('192.168.1.23');
    expect(clientAddress(undefined, undefined)).toBe('unknown');
  });
});

describe('config', () => {
  it('the default password is the owner\'s choice; the env var overrides it', () => {
    expect(remoteFromEnv({}).remotePassword).toBe(PW);
    expect(remoteFromEnv({ PARTY_REMOTE_PASSWORD: '  other  ' }).remotePassword).toBe('other');
    expect(remoteFromEnv({ PARTY_REMOTE_PASSWORD: '   ' }).remotePassword).toBe(PW);
    expect(configFromEnv({ PARTY_REMOTE_PASSWORD: 'zz' }).remotePassword).toBe('zz');
  });
  it('the throttle is 5 / minute, 30 s doubling to 5 min; a test env var shortens the lock only', () => {
    expect(remoteFromEnv({}).remoteThrottle).toEqual(DEFAULT_REMOTE_THROTTLE);
    expect(DEFAULT_REMOTE_THROTTLE).toEqual({ maxFails: 5, windowMs: 60_000, lockMs: 30_000, maxLockMs: 300_000 });
    expect(remoteFromEnv({ PARTY_TEST_REMOTE_LOCK_MS: '3000' }).remoteThrottle).toEqual({ maxFails: 5, windowMs: 60_000, lockMs: 3_000, maxLockMs: 12_000 });
  });
});
