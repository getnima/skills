/**
 * Party Arena load bots: N socket.io clients that behave like phones.
 *
 *   npx tsx tests/load/bots.ts [flags]
 *
 * MODES
 *   (no --code)   SELF-HOSTED RUN. The script also connects a host socket, creates a
 *                 room, joins the bots, plays --rounds rounds and goes to the podium.
 *                 The host bot ends every cutscene the server starts (the automatic
 *                 ones too) after --cutscene-ms, like the TV would. At the end it
 *                 ASSERTS that every round's rows and the final totals equal
 *                 computeRoundScores() applied to what the bots sent, and that every
 *                 mid-game freeze kept the round's time left. Exit code 1 on a mismatch.
 *   --code ABCD   JOIN an existing room (someone else is the host: a browser, a test).
 *                 Add --hold or --play (default: --play).
 *
 * FLAGS
 *   --url <url>          server URL                         (default http://localhost:8787)
 *   --code <code>        join this room instead of hosting one
 *   --players <n>        number of bots                     (default 30)
 *   --rounds <n>         self-hosted: rounds to play        (default 3)
 *                        with --code --play: exit after n finished rounds (default: never)
 *   --games <a,b,..>     self-hosted: games to cycle through (default tap,icy,flappy,plotzel,ninja)
 *   --hold               with --code: join, stay connected and idle (send nothing) until
 *                        Ctrl-C, so a human or another script drives the host
 *   --play               with --code: react to rounds started by someone else: send score
 *                        streams and a final whenever the room is playing, pausing while
 *                        the round is frozen by a cutscene
 *   --cutscene <id>      self-hosted: the host also fires this cutscene by hand in the
 *                        middle of every round (e.g. --cutscene joker_1)
 *   --cutscene-ms <ms>   self-hosted: how long the host bot lets a cutscene play (default 2500)
 *   --churn <0..1>       chance per bot per second to drop its connection and come back
 *                        0.3-2s later with the same identity (default 0)
 *   --prefix <text>      bot name prefix                    (default "בוט")
 *   --quiet              only print the summary
 *
 * EXAMPLES
 *   PARTY_TEST_FAST=1 PORT=8801 npx tsx server/index.ts &
 *   npx tsx tests/load/bots.ts --url http://localhost:8801 --players 30 --rounds 3
 *   npx tsx tests/load/bots.ts --url http://localhost:8801 --code ABCD --players 12 --play
 *   npx tsx tests/load/bots.ts --url http://localhost:8801 --code ABCD --players 5 --hold
 *
 * Round timing comes only from the round fields through roundTime() with a synced
 * server clock, exactly like the real clients.
 */
import { io } from 'socket.io-client';

import { GAME_IDS, GAMES, SCORE_SEND_INTERVAL_MS } from '../../shared/protocol';
import { roundTime } from '../../shared/round-clock';
import { computeRoundScores } from '../../shared/scoring';

import type { Socket } from 'socket.io-client';
import type { C2S, GameId, RoomState, RoundPublic, S2C } from '../../shared/protocol';

type PartySocket = Socket<S2C, C2S>;

interface Options {
  url: string;
  code: string | null;
  players: number;
  rounds: number | null;
  games: GameId[];
  hold: boolean;
  play: boolean;
  cutscene: string | null;
  cutsceneMs: number;
  churn: number;
  prefix: string;
  quiet: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    url: 'http://localhost:8787',
    code: null,
    players: 30,
    rounds: null,
    games: [...GAME_IDS],
    hold: false,
    play: false,
    cutscene: null,
    cutsceneMs: 2_500,
    churn: 0,
    prefix: 'בוט',
    quiet: false,
  };
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--url':
        opts.url = value(++i, flag);
        break;
      case '--code':
        opts.code = value(++i, flag).toUpperCase();
        break;
      case '--players':
        opts.players = Number(value(++i, flag));
        break;
      case '--rounds':
        opts.rounds = Number(value(++i, flag));
        break;
      case '--games': {
        const games = value(++i, flag).split(',').map((g) => g.trim());
        const bad = games.find((g) => !(GAME_IDS as readonly string[]).includes(g));
        if (bad !== undefined) throw new Error(`unknown game "${bad}"`);
        opts.games = games as GameId[];
        break;
      }
      case '--hold':
        opts.hold = true;
        break;
      case '--play':
        opts.play = true;
        break;
      case '--cutscene':
        opts.cutscene = value(++i, flag);
        break;
      case '--cutscene-ms':
        opts.cutsceneMs = Number(value(++i, flag));
        break;
      case '--churn':
        opts.churn = Number(value(++i, flag));
        break;
      case '--prefix':
        opts.prefix = value(++i, flag);
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      default:
        throw new Error(`unknown flag ${String(flag)} (see the top of tests/load/bots.ts)`);
    }
  }
  if (!Number.isInteger(opts.players) || opts.players < 1) throw new Error('--players must be a positive integer');
  if (opts.rounds !== null && (!Number.isInteger(opts.rounds) || opts.rounds < 1)) throw new Error('--rounds must be a positive integer');
  if (!(opts.churn >= 0 && opts.churn <= 1)) throw new Error('--churn must be between 0 and 1');
  if (opts.code !== null && !opts.hold) opts.play = true;
  return opts;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function connectSocket(url: string): PartySocket {
  return io(url, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 200,
    reconnectionDelayMax: 1_000,
    forceNew: true,
  });
}

function onceConnected(socket: PartySocket, timeoutMs = 10_000): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('could not connect to the server')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Server clock estimate, same method as client/src/net/connection.ts. */
class Clock {
  private offset = 0;
  private bestRtt = Number.POSITIVE_INFINITY;
  constructor(private readonly socket: PartySocket) {}
  now(): number {
    return Date.now() + this.offset;
  }
  get rtt(): number {
    return this.bestRtt;
  }
  async sync(samples = 4): Promise<void> {
    for (let i = 0; i < samples; i++) {
      await new Promise<void>((resolve) => {
        const sentAt = Date.now();
        const timer = setTimeout(resolve, 2_000);
        this.socket.emit('time:ping', sentAt, (res) => {
          clearTimeout(timer);
          const rtt = Date.now() - sentAt;
          if (rtt < this.bestRtt) {
            this.bestRtt = rtt;
            this.offset = res.serverNow + rtt / 2 - Date.now();
          }
          resolve();
        });
      });
    }
  }
}

class Stats {
  private readonly samples: number[] = [];
  add(ms: number): void {
    this.samples.push(ms);
  }
  summary(): string {
    if (this.samples.length === 0) return 'no samples';
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    return `n=${sorted.length} mean=${mean.toFixed(1)}ms p50=${at(0.5).toFixed(1)}ms p95=${at(0.95).toFixed(1)}ms p99=${at(0.99).toFixed(1)}ms max=${at(1).toFixed(1)}ms`;
  }
}

/** What a believable player reaches in a full round, per game (well under maxRaw). */
const TYPICAL_BEST: Readonly<Record<GameId, number>> = { tap: 420, icy: 6_000, flappy: 45, plotzel: 1_600, ninja: 2_400 };

interface RoundPlan {
  /** 0..1 skill for this round. */
  readonly skill: number;
  /** Plotzel-style: finishes early at this fraction of the round and sends the final then. */
  readonly finishAt: number | null;
  live: number;
  /** What the server must have as this bot's raw: the acked final, else the last live score sent. */
  expected: number;
  finalSent: boolean;
  done: boolean;
}

const stateLatency = new Stats();
const scoreEcho = new Stats();

class Bot {
  readonly socket: PartySocket;
  readonly clock: Clock;
  playerId = '';
  private secret = '';
  private joined = false;
  state: RoomState | null = null;
  readonly plans = new Map<number, RoundPlan>();
  /** score value → local send time, to measure when it shows up in the 'scores' broadcast. */
  private pendingEcho: { value: number; sentAt: number } | null = null;
  reconnects = 0;
  /** A final is on the wire: do not drop the connection before its ack. */
  private awaitingAck = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly opts: Options,
    private readonly index: number,
    private code: string,
  ) {
    this.socket = connectSocket(opts.url);
    this.clock = new Clock(this.socket);
    this.socket.on('state', (state) => {
      stateLatency.add(Math.max(0, this.clock.now() - state.serverNow));
      this.state = state;
    });
    this.socket.on('scores', (msg) => {
      const echo = this.pendingEcho;
      if (echo === null) return;
      const mine = msg.scores.find(([id]) => id === this.playerId);
      if (mine !== undefined && mine[1] >= echo.value) {
        scoreEcho.add(Date.now() - echo.sentAt);
        this.pendingEcho = null;
      }
    });
    // After any reconnect (network blip, churn) come back as the same player.
    this.socket.on('connect', () => {
      if (this.playerId !== '') void this.join().catch(() => undefined);
    });
    this.socket.on('disconnect', () => {
      this.joined = false;
      this.awaitingAck = false;
    });
  }

  get name(): string {
    return `${this.opts.prefix} ${this.index + 1}`;
  }

  async join(): Promise<void> {
    await onceConnected(this.socket);
    await this.clock.sync(this.playerId === '' ? 4 : 2);
    const res = await new Promise<Parameters<Parameters<C2S['player:join']>[1]>[0]>((resolve) => {
      this.socket.emit(
        'player:join',
        { code: this.code, name: this.name, playerId: this.playerId || undefined, secret: this.secret || undefined },
        resolve,
      );
    });
    if (!res.ok) throw new Error(`${this.name}: join failed: ${res.error} ${res.message}`);
    this.playerId = res.playerId;
    this.secret = res.secret;
    this.state = res.state;
    this.joined = true;
  }

  startPlaying(): void {
    // Phones do not tick in lockstep.
    this.timer = setInterval(() => this.tick(), SCORE_SEND_INTERVAL_MS + Math.floor(Math.random() * 40));
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.socket.disconnect();
  }

  private planFor(round: RoundPublic): RoundPlan {
    let plan = this.plans.get(round.index);
    if (plan === undefined) {
      // One bot never scores, one in ten never sends a final (a phone that fell asleep).
      const skill = this.index % 13 === 12 ? 0 : 0.15 + 0.85 * Math.random();
      const early = round.gameId === 'plotzel' && this.index % 10 !== 9;
      plan = {
        skill,
        finishAt: early ? 0.25 + 0.6 * Math.random() : null,
        live: 0,
        expected: 0,
        finalSent: false,
        done: false,
      };
      this.plans.set(round.index, plan);
    }
    return plan;
  }

  private tick(): void {
    // Churn first and send nothing in the same tick: a packet written right before
    // disconnect() may never leave the phone, and the bookkeeping below must stay exact.
    if (this.opts.churn > 0 && this.maybeChurn()) return;
    const state = this.state;
    if (!this.joined || state === null || state.phase !== 'playing' || state.round === null) return;
    const round = state.round;
    const plan = this.planFor(round);
    const time = roundTime(round, this.clock.now());
    const duration = round.endAt - round.startAt;
    if (!plan.done && !time.frozen && time.elapsedMs >= 0) {
      const progress = Math.min(1, time.elapsedMs / duration);
      const over = time.leftMs <= 0;
      const best = Math.min(GAMES[round.gameId].maxRaw, TYPICAL_BEST[round.gameId]);
      if (plan.finishAt !== null) {
        // Solves the word at `finishAt`: faster = more points.
        if (progress >= plan.finishAt || over) {
          const score = over && progress < plan.finishAt ? 0 : Math.round(best * plan.skill * (1.2 - plan.finishAt));
          this.sendFinal(round.index, plan, score);
        }
      } else {
        const score = Math.max(plan.live, Math.round(best * plan.skill * progress));
        if (over) {
          if (this.index % 10 === 9) plan.done = true;
          else this.sendFinal(round.index, plan, score);
        } else if (score !== plan.live) {
          plan.live = score;
          plan.expected = score;
          this.socket.emit('player:score', { round: round.index, score });
          if (this.pendingEcho === null) this.pendingEcho = { value: score, sentAt: Date.now() };
        }
      }
    }
  }

  private sendFinal(roundIndex: number, plan: RoundPlan, score: number): void {
    if (plan.finalSent) return;
    plan.finalSent = true;
    plan.done = true;
    this.awaitingAck = true;
    this.socket.emit('player:final', { round: roundIndex, score }, (res) => {
      this.awaitingAck = false;
      if (res.ok) plan.expected = score;
    });
  }

  private maybeChurn(): boolean {
    const perTick = this.opts.churn * (SCORE_SEND_INTERVAL_MS / 1000);
    if (!this.joined || this.awaitingAck || Math.random() >= perTick) return false;
    this.reconnects++;
    this.joined = false;
    this.socket.disconnect();
    setTimeout(() => this.socket.connect(), 300 + Math.random() * 1_700);
    return true;
  }
}

function log(opts: Options, ...parts: unknown[]): void {
  if (!opts.quiet) console.log(...parts);
}

function emitHost<E extends 'host:start' | 'host:final' | 'host:cutscene' | 'host:cutsceneEnd'>(
  socket: PartySocket,
  event: E,
  req: Parameters<C2S[E]>[0],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event}: no ack`)), 5_000);
    const ack = (res: { ok: boolean; error?: string; message?: string }): void => {
      clearTimeout(timer);
      if (res.ok) resolve();
      else reject(new Error(`${event}: ${res.error ?? '?'} ${res.message ?? ''}`));
    };
    // The four events share the (req, ack) shape; the cast only narrows the union for emit().
    (socket.emit as (ev: E, req: Parameters<C2S[E]>[0], ack: (res: { ok: boolean }) => void) => void)(event, req, ack);
  });
}

async function waitFor(what: string, timeoutMs: number, test: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

async function selfHosted(opts: Options): Promise<number> {
  const rounds = opts.rounds ?? 3;
  const failures: string[] = [];
  const host = connectSocket(opts.url);
  await onceConnected(host);
  const hostClock = new Clock(host);
  await hostClock.sync();

  let state: RoomState | null = null;
  let freezesChecked = 0;
  let cutscenesSeen = 0;
  let handledCutscene = '';
  let leftAtFreeze: number | null = null;

  host.on('state', (s) => {
    const prev = state;
    state = s;
    if (s.cutscene !== null) {
      const key = `${s.cutscene.id}@${s.cutscene.startedAt}`;
      if (key !== handledCutscene) {
        handledCutscene = key;
        cutscenesSeen++;
        leftAtFreeze = s.phase === 'playing' && s.round !== null ? roundTime(s.round, s.serverNow).leftMs : null;
        if (s.phase === 'playing' && s.round !== null && s.round.frozenAt === null) {
          failures.push(`cutscene ${s.cutscene.id} started while playing but the round is not frozen`);
        }
        log(opts, `  cutscene "${s.cutscene.id}" in ${s.phase}${leftAtFreeze !== null ? ` (time left ${leftAtFreeze}ms)` : ''}`);
        // The TV reports the end of the video.
        setTimeout(() => void emitHost(host, 'host:cutsceneEnd', {}).catch((e: Error) => failures.push(e.message)), opts.cutsceneMs);
      }
    } else if (prev !== null && prev.cutscene !== null && leftAtFreeze !== null && s.round !== null && s.phase === 'playing') {
      const r = s.round;
      const atResume = roundTime(r, r.resumeAt ?? s.serverNow).leftMs;
      const during = roundTime(r, s.serverNow);
      freezesChecked++;
      if (atResume !== leftAtFreeze || r.resumeAt === null || !during.frozen) {
        failures.push(`freeze did not keep the clock: left ${leftAtFreeze}ms before, ${atResume}ms at resume (resumeAt=${String(r.resumeAt)})`);
      }
      leftAtFreeze = null;
    }
  });

  const created = await new Promise<Parameters<Parameters<C2S['host:create']>[1]>[0]>((resolve) => host.emit('host:create', {}, resolve));
  if (!created.ok) throw new Error(`host:create failed: ${created.error}`);
  state = created.state;
  const code = created.code;
  console.log(`room ${code} on ${opts.url}`);

  const bots = Array.from({ length: opts.players }, (_, i) => new Bot(opts, i, code));
  await Promise.all(bots.map((b) => b.join()));
  for (const b of bots) b.startPlaying();
  await waitFor('all players in the room', 5_000, () => (state?.players.length ?? 0) === bots.length);
  log(opts, `${bots.length} bots joined`);

  const expectedTotals = new Map<string, number>(bots.map((b) => [b.playerId, 0]));

  for (let i = 0; i < rounds; i++) {
    const gameId = opts.games[i % opts.games.length] ?? 'tap';
    await emitHost(host, 'host:start', { gameId });
    await waitFor('the round to exist', 5_000, () => state?.round?.index === i || state?.results?.roundIndex === i);
    log(opts, `round ${i} (${gameId}) started`);

    let manualFired = false;
    await waitFor(`results of round ${i}`, 10 * 60_000, () => {
      const s = state;
      if (s === null) return false;
      if (opts.cutscene !== null && !manualFired && s.phase === 'playing' && s.round !== null && s.cutscene === null) {
        const t = roundTime(s.round, hostClock.now());
        if (!t.frozen && t.elapsedMs > (s.round.endAt - s.round.startAt) * 0.6) {
          manualFired = true;
          void emitHost(host, 'host:cutscene', { id: opts.cutscene }).catch((e: Error) => failures.push(e.message));
        }
      }
      return s.phase === 'results' && s.results?.roundIndex === i;
    });
    // Let the final acks of the last bots land before reading what they sent.
    await sleep(150);

    const results = (state as RoomState | null)?.results;
    if (results === null || results === undefined) throw new Error('results vanished');
    const sent = new Map<string, number>(bots.map((b) => [b.playerId, b.plans.get(i)?.expected ?? 0]));
    const scored = computeRoundScores(sent);
    let roundBad = 0;
    for (const row of results.rows) {
      const want = scored.get(row.playerId);
      const total = (expectedTotals.get(row.playerId) ?? 0) + (want?.points ?? 0);
      expectedTotals.set(row.playerId, total);
      if (want === undefined || row.raw !== sent.get(row.playerId) || row.points !== want.points || row.roundRank !== want.roundRank || row.total !== total) {
        roundBad++;
        if (roundBad <= 5) {
          failures.push(
            `round ${i} ${row.name}: server raw=${row.raw} points=${row.points} rank=${row.roundRank} total=${row.total}; ` +
              `bots sent raw=${String(sent.get(row.playerId))} -> points=${String(want?.points)} rank=${String(want?.roundRank)} total=${total}`,
          );
        }
      }
    }
    if (results.rows.length !== bots.length) failures.push(`round ${i}: ${results.rows.length} rows for ${bots.length} bots`);
    const wantWinners = [...scored].filter(([id, s]) => s.roundRank === 1 && (sent.get(id) ?? 0) > 0).map(([id]) => id).sort();
    if (JSON.stringify([...results.winnerIds].sort()) !== JSON.stringify(wantWinners)) failures.push(`round ${i}: winnerIds mismatch`);
    const winner = results.rows.find((r) => r.playerId === results.winnerIds[0]);
    log(opts, `round ${i} scored: ${roundBad === 0 ? 'rows match' : `${roundBad} rows WRONG`}; winner ${winner?.name ?? '(nobody)'} raw=${winner?.raw ?? 0}`);
    // A cutscene after the round ('after' trigger) must be over before the next start.
    await waitFor('the cutscene to end', 2 * 60_000, () => state?.cutscene === null);
    await sleep(300);
  }

  await emitHost(host, 'host:final', {});
  await waitFor('the podium', 5_000, () => state?.phase === 'final');
  await waitFor('the podium cutscene to end', 2 * 60_000, () => state?.cutscene === null);
  await sleep(200);

  const finalState = state as RoomState | null;
  if (finalState === null) throw new Error('no final state');
  let totalsBad = 0;
  for (const p of finalState.players) {
    if (p.total !== expectedTotals.get(p.id)) {
      totalsBad++;
      if (totalsBad <= 5) failures.push(`final total of ${p.name}: server ${p.total}, expected ${String(expectedTotals.get(p.id))}`);
    }
  }
  if (finalState.players.length !== bots.length) failures.push(`final state has ${finalState.players.length} players, expected ${bots.length}`);
  if (finalState.played.length !== rounds) failures.push(`played ${finalState.played.length} rounds, expected ${rounds}`);
  const disconnected = finalState.players.filter((p) => !p.connected).length;
  if (opts.churn === 0 && disconnected > 0) failures.push(`${disconnected} bots shown as disconnected`);

  const top = [...finalState.players].sort((a, b) => b.total - a.total).slice(0, 3);
  console.log('');
  console.log(`podium: ${top.map((p, i) => `${i + 1}. ${p.name} ${p.total}`).join('   ')}`);
  console.log(`totals: ${totalsBad === 0 ? 'all match computeRoundScores of what the bots sent' : `${totalsBad} MISMATCH`}`);
  console.log(`cutscenes: ${cutscenesSeen} played, ${freezesChecked} mid-game freezes checked (time left preserved)`);
  if (opts.churn > 0) console.log(`churn: ${bots.reduce((s, b) => s + b.reconnects, 0)} reconnects, ${disconnected} bots offline at the end`);
  console.log(`state delivery latency (server stamp -> bot):   ${stateLatency.summary()}`);
  console.log(`score echo (bot sends -> sees it in 'scores'):  ${scoreEcho.summary()}`);
  console.log(`clock sync rtt: max ${Math.max(...bots.map((b) => b.clock.rtt)).toFixed(1)}ms`);

  for (const b of bots) b.stop();
  host.disconnect();
  if (failures.length > 0) {
    console.error(`\nFAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log('\nOK');
  return 0;
}

async function joinExisting(opts: Options, code: string): Promise<number> {
  const bots = Array.from({ length: opts.players }, (_, i) => new Bot(opts, i, code));
  await Promise.all(bots.map((b) => b.join()));
  console.log(`${bots.length} bots joined room ${code} on ${opts.url} (${opts.hold ? 'holding, idle' : 'playing along'}). Ctrl-C to leave.`);
  if (!opts.hold) for (const b of bots) b.startPlaying();

  let finished = 0;
  let lastSeen = -1;
  const stop = (): void => {
    for (const b of bots) b.stop();
    if (!opts.hold) {
      console.log(`state delivery latency: ${stateLatency.summary()}`);
      console.log(`score echo:             ${scoreEcho.summary()}`);
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  for (;;) {
    await sleep(200);
    const s = bots.find((b) => b.state !== null)?.state ?? null;
    if (s === null) continue;
    if (s.phase === 'results' && s.results !== null && s.results.roundIndex !== lastSeen) {
      lastSeen = s.results.roundIndex;
      finished++;
      log(opts, `round ${lastSeen} (${s.results.gameId}) finished`);
      if (!opts.hold && opts.rounds !== null && finished >= opts.rounds) {
        await sleep(500);
        stop();
      }
    }
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const exitCode = opts.code === null ? await selfHosted(opts) : await joinExisting(opts, opts.code);
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
