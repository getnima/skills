/**
 * Runs the round's game through the stage. Mounted from the countdown on
 * (frozen until round.startAt, so the game is loaded and drawn the moment GO
 * hits) and destroyed as soon as the phase leaves the round.
 */
import { useEffect, useRef } from 'preact/hooks';

import { roundTime } from '../../../shared/round-clock';
import { mountStage } from '../play/stage';
import { liveStanding } from '../play/standing';

import type { JSX } from 'preact';
import type { PlayerPublic, RoundPublic } from '../../../shared/protocol';
import type { RoundClockSample } from '../games/types';
import type { PlaceShown } from '../play/hud-place';
import type { PlayStage } from '../play/stage';
import type { LiveStanding } from '../play/standing';
import type { LiveScores, PlayerController } from './controller';

export interface PlayDebug {
  stageScore: number;
  reported: number;
  leftMs: number;
  frozen: boolean;
  round: number;
  // ── live place (read-only, for e2e scripts) ──
  /** Place the HUD shows (null: none). */
  place: number | null;
  /** Number of ranked players the HUD shows ("/12"), null with no place. */
  ranked: number | null;
  /** Chase line as read ('' when none). */
  chase: string;
  /** The HUD shows the first-place crown. */
  first: boolean;
  /** ▲ / ▼ shown this round. */
  ups: number;
  downs: number;
  /** This round's `scores` messages received by this phone. */
  scoresMsgs: number;
  /** The latest of them ([playerId, score] in the strict live order) and when it came (performance.now()). */
  lastScores: ReadonlyArray<readonly [string, number]> | null;
  lastScoresAt: number;
  /** The one before it (the HUD paints at most 4 a second, so it may still show that one). */
  prevScores: ReadonlyArray<readonly [string, number]> | null;
  /** performance.now() when the HUD last painted. */
  placeAt: number;
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
    let stage: PlayStage | null = null;
    let dead = false;
    const debug: PlayDebug = {
      stageScore: 0,
      reported: 0,
      leftMs: durationMs,
      frozen: true,
      round: index,
      place: null,
      ranked: null,
      chase: '',
      first: false,
      ups: 0,
      downs: 0,
      scoresMsgs: 0,
      lastScores: null,
      lastScoresAt: 0,
      prevScores: null,
      placeAt: 0,
    };
    window.__playerPlay = debug;

    // Names change rarely: one lookup map per players array.
    let namesFor: readonly PlayerPublic[] | null = null;
    let names = new Map<string, string>();
    const nameOf = (id: string): string | undefined => {
      const players = ctl.snapshot().state?.players ?? [];
      if (players !== namesFor) {
        namesFor = players;
        names = new Map(players.map((p) => [p.id, p.name]));
      }
      return names.get(id);
    };
    const standingOf = (msg: LiveScores): LiveStanding | null => {
      const me = ctl.snapshot().playerId;
      return me === null ? null : liveStanding(msg.scores, me, nameOf);
    };
    // Only this round's list counts: never a place from a previous round.
    const onScores = (msg: LiveScores): void => {
      if (msg.round !== index) return;
      debug.prevScores = debug.lastScores;
      debug.lastScores = msg.scores;
      debug.lastScoresAt = msg.at;
      debug.scoresMsgs++;
      stage?.setStanding(standingOf(msg));
    };
    const offScores = ctl.onLiveScores(onScores);
    const onPlaceShown = (s: PlaceShown): void => {
      debug.place = s.place;
      debug.ranked = s.count;
      debug.chase = s.chase;
      debug.first = s.first;
      debug.ups = s.ups;
      debug.downs = s.downs;
      debug.placeAt = s.appliedAt;
    };

    const clock = (): RoundClockSample => {
      const c = sampleClock(ctl);
      debug.leftMs = c.leftMs;
      debug.frozen = c.frozen;
      return c;
    };

    void mountStage(
      {
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
      },
      { onPlaceShown },
    ).then((s) => {
      if (dead) {
        s.destroy();
        return;
      }
      stage = s;
      // A message that came while the game was loading (or before a reload's first paint).
      const last = ctl.liveScores();
      if (last !== null && last.round === index) {
        if (debug.lastScores === null) {
          debug.lastScores = last.scores;
          debug.lastScoresAt = last.at;
        }
        s.setStanding(standingOf(last));
      }
    });

    return (): void => {
      dead = true;
      offScores();
      stage?.destroy();
      stage = null;
      if (window.__playerPlay === debug) window.__playerPlay = undefined;
    };
  }, [ctl, index, gameId, seed, durationMs]);

  return <div class="pp-play" ref={ref} />;
}
