/**
 * One party room: players, phases, the round clock, cutscenes and scoring.
 * Pure logic: no sockets, no globals. Time and timers come from a Scheduler
 * and everything it wants to tell the outside world goes through a RoomSink,
 * so the whole state machine runs under fake timers in unit tests.
 */
import { CUTSCENES } from '../shared/cutscenes';
import {
  CUTSCENE_MAX_MS,
  ELIMINATION_END_DELAY_MS,
  FINAL_GRACE_MS,
  FINALE_LATEST_MS,
  FINALE_LEAD_MS,
  FINALE_PLAYERS,
  FINALE_SMALL_FIELD_MS,
  GAME_IDS,
  GAMES,
  LOOK_BROADCAST_INTERVAL_MS,
  MAX_PLAYERS,
  RESUME_COUNTDOWN_MS,
  SCORE_BROADCAST_INTERVAL_MS,
  WINNER_REVEAL_MS,
} from '../shared/protocol';
import { roundTime } from '../shared/round-clock';
import { computeRoundScores, orderOverall, orderRound, rankOverall } from '../shared/scoring';

import { DEFAULT_TIMING } from './config';
import { cleanLook, startingLook } from './looks';
import { cleanName, uniqueName } from './names';

import type { CutsceneDef } from '../shared/cutscenes';
import type {
  Ack,
  CutsceneState,
  ErrorCode,
  GameId,
  HostRole,
  Phase,
  PlayerPublic,
  ResultRow,
  RoomState,
  RoundPublic,
  RoundResults,
} from '../shared/protocol';
import type { RoundEntry, StandingEntry } from '../shared/scoring';
import type { RoomTiming } from './config';

export type TimerHandle = unknown;

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** Uses the global clock and timers (which vitest's fake timers replace). */
export const SYSTEM_SCHEDULER: Scheduler = {
  now: (): number => Date.now(),
  setTimeout: (fn: () => void, ms: number): TimerHandle => setTimeout(fn, ms),
  clearTimeout: (handle: TimerHandle): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ScoresMessage {
  readonly round: number;
  readonly scores: ReadonlyArray<readonly [string, number]>;
  /** Participants still playing: no final, and connected or inside the disconnect grace. */
  readonly active: number;
  /** Participants whose final is in (elimination: who is out). */
  readonly out: readonly string[];
}

export interface LooksMessage {
  readonly looks: ReadonlyArray<readonly [string, string]>;
}

export interface RoomSink {
  /** The room changed: send this snapshot to everyone in it. */
  state(state: RoomState): void;
  scores(msg: ScoresMessage): void;
  /**
   * Looks that changed since the last message: send this small list to everyone in the room.
   * A sink without it gets a whole `state` instead.
   */
  looks?(msg: LooksMessage): void;
  /** These connections belong to a player the host just removed. */
  kicked(connIds: readonly string[]): void;
}

export interface RoomDeps {
  readonly sink: RoomSink;
  readonly scheduler?: Scheduler;
  readonly timing?: RoomTiming;
  /** Cutscene manifest (tests inject their own). */
  readonly cutscenes?: readonly CutsceneDef[];
  /** Random token for player ids and secrets. */
  readonly token: () => string;
  /** Random uint32 for round seeds. */
  readonly seed: () => number;
  readonly onError?: (err: unknown) => void;
}

export interface JoinRequest {
  readonly name: unknown;
  readonly playerId?: unknown;
  readonly secret?: unknown;
  /** An encoded look for a NEW player (ignored on a resume). */
  readonly look?: unknown;
}

export type OkAck = Ack<{}>;

interface PlayerRec {
  readonly id: string;
  readonly secret: string;
  name: string;
  readonly avatar: number;
  /** The dressed doll: an encoded, always valid look (server/looks.ts). */
  look: string;
  /** Position in the order of joining: the last tie-break, never random. */
  readonly joinOrder: number;
  total: number;
  /** Rounds won in this competition. */
  wins: number;
  /** Best points in a single round of this competition. */
  best: number;
  /** Strict position in the most recent round; null before the first one. */
  lastPos: number | null;
  /** Was in a results table before (prevRank is null on a first appearance). */
  appeared: boolean;
  readonly conns: Set<string>;
  /** Server ms at which the last connection left; null while connected. */
  goneAt: number | null;
}

interface RoundRec {
  readonly index: number;
  /** 1-based position in the current competition (display). */
  readonly number: number;
  readonly gameId: GameId;
  readonly seed: number;
  startAt: number;
  endAt: number;
  frozenAt: number | null;
  resumeAt: number | null;
  readonly participants: Set<string>;
  readonly live: Map<string, number>;
  readonly finals: Map<string, number>;
  /**
   * Server ms at which each player's score last CHANGED (live or final). At the end
   * of the round this is when they reached their final raw score: on equal raw
   * scores the earlier one is ahead.
   */
  readonly reachedAt: Map<string, number>;
  /** 'during' cutscenes already handled in this round. */
  readonly duringDone: Set<string>;
  /** host:endRound arrived while a cutscene was playing. */
  pendingEnd: boolean;
  /** GAMES[gameId].mode === 'elimination'. */
  readonly elimination: boolean;
  /** See RoundPublic.finale. */
  finale: { readonly atElapsedMs: number } | null;
  /** Participants connected when `playing` began (the finale threshold and the end rule read it). */
  fieldSize: number;
  /** Server ms since which the round clock has been running without a freeze (disconnect grace counts from here). */
  runningSince: number;
  /** The "one is left" end timer is armed. */
  elimEndArmed: boolean;
}

/** How long a disconnected participant is waited for before the others' finals may end the round early. */
export const DISCONNECT_END_GRACE_MS = 5_000;

const OK: OkAck = { ok: true };

function fail(error: ErrorCode, message: string): { ok: false; error: ErrorCode; message: string } {
  return { ok: false, error, message };
}

function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value);
}

export class Room {
  readonly code: string;
  readonly hostKey: string;

  private readonly sink: RoomSink;
  private readonly scheduler: Scheduler;
  private readonly timing: RoomTiming;
  private readonly cutscenes: readonly CutsceneDef[];
  private readonly token: () => string;
  private readonly seed: () => number;
  private readonly onError: (err: unknown) => void;

  private phase: Phase = 'lobby';
  private readonly players = new Map<string, PlayerRec>();
  /** connection id → player id. */
  private readonly playerConns = new Map<string, string>();
  /** Host connections: the TV page ('screen') and phone remotes ('remote'). */
  private readonly hostConns = new Map<string, HostRole>();
  /** Last time a TV page attached (which room a remote picks first). */
  private screenAttachedAt = Number.NEGATIVE_INFINITY;
  private readonly kickedIds = new Set<string>();
  private round: RoundRec | null = null;
  private nextRoundIndex = 0;
  private played: GameId[] = [];
  private results: RoundResults | null = null;
  private cutscene: CutsceneState | null = null;
  private autoCutscenes = true;
  /** Automatic cutscenes already fired in this competition. */
  private readonly firedCutscenes = new Set<string>();
  private nextAvatar = 0;
  private nextJoinOrder = 0;
  /** Player ids in strict overall order as it was BEFORE the last finished round. */
  private prevOrder: string[] = [];

  private phaseTimers: TimerHandle[] = [];
  /** Disconnect-grace timers: not phase timers, a freeze must not drop them. */
  private graceTimers: TimerHandle[] = [];
  private cutsceneTimer: TimerHandle | null = null;
  private scoresTimer: TimerHandle | null = null;
  private scoresDirty = false;
  private lastScoresAt = Number.NEGATIVE_INFINITY;
  /** Players whose look changed since the last `looks` / `state` message. */
  private readonly dirtyLooks = new Set<string>();
  private looksTimer: TimerHandle | null = null;
  private lastLooksAt = Number.NEGATIVE_INFINITY;
  private emptySince: number | null;
  private destroyed = false;

  constructor(code: string, hostKey: string, deps: RoomDeps) {
    this.code = code;
    this.hostKey = hostKey;
    this.sink = deps.sink;
    this.scheduler = deps.scheduler ?? SYSTEM_SCHEDULER;
    this.timing = deps.timing ?? DEFAULT_TIMING;
    this.cutscenes = deps.cutscenes ?? CUTSCENES;
    this.token = deps.token;
    this.seed = deps.seed;
    this.onError = deps.onError ?? ((err: unknown): void => console.error('[room] timer failed', err));
    this.emptySince = this.scheduler.now();
  }

  // ───────────────────────────── Queries ─────────────────────────────

  snapshot(): RoomState {
    const now = this.scheduler.now();
    const r = this.round;
    if (r !== null && r.resumeAt !== null && r.frozenAt === null && now >= r.resumeAt) r.resumeAt = null;
    const ranks = rankOverall(this.standings());
    const players: PlayerPublic[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      look: p.look,
      connected: p.conns.size > 0,
      total: p.total,
      rank: ranks.get(p.id) ?? this.players.size,
    }));
    return {
      code: this.code,
      phase: this.phase,
      players,
      round: r === null ? null : this.roundPublic(r),
      played: [...this.played],
      results: this.results,
      cutscene: this.cutscene,
      autoCutscenes: this.autoCutscenes,
      remotes: this.remoteCount,
      serverNow: now,
    };
  }

  get playerCount(): number {
    return this.players.size;
  }

  /** Players with a phone attached right now. */
  get connectedPlayerCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.conns.size > 0) n++;
    return n;
  }

  get connectionCount(): number {
    return this.hostConns.size + this.playerConns.size;
  }

  get hostConnected(): boolean {
    return this.hostConns.size > 0;
  }

  /** A TV page is attached (cutscenes play on it). */
  get screenConnected(): boolean {
    for (const role of this.hostConns.values()) if (role === 'screen') return true;
    return false;
  }

  /** Phone remotes attached right now. */
  get remoteCount(): number {
    let n = 0;
    for (const role of this.hostConns.values()) if (role === 'remote') n++;
    return n;
  }

  /** Server ms of the last TV attach (-Infinity: never). */
  get lastScreenAt(): number {
    return this.screenAttachedAt;
  }

  hostRoleOf(connId: string): HostRole | null {
    return this.hostConns.get(connId) ?? null;
  }

  /** Every host connection (TV pages and remotes). */
  hostConnIds(): string[] {
    return [...this.hostConns.keys()];
  }

  /** Ms since the last socket left; 0 while anyone is attached. */
  idleMs(): number {
    return this.emptySince === null ? 0 : this.scheduler.now() - this.emptySince;
  }

  isHostConn(connId: string): boolean {
    return this.hostConns.has(connId);
  }

  playerIdOf(connId: string): string | null {
    return this.playerConns.get(connId) ?? null;
  }

  // ───────────────────────────── Connections ─────────────────────────────

  /** role 'screen': the TV page (host:create); 'remote': the owner's phone (remote:attach). */
  attachHost(connId: string, role: HostRole = 'screen'): RoomState {
    const remotesBefore = this.remoteCount;
    this.detach(connId);
    this.hostConns.set(connId, role);
    if (role === 'screen') this.screenAttachedAt = this.scheduler.now();
    this.emptySince = null;
    // the TV hides its controls while a remote is attached: tell it
    if (this.remoteCount !== remotesBefore) this.broadcast();
    // a TV (or remote) that re-attaches mid-round gets the live race right after the ack, not at the next score change
    if (this.phase === 'playing' && this.round !== null) this.markScoresDirty();
    return this.snapshot();
  }

  join(connId: string, req: JoinRequest): Ack<{ playerId: string; secret: string; state: RoomState }> {
    const name = cleanName(req.name);
    const playerId = typeof req.playerId === 'string' ? req.playerId : null;
    const secret = typeof req.secret === 'string' ? req.secret : null;

    let existing = playerId !== null ? this.players.get(playerId) : undefined;
    if (existing !== undefined && (secret === null || existing.secret !== secret)) existing = undefined;
    if (existing === undefined && playerId === null) {
      // The same socket joining again without an identity (a double tap on "join", a
      // retry after a lost ack) is the same guest, never a second player.
      const mine = this.playerConns.get(connId);
      existing = mine !== undefined ? this.players.get(mine) : undefined;
    }
    if (existing !== undefined) {
      this.detach(connId);
      if (name !== null && name !== existing.name) {
        existing.name = uniqueName(name, this.namesExcept(existing.id));
      }
      existing.conns.add(connId);
      existing.goneAt = null;
      this.playerConns.set(connId, existing.id);
      this.emptySince = null;
      // a phone back mid-round gets the live race now (the head count and who is out included)
      if (this.phase === 'playing' && this.round !== null) this.markScoresDirty();
      this.broadcast();
      return { ok: true, playerId: existing.id, secret: existing.secret, state: this.snapshot() };
    }
    if (playerId !== null && this.kickedIds.has(playerId)) {
      return fail('KICKED', 'המנחה הוציא אותך מהמשחק');
    }
    if (name === null) return fail('BAD_NAME', 'צריך לבחור שם');
    if (this.players.size >= MAX_PLAYERS) return fail('ROOM_FULL', 'החדר מלא');

    this.detach(connId);
    const id = this.token();
    const player: PlayerRec = {
      id,
      secret: this.token(),
      name: uniqueName(name, this.namesExcept(null)),
      avatar: this.nextAvatar++,
      // the look the phone brought, or a doll of its own for a guest who has not dressed yet
      look: cleanLook(req.look) ?? startingLook(id, this.looksInRoom()),
      joinOrder: this.nextJoinOrder++,
      total: 0,
      wins: 0,
      best: 0,
      lastPos: null,
      appeared: false,
      conns: new Set([connId]),
      goneAt: null,
    };
    this.players.set(player.id, player);
    this.playerConns.set(connId, player.id);
    this.emptySince = null;
    this.broadcast();
    return { ok: true, playerId: player.id, secret: player.secret, state: this.snapshot() };
  }

  /** A socket went away (or moved to another room). Player and scores are kept. */
  disconnect(connId: string): void {
    const playerId = this.playerConns.get(connId);
    const wasRemote = this.hostConns.get(connId) === 'remote';
    const wasAttached = this.detach(connId);
    if (!wasAttached) return;
    if (this.connectionCount === 0) this.emptySince = this.scheduler.now();
    if (playerId === undefined) {
      if (wasRemote) this.broadcast();
      return;
    }
    const player = this.players.get(playerId);
    if (player === undefined || player.conns.size > 0) return;
    // A phone that drops for a moment (screen lock, Wi-Fi blip) must not end the round
    // for itself: only when it stays away is the round ended early without it.
    const r = this.round;
    if (r !== null && this.phase === 'playing' && r.participants.has(playerId) && !r.finals.has(playerId)) {
      this.armGrace(DISCONNECT_END_GRACE_MS);
    }
    this.broadcast();
  }

  // ───────────────────────────── Host actions ─────────────────────────────

  start(gameId: unknown): OkAck {
    if (!isGameId(gameId)) return fail('BAD_REQUEST', 'unknown game');
    if (this.phase !== 'lobby' && this.phase !== 'results') return fail('BAD_PHASE', 'a round is already running');
    const now = this.scheduler.now();
    const startAt = now + this.timing.introMs + this.timing.countdownMs;
    this.clearPhaseTimers();
    this.round = {
      index: this.nextRoundIndex++,
      number: this.played.length + 1,
      gameId,
      seed: this.seed() >>> 0,
      startAt,
      endAt: startAt + this.timing.durationMs(gameId),
      frozenAt: null,
      resumeAt: null,
      participants: new Set(this.players.keys()),
      live: new Map(),
      finals: new Map(),
      reachedAt: new Map(),
      duringDone: new Set(),
      pendingEnd: false,
      elimination: GAMES[gameId].mode === 'elimination',
      finale: null,
      fieldSize: 0,
      runningSince: startAt,
      elimEndArmed: false,
    };
    this.phase = 'intro';
    this.scoresDirty = false;
    if (this.cutscene !== null) {
      // A manual cutscene is still on the TV: the new round waits for it.
      this.round.frozenAt = now;
    } else {
      const before = this.findAuto((c) => c.when.at === 'before' && c.when.gameId === gameId);
      if (before !== undefined) this.beginCutscene(before.id, true);
      else this.armPhaseTimers();
    }
    this.broadcast();
    return OK;
  }

  endRound(): OkAck {
    const r = this.round;
    if (r === null || (this.phase !== 'intro' && this.phase !== 'countdown' && this.phase !== 'playing')) {
      return fail('BAD_PHASE', 'no round is running');
    }
    if (this.cutscene !== null) {
      // Never under a video: carried out the moment the cutscene ends.
      r.pendingEnd = true;
      return OK;
    }
    this.endRoundNow();
    return OK;
  }

  toLobby(): OkAck {
    if (this.phase !== 'results' && this.phase !== 'final') return fail('BAD_PHASE', 'not in results or final');
    this.clearPhaseTimers();
    this.phase = 'lobby';
    this.round = null;
    this.broadcast();
    return OK;
  }

  toFinal(): OkAck {
    if (this.phase !== 'lobby' && this.phase !== 'results') return fail('BAD_PHASE', 'not in lobby or results');
    this.clearPhaseTimers();
    this.phase = 'final';
    this.round = null;
    if (this.cutscene === null) {
      const def = this.findAuto((c) => c.when.at === 'final');
      if (def !== undefined) this.beginCutscene(def.id, true);
    }
    this.broadcast();
    return OK;
  }

  reset(): OkAck {
    this.clearPhaseTimers();
    this.clearGraceTimers();
    this.clearCutsceneTimer();
    this.clearScoresTimer();
    this.cutscene = null;
    this.phase = 'lobby';
    this.round = null;
    // nextRoundIndex is NOT reset: round ids stay unique for the room's lifetime (phones key on them).
    this.played = [];
    this.results = null;
    this.prevOrder = [];
    this.firedCutscenes.clear();
    for (const p of this.players.values()) {
      p.total = 0;
      p.wins = 0;
      p.best = 0;
      p.lastPos = null;
      p.appeared = false;
    }
    this.broadcast();
    return OK;
  }

  kick(playerId: unknown): OkAck {
    if (typeof playerId !== 'string') return fail('BAD_REQUEST', 'playerId must be a string');
    const player = this.players.get(playerId);
    if (player === undefined) return fail('BAD_REQUEST', 'unknown player');
    const conns = [...player.conns];
    for (const c of conns) this.playerConns.delete(c);
    this.players.delete(playerId);
    this.kickedIds.add(playerId);
    const r = this.round;
    if (r !== null && r.participants.delete(playerId)) {
      r.live.delete(playerId);
      r.finals.delete(playerId);
      r.reachedAt.delete(playerId);
      if (this.phase === 'playing') this.markScoresDirty();
    }
    this.dropFromResults(playerId);
    if (this.connectionCount === 0) this.emptySince = this.scheduler.now();
    this.sink.kicked(conns);
    if (this.settle()) return OK;
    this.broadcast();
    return OK;
  }

  startCutscene(id: unknown): OkAck {
    if (typeof id !== 'string') return fail('BAD_REQUEST', 'id must be a string');
    if (this.cutscenes.find((c) => c.id === id) === undefined) return fail('BAD_REQUEST', 'unknown cutscene');
    if (this.cutscene !== null) return fail('BAD_PHASE', 'a cutscene is already playing');
    this.beginCutscene(id, false);
    this.broadcast();
    return OK;
  }

  /** The TV finished (or skipped) the video, or the safety timer ran out. Idempotent. */
  endCutscene(): OkAck {
    const cs = this.cutscene;
    if (cs === null) return OK;
    const now = this.scheduler.now();
    this.cutscene = null;
    this.clearCutsceneTimer();

    // The winner reveal never happens under a video.
    if (this.results !== null && cs.startedAt < this.results.revealAt) {
      this.results = { ...this.results, revealAt: this.results.revealAt + (now - cs.startedAt) };
    }

    const r = this.round;
    if (r !== null && r.frozenAt !== null) {
      // Frozen after the round's time was up (in the grace for finals): nothing is left
      // to continue, so no 3-2-1; the round is scored as soon as the video ends.
      const over = this.phase === 'playing' && r.frozenAt >= r.endAt;
      const playing = this.phase === 'playing' && !over;
      const elapsedAtFreeze = roundTime(this.roundPublic(r), now).elapsedMs;
      const resumePoint = playing ? now + RESUME_COUNTDOWN_MS : now;
      const delta = resumePoint - r.frozenAt;
      r.startAt += delta;
      r.endAt += delta;
      r.frozenAt = null;
      r.resumeAt = playing ? resumePoint : null;
      r.runningSince = resumePoint;
      const elapsedAtResume = roundTime(this.roundPublic(r), resumePoint).elapsedMs;
      if (elapsedAtResume !== elapsedAtFreeze) {
        this.onError(new Error(`round clock drifted over a freeze: ${elapsedAtFreeze} -> ${elapsedAtResume}`));
      }
      if (r.pendingEnd || over) {
        r.pendingEnd = false;
        this.endRoundNow();
        return OK;
      }
      if (!r.elimination && this.maybeEndEarly()) return OK;
      this.armPhaseTimers();
      // phones that dropped during the video get the grace again from the moment the round continues
      if (this.phase === 'playing') this.armGrace(resumePoint - now + DISCONNECT_END_GRACE_MS);
    }
    this.broadcast();
    return OK;
  }

  setAutoCutscenes(enabled: unknown): OkAck {
    if (typeof enabled !== 'boolean') return fail('BAD_REQUEST', 'enabled must be a boolean');
    if (this.autoCutscenes !== enabled) {
      this.autoCutscenes = enabled;
      this.broadcast();
    }
    return OK;
  }

  // ───────────────────────────── Player actions ─────────────────────────────

  /** Live score. Fire-and-forget: anything invalid is dropped silently. */
  score(playerId: string, roundIndex: unknown, score: unknown): void {
    const r = this.round;
    if (r === null || this.phase !== 'playing') return;
    if (roundIndex !== r.index || typeof score !== 'number' || !Number.isFinite(score)) return;
    if (!r.participants.has(playerId) || r.finals.has(playerId)) return;
    const value = this.clamp(r.gameId, score);
    if (r.live.get(playerId) === value) return;
    if ((r.live.get(playerId) ?? 0) !== value) r.reachedAt.set(playerId, this.scheduler.now());
    r.live.set(playerId, value);
    this.markScoresDirty();
  }

  final(playerId: string, roundIndex: unknown, score: unknown): OkAck {
    const r = this.round;
    if (typeof roundIndex !== 'number' || typeof score !== 'number' || !Number.isFinite(score)) {
      return fail('BAD_REQUEST', 'round and score must be finite numbers');
    }
    if (r === null || this.phase !== 'playing' || roundIndex !== r.index) {
      return fail('BAD_PHASE', 'that round is not running');
    }
    if (!r.participants.has(playerId)) return fail('BAD_REQUEST', 'not a participant of this round');
    if (r.finals.has(playerId)) return OK; // the first final wins
    const value = this.clamp(r.gameId, score);
    // A final that only confirms the live score keeps the moment that score was reached.
    if ((r.live.get(playerId) ?? 0) !== value) r.reachedAt.set(playerId, this.scheduler.now());
    r.finals.set(playerId, value);
    this.markScoresDirty();
    this.settle();
    return OK;
  }

  /**
   * The player's doll changed (the dressing room on the phone). Allowed in every phase:
   * a look is only a picture, it never touches a round. The text is never trusted:
   * what is stored is `cleanLook(text)`; text that is not a look is refused and the
   * look stays. The others hear it through the small `looks` message, sent at most
   * every LOOK_BROADCAST_INTERVAL_MS however many guests are dressing.
   */
  setLook(playerId: string, look: unknown): Ack<{ look: string }> {
    const player = this.players.get(playerId);
    if (player === undefined) return fail('BAD_REQUEST', 'unknown player');
    const clean = cleanLook(look);
    if (clean === null) return fail('BAD_REQUEST', 'not a look');
    if (clean === player.look) return { ok: true, look: clean };
    player.look = clean;
    const res = this.results;
    if (res !== null && res.rows.some((row) => row.playerId === playerId)) {
      this.results = { ...res, rows: res.rows.map((row) => (row.playerId === playerId ? { ...row, look: clean } : row)) };
    }
    this.dirtyLooks.add(playerId);
    if (this.looksTimer === null) {
      const wait = this.lastLooksAt + LOOK_BROADCAST_INTERVAL_MS - this.scheduler.now();
      this.looksTimer = this.later(wait, () => {
        this.looksTimer = null;
        this.flushLooks();
      });
    }
    return { ok: true, look: clean };
  }

  /** Cancels every timer. The room must not be used afterwards. */
  destroy(): void {
    this.destroyed = true;
    if (this.looksTimer !== null) this.scheduler.clearTimeout(this.looksTimer);
    this.looksTimer = null;
    this.clearPhaseTimers();
    this.clearCutsceneTimer();
    this.clearScoresTimer();
    this.clearGraceTimers();
  }

  // ───────────────────────────── Internals ─────────────────────────────

  private roundPublic(r: RoundRec): RoundPublic {
    return {
      index: r.index,
      number: r.number,
      gameId: r.gameId,
      seed: r.seed,
      startAt: r.startAt,
      endAt: r.endAt,
      frozenAt: r.frozenAt,
      resumeAt: r.resumeAt,
      finale: r.finale,
    };
  }

  private broadcast(): void {
    if (this.destroyed) return;
    // a state carries every look: nothing is left for the next `looks` message
    this.dirtyLooks.clear();
    this.sink.state(this.snapshot());
  }

  private looksInRoom(): string[] {
    return [...this.players.values()].map((p) => p.look);
  }

  /** Sends the looks that changed since the last message (see setLook). */
  private flushLooks(): void {
    if (this.destroyed || this.dirtyLooks.size === 0) return;
    const looks: Array<readonly [string, string]> = [];
    for (const id of this.dirtyLooks) {
      const p = this.players.get(id);
      if (p !== undefined) looks.push([id, p.look] as const);
    }
    this.lastLooksAt = this.scheduler.now();
    if (looks.length === 0) {
      this.dirtyLooks.clear();
      return;
    }
    if (this.sink.looks === undefined) {
      this.broadcast();
      return;
    }
    this.dirtyLooks.clear();
    this.sink.looks({ looks });
  }

  private namesExcept(playerId: string | null): string[] {
    const names: string[] = [];
    for (const p of this.players.values()) if (p.id !== playerId) names.push(p.name);
    return names;
  }

  /** Removes a connection from whatever it was attached to. */
  private detach(connId: string): boolean {
    if (this.hostConns.delete(connId)) return true;
    const playerId = this.playerConns.get(connId);
    if (playerId === undefined) return false;
    this.playerConns.delete(connId);
    const player = this.players.get(playerId);
    if (player !== undefined) {
      player.conns.delete(connId);
      if (player.conns.size === 0) player.goneAt = this.scheduler.now();
    }
    return true;
  }

  private clamp(gameId: GameId, score: number): number {
    // Whole numbers only: the TV prints raw scores and ties must be exact.
    return Math.round(Math.min(GAMES[gameId].maxRaw, Math.max(0, score)));
  }

  private later(ms: number, fn: () => void): TimerHandle {
    return this.scheduler.setTimeout(() => {
      if (this.destroyed) return;
      try {
        fn();
      } catch (err) {
        this.onError(err);
      }
    }, Math.max(0, ms));
  }

  private clearPhaseTimers(): void {
    for (const t of this.phaseTimers) this.scheduler.clearTimeout(t);
    this.phaseTimers = [];
  }

  private clearGraceTimers(): void {
    for (const t of this.graceTimers) this.scheduler.clearTimeout(t);
    this.graceTimers = [];
  }

  private clearCutsceneTimer(): void {
    if (this.cutsceneTimer !== null) this.scheduler.clearTimeout(this.cutsceneTimer);
    this.cutsceneTimer = null;
  }

  private clearScoresTimer(): void {
    if (this.scoresTimer !== null) this.scheduler.clearTimeout(this.scoresTimer);
    this.scoresTimer = null;
    this.scoresDirty = false;
  }

  /** (Re)arms the timers of the current phase from the round's (possibly shifted) times. */
  private armPhaseTimers(): void {
    this.clearPhaseTimers();
    const r = this.round;
    if (r === null || r.frozenAt !== null) return;
    const now = this.scheduler.now();
    switch (this.phase) {
      case 'intro':
        this.phaseTimers.push(
          this.later(r.startAt - this.timing.countdownMs - now, () => this.enterPhase('countdown')),
        );
        return;
      case 'countdown':
        this.phaseTimers.push(this.later(r.startAt - now, () => this.enterPhase('playing')));
        return;
      case 'playing': {
        this.phaseTimers.push(this.later(r.endAt + FINAL_GRACE_MS - now, () => this.finishRound()));
        const duration = r.endAt - r.startAt;
        const scale = duration / GAMES[r.gameId].durationMs;
        for (const def of this.cutscenes) {
          if (def.when.at !== 'during' || r.duringDone.has(def.id)) continue;
          if (def.when.gameId !== undefined && def.when.gameId !== r.gameId) continue;
          const target = def.when.atMs * scale;
          if (!(target >= 0) || target >= duration) continue;
          // Round time `target` is reached at startAt + target; never before the 3-2-1 after a freeze is over.
          const fireAt = Math.max(r.startAt + target, r.resumeAt ?? 0);
          this.phaseTimers.push(this.later(fireAt - now, () => this.fireDuring(def)));
        }
        if (r.elimination) {
          if (r.finale === null) {
            // however many are left, the finale begins at FINALE_LATEST_MS of round time at the latest
            const announceAt = Math.max(r.startAt + FINALE_LATEST_MS * scale - FINALE_LEAD_MS, r.resumeAt ?? 0);
            this.phaseTimers.push(this.later(announceAt - now, () => this.announceFinale()));
          }
          r.elimEndArmed = false;
          this.checkElimination();
        }
        return;
      }
      case 'lobby':
      case 'results':
      case 'final':
        return;
      default: {
        const _exhaustive: never = this.phase;
        throw new Error(`Unhandled phase: ${String(_exhaustive)}`);
      }
    }
  }

  private enterPhase(phase: 'countdown' | 'playing'): void {
    this.phase = phase;
    const r = this.round;
    if (phase === 'playing' && r !== null) {
      const now = this.scheduler.now();
      r.runningSince = now;
      let connected = 0;
      for (const id of r.participants) if ((this.players.get(id)?.conns.size ?? 0) > 0) connected++;
      r.fieldSize = connected;
      if (r.elimination) {
        if (connected <= 2) {
          // 1 or 2 players: "N left" means nothing, the finale comes at a fixed round time
          const scale = (r.endAt - r.startAt) / GAMES[r.gameId].durationMs;
          r.finale = { atElapsedMs: Math.round(FINALE_SMALL_FIELD_MS * scale) };
        }
        // everybody learns the head count at GO
        this.markScoresDirty();
      }
      // a phone that was already away when the round began gets the same grace, from GO
      this.armGrace(DISCONNECT_END_GRACE_MS);
    }
    this.armPhaseTimers();
    this.broadcast();
  }

  // ───────────────────────────── Elimination ─────────────────────────────

  /** Still playing: no final, and connected or away for less than the grace (which never runs out during a freeze). */
  private isActive(r: RoundRec, playerId: string, now: number): boolean {
    const p = this.players.get(playerId);
    if (p === undefined || r.finals.has(playerId)) return false;
    if (p.conns.size > 0 || r.frozenAt !== null) return true;
    return now - Math.max(p.goneAt ?? now, r.runningSince) < DISCONNECT_END_GRACE_MS;
  }

  private activeCount(r: RoundRec, now: number): number {
    let n = 0;
    for (const id of r.participants) if (this.isActive(r, id, now)) n++;
    return n;
  }

  /** Runs `afterGrace` in `ms` when a participant without a final is away right now. */
  private armGrace(ms: number): void {
    const r = this.round;
    if (r === null) return;
    let away = false;
    for (const id of r.participants) {
      if (!r.finals.has(id) && (this.players.get(id)?.conns.size ?? 0) === 0) away = true;
    }
    if (!away) return;
    const index = r.index;
    this.graceTimers.push(
      this.later(ms, () => {
        if (this.round?.index === index) this.afterGrace();
      }),
    );
  }

  /** A disconnected phone's grace may be over: the round goes on (or ends) without it. */
  private afterGrace(): void {
    const r = this.round;
    if (r === null || this.phase !== 'playing' || r.frozenAt !== null) return;
    const now = this.scheduler.now();
    let changed = false;
    for (const id of r.participants) {
      const p = this.players.get(id);
      if (p === undefined || r.finals.has(id) || this.isActive(r, id, now)) continue;
      changed = true;
      // elimination: away for longer than the grace = out, with the score it had (no second life on a late return)
      if (r.elimination) r.finals.set(id, r.live.get(id) ?? 0);
    }
    if (changed) this.markScoresDirty();
    this.settle();
  }

  /** After anything that can end a round early. True when the round was finished right now. */
  private settle(): boolean {
    const r = this.round;
    if (r !== null && r.elimination) {
      this.checkElimination();
      return false;
    }
    return this.maybeEndEarly();
  }

  /** Elimination round: announce the finale at the threshold, and arm the end once one (or nobody) is left. */
  private checkElimination(): void {
    const r = this.round;
    if (r === null || this.phase !== 'playing' || !r.elimination) return;
    const now = this.scheduler.now();
    const n = this.activeCount(r, now);
    if (r.finale === null && r.fieldSize > 2 && n > 1) {
      const threshold = Math.min(FINALE_PLAYERS, r.fieldSize - 1);
      if (n <= threshold) this.announceFinale();
    }
    if (this.cutscene !== null || r.frozenAt !== null || r.elimEndArmed) return;
    // a solo round (a test) runs until that one player is out
    const last = r.fieldSize >= 2 ? 1 : 0;
    if (n > last) return;
    r.elimEndArmed = true;
    this.phaseTimers.push(this.later(ELIMINATION_END_DELAY_MS, () => this.finishRound()));
  }

  /** Sets RoundPublic.finale, once: FINALE_LEAD_MS of round time from now. */
  private announceFinale(): void {
    const r = this.round;
    if (r === null || this.phase !== 'playing' || !r.elimination || r.finale !== null) return;
    const elapsed = Math.max(0, roundTime(this.roundPublic(r), this.scheduler.now()).elapsedMs);
    r.finale = { atElapsedMs: Math.round(elapsed) + FINALE_LEAD_MS };
    // the head count first (not throttled), then the finale: every screen announces "N left" with the right N
    if (this.scoresTimer !== null) this.scheduler.clearTimeout(this.scoresTimer);
    this.scoresTimer = null;
    this.scoresDirty = true;
    this.flushScores();
    this.broadcast();
  }

  private fireDuring(def: CutsceneDef): void {
    const r = this.round;
    if (r === null || this.phase !== 'playing' || this.cutscene !== null) return;
    r.duringDone.add(def.id);
    if (!this.autoAllowed(def)) return;
    this.beginCutscene(def.id, true);
    this.broadcast();
  }

  private autoAllowed(def: CutsceneDef): boolean {
    if (!this.autoCutscenes || def.enabled === false || !this.screenConnected) return false;
    return def.repeat === true || !this.firedCutscenes.has(def.id);
  }

  private findAuto(match: (def: CutsceneDef) => boolean): CutsceneDef | undefined {
    return this.cutscenes.find((c) => match(c) && this.autoAllowed(c));
  }

  /** Sets the cutscene and freezes a running round. The caller broadcasts. */
  private beginCutscene(id: string, auto: boolean): void {
    const now = this.scheduler.now();
    this.cutscene = { id, startedAt: now };
    if (auto) this.firedCutscenes.add(id);
    this.clearCutsceneTimer();
    this.cutsceneTimer = this.later(CUTSCENE_MAX_MS, () => {
      this.cutsceneTimer = null;
      this.endCutscene();
    });
    const r = this.round;
    if (r === null || r.frozenAt !== null) return;
    if (this.phase !== 'intro' && this.phase !== 'countdown' && this.phase !== 'playing') return;
    // During the 3-2-1 after an earlier cutscene the round clock already stands at resumeAt.
    r.frozenAt = r.resumeAt !== null && now < r.resumeAt ? r.resumeAt : now;
    r.resumeAt = null;
    this.clearPhaseTimers();
  }

  private endRoundNow(): void {
    if (this.phase === 'playing') {
      this.finishRound();
      return;
    }
    // intro / countdown: the round never started, so it leaves no trace.
    this.clearPhaseTimers();
    this.phase = 'lobby';
    this.round = null;
    // the cancelled round's id is not reused (a phone may have keyed 'joined late' on it)
    this.broadcast();
  }

  /** Ends the round when every connected participant has sent a final. */
  private maybeEndEarly(): boolean {
    const r = this.round;
    if (r === null || this.phase !== 'playing' || this.cutscene !== null || r.finals.size === 0) return false;
    for (const id of r.participants) {
      const p = this.players.get(id);
      if (p !== undefined && p.conns.size > 0 && !r.finals.has(id)) return false;
    }
    this.finishRound();
    return true;
  }

  private markScoresDirty(): void {
    this.scoresDirty = true;
    if (this.scoresTimer !== null) return;
    const wait = this.lastScoresAt + SCORE_BROADCAST_INTERVAL_MS - this.scheduler.now();
    this.scoresTimer = this.later(wait, () => {
      this.scoresTimer = null;
      this.flushScores();
    });
  }

  private standings(): StandingEntry[] {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      total: p.total,
      wins: p.wins,
      best: p.best,
      lastPos: p.lastPos,
      joinOrder: p.joinOrder,
    }));
  }

  /**
   * A kicked player leaves the last results table too: overall ranks and round
   * positions close up (still 1..n), and when it was the round winner the next
   * scorer of that round becomes the one winner.
   */
  private dropFromResults(playerId: string): void {
    const res = this.results;
    this.prevOrder = this.prevOrder.filter((id) => id !== playerId);
    if (res === null || !res.rows.some((row) => row.playerId === playerId)) return;
    const kept = res.rows.filter((row) => row.playerId !== playerId);
    const roundPos = new Map<string, number>();
    [...kept].sort((x, y) => x.roundRank - y.roundRank).forEach((row, i) => roundPos.set(row.playerId, i + 1));
    const wasWinner = res.winnerIds.includes(playerId);
    const heir = wasWinner ? kept.find((row) => roundPos.get(row.playerId) === 1 && row.raw > 0) : undefined;
    const heirRec = heir === undefined ? undefined : this.players.get(heir.playerId);
    if (heirRec !== undefined) heirRec.wins += 1;
    for (const row of kept) {
      const p = this.players.get(row.playerId);
      if (p !== undefined && p.lastPos !== null) p.lastPos = roundPos.get(row.playerId) ?? p.lastPos;
    }
    const ranks = rankOverall(this.standings());
    const rows = kept.map((row) => {
      const prev = this.prevOrder.indexOf(row.playerId);
      return {
        ...row,
        roundRank: roundPos.get(row.playerId) ?? row.roundRank,
        rank: ranks.get(row.playerId) ?? row.rank,
        prevRank: row.prevRank === null || prev < 0 ? null : prev + 1,
      };
    });
    rows.sort((x, y) => x.rank - y.rank);
    const winnerIds = wasWinner ? (heir === undefined ? [] : [heir.playerId]) : res.winnerIds;
    this.results = { ...res, rows, winnerIds };
  }

  /**
   * The participants of a round in the strict round order of their current scores:
   * the same order the results will have if nothing changes any more.
   */
  private liveOrder(r: RoundRec): RoundEntry[] {
    const entries: RoundEntry[] = [];
    for (const id of r.participants) {
      const p = this.players.get(id);
      if (p === undefined) continue;
      const raw = this.rawOf(r, id);
      entries.push({ id, raw, reachedAt: raw > 0 ? (r.reachedAt.get(id) ?? null) : null, joinOrder: p.joinOrder });
    }
    return orderRound(entries);
  }

  private rawOf(r: RoundRec, playerId: string): number {
    return r.finals.get(playerId) ?? r.live.get(playerId) ?? 0;
  }

  private flushScores(): void {
    const r = this.round;
    if (!this.scoresDirty || r === null) return;
    this.scoresDirty = false;
    this.lastScoresAt = this.scheduler.now();
    const now = this.lastScoresAt;
    const out: string[] = [];
    for (const id of r.finals.keys()) if (r.participants.has(id)) out.push(id);
    this.sink.scores({
      round: r.index,
      scores: this.liveOrder(r).map((e) => [e.id, e.raw] as const),
      active: this.activeCount(r, now),
      out,
    });
  }

  private finishRound(): void {
    const r = this.round;
    if (r === null || this.phase !== 'playing') return;
    this.clearPhaseTimers();
    this.clearGraceTimers();
    const now = this.scheduler.now();
    if (r.elimination && r.finals.size > 0) {
      // Whoever is still in the air outlasted everyone who is out: their survival score is
      // above every final, whatever their phone managed to report last.
      let top = 0;
      for (const v of r.finals.values()) top = Math.max(top, v);
      const floor = Math.min(GAMES[r.gameId].maxRaw, top + 1);
      for (const id of r.participants) {
        if (!this.isActive(r, id, now) || (r.live.get(id) ?? 0) >= floor) continue;
        r.live.set(id, floor);
        r.reachedAt.set(id, now);
        this.scoresDirty = true;
      }
    }
    if (this.scoresTimer !== null) this.scheduler.clearTimeout(this.scoresTimer);
    this.scoresTimer = null;
    this.flushScores();

    // Everyone in the room gets a row; someone who joined mid-round did not play (raw 0).
    const all = [...this.players.values()];
    const entries: RoundEntry[] = all.map((p) => {
      const raw = r.participants.has(p.id) ? this.rawOf(r, p.id) : 0;
      return {
        id: p.id,
        raw,
        reachedAt: raw > 0 ? (r.reachedAt.get(p.id) ?? null) : null,
        joinOrder: p.joinOrder,
        totalBefore: p.total,
      };
    });
    const scored = computeRoundScores(entries);

    this.prevOrder = orderOverall(this.standings());
    const prevRanks = new Map<string, number>();
    this.prevOrder.forEach((id, i) => prevRanks.set(id, i + 1));
    for (const p of all) {
      const s = scored.get(p.id);
      const points = s?.points ?? 0;
      p.total += points;
      p.best = Math.max(p.best, points);
      p.lastPos = s?.roundRank ?? null;
      if (s !== undefined && s.roundRank === 1 && points > 0) p.wins += 1;
    }
    const ranks = rankOverall(this.standings());

    const rows: ResultRow[] = entries.map((e) => {
      const p = this.players.get(e.id)!;
      const s = scored.get(e.id);
      return {
        playerId: p.id,
        name: p.name,
        avatar: p.avatar,
        look: p.look,
        raw: e.raw,
        points: s?.points ?? 0,
        roundRank: s?.roundRank ?? all.length,
        reachedAt: e.reachedAt,
        total: p.total,
        rank: ranks.get(p.id) ?? all.length,
        prevRank: p.appeared ? (prevRanks.get(p.id) ?? null) : null,
      };
    });
    rows.sort((x, y) => x.rank - y.rank);
    for (const p of all) p.appeared = true;

    // Exactly one winner whenever anybody scored: the first of the strict round order.
    const top = rows.find((row) => row.roundRank === 1 && row.raw > 0);
    this.results = {
      roundIndex: r.index,
      roundNumber: r.number,
      gameId: r.gameId,
      rows,
      winnerIds: top === undefined ? [] : [top.playerId],
      revealAt: now + WINNER_REVEAL_MS,
    };
    this.played.push(r.gameId);
    r.frozenAt = null;
    r.resumeAt = null;
    r.pendingEnd = false;
    this.phase = 'results';

    if (this.cutscene === null) {
      const after = this.findAuto(
        (c) => c.when.at === 'after' && (c.when.gameId === undefined || c.when.gameId === r.gameId),
      );
      if (after !== undefined) this.beginCutscene(after.id, true);
    }
    this.broadcast();
  }
}
