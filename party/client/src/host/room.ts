/**
 * The host's live link to the server: one socket, the server clock, the room
 * snapshot and the live scores. Everything the TV renders comes from here.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { applyLooks } from '../../../shared/room-looks';
import { connect, createServerClock } from '../net/connection';

import type { Ack, ErrorCode, GameId, HostRole, RelayData, RoomState } from '../../../shared/protocol';
import type { PartySocket, ServerClock } from '../net/connection';

export type ConnStatus = 'connecting' | 'online' | 'offline';

const CODE_KEY = 'party.host.code';
const HOSTKEY_KEY = 'party.host.key';

function readStore(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the room simply will not survive a refresh
  }
}

const ERROR_TEXT: Readonly<Record<ErrorCode, string>> = {
  ROOM_NOT_FOUND: 'החדר כבר לא קיים בשרת',
  ROOM_FULL: 'החדר מלא',
  BAD_NAME: 'שם לא תקין',
  NOT_HOST: 'המסך הזה כבר לא המארח של החדר (אולי נפתח בלשונית אחרת?)',
  BAD_PHASE: 'אי אפשר לעשות את זה בשלב הזה',
  BAD_REQUEST: 'הבקשה נדחתה',
  KICKED: 'הוצאת',
  BAD_PASSWORD: 'סיסמה שגויה',
  THROTTLED: 'יותר מדי בקשות. נסו שוב עוד רגע',
  CHOOSE_ROOM: 'צריך לבחור חדר',
};

/** What a host action came back with: the server's answer as one Hebrew line. */
export interface ActResult {
  readonly ok: boolean;
  readonly text: string;
}

export interface ActOptions {
  /** Do not show the error as a toast on the TV (the remote shows it instead). */
  readonly quiet?: boolean;
}

export type RelayListener = (msg: { readonly from: HostRole; readonly data: RelayData }) => void;

export interface RoomNotice {
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'error';
}

export interface HostRoom {
  readonly status: ConnStatus;
  readonly state: RoomState | null;
  /** Live raw scores of the running round (a new Map per update). */
  readonly scores: ReadonlyMap<string, number>;
  readonly clock: ServerClock;
  /** Set when a re-attach landed in a fresh room (the server restarted or the room expired). */
  readonly lostRoom: string | null;
  readonly notice: RoomNotice | null;
  dismissLostRoom(): void;
  start(gameId: GameId, opts?: ActOptions): Promise<ActResult>;
  endRound(opts?: ActOptions): Promise<ActResult>;
  lobby(opts?: ActOptions): Promise<ActResult>;
  final(opts?: ActOptions): Promise<ActResult>;
  reset(opts?: ActOptions): Promise<ActResult>;
  kick(playerId: string, opts?: ActOptions): Promise<ActResult>;
  cutscene(id: string, opts?: ActOptions): Promise<ActResult>;
  cutsceneEnd(opts?: ActOptions): Promise<ActResult>;
  setAutoCutscenes(enabled: boolean, opts?: ActOptions): Promise<ActResult>;
  newRoom(): void;
  /** To the other host sockets of this room (the phone remotes). Fire and forget. */
  relay(data: RelayData): void;
  /** Relays from the other host sockets. Returns the unsubscribe. */
  onRelay(fn: RelayListener): () => void;
}

const EMPTY_SCORES: ReadonlyMap<string, number> = new Map();

export function useHostRoom(): HostRoom {
  const socket = useMemo<PartySocket>(() => connect(), []);
  const clock = useMemo<ServerClock>(() => createServerClock(socket), [socket]);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [state, setState] = useState<RoomState | null>(null);
  const [scores, setScores] = useState<ReadonlyMap<string, number>>(EMPTY_SCORES);
  const [lostRoom, setLostRoom] = useState<string | null>(null);
  const [notice, setNotice] = useState<RoomNotice | null>(null);
  const stateRef = useRef<RoomState | null>(null);
  const noticeSeq = useRef(0);
  const relayListeners = useMemo(() => new Set<RelayListener>(), []);

  const say = (text: string, tone: RoomNotice['tone'] = 'error'): void => {
    noticeSeq.current += 1;
    setNotice({ id: noticeSeq.current, text, tone });
  };

  const applyState = (next: RoomState): void => {
    const prev = stateRef.current;
    const prevRound = prev?.round?.index ?? null;
    const nextRound = next.round?.index ?? null;
    if (prevRound !== nextRound || prev?.code !== next.code) setScores(new Map());
    // a new intro: measure the server clock afresh, so the 3-2-1 and its sounds land on the exact
    // instants (the phones do the same; the intro leaves them 27 s for it)
    if (next.phase === 'intro' && (prev?.phase !== 'intro' || prevRound !== nextRound) && socket.connected) void clock.sync(6);
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => {
    let alive = true;

    const attach = async (): Promise<void> => {
      setStatus('connecting');
      await clock.sync(5);
      if (!alive || !socket.connected) return;
      const storedCode = readStore(CODE_KEY);
      const storedKey = readStore(HOSTKEY_KEY);
      const req = storedCode !== undefined && storedKey !== undefined ? { code: storedCode, hostKey: storedKey } : {};
      socket.emit('host:create', req, (res) => {
        if (!alive) return;
        if (!res.ok) {
          setStatus('offline');
          say(`לא הצלחנו לפתוח חדר: ${ERROR_TEXT[res.error]}`);
          return;
        }
        if (storedCode !== undefined && res.code !== storedCode) setLostRoom(storedCode);
        writeStore(CODE_KEY, res.code);
        writeStore(HOSTKEY_KEY, res.hostKey);
        applyState(res.state);
        setStatus('online');
      });
    };

    const onConnect = (): void => {
      void attach();
    };
    const onDisconnect = (): void => setStatus('offline');
    const onState = (s: RoomState): void => {
      if (stateRef.current !== null && s.code !== stateRef.current.code) return;
      applyState(s);
    };
    const onScores = (msg: { round: number; scores: ReadonlyArray<readonly [string, number]> }): void => {
      const r = stateRef.current?.round;
      if (r === null || r === undefined || r.index !== msg.round) return;
      setScores(new Map(msg.scores));
    };
    // somebody's doll changed (a guest is dressing): a small patch, not a whole state
    const onLooks = (msg: { looks: ReadonlyArray<readonly [string, string]> }): void => {
      const cur = stateRef.current;
      if (cur === null) return;
      const next = applyLooks(cur, msg?.looks);
      if (next === cur) return;
      stateRef.current = next;
      setState(next);
    };
    const onReconnectAttempt = (): void => setStatus('connecting');
    const onRelayMsg = (msg: { from: HostRole; data: RelayData }): void => {
      for (const fn of relayListeners) {
        try {
          fn(msg);
        } catch (err) {
          console.error('[host] relay listener failed', err);
        }
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    socket.on('scores', onScores);
    socket.on('looks', onLooks);
    socket.on('relay', onRelayMsg);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    if (socket.connected) onConnect();

    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && socket.connected) void clock.sync(3);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state', onState);
      socket.off('scores', onScores);
      socket.off('looks', onLooks);
      socket.off('relay', onRelayMsg);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      document.removeEventListener('visibilitychange', onVisible);
      socket.close();
    };
  }, [socket, clock]);

  const act = (run: (ack: (res: Ack<{}>) => void) => void, opts?: ActOptions): Promise<ActResult> =>
    new Promise<ActResult>((resolve) => {
      const failWith = (text: string): void => {
        if (opts?.quiet !== true) say(text);
        resolve({ ok: false, text });
      };
      if (!socket.connected) {
        failWith('אין חיבור לשרת כרגע. מנסים להתחבר מחדש…');
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        failWith('השרת לא ענה. נסו שוב.');
      }, 6_000);
      run((res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!res.ok) failWith(ERROR_TEXT[res.error] ?? 'הבקשה נדחתה');
        else resolve({ ok: true, text: 'בוצע' });
      });
    });

  return {
    status,
    state,
    scores,
    clock,
    lostRoom,
    notice,
    dismissLostRoom: (): void => setLostRoom(null),
    start: (gameId, opts) => act((ack) => socket.emit('host:start', { gameId }, ack), opts),
    endRound: (opts) => act((ack) => socket.emit('host:endRound', {}, ack), opts),
    lobby: (opts) => act((ack) => socket.emit('host:lobby', {}, ack), opts),
    final: (opts) => act((ack) => socket.emit('host:final', {}, ack), opts),
    reset: (opts) => act((ack) => socket.emit('host:reset', {}, ack), opts),
    kick: (playerId, opts) => act((ack) => socket.emit('host:kick', { playerId }, ack), opts),
    cutscene: (id, opts) => act((ack) => socket.emit('host:cutscene', { id }, ack), opts),
    cutsceneEnd: (opts) => act((ack) => socket.emit('host:cutsceneEnd', {}, ack), opts),
    setAutoCutscenes: (enabled, opts) => act((ack) => socket.emit('host:setAutoCutscenes', { enabled }, ack), opts),
    relay: (data: RelayData): void => {
      if (socket.connected) socket.emit('host:relay', { data }, () => undefined);
    },
    onRelay: (fn: RelayListener): (() => void) => {
      relayListeners.add(fn);
      return () => {
        relayListeners.delete(fn);
      };
    },
    newRoom: (): void => {
      if (!socket.connected) {
        say('אין חיבור לשרת כרגע.');
        return;
      }
      setLostRoom(null);
      stateRef.current = null;
      socket.emit('host:create', {}, (res) => {
        if (!res.ok) {
          say(`לא הצלחנו לפתוח חדר: ${ERROR_TEXT[res.error]}`);
          return;
        }
        writeStore(CODE_KEY, res.code);
        writeStore(HOSTKEY_KEY, res.hostKey);
        applyState(res.state);
        say(`נפתח חדר חדש: ${res.code}`, 'info');
      });
    },
  };
}
