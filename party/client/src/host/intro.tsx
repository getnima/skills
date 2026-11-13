/**
 * Intro (title + how to play), the 3-2-1 before a round, the GO splash and the 3-2-1 after a cutscene.
 *
 * Locked to the server clock: the intro turns into the 3-2-1 at `startAt - round.countdownMs` by the
 * clock (not when the phase message arrives), every digit is read from the clock, and the TV's
 * beeps and start gong are scheduled on the audio clock for those exact instants
 * (useCountdownCues). The phones draw the same digits from the same clock, silently.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { roundTime } from '../../../shared/round-clock';
import { scheduleCue, sfx } from '../kit/audio';
import { soundLeadMs } from '../kit/av-sync';
import { introArtUrl } from './show/art';
import { GameArt } from './show/common';
import { PrizeRelic } from './show/prize';
import { useServerNow } from './util';
import './intro.css';

import type { JSX } from 'preact';
import type { GameMeta, RoundPublic } from '../../../shared/protocol';
import type { CueKind } from '../kit/audio';
import type { ServerClock } from '../net/connection';

function msToStart(round: RoundPublic, now: number): number {
  return Math.max(0, -roundTime(round, now).elapsedMs);
}

// ───────────────────────────── the countdown, heard ─────────────────────────────

/** Rounds whose start gong is already on the audio clock (the GO splash then stays quiet). */
const startGongs = new Set<number>();
/** Resumes ("<round>:<resumeAt>") whose GO is already on the audio clock. */
const resumeGos = new Set<string>();

export function startGongScheduled(roundIndex: number): boolean {
  return startGongs.has(roundIndex);
}

export function markStartGong(roundIndex: number): void {
  startGongs.add(roundIndex);
}

export function resumeGoScheduled(key: string): boolean {
  return resumeGos.has(key);
}

export function markResumeGo(key: string): void {
  resumeGos.add(key);
}

/** The cues are put on the audio clock this long before the first one leaves (with the clock just re-measured). */
const CUE_LEAD_MS = 800;

export interface PlannedCue {
  /** Server ms the cue must be heard. */
  readonly at: number;
  readonly kind: CueKind;
}

/**
 * The 3-2-1, heard: a beep on every whole second the countdown shows (T-3, T-2, the high one at
 * T-1 at the real timing; fewer under a shorter test countdown), then the end cue at T.
 */
export function planCountdownCues(target: number, countdownMs: number, end: 'gong' | 'go'): readonly PlannedCue[] {
  const plan: PlannedCue[] = [];
  for (let k = Math.floor(countdownMs / 1_000); k >= 1; k--) plan.push({ at: target - k * 1_000, kind: k === 1 ? 'beepHigh' : 'beep' });
  plan.push({ at: target, kind: end });
  return plan;
}

/**
 * The TV's 3-2-1, heard: a beep at T-3 s and T-2 s, a high beep at T-1 s and the end cue at T (the
 * gong at a round's start, 'go' after a cutscene), scheduled on the audio clock a moment ahead
 * from the server clock, so they land on the very instants every screen shows the digits.
 * `target` is server time, or null while there is nothing to count down to (a cutscene covers the
 * screen, the round is gone). A moved target (a cutscene shifted the start) is rescheduled; a cue
 * still ahead is cancelled when its target goes away, one already sounding is never cut.
 */
export function useCountdownCues(target: number | null, end: 'gong' | 'go', clock: ServerClock, onScheduled?: () => void, countdownMs = 3_000): void {
  const onRef = useRef(onScheduled);
  onRef.current = onScheduled;
  useEffect(() => {
    if (target === null) return undefined;
    const plan = planCountdownCues(target, countdownMs, end);
    const first = plan[0]?.at ?? target;
    // `at`: when the cue leaves the TV (the moment minus the speaker's delay, AirPlay)
    const queued: { at: number; stop: () => void }[] = [];
    let done = false;
    const tick = (): void => {
      if (done) return;
      const now = clock.now();
      const lead = soundLeadMs();
      if (now > target + 200) {
        done = true;
        return;
      }
      if (now < first - lead - CUE_LEAD_MS) return;
      let any = false;
      for (const cue of plan) {
        const at = cue.at - lead;
        // a cue that can no longer leave in time is skipped: late is worse than silent
        if (at < now - 20) continue;
        const stop = scheduleCue(cue.kind, at - now);
        if (stop !== null) {
          queued.push({ at, stop });
          any = true;
        }
      }
      // audio still locked: try again on the next tick, for the cues still ahead
      if (any) {
        done = true;
        onRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 100);
    return () => {
      clearInterval(id);
      const now = clock.now();
      for (const q of queued) if (q.at - now > 40) q.stop();
    };
  }, [target, end, clock, countdownMs]);
}

/**
 * The TV between a game's start and its first frame: how to play, then the 3-2-1, chosen by the
 * server clock (one element through both phases, so the phase message arriving never re-mounts it).
 */
export function PreRoundScreen(props: IntroProps): JSX.Element {
  const now = useServerNow(props.clock, !props.covered);
  const rt = roundTime(props.round, now);
  const counting = msToStart(props.round, now) <= props.round.countdownMs && !rt.frozen;
  if (!counting) return <IntroScreen {...props} />;
  // GO is drawn from the clock too: with the TV's picture delay (pictureClock) it is due before the
  // `playing` message can arrive; the GO of the playing view carries on the same animation
  return (
    <>
      <CountdownScreen game={props.game} round={props.round} clock={props.clock} covered={props.covered} />
      {rt.elapsedMs >= 0 ? <GoSplash gong quiet={startGongScheduled(props.round.index)} at={props.round.startAt} clock={props.clock} soundKey={`start:${props.round.index}`} /> : null}
    </>
  );
}

export interface IntroProps {
  readonly game: GameMeta;
  readonly round: RoundPublic;
  readonly clock: ServerClock;
  readonly players: number;
  /** A cutscene covers the screen: no need to animate underneath. */
  readonly covered: boolean;
}

export function IntroScreen(props: IntroProps): JSX.Element {
  const now = useServerNow(props.clock, !props.covered);
  const toStart = msToStart(props.round, now);
  // The intro runs until the countdown; its length is whatever was left when it appeared.
  const total = useRef<number | null>(null);
  if (total.current === null || toStart > total.current) total.current = toStart;
  const cd = Math.min(props.round.countdownMs, total.current / 2);
  const span = Math.max(1, total.current - cd);
  const p = Math.min(1, Math.max(0, 1 - (toStart - cd) / span));
  const frozen = roundTime(props.round, now).frozen;
  const secs = Math.max(1, Math.ceil(toStart / 1000));
  // the DJ air horn as the show switches to the next game: once per round (the screen is keyed by
  // the round), and not when the TV only reconnects in the last moments of an intro
  useEffect(() => {
    if (toStart > 1500) sfx.airhorn();
  }, []);
  return (
    <div class={`hs-intro ${introArtUrl(props.game.id) !== null ? 'has-art' : ''}`} data-testid="intro">
      <div class="hs-intro-round">
        סיבוב <b dir="ltr">{props.round.number}</b>
      </div>
      {/* the game's key art (or its emoji on a disc) beside the title and how to play */}
      <div class="hs-intro-body">
        <GameArt id={props.game.id} emoji={props.game.emoji} class="hs-intro-emoji" />
        <div class="hs-intro-main">
          <h1 class="hs-intro-title">{props.game.title}</h1>
          {/* how to play: ultra concise, the same steps as on every phone, in Rubik */}
          <ol class="hs-howto" aria-label="איך משחקים">
            {props.game.howTo.map(([icon, text], i) => (
              <li class="hs-howto-step" key={text} style={{ animationDelay: `${160 + i * 150}ms` }}>
                <span class="hs-howto-icon" dir="ltr" aria-hidden="true">
                  {icon}
                </span>
                <span class="hs-howto-text">{text}</span>
              </li>
            ))}
          </ol>
          <div class="hs-intro-foot">
            <div class={`hs-intro-start ${frozen ? 'is-frozen' : ''}`} data-testid="intro-start">
              מתחילים בעוד <b dir="ltr">{secs}</b>
            </div>
            <div class="hs-intro-prize">
              <span class="hs-prize-mini hs-prize-mini--sm">
                <PrizeRelic variant="mini" />
              </span>
              <span>הפרס בסוף הערב: מלאך שימי</span>
            </div>
            <div class="hs-intro-players">
              📱 <b dir="ltr">{props.players}</b> {props.players === 1 ? 'שחקן מוכן' : 'שחקנים מוכנים'}
            </div>
          </div>
        </div>
      </div>
      <div class={`hs-progress ${frozen ? 'is-frozen' : ''}`}>
        <div class="hs-progress-fill" style={{ transform: `scaleX(${p})` }} />
      </div>
    </div>
  );
}

export function CountdownScreen(props: { readonly game: GameMeta; readonly round: RoundPublic; readonly clock: ServerClock; readonly covered: boolean }): JSX.Element {
  const now = useServerNow(props.clock, !props.covered);
  const toStart = msToStart(props.round, now);
  // the digit is read from the server clock every frame; its beep is already on the audio clock
  const n = Math.max(1, Math.min(3, Math.ceil(toStart / 1000)));
  const started = toStart <= 0;
  return (
    <div class="hs-countdown" data-testid="countdown">
      <div class="hs-countdown-game">
        <GameArt id={props.game.id} emoji={props.game.emoji} class="hs-countdown-art" />
        <span>{props.game.title}</span>
      </div>
      {started ? null : (
        <div class="hs-countdown-num" key={n} data-testid="countdown-num">
          {n}
        </div>
      )}
      {started ? null : <div class="hs-countdown-ring" key={`r${n}`} />}
      <div class="hs-countdown-hint">תפסו את הטלפונים!</div>
    </div>
  );
}

const GO_MS = 1_000;
/** GO sounds already played, by `soundKey` (two splashes can show the same GO). */
const goSounds = new Set<string>();

/**
 * "יאללה!" for a moment when the round starts. Plays the GO sound once (the gong when a round
 * starts, `gong`; a beep after a pause), unless `quiet`: the countdown already put it on the
 * audio clock for the exact moment. With `at` + `clock` the splash belongs to that server
 * instant: mounted later, it carries on where its animation is by then (the countdown screen
 * drew it first) and ends on time; `soundKey` keeps its sound to one play.
 */
export function GoSplash(props: {
  readonly text?: string;
  readonly gong?: boolean;
  readonly quiet?: boolean;
  readonly at?: number;
  readonly clock?: ServerClock;
  readonly soundKey?: string;
}): JSX.Element | null {
  const since = useRef(props.at !== undefined && props.clock !== undefined ? Math.max(0, props.clock.now() - props.at) : 0).current;
  const [gone, setGone] = useState(since >= GO_MS);
  useEffect(() => {
    if (since >= GO_MS) return undefined;
    const first = props.soundKey === undefined || !goSounds.has(props.soundKey);
    if (props.soundKey !== undefined) goSounds.add(props.soundKey);
    // the unscheduled fallback (audio was locked) only when it can still land near its moment
    if (props.quiet !== true && first && since < 400 && soundLeadMs() < 150) {
      if (props.gong === true) sfx.gong();
      else sfx.go();
    }
    const t = setTimeout(() => setGone(true), GO_MS - since);
    return () => clearTimeout(t);
  }, []);
  if (gone) return null;
  return (
    <div class="hs-go" data-testid="go">
      <span style={since > 0 ? { animationDelay: `-${Math.round(since)}ms` } : undefined}>{props.text ?? 'יאללה!'}</span>
    </div>
  );
}

/** After a mid-game cutscene: 3-2-1 "ממשיכים!" until round.resumeAt, then GO. */
export function ResumeOverlay(props: { readonly round: RoundPublic; readonly clock: ServerClock; readonly covered: boolean }): JSX.Element | null {
  const now = useServerNow(props.clock, !props.covered);
  const rt = roundTime(props.round, now);
  const n = Math.ceil(rt.resumeInMs / 1000);
  const last = useRef(0);
  const [goKey, setGoKey] = useState(0);
  const resumeKey = `${props.round.index}:${props.round.resumeAt ?? 0}`;
  const quietRef = useRef(false);
  useEffect(() => {
    if (props.covered) return;
    if (n !== last.current) {
      // the beeps are on the audio clock (useCountdownCues in app.tsx); only the GO splash is drawn here
      if (n <= 0 && last.current > 0) {
        quietRef.current = resumeGoScheduled(resumeKey);
        setGoKey((k) => k + 1);
      }
      last.current = n;
    }
  }, [n, props.covered]);
  if (props.covered) return null;
  if (n > 0) {
    return (
      <div class="hs-resume" data-testid="resume">
        <div class="hs-resume-card">
          <div class="hs-resume-title">ממשיכים!</div>
          <div class="hs-resume-num" key={n}>
            {n}
          </div>
          <div class="hs-resume-left">נשארו {Math.ceil(rt.leftMs / 1000)} שניות</div>
        </div>
      </div>
    );
  }
  return goKey > 0 ? <GoSplash key={goKey} quiet={quietRef.current} /> : null;
}
