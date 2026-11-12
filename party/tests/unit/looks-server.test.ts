/**
 * Looks over the real server (express + socket.io on a free port) with raw socket.io
 * clients: the join carries a look, `player:look` changes it, the room hears a small
 * `looks` message (never a whole state), hostile payloads change nothing, a flood is throttled.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';

import { LOOK_BROADCAST_INTERVAL_MS } from '../../shared/protocol';
import { cleanLook } from '../../server/looks';
import { createPartyApp } from '../../server/app';

import type { Socket } from 'socket.io-client';
import type { RoomState } from '../../shared/protocol';
import type { PartyApp } from '../../server/app';

const FANCY = '1.8.8-17.9.0.11.7';
const PIRATE = '1.3.3.0.0.0.0';

let app: PartyApp;
let url = '';
const sockets: Socket[] = [];

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

// Untyped on purpose: these tests send what the contract forbids.
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
    await sleep(5);
  }
}

interface Client {
  readonly s: Socket;
  state: RoomState | null;
  /** Number of `state` events received. */
  states: number;
  readonly looks: Array<ReadonlyArray<readonly [string, string]>>;
}

function track(s: Socket): Client {
  const c: Client = { s, state: null, states: 0, looks: [] };
  s.on('state', (st: RoomState) => {
    c.state = st;
    c.states++;
  });
  s.on('looks', (msg: { looks: ReadonlyArray<readonly [string, string]> }) => c.looks.push(msg.looks));
  return c;
}

async function newHost(): Promise<Client & { code: string }> {
  const c = track(await connect());
  const res = await call(c.s, 'host:create', {});
  expect(res.ok).toBe(true);
  c.state = res.state;
  return Object.assign(c, { code: res.code as string });
}

async function newPlayer(code: string, name: string, look?: unknown): Promise<Client & { playerId: string; secret: string; look: string }> {
  const c = track(await connect());
  const res = await call(c.s, 'player:join', look === undefined ? { code, name } : { code, name, look });
  expect(res).toMatchObject({ ok: true });
  c.state = res.state;
  const mine = (res.state as RoomState).players.find((p) => p.id === res.playerId)?.look ?? '';
  return Object.assign(c, { playerId: res.playerId as string, secret: res.secret as string, look: mine });
}

function lookOf(c: Client, id: string): string | undefined {
  return c.state?.players.find((p) => p.id === id)?.look;
}

beforeAll(async () => {
  app = createPartyApp({ port: 0, origins: null, timing: { introMs: 150, countdownMs: 150, durationMs: () => 1_200 } });
  const port = await new Promise<number>((resolve, reject) => {
    app.http.once('error', reject);
    app.http.listen(0, '127.0.0.1', () => {
      const a = app.http.address();
      resolve(typeof a === 'object' && a !== null ? a.port : 0);
    });
  });
  url = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await app.close();
});

describe('looks over sockets', () => {
  it('the join ack and the broadcast carry a look for everyone; a look sent with the join is kept', async () => {
    const host = await newHost();
    const a = await newPlayer(host.code, 'דנה');
    const b = await newPlayer(host.code, 'יוסי', FANCY);
    const c = await newPlayer(host.code, 'מיכל', { evil: true });
    await until('host sees 3 players', () => host.state?.players.length === 3);
    for (const p of host.state?.players ?? []) expect(cleanLook(p.look)).toBe(p.look);
    expect(lookOf(host, b.playerId)).toBe(FANCY);
    expect(b.look).toBe(FANCY);
    expect(a.look).not.toBe('');
    expect(c.look).not.toBe('');
    expect(new Set([a.look, b.look, c.look]).size).toBe(3);
  });

  it('player:look reaches the TV and the other phones fast, as `looks`, without a state broadcast', async () => {
    const host = await newHost();
    const a = await newPlayer(host.code, 'דנה');
    const b = await newPlayer(host.code, 'יוסי');
    await until('everybody sees 2 players', () => [host, a, b].every((c) => c.state?.players.length === 2));
    await sleep(60);
    const before = [host.states, a.states, b.states];
    const t0 = Date.now();
    const res = await call(a.s, 'player:look', { look: PIRATE });
    expect(res).toEqual({ ok: true, look: PIRATE });
    await until('the looks message', () => host.looks.length > 0 && b.looks.length > 0 && a.looks.length > 0, 1_000);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(host.looks).toEqual([[[a.playerId, PIRATE]]]);
    expect(b.looks).toEqual([[[a.playerId, PIRATE]]]);
    await sleep(LOOK_BROADCAST_INTERVAL_MS + 100);
    expect([host.states, a.states, b.states]).toEqual(before);
    expect(host.looks).toHaveLength(1);
    // the next state has it too
    const late = await newPlayer(host.code, 'מאחרת');
    expect(lookOf(late, a.playerId)).toBe(PIRATE);
  });

  it('hostile payloads are refused and change nothing', async () => {
    const host = await newHost();
    const a = await newPlayer(host.code, 'דנה', FANCY);
    await until('host sees the player', () => host.state?.players.length === 1);
    const bad: unknown[] = [undefined, null, 7, 'x', [], {}, { look: null }, { look: 7 }, { look: {} }, { look: ['1.0.8.0.0.0.0'] }, { look: 'junk' }, { look: 'x'.repeat(50_000) }, { look: '1.0.0' }];
    for (const req of bad) {
      const res = await call(a.s, 'player:look', req);
      expect(res).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    }
    // no ack function at all must not crash the server either
    a.s.emit('player:look', { look: 'junk' });
    a.s.emit('player:look');
    a.s.emit('player:look', { look: PIRATE }, 'not a function');
    await until('the valid change without an ack', () => host.looks.length > 0, 1_500);
    expect(host.looks.at(-1)).toEqual([[a.playerId, PIRATE]]);
    const res = await call(a.s, 'player:look', { look: FANCY });
    expect(res).toEqual({ ok: true, look: FANCY });
  });

  it('only a player of a room may change a look, and only its own', async () => {
    const host = await newHost();
    const a = await newPlayer(host.code, 'דנה', FANCY);
    const stranger = await connect();
    expect(await call(stranger, 'player:look', { look: PIRATE })).toMatchObject({ ok: false, error: 'ROOM_NOT_FOUND' });
    expect(await call(host.s, 'player:look', { look: PIRATE })).toMatchObject({ ok: false, error: 'ROOM_NOT_FOUND' });
    // there is no way to name another player: the socket's own identity is used
    const b = await newPlayer(host.code, 'יוסי');
    expect(await call(b.s, 'player:look', { look: PIRATE, playerId: a.playerId })).toEqual({ ok: true, look: PIRATE });
    await until('host hears it', () => host.looks.length > 0);
    expect(host.looks.flat()).toEqual([[b.playerId, PIRATE]]);
    const fresh = await newPlayer(host.code, 'בודקת');
    expect(lookOf(fresh, a.playerId)).toBe(FANCY);
    expect(lookOf(fresh, b.playerId)).toBe(PIRATE);
  });

  it('a flood of changes is heard as a few messages, and the last look wins', async () => {
    const host = await newHost();
    const a = await newPlayer(host.code, 'דנה');
    const b = await newPlayer(host.code, 'יוסי');
    await until('joined', () => host.state?.players.length === 2);
    await sleep(LOOK_BROADCAST_INTERVAL_MS + 50);
    host.looks.length = 0;
    const statesBefore = host.states;
    const hats = [1, 2, 3, 4, 8, 10, 12, 14, 16, 17];
    const t0 = Date.now();
    let lastA = '';
    let lastB = '';
    for (let i = 0; i < 400; i++) {
      lastA = `1.${i % 12}.${hats[i % hats.length]}.0.0.0.0`;
      lastB = `1.${(i + 5) % 12}.${hats[(i + 3) % hats.length]}.9.0.0.0`;
      a.s.emit('player:look', { look: lastA });
      b.s.emit('player:look', { look: lastB });
      if (i % 20 === 19) await sleep(15);
    }
    expect(await call(a.s, 'player:look', { look: lastA })).toEqual({ ok: true, look: lastA });
    expect(await call(b.s, 'player:look', { look: lastB })).toEqual({ ok: true, look: lastB });
    await sleep(LOOK_BROADCAST_INTERVAL_MS * 2);
    const took = Date.now() - t0;
    // 800 changes: the room heard at most one message per interval (plus the edges)
    expect(host.looks.length).toBeLessThanOrEqual(Math.ceil(took / LOOK_BROADCAST_INTERVAL_MS) + 2);
    expect(host.looks.length).toBeGreaterThanOrEqual(1);
    expect(host.states).toBe(statesBefore);
    const replay = new Map<string, string>();
    for (const m of host.looks) for (const [id, look] of m) replay.set(id, look);
    expect(replay.get(a.playerId)).toBe(lastA);
    expect(replay.get(b.playerId)).toBe(lastB);
  });

  it('a reload (same playerId + secret) keeps the look, also when the join carries another one', async () => {
    const host = await newHost();
    const a = await newPlayer(host.code, 'דנה');
    expect(await call(a.s, 'player:look', { look: FANCY })).toEqual({ ok: true, look: FANCY });
    a.s.close();
    await until('host sees the player away', () => host.state?.players[0]?.connected === false);
    const again = track(await connect());
    const res = await call(again.s, 'player:join', { code: host.code, name: 'דנה', playerId: a.playerId, secret: a.secret, look: PIRATE });
    expect(res.ok).toBe(true);
    expect(res.playerId).toBe(a.playerId);
    expect((res.state as RoomState).players).toHaveLength(1);
    expect((res.state as RoomState).players[0]?.look).toBe(FANCY);
    // a wrong secret is a new guest: the look it brought is its own
    const other = await connect();
    const res2 = await call(other, 'player:join', { code: host.code, name: 'דנה', playerId: a.playerId, secret: 'wrong', look: PIRATE });
    expect(res2.ok).toBe(true);
    expect(res2.playerId).not.toBe(a.playerId);
    const st = res2.state as RoomState;
    expect(st.players.find((p) => p.id === a.playerId)?.look).toBe(FANCY);
    expect(st.players.find((p) => p.id === res2.playerId)?.look).toBe(PIRATE);
  });

  it('a look can be changed while a round is being played', async () => {
    const host = await newHost();
    const a = await newPlayer(host.code, 'דנה');
    const b = await newPlayer(host.code, 'יוסי');
    // no automatic cutscene in the way (it would freeze the round until the TV reports its end)
    expect((await call(host.s, 'host:setAutoCutscenes', { enabled: false })).ok).toBe(true);
    expect((await call(host.s, 'host:start', { gameId: 'tap' })).ok).toBe(true);
    await until('playing', () => host.state?.phase === 'playing');
    host.looks.length = 0;
    expect(await call(b.s, 'player:look', { look: PIRATE })).toEqual({ ok: true, look: PIRATE });
    await until('looks during the round', () => host.looks.length > 0, 1_000);
    expect(host.state?.phase).toBe('playing');
    await until('results', () => host.state?.phase === 'results', 6_000);
    expect(host.state?.results?.rows.find((r) => r.playerId === b.playerId)?.look).toBe(PIRATE);
    expect(host.state?.results?.rows.find((r) => r.playerId === a.playerId)?.look).toBe(a.look);
  }, 15_000);
});
