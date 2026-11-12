/**
 * Thin socket.io adapter around RoomRegistry / Room: validates payloads,
 * checks who is asking, and forwards. No game logic lives here.
 */
import { RELAY_MAX_PER_SECOND } from '../shared/protocol';

import { remoteFromEnv } from './config';
import { checkPassword, chooseRoom, cleanRelayData, clientAddress, GuessThrottle, RateLimiter, screenRooms, waitText } from './remote-auth';
import { normalizeRoomCode, RoomRegistry } from './rooms';

import type { Server, Socket } from 'socket.io';
import type { Ack, C2S, ErrorCode, HostRole, RemoteAttachAck, RemoteAttachFailure, S2C } from '../shared/protocol';
import type { RemoteThrottleConfig } from './config';
import type { Room, RoomSink } from './room';
import type { RoomRegistryDeps } from './rooms';

interface SocketData {
  roomCode?: string;
  role?: 'host' | 'player';
  /** For role 'host': the TV page or a phone remote. */
  hostRole?: HostRole;
  playerId?: string;
}

export interface RemoteOptions {
  /** The remote password (server only). */
  readonly password: string;
  readonly throttle: RemoteThrottleConfig;
  /** Clock of the guess throttle and the relay limit (tests). */
  readonly now?: () => number;
}

function defaultRemoteOptions(): RemoteOptions {
  const r = remoteFromEnv({});
  return { password: r.remotePassword, throttle: r.remoteThrottle };
}

function remoteFail(error: ErrorCode, message: string, rooms: readonly string[] = [], retryMs: number | null = null): RemoteAttachFailure {
  return { ok: false, error, message, rooms, retryMs };
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
        socket.data.hostRole = undefined;
        socket.data.playerId = undefined;
      }
    },
  });
  return new RoomRegistry({ ...deps, sinkFor });
}

export function attachSocketHandlers(io: PartyServer, registry: RoomRegistry, remote: RemoteOptions = defaultRemoteOptions()): void {
  const now = remote.now ?? Date.now;
  const throttle = new GuessThrottle(remote.throttle);
  const sweeper = setInterval(() => throttle.sweep(now()), 5 * 60_000);
  sweeper.unref();
  io.on('connection', (socket: PartySocket) => {
    const relayLimit = new RateLimiter(RELAY_MAX_PER_SECOND, 1_000);

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
      socket.data.hostRole = undefined;
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
        socket.data.hostRole = 'screen';
        const state = room.attachHost(socket.id, 'screen');
        reply({ ok: true, code: room.code, hostKey: room.hostKey, state });
      });
    });

    // The owner's phone. Nothing about the request (the password above all) is ever logged or echoed.
    socket.on('remote:attach', (req: unknown, ack: unknown) => {
      const reply = safeAck<RemoteAttachAck>(ack);
      try {
        const body = isRecord(req) ? req : {};
        const addr = clientAddress(socket.handshake.address, socket.handshake.headers['x-forwarded-for']);
        const keys = [`socket:${socket.id}`, `ip:${addr}`];
        const t = now();
        const gate = throttle.check(keys, t);
        if (!gate.ok) return reply(remoteFail('THROTTLED', waitText(gate.retryMs), [], gate.retryMs));
        if (!checkPassword(body.password, remote.password)) {
          const lock = throttle.fail(keys, t);
          if (!lock.ok) return reply(remoteFail('THROTTLED', waitText(lock.retryMs), [], lock.retryMs));
          return reply(remoteFail('BAD_PASSWORD', 'סיסמה שגויה'));
        }
        // the IP key stays: a guest guessing on the same Wi-Fi does not get a fresh start from the owner
        throttle.succeed([keys[0] as string]);
        const wanted = body.code === undefined || body.code === null || body.code === '' ? null : normalizeRoomCode(body.code);
        if (body.code !== undefined && body.code !== null && body.code !== '' && wanted === null) {
          return reply(remoteFail('ROOM_NOT_FOUND', 'קוד חדר לא תקין', screenRooms(registry.candidates())));
        }
        const choice = chooseRoom(registry.candidates(), wanted);
        if (choice.kind === 'choose') return reply(remoteFail('CHOOSE_ROOM', 'כמה מסכים פתוחים. בחרו חדר', choice.rooms));
        const room = choice.kind === 'room' ? registry.get(choice.code) : undefined;
        if (room === undefined) {
          const text = wanted === null ? 'המסך לא פתוח עדיין. פתחו את עמוד הטלוויזיה' : 'החדר הזה כבר לא קיים';
          return reply(remoteFail('ROOM_NOT_FOUND', text, choice.kind === 'none' ? choice.rooms : []));
        }
        leaveCurrentRoom();
        void socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.role = 'host';
        socket.data.hostRole = 'remote';
        const state = room.attachHost(socket.id, 'remote');
        reply({ ok: true, code: room.code, state, rooms: screenRooms(registry.candidates()) });
      } catch (err) {
        console.error('[socket] remote:attach failed', err instanceof Error ? err.message : 'unknown error');
        reply(remoteFail('BAD_REQUEST', 'internal error'));
      }
    });

    // Between the hosts of one room (the TV's control model one way, a remote's press the other).
    socket.on('host:relay', (req: unknown, ack: unknown) => {
      guarded<Ack<{}>>('host:relay', ack, (reply) => {
        const room = registry.get(socket.data.roomCode);
        if (room === undefined || socket.data.role !== 'host' || !room.isHostConn(socket.id)) return reply(fail('NOT_HOST', 'host only'));
        if (!relayLimit.take(now())) return reply(fail('THROTTLED', 'too many relay messages'));
        const data = cleanRelayData(isRecord(req) ? req.data : undefined);
        if (data === null) return reply(fail('BAD_REQUEST', 'relay data must be a small JSON object'));
        const from: HostRole = room.hostRoleOf(socket.id) ?? 'screen';
        for (const id of room.hostConnIds()) {
          if (id === socket.id) continue;
          io.sockets.sockets.get(id)?.emit('relay', { from, data });
        }
        reply({ ok: true });
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
        socket.data.hostRole = undefined;
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
