/**
 * The TV host page: the frame around the show. It renders purely from the
 * room snapshot, the live scores and the server clock, and keeps the host's
 * controls in a slim strip under the scene.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { findCutscene } from '../../../shared/cutscenes';
import { GAMES, GAME_IDS } from '../../../shared/protocol';
import { roundTime } from '../../../shared/round-clock';
import { isMuted, setMuted, unlockAudio } from '../kit/audio';
import { enterFullscreen } from '../kit/mobile';
import { CutsceneMenu, CutscenePlayer } from './cutscene';
import { CountdownScreen, GoSplash, IntroScreen, ResumeOverlay } from './intro';
import { Lobby, nextGame } from './lobby';
import { useHostRoom } from './room';
import { FinalScene, isShowCalm, onShowCalmChange, PlayingScene, ResultsScene, setShowCalm, standingsAt } from './show/index';
import { Btn, ConfirmDialog, Modal, Switch, Toast } from './ui';
import { useAudioLocked, useBedMusic, useMuted } from './util';

import type { JSX } from 'preact';
import type { GameId, PlayerPublic, RoomState, RoundPublic } from '../../../shared/protocol';
import type { RoundClockSample } from '../games/types';
import type { ServerClock } from '../net/connection';
import type { HostRoom } from './room';
import type { ConfirmRequest } from './ui';

type MenuKind = 'none' | 'cutscenes' | 'more';

/** Automation hook for the browser tests (read-only). */
export interface HostHooks {
  state(): RoomState | null;
  /** Server time. */
  now(): number;
  status(): string;
}

declare global {
  interface Window {
    __host?: HostHooks;
  }
}

interface PrimaryAction {
  readonly label: string;
  readonly icon: string;
  /** Needs a second press within ARM_MS (skipping the winner ceremony). */
  readonly confirm?: string;
  run(): void;
}

/** Keyboard actions are ignored this long after the phase changed (Space-Space must not skip two screens). */
const KEY_GUARD_MS = 1_500;
/** Clicks on the main button are ignored this long after the phase changed (a double click). */
const CLICK_GUARD_MS = 700;
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
  return fresh ? <GoSplash /> : null;
}

function PlayingView(props: { readonly state: RoomState; readonly round: RoundPublic; readonly room: HostRoom }): JSX.Element {
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
        roundIndex={round.index}
        players={state.players}
        scores={room.scores}
        clock={clockRef.current}
        durationMs={round.endAt - round.startAt}
      />
      <RoundGo key={round.index} round={round} clock={room.clock} />
      <ResumeOverlay round={round} clock={room.clock} covered={covered} />
    </div>
  );
}

function ResultsView(props: { readonly state: RoomState; readonly room: HostRoom; readonly replay: number; readonly replayAt: number | null }): JSX.Element | null {
  const res = props.state.results;
  const results = useMemo(
    () => (res !== null && props.replayAt !== null ? { ...res, revealAt: props.replayAt } : res),
    [res, props.replayAt],
  );
  if (res === null || results === null) return <div class="hs-wait">מחשבים תוצאות…</div>;
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

/** What happens next when there is nothing to press: the host is never left guessing. */
function nextHint(phase: string | null, cutscene: boolean): string {
  if (cutscene) return '🎬 סרטון רץ · S לדילוג';
  if (phase === 'intro' || phase === 'countdown') return '⏳ המשחק מתחיל לבד';
  if (phase === 'playing') return '⏳ הסיבוב רץ · התוצאות יופיעו לבד';
  return '';
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

export function App(): JSX.Element {
  const room = useHostRoom();
  const { state } = room;
  const muted = useMuted();
  const locked = useAudioLocked();
  const fullscreen = useFullscreen();
  const calm = useCalm();
  const [menu, setMenu] = useState<MenuKind>('none');
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [replay, setReplay] = useState(0);
  const [replayAt, setReplayAt] = useState<number | null>(null);
  /** A risky action waiting for its second press: which one and until when (performance.now()). */
  const [armed, setArmed] = useState<{ readonly id: string; readonly until: number } | null>(null);
  const phaseAt = useRef(performance.now());

  const hookRef = useRef(room);
  hookRef.current = room;
  useEffect(() => {
    window.__host = {
      state: () => hookRef.current.state,
      now: () => hookRef.current.clock.now(),
      status: () => hookRef.current.status,
    };
  }, []);

  const phase = state?.phase ?? null;
  const cutscene = state?.cutscene ?? null;
  useBedMusic(phase, cutscene !== null);
  const phaseKey = `${state?.code ?? ''}:${phase ?? ''}:${state?.round?.index ?? -1}:${state?.results?.roundIndex ?? -1}`;
  // stamped during render, so a key pressed right after the new screen appears is already guarded
  const lastPhaseKey = useRef(phaseKey);
  if (lastPhaseKey.current !== phaseKey) {
    lastPhaseKey.current = phaseKey;
    phaseAt.current = performance.now();
  }
  useEffect(() => setArmed(null), [phaseKey]);
  useEffect(() => {
    if (armed === null) return undefined;
    const t = setTimeout(() => setArmed(null), Math.max(0, armed.until - performance.now()));
    return () => clearTimeout(t);
  }, [armed]);
  /** Run `fn` now when `id` is armed, else arm it (the button then says "press again"). */
  const twice = (id: string, fn: () => void): void => {
    const t = performance.now();
    if (armed !== null && armed.id === id && t < armed.until) {
      // a bounce / double tap is not a second decision: the host has to see "sure?" first
      if (t - (armed.until - ARM_MS) < ARM_MIN_MS) return;
      setArmed(null);
      fn();
    } else {
      setArmed({ id, until: t + ARM_MS });
    }
  };
  const isArmed = (id: string): boolean => armed !== null && armed.id === id;
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

  const allPlayed = state !== null && GAME_IDS.every((g) => state.played.includes(g));
  const startGame = (g: GameId): void => {
    void room.start(g);
  };
  const askReset = (): void =>
    setConfirm({
      title: 'לאפס את התחרות?',
      text: 'כל הנקודות מתאפסות והמשחקים חוזרים להתחלה. השחקנים נשארים בחדר.',
      yes: 'כן, מתחילים מחדש',
      danger: true,
      run: () => void room.reset(),
    });
  const askKick = (p: PlayerPublic): void =>
    setConfirm({
      title: `להוציא את ${p.name}?`,
      text: 'השחקן יוצא מהחדר ויצטרך לסרוק ולהצטרף מחדש.',
      yes: 'להוציא',
      danger: true,
      run: () => void room.kick(p.id),
    });
  const askNewRoom = (): void =>
    setConfirm({
      title: 'לפתוח חדר חדש?',
      text: 'נוצר קוד חדש ו-QR חדש. כל השחקנים יצטרכו לסרוק שוב.',
      yes: 'חדר חדש',
      danger: true,
      run: () => room.newRoom(),
    });
  const doReplay = (): void => {
    setReplay((n) => n + 1);
    if (phase === 'results') setReplayAt(room.clock.now() + 5_000);
  };

  let primary: PrimaryAction | null = null;
  if (state !== null) {
    if (phase === 'lobby') {
      const next = nextGame(state.played);
      primary =
        next !== null
          ? { label: `המשחק הבא: ${GAMES[next].title}`, icon: GAMES[next].emoji, run: () => startGame(next) }
          : { label: 'פודיום סופי', icon: '🏆', run: () => void room.final() };
    } else if (phase === 'results') {
      const res = state.results;
      const early = res !== null && room.clock.now() < standingsAt(replayAt !== null ? { ...res, revealAt: replayAt } : res);
      const go = allPlayed
        ? { label: 'פודיום סופי', icon: '🏆', run: () => void room.final() }
        : { label: 'המשך ללובי', icon: '⏩', run: () => void room.lobby() };
      primary = early ? { ...go, label: `${go.label} (מדלג על הטקס)`, icon: '⏭', confirm: 'skip-ceremony' } : go;
    } else if (phase === 'final') {
      primary = { label: 'תחרות חדשה', icon: '🔄', run: askReset };
    }
  }
  const runPrimary = (): void => {
    // a double click must not land on the next screen's button too
    if (primary === null || performance.now() - phaseAt.current < CLICK_GUARD_MS) return;
    const p = primary;
    if (p.confirm !== undefined) twice(p.confirm, p.run);
    else p.run();
  };
  const endRound = (): void => {
    if (phase === 'playing') twice('end-round', () => void room.endRound());
    else void room.endRound();
  };
  const canNext = state !== null && (phase === 'lobby' || phase === 'results') && nextGame(state.played) !== null;
  const roundRunning = phase === 'intro' || phase === 'countdown' || phase === 'playing';

  // keyboard: works with any keyboard layout (physical keys)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (confirm !== null || menu !== 'none') return;
    const code = e.code;
    if (code === 'KeyF') toggleFullscreen();
    else if (code === 'KeyM') setMuted(!isMuted());
    else if (state === null) return;
    else if (code === 'KeyS') {
      if (cutscene !== null) void room.cutsceneEnd();
    } else if (cutscene !== null) return;
    else if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') {
      e.preventDefault();
      // a held key, or a second press right after the screen changed, is not a decision
      if (e.repeat || performance.now() - phaseAt.current < KEY_GUARD_MS) return;
      runPrimary();
      return;
    } else if (code === 'KeyN') {
      e.preventDefault();
      if (e.repeat || performance.now() - phaseAt.current < KEY_GUARD_MS) return;
      const next = nextGame(state.played);
      if (canNext && next !== null) {
        if (phase === 'results' && primary?.confirm !== undefined) twice('skip-ceremony-next', () => startGame(next));
        else startGame(next);
      }
      return;
    } else if (code === 'KeyE') {
      if (e.repeat) return;
      if (roundRunning) endRound();
    } else if (code === 'KeyC') setMenu('cutscenes');
    else if (code === 'KeyR') {
      if (phase === 'results' || phase === 'final') doReplay();
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
        <div class="hs-boot-logo">🎉</div>
        <div class="hs-boot-text">{room.status === 'offline' ? 'אין חיבור לשרת. מנסים שוב…' : 'מתחברים לשרת…'}</div>
      </div>
    );
  } else if (phase === 'lobby') {
    scene = <Lobby state={state} onStart={startGame} onKick={askKick} />;
  } else if ((phase === 'intro' || phase === 'countdown') && state.round !== null) {
    const game = GAMES[state.round.gameId];
    scene =
      phase === 'intro' ? (
        <IntroScreen key={state.round.index} game={game} round={state.round} clock={room.clock} players={state.players.length} covered={cutscene !== null} />
      ) : (
        <CountdownScreen key={state.round.index} game={game} round={state.round} clock={room.clock} covered={cutscene !== null} />
      );
  } else if (phase === 'playing' && state.round !== null) {
    scene = <PlayingView state={state} round={state.round} room={room} />;
  } else if (phase === 'results') {
    scene = <ResultsView state={state} room={room} replay={replay} replayAt={replayAt} />;
  } else if (phase === 'final') {
    scene = (
      <div class="hs-scene-wrap" data-testid="final">
        <FinalScene key={replay} players={state.players} results={state.results} active={cutscene === null} />
      </div>
    );
  } else {
    scene = <div class="hs-wait">רגע…</div>;
  }

  // ── the strip ──
  const stripButtons: JSX.Element[] = [];
  if (state !== null) {
    if (phase === 'lobby' && state.played.length > 0) {
      if (!allPlayed) stripButtons.push(<Btn key="final" label="פודיום סופי" icon="🏆" testId="btn-final" onClick={() => void room.final()} />);
      stripButtons.push(<Btn key="reset" label="איפוס תחרות" icon="♻️" tone="ghost" testId="btn-reset" onClick={askReset} />);
    }
    if (roundRunning) {
      stripButtons.push(
        <Btn
          key="end"
          label={phase !== 'playing' ? 'בטל סיבוב' : isArmed('end-round') ? 'בטוח? לחצו שוב לסיום' : 'סיים סיבוב עכשיו'}
          icon="⏹"
          kbd="E"
          tone="danger"
          class={isArmed('end-round') ? 'is-armed' : ''}
          testId="btn-end"
          onClick={endRound}
        />,
      );
    }
    if (phase === 'results' || phase === 'final') {
      stripButtons.push(<Btn key="again" label="שוב!" icon="🔁" kbd="R" testId="btn-again" onClick={doReplay} />);
    }
    if (phase === 'results' && allPlayed) {
      stripButtons.push(<Btn key="lobby" label="המשך ללובי" icon="⏩" testId="btn-lobby" onClick={() => void room.lobby()} />);
    }
    if (phase === 'final') {
      stripButtons.push(<Btn key="lobby" label="ללובי" icon="🏠" testId="btn-lobby" onClick={() => void room.lobby()} />);
    }
  }

  const def = cutscene !== null ? findCutscene(cutscene.id) : undefined;

  return (
    <div class={`hs-root hs-phase-${phase ?? 'boot'}`} data-phase={phase ?? 'boot'}>
      <main class="hs-stage">{scene}</main>

      <footer class="hs-strip" data-testid="strip">
        <div class="hs-strip-side">
          <span class="hs-brand">🎉 Party Arena</span>
          <Connection room={room} />
        </div>
        <div class="hs-strip-main">
          {stripButtons}
          {primary !== null ? (
            <Btn
              label={primary.confirm !== undefined && isArmed(primary.confirm) ? 'בטוח? לחצו שוב כדי לדלג' : primary.label}
              icon={primary.icon}
              kbd="Space"
              tone={primary.confirm !== undefined ? 'plain' : 'primary'}
              class={`hs-primary ${primary.confirm !== undefined && isArmed(primary.confirm) ? 'is-armed' : ''}`}
              testId="btn-primary"
              onClick={runPrimary}
            />
          ) : (
            <span class="hs-next-hint" data-testid="next-hint">
              {nextHint(phase, cutscene !== null)}
            </span>
          )}
        </div>
        <div class="hs-strip-side hs-strip-tools">
          <Btn label="סרטונים" icon="🎬" kbd="C" tone="ghost" testId="btn-cutscenes" disabled={state === null} onClick={() => setMenu('cutscenes')} />
          <Btn label="" icon={muted ? '🔇' : '🔊'} kbd="M" tone="ghost" class="hs-icon-btn" title={muted ? 'הפעלת סאונד' : 'השתקה'} testId="btn-mute" onClick={() => setMuted(!muted)} />
          <Btn label="" icon={fullscreen ? '🗗' : '⛶'} kbd="F" tone="ghost" class="hs-icon-btn" title="מסך מלא" testId="btn-fullscreen" onClick={toggleFullscreen} />
          <Btn label="" icon="☰" tone="ghost" class="hs-icon-btn" title="עוד" testId="btn-more" onClick={() => setMenu('more')} />
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
          onAuto={(on) => void room.setAutoCutscenes(on)}
          onPlay={(id) => void room.cutscene(id)}
          onClose={() => setMenu('none')}
        />
      ) : null}

      {menu === 'more' ? (
        <Modal title="☰ עוד" onClose={() => setMenu('none')} testId="more-menu">
          <div class="hs-more">
            <Switch on={calm} label="מצב רגוע (פחות בדיחות על המסך)" onChange={setShowCalm} />
            <Btn
              label="איפוס תחרות"
              icon="♻️"
              disabled={state === null}
              onClick={() => {
                setMenu('none');
                askReset();
              }}
            />
            <Btn
              label="חדר חדש (קוד חדש)"
              icon="🆕"
              tone="danger"
              testId="btn-new-room"
              onClick={() => {
                setMenu('none');
                askNewRoom();
              }}
            />
            <div class="hs-keys">
              <b>קיצורי מקלדת</b>
              <span>
                <kbd>רווח</kbd>/<kbd>Enter</kbd> הפעולה הראשית · <kbd>N</kbd> המשחק הבא · <kbd>E</kbd> סיום סיבוב · <kbd>C</kbd> סרטונים · <kbd>S</kbd> דילוג על סרטון ·{' '}
                <kbd>R</kbd> שוב · <kbd>F</kbd> מסך מלא · <kbd>M</kbd> השתקה
              </span>
              <span>לחיצה על שחקן בלובי מוציאה אותו מהחדר.</span>
            </div>
          </div>
        </Modal>
      ) : null}

      {confirm !== null ? <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} /> : null}
      {room.notice !== null ? <Toast id={room.notice.id} text={room.notice.text} tone={room.notice.tone} /> : null}
    </div>
  );
}
