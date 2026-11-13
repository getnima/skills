/**
 * The real server (express + socket.io on a free port) attacked with raw
 * socket.io clients: hostile payloads on every event, role checks, two rooms
 * side by side, a score flood, and the HTTP endpoints.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';

import { FINAL_GRACE_MS, MAX_PLAYERS } from '../../shared/protocol';
import { createPartyApp, lanIps } from '../../server/app';

import type { Socket } from 'socket.io-client';
import type { RoomState } from '../../shared/protocol';
import type { PartyApp } from '../../server/app';

const GAME_MS = 1_200;
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

async function until(what: string, check: () => boolean, ms = 8_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

interface Client {
  readonly s: Socket;
  state: RoomState | null;
  readonly kicked: number[];
}

function track(s: Socket): Client {
  const c: Client = { s, state: null, kicked: [] };
  s.on('state', (st: RoomState) => {
    c.state = st;
  });
  s.on('kicked', () => c.kicked.push(Date.now()));
  return c;
}

async function newHost(): Promise<Client & { code: string; hostKey: string }> {
  const c = track(await connect());
  const res = await call(c.s, 'host:create', {});
  expect(res.ok).toBe(true);
  c.state = res.state;
  return Object.assign(c, { code: res.code as string, hostKey: res.hostKey as string });
}

async function newPlayer(code: string, name: string): Promise<Client & { playerId: string; secret: string }> {
  const c = track(await connect());
  const res = await call(c.s, 'player:join', { code, name });
  expect(res).toMatchObject({ ok: true });
  c.state = res.state;
  return Object.assign(c, { playerId: res.playerId as string, secret: res.secret as string });
}

beforeAll(async () => {
  app = createPartyApp({ port: 0, origins: null, timing: { introMs: 150, countdownMs: 150, durationMs: () => GAME_MS } });
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

describe('http', () => {
  it('GET /api/info lists the non-internal IPv4 addresses', async () => {
    const res = await fetch(`${url}/api/info`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { lanIps: unknown };
    expect(Array.isArray(body.lanIps)).toBe(true);
    expect(body.lanIps).toEqual(lanIps());
    for (const ip of body.lanIps as string[]) {
      expect(ip).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
      expect(ip.startsWith('127.')).toBe(false);
    }
  });

  it('GET /j sends a guest to the room on the TV, or to the join page when no TV is connected', async () => {
    const none = await fetch(`${url}/j`, { redirect: 'manual' });
    expect(none.status).toBe(302);
    expect(none.headers.get('cache-control')).toBe('no-store');
    // other tests may have left rooms with a TV attached: whatever it is, it is a join link
    expect(none.headers.get('location')).toMatch(/^\/(\?room=[A-Z0-9]+)?$/);
    const host = await newHost();
    const res = await fetch(`${url}/j`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/?room=${host.code}`);
  });

  it('GET /j stays on the party room when a second /host page opens, and after the party TV re-attaches', async () => {
    const where = async (): Promise<string | null> => (await fetch(`${url}/j`, { redirect: 'manual' })).headers.get('location');
    const party = await newHost();
    await newPlayer(party.code, 'דנה');
    await newPlayer(party.code, 'מיכל');
    expect(await where()).toBe(`/?room=${party.code}`);
    // what a TV asks before it shows its designed QR: the same room, never cached
    const asked = await fetch(`${url}/api/short-link`);
    expect(asked.headers.get('cache-control')).toBe('no-store');
    expect(await asked.json()).toEqual({ code: party.code });
    // the owner opens /host on his phone by mistake: a new, empty room with a newer TV attach
    const stray = await newHost();
    expect(stray.code).not.toBe(party.code);
    expect(await where()).toBe(`/?room=${party.code}`);
    // ...so the stray screen is told the link is not its own (it keeps its generated code)
    expect(await (await fetch(`${url}/api/short-link`)).json()).toEqual({ code: party.code });
    // the party TV reloads (same room, same host key)
    party.s.close();
    const back = track(await connect());
    expect(await call(back.s, 'host:create', { code: party.code, hostKey: party.hostKey })).toMatchObject({ ok: true, code: party.code });
    expect(await where()).toBe(`/?room=${party.code}`);
  });

  it('GET /healthz answers and unknown paths are a plain 404', async () => {
    const health = (await (await fetch(`${url}/healthz`)).json()) as { ok: boolean };
    expect(health.ok).toBe(true);
    expect((await fetch(`${url}/api/nope`)).status).toBe(404);
    expect((await fetch(`${url}/api/info`, { method: 'POST' })).status).toBe(404);
  });
});

describe('sockets under attack', () => {
  it('survives malformed payloads and missing acks on every event, from every role', async () => {
    const host = await newHost();
    const player = await newPlayer(host.code, 'ok');
    const stranger = await connect();
    const events = [
      'host:create', 'host:start', 'host:endRound', 'host:lobby', 'host:final', 'host:reset', 'host:kick',
      'host:cutscene', 'host:cutsceneEnd', 'host:setAutoCutscenes', 'player:join', 'player:score', 'player:final', 'time:ping',
    ];
    const junk: unknown[] = [
      undefined, null, 0, -1, 1e308, '', 'x'.repeat(15_000), [], [[]], {}, { code: {} }, { code: host.code, name: { length: 3 } },
      { gameId: 'constructor' }, { gameId: ['tap'] }, { playerId: null }, { id: 42 }, { enabled: 'true' },
      { round: '0', score: '5' }, { round: 0, score: null }, { round: {}, score: [] }, { __proto__: { role: 'host' } }, true,
    ];
    for (const s of [stranger, player.s]) {
      for (const ev of events) {
        if (ev === 'host:create') continue; // legal for anyone; covered below
        for (const j of junk) {
          s.emit(ev); // no payload, no ack
          s.emit(ev, j); // no ack
          s.emit(ev, j, 'not-a-function');
          s.emit(ev, j, j, j);
        }
      }
    }
    // With acks: every junk payload gets an answer, never a hang, never ok for a host action.
    for (const ev of events.filter((e) => e.startsWith('host:') && e !== 'host:create')) {
      for (const s of [stranger, player.s]) {
        const res = await call(s, ev, { gameId: 'tap', playerId: player.playerId, id: 'joker_1', enabled: false });
        expect(res).toMatchObject({ ok: false, error: 'NOT_HOST' });
      }
    }
    for (const j of junk) {
      const res = await call(stranger, 'player:join', j);
      expect(res.ok).toBe(false);
      const fin = await call(stranger, 'player:final', j);
      expect(fin.ok).toBe(false);
    }
    expect(await call(stranger, 'time:ping', 'abc')).toMatchObject({ clientT: 0 });
    expect(typeof (await call(stranger, 'time:ping', 5)).serverNow).toBe('number');
    // Junk host payloads from the REAL host are refused politely.
    for (const j of junk) {
      expect((await call(host.s, 'host:start', j)).ok).toBe(false);
      expect((await call(host.s, 'host:kick', j)).ok).toBe(false);
      expect((await call(host.s, 'host:cutscene', j)).ok).toBe(false);
      expect((await call(host.s, 'host:setAutoCutscenes', j)).ok).toBe(false);
    }
    // The room is untouched and alive.
    expect(host.state).toMatchObject({ phase: 'lobby', autoCutscenes: true });
    expect(host.state?.players.map((p) => p.name)).toEqual(['ok']);
    expect(app.registry.get(host.code)?.isHostConn(player.s.id ?? '')).toBe(false);
    expect((await call(host.s, 'host:start', { gameId: 'tap' })).ok).toBe(true);
    await call(host.s, 'host:endRound', {});
  });

  it('a message over the size limit drops that socket only', async () => {
    const host = await newHost();
    const big = await connect();
    const closed = new Promise<string>((resolve) => big.once('disconnect', resolve));
    big.emit('player:join', { code: host.code, name: 'x'.repeat(200_000) });
    await closed;
    const fine = await newPlayer(host.code, 'still here');
    expect(fine.state?.players.map((p) => p.name)).toEqual(['still here']);
  });

  it('two rooms at once never see each other', async () => {
    const A = await newHost();
    const B = await newHost();
    expect(A.code).not.toBe(B.code);
    const a1 = await newPlayer(A.code, 'a1');
    const b1 = await newPlayer(B.code, 'b1');
    const seenByA: unknown[] = [];
    A.s.on('scores', (m: unknown) => seenByA.push(m));
    a1.s.on('state', (st: RoomState) => expect(st.code).toBe(A.code));
    // A's host cannot act on B; B's key does not open A.
    expect(await call(A.s, 'host:kick', { playerId: b1.playerId })).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    const stolen = await call(await connect(), 'host:create', { code: B.code, hostKey: A.hostKey });
    expect(stolen.code).not.toBe(B.code);
    // icy: the shipped manifest has no automatic cutscene for it (tap freezes mid-game and waits for the TV).
    expect((await call(B.s, 'host:start', { gameId: 'icy' })).ok).toBe(true);
    await until('B playing', () => B.state?.phase === 'playing');
    expect(A.state?.phase).toBe('lobby');
    b1.s.emit('player:score', { round: 0, score: 33 });
    a1.s.emit('player:score', { round: 0, score: 4_000 }); // A is in the lobby: dropped
    expect((await call(a1.s, 'player:final', { round: 0, score: 4_000 })).ok).toBe(false);
    await until('B results', () => B.state?.phase === 'results');
    expect(B.state?.results?.rows.map((r) => [r.name, r.raw])).toEqual([['b1', 33]]);
    expect(seenByA).toEqual([]);
    expect(A.state?.players.map((p) => p.name)).toEqual(['a1']);
    expect(A.state?.results).toBeNull();
  });

  it('60 players, the 61st is ROOM_FULL; 200 scores a second from one socket; kick; resume; the round ends with no host', async () => {
    const host = await newHost();
    const players = await Promise.all(Array.from({ length: MAX_PLAYERS }, (_, i) => newPlayer(host.code, `p${i}`)));
    expect(await call(await connect(), 'player:join', { code: host.code, name: 'late' })).toMatchObject({ ok: false, error: 'ROOM_FULL' });
    const p0 = players[0];
    const p1 = players[1];
    const p2 = players[2];
    if (p0 === undefined || p1 === undefined || p2 === undefined) throw new Error('players');
    let scoreMsgs = 0;
    host.s.on('scores', () => scoreMsgs++);
    expect((await call(host.s, 'host:start', { gameId: 'flappy' })).ok).toBe(true);
    await until('playing', () => host.state?.phase === 'playing');
    const startedAt = Date.now();
    // Flood: one message every 5ms for 600ms.
    for (let i = 1; i <= 120; i++) {
      p0.s.emit('player:score', { round: 0, score: i });
      await sleep(5);
    }
    p1.s.emit('player:score', { round: 0, score: 60 });
    await sleep(50); // let the packet leave before the socket is torn down
    // p1 drops and comes back on a new socket with the same identity.
    p1.s.close();
    await until('p1 offline', () => host.state?.players.find((p) => p.id === p1.playerId)?.connected === false);
    const back = track(await connect());
    const resumed = await call(back.s, 'player:join', { code: host.code, name: 'p1', playerId: p1.playerId, secret: p1.secret });
    expect(resumed).toMatchObject({ ok: true, playerId: p1.playerId });
    expect(resumed.state.players).toHaveLength(MAX_PLAYERS);
    // A wrong secret cannot take p0 over (and the room is full for a new player).
    expect(await call(await connect(), 'player:join', { code: host.code, name: 'p0', playerId: p0.playerId, secret: 'x' })).toMatchObject({ ok: false, error: 'ROOM_FULL' });
    // Kick p2: told once, cannot score, cannot come back as the same player.
    expect((await call(host.s, 'host:kick', { playerId: p2.playerId })).ok).toBe(true);
    await until('kicked event', () => p2.kicked.length === 1);
    p2.s.emit('player:score', { round: 0, score: 5_000 });
    expect((await call(p2.s, 'player:final', { round: 0, score: 5_000 })).ok).toBe(false);
    expect(await call(p2.s, 'player:join', { code: host.code, name: 'p2', playerId: p2.playerId, secret: p2.secret })).toMatchObject({ ok: false, error: 'KICKED' });
    // The TV goes away: the round must end on the server's clock anyway.
    host.s.close();
    await until('results without a host', () => back.state?.phase === 'results', GAME_MS + FINAL_GRACE_MS + 3_000);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(GAME_MS - 50);
    const rows = back.state?.results?.rows ?? [];
    expect(rows).toHaveLength(MAX_PLAYERS - 1);
    expect(rows.find((r) => r.playerId === p0.playerId)).toMatchObject({ raw: 120, points: 1100, roundRank: 1, rank: 1 });
    expect(rows.find((r) => r.playerId === p1.playerId)).toMatchObject({ raw: 60, points: 560, roundRank: 2 });
    expect(rows.some((r) => r.playerId === p2.playerId)).toBe(false);
    expect(back.state?.results?.winnerIds).toEqual([p0.playerId]);
    // 250ms throttle: a 1.2s round (+grace) cannot produce more than a dozen broadcasts.
    expect(scoreMsgs).toBeGreaterThan(0);
    expect(scoreMsgs).toBeLessThanOrEqual(12);
    // The host re-attaches with code + key and finds everything in place; a second tab too.
    const tv = track(await connect());
    const again = await call(tv.s, 'host:create', { code: host.code, hostKey: host.hostKey });
    expect(again).toMatchObject({ ok: true, code: host.code, hostKey: host.hostKey });
    expect(again.state.phase).toBe('results');
    const tab2 = await call(await connect(), 'host:create', { code: host.code.toLowerCase(), hostKey: host.hostKey });
    expect(tab2.code).toBe(host.code);
    expect((await call(tv.s, 'host:final', {})).ok).toBe(true);
  }, 30_000);
});
