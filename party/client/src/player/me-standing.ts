/**
 * What the "me bar" (bottom of every phone screen outside the game) may show: this player's
 * overall place and total. Pure, unit tested in tests/unit/me-standing.test.ts.
 *
 * While the phone still hides the round that just ended (the "sending" beat and the suspense
 * before results.revealAt, the gate in app.tsx), the bar shows the standing from BEFORE that
 * round, rebuilt from the results rows (prevRank, total - points), so it reveals nothing new.
 */
import type { PlayerPublic, RoomState } from '../../../shared/protocol';

export interface MeStanding {
  readonly id: string;
  readonly name: string;
  readonly avatar: number;
  /** Overall place, or null before the first scored round ("מוכנים?"). */
  readonly rank: number | null;
  /** "מתוך N". */
  readonly count: number;
  /** Total points, or null together with rank. */
  readonly total: number | null;
}

/**
 * @param hideRound the phone must not show the outcome of `state.results` yet.
 */
export function meStanding(state: RoomState, me: string, hideRound: boolean): MeStanding | null {
  const player: PlayerPublic | undefined = state.players.find((p) => p.id === me);
  if (player === undefined) return null;
  const base = { id: player.id, name: player.name, avatar: player.avatar };
  const res = state.results;
  // Nothing scored yet (or the host reset the competition): no place to show.
  if (res === null) return { ...base, rank: null, count: state.players.length, total: null };
  if (hideRound) {
    const row = res.rows.find((r) => r.playerId === me);
    if (row !== undefined) {
      // First appearance: before this round there was no standing for this player.
      if (row.prevRank === null) return { ...base, rank: null, count: state.players.length, total: null };
      const before = res.rows.filter((r) => r.prevRank !== null).length;
      return { ...base, rank: row.prevRank, count: Math.max(before, row.prevRank), total: row.total - row.points };
    }
  }
  return { ...base, rank: player.rank, count: state.players.length, total: player.total };
}
