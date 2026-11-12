/**
 * PlayingScene: the live race the room watches during a round. The side column on the left holds
 * the game, the round and the timer (and, under the timer, the empty margin where the hosts'
 * narrator and the commentator stand: narrator.tsx measures `.sh-playing .sh-side`). The race on
 * the right is a board of player cards (cards.tsx): the dressed doll big, the name, the points
 * as an odometer and a bar against the leader's points.
 *
 * The cards are FIXED SLOTS laid out by show/card-grid.ts: slot 0 (top right) is always the
 * leader. When places change, a slot gets a new occupant who rolls in inside the card's frame
 * (from below after a climb, from above after a fall), so no card ever flies across the board or
 * overlaps another. A room too big for one page keeps its top row pinned and turns the rest in
 * pages under a "places 7–18 of 40" label.
 */
import { useEffect, useMemo, useRef } from 'preact/hooks';

import { roundTime } from '../../../../shared/round-clock';
import { sfx } from '../../kit/audio';
import { roundFeed } from '../../net/round-feed';
import { backdropUrl, crownUrl, lastPlaceArt } from './art';
import { cardGrid } from './card-grid';
import { PlayerCard, useBoardBox } from './cards';
import { avatarColor, CountUp, GameArt, useFrame, useStage, useTicker } from './common';
import { banterStillTrue, createBanterDirector } from './banter';
import { useFunnyLayer } from './funny';
import { createMomentEngine } from './moments';
import { cueNarration, isNarratorOn, narratorQuietMs } from './narrator-bus';

import type { JSX } from 'preact';
import type { BanterEntry, BanterLine } from './banter';
import type { StickerZone } from './funny';
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

/** The pages of a big room turn this often (a page is a dozen cards or more: time to find yourself). */
const PAGE_MS = 6_000;
/** A take of the hosts' race banter waits at most this long for its turn (the race moves on). */
const BANTER_TTL_MS = 3_500;
/**
 * The cards re-order at most this often (the numbers still tick every frame). A little longer than
 * the old rows' 650 ms: a board read in two directions needs a beat more to follow a swap.
 */
const ORDER_HOLD_MS = 800;
/** The crown's big hop to a new leader plays at most this often. */
const CROWN_HOP_GAP_MS = 1_800;
/** A race card's height over its width (cards.css .pc--race: a shorter picture, the bar under the points). */
const RACE_ASPECT = 1.42;
/** A paged board: the band between the pinned top row and the turning pages, for the label (design units). */
const BAND_UNITS = 58;
/** The label's own height in that band (show.css .sh-divider). */
const LABEL_UNITS = 46;
/** A sticker that stays put needs a free band at least this wide (px); a narrower one makes it fly by. */
const STAY_MIN_PX = 120;

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
/**
 * Where a sticker that stays put may land during a race: the free band between the side column and
 * the nearest card (a small room's cards leave one). Never on a card (the owner: announcements never
 * cover the play). When the cards fill the board there is no such band: a zero-width zone, and the
 * funny layer makes that sticker fly by instead of staying (funny.tsx). Null (before the first
 * card): anywhere.
 */
function stickerZone(root: HTMLElement | null): StickerZone | null {
  if (root === null) return null;
  const fx = root.querySelector('.sh-fx');
  const cards = root.querySelectorAll('[data-testid=race-card] .pc-in');
  if (fx === null || cards.length === 0) return null;
  const base = fx.getBoundingClientRect().left;
  const side = root.querySelector('.sh-side');
  // portrait: the side column is a strip above the cards; nothing is free beside them
  if (side === null || root.dataset.orient !== 'landscape') return { left: 0, right: 0 };
  let nearest = Number.POSITIVE_INFINITY;
  for (const card of Array.from(cards)) nearest = Math.min(nearest, card.getBoundingClientRect().left);
  const pad = 14;
  const left = side.getBoundingClientRect().right - base + pad;
  const right = nearest - base - pad;
  return right - left >= STAY_MIN_PX ? { left, right } : { left, right: left };
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
  const funny = useFunnyLayer(props.roundIndex * 7919 + 17, () => stickerZone(rootRef.current));
  const tick = useTicker(300);
  const engine = useMemo(() => createMomentEngine(), [props.roundIndex, props.game.id]);
  // the two hosts talk the race through on the TV, with the guests' names (show/banter.ts)
  const banter = useMemo(() => createBanterDirector(Math.random), [props.roundIndex, props.game.id]);

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

  // ── ranking: the server's strict order (scores arrive sorted by score, then who got there first,
  //    then join order), so a tie has the same leader as the ceremony, even right after a reload ──
  const prevOrder = useRef(new Map<string, number>());
  const racers = useMemo((): Racer[] => {
    const list: Racer[] = [];
    for (const p of props.players) {
      const score = props.scores.get(p.id);
      if (score !== undefined) list.push({ id: p.id, name: p.name, avatar: p.avatar, look: p.look, score, out: elimination?.out.has(p.id) ?? false });
    }
    const serverPos = new Map<string, number>();
    for (const id of props.scores.keys()) serverPos.set(id, serverPos.size);
    const strict = (a: Racer, b: Racer): number => (serverPos.get(a.id) ?? 1e9) - (serverPos.get(b.id) ?? 1e9) || a.name.localeCompare(b.name, 'he');
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
          (a.out === true ? 0 : (before.get(a.id) ?? 1e9) - (before.get(b.id) ?? 1e9)) ||
          strict(a, b),
      );
      prevOrder.current = new Map(flat.map((r, i) => [r.id, i]));
      return flat;
    }
    list.sort((a, b) => b.score - a.score || strict(a, b));
    prevOrder.current = new Map(list.map((r, i) => [r.id, i]));
    return list;
  }, [props.players, props.scores, elimination]);
  const racersRef = useRef(racers);
  racersRef.current = racers;
  const banterEntries = (): BanterEntry[] => racersRef.current.map((r) => ({ id: r.id, name: r.name, score: r.score, out: r.out === true }));

  // ── what the cards show: the ranking, re-ordered at most every ORDER_HOLD_MS so a race
  //    where places change on every score update stays readable from across the room ──
  //    While an order is held, the cards also keep the scores of the moment it was taken, so
  //    a card never shows more points than the place before it. An elimination round is not
  //    held: its order changes only when somebody falls, and that card goes under at once.
  const shownOrder = useRef<readonly string[]>([]);
  const shownOrderAt = useRef(0);
  const shownScores = useRef(new Map<string, number>());
  const frameNow = performance.now();
  const byId = new Map(racers.map((r) => [r.id, r]));
  const wanted = racers.map((r) => r.id);
  const sameSet = wanted.length === shownOrder.current.length && shownOrder.current.every((id) => byId.has(id));
  const inOrder = sameOrder(wanted, shownOrder.current);
  if (!sameSet || inOrder || elimination !== null || frameNow - shownOrderAt.current >= ORDER_HOLD_MS) {
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

  // ── the board: everybody as cards when they fit at a readable size (show/card-grid.ts), else
  //    the top row pinned + the rest turning in pages under a label, in a band of its own ──
  const box = useBoardBox();
  const u = size.u;
  const gridOptions = { aspect: RACE_ASPECT, gap: (size.portrait ? 16 : 26) * u, maxW: (size.portrait ? 290 : 360) * u, minW: (size.portrait ? 150 : 190) * u };
  let grid = cardGrid(n, box.w, box.h, gridOptions);
  const paged = n > grid.perPage;
  const band = paged ? BAND_UNITS * u : 0;
  if (paged) grid = cardGrid(n, box.w, box.h - band, gridOptions);
  const visible = paged ? grid.perPage : n;
  // the top row stays; a board of one row (a tiny screen) turns all of it
  const pinnedRows = paged && grid.rows >= 2 ? 1 : 0;
  const pinned = paged ? Math.min(visible - 1, pinnedRows * grid.cols) : visible;
  const rotating = visible - pinned;
  const pages = paged ? Math.ceil((n - pinned) / rotating) : 1;
  const startedAt = useRef(performance.now());
  const page = paged ? Math.floor((performance.now() - startedAt.current) / PAGE_MS) % pages : 0;
  const pageStart = paged ? Math.min(pinned + page * rotating, n - rotating) : 0;
  // a board narrower than the box (a dozen guests are as tall as the box allows) spreads its
  // columns a little instead of leaving two empty margins
  const gridW = grid.cols * grid.cw + (grid.cols - 1) * gridOptions.gap;
  const spread = Math.max(0, Math.min((box.w - gridW) / (grid.cols + 1), gridOptions.gap * 1.6));
  /** Where slot k sits on the board (px): the rows after the pinned one sit under the label's band. */
  const slotAt = (k: number): { x: number; y: number } => {
    const s = grid.slot(k);
    const fromLeft = grid.cols - 1 - (k % grid.cols);
    return { x: s.x + (fromLeft - (grid.cols - 1) / 2) * spread, y: s.y + (paged && Math.floor(k / grid.cols) >= pinnedRows ? band : 0) };
  };
  const first = slotAt(0);
  const labelY = pinnedRows > 0 ? first.y + grid.ch + (gridOptions.gap + band - LABEL_UNITS * u) / 2 : first.y - band + (band - LABEL_UNITS * u) / 2;

  // ── card effects ──
  const fx = useRef(new Map<string, RowFx>());
  const slotEnter = useRef(new Map<number, { readonly id: string; readonly dir: '' | 'up' | 'down' | 'fade' }>());
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
  // the crown's way over from the old leader (now in slot 1) to slot 0, measured on the board
  const second = slotAt(1);
  const hopRef = useRef({ dx: 0, dy: 0, cw: 0 });
  hopRef.current = { dx: second.x - first.x, dy: second.y - first.y, cw: grid.cw };
  const lastLeader = useRef<string | null>(null);
  const lastHop = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    const t = performance.now();
    if (leaderId !== null && lastLeader.current !== null && leaderId !== lastLeader.current && t - lastHop.current >= CROWN_HOP_GAP_MS) {
      lastHop.current = t;
      const { dx, dy, cw } = hopRef.current;
      // the crown hops over to the new leader: from the old leader's card beside it, looping over
      // the two dolls' heads (never as low as a name or a score). The old leader in the row below
      // (a one-column board): it spins in where it lands instead of crossing the leader's card.
      const frames: Keyframe[] =
        Math.abs(dy) < 1 && dx !== 0
          ? [
              { transform: `translate3d(${dx}px, 0, 0) rotate(0deg) scale(1)`, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
              { transform: `translate3d(${dx * 0.5}px, ${cw * 0.12}px, 0) rotate(-200deg) scale(1.8)`, offset: 0.45, easing: 'cubic-bezier(0.6, 0, 0.8, 0.5)' },
              { transform: 'translate3d(0, 0, 0) rotate(-360deg) scale(1)', offset: 0.86 },
              { transform: 'translate3d(0, 6%, 0) rotate(-360deg) scale(1.25, 0.75)', offset: 0.93 },
              { transform: 'translate3d(0, 0, 0) rotate(-360deg) scale(1)' },
            ]
          : [
              { transform: 'translate3d(0, 0, 0) rotate(-200deg) scale(0.2)', opacity: 0 },
              { transform: 'translate3d(0, 0, 0) rotate(-20deg) scale(1.5)', opacity: 1, offset: 0.6 },
              { transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1)' },
            ];
      crownRef.current?.animate(frames, { duration: 1_100 });
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
    // the hosts say the last ten seconds on the TV (the commentator keeps its effects)
    if (m.type === 'final10' && !force) {
      cueNarration({ id: `final10:${props.game.id}:${props.roundIndex}:${sceneId.current}`, moment: 'final10', ttlMs: 3_000, valid: () => clockRef.current().leftMs > 3_500 });
    }
    // with the hosts on the TV, they talk the race through with the names; the commentator keeps its effects
    const hosts = isNarratorOn() && m.type !== 'final10';
    if (hosts) sayBanter(banter.moment(m, t, force));
    if (!(funny.layer()?.moment(m, force, valid, hosts) ?? false)) return;
    if (m.a) {
      if (m.type === 'drop') rowFx(m.a.id).dropUntil = t + 1_100;
      if (m.type === 'streak' || m.type === 'comeback') rowFx(m.a.id).fireUntil = t + 5_000;
      if (m.type === 'lead' || m.type === 'overtake') rowFx(m.a.id).glowUntil = t + 1_600;
    }
  };
  const handleRef = useRef(handleMoment);
  /** One id per mounted scene: each of its moments is narrated once. */
  const sceneId = useRef(Math.floor(Math.random() * 1e9).toString(36));
  handleRef.current = handleMoment;

  /** A take of the hosts' banter goes to the narrator; by its turn it must still be true, and the round still on. */
  const banterSeq = useRef(0);
  const sayBanter = (line: BanterLine | null): void => {
    if (line === null) return;
    banterSeq.current++;
    const names: { a?: string; b?: string } = {};
    if (line.a !== null) names.a = line.a.name;
    if (line.b !== null) names.b = line.b.name;
    cueNarration({
      id: `banter:${props.game.id}:${props.roundIndex}:${sceneId.current}:${banterSeq.current}`,
      moment: 'race',
      priority: line.priority,
      ttlMs: BANTER_TTL_MS,
      take: line.take,
      names,
      valid: () => clockRef.current().leftMs > 1_500 && banterStillTrue(line, banterEntries()),
      onDropped: () => banter.unsay(line),
    });
  };

  // ── an elimination round: the hosts call each fall (the first one as such) ──
  const seenOut = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (elimination === null) return;
    const before = seenOut.current;
    seenOut.current = elimination.out;
    // the first look (a TV opened mid-round): the falls so far are old news
    if (before === null || !isNarratorOn()) return;
    const fresh = [...elimination.out].filter((id) => !before.has(id));
    const id = fresh[fresh.length - 1];
    const fell = id === undefined ? undefined : racersRef.current.find((r) => r.id === id);
    if (fell === undefined) return;
    sayBanter(banter.out({ id: fell.id, name: fell.name }, before.size === 0, performance.now()));
  }, [elimination, banter]);

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
    const sample = clockRef.current();
    const elapsedMs = durationRef.current - sample.leftMs;
    // overtakes, streaks and comebacks mean nothing while everybody flies side by side
    if (eliminationRef.current === null) {
      const entries: RaceEntry[] = racersRef.current;
      const moments = engine.update({ elapsedMs, leftMs: sample.leftMs, frozen: sample.frozen, entries });
      for (const m of moments) handleRef.current(m);
    }
    // a quiet race: the hosts fill it with a jab at somebody
    if (isNarratorOn()) {
      const t = performance.now();
      const race = { gameId: props.game.id, elimination: eliminationRef.current !== null, elapsedMs, leftMs: sample.leftMs, frozen: sample.frozen, entries: banterEntries() };
      sayBanter(banter.ambient(race, narratorQuietMs(t), t));
    }
  }, [tick, engine, banter]);

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
        if (on) {
          sfx.whoosh(0.8);
          cueNarration({
            id: `finale:${gameIdRef.current}:${roundNoRef.current}:${sceneId.current}`,
            moment: 'finale',
            ttlMs: 3_500,
            valid: () => finaleShown.current.on && clockRef.current().leftMs > 3_000,
          });
        }
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

  // Cards are FIXED SLOTS that never move: slot k always sits at the same place. When a slot
  // gets a new occupant, the new one rolls in INSIDE the card's frame (clipped by it), from
  // below when that player climbed, from above when they fell. So two cards never overlap
  // each other or the "rotating places" label, at any moment, at any head count.
  const indexOf = new Map(board.map((r, i) => [r.id, i]));
  const prevIndex = prevIndexRef.current;
  const cards: JSX.Element[] = [];
  for (let k = 0; k < visible && box.w > 0; k++) {
    const i = k < pinned ? k : pageStart + (k - pinned);
    const r = board[i];
    if (!r) continue;
    let enter = slotEnter.current.get(k);
    if (enter === undefined || enter.id !== r.id) {
      const was = prevIndex.get(r.id);
      const dir: '' | 'up' | 'down' | 'fade' = enter === undefined ? '' : was === undefined ? 'fade' : was > i ? 'up' : was < i ? 'down' : 'fade';
      enter = { id: r.id, dir };
      slotEnter.current.set(k, enter);
    }
    const at = slotAt(k);
    const f = fx.current.get(r.id);
    const fill = topScore > 0 ? Math.max(0.03, r.score / topScore) : 0.03;
    const inAir = elimination !== null && r.out !== true;
    const lead = r.id === leaderId;
    const fire = elimination === null && f !== undefined && f.fireUntil > now;
    const snail = r.id === lastId;
    const cls = ['pc--race', lead ? 'is-first' : '', f && f.dropUntil > now ? 'is-drop' : '', f && f.glowUntil > now ? 'is-glow' : '', r.out === true ? 'is-out' : ''].join(' ');
    cards.push(
      <PlayerCard
        key={`slot${k}`}
        name={r.name}
        avatar={r.avatar}
        look={r.look}
        // in an elimination round a place means something only once you are out: the bird flies on the sticker
        rank={inAir ? props.game.emoji : i + 1}
        rankClass={inAir ? 'is-bird' : ''}
        cw={grid.cw}
        u={u}
        x={at.x}
        y={at.y}
        aspect={RACE_ASPECT}
        class={cls}
        roll={{ key: r.id, dir: enter.dir }}
        art={
          fire || snail ? (
            <>
              {fire ? <span class="pc-fire">🔥</span> : null}
              {snail ? lastArt.kind === 'img' ? <img class="pc-snail" src={lastArt.url} alt="" /> : <span class="pc-snail">{lastArt.char}</span> : null}
            </>
          ) : null
        }
        // the raw number of an elimination round is a distance: what the room wants to know is who is still in
        bar={elimination === null ? { fill, color: lead ? 'var(--red)' : avatarColor(r.avatar) } : null}
        testId="race-card"
        slot={k}
      >
        {elimination === null ? (
          <CountUp class="pc-num" value={r.score} ms={420} />
        ) : inAir ? (
          <span class="pc-mark pc-mark--in">באוויר</span>
        ) : (
          <span class="pc-mark pc-mark--out">בחוץ</span>
        )}
      </PlayerCard>,
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
        <div class="sh-race-board" ref={box.ref}>
          {cards}
          {paged && box.w > 0 ? (
            <div class="sh-divider" style={{ transform: `translate3d(0, ${labelY.toFixed(1)}px, 0)` }}>
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
          {/* the crown hangs on the leader's card (slot 0), over the doll's corner: never on a name or a score */}
          <img
            class={`sh-crown ${leaderId === null || box.w === 0 ? 'is-off' : ''}`}
            ref={crownRef}
            src={crownUrl()}
            alt=""
            // placed with left / top (they change only with the board), so the hop can animate the transform
            style={{
              left: `${(first.x - grid.cw * 0.06).toFixed(1)}px`,
              top: `${(first.y - grid.cw * 0.21).toFixed(1)}px`,
              width: `${(grid.cw * 0.42).toFixed(1)}px`,
              height: `${(grid.cw * 0.42).toFixed(1)}px`,
            }}
          />
        </div>
      </div>
      <aside class="sh-side">
        <div class="sh-game">
          <GameArt id={props.game.id} emoji={props.game.emoji} class="sh-game-emoji" />
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
