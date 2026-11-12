/**
 * ResultsScene: suspense (the round ranking builds up from last place), THE
 * WINNER CEREMONY exactly at results.revealAt (prize + victory song), then the
 * overall standings. The whole show is a pure function of one show clock, so a
 * scene that mounts late lands on the right stage at once.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { sfx } from '../../kit/audio';
import { soundOffsetMs } from '../../kit/av-sync';
import { hasTrackFile, playTrack, stopTrack } from '../../kit/music';
import { WINNER_REVEAL_MS } from '../../../../shared/protocol';
import { backdropUrl, lastPlaceArt } from './art';
import { cardGrid } from './card-grid';
import { PlayerCard, useBoardBox } from './cards';
import { Avatar, CountUp, formatScore, GameArt, useFrame, useStage, useTicker } from './common';
import { useFunnyLayer } from './funny';
import { cueNarration, isNarratorOn, setNarrationSlot } from './narrator-bus';
import { PrizeRelic } from './prize';

import type { JSX } from 'preact';
import type { GameMeta, ResultRow, RoundResults } from '../../../../shared/protocol';
import type { StageSize } from './common';
import type { ResultsSceneProps } from './types';

// ── timeline, in ms relative to the reveal (T = 0) ──
const SUSPENSE_FROM = -(WINNER_REVEAL_MS - 900);
const SUSPENSE_TO = -2_000;
const TENSE_FROM = -2_600;
const NAME_AT = 650; // blackout beat before the name
const CEREMONY_MS = 10_600;
const NOBODY_MS = 6_000;
const MOVE_AFTER = 1_700; // standings: previous order → new order
const SPOT_AFTER = 3_700;
const REST_AFTER = 7_500;
const PAGE_MS = 6_000;

type Phase = 'suspense' | 'blackout' | 'ceremony' | 'standings';

/** Server ms when the ceremony is over and the standings begin (for the host's "continue" button). */
export function standingsAt(results: RoundResults): number {
  return results.revealAt + (results.winnerIds.length > 0 ? CEREMONY_MS : NOBODY_MS);
}

interface View {
  readonly phase: Phase;
  /** Suspense: rows revealed so far. */
  readonly shown: number;
  readonly tense: boolean;
  /** Standings: 0 previous order, 1 new order, 2 spotlight, 3 rest. */
  readonly step: number;
}

interface Plan {
  readonly byRound: readonly ResultRow[];
  /** The round winner: exactly one row when anybody scored, empty when nobody did (never two). */
  readonly winners: readonly ResultRow[];
  /** Players who are ahead of the next one on the SAME raw score because they reached it first. */
  readonly earlier: ReadonlySet<string>;
  /** Rows of the suspense list in reveal order (last place first, second place last). */
  readonly reveal: readonly ResultRow[];
  readonly last: ResultRow | null;
  readonly hiddenCount: number;
  readonly prevOrder: readonly ResultRow[];
  readonly newOrder: readonly ResultRow[];
  readonly climber: ResultRow | null;
  readonly climbed: number;
  readonly newLeader: ResultRow | null;
  readonly ceremonyEnd: number;
  /** Nobody had a place before this round: no "new" tags (everyone is new). */
  readonly firstRound: boolean;
}

function buildPlan(rows: readonly ResultRow[], winnerIds: readonly string[], topCount: number): Plan {
  // roundRank is the server's strict position (1..n): no tie-break is recomputed here.
  const byRound = [...rows].sort((a, b) => a.roundRank - b.roundRank);
  // The server names exactly one winner; one is all the stage ever takes.
  const winners = byRound.filter((r) => winnerIds.includes(r.playerId)).slice(0, 1);
  const winnerSet = new Set(winners.map((r) => r.playerId));
  const hiddenCount = 1;
  const earlier = new Set<string>();
  byRound.forEach((r, i) => {
    if (r.raw > 0 && byRound[i + 1]?.raw === r.raw) earlier.add(r.playerId);
  });
  const rest = byRound.filter((r) => !winnerSet.has(r.playerId)).slice(winners.length === 0 ? 1 : 0);
  const top = rest.slice(0, Math.max(0, topCount - 1));
  const tail = rest.length > top.length ? (rest[rest.length - 1] ?? null) : null;
  const reveal = [...(tail ? [tail] : []), ...[...top].reverse()];
  // the clear last place only: when the bottom is a tie (everyone on 0, say) nobody gets the snail
  const lastRow = byRound[byRound.length - 1];
  const aboveLast = byRound[byRound.length - 2];
  const last = byRound.length >= 3 && lastRow !== undefined && aboveLast !== undefined && lastRow.raw < aboveLast.raw && !winnerSet.has(lastRow.playerId) ? lastRow : null;

  const newOrder = [...rows].sort((a, b) => a.rank - b.rank);
  const prevOrder = [...rows].sort((a, b) => (a.prevRank ?? 1e6) - (b.prevRank ?? 1e6) || a.rank - b.rank);
  let climber: ResultRow | null = null;
  let climbed = 0;
  for (const r of rows) {
    const up = r.prevRank !== null ? r.prevRank - r.rank : 0;
    if (up > climbed) {
      climbed = up;
      climber = r;
    }
  }
  if (climbed < 2 && rows.length > 4) climber = null;
  const first = newOrder[0];
  const newLeader = first !== undefined && first.prevRank !== null && first.prevRank > 1 && first.rank === 1 ? first : null;
  return {
    byRound,
    winners,
    earlier,
    reveal,
    last,
    hiddenCount,
    prevOrder,
    newOrder,
    climber,
    climbed,
    newLeader,
    ceremonyEnd: winners.length > 0 ? CEREMONY_MS : NOBODY_MS,
    firstRound: rows.every((r) => r.prevRank === null),
  };
}

function revealTime(index: number, count: number): number {
  if (count <= 1) return SUSPENSE_FROM;
  const step = Math.min(950, (SUSPENSE_TO - SUSPENSE_FROM) / (count - 1));
  return SUSPENSE_FROM + index * step;
}

function viewAt(t: number, plan: Plan): View {
  if (t < 0) {
    let shown = 0;
    const count = plan.reveal.length;
    for (let i = 0; i < count; i++) if (t >= revealTime(i, count)) shown = i + 1;
    return { phase: 'suspense', shown, tense: t >= TENSE_FROM, step: 0 };
  }
  if (t < NAME_AT && plan.winners.length > 0) return { phase: 'blackout', shown: plan.reveal.length, tense: true, step: 0 };
  if (t < plan.ceremonyEnd) return { phase: 'ceremony', shown: plan.reveal.length, tense: false, step: 0 };
  const s = t - plan.ceremonyEnd;
  return { phase: 'standings', shown: plan.reveal.length, tense: false, step: s < MOVE_AFTER ? 0 : s < SPOT_AFTER ? 1 : s < REST_AFTER ? 2 : 3 };
}

/** The view before anything happened (the first frame compares against it, and is not live). */
const QUIET_START: View = { phase: 'suspense', shown: 0, tense: false, step: 0 };

function sameView(a: View, b: View): boolean {
  return a.phase === b.phase && a.shown === b.shown && a.tense === b.tense && a.step === b.step;
}

/** Tiny tie-break hint next to a raw score: this player reached the same score before the next one. */
function Earlier(props: { size: number }): JSX.Element {
  return (
    <span class="sh-earlier" title="בשוויון, מי שהגיע לניקוד קודם מנצח" style={{ fontSize: `calc(${props.size} * var(--u))` }}>
      ⏱ קודם
    </span>
  );
}

function medal(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank);
}

function nameSize(name: string, max: number, room: number): string {
  const len = Math.max(3, Array.from(name).length);
  return `calc(${Math.min(max, Math.round(room / (len * 0.6)))} * var(--u))`;
}

export function ResultsScene(props: ResultsSceneProps): JSX.Element {
  const { ref, size } = useStage();
  const funny = useFunnyLayer(props.results.roundIndex * 104729 + 5);
  const topCount = size.portrait ? 6 : 8;
  const plan = useMemo(
    () => buildPlan(props.results.rows, props.results.winnerIds, topCount),
    [props.results.rows, props.results.winnerIds, topCount],
  );
  const planRef = useRef(plan);
  planRef.current = plan;

  // ── the show clock: server time before the reveal, own time (paused while inactive) after it ──
  const clock = useRef({ t: Number.NEGATIVE_INFINITY, post: -1, started: false });
  const [view, setView] = useState<View>({ phase: 'suspense', shown: 0, tense: false, step: 0 });
  const viewRef = useRef(view);
  const [skipMs, setSkipMs] = useState(0);
  const song = useRef(false);
  const nowRef = useRef(props.now);
  nowRef.current = props.now;
  const activeRef = useRef(props.active);
  activeRef.current = props.active;
  const revealRef = useRef(props.results.revealAt);
  revealRef.current = props.results.revealAt;
  const cueAt = useRef({ confetti: 0, landed: false, raved: false });
  /** The sound side of the timeline (ahead by the speaker's delay, AirPlay): its own view and one-shot cues. */
  const heard = useRef<{ view: View | null; landed: boolean; booed: boolean }>({ view: null, landed: false, booed: false });
  /** The suspense line of a near-empty board was said (once per round). */
  const suspCue = useRef(false);
  /** The hosts' narration (narrator-bus.ts): which of this showing's moments were cued. */
  const narrated = useRef(new Set<string>());
  const sceneId = useRef(Math.floor(Math.random() * 1e9).toString(36));
  const narrate = (moment: 'timeup' | 'suspense' | 'reveal' | 'standings', ttlMs: number, valid: () => boolean, holdMs?: number): void => {
    if (narrated.current.has(moment)) return;
    narrated.current.add(moment);
    cueNarration({ id: `${moment}:${props.results.roundIndex}:${sceneId.current}`, moment, ttlMs, valid, holdMs });
  };
  /** Show time now (ms relative to the reveal), for the narration's validity checks. */
  const showT = (): number => clock.current.t;

  const stopSong = (fadeMs: number): void => {
    if (!song.current) return;
    song.current = false;
    stopTrack('victory', fadeMs);
  };

  useEffect(() => () => stopTrack('victory', 600), []);

  // a new round's results: start over
  useEffect(() => {
    clock.current = { t: Number.NEGATIVE_INFINITY, post: -1, started: false };
    cueAt.current = { confetti: 0, landed: false, raved: false };
    heard.current = { view: null, landed: false, booed: false };
    suspCue.current = false;
    narrated.current = new Set();
    stopSong(300);
  }, [props.results.roundIndex]);

  useEffect(() => {
    if (!props.active) {
      stopSong(500);
      funny.layer()?.hush();
    }
  }, [props.active]);

  /** A beat of the timeline, seen: the pictures and the lines (the sounds are in onSound). */
  const onEnter = (next: View, prev: View, live: boolean, t: number): void => {
    const p = planRef.current;
    const layer = funny.layer();
    if (next.phase === 'suspense' && live) {
      if (next.shown > prev.shown) {
        const row = p.reveal[next.shown - 1];
        if (row && p.last && row.playerId === p.last.playerId && next.shown === 1) {
          layer?.sayLine('roast', { a: row.name }, 'laugh', { force: true, holdMs: 3_200 });
        }
      }
      if (next.tense && !prev.tense) layer?.hush();
    }
    if (next.phase === 'blackout' && prev.phase !== 'blackout' && live) layer?.hush();
    if (next.phase === 'ceremony' && prev.phase !== 'ceremony') {
      const elapsed = p.winners.length > 0 ? t - NAME_AT : t;
      setSkipMs(Math.max(0, Math.round(elapsed)));
      cueAt.current = { confetti: 0, landed: false, raved: false };
      if (p.winners.length > 0 && live) {
        layer?.flash('#ffffff');
        layer?.cannons(110);
      }
    }
    if (next.phase === 'standings' && prev.phase !== 'standings') layer?.hush();
    if (next.phase === 'standings' && live && next.step === 2 && prev.step !== 2) {
      if (p.newLeader) layer?.sayLine('newLeader', { a: p.newLeader.name }, 'shocked', { force: true });
      else if (p.climber) layer?.sayLine('climber', { a: p.climber.name, n: p.climbed }, 'happy', { force: true });
    }
  };

  /**
   * The same beats, heard. They run on the timeline shifted ahead by the speaker's delay
   * (kit/av-sync.ts: 0 without AirPlay), so the drum roll, the hit and the victory song land on
   * their frames in the room instead of a couple of seconds after them.
   */
  const onSound = (next: View, prev: View, live: boolean, t: number): void => {
    const p = planRef.current;
    if (next.phase === 'suspense' && live) {
      if (next.shown > prev.shown) {
        const row = p.reveal[next.shown - 1];
        sfx.pop(0.8 + (next.shown / Math.max(1, p.reveal.length)) * 0.9);
        if (row && p.last && row.playerId === p.last.playerId && next.shown === 1) sfx.fart();
      }
      if (next.tense && !prev.tense) sfx.drumroll(Math.max(400, -t));
    }
    if (next.phase === 'blackout' && prev.phase !== 'blackout' && live) sfx.hit();
    if (next.phase === 'ceremony' && prev.phase !== 'ceremony') {
      const elapsed = p.winners.length > 0 ? t - NAME_AT : t;
      if (p.winners.length > 0) {
        if (elapsed < 6_000 || hasTrackFile('victory')) {
          playTrack('victory', { fallback: 'victory' });
          song.current = true;
        }
        if (live) sfx.cheer();
      } else if (live) {
        sfx.fall();
      }
    }
    // the synth tune has just played out; a real song keeps going over the standings
    if (next.phase === 'standings' && prev.phase !== 'standings' && !hasTrackFile('victory')) stopSong(1_200);
    if (next.phase === 'standings' && live) {
      if (next.step === 1 && prev.step !== 1) sfx.whoosh();
      if (next.step === 2 && prev.step !== 2 && (p.newLeader !== null || p.climber !== null)) sfx.success();
    }
  };

  useFrame((dt) => {
    if (!activeRef.current) return;
    const c = clock.current;
    const rel = nowRef.current() - revealRef.current;
    let t: number;
    if (rel < 0) {
      t = rel;
      c.post = -1;
    } else {
      c.post = c.post < 0 ? rel : c.post + dt;
      t = c.post;
    }
    c.t = t;
    const p = planRef.current;
    const next = viewAt(t, p);
    const prev = viewRef.current;
    const live = c.started;
    if (!c.started || !sameView(next, prev)) {
      c.started = true;
      viewRef.current = next;
      setView(next);
      onEnter(next, prev, live, t);
    }
    // ── the sounds: the same timeline, ahead by the speaker's delay ──
    const ta = t + soundOffsetMs();
    const h = heard.current;
    const nextA = viewAt(ta, p);
    if (h.view === null || !sameView(nextA, h.view)) {
      onSound(nextA, h.view ?? QUIET_START, h.view !== null, ta);
      h.view = nextA;
    }
    if (nextA.phase === 'ceremony' && h.view !== null) {
      if (p.winners.length > 0 && !h.landed && ta - NAME_AT >= 3_300 && ta - NAME_AT < 5_000) {
        h.landed = true;
        sfx.success();
      }
      if (p.winners.length === 0 && !h.booed && ta >= 1_800 && ta < 4_000) {
        h.booed = true;
        sfx.boo();
      }
    }
    // ── the hosts' narration, at the beats of this timeline (only while it runs live) ──
    if (live) {
      if (next.phase === 'suspense' && t < -5_600) narrate('timeup', 2_000, () => showT() < -4_200, 2_600);
      // the drum roll: the commentator was just hushed; the hosts hold their breath until the blackout
      if (next.phase === 'suspense' && t >= TENSE_FROM + 100 && t < -1_400) narrate('suspense', 700, () => showT() < -1_000, 2_100);
      if (next.phase === 'ceremony' && p.winners.length > 0 && t - NAME_AT >= 250 && t - NAME_AT < 2_500) narrate('reveal', 1_500, () => showT() - NAME_AT < 5_500);
      if (next.phase === 'standings' && t - p.ceremonyEnd >= 300 && t - p.ceremonyEnd < 1_500) narrate('standings', 1_500, () => showT() - planRef.current.ceremonyEnd < 2_800, 2_900);
    }
    // a small room has (almost) no rows to reveal: the commentator fills the quiet, once
    // (with the hosts narrating on the TV, the drum roll is theirs)
    if (next.phase === 'suspense' && live && !suspCue.current && !isNarratorOn() && p.reveal.length <= 2 && t >= -6_800 && t < TENSE_FROM - 1_000) {
      suspCue.current = true;
      funny.layer()?.sayLine('suspense', {}, 'shocked', { force: true, holdMs: 3_400 });
    }
    // ceremony cues that are not stage changes
    if (next.phase === 'ceremony' && p.winners.length > 0) {
      const e = t - NAME_AT;
      const layer = funny.layer();
      const cue = cueAt.current;
      if (!cue.raved && e >= 1_500 && e < 5_000) {
        cue.raved = true;
        layer?.sayLine('winner', { a: p.winners[0]?.name ?? '' }, 'shocked', { force: true, crazy: true, holdMs: 6_000 });
      }
      if (!cue.landed && e >= 3_300 && e < 5_000) {
        cue.landed = true;
        layer?.cannons(120);
        layer?.rain(70);
      }
      if (e >= 5_200 && e - cue.confetti >= 2_300 && e < CEREMONY_MS - NAME_AT - 800) {
        cue.confetti = e;
        layer?.burst(0.2 + ((e / 2_300) % 3) * 0.3, 0.25, 45);
      }
    }
    if (next.phase === 'ceremony' && p.winners.length === 0) {
      const cue = cueAt.current;
      if (!cue.raved && t >= 1_800 && t < 4_000) {
        cue.raved = true;
        funny.layer()?.sayLine('nobody', {}, 'laugh', { force: true, holdMs: 3_600 });
      }
    }
  });

  // where the hosts may stand: the winner's band in the ceremony, the left column otherwise
  useEffect(() => {
    setNarrationSlot('results', view.phase === 'ceremony' ? 'ceremony' : 'aside');
  }, [view.phase]);

  const bg = backdropUrl();
  // an elimination round (flappy): the raw number is a distance and means nothing to the room
  const elimination = props.game.mode === 'elimination';
  return (
    <section
      class={`sh-scene sh-results sh-results--${view.phase} ${view.tense ? 'is-tense' : ''}`}
      dir="rtl"
      ref={ref}
      style={bg !== null ? { backgroundImage: `linear-gradient(rgba(16,35,140,.82), rgba(16,35,140,.9)), url("${bg}")` } : undefined}
    >
      {view.phase === 'suspense' || view.phase === 'blackout' ? <Suspense plan={plan} view={view} game={props.game} elimination={elimination} /> : null}
      {view.phase === 'standings' ? <Standings plan={plan} view={view} size={size} clockT={() => clock.current.t - plan.ceremonyEnd} /> : null}
      {view.phase === 'blackout' ? <div class="sh-blackout" /> : null}
      {view.phase === 'ceremony' ? (
        plan.winners.length > 0 ? (
          <Ceremony
            winner={plan.winners[0]}
            earlier={plan.winners[0] !== undefined && plan.earlier.has(plan.winners[0].playerId)}
            skipMs={skipMs}
            title={props.game.title}
            portrait={size.portrait}
            elimination={elimination}
            round={props.results.roundIndex}
          />
        ) : (
          <Nobody skipMs={skipMs} />
        )
      ) : null}
      {funny.node}
    </section>
  );
}

// ───────────────────────────── suspense ─────────────────────────────

function Suspense(props: { plan: Plan; view: View; game: GameMeta; elimination: boolean }): JSX.Element {
  const { plan, view } = props;
  const revealed = new Set(plan.reveal.slice(0, view.shown).map((r) => r.playerId));
  // display order: best first; the tail (last place) is separated by a gap
  const display = [...plan.reveal].sort((a, b) => a.roundRank - b.roundRank);
  const tailId = plan.reveal.length > 0 && plan.byRound.length - plan.hiddenCount > plan.reveal.length ? (plan.reveal[0]?.playerId ?? null) : null;
  const snail = lastPlaceArt();
  return (
    <div class="sh-susp">
      <aside class="sh-aside">
        <GameArt id={props.game.id} emoji={props.game.emoji} class="sh-aside-emoji" />
        <span class="sh-aside-title">תוצאות הסיבוב</span>
        <span class="sh-aside-sub">{props.game.title}</span>
      </aside>
      <div class="sh-main">
      <div class="sh-mystery">
        <span class="sh-mystery-medal">🥇</span>
        <span class="sh-mystery-q" dir="ltr">
          <i>?</i>
          <i>?</i>
          <i>?</i>
        </span>
        <span class="sh-mystery-text">מי זוכה בשימי אנג׳ל?</span>
      </div>
      <div class={`sh-rlist ${display.length <= 4 ? 'is-few' : ''}`}>
        {display.map((r) => {
          const on = revealed.has(r.playerId);
          const isTail = r.playerId === tailId;
          const isLast = plan.last !== null && r.playerId === plan.last.playerId;
          return (
            <div class={`sh-rrow ${on ? 'is-on' : ''} ${isTail ? 'is-tail' : ''} ${isLast ? 'is-last' : ''}`} key={r.playerId}>
              {on ? (
                <div class="sh-rrow-in">
                  <span class="sh-rank">{r.raw > 0 ? medal(r.roundRank) : '·'}</span>
                  <Avatar avatar={r.avatar} name={r.name} look={r.look} />
                  <span class="sh-name" dir="auto">
                    <bdi>{r.name}</bdi>
                  </span>
                  {isLast ? snail.kind === 'img' ? <img class="sh-snail" src={snail.url} alt="" /> : <span class="sh-snail">{snail.char}</span> : null}
                  {plan.earlier.has(r.playerId) ? <Earlier size={26} /> : null}
                  {/* elimination: "out" instead of the distance (the number stays in the DOM for scripts, not on screen) */}
                  {props.elimination ? <span class="sh-out-mark">{isLast ? 'ראשון בחוץ' : 'בחוץ'}</span> : null}
                  <span class={`sh-raw ${props.elimination ? 'is-unseen' : ''}`} dir="ltr">
                    {formatScore(r.raw)}
                  </span>
                  <CountUp class="sh-points" value={r.points} from={0} prefix="+" ms={800} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

// ───────────────────────────── the winner ceremony ─────────────────────────────

/** The owner's exclamations, on the star stickers of the ceremony (two per round, a different pair every round). */
const CHEERS: readonly (readonly [string, string])[] = [
  ['וואו!', 'אש!'],
  ['מחורחר!', 'תכבדו!'],
  ['נודר!', 'וואו!'],
  ['כפרה!', 'מחורחר!'],
  ['טפו חמסה!', 'אחשילי!'],
];

function Ceremony(props: { winner: ResultRow | undefined; earlier: boolean; skipMs: number; title: string; portrait: boolean; elimination: boolean; round: number }): JSX.Element {
  // One winner, always: equal raw scores are decided by who reached the score first.
  const first = props.winner;
  const cheers = CHEERS[((props.round % CHEERS.length) + CHEERS.length) % CHEERS.length] ?? ['וואו!', 'אש!'];
  return (
    <div class="sh-cer" style={`--skip:${props.skipMs}ms`}>
      <div class="sh-cer-sun" />
      <div class="sh-cer-prize">
        <PrizeRelic />
      </div>
      <div class="sh-cer-text">
        <div class="sh-cer-kicker">{`המקום הראשון · ${props.title}`}</div>
        {first ? (
          <div class="sh-cer-solo">
            <div class="sh-cer-name" dir="auto" style={{ fontSize: nameSize(first.name, props.portrait ? 120 : 220, props.portrait ? 590 : 1130) }}>
              <bdi>{first.name}</bdi>
            </div>
          </div>
        ) : null}
        <div class="sh-cer-won">
          {first ? <Avatar avatar={first.avatar} name={first.name} look={first.look} crop="bust" class="sh-avatar--hero" /> : null}
          <div class="sh-cer-says">
            <div class="sh-cer-line">זוכה בשימי אנג׳ל!</div>
            {first ? (
              <div class="sh-cer-score">
                {props.elimination ? (
                  'הכי הרבה זמן באוויר!'
                ) : (
                  <>
                    עם <b dir="ltr">{formatScore(first.raw)}</b> נקודות במשחק
                  </>
                )}
                {props.earlier ? <span class="sh-cer-earlier"> · ⏱ לפני כולם</span> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <span class="sh-burst sh-burst--a">
        <span>{cheers[0]}</span>
      </span>
      <span class="sh-burst sh-burst--b">
        <span>{cheers[1]}</span>
      </span>
    </div>
  );
}

function Nobody(props: { skipMs: number }): JSX.Element {
  return (
    <div class="sh-cer sh-cer--nobody" style={`--skip:${props.skipMs}ms`}>
      <div class="sh-nobody-prize">
        <PrizeRelic />
      </div>
      <div class="sh-nobody-text">
        <div class="sh-nobody-a">אף אחד לא זכה...</div>
        <div class="sh-nobody-b">המלאך נשאר בבית 😇</div>
      </div>
    </div>
  );
}

// ───────────────────────────── overall standings ─────────────────────────────

function Standings(props: { plan: Plan; view: View; size: StageSize; clockT(): number }): JSX.Element {
  const { plan, view, size } = props;
  useTicker(500); // page rotation
  const box = useBoardBox();
  const n = plan.newOrder.length;
  // cards as big as the board allows for everybody; a big room pages (show/card-grid.ts)
  const u = size.u;
  const grid = cardGrid(n, box.w, box.h, { aspect: 1.36, gap: 34 * u, maxW: 330 * u, minW: (size.portrait ? 150 : 172) * u });
  const visible = grid.perPage;
  const pages = Math.max(1, Math.ceil(n / visible));
  const restT = props.clockT() - REST_AFTER;
  const page = view.step >= 3 && pages > 1 ? Math.floor(Math.max(0, restT) / PAGE_MS) % pages : 0;
  const offset = Math.min(page * visible, Math.max(0, n - visible));
  const moved = view.step >= 1;
  const order = moved ? plan.newOrder : plan.prevOrder;
  const slotOf = new Map(order.map((r, i) => [r.playerId, i - offset]));
  const winners = plan.winners;

  return (
    <div class="sh-stand">
      <aside class="sh-aside">
        <span class="sh-aside-emoji">📊</span>
        <span class="sh-aside-title">הטבלה הכללית</span>
        <span class="sh-aside-sub">
          {pages > 1 ? `מקומות ${offset + 1}–${Math.min(n, offset + visible)} מתוך ${n}` : `${n} שחקנים`}
        </span>
      </aside>
      <div class="sh-main">
        <div class={`sh-banner ${winners.length === 0 ? 'sh-banner--none' : ''}`}>
          {winners.length > 0 ? <PrizeRelic variant="mini" /> : <span class="sh-banner-emoji">😇</span>}
          <span class="sh-banner-text">
            {winners.length === 0 ? (
              'אף אחד לא זכה בסיבוב הזה. המלאך נשאר בבית'
            ) : (
              <>
                <b>
                  <bdi>{winners[0]?.name}</bdi>
                </b>{' '}
                זוכה בשימי אנג׳ל!
              </>
            )}
          </span>
          <span class="sh-banner-emoji">🏆</span>
        </div>
        <div class="sh-cards" ref={box.ref}>
          {box.w > 0
            ? plan.newOrder.map((r) => {
                const slot = slotOf.get(r.playerId) ?? 0;
                const hidden = slot < 0 || slot >= visible;
                const at = grid.slot(Math.max(0, Math.min(visible - 1, slot)));
                const delta = r.prevRank === null ? null : r.prevRank - r.rank;
                const isClimber = view.step >= 2 && plan.climber !== null && plan.climber.playerId === r.playerId;
                const isLeader = view.step >= 2 && plan.newLeader !== null && plan.newLeader.playerId === r.playerId;
                const move = !moved
                  ? null
                  : delta === null
                    ? plan.firstRound
                      ? null
                      : { text: 'חדש', kind: 'new' as const }
                    : delta === 0
                      ? null
                      : delta > 0
                        ? { text: `▲${delta}`, kind: 'up' as const }
                        : { text: `▼${-delta}`, kind: 'down' as const };
                return (
                  <PlayerCard
                    key={r.playerId}
                    name={r.name}
                    avatar={r.avatar}
                    look={r.look}
                    rank={moved ? r.rank : r.prevRank}
                    cw={grid.cw}
                    u={u}
                    x={at.x}
                    y={hidden ? at.y + (slot < 0 ? -grid.ch * 0.3 : grid.ch * 0.3) : at.y}
                    hidden={hidden}
                    class={`${moved && r.rank === 1 ? 'is-first' : ''} ${isClimber || isLeader ? 'is-spot' : ''}`}
                    move={move}
                    ribbon={isLeader ? '👑 מוביל חדש' : isClimber ? '🚀 מטפס הסיבוב' : null}
                    testId="standings-card"
                  >
                    <CountUp value={moved ? r.total : r.total - r.points} ms={1_100} />
                    <span class={`pc-gain ${r.points === 0 ? 'is-zero' : ''}`}>+{formatScore(r.points)}</span>
                  </PlayerCard>
                );
              })
            : null}
        </div>
      </div>
    </div>
  );
}
