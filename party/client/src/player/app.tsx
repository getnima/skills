/**
 * Picks the screen from the latest RoomState + the server clock. Local timers
 * only pace cosmetic beats (the "sending" beat, how long the winner moment
 * stays); every phase change comes from the server.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { roundTime } from '../../../shared/round-clock';
import { MeBar } from './me-bar';
import { meStanding } from './me-standing';
import { Play } from './play';
import {
  BootScreen,
  ClosedScreen,
  CountdownOverlay,
  CutsceneOverlay,
  FinalScreen,
  IntroScreen,
  KickedScreen,
  LateScreen,
  ReconnectBanner,
  ResultsScreen,
  ResumeOverlay,
  RevealScreen,
  RotateOverlay,
  SendingScreen,
  SuspenseScreen,
  WinScreen,
} from './screens';
import { useTick } from './ui';
import { DressingScreen, JoinScreen, LobbyScreen } from './welcome';

import type { JSX } from 'preact';
import type { PlayerController, Snapshot } from './controller';
import type { MeStanding } from './me-standing';

/** The "score sent" beat after a round ends on this phone. */
const SENDING_MS = 1_400;
/** How long the winner keeps the WIN moment before the personal results (they can tap through). */
const WIN_HOLD_MS = 14_000;
/** How long everyone else sees who won. */
const REVEAL_HOLD_MS = 5_500;
/** Results that were already revealed this long ago skip the moment (e.g. after a reload). */
const REVEAL_LATE_MS = 1_500;
const BANNER_DELAY_MS = 700;
/** The TV holds a short blackout beat at revealAt before the winner's name; phones land on that beat, not ahead of it. */
const TV_NAME_BEAT_MS = 650;

export type ScreenName =
  | 'boot'
  | 'join'
  | 'kicked'
  | 'closed'
  /** The dressing room (the room is in the lobby phase; the guest is not dressed yet, or asked for it). */
  | 'dressing'
  | 'lobby'
  | 'intro'
  | 'late'
  | 'countdown'
  | 'playing'
  | 'sending'
  | 'suspense'
  | 'win'
  | 'reveal'
  | 'results'
  | 'final';

/** The me bar as the e2e scripts read it. */
export interface MeBarDebug {
  readonly visible: boolean;
  /** Overall place shown (null: "מוכנים?" or no bar). */
  readonly place: number | null;
  readonly count: number | null;
  readonly total: number | null;
  /** The bar still shows the standing from before the round that just ended. */
  readonly hidingRound: boolean;
}

declare global {
  interface Window {
    __player?: {
      screen: ScreenName;
      cutscene: boolean;
      resuming: boolean;
      banner: boolean;
      snap: Snapshot;
      now(): number;
      meBar: MeBarDebug;
    };
  }
}

function useSnapshot(ctl: PlayerController): Snapshot {
  const [snap, setSnap] = useState(ctl.snapshot());
  useEffect(() => ctl.subscribe(setSnap), [ctl]);
  return snap;
}

export function App(props: { readonly ctl: PlayerController }): JSX.Element {
  const { ctl } = props;
  const snap = useSnapshot(ctl);
  const state = snap.state;
  const round = state?.round ?? null;
  const results = state?.results ?? null;
  const now = ctl.now();

  // Results moment bookkeeping, per round index.
  const revealMode = useRef(new Map<number, 'live' | 'skip'>());
  const [dismissed, setDismissed] = useState<number | null>(null);

  // Banner only after a short grace, so a blip does not flash it.
  const [banner, setBanner] = useState(false);
  const wantBanner = snap.status === 'in' && !snap.online;
  useEffect(() => {
    if (!wantBanner) {
      setBanner(false);
      return;
    }
    const id = setTimeout(() => setBanner(true), BANNER_DELAY_MS);
    return (): void => clearTimeout(id);
  }, [wantBanner]);

  // Timed sub-beats (sending → suspense → reveal → results) need a slow tick.
  const timed =
    snap.status === 'in' &&
    state !== null &&
    (state.phase === 'results' || (state.phase === 'playing' && snap.endedRound !== null));
  useTick(200, timed);

  let screen: ScreenName = 'boot';
  let body: JSX.Element = <BootScreen />;
  let overlay: JSX.Element | null = null;
  const me = snap.playerId ?? '';
  // The round that just ended stays secret on this phone until the TV reveals the winner
  // (the 'sending' beat and the suspense below): the me bar keeps the standing from before it.
  let hideRound = false;

  if (snap.status === 'join' || snap.status === 'joining') {
    screen = 'join';
    body = <JoinScreen ctl={ctl} snap={snap} />;
  } else if (snap.status === 'kicked') {
    screen = 'kicked';
    body = <KickedScreen onRestart={() => ctl.restart()} />;
  } else if (snap.status === 'closed') {
    screen = 'closed';
    body = <ClosedScreen onRestart={() => ctl.restart()} />;
  } else if (snap.status === 'in' && state !== null) {
    const participant = round !== null && ctl.isParticipant(round.index);
    switch (state.phase) {
      case 'lobby':
        // Nothing is being played: a guest who has not dressed yet (or asked to) is in the dressing room.
        // A round that starts changes the phase, so it takes this screen over at once.
        if (snap.dressing || !snap.dressed) {
          screen = 'dressing';
          body = <DressingScreen ctl={ctl} snap={snap} />;
          break;
        }
        screen = 'lobby';
        body = <LobbyScreen ctl={ctl} snap={snap} state={state} />;
        break;
      case 'intro':
        if (round === null) break;
        screen = participant ? 'intro' : 'late';
        body = participant ? <IntroScreen round={round} /> : <LateScreen round={round} />;
        break;
      case 'countdown':
      case 'playing': {
        if (round === null) break;
        if (!participant) {
          screen = 'late';
          body = <LateScreen round={round} />;
          break;
        }
        if (snap.endedRound === round.index) {
          const sending = performance.now() - snap.endedAt < SENDING_MS || !snap.finalAcked;
          screen = sending ? 'sending' : 'suspense';
          body = sending ? <SendingScreen score={snap.endedScore} acked={snap.finalAcked} /> : <SuspenseScreen />;
          break;
        }
        const t = roundTime(round, now);
        screen = t.elapsedMs < 0 || state.phase === 'countdown' ? 'countdown' : 'playing';
        body = (
          <>
            <Play ctl={ctl} round={round} key={`play-${round.index}`} />
            <CountdownOverlay ctl={ctl} round={round} key={`cd-${round.index}`} />
            {state.cutscene === null && round.resumeAt !== null ? (
              <ResumeOverlay ctl={ctl} round={round} key={`rs-${round.index}-${round.resumeAt}`} />
            ) : null}
          </>
        );
        break;
      }
      case 'results': {
        if (results === null) break;
        const idx = results.roundIndex;
        const revealAt = results.revealAt + TV_NAME_BEAT_MS;
        if (!revealMode.current.has(idx)) {
          revealMode.current.set(idx, now < revealAt + REVEAL_LATE_MS || state.cutscene !== null ? 'live' : 'skip');
        }
        const justEnded = snap.endedRound === idx && performance.now() - snap.endedAt < SENDING_MS;
        if (justEnded) {
          hideRound = true;
          screen = 'sending';
          body = <SendingScreen score={snap.endedScore} acked={snap.finalAcked} />;
          break;
        }
        if (now < revealAt || state.cutscene !== null) {
          hideRound = true;
          screen = 'suspense';
          body = <SuspenseScreen />;
          break;
        }
        const winner = results.winnerIds.includes(me);
        const hold = winner ? WIN_HOLD_MS : REVEAL_HOLD_MS;
        const moment = revealMode.current.get(idx) === 'live' && dismissed !== idx && now < revealAt + hold;
        if (moment) {
          screen = winner ? 'win' : 'reveal';
          body = winner ? (
            <WinScreen key={`win-${idx}`} onDone={() => setDismissed(idx)} />
          ) : (
            <RevealScreen key={`rev-${idx}`} results={results} onDone={() => setDismissed(idx)} />
          );
          break;
        }
        screen = 'results';
        body = <ResultsScreen key={`res-${idx}`} results={results} me={me} />;
        break;
      }
      case 'final':
        screen = 'final';
        body = <FinalScreen state={state} me={me} active={state.cutscene === null} />;
        break;
      default: {
        const never: never = state.phase;
        throw new Error(`Unhandled phase: ${String(never)}`);
      }
    }
    if (state.cutscene !== null) overlay = <CutsceneOverlay id={state.cutscene.id} key={state.cutscene.id} />;
  }

  const resuming = round !== null && state?.cutscene === null && roundTime(round, now).resumeInMs > 0;
  // Every screen in the room except the game itself (a cutscene over the game counts as outside).
  const inRoom = snap.status === 'in' && state !== null && screen !== 'boot';
  const standing: MeStanding | null = inRoom && state !== null ? meStanding(state, me, hideRound) : null;
  // this phone's own look is a moment ahead of the server's copy
  const mine: MeStanding | null = standing !== null && snap.look !== null ? { ...standing, look: snap.look } : standing;
  // the dressing room is full screen; under a cutscene the bar is back like on every covered screen
  const meBarOn = mine !== null && ((screen !== 'playing' && screen !== 'dressing') || overlay !== null);
  window.__player = {
    screen,
    cutscene: state?.cutscene !== null && state?.cutscene !== undefined,
    resuming,
    banner,
    snap,
    now: () => ctl.now(),
    meBar: {
      visible: meBarOn,
      place: meBarOn ? (mine?.rank ?? null) : null,
      count: meBarOn && mine !== null && mine.rank !== null ? mine.count : null,
      total: meBarOn ? (mine?.total ?? null) : null,
      hidingRound: hideRound,
    },
  };

  return (
    <div class={`pp-app pp-on-${screen} ${meBarOn ? 'has-mebar' : ''}`} data-screen={screen}>
      {body}
      {overlay}
      <MeBar standing={mine} visible={meBarOn} />
      {banner ? <ReconnectBanner /> : null}
      <RotateOverlay />
    </div>
  );
}
