/**
 * The `looks` event on a client: put the looks that changed into the room snapshot the
 * client holds. Pure; used by the phone, the TV and the remote.
 */
import type { RoomState } from './protocol';

/**
 * `state` with the given [playerId, look] pairs applied to `players` and to the rows of
 * `results`. Returns the SAME object when nothing changes (unknown players, equal looks,
 * a malformed message), so a caller can skip the re-render.
 */
export function applyLooks(state: RoomState, looks: unknown): RoomState {
  if (!Array.isArray(looks)) return state;
  const next = new Map<string, string>();
  for (const pair of looks as unknown[]) {
    if (!Array.isArray(pair)) continue;
    const [id, look] = pair as unknown[];
    if (typeof id === 'string' && typeof look === 'string') next.set(id, look);
  }
  if (next.size === 0) return state;

  let changed = false;
  const players = state.players.map((p) => {
    const look = next.get(p.id);
    if (look === undefined || look === p.look) return p;
    changed = true;
    return { ...p, look };
  });
  let results = state.results;
  if (results !== null) {
    let rowChanged = false;
    const rows = results.rows.map((row) => {
      const look = next.get(row.playerId);
      if (look === undefined || look === row.look) return row;
      rowChanged = true;
      return { ...row, look };
    });
    if (rowChanged) {
      results = { ...results, rows };
      changed = true;
    }
  }
  return changed ? { ...state, players, results } : state;
}
