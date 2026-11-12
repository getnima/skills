/**
 * The phone's single source of truth: socket, server clock, identity and the
 * latest RoomState. Screens render from `snapshot()` + `now()` only.
 */
import { LOOK_SEND_INTERVAL_MS } from '../../../shared/protocol';
import { applyLooks } from '../../../shared/room-looks';
import { connect, createServerClock } from '../net/connection';
import { createDressing, dressStepEnabled } from './dressing-state';
import {
  clearIdentity,
  isValidCode,
  loadIdentity,
  loadLastLook,
  loadLastName,
  loadLastRoom,
  loadLookMemory,
  loadRoundScore,
  normalizeCode,
  saveIdentity,
  saveLastLook,
  saveLookMemory,
  saveRoundScore,
} from './identity';
import { createLookSender } from './look-sender';

import type { ErrorCode, RoomState } from '../../../shared/protocol';
import type { PartySocket, ServerClock } from '../net/connection';
import type { Identity } from './identity';

export type Status =
  /** Resuming a stored identity: a splash until the server answers. */
  | 'boot'
  /** The join form. */
  | 'join'
  /** Join tapped, waiting for the ack. */
  | 'joining'
  /** In the room. */
  | 'in'
  | 'kicked'
  /** The room this phone belonged to does not exist any more. */
  | 'closed';

export interface Snapshot {
  readonly status: Status;
  /** Socket up AND (when in a room) re-joined after the last reconnect. */
  readonly online: boolean;
  readonly code: string;
  /** The code came valid from the URL (or a resumed identity): shown, not editable. */
  readonly codeLocked: boolean;
  readonly name: string;
  readonly playerId: string | null;
  readonly state: RoomState | null;
  readonly joinError: string | null;
  /** Round this player joined too late for. */
  readonly lateRound: number | null;
  /** Round whose game ended on this phone (final score sent / sending). */
  readonly endedRound: number | null;
  /** performance.now() when `endedRound` was set (drives the short "sending" beat). */
  readonly endedAt: number;
  /** Score this phone reported as final for `endedRound`. */
  readonly endedScore: number;
  /** Final score of `endedRound` acknowledged by the server. */
  readonly finalAcked: boolean;
  /** This phone's doll (an encoded look, shared/avatar.ts): what the guest sees, ahead of the server. Null before the first join answer. */
  readonly look: string | null;
  /** The guest has been through the dressing room in this room (rules: dressing-state.ts). */
  readonly dressed: boolean;
  /** The guest asked for the dressing room from the waiting screen. */
  readonly dressing: boolean;
}

const JOIN_TIMEOUT_MS = 7_000;
const FINAL_TIMEOUT_MS = 4_000;
const LOOK_TIMEOUT_MS = 4_000;
/** Back from a locked screen / another app after at least this long: check the link at once. */
const RETURN_MIN_AWAY_MS = 1_000;
const RETURN_CHECK_MS = 2_000;
/** Server pingInterval + pingTimeout (server/app.ts): away this long, the socket is gone. */
const DEAD_AFTER_MS = 14_000;
/** While visible: a ping every few seconds; two unanswered in a row = a dead link, reconnect. */
const HEALTH_EVERY_MS = 4_000;
const HEALTH_TIMEOUT_MS = 3_000;

const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  ROOM_NOT_FOUND: 'לא מצאנו חדר עם הקוד הזה 🤔 בדקו את הקוד על הטלוויזיה',
  ROOM_FULL: 'אוי, החדר מלא 😬 תבקשו מהמנחה לפנות מקום',
  BAD_NAME: 'צריך שם! משהו קצר ומצחיק 😄',
  KICKED: 'המנחה הוציא אותך מהמשחק',
};

function errorText(code: ErrorCode | 'TIMEOUT'): string {
  if (code === 'TIMEOUT') return 'השרת לא עונה 📡 בדקו את החיבור ונסו שוב';
  return ERROR_TEXT[code] ?? 'משהו השתבש, נסו שוב';
}

type Listener = (snap: Snapshot) => void;

/** The latest `scores` broadcast this phone received (live raw scores, strict live order). */
export interface LiveScores {
  readonly round: number;
  readonly scores: ReadonlyArray<readonly [string, number]>;
  /** Participants still playing; null from a server that does not send it. */
  readonly active: number | null;
  /** Ids of the participants whose final is in (elimination: who is out). */
  readonly out: readonly string[];
  /** performance.now() when it arrived. */
  readonly at: number;
  /** Counts every message this phone received (since the page loaded). */
  readonly seq: number;
}
type ScoresListener = (msg: LiveScores) => void;

export interface PlayerController {
  snapshot(): Snapshot;
  subscribe(fn: Listener): () => void;
  /** Server epoch ms. */
  now(): number;
  /** Join tapped (a user gesture). */
  join(code: string, name: string): void;
  setCode(code: string): void;
  setName(name: string): void;
  /** Forget this room's identity and show the join form (after kicked / closed). */
  restart(): void;
  isParticipant(roundIndex: number): boolean;
  /** The dressing room reported a look (an encoded look): remembered at once, sent at most every LOOK_SEND_INTERVAL_MS. */
  setLook(look: string): void;
  /** Open the dressing room from the waiting screen. */
  openDressing(): void;
  /** "Done" in the dressing room: the latest look goes out now. */
  closeDressing(): void;
  /** Live score while playing (throttled by the stage). Never lowers within a round. */
  sendScore(roundIndex: number, score: number): number;
  /** The game is over on this phone: send the final (retries until acked or the round is gone). */
  endRound(roundIndex: number, score: number): void;
  /** The game said nothing more can be gained: send the final now, keep the game on screen. */
  finishEarly(roundIndex: number, score: number): void;
  /** Best score this phone reported for a round (survives a reload of the tab). */
  bestScore(roundIndex: number): number;
  /**
   * Latest live `scores` message (any round: check `round`), or null before the first one
   * after a (re)load. Kept out of the snapshot on purpose: it changes 4 times a second and
   * only the stage HUD needs it, so no screen re-renders for it.
   */
  liveScores(): LiveScores | null;
  onLiveScores(fn: ScoresListener): () => void;
}

export function createController(): PlayerController {
  const params = new URLSearchParams(window.location.search);
  const urlCode = normalizeCode(params.get('room'));
  const codeFromUrl = isValidCode(urlCode);
  // No ?room (e.g. launched from the home screen): resume the last room this phone played in.
  // (Only while this phone still has a seat there: a room it was dropped from is not offered again.)
  const lastRoom = loadLastRoom();
  const startCode = codeFromUrl ? urlCode : isValidCode(lastRoom) && loadIdentity(lastRoom) !== null ? lastRoom : '';
  const stored = isValidCode(startCode) ? loadIdentity(startCode) : null;

  let identity: Identity | null = stored;
  let snap: Snapshot = {
    status: stored ? 'boot' : 'join',
    online: false,
    code: startCode,
    codeLocked: codeFromUrl || stored !== null,
    name: stored?.name ?? loadLastName(),
    playerId: null,
    state: null,
    joinError: null,
    lateRound: stored?.lateRound ?? null,
    endedRound: null,
    endedAt: 0,
    endedScore: 0,
    finalAcked: false,
    look: null,
    dressed: false,
    dressing: false,
  };
  const listeners = new Set<Listener>();
  const scoreListeners = new Set<ScoresListener>();
  let live: LiveScores | null = null;
  let liveSeq = 0;
  const best = new Map<number, number>();
  let pendingFinal: { round: number; score: number } | null = null;
  let ackedFinal: { round: number; score: number } | null = null;
  let finalInFlight = false;
  let finalRetry: ReturnType<typeof setTimeout> | null = null;
  let resumeInFlight = false;
  let resumeRetry: ReturnType<typeof setTimeout> | null = null;

  const socket: PartySocket = connect();
  const clock: ServerClock = createServerClock(socket);

  function set(patch: Partial<Snapshot>): void {
    snap = { ...snap, ...patch };
    for (const fn of [...listeners]) fn(snap);
  }

  function persist(patch: Partial<Identity>): void {
    if (identity === null) return;
    identity = { ...identity, ...patch };
    saveIdentity(snap.code, identity);
  }

  // ── the doll: the look, "dressed", the dressing room (rules in dressing-state.ts) ──
  const lookSender = createLookSender({
    send: (look, done) => {
      socket.timeout(LOOK_TIMEOUT_MS).emit('player:look', { look }, (err, res) => {
        if (!err && res.ok) dressing.confirmed(look, res.look);
        // BAD_REQUEST: the server will never take this text. Anything else (no answer, not in the room yet) is tried again.
        done(!err && (res.ok || res.error === 'BAD_REQUEST'));
      });
    },
    ready: () => socket.connected && snap.status === 'in' && snap.online,
    intervalMs: LOOK_SEND_INTERVAL_MS,
    retryMs: 1_000,
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    onPending: (pending) => dressing.pending(pending),
  });
  const dressing = createDressing({
    sender: lookSender,
    stepEnabled: dressStepEnabled(window.location.search, navigator.webdriver === true),
    load: loadLookMemory,
    save: saveLookMemory,
    loadLast: loadLastLook,
    saveLast: saveLastLook,
    onChange: (d) => set({ look: d.look, dressed: d.dressed, dressing: d.dressing }),
  });

  // ── state ──
  function applyState(state: RoomState): void {
    if (snap.status !== 'in' || state.code !== snap.code) return;
    if (!clock.synced) clock.hint(state.serverNow);
    // a new intro: measure the server clock afresh before the 3-2-1 (the TV does the same)
    const before = snap.state;
    if (state.phase === 'intro' && (before?.phase !== 'intro' || before.round?.index !== state.round?.index) && socket.connected) void clock.sync(6);
    const patch: { -readonly [K in keyof Snapshot]?: Snapshot[K] } = { state };
    // A new round started: forget the previous round's local end.
    if (snap.endedRound !== null && state.round !== null && state.round.index !== snap.endedRound) {
      patch.endedRound = null;
      patch.finalAcked = false;
    }
    if (pendingFinal !== null && (state.phase !== 'playing' || state.round?.index !== pendingFinal.round)) {
      pendingFinal = null; // the server scored the round without it (live score counts)
    }
    set(patch);
    // a round taking over closes the dressing room (and sends the latest look)
    dressing.phase(state.phase);
  }

  // ── join / resume ──
  function onJoined(code: string, playerId: string, secret: string, name: string, state: RoomState, fresh: boolean): void {
    let lateRound = identity?.lateRound ?? null;
    if (fresh) {
      const running = state.round !== null && (state.phase === 'intro' || state.phase === 'countdown' || state.phase === 'playing');
      lateRound = running && state.round !== null ? state.round.index : null;
    }
    identity = { playerId, secret, name, lateRound };
    saveIdentity(code, identity);
    // A reload must land in this room even when the code was typed by hand.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('room') !== code) {
        url.searchParams.set('room', code);
        window.history.replaceState(null, '', url.toString());
      }
    } catch {
      // ignore
    }
    suspect = false;
    snap = { ...snap, status: 'in', online: true, code, codeLocked: true, playerId, name, joinError: null, lateRound };
    dressing.joined(code, state.players.find((p) => p.id === playerId)?.look ?? null, fresh);
    applyState(state);
    void clock.sync();
    flushFinal();
  }

  function resume(): void {
    if (identity === null || resumeInFlight) return;
    if (resumeRetry !== null) clearTimeout(resumeRetry);
    resumeRetry = null;
    resumeInFlight = true;
    const id = identity;
    const code = snap.code;
    socket.timeout(JOIN_TIMEOUT_MS).emit('player:join', { code, name: id.name, playerId: id.playerId, secret: id.secret }, (err, res) => {
      resumeInFlight = false;
      if (err) {
        // No answer: try again while the socket is up (a reconnect also retries).
        if (socket.connected) resumeRetry = setTimeout(resume, 1_000);
        return;
      }
      if (res.ok) {
        onJoined(code, res.playerId, res.secret, res.state.players.find((p) => p.id === res.playerId)?.name ?? id.name, res.state, false);
        return;
      }
      if (res.error === 'ROOM_NOT_FOUND') {
        clearIdentity(code);
        identity = null;
        set({ status: 'closed', online: true, state: null, playerId: null });
      } else if (res.error === 'KICKED') {
        clearIdentity(code);
        identity = null;
        set({ status: 'kicked', online: true, state: null, playerId: null });
      } else {
        clearIdentity(code);
        identity = null;
        set({ status: 'join', joinError: errorText(res.error), state: null, playerId: null });
      }
    });
  }

  socket.on('connect', () => {
    void clock.sync();
    if (identity !== null && (snap.status === 'in' || snap.status === 'boot')) resume();
    else set({ online: true });
  });
  socket.on('disconnect', () => {
    resumeInFlight = false;
    finalInFlight = false;
    set({ online: false });
  });
  socket.on('state', applyState);
  // somebody's doll changed: a small patch, not a whole state
  socket.on('looks', (msg) => {
    if (snap.status !== 'in' || snap.state === null) return;
    const next = applyLooks(snap.state, msg?.looks);
    if (next !== snap.state) set({ state: next });
  });
  socket.on('scores', (msg) => {
    live = {
      round: msg.round,
      scores: msg.scores,
      active: typeof msg.active === 'number' ? msg.active : null,
      out: Array.isArray(msg.out) ? msg.out : [],
      at: performance.now(),
      seq: ++liveSeq,
    };
    for (const fn of [...scoreListeners]) {
      try {
        fn(live);
      } catch (err) {
        console.error('[controller] scores listener failed', err);
      }
    }
    if (snap.lateRound !== msg.round || snap.playerId === null) return;
    if (msg.scores.some(([id]) => id === snap.playerId)) {
      persist({ lateRound: null });
      set({ lateRound: null });
    }
  });
  socket.on('kicked', () => {
    clearIdentity(snap.code);
    identity = null;
    pendingFinal = null;
    set({ status: 'kicked', state: null, playerId: null });
  });

  // ── link health ──
  // A locked phone or a switched app comes back with a socket that may look connected
  // but is dead (iOS drops it silently) and a clock that may have drifted. Check at
  // once on return, and every few seconds while visible, instead of waiting for
  // socket.io's own ping timeout (~14 s of a stale screen).
  let hiddenAt = 0;
  let healthInFlight = false;
  let healthFails = 0;

  /** Bumped by every forced reconnect: an answer to a ping sent before it is stale. */
  let linkGen = 0;
  /** Last time this page's timers ran. A frozen / suspended page (iOS lock) stops them. */
  let lastAlive = Date.now();

  let forcedAt = 0;

  function forceReconnect(): void {
    forcedAt = Date.now();
    linkGen++;
    healthFails = 0;
    // disconnect() + connect() also skips socket.io's reconnect back-off and a connect
    // attempt left hanging from before the lock: a new attempt starts right now.
    socket.disconnect();
    socket.connect();
  }

  function onReturn(awayMs: number): void {
    // How long nothing ran here: the hidden time, or longer when the page was frozen
    // (an 'online' or 'pageshow' event after a lock does not know about the lock).
    const silentMs = Math.max(awayMs, Date.now() - lastAlive);
    lastAlive = Date.now();
    // One unlock fires several events ('online', 'visibilitychange', 'pageshow'): one reconnect.
    if (Date.now() - forcedAt < 3_000) return;
    // Away longer than the server's ping window: the server has dropped this socket for
    // sure. Not connected: socket.io may sit in a back-off delay. Either way, reconnect now.
    if (silentMs >= DEAD_AFTER_MS || !socket.connected) {
      forceReconnect();
      return;
    }
    const gen = linkGen;
    socket.timeout(RETURN_CHECK_MS).emit('time:ping', Date.now(), (err) => {
      if (gen !== linkGen) return; // a reconnect already happened since
      if (err) {
        forceReconnect();
        return;
      }
      void clock.sync(3);
      // Fresh state right away (and the server re-attaches this socket if it had dropped it).
      if (identity !== null && snap.status === 'in') resume();
    });
  }

  /**
   * The link looks dead (an unanswered ping, the browser says offline) while the socket
   * still claims to be up: show "reconnecting" now instead of after the reconnect.
   * Cleared by the next answered ping or by the re-join after a reconnect.
   */
  let suspect = false;
  function markSuspect(): void {
    if (suspect || snap.status !== 'in') return;
    suspect = true;
    if (snap.online) set({ online: false });
  }
  function clearSuspect(): void {
    if (!suspect) return;
    suspect = false;
    if (!snap.online && socket.connected && !resumeInFlight && snap.status === 'in') set({ online: true });
  }

  function heartbeat(): void {
    if (document.visibilityState !== 'visible' || !socket.connected || healthInFlight) return;
    healthInFlight = true;
    const gen = linkGen;
    socket.timeout(HEALTH_TIMEOUT_MS).emit('time:ping', Date.now(), (err) => {
      healthInFlight = false;
      if (gen !== linkGen) return;
      if (!err) {
        healthFails = 0;
        clearSuspect();
        return;
      }
      healthFails++;
      markSuspect();
      if (healthFails >= 2 && socket.connected) forceReconnect();
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt > 0 ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away >= RETURN_MIN_AWAY_MS) onReturn(away);
    });
    window.addEventListener('pageshow', (e: PageTransitionEvent) => {
      if (e.persisted) onReturn(0);
    });
    window.addEventListener('online', () => onReturn(0));
    window.addEventListener('offline', markSuspect);
    setInterval(heartbeat, HEALTH_EVERY_MS);
    setInterval(() => {
      // Timers that did not run for a long while = the page was frozen: treat it as a return.
      const gap = Date.now() - lastAlive;
      lastAlive = Date.now();
      if (gap >= DEAD_AFTER_MS && document.visibilityState === 'visible') onReturn(gap);
      // The phone's own clock was set back (or forward a little, NTP): measure the offset again.
      else if ((gap < -1_000 || gap > 3_000) && socket.connected) void clock.sync(3);
    }, 1_000);
  }

  // ── final score ──
  function flushFinal(): void {
    if (pendingFinal === null || finalInFlight || !socket.connected || snap.status !== 'in') return;
    if (finalRetry !== null) clearTimeout(finalRetry);
    finalRetry = null;
    const req = pendingFinal;
    finalInFlight = true;
    socket.timeout(FINAL_TIMEOUT_MS).emit('player:final', { round: req.round, score: req.score }, (err, res) => {
      finalInFlight = false;
      if (pendingFinal !== req) return;
      if (err) {
        finalRetry = setTimeout(flushFinal, 800);
        return;
      }
      pendingFinal = null;
      if (res.ok) {
        ackedFinal = req;
        if (snap.endedRound === req.round) set({ finalAcked: true });
        return;
      }
      if (res.error === 'BAD_REQUEST' && /participant/.test(res.message)) {
        persist({ lateRound: req.round });
        set({ lateRound: req.round });
      }
      // BAD_PHASE: the round is already scored; nothing more to send.
      if (snap.endedRound === req.round) set({ finalAcked: true });
    });
  }

  /** Once per round: the first acked final wins on the server, so never resend it. */
  function queueFinal(roundIndex: number, value: number): void {
    if (ackedFinal !== null && ackedFinal.round === roundIndex) return;
    if (pendingFinal === null || pendingFinal.round !== roundIndex || pendingFinal.score < value) {
      pendingFinal = { round: roundIndex, score: value };
    }
    flushFinal();
  }

  const controller: PlayerController = {
    snapshot: (): Snapshot => snap,
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return (): void => {
        listeners.delete(fn);
      };
    },
    now: (): number => clock.now(),
    join(code: string, name: string): void {
      if (snap.status === 'joining') return;
      const c = normalizeCode(code);
      if (!isValidCode(c)) {
        set({ joinError: 'הקוד צריך להיות 4 אותיות באנגלית, כמו שכתוב על הטלוויזיה', codeLocked: false });
        return;
      }
      const clean = name.trim();
      if (clean.length === 0) {
        set({ joinError: errorText('BAD_NAME') });
        return;
      }
      // A different room than the stored one: start a fresh identity there.
      const existing = loadIdentity(c);
      set({ status: 'joining', joinError: null, code: c, name: clean });
      socket
        .timeout(JOIN_TIMEOUT_MS)
        .emit(
          'player:join',
          { code: c, name: clean, playerId: existing?.playerId, secret: existing?.secret, look: dressing.joinLook() },
          (err, res) => {
            if (snap.status !== 'joining') return;
            if (err) {
              set({ status: 'join', joinError: errorText('TIMEOUT') });
              return;
            }
            if (res.ok) {
              identity = existing;
              const me = res.state.players.find((p) => p.id === res.playerId);
              onJoined(c, res.playerId, res.secret, me?.name ?? clean, res.state, existing === null || existing.playerId !== res.playerId);
              return;
            }
            if (res.error === 'KICKED') clearIdentity(c);
            set({
              status: 'join',
              joinError: errorText(res.error),
              codeLocked: res.error === 'ROOM_NOT_FOUND' ? false : snap.codeLocked,
            });
          },
        );
    },
    setCode(code: string): void {
      set({ code: normalizeCode(code), joinError: null });
    },
    setName(name: string): void {
      set({ name, joinError: null });
    },
    restart(): void {
      clearIdentity(snap.code);
      identity = null;
      pendingFinal = null;
      const closed = snap.status === 'closed';
      if (closed) {
        // That room is gone: an empty code field, and a reload must not try it again.
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.has('room')) {
            url.searchParams.delete('room');
            window.history.replaceState(null, '', url.toString());
          }
        } catch {
          // ignore
        }
      }
      set({
        code: closed ? '' : snap.code,
        status: 'join',
        state: null,
        playerId: null,
        joinError: null,
        codeLocked: snap.status === 'kicked' ? snap.codeLocked : false,
        lateRound: null,
        endedRound: null,
        online: socket.connected,
      });
    },
    isParticipant(roundIndex: number): boolean {
      return snap.lateRound !== roundIndex;
    },
    bestScore(roundIndex: number): number {
      const mem = best.get(roundIndex);
      if (mem !== undefined) return mem;
      const saved = loadRoundScore(snap.code, roundIndex);
      best.set(roundIndex, saved);
      return saved;
    },
    sendScore(roundIndex: number, score: number): number {
      const value = Math.max(controller.bestScore(roundIndex), Math.max(0, Math.round(score)));
      best.set(roundIndex, value);
      saveRoundScore(snap.code, roundIndex, value);
      if (socket.connected) socket.volatile.emit('player:score', { round: roundIndex, score: value });
      return value;
    },
    endRound(roundIndex: number, score: number): void {
      const value = Math.max(controller.bestScore(roundIndex), Math.max(0, Math.round(score)));
      best.set(roundIndex, value);
      saveRoundScore(snap.code, roundIndex, value);
      const already = ackedFinal !== null && ackedFinal.round === roundIndex;
      if (snap.endedRound !== roundIndex) {
        set({ endedRound: roundIndex, endedAt: performance.now(), endedScore: value, finalAcked: already });
      }
      queueFinal(roundIndex, value);
    },
    finishEarly(roundIndex: number, score: number): void {
      const value = Math.max(controller.bestScore(roundIndex), Math.max(0, Math.round(score)));
      queueFinal(roundIndex, value);
    },
    setLook: (look: string): void => dressing.setLook(look),
    openDressing: (): void => dressing.open(),
    closeDressing: (): void => dressing.close(),
    liveScores: (): LiveScores | null => live,
    onLiveScores(fn: ScoresListener): () => void {
      scoreListeners.add(fn);
      return (): void => {
        scoreListeners.delete(fn);
      };
    },
  };
  return controller;
}
