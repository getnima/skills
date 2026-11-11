/**
 * The host's live link to the server: one socket, the server clock, the room
 * snapshot and the live scores. Everything the TV renders comes from here.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { connect, createServerClock } from '../net/connection';

import type { Ack, ErrorCode, GameId, RoomState } from '../../../shared/protocol';
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
};

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
  start(gameId: GameId): Promise<boolean>;
  endRound(): Promise<boolean>;
  lobby(): Promise<boolean>;
  final(): Promise<boolean>;
  reset(): Promise<boolean>;
  kick(playerId: string): Promise<boolean>;
  cutscene(id: string): Promise<boolean>;
  cutsceneEnd(): Promise<boolean>;
  setAutoCutscenes(enabled: boolean): Promise<boolean>;
  newRoom(): void;
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

  const say = (text: string, tone: RoomNotice['tone'] = 'error'): void => {
    noticeSeq.current += 1;
    setNotice({ id: noticeSeq.current, text, tone });
  };

  const applyState = (next: RoomState): void => {
    const prev = stateRef.current;
    const prevRound = prev?.round?.index ?? null;
    const nextRound = next.round?.index ?? null;
    if (prevRound !== nextRound || prev?.code !== next.code) setScores(new Map());
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
    const onReconnectAttempt = (): void => setStatus('connecting');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    socket.on('scores', onScores);
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
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      document.removeEventListener('visibilitychange', onVisible);
      socket.close();
    };
  }, [socket, clock]);

  const act = (run: (ack: (res: Ack<{}>) => void) => void): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (!socket.connected) {
        say('אין חיבור לשרת כרגע. מנסים להתחבר מחדש…');
        resolve(false);
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        say('השרת לא ענה. נסו שוב.');
        resolve(false);
      }, 6_000);
      run((res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!res.ok) say(ERROR_TEXT[res.error]);
        resolve(res.ok);
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
    start: (gameId) => act((ack) => socket.emit('host:start', { gameId }, ack)),
    endRound: () => act((ack) => socket.emit('host:endRound', {}, ack)),
    lobby: () => act((ack) => socket.emit('host:lobby', {}, ack)),
    final: () => act((ack) => socket.emit('host:final', {}, ack)),
    reset: () => act((ack) => socket.emit('host:reset', {}, ack)),
    kick: (playerId) => act((ack) => socket.emit('host:kick', { playerId }, ack)),
    cutscene: (id) => act((ack) => socket.emit('host:cutscene', { id }, ack)),
    cutsceneEnd: () => act((ack) => socket.emit('host:cutsceneEnd', {}, ack)),
    setAutoCutscenes: (enabled) => act((ack) => socket.emit('host:setAutoCutscenes', { enabled }, ack)),
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
