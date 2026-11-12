/**
 * The elimination round (flappy: last one standing) on the server: the active count, the
 * finale trigger, the end rules, the survival order and "never a second life".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ELIMINATION_END_DELAY_MS,
  FINAL_GRACE_MS,
  FINALE_LATEST_MS,
  FINALE_LEAD_MS,
  FINALE_SMALL_FIELD_MS,
  GAME_IDS,
  GAMES,
  RESUME_COUNTDOWN_MS,
} from '../../shared/protocol';
import { roundTime } from '../../shared/round-clock';
import { DISCONNECT_END_GRACE_MS, Room } from '../../server/room';

import type { CutsceneDef } from '../../shared/cutscenes';
import type { RoomState, RoundPublic, RoundResults } from '../../shared/protocol';
import type { RoomSink, ScoresMessage } from '../../server/room';

const T0 = 1_800_000_000_000;
const CAP = GAMES.flappy.durationMs;
const joker: CutsceneDef = { id: 'joker', title: 'j', file: 'j.mp4', when: { at: 'manual' } };

interface Harness {
  readonly room: Room;
  readonly states: RoomState[];
  readonly scores: ScoresMessage[];
  readonly errors: unknown[];
  readonly ids: string[];
  state(): RoomState;
  round(): RoundPublic;
  results(): RoundResults;
  join(name: string): string;
  /** Starts flappy (or `gameId`) and advances to the first ms of `playing`. */
  play(gameId?: (typeof GAME_IDS)[number]): void;
  elapsed(): number;
  /** The latest `scores` message (after flushing the throttle). */
  last(): ScoresMessage;
  /** Player `i` crashes now: sends its final with the distance flown so far (tenths of a unit at 30 units/s). */
  crash(i: number): number;
  /** Every player still in sends a live score for the current moment. */
  tick(): void;
}

function rawAt(elapsedMs: number): number {
  return Math.max(1, Math.round((elapsedMs / 1000) * 30 * 10));
}

function makeRoom(n: number): Harness {
  const states: RoomState[] = [];
  const scores: ScoresMessage[] = [];
  const errors: unknown[] = [];
  const sink: RoomSink = { state: (s) => states.push(s), scores: (m) => scores.push(m), kicked: () => undefined };
  let k = 0;
  const room = new Room('ABCD', 'host-key', { sink, cutscenes: [joker], token: () => `tok${++k}`, seed: () => 0xbeef, onError: (e) => errors.push(e) });
  room.attachHost('host-conn');
  const ids: string[] = [];
  const out = new Set<number>();
  const h: Harness = {
    room,
    states,
    scores,
    errors,
    ids,
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
      ids.push(res.playerId);
      return res.playerId;
    },
    play: (gameId = 'flappy') => {
      expect(room.start(gameId)).toEqual({ ok: true });
      vi.advanceTimersByTime(Math.max(0, h.round().startAt - Date.now()));
      expect(room.snapshot().phase).toBe('playing');
    },
    elapsed: () => roundTime(h.round(), Date.now()).elapsedMs,
    last: () => {
      vi.advanceTimersByTime(300);
      const m = scores.at(-1);
      if (m === undefined) throw new Error('no scores message');
      return m;
    },
    crash: (i) => {
      const raw = rawAt(h.elapsed());
      out.add(i);
      expect(room.final(ids[i] ?? '', h.round().index, raw)).toEqual({ ok: true });
      return raw;
    },
    tick: () => {
      const raw = rawAt(h.elapsed());
      ids.forEach((id, i) => {
        if (!out.has(i)) room.score(id, h.round().index, raw);
      });
    },
  };
  for (let i = 0; i < n; i++) h.join(`p${i}`);
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the protocol', () => {
  it('flappy is the one elimination game; its cap leaves room for the latest finale', () => {
    expect(GAME_IDS.filter((g) => GAMES[g].mode === 'elimination')).toEqual(['flappy']);
    for (const g of GAME_IDS) if (g !== 'flappy') expect(GAMES[g].mode).toBe('score');
    expect(CAP).toBeGreaterThanOrEqual(FINALE_LATEST_MS + 27_000);
    // 60 units/s for the whole cap, in tenths of a unit
    expect(GAMES.flappy.maxRaw).toBeGreaterThanOrEqual((CAP / 1000) * 60 * 10);
  });
});

describe('the active count', () => {
  it('is sent at GO and follows finals, kicks and late joiners', () => {
    const h = makeRoom(5);
    h.play();
    // everybody learns the head count at GO, before any score
    expect(h.last()).toMatchObject({ round: 0, active: 5, out: [] });
    expect(h.last().scores).toHaveLength(5);

    vi.advanceTimersByTime(2_000);
    h.tick();
    h.crash(4);
    expect(h.last()).toMatchObject({ active: 4, out: [h.ids[4]] });

    // a late joiner watches: not a participant, never counted
    const late = h.join('late');
    h.room.score(late, 0, 999);
    expect(h.room.final(late, 0, 999)).toMatchObject({ ok: false });
    h.tick();
    expect(h.last().active).toBe(4);
    expect(h.last().scores.map(([id]) => id)).not.toContain(late);

    // a kick removes the player from the round
    expect(h.room.kick(h.ids[3])).toEqual({ ok: true });
    h.tick();
    const m = h.last();
    expect(m.active).toBe(3);
    expect(m.scores.map(([id]) => id)).not.toContain(h.ids[3]);
    expect(m.out).toEqual([h.ids[4]]);
  });

  it('a disconnected phone stays active for the 5 s grace, then is out with the score it had', () => {
    const h = makeRoom(6);
    h.play();
    vi.advanceTimersByTime(3_000);
    h.tick();
    const had = rawAt(h.elapsed());
    h.room.disconnect('c-p5');
    vi.advanceTimersByTime(DISCONNECT_END_GRACE_MS - 400);
    expect(h.last().active).toBe(6); // inside the grace (the 300 ms of last() included)
    vi.advanceTimersByTime(400);
    const m = h.last();
    expect(m.active).toBe(5);
    expect(m.out).toEqual([h.ids[5]]);
    expect(m.scores.find(([id]) => id === h.ids[5])?.[1]).toBe(had);

    // it comes back later: still out, nothing it sends counts
    expect(h.room.join('c-p5-again', { name: 'p5', playerId: h.ids[5], secret: 'tok12' }).ok).toBe(true);
    h.room.score(h.ids[5] ?? '', 0, 99_999);
    expect(h.room.final(h.ids[5] ?? '', 0, 99_999)).toEqual({ ok: true }); // acked, ignored
    const after = h.last();
    expect(after.active).toBe(5);
    expect(after.scores.find(([id]) => id === h.ids[5])?.[1]).toBe(had);
  });

  it('a phone that returns inside the grace keeps flying', () => {
    const h = makeRoom(6);
    h.play();
    vi.advanceTimersByTime(3_000);
    h.room.disconnect('c-p5');
    vi.advanceTimersByTime(3_000);
    expect(h.room.join('c-p5-b', { name: 'p5', playerId: h.ids[5], secret: 'tok12' }).ok).toBe(true);
    vi.advanceTimersByTime(10_000);
    h.tick();
    const m = h.last();
    expect(m.active).toBe(6);
    expect(m.out).toEqual([]);
    expect(m.scores.find(([id]) => id === h.ids[5])?.[1]).toBe(rawAt(h.elapsed() - 300));
  });

  it('a phone that was away when the round began gets the same grace from GO, and is not counted in the field', () => {
    const h = makeRoom(4);
    h.room.disconnect('c-p3');
    h.play();
    expect(h.last().active).toBe(4);
    vi.advanceTimersByTime(DISCONNECT_END_GRACE_MS);
    const m = h.last();
    expect(m.active).toBe(3);
    expect(m.out).toEqual([h.ids[3]]);
    // the field was 3 connected players: the finale waits for 2 left
    expect(h.round().finale).toBeNull();
    h.crash(2);
    expect(h.round().finale).not.toBeNull();
  });

  it('the grace does not run out during a cutscene: it starts again when the round continues', () => {
    const h = makeRoom(6);
    h.play();
    vi.advanceTimersByTime(2_000);
    expect(h.room.startCutscene('joker')).toEqual({ ok: true });
    h.room.disconnect('c-p5');
    vi.advanceTimersByTime(30_000);
    expect(h.room.endCutscene()).toEqual({ ok: true });
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS + DISCONNECT_END_GRACE_MS - 500);
    h.tick();
    expect(h.last().active).toBe(6);
    vi.advanceTimersByTime(600);
    h.tick();
    expect(h.last()).toMatchObject({ active: 5, out: [h.ids[5]] });
  });

  it('score games get `active` and `out` too', () => {
    const h = makeRoom(3);
    h.play('tap');
    h.room.score(h.ids[0] ?? '', 0, 5);
    expect(h.last()).toMatchObject({ active: 3, out: [] });
    h.room.final(h.ids[1] ?? '', 0, 9);
    expect(h.last()).toMatchObject({ active: 2, out: [h.ids[1]] });
  });
});

describe('the finale trigger', () => {
  /** Crashes players one every second (the last index first) and returns what the finale was after each crash. */
  function run(n: number): Array<{ left: number; finale: number | null; at: number }> {
    const h = makeRoom(n);
    h.play();
    const seen: Array<{ left: number; finale: number | null; at: number }> = [];
    for (let i = n - 1; i >= 1; i--) {
      vi.advanceTimersByTime(1_000);
      h.tick();
      if (h.state().phase !== 'playing') break;
      const at = h.elapsed();
      h.crash(i);
      seen.push({ left: i, finale: h.state().round?.finale?.atElapsedMs ?? null, at });
    }
    expect(h.errors).toEqual([]);
    return seen;
  }

  it.each([
    [3, 2],
    [4, 3],
    [5, 3],
    [12, 3],
    [60, 3],
  ])('%i participants: set exactly once, when %i are left, as that moment + 3 s of round time', (n, threshold) => {
    const seen = run(n);
    const before = seen.filter((s) => s.left > threshold);
    expect(before.every((s) => s.finale === null)).toBe(true);
    const at = seen.find((s) => s.left === threshold);
    expect(at?.finale).toBe((at?.at ?? 0) + FINALE_LEAD_MS);
    // never changed afterwards
    for (const s of seen.filter((x) => x.left <= threshold)) expect(s.finale).toBe(at?.finale);
  });

  it.each([1, 2])('%i participant(s): a fixed 20 s of round time, known from GO', (n) => {
    const h = makeRoom(n);
    h.play();
    expect(h.round().finale).toEqual({ atElapsedMs: FINALE_SMALL_FIELD_MS });
    vi.advanceTimersByTime(25_000);
    h.tick();
    expect(h.state().phase).toBe('playing');
    expect(h.round().finale).toEqual({ atElapsedMs: FINALE_SMALL_FIELD_MS });
  });

  it('is broadcast in the state the moment it is set, and only for elimination rounds', () => {
    const h = makeRoom(5);
    h.play();
    vi.advanceTimersByTime(4_000);
    h.crash(4);
    expect(h.states.at(-1)?.round?.finale).toBeNull();
    const before = h.states.length;
    h.crash(3);
    expect(h.states.length).toBe(before + 1);
    expect(h.states.at(-1)?.round?.finale).toEqual({ atElapsedMs: 4_000 + FINALE_LEAD_MS });
  });

  it('however many are left, it begins at 60 s of round time at the latest', () => {
    const h = makeRoom(8);
    h.play();
    vi.advanceTimersByTime(FINALE_LATEST_MS - FINALE_LEAD_MS - 1);
    expect(h.round().finale).toBeNull();
    vi.advanceTimersByTime(1);
    expect(h.round().finale).toEqual({ atElapsedMs: FINALE_LATEST_MS });
  });

  it('a cutscene freeze before it shifts nothing: it is round time', () => {
    const h = makeRoom(6);
    h.play();
    vi.advanceTimersByTime(5_000);
    expect(h.room.startCutscene('joker')).toEqual({ ok: true });
    vi.advanceTimersByTime(41_000);
    h.room.endCutscene();
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS + 2_000);
    expect(h.elapsed()).toBe(7_000);
    h.crash(5);
    h.crash(4);
    h.crash(3);
    expect(h.round().finale).toEqual({ atElapsedMs: 7_000 + FINALE_LEAD_MS });
    // and the "latest" timer follows the shifted clock too
    const g = makeRoom(8);
    g.play();
    vi.advanceTimersByTime(20_000);
    g.room.startCutscene('joker');
    vi.advanceTimersByTime(60_000);
    expect(g.round().finale).toBeNull();
    g.room.endCutscene();
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS + FINALE_LATEST_MS - FINALE_LEAD_MS - 20_000 - 1);
    expect(g.round().finale).toBeNull();
    vi.advanceTimersByTime(1);
    expect(g.round().finale).toEqual({ atElapsedMs: FINALE_LATEST_MS });
    expect([...h.errors, ...g.errors]).toEqual([]);
  });

  it('a cutscene freeze after it is set (before or during the finale) shifts nothing', () => {
    const h = makeRoom(5);
    h.play();
    vi.advanceTimersByTime(6_000);
    h.crash(4);
    h.crash(3);
    const finale = h.round().finale;
    expect(finale).toEqual({ atElapsedMs: 9_000 });
    // freeze during the 3-2-1
    vi.advanceTimersByTime(1_000);
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(20_000);
    expect(h.elapsed()).toBe(7_000);
    h.room.endCutscene();
    expect(h.round().finale).toEqual(finale);
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS);
    expect(h.elapsed()).toBe(7_000);
    // freeze again during the finale itself
    vi.advanceTimersByTime(5_000);
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(33_000);
    h.room.endCutscene();
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS);
    expect(h.elapsed()).toBe(12_000);
    expect(h.round().finale).toEqual(finale);
    expect(h.state().phase).toBe('playing');
    expect(h.errors).toEqual([]);
  });
});

describe('the end of the round', () => {
  it('ends 1.5 s after one is left; the last one standing is the single winner and the others are in elimination order', () => {
    const h = makeRoom(5);
    h.play();
    const order: string[] = [];
    for (const i of [2, 4, 1, 3]) {
      vi.advanceTimersByTime(1_700);
      h.tick();
      h.crash(i);
      order.unshift(h.ids[i] ?? '');
    }
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(ELIMINATION_END_DELAY_MS - 1);
    h.tick(); // the winner's victory lap
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(1);
    expect(h.state().phase).toBe('results');
    const res = h.results();
    expect(res.winnerIds).toEqual([h.ids[0]]);
    const byRound = [...res.rows].sort((a, b) => a.roundRank - b.roundRank).map((r) => r.playerId);
    expect(byRound).toEqual([h.ids[0], ...order]);
    expect(new Set(res.rows.map((r) => r.roundRank)).size).toBe(5);
    expect(new Set(res.rows.map((r) => r.points)).size).toBe(5);
    // the last `scores` message was already in that order
    expect(h.scores.at(-1)?.scores.map(([id]) => id)).toEqual(byRound);
  });

  it('the last one standing wins even when its phone reported nothing for a while', () => {
    const h = makeRoom(3);
    h.play();
    vi.advanceTimersByTime(2_000);
    h.room.score(h.ids[0] ?? '', 0, 10); // the survivor's last report, long ago
    vi.advanceTimersByTime(20_000);
    const a = h.crash(1);
    vi.advanceTimersByTime(900);
    const b = h.crash(2);
    vi.advanceTimersByTime(ELIMINATION_END_DELAY_MS);
    const rows = [...h.results().rows].sort((x, y) => x.roundRank - y.roundRank);
    expect(rows.map((r) => r.playerId)).toEqual([h.ids[0], h.ids[2], h.ids[1]]);
    expect(rows[0]?.raw).toBe(b + 1);
    expect(rows[2]?.raw).toBe(a);
    expect(h.results().winnerIds).toEqual([h.ids[0]]);
  });

  it('two crashes in the same obstacle gap: different distances, the later one is ahead; the same distance goes to who reported first', () => {
    const h = makeRoom(4);
    h.play();
    vi.advanceTimersByTime(8_000);
    h.tick();
    h.crash(3);
    vi.advanceTimersByTime(34); // two frames later, in the same gap
    h.crash(2);
    vi.advanceTimersByTime(250);
    h.tick();
    expect(h.last().scores.map(([id]) => id).slice(2)).toEqual([h.ids[2], h.ids[3]]);
    // the very same distance from two phones, one arriving 5 ms later
    vi.advanceTimersByTime(3_000);
    const raw = rawAt(h.elapsed());
    h.room.final(h.ids[1] ?? '', 0, raw);
    vi.advanceTimersByTime(5);
    h.room.final(h.ids[0] ?? '', 0, raw);
    vi.advanceTimersByTime(ELIMINATION_END_DELAY_MS);
    const res = h.results();
    expect(res.winnerIds).toEqual([h.ids[1]]);
    expect([...res.rows].sort((x, y) => x.roundRank - y.roundRank).map((r) => r.playerId)).toEqual([h.ids[1], h.ids[0], h.ids[2], h.ids[3]]);
  });

  it('a guest who never taps is simply out; everybody out ends the round 1.5 s later', () => {
    const h = makeRoom(2);
    h.play();
    vi.advanceTimersByTime(2_400);
    h.crash(1); // fell without a tap
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(600);
    h.crash(0); // the last one crashes during its victory lap
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(ELIMINATION_END_DELAY_MS - 600);
    expect(h.state().phase).toBe('results');
    expect(h.results().winnerIds).toEqual([h.ids[0]]);
  });

  it('a solo round runs until that player is out', () => {
    const h = makeRoom(1);
    h.play();
    vi.advanceTimersByTime(30_000);
    h.tick();
    expect(h.state().phase).toBe('playing');
    h.crash(0);
    vi.advanceTimersByTime(ELIMINATION_END_DELAY_MS);
    expect(h.state().phase).toBe('results');
    expect(h.results().winnerIds).toEqual([h.ids[0]]);
  });

  it('ends at the hard cap with several still in the air: they rank above everyone who is out, by the tie rule', () => {
    const h = makeRoom(6);
    h.play();
    vi.advanceTimersByTime(10_000);
    h.crash(5);
    for (let t = 10_000; t < CAP; t += 250) {
      vi.advanceTimersByTime(250);
      h.tick();
    }
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(FINAL_GRACE_MS);
    expect(h.state().phase).toBe('results');
    const res = h.results();
    expect(res.winnerIds).toHaveLength(1);
    const rows = [...res.rows].sort((x, y) => x.roundRank - y.roundRank);
    expect(rows.at(-1)?.playerId).toBe(h.ids[5]);
    expect(rows.map((r) => r.roundRank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ends when the host ends it; under a cutscene only when the video is over', () => {
    const h = makeRoom(5);
    h.play();
    vi.advanceTimersByTime(4_000);
    h.tick();
    h.crash(4);
    expect(h.room.endRound()).toEqual({ ok: true });
    expect(h.state().phase).toBe('results');
    expect(h.results().rows.find((r) => r.playerId === h.ids[4])?.roundRank).toBe(5);

    const g = makeRoom(3);
    g.play();
    vi.advanceTimersByTime(4_000);
    g.room.startCutscene('joker');
    g.crash(2);
    g.crash(1);
    vi.advanceTimersByTime(20_000);
    expect(g.state().phase).toBe('playing'); // never under a video
    g.room.endCutscene();
    vi.advanceTimersByTime(ELIMINATION_END_DELAY_MS);
    expect(g.state().phase).toBe('results');
    expect(g.results().winnerIds).toEqual([g.ids[0]]);
  });

  it('a kick that leaves one player ends the round too', () => {
    const h = makeRoom(3);
    h.play();
    vi.advanceTimersByTime(3_000);
    h.tick();
    h.crash(2);
    h.room.kick(h.ids[1]);
    vi.advanceTimersByTime(ELIMINATION_END_DELAY_MS);
    expect(h.state().phase).toBe('results');
    expect(h.results().winnerIds).toEqual([h.ids[0]]);
  });
});

describe('one life', () => {
  it('the first final stands: a second final, a later live score and a reload change nothing', () => {
    const h = makeRoom(4);
    h.play();
    vi.advanceTimersByTime(5_000);
    h.tick();
    const raw = h.crash(3);
    // the phone reloads, joins again as the same player and tries to fly on
    expect(h.room.join('c-p3-reloaded', { name: 'p3', playerId: h.ids[3], secret: 'tok8' }).ok).toBe(true);
    vi.advanceTimersByTime(4_000);
    h.room.score(h.ids[3] ?? '', 0, raw + 5_000);
    expect(h.room.final(h.ids[3] ?? '', 0, raw + 5_000)).toEqual({ ok: true });
    h.tick();
    const m = h.last();
    expect(m.out).toEqual([h.ids[3]]);
    expect(m.active).toBe(3);
    expect(m.scores.at(-1)).toEqual([h.ids[3], raw]);
  });
});

describe('the other four games', () => {
  it.each(GAME_IDS.filter((g) => g !== 'flappy'))('%s: no finale, and one player left does not end the round', (gameId) => {
    const h = makeRoom(4);
    h.play(gameId);
    expect(h.round().finale).toBeNull();
    vi.advanceTimersByTime(3_000);
    for (const i of [1, 2, 3]) h.room.final(h.ids[i] ?? '', 0, 10 + i);
    vi.advanceTimersByTime(ELIMINATION_END_DELAY_MS + 5_000);
    expect(h.state().phase).toBe('playing');
    expect(h.round().finale).toBeNull();
    expect(h.last()).toMatchObject({ active: 1 });
    // it still ends early once everybody is done, as before
    h.room.final(h.ids[0] ?? '', 0, 99);
    expect(h.state().phase).toBe('results');
    expect(h.results().winnerIds).toEqual([h.ids[0]]);
  });
});
