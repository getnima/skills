/**
 * Thin socket.io adapter around RoomRegistry / Room: validates payloads,
 * checks who is asking, and forwards. No game logic lives here.
 */
import { RoomRegistry } from './rooms';

import type { Server, Socket } from 'socket.io';
import type { Ack, C2S, ErrorCode, S2C } from '../shared/protocol';
import type { Room, RoomSink } from './room';
import type { RoomRegistryDeps } from './rooms';

interface SocketData {
  roomCode?: string;
  role?: 'host' | 'player';
  playerId?: string;
}

export type PartyServer = Server<C2S, S2C, Record<string, never>, SocketData>;
type PartySocket = Socket<C2S, S2C, Record<string, never>, SocketData>;

type Failure = { ok: false; error: ErrorCode; message: string };

function fail(error: ErrorCode, message: string): Failure {
  return { ok: false, error, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Clients are untrusted: the ack may be missing or not a function. */
function safeAck<T>(ack: unknown): (res: T) => void {
  return (res: T): void => {
    if (typeof ack !== 'function') return;
    try {
      (ack as (res: T) => void)(res);
    } catch (err) {
      console.error('[socket] ack failed', err);
    }
  };
}

export function createRegistry(io: PartyServer, deps: Omit<RoomRegistryDeps, 'sinkFor'> = {}): RoomRegistry {
  const sinkFor = (code: string): RoomSink => ({
    state: (state): void => {
      io.to(code).emit('state', state);
    },
    scores: (msg): void => {
      io.to(code).emit('scores', msg);
    },
    kicked: (connIds): void => {
      for (const id of connIds) {
        const socket = io.sockets.sockets.get(id);
        if (socket === undefined) continue;
        socket.emit('kicked');
        void socket.leave(code);
        socket.data.roomCode = undefined;
        socket.data.role = undefined;
        socket.data.playerId = undefined;
      }
    },
  });
  return new RoomRegistry({ ...deps, sinkFor });
}

export function attachSocketHandlers(io: PartyServer, registry: RoomRegistry): void {
  io.on('connection', (socket: PartySocket) => {
    /** Wraps a handler so a bug or a hostile payload answers BAD_REQUEST instead of throwing. */
    function guarded<R>(event: string, ack: unknown, run: (reply: (res: R | Failure) => void) => void): void {
      const reply = safeAck<R | Failure>(ack);
      try {
        run(reply);
      } catch (err) {
        console.error(`[socket] ${event} failed`, err);
        reply(fail('BAD_REQUEST', 'internal error'));
      }
    }

    function leaveCurrentRoom(): void {
      const code = socket.data.roomCode;
      if (code === undefined) return;
      registry.get(code)?.disconnect(socket.id);
      void socket.leave(code);
      socket.data.roomCode = undefined;
      socket.data.role = undefined;
      socket.data.playerId = undefined;
    }

    /** Runs a host-only action on the socket's room. */
    function hostAction(event: string, req: unknown, ack: unknown, run: (room: Room, req: Record<string, unknown>) => Ack<{}>): void {
      guarded<Ack<{}>>(event, ack, (reply) => {
        const room = registry.get(socket.data.roomCode);
        if (room === undefined) return reply(fail(socket.data.roomCode === undefined ? 'NOT_HOST' : 'ROOM_NOT_FOUND', 'no room'));
        if (socket.data.role !== 'host' || !room.isHostConn(socket.id)) return reply(fail('NOT_HOST', 'host only'));
        reply(run(room, isRecord(req) ? req : {}));
      });
    }

    socket.on('host:create', (req: unknown, ack: unknown) => {
      guarded<Ack<{ code: string; hostKey: string; state: ReturnType<Room['snapshot']> }>>('host:create', ack, (reply) => {
        const body = isRecord(req) ? req : {};
        const existing = registry.get(body.code);
        const reattach = existing !== undefined && typeof body.hostKey === 'string' && body.hostKey === existing.hostKey;
        const room = reattach ? existing : registry.create();
        if (room === null) return reply(fail('BAD_REQUEST', 'too many rooms'));
        leaveCurrentRoom();
        void socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.role = 'host';
        const state = room.attachHost(socket.id);
        reply({ ok: true, code: room.code, hostKey: room.hostKey, state });
      });
    });

    socket.on('host:start', (req: unknown, ack: unknown) => hostAction('host:start', req, ack, (room, body) => room.start(body.gameId)));
    socket.on('host:endRound', (req: unknown, ack: unknown) => hostAction('host:endRound', req, ack, (room) => room.endRound()));
    socket.on('host:lobby', (req: unknown, ack: unknown) => hostAction('host:lobby', req, ack, (room) => room.toLobby()));
    socket.on('host:final', (req: unknown, ack: unknown) => hostAction('host:final', req, ack, (room) => room.toFinal()));
    socket.on('host:reset', (req: unknown, ack: unknown) => hostAction('host:reset', req, ack, (room) => room.reset()));
    socket.on('host:kick', (req: unknown, ack: unknown) => hostAction('host:kick', req, ack, (room, body) => room.kick(body.playerId)));
    socket.on('host:cutscene', (req: unknown, ack: unknown) => hostAction('host:cutscene', req, ack, (room, body) => room.startCutscene(body.id)));
    socket.on('host:cutsceneEnd', (req: unknown, ack: unknown) => hostAction('host:cutsceneEnd', req, ack, (room) => room.endCutscene()));
    socket.on('host:setAutoCutscenes', (req: unknown, ack: unknown) =>
      hostAction('host:setAutoCutscenes', req, ack, (room, body) => room.setAutoCutscenes(body.enabled)),
    );

    socket.on('player:join', (req: unknown, ack: unknown) => {
      guarded<Ack<{ playerId: string; secret: string; state: ReturnType<Room['snapshot']> }>>('player:join', ack, (reply) => {
        if (!isRecord(req)) return reply(fail('BAD_REQUEST', 'bad payload'));
        const room = registry.get(req.code);
        if (room === undefined) return reply(fail('ROOM_NOT_FOUND', 'אין חדר כזה'));
        if (socket.data.roomCode !== undefined && socket.data.roomCode !== room.code) leaveCurrentRoom();
        // Join the channel first so this socket also receives the broadcast the join triggers.
        void socket.join(room.code);
        const res = room.join(socket.id, { name: req.name, playerId: req.playerId, secret: req.secret });
        if (!res.ok) {
          if (socket.data.roomCode !== room.code) void socket.leave(room.code);
          return reply(res);
        }
        socket.data.roomCode = room.code;
        socket.data.role = 'player';
        socket.data.playerId = res.playerId;
        reply(res);
      });
    });

    socket.on('player:score', (req: unknown) => {
      try {
        if (!isRecord(req) || socket.data.role !== 'player' || socket.data.playerId === undefined) return;
        registry.get(socket.data.roomCode)?.score(socket.data.playerId, req.round, req.score);
      } catch (err) {
        console.error('[socket] player:score failed', err);
      }
    });

    socket.on('player:final', (req: unknown, ack: unknown) => {
      guarded<Ack<{}>>('player:final', ack, (reply) => {
        if (!isRecord(req)) return reply(fail('BAD_REQUEST', 'bad payload'));
        const room = registry.get(socket.data.roomCode);
        if (room === undefined || socket.data.role !== 'player' || socket.data.playerId === undefined) {
          return reply(fail('ROOM_NOT_FOUND', 'not in a room'));
        }
        reply(room.final(socket.data.playerId, req.round, req.score));
      });
    });

    socket.on('time:ping', (clientT: unknown, ack: unknown) => {
      safeAck<{ clientT: number; serverNow: number }>(ack)({
        clientT: typeof clientT === 'number' && Number.isFinite(clientT) ? clientT : 0,
        serverNow: Date.now(),
      });
    });

    socket.on('disconnect', () => {
      try {
        registry.get(socket.data.roomCode)?.disconnect(socket.id);
      } catch (err) {
        console.error('[socket] disconnect failed', err);
      }
    });

    socket.on('error', (err) => {
      console.error('[socket] error', err.message);
    });
  });
}
