/**
 * No ties, anywhere: the strict round order (raw, then who reached the score
 * first, then join order), exactly one round winner, distinct round points,
 * distinct totals and strict overall ranks, as the room applies them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FINAL_GRACE_MS, GAMES, SCORE_BROADCAST_INTERVAL_MS } from '../../shared/protocol';
import { Room } from '../../server/room';

import type { ResultRow, RoomState, RoundResults } from '../../shared/protocol';
import type { RoomSink, ScoresMessage } from '../../server/room';

const T0 = 1_800_000_000_000;

interface Harness {
  readonly room: Room;
  readonly scores: ScoresMessage[];
  state(): RoomState;
  results(): RoundResults;
  row(id: string): ResultRow;
  join(name: string): string;
  /** Starts a round and advances to the first ms of `playing`; returns the round index. */
  play(gameId?: 'tap' | 'flappy' | 'ninja' | 'icy' | 'plotzel'): number;
  /** Lets the round run out. */
  finish(): void;
}

function makeRoom(): Harness {
  const scores: ScoresMessage[] = [];
  const sink: RoomSink = { state: () => undefined, scores: (m) => scores.push(m), kicked: () => undefined };
  let n = 0;
  const room = new Room('ABCD', 'host-key', { sink, cutscenes: [], token: () => `tok${++n}`, seed: () => 1 });
  room.attachHost('host-conn');
  const h: Harness = {
    room,
    scores,
    state: () => room.snapshot(),
    results: () => {
      const r = room.snapshot().results;
      if (r === null) throw new Error('no results');
      return r;
    },
    row: (id) => {
      const row = h.results().rows.find((r) => r.playerId === id);
      if (row === undefined) throw new Error(`no row for ${id}`);
      return row;
    },
    join: (name) => {
      const res = room.join(`c-${name}`, { name });
      if (!res.ok) throw new Error(`join failed: ${res.error}`);
      return res.playerId;
    },
    play: (gameId = 'flappy') => {
      expect(room.start(gameId)).toEqual({ ok: true });
      const r = room.snapshot().round;
      if (r === null) throw new Error('no round');
      vi.advanceTimersByTime(Math.max(0, r.startAt - Date.now()));
      expect(room.snapshot().phase).toBe('playing');
      return r.index;
    },
    finish: () => {
      if (room.snapshot().phase === 'playing') vi.advanceTimersByTime(GAMES.plotzel.durationMs + FINAL_GRACE_MS + 60_000);
      expect(room.snapshot().phase).toBe('results');
    },
  };
  return h;
}

function expectStrict(state: RoomState): void {
  const n = state.players.length;
  const oneToN = Array.from({ length: n }, (_, i) => i + 1);
  expect(state.players.map((p) => p.rank).sort((a, b) => a - b)).toEqual(oneToN);
  const byRank = [...state.players].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < n; i++) expect(byRank[i]!.total).toBeLessThanOrEqual(byRank[i - 1]!.total);
  const res = state.results;
  if (res === null) return;
  expect(res.rows.map((r) => r.rank)).toEqual(Array.from({ length: res.rows.length }, (_, i) => i + 1));
  expect(res.rows.map((r) => r.roundRank).sort((a, b) => a - b)).toEqual(Array.from({ length: res.rows.length }, (_, i) => i + 1));
  const scorers = [...res.rows].filter((r) => r.raw > 0).sort((a, b) => a.roundRank - b.roundRank);
  for (let i = 1; i < scorers.length; i++) {
    expect(scorers[i]!.raw).toBeLessThanOrEqual(scorers[i - 1]!.raw);
    expect(scorers[i]!.points).toBeLessThan(scorers[i - 1]!.points);
  }
  expect(res.winnerIds).toEqual(scorers.length > 0 ? [scorers[0]!.playerId] : []);
  for (const r of res.rows) {
    expect(state.players.find((p) => p.id === r.playerId)?.rank).toBe(r.rank);
    expect(r.reachedAt === null).toBe(r.raw <= 0);
    if (r.raw <= 0) expect(r.points).toBe(0);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the strict round order', () => {
  it('four phones on the same raw score: one winner, the order they got there, four different points', () => {
    const h = makeRoom();
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => h.join(n)) as [string, string, string, string];
    const i = h.play('flappy');
    const t = Date.now();
    h.room.score(c, i, 6);
    vi.advanceTimersByTime(1_000);
    h.room.score(a, i, 6);
    vi.advanceTimersByTime(1_000);
    h.room.score(d, i, 6);
    vi.advanceTimersByTime(1_000);
    h.room.score(b, i, 6);
    h.finish();
    const res = h.results();
    expect(res.winnerIds).toEqual([c]);
    expect([c, a, d, b].map((id) => [h.row(id).roundRank, h.row(id).points, h.row(id).reachedAt])).toEqual([
      [1, 1100, t],
      [2, 1060, t + 1_000],
      [3, 1030, t + 2_000],
      [4, 1000, t + 3_000],
    ]);
    expect(res.rows.map((r) => r.playerId)).toEqual([c, a, d, b]);
    expectStrict(h.state());
  });

  it('the same raw score in the same millisecond: whoever joined first is ahead', () => {
    const h = makeRoom();
    const first = h.join('first');
    const second = h.join('second');
    const third = h.join('third');
    const i = h.play();
    h.room.score(third, i, 4);
    h.room.score(second, i, 4);
    h.room.score(first, i, 4);
    h.finish();
    expect([first, second, third].map((id) => h.row(id).roundRank)).toEqual([1, 2, 3]);
    expect(new Set([first, second, third].map((id) => h.row(id).reachedAt)).size).toBe(1);
    expect(h.results().winnerIds).toEqual([first]);
    expectStrict(h.state());
  });

  it('a score that went down and came back up counts from the moment it came back (ninja loses points)', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const i = h.play('ninja');
    h.room.score(a, i, 50); // a is on 50 first...
    vi.advanceTimersByTime(1_000);
    h.room.score(b, i, 50);
    vi.advanceTimersByTime(1_000);
    h.room.score(a, i, 30); // ...hits a bomb...
    vi.advanceTimersByTime(1_000);
    const back = Date.now();
    h.room.score(a, i, 50); // ...and gets back to 50 after b
    h.finish();
    expect(h.row(a).reachedAt).toBe(back);
    expect(h.results().winnerIds).toEqual([b]);
    expect([h.row(b).roundRank, h.row(a).roundRank]).toEqual([1, 2]);
  });

  it('a final that confirms the live score keeps the stamp; a final with another value moves it', () => {
    const h = makeRoom();
    const keep = h.join('keep');
    const move = h.join('move');
    const mid = h.join('mid');
    const i = h.play();
    const t = Date.now();
    h.room.score(keep, i, 7);
    h.room.score(move, i, 6);
    vi.advanceTimersByTime(2_000);
    h.room.score(mid, i, 7);
    vi.advanceTimersByTime(2_000);
    h.room.final(keep, i, 7); // same value, 4s later
    h.room.final(move, i, 7); // one more pipe on the last frame: reached 7 only now
    h.room.final(mid, i, 7);
    expect(h.state().phase).toBe('results');
    expect(h.row(keep).reachedAt).toBe(t);
    expect(h.row(mid).reachedAt).toBe(t + 2_000);
    expect(h.row(move).reachedAt).toBe(t + 4_000);
    expect([keep, mid, move].map((id) => h.row(id).roundRank)).toEqual([1, 2, 3]);
    expect(h.results().winnerIds).toEqual([keep]);
  });

  it('a repeated live score, a duplicate final and a live score after the final never move the stamp', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const i = h.play();
    const t = Date.now();
    h.room.score(a, i, 5);
    vi.advanceTimersByTime(500);
    h.room.score(a, i, 5);
    h.room.final(a, i, 5);
    vi.advanceTimersByTime(500);
    h.room.final(a, i, 9);
    h.room.score(a, i, 9);
    h.room.final(b, i, 5);
    expect(h.row(a)).toMatchObject({ raw: 5, reachedAt: t, roundRank: 1 });
    expect(h.row(b)).toMatchObject({ raw: 5, reachedAt: t + 1_000, roundRank: 2 });
  });

  it('a final without any live score is stamped when it arrives; a zero is never stamped', () => {
    const h = makeRoom();
    const a = h.join('a');
    const z = h.join('z');
    const i = h.play();
    h.room.score(z, i, 0);
    vi.advanceTimersByTime(700);
    const t = Date.now();
    h.room.final(a, i, 3);
    h.room.final(z, i, 0);
    expect(h.row(a).reachedAt).toBe(t);
    expect(h.row(z)).toMatchObject({ raw: 0, points: 0, reachedAt: null, roundRank: 2 });
  });

  it('nobody scored: no winner, no points, positions and ranks follow the join order', () => {
    const h = makeRoom();
    const ids = ['a', 'b', 'c'].map((n) => h.join(n));
    h.play();
    h.finish();
    const res = h.results();
    expect(res.winnerIds).toEqual([]);
    expect(res.rows.map((r) => [r.playerId, r.roundRank, r.rank, r.points, r.reachedAt])).toEqual(ids.map((id, i) => [id, i + 1, i + 1, 0, null]));
    expectStrict(h.state());
  });

  it('one player alone is the one winner', () => {
    const h = makeRoom();
    const a = h.join('solo');
    const i = h.play();
    h.room.final(a, i, 1);
    expect(h.results()).toMatchObject({ winnerIds: [a], rows: [{ points: 1100, roundRank: 1, rank: 1 }] });
    expect(h.state().players[0]?.rank).toBe(1);
  });

  it('a player who disconnects keeps the stamp and the place', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const i = h.play();
    const t = Date.now();
    h.room.score(a, i, 8);
    h.room.disconnect('c-a');
    vi.advanceTimersByTime(3_000);
    h.room.score(b, i, 8);
    h.finish();
    expect(h.row(a)).toMatchObject({ raw: 8, reachedAt: t, roundRank: 1, points: 1100 });
    expect(h.row(b)).toMatchObject({ raw: 8, roundRank: 2, points: 1060 });
    expect(h.results().winnerIds).toEqual([a]);
    expect(h.state().players.find((p) => p.id === a)).toMatchObject({ connected: false, rank: 1 });
  });

  it('a player kicked mid-round leaves no stamp behind; the others close up', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const c = h.join('c');
    const i = h.play();
    h.room.score(a, i, 6);
    vi.advanceTimersByTime(100);
    h.room.score(b, i, 6);
    vi.advanceTimersByTime(100);
    h.room.score(c, i, 6);
    h.room.kick(a);
    h.finish();
    const res = h.results();
    expect(res.rows.map((r) => [r.playerId, r.roundRank, r.rank, r.points])).toEqual([
      [b, 1, 1, 1100],
      [c, 2, 2, 1060],
    ]);
    expect(res.winnerIds).toEqual([b]);
    expectStrict(h.state());
  });

  it('kicking the round winner in the results passes the win to the next scorer; kicking the only scorer leaves no winner', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const c = h.join('c');
    const i = h.play();
    h.room.final(a, i, 6);
    vi.advanceTimersByTime(10);
    h.room.final(b, i, 6);
    h.room.final(c, i, 0);
    expect(h.results().winnerIds).toEqual([a]);
    h.room.kick(a);
    expect(h.results().winnerIds).toEqual([b]);
    expect(h.results().rows.map((r) => [r.playerId, r.roundRank, r.rank])).toEqual([
      [b, 1, 1],
      [c, 2, 2],
    ]);
    expectStrict(h.state());
    h.room.kick(b);
    expect(h.results().winnerIds).toEqual([]);
    expect(h.results().rows.map((r) => [r.playerId, r.roundRank, r.rank])).toEqual([[c, 1, 1]]);
    expectStrict(h.state());
  });

  it('a late joiner is listed last in the round, gets no stamp, and plays the next round like anyone else', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const i = h.play();
    const late = h.join('late');
    h.room.score(late, i, 99);
    h.room.final(a, i, 0);
    h.room.final(b, i, 4);
    expect(h.row(late)).toMatchObject({ raw: 0, points: 0, reachedAt: null, roundRank: 3, rank: 3, prevRank: null });
    expect(h.row(a)).toMatchObject({ roundRank: 2, rank: 2 });
    expectStrict(h.state());
    const j = h.play();
    h.room.final(late, j, 5);
    vi.advanceTimersByTime(5);
    h.room.final(a, j, 5);
    h.room.final(b, j, 5);
    expect([late, a, b].map((id) => h.row(id).roundRank)).toEqual([1, 2, 3]);
    expect(h.results().winnerIds).toEqual([late]);
    expectStrict(h.state());
  });
});

describe('the live scores broadcast', () => {
  it('is sorted in the strict order: equal live scores keep the earlier one first, zeros last by join order', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const c = h.join('c');
    const d = h.join('d');
    const i = h.play('ninja');
    h.room.score(c, i, 20);
    vi.advanceTimersByTime(SCORE_BROADCAST_INTERVAL_MS);
    expect(h.scores.at(-1)?.scores).toEqual([
      [c, 20],
      [a, 0],
      [b, 0],
      [d, 0],
    ]);
    h.room.score(b, i, 20); // same score, later: stays behind c
    h.room.score(d, i, 35);
    vi.advanceTimersByTime(SCORE_BROADCAST_INTERVAL_MS);
    expect(h.scores.at(-1)?.scores).toEqual([
      [d, 35],
      [c, 20],
      [b, 20],
      [a, 0],
    ]);
    h.room.score(c, i, 10); // c drops and comes back to 20: now b was there first
    vi.advanceTimersByTime(SCORE_BROADCAST_INTERVAL_MS);
    h.room.score(c, i, 20);
    h.room.score(a, i, 20);
    vi.advanceTimersByTime(SCORE_BROADCAST_INTERVAL_MS);
    expect(h.scores.at(-1)?.scores).toEqual([
      [d, 35],
      [b, 20],
      [a, 20], // same millisecond as c: a joined first
      [c, 20],
    ]);
  });

  it('the order at the end of the round is the order of the results', () => {
    const h = makeRoom();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => h.join(n));
    const i = h.play('flappy');
    const plan: Array<[number, number, number]> = [
      [3, 2, 0], [0, 2, 0], [5, 1, 100], [1, 3, 100], [4, 2, 300], [0, 3, 400], [2, 3, 400], [3, 3, 900], [5, 3, 900],
    ];
    let at = 0;
    for (const [who, score, t] of plan) {
      vi.advanceTimersByTime(t - at);
      at = t;
      h.room.score(ids[who]!, i, score);
    }
    vi.advanceTimersByTime(1);
    h.room.final(ids[4]!, i, 3); // a last-frame final with a new value
    h.finish();
    const last = h.scores.filter((m) => m.round === i).at(-1);
    const byRound = [...h.results().rows].sort((x, y) => x.roundRank - y.roundRank);
    expect(last?.scores).toEqual(byRound.map((r) => [r.playerId, r.raw]));
    // b first to 3; then a and c in the same ms (a joined first); then d and f; e last.
    expect(byRound.map((r) => r.playerId)).toEqual([ids[1], ids[0], ids[2], ids[3], ids[5], ids[4]]);
    expect(h.results().winnerIds).toEqual([ids[1]]);
  });
});

describe('strict overall ranks', () => {
  it('A: 1100 + 560 and B: 560 + 1100 do not end level: totals differ and the ranks are 1 and 2', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    let i = h.play();
    h.room.final(a, i, 100);
    h.room.final(b, i, 50);
    i = h.play();
    h.room.final(a, i, 50);
    h.room.final(b, i, 100);
    expect(h.row(b)).toMatchObject({ points: 1100, total: 1660, rank: 1, prevRank: 2 });
    expect(h.row(a)).toMatchObject({ points: 559, total: 1659, rank: 2, prevRank: 1 });
    expectStrict(h.state());
  });

  it('identical raw scores in every round of a competition never leave two players on the same total', () => {
    const h = makeRoom();
    const ids = Array.from({ length: 12 }, (_, k) => h.join(`p${k}`));
    for (let round = 0; round < 5; round++) {
      const i = h.play(round % 2 === 0 ? 'flappy' : 'ninja');
      // everyone ends on 6, in a different order every round
      ids.forEach((_, k) => {
        vi.advanceTimersByTime(50);
        h.room.final(ids[(k * (round + 1) + round) % ids.length]!, i, 6);
      });
      h.finish();
      const totals = h.state().players.map((p) => p.total);
      expect(new Set(totals).size).toBe(totals.length);
      expect(h.results().winnerIds).toHaveLength(1);
      expectStrict(h.state());
    }
  });

  it('players who never scored share the total 0 but not a rank: last round position, then join order', () => {
    const h = makeRoom();
    const a = h.join('a');
    const z1 = h.join('z1');
    const z2 = h.join('z2');
    const i = h.play();
    h.room.final(a, i, 2);
    h.finish();
    expect(h.state().players.map((p) => [p.id, p.total, p.rank])).toEqual([
      [a, 1100, 1],
      [z1, 0, 2],
      [z2, 0, 3],
    ]);
    const late = h.join('late'); // was not in that round at all: behind those who were
    expect(h.state().players.map((p) => [p.id, p.rank])).toEqual([
      [a, 1],
      [z1, 2],
      [z2, 3],
      [late, 4],
    ]);
  });

  it('PlayerPublic.rank is a permutation of 1..n in every phase, from an empty lobby to the final', () => {
    const h = makeRoom();
    expect(h.state().players).toEqual([]);
    const ids = ['a', 'b', 'c', 'd', 'e'].map((n) => h.join(n));
    expect(h.state().players.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]); // lobby: join order
    const i = h.play();
    expectStrict(h.state());
    h.room.score(ids[4]!, i, 3);
    expect(h.state().players.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]); // live scores do not move overall ranks
    vi.advanceTimersByTime(20);
    h.room.final(ids[4]!, i, 3); // confirms the live 3
    h.room.final(ids[2]!, i, 3); // reached 3 later
    h.finish();
    expectStrict(h.state());
    expect(h.state().players.map((p) => p.rank)).toEqual([3, 4, 2, 5, 1]);
    h.room.kick(ids[2]!);
    expectStrict(h.state());
    h.room.toFinal();
    expectStrict(h.state());
    expect(h.state().players.map((p) => p.rank)).toEqual([2, 3, 4, 1]);
    h.room.toLobby();
    h.join('new');
    expectStrict(h.state());
  });

  it('reset clears totals, wins, stamps and the previous order: the next competition starts from the join order', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const c = h.join('c');
    let i = h.play();
    h.room.final(c, i, 9);
    vi.advanceTimersByTime(5);
    h.room.final(b, i, 9);
    h.room.final(a, i, 1);
    expect(h.state().players.map((p) => p.rank)).toEqual([3, 2, 1]);
    i = h.play();
    h.room.score(c, i, 4);
    h.room.reset();
    expect(h.state().results).toBeNull();
    expect(h.state().players.map((p) => [p.id, p.total, p.rank])).toEqual([
      [a, 0, 1],
      [b, 0, 2],
      [c, 0, 3],
    ]);
    // Same raw for everyone, same millisecond: nothing of the old competition (c's win, c's stamp) is left.
    i = h.play();
    expect(i).toBeGreaterThan(0); // round ids are not reused after a reset
    h.room.final(a, i, 4);
    h.room.final(b, i, 4);
    h.room.final(c, i, 4);
    expect(h.results().rows.map((r) => [r.playerId, r.roundRank, r.rank, r.prevRank, r.points])).toEqual([
      [a, 1, 1, null, 1100],
      [b, 2, 2, null, 1060],
      [c, 3, 3, null, 1030],
    ]);
  });
});
