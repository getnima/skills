/**
 * The remote's link: one socket, the password (checked only by the server),
 * the room snapshot and live scores, and the TV's action model over the relay.
 *
 * The socket is opened only once there is a password to try: a guest who opens
 * /remote without it never even connects, so it cannot receive any room data.
 * A right password is kept in localStorage (the owner's own phone) and the
 * remote re-attaches by itself after a reload, a screen lock or a reconnect.
 */
import { io } from 'socket.io-client';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { applyLooks } from '../../../shared/room-looks';
import { parseRelay, toRelay } from '../host/actions';
import { createServerClock, serverUrl } from '../net/connection';
import { makeRid } from './logic';

import type { HostRole, RelayData, RemoteAttachAck, RoomState } from '../../../shared/protocol';
import type { ActionId, ControlModel } from '../host/actions';
import type { PartySocket, ServerClock } from '../net/connection';

const PW_KEY = 'party.remote.pw';
const CODE_KEY = 'party.remote.code';
/** No room / no TV yet: try again this often. */
const RETRY_MS = 3_000;
/** The remote asks the TV for its model this often; no model for TV_LOST_MS = the TV page is gone. */
const HELLO_MS = 2_000;
const TV_LOST_MS = 5_500;
/** A press the TV did not answer within this long failed. */
const RUN_TIMEOUT_MS = 5_000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode: the phone asks for the password again after a reload
  }
}

export type LinkPhase =
  /** The unlock screen. */
  | 'locked'
  /** A password is being checked (or the socket is connecting to check it). */
  | 'checking'
  /** Attached to a room as a host. */
  | 'attached'
  /** The password was right but no TV page is open: retrying by itself. */
  | 'waiting'
  /** Several TV pages are open: the owner picks the room. */
  | 'choose';

export type TvLink = 'unknown' | 'online' | 'offline';

export interface RunResult {
  readonly ok: boolean;
  readonly text: string;
}

export interface RemoteLink {
  readonly phase: LinkPhase;
  /** The socket to the server. */
  readonly server: 'online' | 'connecting' | 'offline';
  /** The TV page answers over the relay. */
  readonly tv: TvLink;
  /** Unlock screen: the last error. */
  readonly error: string | null;
  /** Unlock screen: Date.now() ms until which tries are refused (throttled), or null. */
  readonly retryAt: number | null;
  readonly rooms: readonly string[];
  readonly state: RoomState | null;
  readonly scores: ReadonlyArray<readonly [string, number]>;
  readonly model: ControlModel | null;
  readonly clock: ServerClock;
  unlock(password: string): void;
  pickRoom(code: string): void;
  logout(): void;
  /** A press: the TV runs it through its dispatcher. */
  run(id: ActionId, arg: string | undefined, confirmed: boolean): Promise<RunResult>;
  /** The TV is away: end the round / back to the lobby straight on the server. */
  rescue(what: 'endRound' | 'lobby'): Promise<RunResult>;
}

const RESCUE_ERRORS: Readonly<Record<string, string>> = {
  BAD_PHASE: 'אי אפשר בשלב הזה',
  NOT_HOST: 'השלט לא מחובר לחדר',
  ROOM_NOT_FOUND: 'החדר לא קיים',
};

export function useRemoteLink(): RemoteLink {
  // nothing is opened before there is a password to try (autoConnect off)
  const socket = useMemo<PartySocket>(
    () =>
      io(serverUrl(), {
        autoConnect: false,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 300,
        reconnectionDelayMax: 2_000,
        timeout: 8_000,
      }),
    [],
  );
  const clock = useMemo<ServerClock>(() => createServerClock(socket), [socket]);
  const rid = useMemo(makeRid, []);

  const [phase, setPhase] = useState<LinkPhase>(() => (read(PW_KEY) !== null ? 'checking' : 'locked'));
  const [server, setServer] = useState<RemoteLink['server']>('connecting');
  const [tvSeenAt, setTvSeenAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [rooms, setRooms] = useState<readonly string[]>([]);
  const [state, setState] = useState<RoomState | null>(null);
  const [scores, setScores] = useState<ReadonlyArray<readonly [string, number]>>([]);
  const [model, setModel] = useState<ControlModel | null>(null);

  const pw = useRef<string | null>(read(PW_KEY));
  /** Where the password came from: a stored one that fails means it was changed on the server. */
  const pwStored = useRef(pw.current !== null);
  const code = useRef<string | null>(read(CODE_KEY));
  const stateRef = useRef<RoomState | null>(null);
  const phaseRef = useRef<LinkPhase>(phase);
  phaseRef.current = phase;
  const attaching = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const req = useRef(0);
  const pending = useRef(new Map<number, (r: RunResult) => void>());
  const attachRef = useRef<() => void>(() => undefined);

  const clearRetry = (): void => {
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };
  const retryIn = (ms: number): void => {
    clearRetry();
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      attachRef.current();
    }, ms);
  };
  const hello = (): void => {
    if (socket.connected && phaseRef.current === 'attached') socket.emit('host:relay', { data: toRelay({ t: 'hello' }) }, () => undefined);
  };

  const attach = (): void => {
    const password = pw.current;
    if (password === null || attaching.current) return;
    if (!socket.connected) {
      socket.connect();
      return;
    }
    attaching.current = true;
    let answered = false;
    const timer = setTimeout(() => {
      if (answered) return;
      answered = true;
      attaching.current = false;
      retryIn(RETRY_MS);
    }, 6_000);
    const body: { password: string; code?: string } = code.current !== null ? { password, code: code.current } : { password };
    socket.emit('remote:attach', body, (res: RemoteAttachAck) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      attaching.current = false;
      if (res.ok) {
        write(PW_KEY, password);
        write(CODE_KEY, res.code);
        pwStored.current = true;
        code.current = res.code;
        stateRef.current = res.state;
        setState(res.state);
        setRooms(res.rooms);
        setError(null);
        setRetryAt(null);
        setPhase('attached');
        phaseRef.current = 'attached';
        hello();
        return;
      }
      switch (res.error) {
        case 'BAD_PASSWORD':
          write(PW_KEY, null);
          pw.current = null;
          setError(pwStored.current ? 'הסיסמה השתנתה. הקלידו אותה שוב' : 'סיסמה שגויה');
          pwStored.current = false;
          setPhase('locked');
          return;
        case 'THROTTLED': {
          const wait = res.retryMs ?? 30_000;
          setRetryAt(Date.now() + wait);
          if (pwStored.current) {
            // the owner's own stored password: just wait it out
            setPhase('checking');
            retryIn(wait + 250);
          } else {
            pw.current = null;
            setError(null);
            setPhase('locked');
          }
          return;
        }
        case 'CHOOSE_ROOM':
          write(PW_KEY, password);
          pwStored.current = true;
          setRooms(res.rooms);
          setPhase('choose');
          return;
        case 'ROOM_NOT_FOUND':
          write(PW_KEY, password);
          pwStored.current = true;
          if (code.current !== null) {
            // the room we knew is gone (the server restarted): take whichever TV is open
            code.current = null;
            write(CODE_KEY, null);
            retryIn(50);
            return;
          }
          setRooms(res.rooms);
          setState(null);
          stateRef.current = null;
          setPhase('waiting');
          retryIn(RETRY_MS);
          return;
        default:
          setPhase(pwStored.current ? 'waiting' : 'locked');
          setError(res.message);
          retryIn(RETRY_MS);
      }
    });
  };
  attachRef.current = attach;

  useEffect(() => {
    const onConnect = (): void => {
      setServer('online');
      void clock.sync(3);
      attachRef.current();
    };
    const onDisconnect = (): void => {
      setServer('offline');
      attaching.current = false;
    };
    const onAttempt = (): void => setServer('connecting');
    const onState = (s: RoomState): void => {
      if (stateRef.current !== null && s.code !== stateRef.current.code) return;
      const prevRound = stateRef.current?.round?.index ?? null;
      if ((s.round?.index ?? null) !== prevRound) setScores([]);
      stateRef.current = s;
      clock.hint(s.serverNow);
      setState(s);
    };
    const onScores = (msg: { round: number; scores: ReadonlyArray<readonly [string, number]> }): void => {
      if (stateRef.current?.round?.index !== msg.round) return;
      setScores(msg.scores);
    };
    // somebody's doll changed: a small patch, not a whole state
    const onLooks = (msg: { looks: ReadonlyArray<readonly [string, string]> }): void => {
      const cur = stateRef.current;
      if (cur === null) return;
      const next = applyLooks(cur, msg?.looks);
      if (next === cur) return;
      stateRef.current = next;
      setState(next);
    };
    const onRelay = (msg: { from: HostRole; data: RelayData }): void => {
      if (msg.from !== 'screen') return;
      const m = parseRelay(msg.data);
      if (m === null) return;
      if (m.t === 'model') {
        setModel(m.model);
        setTvSeenAt(Date.now());
      } else if (m.t === 'result' && m.rid === rid) {
        const done = pending.current.get(m.req);
        if (done !== undefined) {
          pending.current.delete(m.req);
          done({ ok: m.ok, text: m.text });
        }
      }
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    socket.on('scores', onScores);
    socket.on('looks', onLooks);
    socket.on('relay', onRelay);
    socket.io.on('reconnect_attempt', onAttempt);
    if (pw.current !== null) socket.connect();

    const wake = (): void => {
      if (document.visibilityState !== 'visible' || pw.current === null) return;
      if (!socket.connected) {
        setServer('connecting');
        socket.connect();
      } else {
        void clock.sync(2);
        hello();
      }
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state', onState);
      socket.off('scores', onScores);
      socket.off('looks', onLooks);
      socket.off('relay', onRelay);
      socket.io.off('reconnect_attempt', onAttempt);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('pageshow', wake);
      clearRetry();
      socket.close();
    };
  }, [socket, clock, rid]);

  // heartbeat: ask the TV for its model; also the clock that ages the TV link
  useEffect(() => {
    const id = setInterval(() => {
      setTick((n) => (n + 1) % 1_000_000);
      hello();
    }, HELLO_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (phase !== 'attached') {
      setTvSeenAt(null);
      setModel(null);
    }
  }, [phase]);
  const [attachedAt, setAttachedAt] = useState(0);
  useEffect(() => {
    if (phase === 'attached' && server === 'online') setAttachedAt(Date.now());
  }, [phase, server]);

  let tv: TvLink = 'unknown';
  if (phase === 'attached' && server === 'online') {
    const t = Date.now();
    if (tvSeenAt !== null && t - tvSeenAt < TV_LOST_MS) tv = 'online';
    else if (t - attachedAt > TV_LOST_MS) tv = 'offline';
  }

  return {
    phase,
    server,
    tv,
    error,
    retryAt,
    rooms,
    state,
    scores,
    model,
    clock,
    unlock: (password: string): void => {
      const p = password.trim();
      if (p.length === 0) {
        setError('צריך להקליד סיסמה');
        return;
      }
      if (retryAt !== null && Date.now() < retryAt) return;
      pw.current = p;
      pwStored.current = false;
      setError(null);
      setRetryAt(null);
      setPhase('checking');
      phaseRef.current = 'checking';
      attach();
    },
    pickRoom: (c: string): void => {
      code.current = c;
      write(CODE_KEY, c);
      setPhase('checking');
      attach();
    },
    logout: (): void => {
      write(PW_KEY, null);
      write(CODE_KEY, null);
      pw.current = null;
      pwStored.current = false;
      code.current = null;
      stateRef.current = null;
      clearRetry();
      setState(null);
      setModel(null);
      setError(null);
      setPhase('locked');
      phaseRef.current = 'locked';
      // the server forgets this socket as a host the moment it goes
      socket.disconnect();
    },
    run: (id, arg, confirmed): Promise<RunResult> =>
      new Promise<RunResult>((resolve) => {
        const m = model;
        if (!socket.connected || m === null) {
          resolve({ ok: false, text: 'אין חיבור למסך' });
          return;
        }
        req.current += 1;
        const n = req.current;
        const timer = setTimeout(() => {
          if (!pending.current.delete(n)) return;
          resolve({ ok: false, text: 'המסך לא ענה. נסו שוב' });
        }, RUN_TIMEOUT_MS);
        pending.current.set(n, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
        const msg = toRelay({ t: 'run', rid, req: n, id, ...(arg !== undefined ? { arg } : {}), key: m.key, confirmed });
        socket.emit('host:relay', { data: msg }, (res) => {
          if (res.ok) return;
          pending.current.delete(n);
          clearTimeout(timer);
          resolve({ ok: false, text: res.error === 'THROTTLED' ? 'לאט לאט…' : 'השלט לא מחובר. מתחברים מחדש…' });
          if (res.error === 'NOT_HOST' || res.error === 'ROOM_NOT_FOUND') attachRef.current();
        });
      }),
    rescue: (what): Promise<RunResult> =>
      new Promise<RunResult>((resolve) => {
        if (!socket.connected) {
          resolve({ ok: false, text: 'אין חיבור לשרת' });
          return;
        }
        const timer = setTimeout(() => resolve({ ok: false, text: 'השרת לא ענה' }), 5_000);
        const ack = (res: { ok: boolean; error?: string }): void => {
          clearTimeout(timer);
          resolve(res.ok ? { ok: true, text: 'נשלח ✓' } : { ok: false, text: RESCUE_ERRORS[res.error ?? ''] ?? 'הבקשה נדחתה' });
        };
        if (what === 'endRound') socket.emit('host:endRound', {}, ack);
        else socket.emit('host:lobby', {}, ack);
      }),
  };
}
