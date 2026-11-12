/** PlayingScene: the live race the room watches during a round. */
import { useEffect, useMemo, useRef } from 'preact/hooks';

import { roundTime } from '../../../../shared/round-clock';
import { sfx } from '../../kit/audio';
import { roundFeed } from '../../net/round-feed';
import { backdropUrl, crownUrl, lastPlaceArt } from './art';
import { Avatar, avatarColor, CountUp, useFrame, useStage, useTicker } from './common';
import { useFunnyLayer } from './funny';
import { createMomentEngine } from './moments';

import type { JSX } from 'preact';
import type { Moment, RaceEntry } from './moments';
import type { PlayingSceneProps } from './types';

interface Racer {
  readonly id: string;
  readonly name: string;
  readonly avatar: number;
  /** The player's dressed doll (PlayerPublic.look). */
  readonly look?: string;
  readonly score: number;
  /** Elimination round: this player is out (their final is in). */
  readonly out?: boolean;
}

/** What an elimination round adds to the scene (from the page's round feed; null for score rounds / no feed). */
interface Elimination {
  readonly out: ReadonlySet<string>;
  /** Players still in (null before the first `scores` message). */
  readonly active: number | null;
}

/** "נשארו 3!" before the finale begins and while it runs. */
function finaleWords(left: number | null, begun: boolean): string {
  if (left !== null && left >= 2) return begun ? `נשארו ${left} - מחורחר!` : `נשארו ${left}!`;
  return begun ? 'מחורחר! נהיה קשה' : 'נהיה קשה!';
}

interface RowFx {
  dropUntil: number;
  fireUntil: number;
  glowUntil: number;
}

/** Hook for the demo page: force a moment into the scene that is on screen. */
export type MomentInjector = (m: Moment) => void;
let injector: MomentInjector | null = null;
export function injectMoment(m: Moment): boolean {
  if (!injector) return false;
  injector(m);
  return true;
}

const PAGE_MS = 4_500;
/** The rows re-order at most this often (the numbers still tick every frame). */
const ORDER_HOLD_MS = 650;
/** The crown's big hop to a new leader plays at most this often. */
const CROWN_HOP_GAP_MS = 1_800;

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
const RING_R = 44;
const RING_LEN = 2 * Math.PI * RING_R;

function formatClock(leftMs: number): string {
  const s = Math.ceil(leftMs / 1000);
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return String(s);
}

export function PlayingScene(props: PlayingSceneProps): JSX.Element {
  const { ref, size } = useStage();
  const funny = useFunnyLayer(props.roundIndex * 7919 + 17);
  const tick = useTicker(300);
  const engine = useMemo(() => createMomentEngine(), [props.roundIndex, props.game.id]);

  // ── elimination round (flappy): who is out and how many are left, from the round feed ──
  // (the scene is only handed a scores map; `out`, `active` and the finale come with the same messages)
  const feed = roundFeed();
  const feedRound = feed.round !== null && feed.round.gameId === props.game.id && feed.round.number - 1 === props.roundIndex ? feed.round : null;
  // (the demo page has no socket: it hands the same facts in as a prop)
  const preview = props.elimination;
  const eliminationOn = props.game.mode === 'elimination' && (feedRound !== null || preview !== undefined);
  const outKey = eliminationOn ? (preview?.out ?? feed.out).join(',') : '';
  const activeCount = preview !== undefined ? preview.active : feed.active;
  const elimination = useMemo((): Elimination | null => (eliminationOn ? { out: new Set(outKey === '' ? [] : outKey.split(',')), active: activeCount } : null), [eliminationOn, outKey, activeCount]);

  // ── ranking: by score, ties keep their previous order so rows never flicker ──
  const prevOrder = useRef(new Map<string, number>());
  const racers = useMemo((): Racer[] => {
    const list: Racer[] = [];
    for (const p of props.players) {
      const score = props.scores.get(p.id);
      if (score !== undefined) list.push({ id: p.id, name: p.name, avatar: p.avatar, look: p.look, score, out: elimination?.out.has(p.id) ?? false });
    }
    const before = prevOrder.current;
    if (elimination !== null) {
      // Everybody in the air is at the same point of the same course: they share one distance
      // (the farthest reported) and keep their rows; who is out sinks below them, the last
      // one to fall on top.
      let far = 0;
      for (const r of list) if (r.out !== true) far = Math.max(far, r.score);
      const flat = list.map((r) => (r.out === true ? r : { ...r, score: far }));
      flat.sort(
        (a, b) =>
          Number(a.out === true) - Number(b.out === true) ||
          (a.out === true ? b.score - a.score : 0) ||
          (before.get(a.id) ?? 1e9) - (before.get(b.id) ?? 1e9) ||
          a.name.localeCompare(b.name, 'he'),
      );
      prevOrder.current = new Map(flat.map((r, i) => [r.id, i]));
      return flat;
    }
    list.sort((a, b) => b.score - a.score || (before.get(a.id) ?? 1e9) - (before.get(b.id) ?? 1e9) || a.name.localeCompare(b.name, 'he'));
    prevOrder.current = new Map(list.map((r, i) => [r.id, i]));
    return list;
  }, [props.players, props.scores, elimination]);
  const racersRef = useRef(racers);
  racersRef.current = racers;

  // ── what the rows show: the ranking, re-ordered at most every ORDER_HOLD_MS so a race
  //    where places change on every score update stays readable from across the room ──
  //    While an order is held, the rows also keep the scores of the moment it was taken, so
  //    a row never shows more points than the row above it.
  const shownOrder = useRef<readonly string[]>([]);
  const shownOrderAt = useRef(0);
  const shownScores = useRef(new Map<string, number>());
  const frameNow = performance.now();
  const byId = new Map(racers.map((r) => [r.id, r]));
  const wanted = racers.map((r) => r.id);
  const sameSet = wanted.length === shownOrder.current.length && shownOrder.current.every((id) => byId.has(id));
  const inOrder = sameOrder(wanted, shownOrder.current);
  if (!sameSet || inOrder || frameNow - shownOrderAt.current >= ORDER_HOLD_MS) {
    if (!inOrder) shownOrderAt.current = frameNow;
    shownOrder.current = wanted;
    shownScores.current = new Map(racers.map((r) => [r.id, r.score]));
  }
  const board: Racer[] = [];
  for (const id of shownOrder.current) {
    const r = byId.get(id);
    if (r) board.push({ ...r, score: shownScores.current.get(id) ?? r.score });
  }
  const boardRef = useRef(board);
  boardRef.current = board;

  const n = board.length;
  const topScore = board[0]?.score ?? 0;
  const leftCount = elimination === null ? null : (elimination.active ?? board.filter((r) => r.out !== true).length);
  // in an elimination round nobody "leads" until one is left: then the crown lands on the last one standing
  const leaderId = elimination !== null ? (leftCount === 1 && board[0]?.out !== true ? (board[0]?.id ?? null) : null) : topScore > 0 ? (board[0]?.id ?? null) : null;

  // ── the visible window: everybody when they fit, else the top half pinned + a rotating page ──
  const fitAll = size.portrait ? 10 : 12;
  const visible = n <= fitAll ? Math.max(n, 5) : size.portrait ? 8 : 10;
  const paged = n > visible;
  const pinned = paged ? visible / 2 : visible;
  const rotating = visible - pinned;
  const pages = paged ? Math.ceil((n - pinned) / rotating) : 1;
  const startedAt = useRef(performance.now());
  const page = paged ? Math.floor((performance.now() - startedAt.current) / PAGE_MS) % pages : 0;
  const pageStart = paged ? Math.min(pinned + page * rotating, n - rotating) : 0;

  const listRef = useRef<HTMLDivElement | null>(null);
  const listH = listRef.current?.clientHeight ?? 0;
  const dividerH = paged ? 46 * size.u : 0;
  const rowH = listH > 0 ? (listH - dividerH) / visible : 0;

  // ── row effects ──
  const fx = useRef(new Map<string, RowFx>());
  const slotEnter = useRef(new Map<number, { readonly id: string; readonly cls: string }>());
  const prevIndexRef = useRef(new Map<string, number>());
  const now = performance.now();
  const rowFx = (id: string): RowFx => {
    let f = fx.current.get(id);
    if (!f) {
      f = { dropUntil: 0, fireUntil: 0, glowUntil: 0 };
      fx.current.set(id, f);
    }
    return f;
  };

  const crownRef = useRef<HTMLImageElement | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const rowHRef = useRef(rowH);
  rowHRef.current = rowH;
  const lastLeader = useRef<string | null>(null);
  const lastHop = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    const t = performance.now();
    if (leaderId !== null && lastLeader.current !== null && leaderId !== lastLeader.current && t - lastHop.current >= CROWN_HOP_GAP_MS) {
      lastHop.current = t;
      // the crown hops over to the new leader
      // (it starts on the old leader, now one row down, and loops through the middle of the screen)
      const u = sizeRef.current.u;
      const dx = -520 * u;
      const dy = Math.max(rowHRef.current, 60 * u);
      crownRef.current?.animate(
        [
          { transform: `translate3d(0, ${dy}px, 0) rotate(0deg) scale(1)`, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
          { transform: `translate3d(${dx}px, ${dy * 1.6}px, 0) rotate(-200deg) scale(3.2)`, offset: 0.45, easing: 'cubic-bezier(0.6, 0, 0.8, 0.5)' },
          { transform: 'translate3d(0, 0, 0) rotate(-360deg) scale(1)', offset: 0.86 },
          { transform: 'translate3d(0, 6%, 0) rotate(-360deg) scale(1.25, 0.75)', offset: 0.93 },
          { transform: 'translate3d(0, 0, 0) rotate(-360deg) scale(1)' },
        ],
        { duration: 1_100 },
      );
      rowFx(leaderId).glowUntil = performance.now() + 1_600;
    }
    if (leaderId !== null) lastLeader.current = leaderId;
  }, [leaderId]);

  const handleMoment = (m: Moment, force = false): void => {
    const t = performance.now();
    // the funny layer rate-limits each kind of moment; a moment it drops leaves the rows alone too
    // a queued "new leader" line is dropped when somebody else leads by the time it comes up
    const valid =
      m.a !== null && (m.type === 'lead' || m.type === 'comeback')
        ? (): boolean => {
            const list = racersRef.current;
            const idx = list.findIndex((r) => r.id === m.a?.id);
            return m.type === 'lead' ? idx === 0 : idx >= 0 && idx < 3;
          }
        : undefined;
    if (!(funny.layer()?.moment(m, force, valid) ?? false)) return;
    if (m.a) {
      if (m.type === 'drop') rowFx(m.a.id).dropUntil = t + 1_100;
      if (m.type === 'streak' || m.type === 'comeback') rowFx(m.a.id).fireUntil = t + 5_000;
      if (m.type === 'lead' || m.type === 'overtake') rowFx(m.a.id).glowUntil = t + 1_600;
    }
  };
  const handleRef = useRef(handleMoment);
  handleRef.current = handleMoment;

  useEffect(() => {
    const mine: MomentInjector = (m) => handleRef.current(m, true);
    injector = mine;
    return () => {
      if (injector === mine) injector = null;
    };
  }, []);

  // ── the engine runs on the ticker: time-based moments fire even when no score moves ──
  const clockRef = useRef(props.clock);
  clockRef.current = props.clock;
  const durationRef = useRef(props.durationMs);
  durationRef.current = props.durationMs;
  const eliminationRef = useRef(elimination);
  eliminationRef.current = elimination;
  useEffect(() => {
    // overtakes, streaks and comebacks mean nothing while everybody flies side by side
    if (eliminationRef.current !== null) return;
    const sample = clockRef.current();
    const entries: RaceEntry[] = racersRef.current;
    const moments = engine.update({
      elapsedMs: durationRef.current - sample.leftMs,
      leftMs: sample.leftMs,
      frozen: sample.frozen,
      entries,
    });
    for (const m of moments) handleRef.current(m);
  }, [tick, engine]);

  // ── per-frame: the clock ring (no re-render); the scores are odometers (CountUp) ──
  const rootRef = useRef<HTMLElement | null>(null);
  const ringRef = useRef<SVGCircleElement | null>(null);
  const numRef = useRef<HTMLDivElement | null>(null);
  const lastSecond = useRef(-1);
  // the finale banner: "!נשארו 3" + 3-2-1, straight from the round feed every frame
  const finaleRef = useRef<HTMLDivElement | null>(null);
  const finaleWordsRef = useRef<HTMLSpanElement | null>(null);
  const finaleCountRef = useRef<HTMLSpanElement | null>(null);
  const finaleShown = useRef({ words: '', count: '', on: false, left: null as number | null });
  const gameIdRef = useRef(props.game.id);
  gameIdRef.current = props.game.id;
  const roundNoRef = useRef(props.roundIndex);
  roundNoRef.current = props.roundIndex;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  useFrame(() => {
    const box = finaleRef.current;
    if (box) {
      // ms until the finale begins (null: not decided yet) and how many are in the air
      let finaleIn: number | null = null;
      let active: number | null = null;
      const demo = previewRef.current;
      if (demo !== undefined) {
        finaleIn = demo.finaleInMs?.() ?? null;
        active = demo.active;
      } else {
        const f = roundFeed();
        const r = f.round !== null && f.round.gameId === gameIdRef.current && f.round.number - 1 === roundNoRef.current ? f.round : null;
        if (r !== null && r.finale !== null) finaleIn = r.finale.atElapsedMs - roundTime(r, f.now()).elapsedMs;
        active = f.active;
      }
      const shown = finaleShown.current;
      let on = false;
      let words = '';
      let count = '';
      if (finaleIn !== null && eliminationRef.current !== null) {
        const inMs = finaleIn;
        if (inMs <= 3_000 && (active === null || active > 1)) {
          on = true;
          // the number is the count in the air until the finale begins, then it stays
          if (inMs > 0 || shown.left === null) shown.left = active;
          words = finaleWords(shown.left, inMs <= 0);
          count = inMs > 0 ? String(Math.min(3, Math.ceil(inMs / 1000))) : '';
        }
      }
      if (finaleIn === null) shown.left = null;
      rootRef.current?.classList.toggle('is-finale', on && count === '');
      if (on !== shown.on) {
        shown.on = on;
        box.classList.toggle('is-on', on);
        if (on) sfx.whoosh(0.8);
      }
      if (words !== shown.words && finaleWordsRef.current) {
        shown.words = words;
        finaleWordsRef.current.textContent = words;
      }
      if (count !== shown.count && finaleCountRef.current) {
        shown.count = count;
        const node = finaleCountRef.current;
        node.textContent = count;
        box.classList.toggle('is-counting', count !== '');
        if (count !== '') {
          sfx.tick(1.4);
          node.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
        }
      }
    }
  });
  useFrame(() => {
    const sample = clockRef.current();
    const root = rootRef.current;
    const frac = durationRef.current > 0 ? Math.min(1, Math.max(0, sample.leftMs / durationRef.current)) : 0;
    if (ringRef.current) ringRef.current.style.strokeDashoffset = String(RING_LEN * (1 - frac));
    const second = Math.ceil(sample.leftMs / 1000);
    if (root) {
      root.classList.toggle('is-frozen', sample.frozen);
      root.classList.toggle('is-final', !sample.frozen && sample.leftMs <= 10_000 && sample.leftMs > 0);
      root.classList.toggle('is-over', sample.leftMs <= 0);
    }
    if (second !== lastSecond.current) {
      const first = lastSecond.current === -1;
      lastSecond.current = second;
      const num = numRef.current;
      if (num) {
        num.textContent = sample.leftMs <= 0 ? 'סוף!' : formatClock(sample.leftMs);
        num.classList.toggle('is-long', second >= 60);
        if (!first && !sample.frozen && second <= 10 && second > 0) {
          sfx.tick(second <= 3 ? 1.4 : 1);
          num.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
        }
      }
    }
  });

  const lastArt = lastPlaceArt();
  const bg = backdropUrl();
  const lastId = elimination === null && n >= 3 && (board[n - 2]?.score ?? 0) > (board[n - 1]?.score ?? 0) ? (board[n - 1]?.id ?? null) : null;

  // Rows are FIXED SLOTS that never move: slot k always sits at the same place. When a
  // slot gets a new occupant, the new row rolls in INSIDE its own slot (clipped), from
  // below when that player climbed, from above when they fell. So two rows never
  // overlap each other or the "rotating places" label, at any moment, at any head count.
  const indexOf = new Map(board.map((r, i) => [r.id, i]));
  const prevIndex = prevIndexRef.current;
  // the doll fills the height of its row (show.css: --rh); this only picks a sharp enough picture
  const rowUnits = Math.min(220, Math.round(rowH / Math.max(0.05, size.u)));
  const rows: JSX.Element[] = [];
  for (let k = 0; k < visible && rowH > 0; k++) {
    const i = k < pinned ? k : pageStart + (k - pinned);
    const r = board[i];
    if (!r) continue;
    let enter = slotEnter.current.get(k);
    if (enter === undefined || enter.id !== r.id) {
      const was = prevIndex.get(r.id);
      const cls = enter === undefined ? '' : was === undefined ? 'is-in-fade' : was > i ? 'is-in-up' : was < i ? 'is-in-down' : 'is-in-fade';
      enter = { id: r.id, cls };
      slotEnter.current.set(k, enter);
    }
    const y = k * rowH + (k >= pinned ? dividerH : 0);
    const f = fx.current.get(r.id);
    const fill = topScore > 0 ? Math.max(0.03, r.score / topScore) : 0.03;
    const inAir = elimination !== null && r.out !== true;
    const cls = [
      'sh-row',
      r.id === leaderId ? 'is-lead' : '',
      f && f.dropUntil > now ? 'is-drop' : '',
      f && f.glowUntil > now ? 'is-glow' : '',
      k % 2 === 1 ? 'is-odd' : '',
      r.out === true ? 'is-out' : '',
    ].join(' ');
    rows.push(
      <div class={cls} key={`slot${k}`} data-slot={k} style={{ transform: `translate3d(0, ${y.toFixed(1)}px, 0)`, height: `${rowH.toFixed(1)}px` }}>
        <div class={`sh-row-enter ${enter.cls}`} key={r.id}>
          <div class="sh-row-in">
            {/* in an elimination round a place means something only once you are out */}
            <span class={`sh-rank ${inAir ? 'is-bird' : ''}`}>{inAir ? props.game.emoji : i + 1}</span>
            <Avatar avatar={r.avatar} name={r.name} look={r.look} units={rowUnits} />
            <span class={`sh-name ${Array.from(r.name).length > 11 ? 'is-long' : ''}`} dir="auto">
              <bdi>{r.name}</bdi>
            </span>
            {elimination !== null ? (
              // the raw number of an elimination round is a distance: what the room wants to know is who is still in
              <span class="sh-status">{r.out === true ? <span class="sh-out-mark">בחוץ</span> : <span class="sh-in-mark">באוויר</span>}</span>
            ) : (
              <>
                <span class="sh-badges">
                  {f && f.fireUntil > now ? <span class="sh-fire">🔥</span> : null}
                  {r.id === lastId ? (
                    lastArt.kind === 'img' ? (
                      <img class="sh-snail" src={lastArt.url} alt="" />
                    ) : (
                      <span class="sh-snail">{lastArt.char}</span>
                    )
                  ) : null}
                </span>
                <CountUp class="sh-score" value={r.score} ms={420} />
                <div class="sh-track">
                  <div
                    class="sh-fill"
                    style={{ transform: `translate3d(${((1 - fill) * 100).toFixed(2)}%, 0, 0)`, backgroundColor: avatarColor(r.avatar) }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>,
    );
  }
  prevIndexRef.current = indexOf;

  return (
    <section
      class={`sh-scene sh-playing ${elimination !== null ? 'is-elimination' : ''}`}
      dir="rtl"
      ref={(el) => {
        rootRef.current = el;
        ref(el);
      }}
      style={bg !== null ? { backgroundImage: `linear-gradient(rgba(16,35,140,.82), rgba(16,35,140,.9)), url("${bg}")` } : undefined}
    >
      <div class="sh-race">
        <div class={`sh-list ${visible <= 6 ? 'is-roomy' : ''}`} ref={listRef} style={{ '--rh': `${rowH.toFixed(1)}px` }}>
          {rows}
          {paged ? (
            <div class="sh-divider" style={{ transform: `translate3d(0, ${(pinned * rowH).toFixed(1)}px, 0)` }}>
              <span>
                מקומות {pageStart + 1}–{pageStart + rotating} מתוך {n}
              </span>
              <span class="sh-divider-more">+{n - visible} שחקנים נוספים מתחלפים כאן</span>
              <span class="sh-dots">
                {Array.from({ length: Math.min(pages, 12) }, (_, k) => (
                  <i class={k === Math.min(page, 11) ? 'is-on' : ''} key={k} />
                ))}
              </span>
            </div>
          ) : null}
          {n === 0 ? <div class="sh-empty">ממתינים לניקוד הראשון…</div> : null}
          <img
            class={`sh-crown ${leaderId === null || rowH === 0 ? 'is-off' : ''}`}
            ref={crownRef}
            src={crownUrl()}
            alt=""
            style={{ top: `${(rowH * 0.5).toFixed(1)}px` }}
          />
        </div>
      </div>
      <aside class="sh-side">
        <div class="sh-game">
          <span class="sh-game-emoji">{props.game.emoji}</span>
          <span class="sh-game-title">{props.game.title}</span>
        </div>
        <div class="sh-roundno">
          סיבוב <b dir="ltr">{props.roundIndex + 1}</b> · <b dir="ltr">{n}</b> {elimination !== null ? 'בתחרות' : 'במרוץ'}
        </div>
        {elimination !== null && leftCount !== null ? (
          <div class={`sh-left ${leftCount <= 3 ? 'is-few' : ''}`} data-left={leftCount}>
            <span class="sh-left-word">{leftCount === 1 ? 'נשאר' : 'נשארו'}</span>
            <span class="sh-left-num" key={leftCount} dir="ltr">
              {leftCount}
            </span>
            <span class="sh-left-sub">באוויר</span>
          </div>
        ) : null}
        <div class="sh-ring">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle class="sh-ring-edge" cx="50" cy="50" r="49.4" />
            <circle class="sh-ring-bg" cx="50" cy="50" r={RING_R} />
            <circle class="sh-ring-fg" cx="50" cy="50" r={RING_R} ref={ringRef} stroke-dasharray={RING_LEN} transform="rotate(-90 50 50)" />
            <circle class="sh-ring-in" cx="50" cy="50" r="39.2" />
          </svg>
          <div class="sh-ring-num" ref={numRef} dir="ltr" />
          <div class="sh-ring-pause">⏸</div>
        </div>
        <div class="sh-frozen-note">עוצרים רגע · מסתכלים על המסך</div>
      </aside>
      <div class="sh-finale" ref={finaleRef}>
        <span class="sh-finale-words" ref={finaleWordsRef} />
        <span class="sh-finale-count" ref={finaleCountRef} dir="ltr" />
      </div>
      {funny.node}
    </section>
  );
}
