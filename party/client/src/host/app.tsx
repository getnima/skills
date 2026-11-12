/**
 * The TV host page: the frame around the show. It renders purely from the
 * room snapshot, the live scores and the server clock, and keeps the host's
 * controls in a slim strip under the scene.
 *
 * Every control (the strip, the menus, the keyboard, a phone remote) goes
 * through ONE action model (./actions.ts) and ONE dispatcher (`runAction`).
 * While a phone remote is attached (state.remotes > 0) the TV is a display:
 * the strip is hidden; the mouse shows it for a few seconds, keys keep working.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { findCutscene } from '../../../shared/cutscenes';
import { GAMES, GAME_IDS } from '../../../shared/protocol';
import { roundTime } from '../../../shared/round-clock';
import { isMuted, preloadClips, setMuted, sfx, unlockAudio } from '../kit/audio';
import { avSync, onAvSyncChange, pictureClock, pictureLeadMs, soundOffsetMs } from '../kit/av-sync';
import { enterFullscreen } from '../kit/mobile';
import { preloadOn } from '../kit/preload';
import { buildControlModel, checkAction, confirmQuestion, findAction, isGameId, nextUnplayed, parseRelay, remoteView, toRelay } from './actions';
import { CreditsPanel } from './credits';
import { CutsceneMenu, CutscenePlayer } from './cutscene';
import { GoSplash, markResumeGo, markStartGong, PreRoundScreen, ResumeOverlay, startGongScheduled, useCountdownCues } from './intro';
import { applyAvAdjust, AvSyncScreen } from './av-sync-screen';
import { retryTvPreload, TV_CLIPS, tvPreloadProgress, useTvPreload } from './boot-preload';
import { Lobby } from './lobby';
import { SoundCheck, useShowMusic } from './music';
import { Narrator } from './narrator';
import { useHostRoom } from './room';
import { FinalScene, isShowCalm, onShowCalmChange, PlayingScene, ResultsScene, setShowCalm, standingsAt } from './show/index';
import { Btn, ConfirmDialog, Modal, Switch, Toast } from './ui';
import { useAudioLocked, useMuted } from './util';

import type { JSX } from 'preact';
import type { RoomState, RoundPublic } from '../../../shared/protocol';
import type { RoundClockSample } from '../games/types';
import type { PreloadProgress } from '../kit/preload';
import type { ServerClock } from '../net/connection';
import type { ActionId, ControlAction, ControlModel } from './actions';
import type { ActResult, HostRoom } from './room';
import type { ConfirmRequest } from './ui';

/** 'credits' is TV-local (an information panel, not an action of the control model). */
type MenuKind = 'none' | 'cutscenes' | 'more' | 'sound' | 'credits' | 'sync';

/** Automation hook for the browser tests (read-only). */
export interface HostHooks {
  state(): RoomState | null;
  /** Server time. */
  now(): number;
  status(): string;
  /** The current action model. */
  model(): ControlModel;
  /** How far the background loading is (boot-preload.ts): wait for `finished`, then read `failed`. */
  preload(): PreloadProgress;
}

declare global {
  interface Window {
    __host?: HostHooks;
  }
}

/** Keyboard actions are ignored this long after the phase changed (Space-Space must not skip two screens). */
const KEY_GUARD_MS = 1_500;
/** A risky action asks for a second press within this window. */
const ARM_MS = 3_500;
/** ...but not sooner than this after the first one (a double tap does not count). */
const ARM_MIN_MS = 400;

/** Re-render every `ms` while `on` (labels that depend on the clock). */
function useEvery(ms: number, on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => set((n) => (n + 1) % 1_000_000), ms);
    return () => clearInterval(id);
  }, [ms, on]);
}

/** The control strip dims after this long without the mouse or a key (it is on the TV too). */
const STRIP_IDLE_MS = 7_000;

/** True after STRIP_IDLE_MS without pointer movement or a key press. */
function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), ms);
    const wake = (): void => {
      clearTimeout(t);
      setIdle(false);
      t = setTimeout(() => setIdle(true), ms);
    };
    window.addEventListener('pointermove', wake, true);
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointermove', wake, true);
      window.removeEventListener('pointerdown', wake, true);
      window.removeEventListener('keydown', wake, true);
    };
  }, [ms]);
  return idle;
}

function useFullscreen(): boolean {
  const [fs, setFs] = useState(document.fullscreenElement !== null);
  useEffect(() => {
    const on = (): void => setFs(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  return fs;
}

function toggleFullscreen(): void {
  if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => undefined);
  else void enterFullscreen();
}

function useCalm(): boolean {
  const [calm, setCalm] = useState(isShowCalm());
  useEffect(() => onShowCalmChange(setCalm), []);
  return calm;
}

/** "יאללה!" only when the round has just started (not after a refresh mid-round). */
function RoundGo(props: { readonly round: RoundPublic; readonly clock: ServerClock }): JSX.Element | null {
  const [fresh] = useState(() => {
    const rt = roundTime(props.round, props.clock.now());
    return !rt.frozen && rt.elapsedMs < 1_200;
  });
  // the gong itself is on the audio clock for the exact start (useCountdownCues); the splash only draws,
  // carrying on the GO the countdown screen already drew from the clock
  return fresh ? <GoSplash gong quiet={startGongScheduled(props.round.index)} at={props.round.startAt} clock={props.clock} soundKey={`start:${props.round.index}`} /> : null;
}

function PlayingView(props: { readonly state: RoomState; readonly round: RoundPublic; readonly room: HostRoom; readonly showClock: ServerClock }): JSX.Element {
  const { state, round, room } = props;
  const roundRef = useRef(round);
  roundRef.current = round;
  const clockRef = useRef((): RoundClockSample => {
    const rt = roundTime(roundRef.current, room.clock.now());
    return { leftMs: rt.leftMs, frozen: rt.frozen };
  });
  const covered = state.cutscene !== null;
  return (
    <div class="hs-scene-wrap" data-testid="playing">
      <PlayingScene
        game={GAMES[round.gameId]}
        roundIndex={round.number - 1}
        players={state.players}
        scores={room.scores}
        clock={clockRef.current}
        durationMs={round.endAt - round.startAt}
      />
      <RoundGo key={round.index} round={round} clock={props.showClock} />
      <ResumeOverlay round={round} clock={props.showClock} covered={covered} />
    </div>
  );
}

function ResultsView(props: { readonly state: RoomState; readonly room: HostRoom; readonly replay: number; readonly replayAt: number | null }): JSX.Element | null {
  const res = props.state.results;
  const results = useMemo(
    () => (res !== null && props.replayAt !== null ? { ...res, revealAt: props.replayAt } : res),
    [res, props.replayAt],
  );
  if (res === null || results === null) {
    return (
      <div class="hs-wait">
        <div class="hs-wait-text">מחשבים תוצאות…</div>
      </div>
    );
  }
  return (
    <div class="hs-scene-wrap" data-testid="results">
      <ResultsScene
        key={`${res.roundIndex}:${props.replay}`}
        game={GAMES[res.gameId]}
        results={results}
        now={props.room.clock.now}
        active={props.state.cutscene === null}
      />
    </div>
  );
}

function Connection(props: { readonly room: HostRoom }): JSX.Element {
  const { status, state } = props.room;
  const text = status === 'online' ? 'מחובר' : status === 'connecting' ? 'מתחבר…' : 'אין חיבור';
  return (
    <div class={`hs-conn hs-conn--${status}`} data-testid="conn" data-status={status}>
      <span class="hs-conn-dot" />
      <span class="hs-conn-text">{text}</span>
      {state !== null ? (
        <span class="hs-conn-code" dir="ltr">
          {state.code}
        </span>
      ) : null}
    </div>
  );
}

/** While a remote is attached, moving the mouse on the laptop shows the strip this long. */
const PEEK_MS = 4_000;
/** A model change is sent to the remotes at most this often (players pouring in, the results clock). */
const PUBLISH_MS = 120;

/** TV-only looks of the strip buttons (the model says what they do, not how the TV draws them). */
const STRIP_ORDER: readonly ActionId[] = ['podium', 'reset', 'end-round', 'replay', 'lobby'];
const STRIP_TEST_ID: Readonly<Partial<Record<ActionId, string>>> = {
  podium: 'btn-final',
  reset: 'btn-reset',
  'end-round': 'btn-end',
  replay: 'btn-again',
  lobby: 'btn-lobby',
};

type Source = 'click' | 'key' | 'remote';

interface RunOptions {
  readonly source: Source;
  /** The presser already confirmed (the remote's own "sure?" sheet). */
  readonly confirmed?: boolean;
  /** The screen key the presser saw (remote presses on an older screen are refused). */
  readonly key?: string;
}

const done = (text: string): ActResult => ({ ok: true, text });
const refused = (text: string): ActResult => ({ ok: false, text });

/** True while the pointer moved within PEEK_MS (only listens while `on`). */
function usePeek(on: boolean): boolean {
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    if (!on) {
      setPeek(false);
      return undefined;
    }
    let t: ReturnType<typeof setTimeout> | undefined;
    const wake = (): void => {
      setPeek(true);
      if (t !== undefined) clearTimeout(t);
      t = setTimeout(() => setPeek(false), PEEK_MS);
    };
    window.addEventListener('pointermove', wake, true);
    window.addEventListener('pointerdown', wake, true);
    return () => {
      if (t !== undefined) clearTimeout(t);
      window.removeEventListener('pointermove', wake, true);
      window.removeEventListener('pointerdown', wake, true);
    };
  }, [on]);
  return peek;
}

/**
 * How much of the TV's files is in (boot-preload.ts), on the boot card: the card is on screen
 * anyway while the room is being opened, and it never stays for the files. Nothing is drawn with
 * `?preload=0`: nothing is being loaded.
 */
function BootBar(): JSX.Element | null {
  const { progress } = useTvPreload();
  if (progress.files === 0) return null;
  const pct = Math.round(progress.fraction * 100);
  return (
    <div class="hs-boot-bar" role="progressbar" aria-label="טוענים את המופע" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} data-testid="boot-bar">
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The files that are still coming once the room is up: a thin line on the stage's top edge. It
 * shows only when the loading is really taking a while (a refresh from the cache never flashes
 * it) and goes the moment the last file is in. It takes no input and no room.
 */
function PreloadBar(): JSX.Element | null {
  const { progress, late } = useTvPreload();
  if (!late) return null;
  return (
    <div class="hs-preload-bar" aria-hidden="true" data-testid="preload-bar">
      <i style={{ width: `${(progress.fraction * 100).toFixed(1)}%` }} />
    </div>
  );
}

export function App(): JSX.Element {
  const room = useHostRoom();
  const { state } = room;
  const muted = useMuted();
  const locked = useAudioLocked();
  const fullscreen = useFullscreen();
  const calm = useCalm();
  const [menu, setMenu] = useState<MenuKind>('none');
  // the TV's sound / picture delay (AirPlay): its clock for what is drawn by the server clock
  const [, setAvRev] = useState(0);
  useEffect(() => onAvSyncChange(() => setAvRev((n) => n + 1)), []);
  const showClock = useMemo(() => pictureClock(room.clock), [room.clock]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [replay, setReplay] = useState(0);
  const [replayAt, setReplayAt] = useState<number | null>(null);
  /** A risky action waiting for its second press: which one and until when (performance.now()). */
  const [armed, setArmed] = useState<{ readonly id: string; readonly until: number } | null>(null);
  const phaseAt = useRef(performance.now());
  const stripIdle = useIdle(STRIP_IDLE_MS);
  const remotes = state?.remotes ?? 0;
  const display = remotes > 0;
  const peek = usePeek(display);

  const phase = state?.phase ?? null;
  const cutscene = state?.cutscene ?? null;
  useShowMusic(state, room.clock, menu === 'sound');
  const phaseKey = `${state?.code ?? ''}:${phase ?? ''}:${state?.round?.index ?? -1}:${state?.results?.roundIndex ?? -1}`;
  // stamped during render, so a key pressed right after the new screen appears is already guarded
  const lastPhaseKey = useRef(phaseKey);
  if (lastPhaseKey.current !== phaseKey) {
    lastPhaseKey.current = phaseKey;
    phaseAt.current = performance.now();
  }
  useEffect(() => setArmed(null), [phaseKey]);
  useEffect(() => {
    if (phase === 'intro' || phase === 'countdown' || phase === 'playing' || state?.cutscene) setMenu((m) => (m === 'sync' ? 'none' : m));
  }, [phase, state?.cutscene !== null && state?.cutscene !== undefined]);
  // The show's drop-in clips decode once at boot, so the first air horn and gong land on their
  // moment. The preloader's batch does it (boot-preload.ts), so each file comes over the network
  // once; without the preloader (`?preload=0`) it is done here, as before it.
  useEffect(() => {
    if (!preloadOn()) preloadClips(TV_CLIPS);
  }, []);
  // The connection to the server is back: a file the first try lost to the network can be had now.
  const wasOffline = useRef(false);
  useEffect(() => {
    if (room.status !== 'online') wasOffline.current = true;
    else if (wasOffline.current) {
      wasOffline.current = false;
      retryTvPreload();
    }
  }, [room.status]);
  // the 3-2-1 heard from the TV, locked to the server clock: the beeps and the start gong on the
  // audio clock for the exact instants every screen shows (none under a cutscene: it re-plans after)
  const cueRound = state?.round ?? null;
  const startTarget =
    cueRound !== null && (phase === 'intro' || phase === 'countdown' || phase === 'playing') && cutscene === null && cueRound.frozenAt === null ? cueRound.startAt : null;
  useCountdownCues(
    startTarget,
    'gong',
    room.clock,
    () => {
      if (cueRound !== null) markStartGong(cueRound.index);
    },
    cueRound?.countdownMs,
  );
  const resumeTarget = cueRound !== null && phase === 'playing' && cutscene === null && cueRound.frozenAt === null ? cueRound.resumeAt : null;
  useCountdownCues(resumeTarget, 'go', room.clock, () => {
    if (cueRound !== null) markResumeGo(`${cueRound.index}:${cueRound.resumeAt ?? 0}`);
  });
  // the gong when a round is over: play ends and the results come up
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current === 'playing' && phase === 'results') sfx.gong();
    prevPhase.current = phase;
  }, [phase]);
  useEffect(() => {
    if (armed === null) return undefined;
    const t = setTimeout(() => setArmed(null), Math.max(0, armed.until - performance.now()));
    return () => clearTimeout(t);
  }, [armed]);
  /** Run `fn` now when `id` is armed, else arm it (the button then says "press again"). */
  const twice = (id: string, fn: () => void): boolean => {
    const t = performance.now();
    if (armed !== null && armed.id === id && t < armed.until) {
      // a bounce / double tap is not a second decision: the host has to see "sure?" first
      if (t - (armed.until - ARM_MS) < ARM_MIN_MS) return false;
      setArmed(null);
      fn();
      return true;
    }
    setArmed({ id, until: t + ARM_MS });
    return false;
  };
  // the results' "continue" waits for the ceremony; the label follows the clock
  useEvery(500, phase === 'results');

  useEffect(() => {
    const unlock = (): void => unlockAudio();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  // a new round's results / a new phase: the replay starts over
  const resultsKey = `${phase}:${state?.results?.roundIndex ?? -1}`;
  useEffect(() => {
    setReplay(0);
    setReplayAt(null);
  }, [resultsKey]);

  // a cutscene covers everything: close the menus under it
  useEffect(() => {
    if (cutscene !== null) setMenu('none');
  }, [cutscene?.id, cutscene?.startedAt]);

  // the sound check belongs to the lobby: a round starting closes it (and stops its preview)
  useEffect(() => {
    if (menu === 'sound' && phase !== 'lobby') setMenu('none');
  }, [menu, phase]);

  const doReplay = (): void => {
    setReplay((n) => n + 1);
    if (phase === 'results') setReplayAt(room.clock.now() + 5_000);
  };

  // ── the action model: what the host can do right now ──
  const res = state?.results ?? null;
  const ceremonyDone = phase !== 'results' || res === null || room.clock.now() >= standingsAt(replayAt !== null ? { ...res, revealAt: replayAt } : res);
  const sync = { open: menu === 'sync', soundMs: soundOffsetMs(), auto: !avSync().soundSet, pictureMs: pictureLeadMs() };
  const model = buildControlModel({ state, ceremonyDone, muted, calm, fullscreen, sync });
  const modelRef = useRef(model);
  modelRef.current = model;
  const action = (id: ActionId): ControlAction | undefined => findAction(model, id);

  /** Carries out an action that passed its checks and confirm. `quiet`: the error goes back to the remote, not on the TV. */
  const perform = (id: ActionId, arg: string | undefined, quiet: boolean): Promise<ActResult> | ActResult => {
    const q = { quiet };
    const s = state;
    switch (id) {
      case 'next': {
        const g = s !== null ? nextUnplayed(s.played) : null;
        return g !== null ? room.start(g, q) : refused('שיחקנו הכל');
      }
      case 'start':
        return isGameId(arg) ? room.start(arg, q) : refused('אין משחק כזה');
      case 'continue':
      case 'lobby':
        return room.lobby(q);
      case 'podium':
        return room.final(q);
      case 'end-round':
        return room.endRound(q);
      case 'replay':
        doReplay();
        return done('שוב!');
      case 'reset':
        return room.reset(q);
      case 'kick':
        return arg !== undefined ? room.kick(arg, q) : refused('לא נבחר שחקן');
      case 'cutscene':
        return arg !== undefined ? room.cutscene(arg, q) : refused('לא נבחר סרטון');
      case 'cutscene-skip':
        return room.cutsceneEnd(q);
      case 'auto-cutscenes': {
        const want = arg === 'on' ? true : arg === 'off' ? false : !(s?.autoCutscenes ?? true);
        return room.setAutoCutscenes(want, q);
      }
      case 'mute':
        setMuted(arg === 'on' ? true : arg === 'off' ? false : !isMuted());
        return done('בוצע');
      case 'calm':
        setShowCalm(arg === 'on' ? true : arg === 'off' ? false : !isShowCalm());
        return done('בוצע');
      case 'fullscreen':
        toggleFullscreen();
        return done('בוצע');
      case 'cutscene-menu':
        setMenu('cutscenes');
        return done('בוצע');
      case 'more-menu':
        setMenu('more');
        return done('בוצע');
      case 'sound-check':
        setMenu('sound');
        return done('בוצע');
      case 'new-room':
        room.newRoom();
        return done('בוצע');
      case 'av-sync': {
        const want = arg === 'on' ? true : arg === 'off' ? false : menu !== 'sync';
        setMenu(want ? 'sync' : 'none');
        return done('בוצע');
      }
      case 'av-adjust':
        return applyAvAdjust(arg) ? done('בוצע') : refused('לא הבנתי את הכיוון');
      default: {
        const _exhaustive: never = id;
        throw new Error(`Unhandled action: ${String(_exhaustive)}`);
      }
    }
  };

  /**
   * THE dispatcher: every button, key and remote press goes through here. It
   * checks the action against the model, asks its confirm question the TV's way
   * (a second press, or a dialog) unless the presser already confirmed, then runs it.
   */
  const runAction = async (id: ActionId, arg?: string, opts: RunOptions = { source: 'click' }): Promise<ActResult> => {
    const m = modelRef.current;
    const check = checkAction(m, id, arg, opts.key);
    if (!check.ok) return refused(check.text);
    const a = findAction(m, id);
    if (a === undefined) return refused('אי אפשר את זה עכשיו');
    if (opts.source === 'remote' && a.tvOnly === true) return refused('רק מהמסך');
    const remote = opts.source === 'remote';
    if (a.confirm !== undefined && opts.confirmed !== true) {
      if (remote) return refused('צריך לאשר');
      const question = confirmQuestion(a, arg) ?? '';
      if (a.confirmStyle === 'dialog') {
        setConfirm({
          title: question,
          text: a.confirmText,
          yes: a.confirmYes ?? 'כן',
          danger: a.kind === 'danger' || id === 'reset',
          run: () => void perform(id, arg, false),
        });
        return done('ממתין לאישור');
      }
      let ran: Promise<ActResult> | ActResult | null = null;
      twice(id, () => {
        ran = perform(id, arg, false);
      });
      return ran ?? done('ממתין ללחיצה שנייה');
    }
    return perform(id, arg, remote);
  };
  const runRef = useRef(runAction);
  runRef.current = runAction;
  const click = (id: ActionId, arg?: string): void => void runAction(id, arg, { source: 'click' });

  const hookRef = useRef(room);
  hookRef.current = room;
  useEffect(() => {
    window.__host = {
      state: () => hookRef.current.state,
      now: () => hookRef.current.clock.now(),
      status: () => hookRef.current.status,
      model: () => modelRef.current,
      preload: () => tvPreloadProgress(),
    };
  }, []);

  // ── the remotes: the model goes out, presses come in ──
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishNow = (): void => {
    if (publishTimer.current !== null) clearTimeout(publishTimer.current);
    publishTimer.current = null;
    hookRef.current.relay(toRelay({ t: 'model', model: remoteView(modelRef.current) }));
  };
  const publishRef = useRef(publishNow);
  publishRef.current = publishNow;
  const remoteJson = display ? JSON.stringify(remoteView(model)) : '';
  useEffect(() => {
    if (!display || room.status !== 'online') return undefined;
    if (publishTimer.current !== null) return undefined;
    publishTimer.current = setTimeout(() => publishRef.current(), PUBLISH_MS);
    return undefined;
  }, [remoteJson, remotes, display, room.status]);
  useEffect(
    () => () => {
      if (publishTimer.current !== null) clearTimeout(publishTimer.current);
    },
    [],
  );
  useEffect(
    () =>
      hookRef.current.onRelay(({ from, data }) => {
        if (from !== 'remote') return;
        const msg = parseRelay(data);
        if (msg === null) return;
        if (msg.t === 'hello') {
          publishRef.current();
          return;
        }
        if (msg.t !== 'run') return;
        void runRef
          .current(msg.id, msg.arg, { source: 'remote', confirmed: msg.confirmed, key: msg.key })
          .catch((): ActResult => refused('משהו השתבש'))
          .then((r) => {
            hookRef.current.relay(toRelay({ t: 'result', rid: msg.rid, req: msg.req, ok: r.ok, text: r.text }));
            // the remote sees the outcome at once, not after the next debounce
            publishRef.current();
          });
      }),
    [],
  );

  // the next step: the big button. A round's next step (ending it) is a danger action the TV keeps in its strip.
  const primaryAction = model.primary !== null ? action(model.primary) : undefined;
  const tvPrimary = primaryAction !== undefined && primaryAction.kind !== 'danger' ? primaryAction : undefined;

  // keyboard: works with any keyboard layout (physical keys)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (confirm !== null || menu !== 'none') return;
    const code = e.code;
    const key = (id: ActionId, arg?: string): void => void runAction(id, arg, { source: 'key' });
    /** A held key, or a second press right after the screen changed, is not a decision. */
    const guarded = (): boolean => e.repeat || performance.now() - phaseAt.current < KEY_GUARD_MS;
    if (code === 'KeyF') key('fullscreen');
    else if (code === 'KeyM') key('mute');
    else if (state === null) return;
    else if (code === 'KeyS') {
      if (cutscene !== null) key('cutscene-skip');
    } else if (cutscene !== null) return;
    else if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') {
      e.preventDefault();
      if (guarded() || tvPrimary === undefined) return;
      key(tvPrimary.id);
      return;
    } else if (code === 'KeyN') {
      e.preventDefault();
      if (guarded()) return;
      if (action('next')?.enabled === true) key('next');
      return;
    } else if (code === 'KeyE') {
      if (e.repeat) return;
      if (action('end-round')?.enabled === true) key('end-round');
    } else if (code === 'KeyC') key('cutscene-menu');
    else if (code === 'KeyA') key('av-sync');
    else if (code === 'KeyR') {
      if (action('replay')?.enabled === true) key('replay');
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent): void => keyRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // ── the scene ──
  let scene: JSX.Element;
  if (state === null) {
    scene = (
      <div class="hs-boot">
        <div class="hs-boot-logo" aria-hidden="true">
          פארטי <b>ארנה</b>
        </div>
        <div class="hs-boot-text">{room.status === 'offline' ? 'אין חיבור לשרת. מנסים שוב…' : 'מתחברים לשרת…'}</div>
        <BootBar />
      </div>
    );
  } else if (phase === 'lobby') {
    scene = <Lobby state={state} onStart={(g) => click('start', g)} onKick={(p) => click('kick', p.id)} />;
  } else if ((phase === 'intro' || phase === 'countdown') && state.round !== null) {
    const game = GAMES[state.round.gameId];
    // one element through the intro and the 3-2-1: the clock decides which one shows
    scene = <PreRoundScreen key={state.round.index} game={game} round={state.round} clock={showClock} players={state.players.length} covered={cutscene !== null} />;
  } else if (phase === 'playing' && state.round !== null) {
    scene = <PlayingView state={state} round={state.round} room={room} showClock={showClock} />;
  } else if (phase === 'results') {
    scene = <ResultsView state={state} room={room} replay={replay} replayAt={replayAt} />;
  } else if (phase === 'final') {
    scene = (
      <div class="hs-scene-wrap" data-testid="final">
        <FinalScene key={replay} players={state.players} results={state.results} active={cutscene === null} />
      </div>
    );
  } else {
    scene = (
      <div class="hs-wait">
        <div class="hs-wait-text">רגע…</div>
      </div>
    );
  }

  // ── the strip: the model's featured actions, the next step, the tools ──
  const armedText = (a: ControlAction): string => `${confirmQuestion(a) ?? ''} לחצו שוב${a.kbd !== undefined && a.kbd !== 'Space' ? ` (${a.kbd})` : ''}`;
  const stripActions = STRIP_ORDER.map((id) => action(id)).filter(
    (a): a is ControlAction => a !== undefined && a.featured && a.enabled && a.id !== tvPrimary?.id,
  );
  const stripIds = new Set<string>(stripActions.map((a) => a.id));
  const armedAction = armed !== null ? model.actions.find((a) => a.id === armed.id) : undefined;
  const stripButtons = stripActions.map((a) => (
    <Btn
      key={a.id}
      label={a.label}
      icon={a.icon}
      kbd={a.kbd}
      tone={a.id === 'end-round' ? 'danger' : a.id === 'reset' ? 'ghost' : 'plain'}
      title={a.label}
      armed={armed !== null && armed.id === a.id ? armedText(a) : null}
      testId={STRIP_TEST_ID[a.id]}
      onClick={() => click(a.id)}
    />
  ));
  // the primary button also carries the "press again" of a key whose action has no button of its own (N skipping the ceremony)
  const primaryArmed = armedAction !== undefined && tvPrimary !== undefined && !stripIds.has(armedAction.id) ? armedText(armedAction) : null;
  const tool = (id: ActionId): ControlAction | undefined => action(id);
  const cutsceneMenu = tool('cutscene-menu');
  const muteAction = tool('mute');
  const fsAction = tool('fullscreen');
  const calmAction = tool('calm');
  const soundAction = tool('sound-check');
  const resetAction = tool('reset');
  const newRoomAction = tool('new-room');

  const def = cutscene !== null ? findCutscene(cutscene.id) : undefined;
  const stripClass = display ? (peek || armed !== null ? 'is-peek' : 'is-gone') : stripIdle && armed === null ? 'is-idle' : '';

  return (
    <div class={`hs-root hs-phase-${phase ?? 'boot'} ${display ? 'is-display' : ''}`} data-phase={phase ?? 'boot'}>
      <main class="hs-stage">
        {scene}
        {state !== null ? <PreloadBar /> : null}
        <Narrator state={state} clock={room.clock} />
      </main>

      <footer class={`hs-strip ${stripClass}`} data-testid="strip">
        <div class="hs-strip-side">
          <span class="hs-brand" aria-label="Party Arena">
            פארטי <b>ארנה</b>
          </span>
          <Connection room={room} />
        </div>
        <div class="hs-strip-main">
          {stripButtons}
          {tvPrimary !== undefined ? (
            <Btn
              label={tvPrimary.label}
              icon={tvPrimary.icon}
              kbd="Space"
              tone={tvPrimary.confirm !== undefined ? 'plain' : 'primary'}
              class="hs-primary"
              armed={primaryArmed ?? (armed !== null && armed.id === tvPrimary.id ? armedText(tvPrimary) : null)}
              testId="btn-primary"
              onClick={() => click(tvPrimary.id)}
            />
          ) : (
            <span class="hs-next-hint" data-testid="next-hint">
              {model.hint}
            </span>
          )}
        </div>
        <div class="hs-strip-side hs-strip-tools">
          <Btn
            label={cutsceneMenu?.label ?? 'סרטונים'}
            icon="🎬"
            kbd="C"
            tone="ghost"
            testId="btn-cutscenes"
            disabled={cutsceneMenu?.enabled !== true}
            onClick={() => click('cutscene-menu')}
          />
          <Btn label="" icon={muteAction?.icon ?? '🔊'} kbd="M" tone="ghost" class="hs-icon-btn" title={muted ? 'הפעלת סאונד' : 'השתקה'} testId="btn-mute" onClick={() => click('mute')} />
          <Btn label="" icon={fsAction?.icon ?? '⛶'} kbd="F" tone="ghost" class="hs-icon-btn" title="מסך מלא" testId="btn-fullscreen" onClick={() => click('fullscreen')} />
          <Btn label="" icon="☰" tone="ghost" class="hs-icon-btn" title="עוד" testId="btn-more" onClick={() => click('more-menu')} />
        </div>
      </footer>

      {locked && !muted ? (
        <div class="hs-audio-lock" data-testid="audio-lock">
          🔈 לחצו בכל מקום על המסך כדי להפעיל את הסאונד
        </div>
      ) : null}

      {room.status !== 'online' && state !== null ? (
        <div class="hs-offline" data-testid="offline">
          📡 החיבור לשרת נפל. מתחברים מחדש…
        </div>
      ) : null}

      {room.lostRoom !== null && state !== null ? (
        <div class="hs-lost" data-testid="lost-room">
          <span>
            החדר <b dir="ltr">{room.lostRoom}</b> כבר לא קיים בשרת (אולי השרת הופעל מחדש). פתחנו חדר חדש: <b dir="ltr">{state.code}</b>. השחקנים צריכים לסרוק שוב.
          </span>
          <Btn label="הבנתי" tone="primary" onClick={room.dismissLostRoom} />
        </div>
      ) : null}

      {cutscene !== null && state !== null ? (
        <CutscenePlayer
          key={`${cutscene.id}:${cutscene.startedAt}`}
          cutscene={cutscene}
          def={def}
          clock={room.clock}
          muted={muted}
          onEnd={() => void room.cutsceneEnd()}
        />
      ) : null}

      {menu === 'cutscenes' && state !== null ? (
        <CutsceneMenu
          auto={state.autoCutscenes}
          playing={cutscene?.id ?? null}
          onAuto={(on) => click('auto-cutscenes', on ? 'on' : 'off')}
          onPlay={(id) => click('cutscene', id)}
          onClose={() => setMenu('none')}
        />
      ) : null}

      {menu === 'more' ? (
        <Modal title="☰ עוד" onClose={() => setMenu('none')} testId="more-menu">
          <div class="hs-more">
            <Switch on={calmAction?.on === true} label="מצב רגוע (פחות בדיחות על המסך)" onChange={(on) => click('calm', on ? 'on' : 'off')} />
            <Btn
              label={soundAction?.label ?? 'בדיקת סאונד'}
              icon="🎵"
              disabled={soundAction?.enabled !== true}
              testId="btn-sound-check"
              onClick={() => click('sound-check')}
            />
            <Btn label="סנכרון סאונד ותמונה (AirPlay)" icon="⏱️" kbd="A" testId="btn-av-sync" onClick={() => click('av-sync', 'on')} />
            <Btn label="קרדיטים" icon="📜" testId="btn-credits" onClick={() => setMenu('credits')} />
            <Btn
              label="איפוס תחרות"
              icon="♻️"
              disabled={resetAction?.enabled !== true}
              onClick={() => {
                setMenu('none');
                click('reset');
              }}
            />
            <Btn
              label={newRoomAction?.label ?? 'חדר חדש'}
              icon="🆕"
              tone="danger"
              testId="btn-new-room"
              onClick={() => {
                setMenu('none');
                click('new-room');
              }}
            />
            <div class="hs-keys">
              <b>קיצורי מקלדת</b>
              <span>
                <kbd>רווח</kbd>/<kbd>Enter</kbd> הפעולה הראשית · <kbd>N</kbd> המשחק הבא · <kbd>E</kbd> סיום סיבוב · <kbd>C</kbd> סרטונים · <kbd>S</kbd> דילוג על סרטון ·{' '}
                <kbd>R</kbd> שוב · <kbd>F</kbd> מסך מלא · <kbd>M</kbd> השתקה · <kbd>A</kbd> סנכרון סאונד
              </span>
              <span>לחיצה על שחקן בלובי מוציאה אותו מהחדר.</span>
            </div>
          </div>
        </Modal>
      ) : null}

      {menu === 'sound' && phase === 'lobby' ? <SoundCheck onClose={() => setMenu('none')} /> : null}

      {menu === 'sync' ? <AvSyncScreen clock={room.clock} pictureClock={showClock} onAdjust={(arg) => void applyAvAdjust(arg)} onClose={() => setMenu('none')} /> : null}

      {menu === 'credits' ? <CreditsPanel onClose={() => setMenu('none')} /> : null}

      {confirm !== null ? <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} /> : null}
      {room.notice !== null ? <Toast id={room.notice.id} text={room.notice.text} tone={room.notice.tone} /> : null}
    </div>
  );
}
