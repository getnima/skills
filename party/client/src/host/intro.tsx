/** Intro (title + instructions), the 3-2-1 before a round, the GO splash and the 3-2-1 after a cutscene. */
import { useEffect, useRef, useState } from 'preact/hooks';

import { COUNTDOWN_MS } from '../../../shared/protocol';
import { roundTime } from '../../../shared/round-clock';
import { sfx } from '../kit/audio';
import { introArtUrl } from './show/art';
import { GameArt } from './show/common';
import { PrizeRelic } from './show/prize';
import { useServerNow } from './util';

import type { JSX } from 'preact';
import type { GameMeta, RoundPublic } from '../../../shared/protocol';
import type { ServerClock } from '../net/connection';

function msToStart(round: RoundPublic, now: number): number {
  return Math.max(0, -roundTime(round, now).elapsedMs);
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
  const cd = Math.min(COUNTDOWN_MS, total.current / 2);
  const span = Math.max(1, total.current - cd);
  const p = Math.min(1, Math.max(0, 1 - (toStart - cd) / span));
  const frozen = roundTime(props.round, now).frozen;
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
          <p class="hs-intro-text">{props.game.instructions}</p>
          <div class="hs-intro-foot">
            <div class="hs-intro-prize">
              <span class="hs-prize-mini hs-prize-mini--sm">
                <PrizeRelic variant="mini" />
              </span>
              <span>הפרס: מלאך שימי למנצח</span>
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
  const n = Math.max(1, Math.ceil(toStart / 1000));
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (props.covered) return;
    if (last.current !== n) {
      if (last.current !== null || toStart > 200) sfx.tick(1 + (3 - Math.min(3, n)) * 0.18);
      last.current = n;
    }
  }, [n, props.covered]);
  return (
    <div class="hs-countdown" data-testid="countdown">
      <div class="hs-countdown-game">
        <GameArt id={props.game.id} emoji={props.game.emoji} class="hs-countdown-art" />
        <span>{props.game.title}</span>
      </div>
      <div class="hs-countdown-num" key={n} data-testid="countdown-num">
        {n}
      </div>
      <div class="hs-countdown-ring" key={`r${n}`} />
      <div class="hs-countdown-hint">תפסו את הטלפונים!</div>
    </div>
  );
}

/** "יאללה!" for a moment when the round starts. Plays the GO sound once. */
export function GoSplash(props: { readonly text?: string }): JSX.Element | null {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    sfx.go();
    const t = setTimeout(() => setGone(true), 1_000);
    return () => clearTimeout(t);
  }, []);
  if (gone) return null;
  return (
    <div class="hs-go" data-testid="go">
      <span>{props.text ?? 'יאללה!'}</span>
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
  useEffect(() => {
    if (props.covered) return;
    if (n !== last.current) {
      if (n > 0) sfx.tick(1 + (3 - Math.min(3, n)) * 0.18);
      else if (last.current > 0) setGoKey((k) => k + 1);
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
  return goKey > 0 ? <GoSplash key={goKey} /> : null;
}
