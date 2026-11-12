/**
 * Runs the round's game through the stage. Mounted from the countdown on
 * (frozen until round.startAt, so the game is loaded and drawn the moment GO
 * hits) and destroyed as soon as the phase leaves the round.
 */
import { useEffect, useRef } from 'preact/hooks';

import { GAMES } from '../../../shared/protocol';
import { roundTime } from '../../../shared/round-clock';
import { mountStage } from '../play/stage';
import { liveStanding } from '../play/standing';

import type { JSX } from 'preact';
import type { PlayerPublic, RoundPublic } from '../../../shared/protocol';
import type { FieldPlayer, RoundClockSample, RoundField } from '../games/types';
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
  /** ▲ / ▼ shown this round, and the latest of the two. */
  ups: number;
  downs: number;
  lastMove: 'up' | 'down' | null;
  /** This round's `scores` messages received by this phone. */
  scoresMsgs: number;
  /** The latest of them ([playerId, score] in the strict live order) and when it came (performance.now()). */
  lastScores: ReadonlyArray<readonly [string, number]> | null;
  lastScoresAt: number;
  /** The one before it (the HUD paints at most 4 a second, so it may still show that one). */
  prevScores: ReadonlyArray<readonly [string, number]> | null;
  /** The last few messages with their arrival times, newest last. */
  recentScores: Array<{ readonly scores: ReadonlyArray<readonly [string, number]>; readonly at: number }>;
  /** performance.now() when the HUD last painted. */
  placeAt: number;
  /** ctx.hudHeight the game got (0 until the stage is up). */
  hudHeight: number;
  // ── elimination rounds ──
  /** `active` of the latest `scores` message of this round (null: none yet). */
  active: number | null;
  /** `out` of that message. */
  out: readonly string[];
  /** Ms of round time until the finale (null: none set). */
  finaleInMs: number | null;
  /** This phone is out of this round (remembered across a reload). */
  meOut: boolean;
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
      lastMove: null,
      scoresMsgs: 0,
      recentScores: [],
      lastScores: null,
      lastScoresAt: 0,
      prevScores: null,
      placeAt: 0,
      hudHeight: 0,
      active: null,
      out: [],
      finaleInMs: null,
      meOut: false,
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
    // ── elimination round: who is still in, the finale, and "I am out" across a reload ──
    const elimination = GAMES[gameId].mode === 'elimination';
    const outKey = `party.out.${ctl.snapshot().code}.${index}`;
    const savedOut = (): number | null => {
      try {
        const v = sessionStorage.getItem(outKey);
        const n = v === null ? Number.NaN : Number(v);
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    };
    let latest: LiveScores | null = null;
    let fieldOf: LiveScores | null = null;
    let fieldPlayers: readonly FieldPlayer[] = [];
    const outRaw = (): number | null => {
      const saved = savedOut();
      if (saved !== null) return saved;
      const me = ctl.snapshot().playerId;
      if (latest === null || me === null || !latest.out.includes(me)) return null;
      return latest.scores.find(([id]) => id === me)?.[1] ?? 0;
    };
    const eliminationSource = {
      activePlayers: (): number | null => latest?.active ?? null,
      finaleInMs: (): number | null => {
        const round = ctl.snapshot().state?.round ?? null;
        if (round === null || round.index !== index || round.finale === null) return null;
        return round.finale.atElapsedMs - roundTime(round, ctl.now()).elapsedMs;
      },
      field: (): RoundField | null => {
        if (latest === null) return savedOut() === null ? null : { players: [], outRaw: savedOut() };
        if (fieldOf !== latest) {
          fieldOf = latest;
          const me = ctl.snapshot().playerId;
          const out = new Set(latest.out);
          const byId = new Map((ctl.snapshot().state?.players ?? []).map((p) => [p.id, p]));
          fieldPlayers = latest.scores.map(([id]) => ({
            id,
            name: byId.get(id)?.name ?? '',
            avatar: byId.get(id)?.avatar ?? 0,
            out: out.has(id),
            me: id === me,
          }));
        }
        return { players: fieldPlayers, outRaw: outRaw() };
      },
    };
    /** While flying, the "place" among the fliers is noise (everybody is at the same distance): shown once out. */
    const shownStanding = (msg: LiveScores): LiveStanding | null => {
      if (!elimination) return standingOf(msg);
      const me = ctl.snapshot().playerId;
      // only once the server has this phone's final (then the strict order knows its place);
      // no chase line: the gap would be a survival distance, not points to win back
      if (me === null || !msg.out.includes(me)) return null;
      const standing = standingOf(msg);
      return standing === null ? null : { ...standing, chase: null };
    };

    // Only this round's list counts: never a place from a previous round.
    const onScores = (msg: LiveScores): void => {
      if (msg.round !== index) return;
      latest = msg;
      debug.active = msg.active;
      debug.out = msg.out;
      debug.prevScores = debug.lastScores;
      debug.lastScores = msg.scores;
      debug.lastScoresAt = msg.at;
      debug.scoresMsgs++;
      debug.recentScores.push({ scores: msg.scores, at: msg.at });
      if (debug.recentScores.length > 4) debug.recentScores.shift();
      stage?.setStanding(shownStanding(msg));
    };
    const offScores = ctl.onLiveScores(onScores);
    const early = ctl.liveScores();
    if (early !== null && early.round === index) latest = early;
    const onPlaceShown = (s: PlaceShown): void => {
      debug.place = s.place;
      debug.ranked = s.count;
      debug.chase = s.chase;
      debug.first = s.first;
      debug.ups = s.ups;
      debug.downs = s.downs;
      debug.lastMove = s.lastMove;
      debug.placeAt = s.appliedAt;
    };

    const clock = (): RoundClockSample => {
      const c = sampleClock(ctl);
      debug.leftMs = c.leftMs;
      debug.frozen = c.frozen;
      if (elimination) {
        debug.finaleInMs = eliminationSource.finaleInMs();
        debug.meOut = outRaw() !== null;
      }
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
          if (elimination) {
            // one life: a reload of this tab must come back out, never flying again
            try {
              if (savedOut() === null) sessionStorage.setItem(outKey, String(score));
            } catch {
              // storage blocked: the server's `out` list still says so after a reload
            }
          }
          ctl.finishEarly(index, score);
        },
        onEnd(finalScore: number): void {
          debug.stageScore = finalScore;
          ctl.endRound(index, finalScore);
        },
        ...(elimination ? { elimination: eliminationSource } : {}),
      },
      { onPlaceShown },
    ).then((s) => {
      if (dead) {
        s.destroy();
        return;
      }
      stage = s;
      debug.hudHeight = s.hudHeight;
      // A message that came while the game was loading (or before a reload's first paint).
      const last = ctl.liveScores();
      if (last !== null && last.round === index) {
        if (debug.lastScores === null) {
          debug.lastScores = last.scores;
          debug.lastScoresAt = last.at;
        }
        if (latest === null) latest = last;
        s.setStanding(shownStanding(last));
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
