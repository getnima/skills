/**
 * QA pass on the room state machine: scoring truth against shared/scoring.ts
 * recomputed independently, reconnects, cutscenes on every clock edge, stale
 * timers and hostile input. Everything runs under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CUTSCENES } from '../../shared/cutscenes';
import {
  CUTSCENE_MAX_MS,
  FINAL_GRACE_MS,
  GAME_IDS,
  GAMES,
  MAX_PLAYERS,
  RESUME_COUNTDOWN_MS,
  WINNER_REVEAL_MS,
} from '../../shared/protocol';
import { roundTime } from '../../shared/round-clock';
import { computeRoundScores, MAX_ROUND_POINTS, PODIUM_BONUS } from '../../shared/scoring';
import { DISCONNECT_END_GRACE_MS, Room } from '../../server/room';
import { MAX_ROOMS, RoomRegistry } from '../../server/rooms';

import type { CutsceneDef } from '../../shared/cutscenes';
import type { GameId, Phase, RoomState, RoundResults } from '../../shared/protocol';
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
  results(): RoundResults;
  join(name: string): string;
  toPlaying(): void;
  left(): number;
  elapsed(): number;
}

function makeRoom(opts: { cutscenes?: readonly CutsceneDef[]; timing?: RoomTiming; host?: boolean } = {}): Harness {
  const states: RoomState[] = [];
  const scores: ScoresMessage[] = [];
  const kicked: string[][] = [];
  const errors: unknown[] = [];
  const sink: RoomSink = { state: (s) => states.push(s), scores: (m) => scores.push(m), kicked: (ids) => kicked.push([...ids]) };
  let n = 0;
  const room = new Room('ABCD', 'host-key', {
    sink,
    cutscenes: opts.cutscenes ?? [],
    timing: opts.timing,
    token: () => `tok${++n}`,
    seed: () => 7,
    onError: (err) => errors.push(err),
  });
  if (opts.host !== false) room.attachHost('host-conn');
  const round = (): NonNullable<RoomState['round']> => {
    const r = room.snapshot().round;
    if (r === null) throw new Error('no round');
    return r;
  };
  return {
    room,
    states,
    scores,
    kicked,
    errors,
    state: () => room.snapshot(),
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
      vi.advanceTimersByTime(Math.max(0, round().startAt - Date.now()));
      expect(room.snapshot().phase).toBe('playing');
    },
    left: () => roundTime(round(), Date.now()).leftMs,
    elapsed: () => roundTime(round(), Date.now()).elapsedMs,
  };
}

/** What one player did in a round, as the test knows it. */
interface Sent {
  readonly raw: number;
  /** Clock time at which the player's score last changed; null when they scored nothing. */
  readonly at: number | null;
  readonly join: number;
  /** Total before the round. */
  readonly before: number;
}

/**
 * Independent re-implementation of the documented rules (README "Scoring"), not a call into the server:
 * strict order (raw, then who reached it first, then join order), scaled points + podium bonus by strict
 * position, every scorer at least one point below the one above, and no new total equal to another total.
 */
function expectedRound(sent: ReadonlyMap<string, Sent>): Map<string, { points: number; roundRank: number }> {
  const isAhead = (x: Sent, y: Sent): boolean => {
    if (x.raw !== y.raw) return x.raw > y.raw;
    if (x.raw > 0 && x.at !== y.at) return (x.at ?? Infinity) < (y.at ?? Infinity);
    return x.join < y.join;
  };
  const byPos: Array<[string, Sent]> = [];
  for (const [id, me] of sent) {
    let ahead = 0;
    for (const [other, o] of sent) if (other !== id && isAhead(o, me)) ahead++;
    byPos[ahead] = [id, me];
  }
  const nScorers = byPos.filter(([, x]) => x.raw > 0).length;
  const best = byPos[0]?.[1].raw ?? 0;
  const takenTotals = new Set<number>();
  for (const [, x] of byPos) if (x.raw <= 0) takenTotals.add(x.before);
  const out = new Map<string, { points: number; roundRank: number }>();
  let above = Infinity;
  byPos.forEach(([id, x], pos) => {
    if (x.raw <= 0) {
      out.set(id, { points: 0, roundRank: pos + 1 });
      return;
    }
    const least = nScorers - pos; // room for everyone below to get a different positive number
    const plain = Math.round((MAX_ROUND_POINTS * x.raw) / best) + (PODIUM_BONUS[pos] ?? 0);
    let points = Math.min(above - 1, Math.max(plain, least));
    const candidates: number[] = [];
    for (let p = points; p >= least; p--) candidates.push(p);
    for (let p = points + 1; p <= Math.min(above - 1, points + nScorers); p++) candidates.push(p);
    points = candidates.find((p) => !takenTotals.has(x.before + p)) ?? points;
    takenTotals.add(x.before + points);
    above = points;
    out.set(id, { points, roundRank: pos + 1 });
  });
  return out;
}

interface Stat {
  total: number;
  wins: number;
  best: number;
  lastPos: number | null;
  readonly join: number;
}

/** Strict overall rank: total, round wins, best round, position in the last round, join order. */
function rankOf(stats: ReadonlyMap<string, Stat>, id: string): number {
  const me = stats.get(id);
  if (me === undefined) throw new Error('no stat');
  const key = (x: Stat): number[] => [-x.total, -x.wins, -x.best, x.lastPos ?? Number.MAX_SAFE_INTEGER, x.join];
  let better = 0;
  for (const [other, o] of stats) {
    if (other === id) continue;
    const a = key(o);
    const b = key(me);
    const i = a.findIndex((v, k) => v !== b[k]);
    if (i >= 0 && a[i]! < b[i]!) better++;
  }
  return better + 1;
}

/** Deterministic PRNG so a failure reproduces. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scoring truth', () => {
  it('matches an independent recomputation over 60 random competitions (ties, zeros, late joiners, kicks, drops)', () => {
    for (let comp = 0; comp < 60; comp++) {
      const rnd = mulberry32(1000 + comp);
      const h = makeRoom();
      const ids: string[] = [];
      const conn = new Map<string, string>();
      const nPlayers = 1 + Math.floor(rnd() * 12);
      for (let i = 0; i < nPlayers; i++) {
        const id = h.join(`p${comp}_${i}`);
        ids.push(id);
        conn.set(id, `c-p${comp}_${i}`);
      }
      let joins = 0;
      const totals = new Map<string, Stat>(ids.map((id) => [id, { total: 0, wins: 0, best: 0, lastPos: null, join: joins++ }]));
      const appeared = new Set<string>();
      const rounds = 1 + Math.floor(rnd() * 5);
      for (let r = 0; r < rounds; r++) {
        // score games only: an elimination round has its own rules (tests/unit/elimination.test.ts)
        const scoreGames = GAME_IDS.filter((g) => GAMES[g].mode === 'score');
        const gameId: GameId = scoreGames[Math.floor(rnd() * scoreGames.length)] ?? 'tap';
        const maxRaw = GAMES[gameId].maxRaw;
        expect(h.room.start(gameId)).toEqual({ ok: true });
        const participants = [...totals.keys()];
        h.toPlaying();

        // A late joiner in half the rounds: must be listed with 0 and must not score.
        let late: string | null = null;
        if (rnd() < 0.5 && totals.size < MAX_PLAYERS) {
          late = h.join(`late${comp}_${r}`);
          conn.set(late, `c-late${comp}_${r}`);
          h.room.score(late, r, 99);
          expect(h.room.final(late, r, 99)).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
        }

        const expectedRaw = new Map<string, number>();
        const reachedAt = new Map<string, number>();
        const style = rnd(); // <0.15 everyone zero, <0.4 heavy ties
        for (const id of participants) {
          const pick = rnd();
          let sent: number;
          if (style < 0.15) sent = 0;
          else if (style < 0.4) sent = [0, 10, 10, 20][Math.floor(rnd() * 4)] ?? 0;
          else sent = Math.floor(rnd() * maxRaw * 1.3); // sometimes above maxRaw
          const clamped = Math.min(maxRaw, sent);
          // Often the same millisecond as the previous player, sometimes a little later.
          vi.advanceTimersByTime(Math.floor(rnd() * 3));
          reachedAt.set(id, Date.now());
          if (pick < 0.15) {
            // Disconnected through the whole round: nothing sent.
            h.room.disconnect(conn.get(id) ?? '');
            expectedRaw.set(id, 0);
          } else if (pick < 0.4) {
            // Never sends a final: the last live score counts.
            h.room.score(id, r, Math.floor(clamped / 2));
            h.room.score(id, r, sent);
            expectedRaw.set(id, clamped);
          } else if (pick < 0.55) {
            // A final LOWER than the last live score: the final wins.
            h.room.score(id, r, sent);
            const lower = Math.floor(clamped / 3);
            h.room.final(id, r, lower);
            h.room.final(id, r, sent); // duplicate final: ignored
            h.room.score(id, r, sent); // live after final: ignored
            expectedRaw.set(id, lower);
          } else {
            h.room.score(id, r, Math.floor(clamped / 2));
            h.room.final(id, r, sent);
            expectedRaw.set(id, clamped);
          }
          // Garbage that must change nothing.
          h.room.final(id, r + 1, 5);
          h.room.final(id, r - 1, 5);
          h.room.score(id, r + 1, maxRaw);
        }

        // Kick somebody mid-round in a third of the rounds.
        if (rnd() < 0.33 && participants.length > 1 && h.state().phase === 'playing') {
          const victim = participants[Math.floor(rnd() * participants.length)] ?? '';
          expect(h.room.kick(victim)).toEqual({ ok: true });
          expectedRaw.delete(victim);
          totals.delete(victim);
        }
        if (h.state().phase === 'playing') vi.advanceTimersByTime(TAP_MS * 3);
        expect(h.state().phase).toBe('results');

        if (late !== null) totals.set(late, { total: 0, wins: 0, best: 0, lastPos: null, join: joins++ });
        const prevTotals = new Map([...totals].map(([id, st]) => [id, { ...st }] as const));
        // Everyone in the room is in the round's table; who did not play has raw 0.
        const sentBy = new Map<string, Sent>();
        for (const [id, st] of totals) {
          const raw = expectedRaw.get(id) ?? 0;
          sentBy.set(id, { raw, at: raw > 0 ? (reachedAt.get(id) ?? null) : null, join: st.join, before: st.total });
        }
        const exp = expectedRound(sentBy);
        // The shared function agrees with the independent one.
        const shared = computeRoundScores(
          [...sentBy].map(([id, x]) => ({ id, raw: x.raw, reachedAt: x.at, joinOrder: x.join, totalBefore: x.before })),
        );
        for (const [id, e] of exp) expect(shared.get(id)).toEqual(e);
        for (const [id, e] of exp) {
          const st = totals.get(id);
          if (st === undefined) throw new Error('no stat');
          st.total += e.points;
          st.best = Math.max(st.best, e.points);
          st.lastPos = e.roundRank;
          if (e.roundRank === 1 && e.points > 0) st.wins += 1;
        }

        const res = h.results();
        expect(res.roundIndex).toBe(r);
        expect(res.gameId).toBe(gameId);
        expect(res.rows.map((row) => row.playerId).sort()).toEqual([...totals.keys()].sort());
        for (const row of res.rows) {
          const e = exp.get(row.playerId);
          expect(row.raw).toBe(expectedRaw.get(row.playerId) ?? 0);
          expect(row.points).toBe(e?.points);
          expect(row.roundRank).toBe(e?.roundRank);
          expect(row.reachedAt).toBe(sentBy.get(row.playerId)?.at);
          expect(row.total).toBe(totals.get(row.playerId)?.total);
          expect(row.rank).toBe(rankOf(totals, row.playerId));
          expect(row.prevRank).toBe(appeared.has(row.playerId) ? rankOf(prevTotals, row.playerId) : null);
          expect(Number.isInteger(row.raw) && Number.isInteger(row.points) && Number.isInteger(row.total)).toBe(true);
        }
        // Strict everywhere: ranks and round positions are 1..n, rows come in rank order.
        const oneToN = res.rows.map((_, i) => i + 1);
        expect(res.rows.map((row) => row.rank)).toEqual(oneToN);
        expect(res.rows.map((row) => row.roundRank).sort((x, y) => x - y)).toEqual(oneToN);
        expect(res.rows.filter((row) => row.prevRank !== null).map((row) => row.prevRank).sort((x, y) => (x ?? 0) - (y ?? 0)))
          .toEqual([...new Set(res.rows.filter((row) => row.prevRank !== null).map((row) => row.prevRank))].sort((x, y) => (x ?? 0) - (y ?? 0)));
        const scorerPoints = res.rows.filter((row) => row.raw > 0).map((row) => row.points);
        expect(new Set(scorerPoints).size).toBe(scorerPoints.length);
        const nonZeroTotals = res.rows.map((row) => row.total).filter((t) => t > 0);
        expect(new Set(nonZeroTotals).size).toBe(nonZeroTotals.length);
        // Exactly one winner whenever anybody scored.
        const winners = [...exp].filter(([id, e]) => e.roundRank === 1 && (sentBy.get(id)?.raw ?? 0) > 0).map(([id]) => id);
        expect(winners.length).toBe([...sentBy.values()].some((x) => x.raw > 0) ? 1 : 0);
        expect(res.winnerIds).toEqual(winners);
        for (const p of h.state().players) {
          expect(p.total).toBe(totals.get(p.id)?.total);
          expect(p.rank).toBe(rankOf(totals, p.id));
        }
        // The last live broadcast of the round is already in the order of the results.
        const lastLive = h.scores.filter((m) => m.round === r).at(-1);
        if (lastLive !== undefined) {
          const live = lastLive.scores.map(([id]) => id).filter((id) => totals.has(id));
          const played = new Set(live);
          expect(live).toEqual([...res.rows].filter((row) => played.has(row.playerId)).sort((x, y) => x.roundRank - y.roundRank).map((row) => row.playerId));
        }
        for (const id of totals.keys()) appeared.add(id);

        // Everyone comes back for the next round.
        for (const [id, c] of conn) if (totals.has(id)) h.room.join(c, { name: 'x', playerId: id, secret: secretOf(h, id) });
      }
      expect(h.errors).toEqual([]);
      h.room.destroy();
    }
  });

  // Secrets are tok<2k> for the k-th player (token() is called id, secret).
  function secretOf(_h: Harness, id: string): string {
    return `tok${Number(id.slice(3)) + 1}`;
  }

  it('two-way and three-way ties on the raw score still give ONE winner, different points and ranks 1..n', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const c = h.join('c');
    const d = h.join('d');
    h.room.start('tap');
    h.toPlaying();
    // c gets to 50 first, then a, then b.
    h.room.score(c, 0, 50);
    vi.advanceTimersByTime(300);
    h.room.final(a, 0, 50);
    vi.advanceTimersByTime(300);
    h.room.final(b, 0, 50);
    h.room.final(c, 0, 50); // confirms the live score: c keeps its earlier moment
    h.room.final(d, 0, 25);
    const res = h.results();
    expect(res.winnerIds).toEqual([c]);
    expect(res.rows.find((r) => r.playerId === c)).toMatchObject({ points: 1100, roundRank: 1, rank: 1 });
    expect(res.rows.find((r) => r.playerId === a)).toMatchObject({ points: 1060, roundRank: 2, rank: 2 });
    expect(res.rows.find((r) => r.playerId === b)).toMatchObject({ points: 1030, roundRank: 3, rank: 3 });
    expect(res.rows.find((r) => r.playerId === d)).toMatchObject({ points: 500, roundRank: 4, rank: 4 });

    h.room.start('ninja');
    h.toPlaying();
    h.room.final(b, 1, 10);
    vi.advanceTimersByTime(10);
    h.room.final(a, 1, 10);
    h.room.final(c, 1, 5);
    h.room.final(d, 1, 0);
    const res2 = h.results();
    expect(res2.winnerIds).toEqual([b]);
    // b 1030 + 1100 = 2130, a 1060 + 1060 = 2120, c 1100 + 530 = 1630, d 500.
    expect(res2.rows.map((r) => [r.playerId, r.points, r.roundRank, r.total, r.rank, r.prevRank])).toEqual([
      [b, 1100, 1, 2130, 1, 3],
      [a, 1060, 2, 2120, 2, 2],
      [c, 530, 3, 1630, 3, 1],
      [d, 0, 4, 500, 4, 4],
    ]);
  });

  it('one player alone wins with 1100; with a zero there is no winner', () => {
    const h = makeRoom();
    const a = h.join('solo');
    h.room.start('ninja');
    h.toPlaying();
    h.room.final(a, 0, 3);
    expect(h.results()).toMatchObject({ winnerIds: [a], rows: [{ points: 1100, roundRank: 1, rank: 1, prevRank: null, total: 1100 }] });
    h.room.start('icy');
    h.toPlaying();
    h.room.final(a, 1, 0);
    expect(h.results()).toMatchObject({ winnerIds: [], rows: [{ points: 0, total: 1100, prevRank: 1 }] });
  });

  it('drops NaN, Infinity, strings, objects and wrong rounds; clamps negative and huge; keeps whole numbers', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    h.room.start('ninja');
    h.toPlaying();
    h.room.score(a, 0, 7);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '999', null, undefined, {}, [], true, 10n]) {
      h.room.score(a, 0, bad);
      expect(h.room.final(a, 0, bad)).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    }
    for (const badRound of [1, -1, 0.5, '0', null, Number.NaN]) {
      h.room.score(a, badRound, 400);
      expect(h.room.final(a, badRound, 400).ok).toBe(false);
    }
    h.room.score(b, 0, -50);
    vi.advanceTimersByTime(500);
    expect(h.scores.at(-1)?.scores).toEqual([
      [a, 7],
      [b, 0],
    ]);
    h.room.score(b, 0, 1e308);
    h.room.score(a, 0, 7.6);
    vi.advanceTimersByTime(500);
    expect(h.scores.at(-1)?.scores).toEqual([
      [b, GAMES.ninja.maxRaw],
      [a, 8],
    ]);
    expect(h.room.final(b, 0, -1e9)).toEqual({ ok: true });
    expect(h.room.final(a, 0, 7.4)).toEqual({ ok: true });
    const res = h.results();
    expect(res.rows.find((r) => r.playerId === a)).toMatchObject({ raw: 7, points: 1100 });
    expect(res.rows.find((r) => r.playerId === b)).toMatchObject({ raw: 0, points: 0 });
    expect(res.winnerIds).toEqual([a]);
  });

  it('a final inside FINAL_GRACE_MS counts; one after it is refused and the live score stands', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    h.room.start('tap');
    h.toPlaying();
    h.room.score(a, 0, 10);
    h.room.score(b, 0, 20);
    vi.advanceTimersByTime(TAP_MS + FINAL_GRACE_MS - 1);
    expect(h.state().phase).toBe('playing');
    expect(h.room.final(a, 0, 30)).toEqual({ ok: true });
    vi.advanceTimersByTime(1);
    expect(h.state().phase).toBe('results');
    expect(h.room.final(b, 0, 999)).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    h.room.score(b, 0, 999);
    const res = h.results();
    expect(res.rows.find((r) => r.playerId === a)?.raw).toBe(30);
    expect(res.rows.find((r) => r.playerId === b)?.raw).toBe(20);
    expect(res.winnerIds).toEqual([a]);
  });

  it('a kick in results or lobby removes the row, the winner and closes the overall ranks', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.join('b');
    const c = h.join('c');
    h.room.start('tap');
    h.toPlaying();
    h.room.final(a, 0, 30);
    h.room.final(b, 0, 20);
    h.room.final(c, 0, 10);
    expect(h.results().winnerIds).toEqual([a]);
    expect(h.room.kick(a)).toEqual({ ok: true });
    let res = h.results();
    // The round's first place passes to the next scorer: there is always exactly one winner.
    expect(res.winnerIds).toEqual([b]);
    expect(res.rows.map((r) => [r.playerId, r.rank, r.total, r.roundRank])).toEqual([
      [b, 1, 727, 1],
      [c, 2, 363, 2],
    ]);
    expect(h.state().players.map((p) => p.id)).toEqual([b, c]);
    h.room.start('icy');
    h.toPlaying();
    const d = h.join('d'); // watches this round
    h.room.final(c, 1, 9);
    h.room.final(b, 1, 3);
    // b 727+433=1160, c 363+1100=1463: c overtook b.
    expect(h.results().rows.map((r) => [r.playerId, r.rank, r.prevRank])).toEqual([
      [c, 1, 2],
      [b, 2, 1],
      [d, 3, null],
    ]);
    h.room.toLobby();
    h.room.kick(b);
    res = h.results();
    expect(res.rows.map((r) => [r.playerId, r.rank, r.prevRank])).toEqual([
      [c, 1, 1],
      [d, 2, null],
    ]);
    h.room.kick(d);
    res = h.results();
    expect(res.rows.map((r) => [r.playerId, r.rank])).toEqual([[c, 1]]);
    // The next round ranks only who is left.
    h.room.start('ninja');
    h.toPlaying();
    h.room.final(c, 2, 1);
    expect(h.results().rows).toHaveLength(1);
    expect(h.results().rows[0]).toMatchObject({ playerId: c, total: 363 + 2200, rank: 1, prevRank: 1 });
  });

  it('host:reset zeroes totals, results, played and round numbering, also from the middle of a round', () => {
    const h = makeRoom();
    const a = h.join('a');
    h.room.start('tap');
    h.toPlaying();
    h.room.final(a, 0, 5);
    h.room.start('icy');
    h.toPlaying();
    h.room.score(a, 1, 50);
    h.room.reset();
    const n = h.states.length;
    vi.advanceTimersByTime(10 * 60_000);
    expect(h.states.length).toBe(n);
    expect(h.state()).toMatchObject({ phase: 'lobby', round: null, results: null, played: [], players: [{ id: a, total: 0 }] });
    h.room.start('tap');
    h.toPlaying();
    // display numbering restarts; the round id does not (phones key their per-round memory on it)
    expect(h.state().round?.number).toBe(1);
    const idAfterReset = h.state().round?.index ?? -1;
    expect(idAfterReset).toBeGreaterThan(0);
    h.room.final(a, idAfterReset, 5);
    expect(h.results().rows[0]).toMatchObject({ total: 1100, prevRank: null });
  });
});

describe('reconnects', () => {
  it('a phone gone for 20s mid-round resumes as the same player with its score and can still send the final', () => {
    const h = makeRoom();
    const res = h.room.join('c1', { name: 'דנה' });
    if (!res.ok) throw new Error('join');
    const other = h.join('other');
    h.room.start('tap');
    h.toPlaying();
    h.room.score(res.playerId, 0, 40);
    h.room.disconnect('c1');
    expect(h.state().players[0]).toMatchObject({ connected: false });
    vi.advanceTimersByTime(20_000);
    expect(h.state().phase).toBe('playing');
    const back = h.room.join('c2', { name: 'דנה', playerId: res.playerId, secret: res.secret });
    expect(back).toMatchObject({ ok: true, playerId: res.playerId });
    expect(h.state().players).toHaveLength(2);
    h.room.score(res.playerId, 0, 55);
    h.room.final(res.playerId, 0, 60);
    h.room.final(other, 0, 1);
    expect(h.results().rows.find((r) => r.playerId === res.playerId)).toMatchObject({ raw: 60, name: 'דנה' });
  });

  it('a blip of the last unfinished phone does not end the round; staying away does', () => {
    const h = makeRoom();
    const a = h.join('a');
    const b = h.room.join('cb', { name: 'b' });
    if (!b.ok) throw new Error('join');
    h.room.start('plotzel');
    h.toPlaying();
    h.room.final(a, 0, 100);
    h.room.score(b.playerId, 0, 10);
    h.room.disconnect('cb');
    vi.advanceTimersByTime(DISCONNECT_END_GRACE_MS - 1);
    h.room.join('cb2', { name: 'b', playerId: b.playerId, secret: b.secret });
    vi.advanceTimersByTime(30_000);
    expect(h.state().phase).toBe('playing');
    h.room.disconnect('cb2');
    vi.advanceTimersByTime(DISCONNECT_END_GRACE_MS);
    expect(h.state().phase).toBe('results');
    expect(h.results().rows.find((r) => r.playerId === b.playerId)?.raw).toBe(10);
  });

  it('a wrong secret never takes over the player; the same socket joining twice is one player', () => {
    const h = makeRoom();
    const a = h.room.join('c1', { name: 'a' });
    if (!a.ok) throw new Error('join');
    h.room.start('tap');
    h.toPlaying();
    h.room.score(a.playerId, 0, 9);
    const thief = h.room.join('c9', { name: 'a', playerId: a.playerId, secret: 'nope' });
    expect(thief.ok && thief.playerId !== a.playerId).toBe(true);
    expect(h.state().players.map((p) => p.name)).toEqual(['a', 'a 2']);
    expect(h.room.playerIdOf('c1')).toBe(a.playerId);
    // Double tap on "join": no ghost.
    const again = h.room.join('c1', { name: 'a' });
    expect(again).toMatchObject({ ok: true, playerId: a.playerId, secret: a.secret });
    const renamed = h.room.join('c1', { name: 'חדש' });
    expect(renamed).toMatchObject({ ok: true, playerId: a.playerId });
    expect(h.state().players).toHaveLength(2);
    expect(h.state().players[0]?.name).toBe('חדש');
  });

  it('two tabs of one player: connected until both close, one score', () => {
    const h = makeRoom();
    const a = h.room.join('t1', { name: 'a' });
    if (!a.ok) throw new Error('join');
    h.room.join('t2', { name: 'a', playerId: a.playerId, secret: a.secret });
    h.room.start('tap');
    h.toPlaying();
    h.room.score(a.playerId, 0, 5);
    h.room.disconnect('t1');
    expect(h.state().players[0]?.connected).toBe(true);
    expect(h.room.final(a.playerId, 0, 8)).toEqual({ ok: true });
    expect(h.results().rows).toHaveLength(1);
    expect(h.results().rows[0]?.raw).toBe(8);
  });

  it('the host can drop and re-attach in every phase; with no host the round still ends by itself', () => {
    const during: CutsceneDef = { id: 'mid', title: 'm', file: 'm.mp4', when: { at: 'during', atMs: 30_000 } };
    const h = makeRoom({ cutscenes: [during, { id: 'joker', title: 'j', file: 'j.mp4', when: { at: 'manual' } }] });
    const a = h.join('a');
    h.room.start('tap');
    const seen: Phase[] = [];
    const bounce = (i: number): void => {
      h.room.disconnect(`host-${i - 1}`);
      h.room.disconnect('host-conn');
      seen.push(h.room.attachHost(`host-${i}`).phase);
      h.room.attachHost(`host-${i}-second-tab`);
      h.room.disconnect(`host-${i}-second-tab`);
      expect(h.room.hostConnected).toBe(true);
    };
    bounce(1); // intro
    vi.advanceTimersByTime(8_000);
    bounce(2); // countdown
    h.toPlaying();
    bounce(3); // playing
    h.room.startCutscene('joker');
    bounce(4); // mid-cutscene: still frozen, still the same cutscene
    expect(h.state().cutscene?.id).toBe('joker');
    h.room.endCutscene();
    h.room.score(a, 0, 3);
    // The TV goes away for good: no automatic cutscene, the round ends on the clock.
    h.room.disconnect('host-4');
    expect(h.room.hostConnected).toBe(false);
    vi.advanceTimersByTime(TAP_MS + RESUME_COUNTDOWN_MS + FINAL_GRACE_MS);
    expect(h.state()).toMatchObject({ phase: 'results', cutscene: null });
    expect(h.results().rows[0]?.raw).toBe(3);
    bounce(5);
    expect(seen).toEqual(['intro', 'countdown', 'playing', 'playing', 'results']);
    expect(h.errors).toEqual([]);
  });
});

describe('cutscenes and the clock', () => {
  const joker: CutsceneDef = { id: 'joker', title: 'j', file: 'j.mp4', when: { at: 'manual' } };
  const joker2: CutsceneDef = { id: 'joker2', title: 'j', file: 'j.mp4', when: { at: 'manual' } };

  it('countdown: startAt shifts by the video and the 3-2-1 restarts where it stopped', () => {
    const h = makeRoom({ cutscenes: [joker] });
    h.join('a');
    h.room.start('tap');
    vi.advanceTimersByTime(8_000); // 2s before startAt
    expect(h.state().phase).toBe('countdown');
    const before = h.state().round;
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(12_345);
    expect(h.state()).toMatchObject({ phase: 'countdown', round: { frozenAt: T0 + 8_000 } });
    expect(h.elapsed()).toBe(-2_000);
    h.room.endCutscene();
    const after = h.state().round;
    expect(after?.startAt).toBe((before?.startAt ?? 0) + 12_345);
    expect(after?.endAt).toBe((before?.endAt ?? 0) + 12_345);
    expect(after).toMatchObject({ frozenAt: null, resumeAt: null });
    vi.advanceTimersByTime(1_999);
    expect(h.state().phase).toBe('countdown');
    vi.advanceTimersByTime(1);
    expect(h.state().phase).toBe('playing');
    expect(h.left()).toBe(TAP_MS);
  });

  it('playing: leftMs is identical before, during and after; resumeAt is set and scores are kept', () => {
    const h = makeRoom({ cutscenes: [joker] });
    const a = h.join('a');
    h.room.start('tap');
    h.toPlaying();
    vi.advanceTimersByTime(17_321);
    h.room.score(a, 0, 44);
    const leftBefore = h.left();
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(33_000);
    expect(h.left()).toBe(leftBefore);
    h.room.score(a, 0, 45); // a straggling live score during the video still counts
    h.room.endCutscene();
    expect(h.state().round).toMatchObject({ frozenAt: null, resumeAt: Date.now() + RESUME_COUNTDOWN_MS });
    expect(h.left()).toBe(leftBefore);
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS);
    expect(h.left()).toBe(leftBefore);
    expect(h.state().round?.resumeAt).toBeNull();
    vi.advanceTimersByTime(leftBefore + FINAL_GRACE_MS - 1);
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(1);
    expect(h.results().rows[0]?.raw).toBe(45);
    expect(h.errors).toEqual([]);
  });

  it('the last 200ms of a round: the 200ms are still there after the video', () => {
    const h = makeRoom({ cutscenes: [joker] });
    h.join('a');
    h.room.start('tap');
    h.toPlaying();
    vi.advanceTimersByTime(TAP_MS - 200);
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(5_000);
    h.room.endCutscene();
    expect(h.left()).toBe(200);
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS + 200 + FINAL_GRACE_MS - 1);
    expect(h.state().phase).toBe('playing');
    vi.advanceTimersByTime(1);
    expect(h.state().phase).toBe('results');
  });

  it('in the grace after endAt: no 3-2-1 for a finished game; finals sent under the video count; scored when it ends', () => {
    const h = makeRoom({ cutscenes: [joker] });
    const a = h.join('a');
    const b = h.join('b');
    h.room.start('tap');
    h.toPlaying();
    h.room.score(a, 0, 5);
    vi.advanceTimersByTime(TAP_MS + 300);
    h.room.startCutscene('joker');
    expect(h.room.final(b, 0, 9)).toEqual({ ok: true });
    vi.advanceTimersByTime(20_000);
    expect(h.state().phase).toBe('playing');
    h.room.endCutscene();
    expect(h.state()).toMatchObject({ phase: 'results', cutscene: null, round: { resumeAt: null, frozenAt: null } });
    expect(h.results().revealAt).toBe(Date.now() + WINNER_REVEAL_MS);
    expect(h.results().winnerIds).toEqual([b]);
    expect(h.results().rows.find((r) => r.playerId === a)?.raw).toBe(5);
    expect(h.errors).toEqual([]);
  });

  it('results: before revealAt the reveal moves by the video; in final and lobby nothing breaks', () => {
    const h = makeRoom({ cutscenes: [joker] });
    const a = h.join('a');
    h.room.start('tap');
    h.toPlaying();
    h.room.final(a, 0, 1);
    const reveal = h.results().revealAt;
    vi.advanceTimersByTime(WINNER_REVEAL_MS - 1);
    h.room.startCutscene('joker');
    vi.advanceTimersByTime(40_000);
    h.room.endCutscene();
    expect(h.results().revealAt).toBe(reveal + 40_000);
    expect(h.results().revealAt - Date.now()).toBe(1);
    h.room.toFinal();
    expect(h.room.startCutscene('joker')).toEqual({ ok: true });
    expect(h.state()).toMatchObject({ phase: 'final', round: null });
    expect(h.room.toLobby()).toEqual({ ok: true });
    expect(h.state()).toMatchObject({ phase: 'lobby', cutscene: { id: 'joker' } });
    h.room.endCutscene();
    expect(h.state().cutscene).toBeNull();
  });

  it('cutsceneEnd twice is harmless; a second cutscene while one plays is BAD_PHASE; back-to-back works', () => {
    const h = makeRoom({ cutscenes: [joker, joker2] });
    h.join('a');
    h.room.start('tap');
    h.toPlaying();
    vi.advanceTimersByTime(10_000);
    const leftBefore = h.left();
    h.room.startCutscene('joker');
    expect(h.room.startCutscene('joker2')).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    vi.advanceTimersByTime(4_000);
    expect(h.room.endCutscene()).toEqual({ ok: true });
    const round = h.state().round;
    expect(h.room.endCutscene()).toEqual({ ok: true });
    expect(h.state().round).toEqual(round);
    // Back to back, the second inside the first one's 3-2-1.
    vi.advanceTimersByTime(1_000);
    expect(h.room.startCutscene('joker2')).toEqual({ ok: true });
    vi.advanceTimersByTime(4_000);
    h.room.endCutscene();
    expect(h.left()).toBe(leftBefore);
    vi.advanceTimersByTime(500);
    expect(h.room.startCutscene('joker')).toEqual({ ok: true });
    h.room.endCutscene();
    expect(h.left()).toBe(leftBefore);
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS + leftBefore + FINAL_GRACE_MS);
    expect(h.state().phase).toBe('results');
    expect(h.errors).toEqual([]);
  });

  it('a TV that never reports the end: the server ends it after CUTSCENE_MAX_MS in every phase', () => {
    for (const at of ['intro', 'countdown', 'playing'] as const) {
      const h = makeRoom({ cutscenes: [joker] });
      h.join('a');
      h.room.start('tap');
      if (at === 'countdown') vi.advanceTimersByTime(8_000);
      if (at === 'playing') h.toPlaying();
      expect(h.state().phase).toBe(at);
      h.room.startCutscene('joker');
      h.room.disconnect('host-conn'); // the TV died
      vi.advanceTimersByTime(CUTSCENE_MAX_MS - 1);
      expect(h.state().cutscene).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(h.state().cutscene).toBeNull();
      vi.advanceTimersByTime(10 * 60_000);
      expect(h.state().phase).toBe('results');
      h.room.destroy();
    }
  });

  it('host:start, host:lobby, host:kick, host:endRound, host:reset during a cutscene', () => {
    const h = makeRoom({ cutscenes: [joker] });
    const a = h.join('a');
    const b = h.join('b');
    // start under a lobby cutscene: the round waits, then gets its whole intro.
    h.room.startCutscene('joker');
    expect(h.room.start('tap')).toEqual({ ok: true });
    expect(h.room.start('tap')).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    vi.advanceTimersByTime(30_000);
    expect(h.state()).toMatchObject({ phase: 'intro', round: { frozenAt: T0 } });
    h.room.endCutscene();
    expect(h.elapsed()).toBe(-10_000);
    h.toPlaying();
    // kick under a cutscene: gone at once, round not ended under the video.
    h.room.final(a, 0, 4);
    h.room.startCutscene('joker');
    expect(h.room.kick(b)).toEqual({ ok: true });
    expect(h.state()).toMatchObject({ phase: 'playing', players: [{ id: a }] });
    // endRound under a cutscene: deferred; lobby is refused while a round runs.
    expect(h.room.toLobby()).toMatchObject({ ok: false, error: 'BAD_PHASE' });
    expect(h.room.endRound()).toEqual({ ok: true });
    expect(h.state().phase).toBe('playing');
    h.room.endCutscene();
    expect(h.state().phase).toBe('results');
    expect(h.results().rows).toHaveLength(1);
    // lobby + reset under a results cutscene.
    h.room.startCutscene('joker');
    expect(h.room.toLobby()).toEqual({ ok: true });
    expect(h.room.reset()).toEqual({ ok: true });
    expect(h.state()).toMatchObject({ phase: 'lobby', cutscene: null, results: null });
    const n = h.states.length;
    vi.advanceTimersByTime(CUTSCENE_MAX_MS * 2);
    expect(h.states.length).toBe(n); // the safety timer of the reset cutscene is gone
    expect(h.errors).toEqual([]);
  });

  it('automatic triggers fire once each, in order, and not at all with autoCutscenes off', () => {
    const defs: CutsceneDef[] = [
      { id: 'pre', title: '', file: '', when: { at: 'before', gameId: 'tap' } },
      { id: 'mid', title: '', file: '', when: { at: 'during', gameId: 'tap', atMs: 30_000 } },
      { id: 'post', title: '', file: '', when: { at: 'after', gameId: 'tap' } },
      { id: 'fin', title: '', file: '', when: { at: 'final' } },
    ];
    for (const auto of [true, false]) {
      const h = makeRoom({ cutscenes: defs });
      const a = h.join('a');
      h.room.setAutoCutscenes(auto);
      const fired: string[] = [];
      const pump = (ms: number): void => {
        // Like the TV: every cutscene is ended 5s after it starts.
        for (let t = 0; t < ms; t += 250) {
          vi.advanceTimersByTime(250);
          const cs = h.state().cutscene;
          if (cs === null) continue;
          const key = `${cs.id}@${cs.startedAt}`;
          if (fired.at(-1) !== key) fired.push(key);
          if (Date.now() - cs.startedAt >= 5_000) h.room.endCutscene();
        }
      };
      for (let round = 0; round < 2; round++) {
        h.room.start('tap');
        pump(120_000);
        expect(h.state().phase).toBe('results');
        h.room.score(a, round, 1);
      }
      h.room.toFinal();
      pump(20_000);
      h.room.toLobby();
      h.room.toFinal();
      pump(20_000);
      expect(fired.map((f) => f.split('@')[0] ?? '')).toEqual(auto ? ['pre', 'mid', 'post', 'fin'] : []);
      expect(h.errors).toEqual([]);
      h.room.destroy();
    }
  });

  it("'during' on a game shorter than atMs is scaled into the round; the real manifest never fires past the end", () => {
    const timing: RoomTiming = { introMs: 1_500, countdownMs: 1_500, durationMs: () => 12_000 };
    const h = makeRoom({ cutscenes: CUTSCENES, timing });
    h.join('a');
    h.room.start('tap');
    h.toPlaying();
    // the manifest's tap_freeze time, scaled into the 12 s round (whatever the game's length is)
    const def = CUTSCENES.find((c) => c.id === 'tap_freeze');
    const atMs = def !== undefined && def.when.at === 'during' ? def.when.atMs : -1;
    expect(atMs).toBeGreaterThan(0);
    expect(atMs).toBeLessThan(TAP_MS);
    const at = Math.ceil((atMs * 12_000) / TAP_MS);
    vi.advanceTimersByTime(at - 1);
    expect(h.state().cutscene).toBeNull();
    vi.advanceTimersByTime(1);
    expect(h.state().cutscene?.id).toBe('tap_freeze');
    expect(h.left()).toBe(12_000 - at);
    h.room.endCutscene();
    vi.advanceTimersByTime(RESUME_COUNTDOWN_MS + (12_000 - at) + FINAL_GRACE_MS);
    expect(h.state()).toMatchObject({ phase: 'results', cutscene: null });

    // atMs beyond the nominal length: never fires, the round ends on time.
    const far: CutsceneDef = { id: 'far', title: '', file: '', when: { at: 'during', atMs: TAP_MS + 1 } };
    const h2 = makeRoom({ cutscenes: [far] });
    h2.join('a');
    h2.room.start('tap');
    h2.toPlaying();
    vi.advanceTimersByTime(TAP_MS + FINAL_GRACE_MS);
    expect(h2.state()).toMatchObject({ phase: 'results', cutscene: null });
  });

  it('no timer of an old round fires later: endRound, reset, a new round, destroy', () => {
    const during: CutsceneDef = { id: 'mid', title: '', file: '', when: { at: 'during', atMs: 30_000, }, repeat: true };
    const h = makeRoom({ cutscenes: [during, joker] });
    const a = h.join('a');
    // Round 0 ended by the host at 10s; round 1 starts right away.
    h.room.start('tap');
    h.toPlaying();
    vi.advanceTimersByTime(10_000);
    h.room.score(a, 0, 5);
    h.room.endRound();
    expect(h.results().roundIndex).toBe(0);
    h.room.start('icy');
    const r1 = h.state().round;
    // Where round 0 would have frozen (30s) and ended (60s): nothing may happen to round 1 except its own clock.
    vi.advanceTimersByTime(9_999);
    expect(h.state()).toMatchObject({ phase: 'countdown', cutscene: null, round: { index: 1, startAt: r1?.startAt, endAt: r1?.endAt } });
    h.toPlaying();
    vi.advanceTimersByTime(11_000); // round 0's 30s mark and beyond, in round 1 time 11s
    expect(h.state()).toMatchObject({ phase: 'playing', cutscene: null });
    h.room.endRound();
    expect(h.results().roundIndex).toBe(1);
    // intro aborted, then lobby for an hour: no phase change, no broadcast.
    h.room.start('tap');
    h.room.endRound();
    expect(h.state()).toMatchObject({ phase: 'lobby', round: null });
    h.room.start('tap');
    // the cancelled intro used up id 2: ids are never reused, the display number is still 3
    expect(h.state().round?.index).toBe(3);
    expect(h.state().round?.number).toBe(3);
    h.room.endRound();
    const n = h.states.length;
    vi.advanceTimersByTime(60 * 60_000);
    expect(h.states.length).toBe(n);
    expect(h.state().phase).toBe('lobby');
    // destroy mid-round: silence.
    h.room.start('tap');
    h.toPlaying();
    h.room.score(a, 2, 5);
    h.room.startCutscene('joker');
    h.room.destroy();
    const m = h.states.length;
    const s = h.scores.length;
    vi.advanceTimersByTime(60 * 60_000);
    expect(h.states.length).toBe(m);
    expect(h.scores.length).toBe(s);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.errors).toEqual([]);
  });

  it('a finished competition leaves no timer behind', () => {
    const h = makeRoom({ cutscenes: CUTSCENES });
    const a = h.join('a');
    for (const [i, g] of GAME_IDS.entries()) {
      h.room.start(g);
      for (let t = 0; t < 200 && h.state().phase !== 'results'; t++) {
        vi.advanceTimersByTime(1_000);
        if (h.state().cutscene !== null) h.room.endCutscene();
        h.room.score(a, i, t);
      }
      expect(h.state().phase).toBe('results');
    }
    h.room.toFinal();
    h.room.endCutscene();
    vi.advanceTimersByTime(1_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.state().players[0]?.total).toBe(5 * 1100);
  });
});

describe('abuse and limits', () => {
  it('60 players join, the 61st gets ROOM_FULL, a resume still works when full', () => {
    const h = makeRoom();
    const first = h.room.join('c0', { name: 'p' });
    if (!first.ok) throw new Error('join');
    for (let i = 1; i < MAX_PLAYERS; i++) expect(h.room.join(`c${i}`, { name: 'p' }).ok).toBe(true);
    expect(h.room.join('c-extra', { name: 'p' })).toMatchObject({ ok: false, error: 'ROOM_FULL' });
    expect(new Set(h.state().players.map((p) => p.name)).size).toBe(MAX_PLAYERS);
    h.room.disconnect('c0');
    expect(h.room.join('c0b', { name: 'p', playerId: first.playerId, secret: first.secret })).toMatchObject({ ok: true });
    expect(h.state().players).toHaveLength(MAX_PLAYERS);
  });

  it('names: empty, spaces, 40 chars, emoji, RTL marks, HTML, duplicates, giant, non-strings', () => {
    const h = makeRoom();
    const name = (input: unknown): string | null => {
      const res = h.room.join(`c${Math.random()}`, { name: input });
      return res.ok ? (res.state.players.find((p) => p.id === res.playerId)?.name ?? null) : res.error;
    };
    expect(name('')).toBe('BAD_NAME');
    expect(name('   \t\n ')).toBe('BAD_NAME');
    expect(name('‮‏⁦')).not.toBe('');
    expect(name('‮‭⁦⁩')).toBe('BAD_NAME');
    expect(name(42)).toBe('BAD_NAME');
    expect(name({ toString: () => 'x' })).toBe('BAD_NAME');
    expect(name(['a'])).toBe('BAD_NAME');
    expect(name('x'.repeat(40))).toBe('x'.repeat(14));
    expect(name('x'.repeat(40))).toBe(`${'x'.repeat(12)} 2`);
    expect(name('שלום'.repeat(10))).toHaveLength(14);
    expect(name('👨‍👩‍👧‍👦'.repeat(30))).toBe('👨‍👩‍👧‍👦'.repeat(14));
    expect(name('<img src=x onerror=alert(1)>')).toBe('<img src=x one'); // plain text: the clients must render it as text
    expect(name('‮דני‬')).toBe('דני');
    expect(name('דני')).toBe('דני 2');
    expect(name('  דני  ')).toBe('דני 3');
    expect(name('A'.repeat(1_000_000))).toBe('A'.repeat(14));
    for (const p of h.state().players) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(/[\u0000-\u001f‪-‮⁦-⁩]/.test(p.name)).toBe(false);
    }
    expect(new Set(h.state().players.map((p) => p.name)).size).toBe(h.state().players.length);
  });

  it('200 score messages a second from one player: one broadcast per 250ms, the last value wins', () => {
    const h = makeRoom();
    const a = h.join('a');
    h.room.start('tap');
    h.toPlaying();
    const before = h.scores.length;
    for (let ms = 0; ms < 5_000; ms += 5) {
      h.room.score(a, 0, ms / 5);
      vi.advanceTimersByTime(5);
    }
    expect(h.scores.length - before).toBeLessThanOrEqual(21);
    expect(h.scores.length - before).toBeGreaterThanOrEqual(19);
    vi.advanceTimersByTime(300);
    expect(h.scores.at(-1)?.scores).toEqual([[a, 999]]);
    // Scores never trigger a full state broadcast.
    expect(h.states.filter((s) => s.phase === 'playing').length).toBeLessThanOrEqual(2);
  });

  it('unknown players and garbage ids are ignored everywhere', () => {
    const h = makeRoom();
    h.join('a');
    h.room.start('tap');
    h.toPlaying();
    h.room.score('ghost', 0, 5);
    expect(h.room.final('ghost', 0, 5)).toMatchObject({ ok: false });
    expect(h.room.kick('ghost')).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.kick({})).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
    expect(h.room.start('__proto__')).toMatchObject({ ok: false });
    expect(h.room.start('constructor')).toMatchObject({ ok: false });
    expect(h.room.startCutscene('__proto__')).toMatchObject({ ok: false });
    expect(h.room.setAutoCutscenes('yes')).toMatchObject({ ok: false });
    h.room.disconnect('never-seen');
    vi.advanceTimersByTime(TAP_MS + FINAL_GRACE_MS);
    expect(h.results().rows).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });

  it('a sink that throws in one room does not stop its clock, and never touches another room', () => {
    let boom = false;
    const mk = (code: string, states: RoomState[]): Room =>
      new Room(code, 'k', {
        sink: {
          state: (s) => {
            if (boom && code === 'AAAA') throw new Error('sink down');
            states.push(s);
          },
          scores: () => undefined,
          kicked: () => undefined,
        },
        cutscenes: [],
        token: (() => {
          let n = 0;
          return () => `${code}${++n}`;
        })(),
        seed: () => 1,
        onError: () => undefined,
      });
    const sa: RoomState[] = [];
    const sb: RoomState[] = [];
    const A = mk('AAAA', sa);
    const B = mk('BBBB', sb);
    const a = A.join('c1', { name: 'a' });
    const b = B.join('c1', { name: 'b' }); // same connection id string in another room
    if (!a.ok || !b.ok) throw new Error('join');
    A.start('tap');
    B.start('icy');
    boom = true;
    vi.advanceTimersByTime(10_000);
    expect(A.snapshot().phase).toBe('playing');
    expect(B.snapshot().phase).toBe('playing');
    A.score(a.playerId, 0, 10);
    B.score(b.playerId, 0, 77);
    B.score(a.playerId, 0, 5_000); // A's player id means nothing in B
    vi.advanceTimersByTime(GAMES.icy.durationMs + FINAL_GRACE_MS);
    expect(A.snapshot().phase).toBe('results');
    expect(A.snapshot().results?.rows.map((r) => r.raw)).toEqual([10]);
    expect(B.snapshot().results?.rows.map((r) => [r.playerId, r.raw])).toEqual([[b.playerId, 77]]);
    expect(B.snapshot().players).toHaveLength(1);
    boom = false;
    A.disconnect('c1');
    expect(B.snapshot().players[0]?.connected).toBe(true);
  });
});

describe('rooms', () => {
  const sinkFor = (): RoomSink => ({ state: () => undefined, scores: () => undefined, kicked: () => undefined });

  it('a 30 minute dinner break does not drop the room, with the TV open or closed', () => {
    const reg = new RoomRegistry({ sinkFor });
    const room = reg.create();
    if (room === null) throw new Error('create');
    room.attachHost('tv');
    const p = room.join('phone', { name: 'a' });
    room.disconnect('phone'); // every phone asleep
    vi.advanceTimersByTime(30 * 60_000);
    expect(reg.sweep()).toBe(0);
    room.disconnect('tv'); // the laptop slept too
    vi.advanceTimersByTime(5 * 60 * 60_000);
    expect(reg.sweep()).toBe(0);
    expect(reg.get(room.code)).toBe(room);
    expect(p.ok && room.join('phone2', { name: 'a', playerId: p.playerId, secret: p.secret }).ok).toBe(true);
    vi.advanceTimersByTime(7 * 60 * 60_000);
    expect(reg.sweep()).toBe(0); // someone is attached
    room.disconnect('phone2');
    vi.advanceTimersByTime(6 * 60 * 60_000);
    expect(reg.sweep()).toBe(1);
  });

  it('a script that opens MAX_ROOMS empty rooms cannot lock the real host out, and never evicts a party', () => {
    const reg = new RoomRegistry({ sinkFor });
    const party = reg.create();
    if (party === null) throw new Error('create');
    party.join('phone', { name: 'a' });
    party.disconnect('phone');
    const attached = reg.create();
    attached?.attachHost('tv');
    for (let i = 2; i < MAX_ROOMS; i++) expect(reg.create()).not.toBeNull();
    expect(reg.stats().rooms).toBe(MAX_ROOMS);
    const fresh = reg.create();
    expect(fresh).not.toBeNull();
    expect(reg.get(party.code)).toBe(party);
    expect(reg.get(attached?.code)).toBe(attached);
    expect(reg.stats().rooms).toBe(3);
    reg.destroyAll();
  });

  it('room codes are 4 letters without I, L, O or digits', () => {
    const reg = new RoomRegistry({ sinkFor });
    for (let i = 0; i < 300; i++) expect(reg.create()?.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    reg.destroyAll();
  });
});
