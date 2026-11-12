/**
 * The phone remote against the real server (express + socket.io on a free port):
 * the password, the guess throttle, roles, state.remotes, the relay between the
 * hosts of one room, and that the password never travels back to any client.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';

import { RELAY_MAX_BYTES } from '../../shared/protocol';
import { createPartyApp } from '../../server/app';

import type { Socket } from 'socket.io-client';
import type { RoomState } from '../../shared/protocol';
import type { PartyApp } from '../../server/app';

const PW = 'test-remote-pw-42';
const LOCK_MS = 400;
let app: PartyApp;
let url = '';
const sockets: Socket[] = [];
/** Every message any test client received, raw. */
const frames: string[] = [];
let ipSeq = 10;

/** Each test client gets its own forwarded address unless told otherwise (the server sees 127.0.0.1 = a proxy). */
function connect(ip = `203.0.113.${ipSeq++}`): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { 'x-forwarded-for': ip } });
    sockets.push(s);
    s.once('connect', () => {
      s.io.engine.on('data', (d: unknown) => frames.push(typeof d === 'string' ? d : String(d)));
      resolve(s);
    });
    s.once('connect_error', reject);
  });
}

function call(s: Socket, event: string, ...args: unknown[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 2_000);
    s.emit(event, ...args, (res: unknown) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(what: string, check: () => boolean, ms = 4_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

interface Client {
  readonly s: Socket;
  state: RoomState | null;
  readonly relays: Array<{ from: string; data: any }>;
}

function track(s: Socket): Client {
  const c: Client = { s, state: null, relays: [] };
  s.on('state', (st: RoomState) => {
    c.state = st;
  });
  s.on('relay', (msg: { from: string; data: unknown }) => c.relays.push(msg));
  return c;
}

async function newTv(): Promise<Client & { code: string }> {
  const c = track(await connect());
  const res = await call(c.s, 'host:create', {});
  expect(res.ok).toBe(true);
  c.state = res.state;
  return Object.assign(c, { code: res.code as string });
}

async function newRemote(code?: string, ip?: string): Promise<Client & { res: any }> {
  const c = track(await connect(ip));
  const res = await call(c.s, 'remote:attach', code === undefined ? { password: PW } : { password: PW, code });
  if (res.ok) c.state = res.state;
  return Object.assign(c, { res });
}

function closeAll(list: readonly Client[]): void {
  for (const c of list) c.s.close();
}

beforeAll(async () => {
  app = createPartyApp({
    port: 0,
    origins: null,
    timing: { introMs: 150, countdownMs: 150, durationMs: () => 1_500 },
    remotePassword: PW,
    remoteThrottle: { maxFails: 5, windowMs: 60_000, lockMs: LOCK_MS, maxLockMs: LOCK_MS * 4 },
  });
  const port = await app.listen();
  url = `http://localhost:${port}`;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await app.close();
  await new Promise<void>((r) => app.http.close(() => r()));
});

describe('remote:attach', () => {
  it('a wrong, empty, missing or non-string password is BAD_PASSWORD and reveals nothing', async () => {
    const tv = await newTv();
    let s = await connect();
    const bodies = [{ password: 'nope' }, { password: '' }, {}, { password: 42 }, { password: [PW] }, null, 'x', { password: 'a'.repeat(10_000) }];
    for (const [i, body] of bodies.entries()) {
      // four per socket and address: the fifth wrong try would (rightly) lock
      if (i === 4) s = await connect();
      const res = await call(s, 'remote:attach', body);
      expect(res).toEqual({ ok: false, error: 'BAD_PASSWORD', message: 'סיסמה שגויה', rooms: [], retryMs: null });
    }
    // it stays a nobody: no host events, no relay, no room data
    expect((await call(s, 'host:start', { gameId: 'tap' })).error).toBe('NOT_HOST');
    expect((await call(s, 'host:relay', { data: { t: 'hello' } })).error).toBe('NOT_HOST');
    closeAll([tv]);
  });

  it('with no TV page open: ROOM_NOT_FOUND "open the TV page first"; it attaches once one is', async () => {
    // a fresh server keeps this test independent of the rooms other tests left behind
    const solo = createPartyApp({ port: 0, origins: null, timing: { introMs: 150, countdownMs: 150, durationMs: () => 1_500 }, remotePassword: PW });
    const port = await solo.listen();
    try {
      const r = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
      await new Promise<void>((res) => r.once('connect', () => res()));
      const res = await call(r, 'remote:attach', { password: PW });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('ROOM_NOT_FOUND');
      expect(res.message).toContain('הטלוויזיה');
      expect(res.rooms).toEqual([]);
      const tv = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
      await new Promise<void>((res2) => tv.once('connect', () => res2()));
      const made = await call(tv, 'host:create', {});
      const again = await call(r, 'remote:attach', { password: PW });
      expect(again).toMatchObject({ ok: true, code: made.code, rooms: [made.code] });
      expect(again.state.remotes).toBe(1);
      r.close();
      tv.close();
    } finally {
      await solo.close();
      await new Promise<void>((res) => solo.http.close(() => res()));
    }
  });

  it('several TVs: CHOOSE_ROOM lists them (most recent first); a code picks one; an unknown code says so', async () => {
    const a = await newTv();
    await sleep(5);
    const b = await newTv();
    const r = await newRemote();
    expect(r.res.ok).toBe(false);
    expect(r.res.error).toBe('CHOOSE_ROOM');
    expect(r.res.rooms.indexOf(b.code)).toBeLessThan(r.res.rooms.indexOf(a.code));
    const pick = await call(r.s, 'remote:attach', { password: PW, code: a.code.toLowerCase() });
    expect(pick).toMatchObject({ ok: true, code: a.code });
    const bad = await call(r.s, 'remote:attach', { password: PW, code: 'QQQQ' });
    expect(bad.error).toBe('ROOM_NOT_FOUND');
    expect(bad.rooms).toContain(a.code);
    closeAll([a, b, r]);
  });

  it('state.remotes rises on attach and falls on disconnect; the TV is told each time', async () => {
    const tv = await newTv();
    expect(tv.state?.remotes).toBe(0);
    const r1 = await newRemote(tv.code);
    expect(r1.res).toMatchObject({ ok: true, code: tv.code });
    await until('tv sees 1 remote', () => tv.state?.remotes === 1);
    const r2 = await newRemote(tv.code);
    await until('tv sees 2 remotes', () => tv.state?.remotes === 2);
    expect(r1.state?.remotes).toBe(2);
    // attaching the same socket again is still one remote
    await call(r2.s, 'remote:attach', { password: PW, code: tv.code });
    await sleep(50);
    expect(tv.state?.remotes).toBe(2);
    r1.s.close();
    await until('tv sees 1 remote', () => tv.state?.remotes === 1);
    r2.s.close();
    await until('tv sees 0 remotes', () => tv.state?.remotes === 0);
    // the state holds the count and nothing else about remotes
    expect(Object.keys(tv.state ?? {}).sort()).toEqual(['autoCutscenes', 'code', 'cutscene', 'phase', 'played', 'players', 'remotes', 'results', 'round', 'serverNow'].sort());
    closeAll([tv]);
  });

  it('a remote is a full host: every host:* event works from it', async () => {
    const tv = await newTv();
    const r = await newRemote(tv.code);
    const p = track(await connect());
    const joined = await call(p.s, 'player:join', { code: tv.code, name: 'דנה' });
    expect(joined.ok).toBe(true);
    expect(await call(r.s, 'host:setAutoCutscenes', { enabled: false })).toEqual({ ok: true });
    expect(await call(r.s, 'host:cutscene', { id: 'joker_1' })).toEqual({ ok: true });
    expect(await call(r.s, 'host:cutsceneEnd', {})).toEqual({ ok: true });
    expect(await call(r.s, 'host:start', { gameId: 'tap' })).toEqual({ ok: true });
    await until('tv in intro', () => tv.state?.phase === 'intro');
    expect(await call(r.s, 'host:endRound', {})).toEqual({ ok: true });
    await until('tv back in lobby', () => tv.state?.phase === 'lobby');
    expect(await call(r.s, 'host:final', {})).toEqual({ ok: true });
    expect(await call(r.s, 'host:lobby', {})).toEqual({ ok: true });
    expect(await call(r.s, 'host:kick', { playerId: joined.playerId })).toEqual({ ok: true });
    await until('player gone', () => tv.state?.players.length === 0);
    expect(await call(r.s, 'host:reset', {})).toEqual({ ok: true });
    closeAll([tv, r, p]);
  });

  it('a player cannot become a host by asking, and cannot use host:* or host:relay', async () => {
    const tv = await newTv();
    const p = track(await connect());
    await call(p.s, 'player:join', { code: tv.code, name: 'גיא' });
    expect((await call(p.s, 'host:start', { gameId: 'tap' })).error).toBe('NOT_HOST');
    expect((await call(p.s, 'host:relay', { data: { t: 'hello' } })).error).toBe('NOT_HOST');
    expect((await call(p.s, 'remote:attach', { password: 'guess' })).error).toBe('BAD_PASSWORD');
    expect((await call(p.s, 'host:relay', { data: { t: 'hello' } })).error).toBe('NOT_HOST');
    closeAll([tv, p]);
  });
});

describe('host:relay', () => {
  it('reaches only the OTHER hosts of the same room, with the sender role', async () => {
    const tv = await newTv();
    const r1 = await newRemote(tv.code);
    const r2 = await newRemote(tv.code);
    const p = track(await connect());
    await call(p.s, 'player:join', { code: tv.code, name: 'נועה' });
    const otherTv = await newTv();
    const otherRemote = await newRemote(otherTv.code);
    let playerGotRelay = false;
    p.s.on('relay', () => {
      playerGotRelay = true;
    });

    expect(await call(tv.s, 'host:relay', { data: { t: 'model', n: 1 } })).toEqual({ ok: true });
    await until('both remotes got it', () => r1.relays.length === 1 && r2.relays.length === 1);
    expect(r1.relays[0]).toEqual({ from: 'screen', data: { t: 'model', n: 1 } });
    expect(await call(r1.s, 'host:relay', { data: { t: 'run', id: 'next' } })).toEqual({ ok: true });
    await until('tv got the press', () => tv.relays.length === 1);
    expect(tv.relays[0]).toEqual({ from: 'remote', data: { t: 'run', id: 'next' } });
    await until('the other remote got it too', () => r2.relays.length === 2);
    await sleep(80);
    expect(r1.relays.length).toBe(1); // never echoed to the sender
    expect(playerGotRelay).toBe(false);
    expect(otherTv.relays.length).toBe(0);
    expect(otherRemote.relays.length).toBe(0);
    closeAll([tv, r1, r2, p, otherTv, otherRemote]);
  });

  it('refuses a payload that is not a small JSON object', async () => {
    const tv = await newTv();
    const r = await newRemote(tv.code);
    for (const data of [undefined, null, 'x', 5, [1, 2], { big: 'x'.repeat(RELAY_MAX_BYTES) }]) {
      const res = await call(tv.s, 'host:relay', { data });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('BAD_REQUEST');
    }
    expect((await call(tv.s, 'host:relay', 'not even an object')).error).toBe('BAD_REQUEST');
    await sleep(50);
    expect(r.relays.length).toBe(0);
    closeAll([tv, r]);
  });

  it('20 relays a second per socket, then THROTTLED', async () => {
    const tv = await newTv();
    const r = await newRemote(tv.code);
    const answers = await Promise.all(Array.from({ length: 26 }, (_, i) => call(tv.s, 'host:relay', { data: { i } })));
    const ok = answers.filter((a) => a.ok).length;
    expect(ok).toBe(20);
    expect(answers.filter((a) => !a.ok).every((a) => a.error === 'THROTTLED')).toBe(true);
    await sleep(1_050);
    expect((await call(tv.s, 'host:relay', { data: { again: true } })).ok).toBe(true);
    closeAll([tv, r]);
  });
});

describe('guess throttle over the wire', () => {
  it('5 wrong tries from one socket: THROTTLED with the wait, the right one too; after the wait it works', async () => {
    const tv = await newTv();
    const s = await connect('198.51.100.77');
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push(await call(s, 'remote:attach', { password: `wrong${i}` }));
    expect(answers.slice(0, 4).every((a) => a.error === 'BAD_PASSWORD')).toBe(true);
    expect(answers[4]).toMatchObject({ ok: false, error: 'THROTTLED', retryMs: LOCK_MS });
    const locked = await call(s, 'remote:attach', { password: PW, code: tv.code });
    expect(locked.error).toBe('THROTTLED');
    expect(locked.retryMs).toBeGreaterThan(0);
    expect(locked.retryMs).toBeLessThanOrEqual(LOCK_MS);
    // the same IP from a new socket waits too; another IP does not
    const sameIp = await connect('198.51.100.77');
    expect((await call(sameIp, 'remote:attach', { password: PW, code: tv.code })).error).toBe('THROTTLED');
    const otherIp = await connect('198.51.100.78');
    expect((await call(otherIp, 'remote:attach', { password: PW, code: tv.code })).ok).toBe(true);
    await sleep(LOCK_MS + 50);
    expect(await call(s, 'remote:attach', { password: PW, code: tv.code })).toMatchObject({ ok: true, code: tv.code });
    // a repeat lock is twice as long
    const s2 = await connect('198.51.100.90');
    let last: any = null;
    for (let i = 0; i < 5; i++) last = await call(s2, 'remote:attach', { password: 'x' });
    expect(last.retryMs).toBe(LOCK_MS);
    await sleep(LOCK_MS + 30);
    for (let i = 0; i < 5; i++) last = await call(s2, 'remote:attach', { password: 'x' });
    expect(last.retryMs).toBe(LOCK_MS * 2);
    closeAll([tv]);
  });
});

describe('the password never travels to a client', () => {
  it('appears in no frame any test client received', () => {
    expect(frames.length).toBeGreaterThan(50);
    expect(frames.some((f) => f.includes(PW))).toBe(false);
  });
});
