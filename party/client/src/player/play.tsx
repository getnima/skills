/**
 * Runs the round's game through the stage. Mounted from the countdown on
 * (frozen until round.startAt, so the game is loaded and drawn the moment GO
 * hits) and destroyed as soon as the phase leaves the round.
 */
import { useEffect, useRef } from 'preact/hooks';

import { roundTime } from '../../../shared/round-clock';
import { mountStage } from '../play/stage';

import type { JSX } from 'preact';
import type { RoundPublic } from '../../../shared/protocol';
import type { RoundClockSample, Stage } from '../games/types';
import type { PlayerController } from './controller';

export interface PlayDebug {
  stageScore: number;
  reported: number;
  leftMs: number;
  frozen: boolean;
  round: number;
}

declare global {
  interface Window {
    __playerPlay?: PlayDebug;
  }
}

/** Clock sample of the latest state: frozen before GO, during a cutscene and the 3-2-1 after it. */
export function sampleClock(ctl: PlayerController): RoundClockSample {
  const s = ctl.snapshot().state;
  const round = s?.round ?? null;
  if (s === null || round === null) return { leftMs: 0, frozen: true };
  const t = roundTime(round, ctl.now());
  return { leftMs: t.leftMs, frozen: t.frozen || s.cutscene !== null || t.elapsedMs < 0 };
}

export function Play(props: { readonly ctl: PlayerController; readonly round: RoundPublic }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { ctl } = props;
  const index = props.round.index;
  const gameId = props.round.gameId;
  const seed = props.round.seed;
  const durationMs = props.round.endAt - props.round.startAt;

  useEffect(() => {
    const parent = ref.current;
    if (parent === null) return;
    let stage: Stage | null = null;
    let dead = false;
    const debug: PlayDebug = { stageScore: 0, reported: 0, leftMs: durationMs, frozen: true, round: index };
    window.__playerPlay = debug;

    const clock = (): RoundClockSample => {
      const c = sampleClock(ctl);
      debug.leftMs = c.leftMs;
      debug.frozen = c.frozen;
      return c;
    };

    void mountStage({
      parent,
      gameId,
      seed,
      durationMs,
      clock,
      onScore(score: number): void {
        debug.stageScore = score;
        debug.reported = ctl.sendScore(index, score);
      },
      onFinish(score: number): void {
        debug.stageScore = score;
        ctl.finishEarly(index, score);
      },
      onEnd(finalScore: number): void {
        debug.stageScore = finalScore;
        ctl.endRound(index, finalScore);
      },
    }).then((s) => {
      if (dead) s.destroy();
      else stage = s;
    });

    return (): void => {
      dead = true;
      stage?.destroy();
      stage = null;
      if (window.__playerPlay === debug) window.__playerPlay = undefined;
    };
  }, [ctl, index, gameId, seed, durationMs]);

  return <div class="pp-play" ref={ref} />;
}
