import { describe, expect, it } from 'vitest';

import { meStanding } from '../../client/src/player/me-standing';

import type { PlayerPublic, ResultRow, RoomState, RoundResults } from '../../shared/protocol';

function player(id: string, rank: number, total: number): PlayerPublic {
  return { id, name: `p-${id}`, avatar: rank, connected: true, total, rank };
}

function row(id: string, points: number, total: number, rank: number, prevRank: number | null): ResultRow {
  return { playerId: id, name: `p-${id}`, avatar: 0, raw: points, points, roundRank: rank, reachedAt: 1, total, rank, prevRank };
}

function room(players: PlayerPublic[], results: RoundResults | null, phase: RoomState['phase'] = 'results'): RoomState {
  // Only the fields meStanding reads matter; the rest is a plausible state.
  return {
    code: 'ABCD',
    phase,
    players,
    round: null,
    played: results === null ? [] : [results.gameId],
    results,
    cutscene: null,
    autoCutscenes: true,
    serverNow: 0,
  } as unknown as RoomState;
}

function results(rows: ResultRow[]): RoundResults {
  return { roundIndex: 1, roundNumber: 2, gameId: 'tap', rows, winnerIds: [rows[0]?.playerId ?? ''], revealAt: 10_000 };
}

describe('meStanding', () => {
  it('before any scored round: name, no place ("מוכנים?")', () => {
    const s = meStanding(room([player('a', 1, 0), player('b', 2, 0)], null, 'lobby'), 'a', false);
    expect(s).toEqual({ id: 'a', name: 'p-a', avatar: 1, rank: null, count: 2, total: null });
  });

  it('after the reveal: the server rank and total', () => {
    const res = results([row('b', 900, 1500, 1, 2), row('a', 100, 1000, 2, 1), row('c', 0, 0, 3, 3)]);
    const s = meStanding(room([player('b', 1, 1500), player('a', 2, 1000), player('c', 3, 0)], res), 'a', false);
    expect(s?.rank).toBe(2);
    expect(s?.total).toBe(1000);
    expect(s?.count).toBe(3);
  });

  it('during the suspense: the standing from BEFORE the round (nothing new)', () => {
    const res = results([row('b', 900, 1500, 1, 2), row('a', 100, 1000, 2, 1), row('c', 0, 0, 3, 3)]);
    const s = meStanding(room([player('b', 1, 1500), player('a', 2, 1000), player('c', 3, 0)], res), 'a', true);
    expect(s?.rank).toBe(1);
    expect(s?.total).toBe(900);
    expect(s?.count).toBe(3);
  });

  it('during the suspense of a first appearance (round 1): still "מוכנים?"', () => {
    const res = results([row('a', 700, 700, 1, null), row('b', 300, 300, 2, null)]);
    const s = meStanding(room([player('a', 1, 700), player('b', 2, 300)], res), 'b', true);
    expect(s?.rank).toBeNull();
    expect(s?.total).toBeNull();
  });

  it('the suspense count leaves out players who were not ranked before the round', () => {
    const res = results([row('a', 700, 1700, 1, 1), row('n', 300, 300, 2, null), row('b', 0, 200, 3, 2)]);
    const s = meStanding(room([player('a', 1, 1700), player('n', 2, 300), player('b', 3, 200)], res), 'b', true);
    expect(s).toMatchObject({ rank: 2, count: 2, total: 200 });
  });

  it('not in the room: null', () => {
    expect(meStanding(room([player('a', 1, 0)], null, 'lobby'), 'zz', false)).toBeNull();
  });
});
