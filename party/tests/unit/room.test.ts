import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COUNTDOWN_MS,
  CUTSCENE_MAX_MS,
  FINAL_GRACE_MS,
  GAMES,
  INTRO_MS,
  MAX_PLAYERS,
  NAME_MAX_LEN,
  RESUME_COUNTDOWN_MS,
  SCORE_BROADCAST_INTERVAL_MS,
  WINNER_REVEAL_MS,
} from '../../shared/protocol';
import { roundTime } from '../../shared/round-clock';
import { computeRoundScores } from '../../shared/scoring';
import { timingFromEnv } from '../../server/config';
import { Room } from '../../server/room';
import { normalizeRoomCode, randomRoomCode, ROOM_CODE_ALPHABET, RoomRegistry } from '../../server/rooms';

import type { CutsceneDef } from '../../shared/cutscenes';
import type { RoomState, RoundPublic, RoundResults } from '../../shared/protocol';
import type { RoomTiming } from '../../server/config';
import type { RoomSink, ScoresMessage } from '../../server/room';

const T0 = 1_800_000_000_000;
const TAP_MS = GAMES.tap.durationMs;

interface Harness {
  readonly room: Room;
  readonly states: RoomState[];
  readonly scores: ScoresMessage[];
  readonly kicked: string[][];
  readonly errors: unknown[];
  state(): RoomState;
  round(): RoundPublic;
  results(): RoundResults;
  /** Joins a player on connection `c-<name>` and returns its id. */
  join(name: string): string;
  /** Advances the clock to the first ms of `playing`. */
  toPlaying(): void;
}

function makeRoom(opts: { cutscenes?: readonly CutsceneDef[]; timing?: RoomTiming; host?: boolean } = {}): Harness {
  const states: RoomState[] = [];
  const scores: ScoresMessage[] = [];
  const kicked: string[][] = [];
  const errors: unknown[] = [];
  const sink: RoomSink = {
    state: (s) => states.push(s),
    scores: (m) => scores.push(m),
    kicked: (ids) => kicked.push([...ids]),
  };
  let n = 0;
  const room = new Room('ABCD', 'host-key', {
    sink,
    cutscenes: opts.cutscenes ?? [],
    timing: opts.timing,
    token: () => `tok${++n}`,
    seed: () => 0xdeadbeef,
    onError: (err) => errors.push(err),
  });
  if (opts.host !== false) room.attachHost('host-conn');
  const h: Harness = {
    room,
    states,
    scores,
    kicked,
    errors,
    state: () => room.snapshot(),
    round: () => {
      const r = room.snapshot().round;
      if (r === null) throw new Error('no round');
      return r;
    },
    results: () => {
      const r = room.snapshot().results;
      if (r === null) throw new Error('no results');
      return r;
    },
    join: (name) => {
      const res = room.join(`c-${name}`, { name });
      if (!res.ok) throw new Error(`join failed: ${res.error}`);
      return res.playerId;
    },
    toPlaying: () => {
      const r = h.round();
      vi.advanceTimersByTime(Math.max(0, r.startAt - Date.now()));
      expect(room.snapshot().phase).toBe('playing');
    },
  };
  return h;
}

function left(h: Harness): number {
  return roundTime(h.round(), Date.now()).leftMs;
}

function elapsed(h: Harness): number {
  return roundTime(h.round(), Date.now()).elapsedMs;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('joining', () => {
  it('creates players with trimmed, collapsed names and stable avatars', () => {
    const h = makeRoom();
    const res = h.room.join('c1', { name: '   דנה    כהן  ' });
    expect(res.ok).toBe(true);
    const state = h.state();
    expect(state.players).toHaveLength(1);
    expect(state.players[0]).toMatchObject({ name: 'דנה כהן', avatar: 0, connected: true, total: 0 });
    h.join('יוסי');
    expect(h.state().players.map((p) => p.avatar)).toEqual([0, 1]);
  });

  it('accepts Hebrew and emoji and cuts long names by visible characters', () => {
    const h = makeRoom();
    h.join('👨‍👩‍👧‍👦🎉שימי');
    expect(h.state().players[0]?.name).toBe('👨‍👩‍👧‍👦🎉שימי');
    h.join('א'.repeat(40));
    expect(h.state().players[1]?.name).toBe('א'.repeat(NAME_MAX_LEN));
  });

  it('rejects empty and non-string names', () => {
    const h = makeRoom();
    for (const name of ['', '    ', '\u0000\n\t', 42, null, undefined, {}]) {
      const res = h.room.join('c1', { name });
      expect(res).toMatchObject({ ok: false, error: 'BAD_NAME' });
    }
    expect(h.state().players).toHaveLength(0);
  });

  it('adds a numeric suffix to duplicate names', () => {
    const h = makeRoom();
    h.join('דני');
    h.room.join('c2', { name: 'דני' });
    h.room.join('c3', { name: ' דני ' });
    h.room.join('c4', { name: 'א'.repeat(NAME_MAX_LEN) });
    h.room.join('c5', { name: 'א'.repeat(NAME_MAX_LEN) });
    const names = h.state().players.map((p) => p.name);
    expect(names.slice(0, 3)).toEqual(['דני', 'דני 2', 'דני 3']);
    expect(names[4]).toBe(`${'א'.repeat(NAME_MAX_LEN - 2)} 2`);
    expect(new Set(names).size).toBe(names.length);
  });

  it('caps the room at MAX_PLAYERS', () => {
    const h = makeRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) h.join(`p${i}`);
    expect(h.room.join('extra', { name: 'late' })).toMatchObject({ ok: false, error: 'ROOM_FULL' });
    expect(h.state().players).toHaveLength(MAX_PLAYERS);
  });

  it('resumes the same player when id and secret match, and renames', () => {
    const h = makeRoom();
    const first = h.room.join('c1', { name: 'רון' });
    if (!first.ok) throw new Error('join');
    h.room.disconnect('c1');
    expect(h.state().players[0]?.connected).toBe(false);

    const again = h.room.join('c2', { name: 'רון המלך', playerId: first.playerId, secret: first.secret });
    expect(again).toMatchObject({ ok: true, playerId: first.playerId, secret: first.secret });
    expect(h.state().players).toHaveLength(1);
    expect(h.state().players[0]).toMatchObject({ name: 'רון המלך', connected: true });
  });

  it('creates a new player when the secret is wrong', () => {
    const h = makeRoom();
    const first = h.room.join('c1', { name: 'רון' });
    if (!first.ok) throw new Error('join');
    const other = h.room.join('c2', { name: 'רון', playerId: first.playerId, secret: 'nope' });
    expect(other.ok && other.playerId !== first.playerId).toBe(true);
    expect(h.state().players.map((p) => p.name)).toEqual(['רון', 'רון 2']);
  });

  it('keeps a player connected while any of their sockets is attached', () => {
    const h = makeRoom();
    const first = h.room.join('c1', { name: 'רון' });
    if (!first.ok) throw new Error('join');
    h.room.join('c2', { name: 'רון', playerId: first.playerId, secret: first.secret });
    h.room.disconnect('c1');
    expect(h.state().players[0]?.connected).toBe(true);
    h.room.disconnect('c2');
    expect(h.state().players[0]?.connected).toBe(false);
  });

  it('broadcasts a fresh state on every change', () => {
    const h = makeRoom();
    h.join('a');
    vi.advanceTimersByTime(500);
    h.join('b');
    expect(h.states).toHaveLength(2);
    expect(h.states[1]?.serverNow).toBe(T0 + 500);
    expect(h.states[1]?.players).toHaveLength(2);
  });
});

describe('round lifecycle', () => {
  it('runs intro -> countdown -> playing -> results on the documented clock', () => {
    const h = makeRoom();
    h.join('a');
    expect(h.room.start('tap')).toEqual({ ok: true });
    let s = h.state();
    expect(s.phase).toBe('intro');
    expect(s.round).toEqual({
      index: 0,
      gameId: 'tap',
      seed: 0xdeadbeef,
      startAt: T0 + INTRO_MS + COUNTDOWN_MS,
      endAt: T0 + INTRO_MS + COUNTDOWN_MS + TAP_MS,
      frozenAt: null,
      resumeAt: null,
    });

    vi.advanceTimersByTime(INTRO_MS - 1);
    expect(h.state().phase).toBe('intro');
    vi.advanceTimersByTime(1);
    expect(h.state().phase).toBe('countdown');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(TAP_MS + FINAL_GRACE_MS - 1);
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(1);
    s = h.state();
    expect(s.phase).toBe('results');
    expect(s.round?.index).toBe(0);
    expect(s.played).toEqual(['tap']);
    expect(s.results?.revealAt).toBe(Date.now() + WINNER_REVEAL_MS);
  });

  it('plays a full competition and accumulates totals and ranks', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const c = h.join('c');
    const sent: Array<Map<string, number>> = [
      new Map([[a, 100], [b, 50], [c, 0]]),
      new Map([[a, 10], [b, 40], [c, 40]]),
      new Map([[a, 0], [b, 0], [c, 7]]),
    ];
    const games = ['tap', 'flappy', 'ninja'] as const;
    const expected = new Map<string, number>([[a, 0], [b, 0], [c, 0]]);

    games.forEach((gameId, i) => {
      expect(h.room.start(gameId)).toEqual({ ok: true });
      expect(h.round().index).toBe(i);
      h.toPlaying();
      for (const [id, raw] of sent[i]!) h.room.score(id, i, raw);
      vi.advanceTimersByTime(GAMES[gameId].durationMs + FINAL_GRACE_MS);
      expect(h.state().phase).toBe('results');
      const scored = computeRoundScores(sent[i]!);
      for (const [id, s] of scored) expected.set(id, (expected.get(id) ?? 0) + s.points);
      for (const row of h.results().rows) {
        expect(row.raw).toBe(sent[i]!.get(row.playerId));
        expect(row.points).toBe(scored.get(row.playerId)?.points);
        expect(row.roundRank).toBe(scored.get(row.playerId)?.roundRank);
        expect(row.total).toBe(expected.get(row.playerId));
        expect(row.prevRank === null).toBe(i === 0);
      }
    });

    const s = h.state();
    expect(s.played).toEqual(['tap', 'flappy', 'ninja']);
    for (const p of s.players) expect(p.total).toBe(expected.get(p.id));
    // Round 3: only c scored. Totals: a = 1100 + 280, b = 560 + 1100, c = 0 + 1100 + 1100.
    expect(Object.fromEntries(expected)).toEqual({ [a]: 1380, [b]: 1660, [c]: 2200 });
    expect(h.results().rows.map((r) => [r.playerId, r.rank, r.prevRank])).toEqual([
      [c, 1, 3],
      [b, 2, 1],
      [a, 3, 2],
    ]);
    expect(h.results().winnerIds).toEqual([c]);

    expect(h.room.toFinal()).toEqual({ ok: true });
    expect(h.state()).toMatchObject({ phase: 'final', round: null });
    expect(h.state().results?.roundIndex).toBe(2);
    expect(h.room.toLobby()).toEqual({ ok: true });
    expect(h.state().phase).toBe('lobby');
  });

  it('shares ranks on ties and sorts rows by rank, then name', () => {
    const h = makeRoom();
    const b = h.join('בני');
    const a = h.join('אבי');
    const c = h.join('גיל');
    h.room.start('tap');
    h.toPlaying();
    h.room.final(a, 0, 30);
    h.room.final(b, 0, 30);
    h.room.final(c, 0, 10);
    const res = h.results();
    expect(res.rows.map((r) => [r.name, r.roundRank, r.rank])).toEqual([
      ['אבי', 1, 1],
      ['בני', 1, 1],
      ['גיל', 3, 3],
    ]);
    expect([...res.winnerIds].sort()).toEqual([a, b].sort());
  });

  it('has no winner when nobody scored', () => {
    const h = makeRoom();
    h.join('a');
    h.join('b');
    h.room.start('tap');
    h.toPlaying();
    vi.advanceTimersByTime(TAP_MS + FINAL_GRACE_MS);
    const res = h.results();
    expect(res.winnerIds).toEqual([]);
    expect(res.rows.every((r) => r.points === 0 && r.roundRank === 1 && r.total === 0)).toBe(true);
  });

  it('lets a late joiner watch this round and play the next one', () => {
    const h = makeRoom();
    const a = h.join('a');
    h.room.start('tap');
    h.toPlaying();
    const late = h.join('late');
    h.room.score(late, 0, 999);
    expect(h.room.final(late, 0, 999)).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    h.room.final(a, 0, 5);
    expect(h.state().phase).toBe('results');
    const row = h.results().rows.find((r) => r.playerId === late);
    expect(row).toMatchObject({ raw: 0, points: 0, total: 0, roundRank: 2, prevRank: null });
    expect(h.results().winnerIds).toEqual([a]);

    h.room.start('flappy');
    h.toPlaying();
    h.room.final(late, 1, 9);
    h.room.final(a, 1, 3);
    const rows = h.results().rows;
    expect(rows.find((r) => r.playerId === late)).toMatchObject({ raw: 9, points: 1100, roundRank: 1, prevRank: 2, rank: 2 });
    expect(rows.find((r) => r.playerId === a)).toMatchObject({ total: 1100 + 393, rank: 1, prevRank: 1 });
  });

  it('keeps the score of a player who disconnects mid-round and lets them resume', () => {
    const h = makeRoom();
    const first = h.room.join('c-a', { name: 'a' });
    if (!first.ok) throw new Error('join');
    const b = h.join('b');
    h.room.start('tap');
    h.toPlaying();
    h.room.score(first.playerId, 0, 40);
    h.room.disconnect('c-a');
    expect(h.state().players[0]).toMatchObject({ connected: false });
    expect(h.state().phase).toBe('playing');

    // Resumes on a new socket and keeps playing the same round.
    h.room.join('c-a2', { name: 'a', playerId: first.playerId, secret: first.secret });
    h.room.score(first.playerId, 0, 55);
    h.room.disconnect('c-a2');
    h.room.final(b, 0, 20);
    // b was the only connected participant left, so the round is over.
    expect(h.state().phase).toBe('results');
    expect(h.results().rows.find((r) => r.playerId === first.playerId)).toMatchObject({ raw: 55, points: 1100 });
  });

  it('ends the round early once every connected participant sent a final', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const c = h.join('c');
    h.room.start('plotzel');
    h.toPlaying();
    vi.advanceTimersByTime(20_000);
    h.room.final(a, 0, 900);
    h.room.final(b, 0, 700);
    expect(h.state().phase).toBe('playing');
    h.room.final(c, 0, 100);
    expect(h.state().phase).toBe('results');
    expect(Date.now()).toBeLessThan(h.round().endAt);
    // The old end-of-round timer must not fire a second scoring.
    const totals = h.state().players.map((p) => p.total);
    vi.advanceTimersByTime(GAMES.plotzel.durationMs * 2);
    expect(h.state().players.map((p) => p.total)).toEqual(totals);
    expect(h.state().played).toEqual(['plotzel']);
  });

  it('ends early when the last player without a final disconnects', () => {
    const h = makeRoom();
    const a = h.join('a');
    h.join('b');
    h.room.start('tap');
    h.toPlaying();
    h.room.final(a, 0, 12);
    expect(h.state().phase).toBe('playing');
    h.room.disconnect('c-b');
    expect(h.state().phase).toBe('results');
  });

  it('does not end early when everybody left without a final', () => {
    const h = makeRoom();
    h.join('a');
    h.room.start('tap');
    h.toPlaying();
    h.room.disconnect('c-a');
    expect(h.state().phase).toBe('playing');
  });

  it('clamps scores, lets the first final win and ignores later scores', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const c = h.join('c');
    const d = h.join('d');
    h.room.start('flappy');
    h.toPlaying();
    h.room.score(a, 0, 1e9);
    h.room.score(b, 0, -20);
    h.room.score(c, 0, 12);
    h.room.score(c, 0, Number.NaN);
    h.room.score(c, 0, Number.POSITIVE_INFINITY);
    h.room.score(c, 99, 400);
    h.room.score('ghost', 0, 400);
    expect(h.room.final(d, 0, 30)).toEqual({ ok: true });
    expect(h.room.final(d, 0, 499)).toEqual({ ok: true });
    h.room.score(d, 0, 499);
    vi.advanceTimersByTime(GAMES.flappy.durationMs + FINAL_GRACE_MS);
    const raw = Object.fromEntries(h.results().rows.map((r) => [r.playerId, r.raw]));
    expect(raw).toEqual({ [a]: GAMES.flappy.maxRaw, [b]: 0, [c]: 12, [d]: 30 });
  });

  it('prefers the final over the last live score', () => {
    const h = makeRoom();
    const a = h.join('a');
    h.join('b');
    h.room.start('tap');
    h.toPlaying();
    h.room.score(a, 0, 80);
    h.room.final(a, 0, 60);
    vi.advanceTimersByTime(TAP_MS + FINAL_GRACE_MS);
    expect(h.results().rows.find((r) => r.playerId === a)?.raw).toBe(60);
  });

  it('validates finals', () => {
    const h = makeRoom();
    const a = h.join('a');
    h.join('b');
    expect(h.room.final(a, 0, 5)).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    h.room.start('tap');
    expect(h.room.final(a, 0, 5)).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    h.toPlaying();
    expect(h.room.final(a, 1, 5)).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    expect(h.room.final(a, 0, Number.NaN)).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.final(a, '0', 5)).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.final(a, 0, '5')).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.final('ghost', 0, 5)).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.final(a, 0, 5)).toEqual({ ok: true });
  });

  it('accepts finals during the grace period after endAt', () => {
    const h = makeRoom();
    const a = h.join('a');
    h.join('b');
    h.room.start('tap');
    h.toPlaying();
    vi.advanceTimersByTime(TAP_MS + FINAL_GRACE_MS - 1);
    expect(h.room.final(a, 0, 77)).toEqual({ ok: true });
    vi.advanceTimersByTime(1);
    expect(h.results().rows.find((r) => r.playerId === a)?.raw).toBe(77);
    expect(h.room.final(a, 0, 78)).toMatchObject({ ok: false, error: 'BAD_PHASE' });
  });

  it('throttles the live scores broadcast and only sends changes', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    h.room.start('tap');
    h.toPlaying();
    h.room.score(a, 0, 1);
    vi.advanceTimersByTime(0);
    expect(h.scores).toEqual([{ round: 0, scores: [[a, 1], [b, 0]] }]);
    for (let i = 2; i <= 10; i++) h.room.score(a, 0, i);
    h.room.score(b, 0, 4);
    expect(h.scores).toHaveLength(1);
    vi.advanceTimersByTime(SCORE_BROADCAST_INTERVAL_MS);
    expect(h.scores).toHaveLength(2);
    expect(h.scores[1]).toEqual({ round: 0, scores: [[a, 10], [b, 4]] });
    // Nothing changed: nothing is sent.
    h.room.score(a, 0, 10);
    vi.advanceTimersByTime(5 * SCORE_BROADCAST_INTERVAL_MS);
    expect(h.scores).toHaveLength(2);
  });
});

describe('host actions', () => {
  it('rejects actions in the wrong phase', () => {
    const h = makeRoom();
    h.join('a');
    expect(h.room.endRound()).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    expect(h.room.toLobby()).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    expect(h.room.start('chess')).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.start(undefined)).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    h.room.start('tap');
    expect(h.room.start('icy')).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    expect(h.room.toFinal()).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    expect(h.room.toLobby()).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    h.toPlaying();
    expect(h.room.start('icy')).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    expect(h.room.endRound()).toEqual({ ok: true });
    expect(h.state().phase).toBe('results');
    expect(h.room.endRound()).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    expect(h.room.start('icy')).toEqual({ ok: true });
  });

  it('host:endRound during intro or countdown goes back to the lobby without a trace', () => {
    const h = makeRoom();
    h.join('a');
    h.room.start('tap');
    expect(h.room.endRound()).toEqual({ ok: true });
    expect(h.state()).toMatchObject({ phase: 'lobby', round: null, played: [], results: null });
    vi.advanceTimersByTime(INTRO_MS + COUNTDOWN_MS + TAP_MS * 2);
    expect(h.state().phase).toBe('lobby');

    h.room.start('icy');
    expect(h.round().index).toBe(0);
    vi.advanceTimersByTime(INTRO_MS);
    expect(h.state().phase).toBe('countdown');
    h.room.endRound();
    expect(h.state().phase).toBe('lobby');
  });

  it('host:endRound while playing scores the round now', () => {
    const h = makeRoom();
    const a = h.join('a');
    h.room.start('tap');
    h.toPlaying();
    h.room.score(a, 0, 9);
    h.room.endRound();
    expect(h.state().phase).toBe('results');
    expect(h.results().rows[0]).toMatchObject({ raw: 9, points: 1100 });
  });

  it('reset zeroes the competition and keeps the players', () => {
    const h = makeRoom({ cutscenes: [{ id: 'fin', title: 'f', file: 'f.mp4', when: { at: 'final' } }] });
    const a = h.join('a');
    h.room.start('tap');
    h.toPlaying();
    h.room.final(a, 0, 5);
    h.room.toFinal();
    expect(h.state().cutscene?.id).toBe('fin');
    expect(h.room.reset()).toEqual({ ok: true });
    const s = h.state();
    expect(s).toMatchObject({ phase: 'lobby', round: null, played: [], results: null, cutscene: null });
    expect(s.players).toHaveLength(1);
    expect(s.players[0]).toMatchObject({ id: a, total: 0, connected: true });
    // A new competition starts at round 0 and automatic cutscenes may fire again.
    h.room.start('tap');
    expect(h.round().index).toBe(0);
    h.toPlaying();
    h.room.final(a, 0, 5);
    expect(h.results().rows[0]?.prevRank).toBeNull();
    h.room.toFinal();
    expect(h.state().cutscene?.id).toBe('fin');
  });

  it('reset in the middle of a round cancels its timers', () => {
    const h = makeRoom();
    h.join('a');
    h.room.start('tap');
    h.toPlaying();
    h.room.reset();
    vi.advanceTimersByTime(TAP_MS * 3);
    expect(h.state()).toMatchObject({ phase: 'lobby', results: null });
  });

  it('kick removes the player, tells their sockets and blocks the old identity', () => {
    const h = makeRoom();
    const first = h.room.join('c-a', { name: 'a' });
    if (!first.ok) throw new Error('join');
    const b = h.join('b');
    expect(h.room.kick('ghost')).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.kick(42)).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.kick(first.playerId)).toEqual({ ok: true });
    expect(h.kicked).toEqual([['c-a']]);
    expect(h.state().players.map((p) => p.id)).toEqual([b]);
    expect(h.room.join('c-a', { name: 'a', playerId: first.playerId, secret: first.secret })).toMatchObject({
      ok: false,
      error: 'KICKED',
    });
  });

  it('kicking the last player without a final ends the round', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    h.room.start('tap');
    h.toPlaying();
    h.room.final(a, 0, 3);
    h.room.kick(b);
    expect(h.state().phase).toBe('results');
    expect(h.results().rows.map((r) => r.playerId)).toEqual([a]);
  });
});

describe('cutscenes', () => {
  const manual: CutsceneDef = { id: 'joker', title: 'j', file: 'j.mp4', when: { at: 'manual' } };
  const before: CutsceneDef = { id: 'pre', title: 'p', file: 'p.mp4', when: { at: 'before', gameId: 'ninja' } };
  const during: CutsceneDef = { id: 'mid', title: 'm', file: 'm.mp4', when: { at: 'during', gameId: 'tap', atMs: 30_000 } };
  const after: CutsceneDef = { id: 'post', title: 'a', file: 'a.mp4', when: { at: 'after' } };
  const final: CutsceneDef = { id: 'fin', title: 'f', file: 'f.mp4', when: { at: 'final' } };
  const all = [manual, before, during, after, final];

  it('plays a manual cutscene in the lobby and validates the request', () => {
    const h = makeRoom({ cutscenes: all });
    expect(h.room.startCutscene('nope')).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.startCutscene(7)).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.startCutscene('joker')).toEqual({ ok: true });
    expect(h.state()).toMatchObject({ phase: 'lobby', round: null, cutscene: { id: 'joker', startedAt: T0 } });
    expect(h.room.startCutscene('joker')).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    h.join('late'); // joins work during a cutscene
    expect(h.state().players).toHaveLength(1);
    vi.advanceTimersByTime(9_000);
    expect(h.room.endCutscene()).toEqual({ ok: true });
    expect(h.state().cutscene).toBeNull();
    expect(h.room.endCutscene()).toEqual({ ok: true });
    // Manual cutscenes can be replayed.
    expect(h.room.startCutscene('joker')).toEqual({ ok: true });
  });

  it("'before': the round is created frozen, then gets its full intro", () => {
    const h = makeRoom({ cutscenes: all });
    h.join('a');
    h.room.start('ninja');
    let s = h.state();
    expect(s).toMatchObject({ phase: 'intro', cutscene: { id: 'pre' } });
    expect(s.round?.frozenAt).toBe(T0);
    expect(h.states.at(-1)).toMatchObject({ phase: 'intro', cutscene: { id: 'pre' } });

    vi.advanceTimersByTime(20_000);
    expect(h.state().phase).toBe('intro');
    h.room.endCutscene();
    s = h.state();
    expect(s.cutscene).toBeNull();
    expect(s.round).toMatchObject({
      frozenAt: null,
      resumeAt: null,
      startAt: T0 + 20_000 + INTRO_MS + COUNTDOWN_MS,
      endAt: T0 + 20_000 + INTRO_MS + COUNTDOWN_MS + GAMES.ninja.durationMs,
    });
    vi.advanceTimersByTime(INTRO_MS);
    expect(h.state().phase).toBe('countdown');
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(h.state().phase).toBe('playing');
  });

  it("'during': freezes mid-game and continues with exactly the same time left", () => {
    const h = makeRoom({ cutscenes: all });
    const a = h.join('a');
    h.room.start('tap');
    h.toPlaying();
    vi.advanceTimersByTime(29_999);
    expect(h.state().cutscene).toBeNull();
    vi.advanceTimersByTime(1);
    expect(h.state()).toMatchObject({ phase: 'playing', cutscene: { id: 'mid' } });
    expect(h.round().frozenAt).toBe(Date.now());
    const leftAtFreeze = left(h);
    const elapsedAtFreeze = elapsed(h);
    expect(elapsedAtFreeze).toBe(30_000);
    expect(leftAtFreeze).toBe(TAP_MS - 30_000);

    // A long video: far past the original endAt. The round must not end, scores still count.
    vi.advanceTimersByTime(80_000);
    expect(h.state().phase).toBe('playing');
    expect(left(h)).toBe(leftAtFreeze);
    h.room.score(a, 0, 33);

    h.room.endCutscene();
    const r = h.round();
    expect(r.frozenAt).toBeNull();
    expect(r.resumeAt).toBe(Date.now() + RESUME_COUNTDOWN_MS);
    expect(roundTime(r, Date.now())).toMatchObject({ frozen: true, resumeInMs: RESUME_COUNTDOWN_MS, leftMs: leftAtFreeze });
    expect(roundTime(r, r.resumeAt ?? 0)).toMatchObject({ elapsedMs: elapsedAtFreeze, leftMs: leftAtFreeze, frozen: false });
    expect(h.errors).toEqual([]);

    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS);
    expect(left(h)).toBe(leftAtFreeze);
    expect(h.round().resumeAt).toBeNull();
    vi.advanceTimersByTime(leftAtFreeze + FINAL_GRACE_MS - 1);
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(1);
    expect(h.state().phase).toBe('results');
    expect(h.results().rows[0]?.raw).toBe(33);
  });

  it("'during' is scaled to a shortened round", () => {
    const timing: RoomTiming = { introMs: 1_500, countdownMs: 1_500, durationMs: () => 12_000 };
    const h = makeRoom({ cutscenes: all, timing });
    h.join('a');
    h.room.start('tap');
    expect(h.round().endAt - h.round().startAt).toBe(12_000);
    h.toPlaying();
    vi.advanceTimersByTime(5_999);
    expect(h.state().cutscene).toBeNull();
    vi.advanceTimersByTime(1);
    expect(h.state().cutscene?.id).toBe('mid');
    expect(elapsed(h)).toBe(6_000);
  });

  it('handles a second freeze in the same round, even during the 3-2-1', () => {
    const h = makeRoom({ cutscenes: all });
    h.join('a');
    h.room.start('tap');
    h.toPlaying();
    vi.advanceTimersByTime(10_000);
    h.room.startCutscene('joker');
    expect(elapsed(h)).toBe(10_000);
    vi.advanceTimersByTime(7_000);
    h.room.endCutscene();
    // 1s into the 3-2-1 the host fires another one: the clock still stands at 10s.
    vi.advanceTimersByTime(1_000);
    expect(h.room.startCutscene('joker')).toEqual({ ok: true });
    expect(elapsed(h)).toBe(10_000);
    vi.advanceTimersByTime(4_000);
    expect(elapsed(h)).toBe(10_000);
    h.room.endCutscene();
    expect(elapsed(h)).toBe(10_000);
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS + 5_000);
    expect(elapsed(h)).toBe(15_000);

    // The automatic one still fires at 30s of ROUND time, then the round runs out normally.
    vi.advanceTimersByTime(15_000);
    expect(h.state().cutscene?.id).toBe('mid');
    expect(elapsed(h)).toBe(30_000);
    vi.advanceTimersByTime(12_000);
    h.room.endCutscene();
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS + 30_000 + FINAL_GRACE_MS - 1);
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(1);
    expect(h.state().phase).toBe('results');
    expect(h.errors).toEqual([]);
  });

  it('freezes the intro and the countdown too', () => {
    const h = makeRoom({ cutscenes: all });
    h.join('a');
    h.room.start('tap');
    vi.advanceTimersByTime(INTRO_MS + 1_000);
    expect(h.state().phase).toBe('countdown');
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(30_000);
    expect(h.state().phase).toBe('countdown');
    h.room.endCutscene();
    expect(h.round().resumeAt).toBeNull();
    expect(h.round().startAt - Date.now()).toBe(COUNTDOWN_MS - 1_000);
    vi.advanceTimersByTime(COUNTDOWN_MS - 1_000);
    expect(h.state().phase).toBe('playing');
  });

  it('defers the end of the round to the end of the cutscene', () => {
    const h = makeRoom({ cutscenes: all });
    const a = h.join('a');
    const b = h.join('b');
    h.room.start('flappy');
    h.toPlaying();
    h.room.startCutscene('joker');
    h.room.final(a, 0, 4);
    h.room.final(b, 0, 9);
    expect(h.state().phase).toBe('playing');
    h.room.endCutscene();
    expect(h.state()).toMatchObject({ phase: 'results', cutscene: { id: 'post' } });
  });

  it('defers host:endRound to the end of the cutscene', () => {
    const h = makeRoom({ cutscenes: [manual] });
    h.join('a');
    h.room.start('tap');
    h.toPlaying();
    h.room.startCutscene('joker');
    expect(h.room.endRound()).toEqual({ ok: true });
    expect(h.state().phase).toBe('playing');
    h.room.endCutscene();
    expect(h.state().phase).toBe('results');

    h.room.start('tap');
    h.room.startCutscene('joker');
    h.room.endRound();
    expect(h.state().phase).toBe('intro');
    h.room.endCutscene();
    expect(h.state()).toMatchObject({ phase: 'lobby', round: null });
  });

  it('a round started under a manual cutscene waits for it', () => {
    const h = makeRoom({ cutscenes: all });
    h.join('a');
    h.room.startCutscene('joker');
    h.room.start('ninja');
    // The 'before' cutscene does not stack on top of the one playing.
    expect(h.state()).toMatchObject({ phase: 'intro', cutscene: { id: 'joker' } });
    vi.advanceTimersByTime(40_000);
    expect(h.state().phase).toBe('intro');
    h.room.endCutscene();
    expect(h.round().startAt).toBe(Date.now() + INTRO_MS + COUNTDOWN_MS);
  });

  it("'after': results and cutscene arrive together and the reveal moves past the video", () => {
    const h = makeRoom({ cutscenes: all });
    const a = h.join('a');
    h.room.start('flappy');
    h.toPlaying();
    const before = h.states.length;
    h.room.final(a, 0, 4);
    expect(h.states).toHaveLength(before + 1);
    const s = h.states.at(-1);
    expect(s).toMatchObject({ phase: 'results', cutscene: { id: 'post', startedAt: Date.now() } });
    const revealAt = s?.results?.revealAt ?? 0;
    expect(revealAt).toBe(Date.now() + WINNER_REVEAL_MS);

    vi.advanceTimersByTime(14_000);
    h.room.endCutscene();
    expect(h.results().revealAt).toBe(revealAt + 14_000);
    expect(h.results().revealAt).toBe(Date.now() + WINNER_REVEAL_MS);
    expect(h.state().cutscene).toBeNull();
  });

  it('a manual cutscene before the reveal pushes it back; one after it does not', () => {
    const h = makeRoom({ cutscenes: [manual] });
    const a = h.join('a');
    h.room.start('flappy');
    h.toPlaying();
    h.room.final(a, 0, 4);
    const revealAt = h.results().revealAt;
    vi.advanceTimersByTime(3_000);
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(10_000);
    h.room.endCutscene();
    expect(h.results().revealAt).toBe(revealAt + 10_000);
    vi.advanceTimersByTime(WINNER_REVEAL_MS);
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(10_000);
    h.room.endCutscene();
    expect(h.results().revealAt).toBe(revealAt + 10_000);
  });

  it("'final': the podium phase arrives with its cutscene", () => {
    const h = makeRoom({ cutscenes: all });
    h.join('a');
    const before = h.states.length;
    h.room.toFinal();
    expect(h.states).toHaveLength(before + 1);
    expect(h.states.at(-1)).toMatchObject({ phase: 'final', round: null, cutscene: { id: 'fin' } });
    h.room.endCutscene();
    expect(h.state()).toMatchObject({ phase: 'final', cutscene: null });
  });

  it('ends a cutscene the TV never reports after CUTSCENE_MAX_MS', () => {
    const h = makeRoom({ cutscenes: all });
    h.join('a');
    h.room.start('tap');
    h.toPlaying();
    vi.advanceTimersByTime(5_000);
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(CUTSCENE_MAX_MS - 1);
    expect(h.state().cutscene).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(h.state().cutscene).toBeNull();
    expect(h.round().resumeAt).toBe(Date.now() + RESUME_COUNTDOWN_MS);
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS);
    expect(elapsed(h)).toBe(5_000);
    // An ended cutscene leaves no safety timer behind for the next one.
    h.room.startCutscene('joker');
    h.room.endCutscene();
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(CUTSCENE_MAX_MS - 1);
    expect(h.state().cutscene).not.toBeNull();
  });

  it('fires nothing automatic when autoCutscenes is off (manual still works)', () => {
    const h = makeRoom({ cutscenes: all });
    const a = h.join('a');
    expect(h.state().autoCutscenes).toBe(true);
    expect(h.room.setAutoCutscenes('no')).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.setAutoCutscenes(false)).toEqual({ ok: true });
    expect(h.state().autoCutscenes).toBe(false);

    h.room.start('ninja');
    expect(h.state().cutscene).toBeNull();
    h.room.endRound();
    h.room.start('tap');
    h.toPlaying();
    vi.advanceTimersByTime(40_000);
    expect(h.state().cutscene).toBeNull();
    h.room.final(a, 0, 3);
    expect(h.state()).toMatchObject({ phase: 'results', cutscene: null });
    h.room.toFinal();
    expect(h.state().cutscene).toBeNull();
    expect(h.room.startCutscene('joker')).toEqual({ ok: true });
  });

  it('fires each automatic cutscene once per competition, unless repeat', () => {
    const h = makeRoom({ cutscenes: [before, { ...after, repeat: true }, { ...final, enabled: false }] });
    const a = h.join('a');
    h.room.start('ninja');
    expect(h.state().cutscene?.id).toBe('pre');
    h.room.endCutscene();
    h.toPlaying();
    h.room.final(a, 0, 3);
    expect(h.state().cutscene?.id).toBe('post');
    h.room.endCutscene();

    h.room.start('ninja');
    expect(h.state().cutscene).toBeNull();
    h.toPlaying();
    h.room.final(a, 1, 3);
    expect(h.state().cutscene?.id).toBe('post');
    h.room.endCutscene();
    // enabled: false never fires automatically, but the host can still play it.
    h.room.toFinal();
    expect(h.state().cutscene).toBeNull();
    expect(h.room.startCutscene('fin')).toEqual({ ok: true });
  });

  it('a manual play does not use up the automatic trigger', () => {
    const h = makeRoom({ cutscenes: all });
    h.join('a');
    h.room.startCutscene('pre');
    h.room.endCutscene();
    h.room.start('ninja');
    expect(h.state().cutscene?.id).toBe('pre');
  });

  it('fires nothing automatic while no host is connected', () => {
    const h = makeRoom({ cutscenes: all, host: false });
    h.join('a');
    h.room.start('ninja');
    expect(h.state().cutscene).toBeNull();
    // The TV comes back: later triggers work again.
    h.room.attachHost('tv');
    h.room.endRound();
    h.room.toFinal();
    expect(h.state().cutscene?.id).toBe('fin');
  });
});

describe('registry and config', () => {
  const sinkFor = (): RoomSink => ({ state: () => {}, scores: () => {}, kicked: () => {} });

  it('makes room codes without lookalike letters', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[IOL]/);
    for (let i = 0; i < 200; i++) expect(randomRoomCode()).toMatch(/^[A-HJKMNP-Z]{4}$/);
    expect(normalizeRoomCode(' abcd ')).toBe('ABCD');
    expect(normalizeRoomCode('abc')).toBeNull();
    expect(normalizeRoomCode(1234)).toBeNull();
  });

  it('finds rooms case-insensitively and drops idle ones', () => {
    const registry = new RoomRegistry({ sinkFor });
    const room = registry.create();
    if (room === null) throw new Error('no room');
    expect(registry.get(room.code.toLowerCase())).toBe(room);
    expect(registry.get({})).toBeUndefined();
    room.join('c1', { name: 'a' });
    expect(registry.stats()).toEqual({ rooms: 1, players: 1 });

    vi.advanceTimersByTime(10_000);
    expect(registry.sweep(5_000)).toBe(0); // someone is attached
    room.disconnect('c1');
    vi.advanceTimersByTime(4_999);
    expect(registry.sweep(5_000)).toBe(0);
    vi.advanceTimersByTime(1);
    expect(registry.sweep(5_000)).toBe(1);
    expect(registry.get(room.code)).toBeUndefined();
  });

  it('reads the test timing from the environment', () => {
    const normal = timingFromEnv({});
    expect([normal.introMs, normal.countdownMs, normal.durationMs('icy')]).toEqual([INTRO_MS, COUNTDOWN_MS, GAMES.icy.durationMs]);
    const fast = timingFromEnv({ PARTY_TEST_FAST: '1' });
    expect([fast.introMs, fast.countdownMs, fast.durationMs('icy')]).toEqual([1_500, 1_500, 12_000]);
    const custom = timingFromEnv({ PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '4000' });
    expect(custom.durationMs('plotzel')).toBe(4_000);
  });
});
