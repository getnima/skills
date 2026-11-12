import { randomBytes, randomInt } from 'node:crypto';

import { ROOM_CODE_LEN, ROOM_IDLE_TTL_MS } from '../shared/protocol';

import { Room } from './room';

import type { CutsceneDef } from '../shared/cutscenes';
import type { RoomTiming } from './config';
import type { RoomCandidate } from './remote-auth';
import type { RoomSink, Scheduler } from './room';

/** Uppercase letters without the lookalikes I, O and L. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
/** Plenty for one house party, and a cap on what a stray script can allocate. */
export const MAX_ROOMS = 500;

export function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

export function randomToken(): string {
  return randomBytes(16).toString('base64url');
}

export function randomSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

export function normalizeRoomCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return code.length === ROOM_CODE_LEN ? code : null;
}

export interface RoomRegistryDeps {
  /** Builds the sink of a new room (the socket adapter broadcasts to the room's channel). */
  readonly sinkFor: (code: string) => RoomSink;
  readonly timing?: RoomTiming;
  readonly scheduler?: Scheduler;
  readonly cutscenes?: readonly CutsceneDef[];
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly deps: RoomRegistryDeps) {}

  get(code: unknown): Room | undefined {
    const normalized = normalizeRoomCode(code);
    return normalized === null ? undefined : this.rooms.get(normalized);
  }

  /** Null when the server holds MAX_ROOMS rooms already. */
  create(): Room | null {
    if (this.rooms.size >= MAX_ROOMS) this.sweep();
    if (this.rooms.size >= MAX_ROOMS) this.dropAbandoned();
    if (this.rooms.size >= MAX_ROOMS) return null;
    let code = randomRoomCode();
    while (this.rooms.has(code)) code = randomRoomCode();
    const room = new Room(code, randomToken(), {
      sink: this.deps.sinkFor(code),
      scheduler: this.deps.scheduler,
      timing: this.deps.timing,
      cutscenes: this.deps.cutscenes,
      token: randomToken,
      seed: randomSeed,
    });
    this.rooms.set(code, room);
    return room;
  }

  /** Drops rooms nobody has been attached to for `ttlMs`. Returns how many were dropped. */
  sweep(ttlMs: number = ROOM_IDLE_TTL_MS): number {
    let dropped = 0;
    for (const [code, room] of this.rooms) {
      if (room.connectionCount > 0 || room.idleMs() < ttlMs) continue;
      room.destroy();
      this.rooms.delete(code);
      dropped++;
    }
    return dropped;
  }

  /** Under pressure only: rooms with nobody attached and no player ever joined (a stray script, old TV tabs). */
  private dropAbandoned(): void {
    for (const [code, room] of this.rooms) {
      if (room.connectionCount > 0 || room.playerCount > 0) continue;
      room.destroy();
      this.rooms.delete(code);
    }
  }

  /** Every room as a remote or the /j link sees it when choosing one (codes, TV presence, head count). */
  candidates(): RoomCandidate[] {
    return [...this.rooms.values()].map((room) => ({
      code: room.code,
      screen: room.screenConnected,
      activeAt: room.lastScreenAt,
      players: room.connectedPlayerCount,
    }));
  }

  /**
   * The room the /j short link opens: of the rooms with a TV attached, the one with the most guests
   * connected, then the TV that attached last. A stray second /host page (an empty room) never takes
   * the party's link; a party TV that re-attaches after a Wi-Fi blip keeps it.
   */
  shortLinkRoom(): string | null {
    const live = this.candidates()
      .filter((c) => c.screen)
      .sort((a, b) => b.players - a.players || b.activeAt - a.activeAt || (a.code < b.code ? -1 : 1));
    return live[0]?.code ?? null;
  }

  stats(): { rooms: number; players: number } {
    let players = 0;
    for (const room of this.rooms.values()) players += room.playerCount;
    return { rooms: this.rooms.size, players };
  }

  destroyAll(): void {
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }
}
