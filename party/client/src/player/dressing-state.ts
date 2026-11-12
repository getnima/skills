/**
 * The guest's doll on the phone: the look, whether the guest has been through the dressing
 * room, and whether the room is open right now. The controller owns one of these; everything
 * that needs the socket or the storage comes in through `DressingDeps`, so the rules below
 * run in a plain unit test (tests/unit/dressing-state.test.ts).
 *
 * The rules:
 * - A NEW seat in a room: the phone sends the doll it dressed last (any room) with the join;
 *   the server answers with the doll it stored (that one, or a random one for a first timer),
 *   and the guest is "not dressed yet": the dressing room opens when the room is in the lobby.
 * - "Done", or a round taking over while the dressing room is open, makes the guest "dressed".
 *   The latest look is sent at once in both cases.
 * - A reload / reconnect (same seat): the server's look wins, unless this phone still holds a
 *   change the server never confirmed, which is then sent again. "Dressed" is remembered.
 * - A guest who joins while a round is running is not dressed and not bothered: the dressing
 *   room opens for them the next time the room is in the lobby.
 *
 * THE TEST SWITCH (the only one): `?dress=0` in the phone's URL skips the dressing-room step
 * (the guest counts as dressed from the join), `?dress=1` forces it. Without the parameter
 * the step is skipped only in an automated browser (`navigator.webdriver`), so the end-to-end
 * scripts that expect the waiting screen right after the join keep working unchanged. The
 * scripts that test the real flow open the phone with `dress=1` (tests/e2e/dress-lib.cjs).
 */
import { decodeLook, defaultLook, encodeLook } from '../../../shared/avatar';

import type { Phase } from '../../../shared/protocol';
import type { LookMemory } from './identity';
import type { LookSender } from './look-sender';

export interface DressingSnap {
  /** This phone's look (an encoded look), or null before the first join answer. */
  readonly look: string | null;
  /** Has been through the dressing room in this room. */
  readonly dressed: boolean;
  /** The guest asked for the dressing room (the "change the look" button). */
  readonly dressing: boolean;
}

export interface DressingDeps {
  readonly sender: LookSender;
  /** Is the dressing-room step on (see the test switch above). */
  readonly stepEnabled: boolean;
  load(code: string): LookMemory | null;
  save(code: string, mem: LookMemory): void;
  loadLast(): string | null;
  saveLast(look: string): void;
  /** Something in the snap changed. */
  onChange(snap: DressingSnap): void;
}

export interface Dressing {
  snap(): DressingSnap;
  /** The `look` of a join request for a new seat (undefined: let the server pick a doll). */
  joinLook(): string | undefined;
  /** The server answered a join or a resume in room `code`; `serverLook` is this player's look there. */
  joined(code: string, serverLook: string | null, fresh: boolean): void;
  /** A room snapshot arrived: the phase before it (null: none yet) and its phase. */
  phase(prev: Phase | null, next: Phase): void;
  /** The dressing room reported a change. */
  setLook(look: string): void;
  /** The server stored the look as `stored` in answer to `sent`. */
  confirmed(sent: string, stored: string): void;
  /** A look waits for the server / everything is confirmed (from the sender). */
  pending(pending: boolean): void;
  open(): void;
  /** "Done" (or a round took over): dressed, closed, and the latest look goes out now. */
  close(): void;
  /** This phone left the room (kicked, the room closed, "join again"). */
  left(): void;
}

/** The dressing-room step is on: see THE TEST SWITCH at the top of this file. */
export function dressStepEnabled(search: string, webdriver: boolean): boolean {
  let v: string | null = null;
  try {
    v = new URLSearchParams(search).get('dress');
  } catch {
    v = null;
  }
  if (v === '1') return true;
  if (v === '0') return false;
  return !webdriver;
}

const BARE = encodeLook(defaultLook());

/**
 * A look text in its canonical form (what the server would store), or null when it is not a
 * look (the same rule as server/looks.ts: garbage decodes to the bare doll, and only the bare
 * doll's own text may mean the bare doll).
 */
export function canonicalLook(text: unknown): string | null {
  if (typeof text !== 'string' || text === '') return null;
  try {
    const clean = encodeLook(decodeLook(text));
    return clean === BARE && text !== BARE ? null : clean;
  } catch {
    return null;
  }
}

export function createDressing(deps: DressingDeps): Dressing {
  let code = '';
  let look: string | null = null;
  let dressed = false;
  let dressing = false;
  let pending = false;

  let last: DressingSnap = { look, dressed, dressing };
  function publish(): void {
    if (last.look === look && last.dressed === dressed && last.dressing === dressing) return;
    last = { look, dressed, dressing };
    deps.onChange(last);
  }

  function persist(): void {
    if (code !== '' && look !== null) deps.save(code, { look, pending, dressed });
  }

  const api: Dressing = {
    snap: (): DressingSnap => last,

    joinLook(): string | undefined {
      return canonicalLook(deps.loadLast()) ?? undefined;
    },

    joined(room: string, serverLook: string | null, fresh: boolean): void {
      const sameRoom = room === code;
      code = room;
      const server = canonicalLook(serverLook);
      if (fresh) {
        deps.sender.reset();
        look = server ?? look;
        pending = false;
        dressed = !deps.stepEnabled;
        dressing = false;
      } else {
        // this page's own memory first (it also works with storage blocked), else what a reload left
        const mem = sameRoom && look !== null ? { look, pending, dressed } : deps.load(room);
        const mine = mem !== null ? canonicalLook(mem.look) : null;
        if (mem !== null && mine !== null && mem.pending && mine !== server) {
          // a change the server never confirmed (made offline, or right before a reload): it wins
          look = mine;
          pending = true;
          deps.sender.set(mine);
        } else {
          look = server ?? mine ?? look;
          pending = false;
          if (deps.sender.pending()) deps.sender.reset();
        }
        // a seat from before the dressing room existed (no memory): nothing to remember, not dressed
        dressed = !deps.stepEnabled || (mem !== null && mem.dressed);
      }
      persist();
      publish();
      // back in the room: whatever waits goes out now
      deps.sender.flush();
    },

    phase(prev: Phase | null, next: Phase): void {
      if (next === 'lobby') return;
      // a round (or the podium) takes over; a guest who was in the dressing room is done with it
      const wasDressing = dressing || (prev === 'lobby' && !dressed);
      if (!wasDressing) return;
      api.close();
    },

    setLook(text: string): void {
      const next = canonicalLook(text);
      if (next === null || next === look) return;
      look = next;
      pending = true;
      deps.saveLast(next);
      persist();
      publish();
      deps.sender.set(next);
      // a change that arrives after the room closed (its last report on unmount) does not wait
      if (!dressing && dressed) deps.sender.flush();
    },

    confirmed(sent: string, stored: string): void {
      const clean = canonicalLook(stored);
      // the server keeps a different text than the one sent, and the guest has not moved on: follow it
      if (clean === null || clean === sent || look !== sent) return;
      look = clean;
      deps.saveLast(clean);
      persist();
      publish();
    },

    pending(now: boolean): void {
      if (pending === now) return;
      pending = now;
      persist();
    },

    open(): void {
      if (dressing) return;
      dressing = true;
      publish();
    },

    close(): void {
      const changed = dressing || !dressed;
      dressing = false;
      dressed = true;
      if (changed) persist();
      publish();
      deps.sender.flush();
    },

    left(): void {
      deps.sender.reset();
      code = '';
      look = null;
      dressed = false;
      dressing = false;
      pending = false;
      publish();
    },
  };
  return api;
}
