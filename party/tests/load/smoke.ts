/**
 * Raw-socket smoke test against a RUNNING server (best with PARTY_TEST_FAST=1):
 *
 *   npx tsx tests/load/smoke.ts --url http://localhost:8801
 *
 * Checks, with plain socket.io clients and no bot logic:
 *   1. hostile / malformed payloads on every event answer an error and never kill the server
 *   2. host-only events from a player answer NOT_HOST; a TV refresh re-attaches with code + hostKey
 *   3. a manual cutscene in the middle of a round freezes the clock and the round continues with
 *      the same time left after the 3-2-1; a score sent during the freeze counts
 *   4. a disconnect / reconnect storm (every phone drops and resumes several times mid-round)
 *      loses no player and no score
 * Exit code 1 on any failed check.
 */
import { io } from 'socket.io-client';

import { RESUME_COUNTDOWN_MS } from '../../shared/protocol';
import { roundTime } from '../../shared/round-clock';

import type { Socket } from 'socket.io-client';
import type { C2S, RoomState, S2C } from '../../shared/protocol';

type PartySocket = Socket<S2C, C2S>;
type AnyAck = { ok: boolean; error?: string; [key: string]: unknown };

const urlFlag = process.argv.indexOf('--url');
const URL = urlFlag >= 0 ? (process.argv[urlFlag + 1] ?? '') : 'http://localhost:8787';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];

function check(ok: boolean, what: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) failures.push(what);
}

function connect(): Promise<PartySocket> {
  const socket: PartySocket = io(URL, { transports: ['websocket'], forceNew: true });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

/** Emits anything (also garbage the typed API would not allow) and waits for the ack. */
function raw(socket: PartySocket, event: string, ...args: unknown[]): Promise<AnyAck | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1_500);
    (socket as unknown as { emit: (ev: string, ...a: unknown[]) => void }).emit(event, ...args, (res: AnyAck) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

async function until(what: string, test: () => boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

async function health(): Promise<{ ok: boolean; rooms: number; players: number; uptime: number }> {
  const res = await fetch(`${URL}/healthz`);
  return (await res.json()) as { ok: boolean; rooms: number; players: number; uptime: number };
}

async function main(): Promise<void> {
  check((await health()).ok, 'GET /healthz answers ok');

  const host = await connect();
  let state: RoomState | null = null;
  host.on('state', (s) => {
    state = s;
  });
  const now = (): RoomState => {
    if (state === null) throw new Error('no state yet');
    return state;
  };
  const created = await raw(host, 'host:create', {});
  check(created?.ok === true && typeof created.code === 'string' && /^[A-HJKMNP-Z]{4}$/.test(created.code), 'host:create makes a room with a 4-letter code');
  const code = String(created?.code);
  const hostKey = String(created?.hostKey);
  state = created?.state as RoomState;

  console.log('\n1. malformed payloads');
  const garbage: unknown[] = [undefined, null, 7, 'x', [], { gameId: 5 }, { id: {} }, { playerId: [] }, { enabled: 'yes' }, { code: 12, name: {} }];
  const events = ['host:start', 'host:endRound', 'host:lobby', 'host:final', 'host:kick', 'host:cutscene', 'host:setAutoCutscenes', 'player:join', 'player:final'];
  // Events whose payload carries a required field must refuse garbage; the ones that take {} just answer.
  const strict = new Set(['host:start', 'host:kick', 'host:cutscene', 'host:setAutoCutscenes', 'player:join', 'player:final']);
  let answered = 0;
  let refused = 0;
  let sentCount = 0;
  let strictCount = 0;
  for (const ev of events) {
    for (const g of garbage) {
      sentCount++;
      const res = await raw(host, ev, g);
      if (res !== null && (res.ok === true || typeof res.error === 'string')) answered++;
      if (strict.has(ev)) {
        strictCount++;
        if (res !== null && res.ok === false && typeof res.error === 'string') refused++;
      }
    }
  }
  check(answered === sentCount, `every malformed request got an ack (${answered}/${sentCount})`);
  check(refused === strictCount, `garbage in a required field is refused (${refused}/${strictCount})`);
  // No ack callback at all, wrong arity, huge / odd values.
  const loose = host as unknown as { emit: (ev: string, ...a: unknown[]) => void };
  for (const ev of [...events, 'host:create', 'host:reset', 'host:cutsceneEnd', 'player:score', 'time:ping']) {
    loose.emit(ev);
    loose.emit(ev, 'not-an-object', 'not-a-function');
    loose.emit(ev, { round: Number.NaN, score: Number.POSITIVE_INFINITY, name: 'x'.repeat(5000) }, 12);
  }
  await sleep(200);
  const ping = await new Promise<{ serverNow: number } | null>((resolve) => {
    setTimeout(() => resolve(null), 1_500);
    host.emit('time:ping', Date.now(), resolve);
  });
  check(ping !== null && Math.abs(ping.serverNow - Date.now()) < 5_000, 'time:ping still answers after the garbage');
  // The no-ack host:create above moved this socket to a new room; go back like a refreshed TV.
  const back = await raw(host, 'host:create', { code, hostKey });
  check(back?.ok === true && back.code === code, 'host:create with code + hostKey re-attaches to the same room');
  // The garbage above may have moved the room around (host:final with a junk body is still host:final).
  check((await raw(host, 'host:reset', {}))?.ok === true, 'host:reset');
  await until('a clean lobby', () => state?.phase === 'lobby' && state.cutscene === null, 3_000);
  const stale = await raw(await connect(), 'host:create', { code, hostKey: 'wrong' });
  check(stale?.ok === true && stale.code !== code, 'a wrong hostKey gets a fresh room, not the party');

  console.log('\n2. roles');
  const phones: Array<{ socket: PartySocket; id: string; secret: string }> = [];
  for (let i = 0; i < 12; i++) {
    const socket = await connect();
    const res = await raw(socket, 'player:join', { code: code.toLowerCase(), name: `  שחקן   ${i + 1} 🎉 ` });
    if (res?.ok !== true) throw new Error('join failed');
    phones.push({ socket, id: String(res.playerId), secret: String(res.secret) });
  }
  await until('12 players', () => now().players.length === 12);
  check(now().players[0]?.name === 'שחקן 1 🎉', 'names are trimmed and collapsed, Hebrew + emoji survive');
  const p0 = phones[0];
  if (p0 === undefined) throw new Error('no phone');
  for (const ev of ['host:start', 'host:endRound', 'host:lobby', 'host:final', 'host:reset', 'host:kick', 'host:cutscene', 'host:cutsceneEnd', 'host:setAutoCutscenes']) {
    const res = await raw(p0.socket, ev, { gameId: 'tap', playerId: phones[1]?.id, id: 'joker_1', enabled: false });
    check(res?.ok === false && res.error === 'NOT_HOST', `${ev} from a player -> NOT_HOST`);
  }
  check((await raw(p0.socket, 'player:join', { code: 'ZZZZ', name: 'x' }))?.error === 'ROOM_NOT_FOUND', 'unknown room -> ROOM_NOT_FOUND');
  check((await raw(host, 'host:lobby', {}))?.error === 'BAD_PHASE', 'host:lobby in the lobby -> BAD_PHASE');
  check((await raw(host, 'host:setAutoCutscenes', { enabled: false }))?.ok === true && now().autoCutscenes === false, 'automatic cutscenes switched off');

  console.log('\n3. manual cutscene in the middle of a round');
  check((await raw(host, 'host:start', { gameId: 'flappy' }))?.ok === true, 'host:start flappy');
  await until('playing', () => now().phase === 'playing');
  const round0 = now().round;
  if (round0 === null) throw new Error('no round');
  const duration = round0.endAt - round0.startAt;
  await sleep(Math.min(3_000, duration / 4));
  check((await raw(host, 'host:cutscene', { id: 'joker_1' }))?.ok === true, 'host:cutscene joker_1');
  await until('cutscene state', () => now().cutscene !== null);
  const frozen = now();
  if (frozen.round === null) throw new Error('no round');
  const leftAtFreeze = roundTime(frozen.round, frozen.serverNow).leftMs;
  check(frozen.round.frozenAt !== null && frozen.phase === 'playing', `round frozen while playing (time left ${leftAtFreeze}ms)`);
  check((await raw(host, 'host:cutscene', { id: 'joker_2' }))?.error === 'BAD_PHASE', 'a second cutscene on top -> BAD_PHASE');
  check((await raw(host, 'host:cutscene', { id: 'nope' }))?.error === 'BAD_REQUEST', 'unknown cutscene -> BAD_REQUEST');
  p0.socket.emit('player:score', { round: 0, score: 17 });
  const lateJoiner = await connect();
  check((await raw(lateJoiner, 'player:join', { code, name: 'מאחר' }))?.ok === true, 'a player can join during the cutscene');
  await sleep(Math.max(2_000, duration - (duration - leftAtFreeze) + 1_000)); // well past the original endAt
  check(now().phase === 'playing' && now().cutscene !== null, 'the round did not end during the freeze');
  check((await raw(host, 'host:cutsceneEnd', {}))?.ok === true, 'host:cutsceneEnd');
  await until('resume', () => now().cutscene === null);
  const resumed = now();
  if (resumed.round === null) throw new Error('no round');
  const r = resumed.round;
  check(r.frozenAt === null && r.resumeAt !== null && Math.abs(r.resumeAt - resumed.serverNow - RESUME_COUNTDOWN_MS) < 50, 'resumeAt is a 3-2-1 ahead');
  check(roundTime(r, r.resumeAt ?? 0).leftMs === leftAtFreeze, `time left at resume equals time left at the freeze (${leftAtFreeze}ms)`);
  check(roundTime(r, resumed.serverNow).frozen, 'still frozen during the 3-2-1');
  const expectedEnd = r.endAt;

  console.log('\n4. disconnect / reconnect storm while playing');
  let storms = 0;
  for (let wave = 0; wave < 4; wave++) {
    await Promise.all(
      phones.map(async (p, i) => {
        p.socket.disconnect();
        await sleep(20 + Math.random() * 200);
        p.socket = await connect();
        const res = await raw(p.socket, 'player:join', { code, name: `שחקן ${i + 1} 🎉`, playerId: p.id, secret: p.secret });
        if (res?.ok === true && res.playerId === p.id) storms++;
        p.socket.emit('player:score', { round: 0, score: 20 + i + wave });
      }),
    );
  }
  check(storms === phones.length * 4, `all ${phones.length * 4} resumes kept their identity`);
  await sleep(300);
  check(now().players.length === 13 && now().players.every((p) => p.connected), 'no duplicate or lost players, all connected');
  check((await health()).ok, 'server healthy after the storm');
  // Half the phones send a final, the rest just stop: the round ends on the shifted clock.
  for (let i = 0; i < 6; i++) await raw(phones[i]?.socket as PartySocket, 'player:final', { round: 0, score: 100 + i });
  check(now().phase === 'playing', 'round still running while some phones have no final');
  await until('results', () => now().phase === 'results', 60_000);
  const results = now().results;
  check(Math.abs(now().serverNow - (expectedEnd + 1_500)) < 250, 'the round ended at the shifted endAt + grace');
  check(results?.rows.find((row) => row.playerId === phones[5]?.id)?.raw === 105, 'finals counted');
  check(results?.rows.find((row) => row.playerId === phones[11]?.id)?.raw === 20 + 11 + 3, 'last live score after the storm counted for a phone without a final');
  check(results?.winnerIds.length === 1 && results.winnerIds[0] === phones[5]?.id, 'winnerIds names the round winner');
  check(results?.rows.find((row) => row.name === 'מאחר')?.points === 0, 'the late joiner is listed with 0 points');
  check(results !== null && results !== undefined && results.revealAt > now().serverNow, 'revealAt is in the future when results arrive');

  let bystanderKicked = false;
  phones[10]?.socket.on('kicked', () => (bystanderKicked = true));
  const kickedEvent = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), 1_500);
    phones[11]?.socket.on('kicked', () => resolve(true));
  });
  check((await raw(host, 'host:kick', { playerId: phones[11]?.id }))?.ok === true, 'host:kick');
  check(await kickedEvent, "the kicked phone got 'kicked'");
  await sleep(100);
  check(now().players.length === 12 && !bystanderKicked, 'kicked player removed, others untouched');
  check((await raw(phones[11]?.socket as PartySocket, 'player:join', { code, name: 'x', playerId: phones[11]?.id, secret: phones[11]?.secret }))?.error === 'KICKED', 'a kicked identity cannot resume');
  check((await raw(host, 'host:reset', {}))?.ok === true && now().phase === 'lobby' && now().players.every((p) => p.total === 0), 'host:reset zeroes totals');

  for (const p of phones) p.socket.disconnect();
  lateJoiner.disconnect();
  host.disconnect();
  console.log(failures.length === 0 ? '\nOK' : `\nFAILED: ${failures.length} checks`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
