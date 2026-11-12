/**
 * QA against a RUNNING server with real party timing (no PARTY_TEST_FAST):
 * host reloads in every phase, a phone that drops for 20 s mid-round, the
 * automatic mid-game freeze, the round ending with no TV attached, a cutscene
 * before the winner reveal. Takes about two minutes.
 *
 *   PARTY_SERVER_PORT=8831 npx tsx server/index.ts &
 *   npx tsx tests/load/qa-server-live.ts http://localhost:8831
 */
import { io } from 'socket.io-client';

import { COUNTDOWN_MS, FINAL_GRACE_MS, GAMES, INTRO_MS, RESUME_COUNTDOWN_MS, WINNER_REVEAL_MS } from '../../shared/protocol';
import { roundTime } from '../../shared/round-clock';
import { computeRoundScores } from '../../shared/scoring';

import type { Socket } from 'socket.io-client';
import type { RoomState } from '../../shared/protocol';

const url = process.argv[2] ?? 'http://localhost:8831';
let failed = 0;
let passed = 0;

function check(name: string, ok: boolean, detail: unknown = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${JSON.stringify(detail)}`}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Conn {
  s: Socket;
  state: RoomState | null;
  scores: Map<string, number>;
}

function connect(): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    const c: Conn = { s, state: null, scores: new Map() };
    s.on('state', (st: RoomState) => {
      c.state = st;
    });
    s.on('scores', (m: { scores: Array<[string, number]> }) => {
      for (const [id, v] of m.scores) c.scores.set(id, v);
    });
    s.once('connect', () => resolve(c));
    s.once('connect_error', reject);
  });
}

function call(c: Conn, event: string, req: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ack: ${event}`)), 5_000);
    c.s.emit(event, req, (res: any) => {
      clearTimeout(t);
      if (res?.state) c.state = res.state;
      resolve(res);
    });
  });
}

async function until(what: string, fn: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) {
      check(`waiting for ${what}`, false, 'timeout');
      return false;
    }
    await sleep(20);
  }
  return true;
}

async function main(): Promise<void> {
  let host = await connect();
  const created = await call(host, 'host:create', {});
  const code: string = created.code;
  const hostKey: string = created.hostKey;
  console.log(`room ${code} on ${url}`);

  const reloadHost = async (label: string): Promise<void> => {
    const before = host.state;
    host.s.close();
    await sleep(300);
    host = await connect();
    const res = await call(host, 'host:create', { code, hostKey });
    check(`host reload ${label}: same room`, res.ok === true && res.code === code && res.hostKey === hostKey, res);
    check(`host reload ${label}: phase kept (${res.state?.phase})`, res.state?.phase === before?.phase, [before?.phase, res.state?.phase]);
    check(
      `host reload ${label}: round clock untouched`,
      JSON.stringify(res.state?.round) === JSON.stringify(before?.round) || res.state?.round?.resumeAt === null,
      [before?.round, res.state?.round],
    );
    check(`host reload ${label}: cutscene kept`, JSON.stringify(res.state?.cutscene) === JSON.stringify(before?.cutscene), res.state?.cutscene);
  };

  const names = ['אבי', 'בני', 'גלי'];
  const players: Array<{ c: Conn; id: string; secret: string }> = [];
  for (const name of names) {
    const c = await connect();
    const res = await call(c, 'player:join', { code, name });
    players.push({ c, id: res.playerId, secret: res.secret });
  }
  const [a, b, g] = players as [(typeof players)[0], (typeof players)[0], (typeof players)[0]];

  const t0 = Date.now();
  check('host:start tap', (await call(host, 'host:start', { gameId: 'tap' })).ok === true);
  await sleep(50);
  const round0 = host.state?.round;
  check('intro: startAt = now + INTRO + COUNTDOWN', Math.abs((round0?.startAt ?? 0) - t0 - INTRO_MS - COUNTDOWN_MS) < 300, round0);
  check('endAt - startAt = 60s', (round0?.endAt ?? 0) - (round0?.startAt ?? 0) === GAMES.tap.durationMs);
  await sleep(2_000);
  await reloadHost('mid-intro');
  await until('countdown', () => b.c.state?.phase === 'countdown', 8_000);
  check('countdown began at startAt - 3s', Math.abs(Date.now() - ((round0?.startAt ?? 0) - COUNTDOWN_MS)) < 400, Date.now() - (round0?.startAt ?? 0));
  await sleep(800);
  await reloadHost('mid-countdown');
  await until('playing', () => b.c.state?.phase === 'playing', 5_000);
  check('playing began at startAt', Math.abs(Date.now() - (round0?.startAt ?? 0)) < 400, Date.now() - (round0?.startAt ?? 0));

  // Live scores; A drops for 20s.
  a.c.s.emit('player:score', { round: 0, score: 40 });
  b.c.s.emit('player:score', { round: 0, score: 25 });
  g.c.s.emit('player:score', { round: 0, score: 10 });
  await sleep(600);
  a.c.s.close();
  const dropAt = Date.now();
  await until('A shown offline', () => host.state?.players.find((p) => p.id === a.id)?.connected === false, 3_000);
  await sleep(3_000);
  await reloadHost('mid-round');
  await sleep(20_000 - (Date.now() - dropAt));
  check('20s later the round is still playing', b.c.state?.phase === 'playing', b.c.state?.phase);
  a.c = await connect();
  const resumed = await call(a.c, 'player:join', { code, name: 'אבי', playerId: a.id, secret: a.secret });
  check('A resumes as the same player', resumed.ok === true && resumed.playerId === a.id, resumed.error);
  check('still 3 players, no duplicate', resumed.state?.players.length === 3, resumed.state?.players.map((p: { name: string }) => p.name));
  const wrong = await call(await connect(), 'player:join', { code, name: 'אבי', playerId: a.id, secret: 'wrong' });
  check('a wrong secret becomes a NEW player, not A', wrong.ok === true && wrong.playerId !== a.id, wrong);
  check('...named "אבי 2"', wrong.state?.players.find((p: { id: string }) => p.id === wrong.playerId)?.name === 'אבי 2');
  await call(host, 'host:kick', { playerId: wrong.playerId });
  b.c.s.emit('player:score', { round: 0, score: 26 });
  await sleep(500);
  check("A's score survived the drop (40)", b.c.scores.get(a.id) === 40, [...b.c.scores]);

  // The automatic freeze at 30s of round time.
  await until('tap_freeze cutscene', () => host.state?.cutscene?.id === 'tap_freeze', 15_000);
  const frozen = host.state;
  const leftFrozen = frozen?.round ? roundTime(frozen.round, Date.now()).leftMs : -1;
  // A real timer fires a few ms late; what must be exact is that the time left never moves afterwards.
  check(`freeze at 30s of round time (${leftFrozen}ms left)`, Math.abs(leftFrozen - 30_000) <= 100, leftFrozen);
  check('phase stays playing under the cutscene', frozen?.phase === 'playing');
  check('a second cutscene is BAD_PHASE', (await call(host, 'host:cutscene', { id: 'joker_1' })).error === 'BAD_PHASE');
  await sleep(2_000);
  await reloadHost('mid-cutscene');
  check('time left did not move under the video', host.state?.round ? roundTime(host.state.round, Date.now()).leftMs === leftFrozen : false);
  await sleep(2_000);
  const endedAt = Date.now();
  check('host:cutsceneEnd', (await call(host, 'host:cutsceneEnd', {})).ok === true);
  check('host:cutsceneEnd again is harmless', (await call(host, 'host:cutsceneEnd', {})).ok === true);
  await sleep(100);
  const r = host.state?.round;
  check('resumeAt = end + 3s', r !== null && r !== undefined && Math.abs((r.resumeAt ?? 0) - endedAt - RESUME_COUNTDOWN_MS) < 300, r);
  check('exactly the same time left right after the video', r ? roundTime(r, Date.now()).leftMs === leftFrozen : false);
  check('endAt = resumeAt + time left', r ? r.endAt - (r.resumeAt ?? 0) === leftFrozen : false, r);
  const endAt = r?.endAt ?? 0;

  // Finals: A sends one, B never does (live counts), G sends garbage then a real one.
  await sleep(RESUME_COUNTDOWN_MS + 5_000);
  a.c.s.emit('player:score', { round: 0, score: 70 });
  b.c.s.emit('player:score', { round: 0, score: 55 });
  check('final for the wrong round refused', (await call(g.c, 'player:final', { round: 3, score: 4_000 })).ok === false);
  check('final with a string score refused', (await call(g.c, 'player:final', { round: 0, score: '4000' })).ok === false);
  check('final above maxRaw accepted (clamped)', (await call(g.c, 'player:final', { round: 0, score: 9e9 })).ok === true);
  check('duplicate final ignored', (await call(g.c, 'player:final', { round: 0, score: 1 })).ok === true);

  // The TV goes away; the round must end by itself at endAt + grace.
  host.s.close();
  await until('results with no host attached', () => b.c.state?.phase === 'results', endAt - Date.now() + FINAL_GRACE_MS + 3_000);
  const scoredAt = Date.now();
  check('scored at endAt + FINAL_GRACE_MS', Math.abs(scoredAt - endAt - FINAL_GRACE_MS) < 500, scoredAt - endAt);
  const res = b.c.state?.results;
  const expected = computeRoundScores(new Map([[a.id, 70], [b.id, 55], [g.id, GAMES.tap.maxRaw]]));
  for (const p of [a, b, g]) {
    const row = res?.rows.find((x) => x.playerId === p.id);
    const e = expected.get(p.id);
    check(`row ${row?.name}: raw ${row?.raw} points ${row?.points} rank ${row?.rank}`, row?.points === e?.points && row?.roundRank === e?.roundRank && row?.total === e?.points, [row, e]);
  }
  check('winner = G only', JSON.stringify(res?.winnerIds) === JSON.stringify([g.id]), res?.winnerIds);
  check('kicked impostor not in the results', res?.rows.length === 3, res?.rows.map((x) => x.name));
  check('revealAt = scored + 8s', Math.abs((res?.revealAt ?? 0) - scoredAt - WINNER_REVEAL_MS) < 500);
  check('late final refused (BAD_PHASE)', (await call(b.c, 'player:final', { round: 0, score: 5_000 })).error === 'BAD_PHASE');

  // Host back mid-results; a cutscene before the reveal pushes it back.
  host = await connect();
  const back = await call(host, 'host:create', { code, hostKey });
  check('host re-attaches mid-results', back.ok === true && back.state.phase === 'results');
  const revealBefore: number = back.state.results.revealAt;
  await call(host, 'host:cutscene', { id: 'joker_1' });
  await sleep(2_500);
  await call(host, 'host:cutsceneEnd', {});
  await sleep(100);
  const pushed = (host.state?.results?.revealAt ?? 0) - revealBefore;
  check('reveal pushed back by the video (~2.5s)', pushed > 2_300 && pushed < 3_200, pushed);
  check('host:final -> podium (with its cutscene)', (await call(host, 'host:final', {})).ok === true);
  await sleep(100);
  check('final phase + before_podium cutscene', host.state?.phase === 'final' && host.state?.cutscene?.id === 'before_podium', host.state?.cutscene);
  await call(host, 'host:cutsceneEnd', {});
  check('totals on the podium', JSON.stringify(host.state?.players.map((p) => p.total)) === JSON.stringify([a, b, g].map((p) => expected.get(p.id)?.points)), host.state?.players);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
