/** PlayingScene: the live race the room watches during a round. */
import { useEffect, useMemo, useRef } from 'preact/hooks';

import { sfx } from '../../kit/audio';
import { backdropUrl, crownUrl, lastPlaceArt } from './art';
import { Avatar, avatarColor, formatScore, useFrame, useStage, useTicker } from './common';
import { useFunnyLayer } from './funny';
import { createMomentEngine } from './moments';

import type { JSX } from 'preact';
import type { Moment, RaceEntry } from './moments';
import type { PlayingSceneProps } from './types';

interface Racer {
  readonly id: string;
  readonly name: string;
  readonly avatar: number;
  readonly score: number;
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

  // ── ranking: by score, ties keep their previous order so rows never flicker ──
  const prevOrder = useRef(new Map<string, number>());
  const racers = useMemo((): Racer[] => {
    const list: Racer[] = [];
    for (const p of props.players) {
      const score = props.scores.get(p.id);
      if (score !== undefined) list.push({ id: p.id, name: p.name, avatar: p.avatar, score });
    }
    const before = prevOrder.current;
    list.sort((a, b) => b.score - a.score || (before.get(a.id) ?? 1e9) - (before.get(b.id) ?? 1e9) || a.name.localeCompare(b.name, 'he'));
    prevOrder.current = new Map(list.map((r, i) => [r.id, i]));
    return list;
  }, [props.players, props.scores]);
  const racersRef = useRef(racers);
  racersRef.current = racers;

  const n = racers.length;
  const topScore = racers[0]?.score ?? 0;
  const leaderId = topScore > 0 ? (racers[0]?.id ?? null) : null;

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
  useEffect(() => {
    if (leaderId !== null && lastLeader.current !== null && leaderId !== lastLeader.current) {
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
    if (m.a) {
      if (m.type === 'drop') rowFx(m.a.id).dropUntil = t + 1_100;
      if (m.type === 'streak' || m.type === 'comeback') rowFx(m.a.id).fireUntil = t + 5_000;
      if (m.type === 'lead' || m.type === 'overtake') rowFx(m.a.id).glowUntil = t + 1_600;
    }
    funny.layer()?.moment(m, force);
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
  useEffect(() => {
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

  // ── per-frame: the clock ring and the ticking scores (no re-render) ──
  const rootRef = useRef<HTMLElement | null>(null);
  const ringRef = useRef<SVGCircleElement | null>(null);
  const numRef = useRef<HTMLDivElement | null>(null);
  const scoreEls = useRef(new Map<string, HTMLSpanElement>());
  const shown = useRef(new Map<string, number>());
  const lastSecond = useRef(-1);
  const hiddenRef = useRef(new Set<string>());
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
    for (const r of racersRef.current) {
      const el = scoreEls.current.get(r.id);
      if (!el) continue;
      if (hiddenRef.current.has(r.id)) {
        // off screen: no ticking, just be right when it comes back
        if (shown.current.get(r.id) !== r.score) {
          shown.current.set(r.id, r.score);
          el.textContent = formatScore(r.score);
        }
        continue;
      }
      const from = shown.current.get(r.id) ?? r.score;
      let next = from + (r.score - from) * 0.22;
      if (Math.abs(r.score - next) < 0.6) next = r.score;
      if (next !== from || el.textContent === '') {
        shown.current.set(r.id, next);
        const text = formatScore(next);
        if (el.textContent !== text) el.textContent = text;
      } else if (!shown.current.has(r.id)) {
        shown.current.set(r.id, next);
      }
    }
  });

  const lastArt = lastPlaceArt();
  const bg = backdropUrl();
  const lastId = n >= 3 && (racers[n - 2]?.score ?? 0) > (racers[n - 1]?.score ?? 0) ? (racers[n - 1]?.id ?? null) : null;

  // Rows keep ONE DOM order (by id) and move by transform only: no DOM reordering, so
  // transitions are never interrupted (and Chromium's moveBefore() leaves no stale styles).
  const rankOf = new Map(racers.map((r, i) => [r.id, i]));
  const stable = [...racers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const hiddenNow = new Set<string>();
  hiddenRef.current = hiddenNow;
  const rows = stable.map((r) => {
    const i = rankOf.get(r.id) ?? 0;
    let slot = -1;
    if (!paged) slot = i;
    else if (i < pinned) slot = i;
    else if (i >= pageStart && i < pageStart + rotating) slot = pinned + (i - pageStart);
    const hidden = slot < 0 || rowH === 0;
    if (hidden) hiddenNow.add(r.id);
    const y = hidden ? (i < pageStart ? pinned : visible) * rowH + dividerH : slot * rowH + (slot >= pinned ? dividerH : 0);
    const f = fx.current.get(r.id);
    const fill = topScore > 0 ? Math.max(0.025, r.score / topScore) : 0.025;
    const cls = [
      'sh-row',
      hidden ? 'is-hidden' : '',
      r.id === leaderId ? 'is-lead' : '',
      f && f.dropUntil > now ? 'is-drop' : '',
      f && f.glowUntil > now ? 'is-glow' : '',
      i % 2 === 1 ? 'is-odd' : '',
    ].join(' ');
    return (
      <div class={cls} key={r.id} style={{ transform: `translate3d(0, ${y.toFixed(1)}px, 0)`, height: `${rowH.toFixed(1)}px` }}>
        <div class="sh-row-in">
          <span class="sh-rank">{i + 1}</span>
          <Avatar avatar={r.avatar} name={r.name} />
          <span class="sh-name">
            <bdi>{r.name}</bdi>
          </span>
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
          <span
            class="sh-score"
            dir="ltr"
            ref={(el) => {
              if (el) scoreEls.current.set(r.id, el);
              else scoreEls.current.delete(r.id);
            }}
          />
          <div class="sh-track">
            <div
              class="sh-fill"
              style={{ transform: `translate3d(${((1 - fill) * 100).toFixed(2)}%, 0, 0)`, backgroundColor: avatarColor(r.avatar) }}
            />
          </div>
        </div>
      </div>
    );
  });

  return (
    <section
      class="sh-scene sh-playing"
      dir="rtl"
      ref={(el) => {
        rootRef.current = el;
        ref(el);
      }}
      style={bg !== null ? { backgroundImage: `linear-gradient(rgba(21,10,51,.78), rgba(21,10,51,.86)), url("${bg}")` } : undefined}
    >
      <div class="sh-race">
        <div class="sh-list" ref={listRef}>
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
          סיבוב {props.roundIndex + 1} · {n} במרוץ
        </div>
        <div class="sh-ring">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle class="sh-ring-bg" cx="50" cy="50" r={RING_R} />
            <circle class="sh-ring-fg" cx="50" cy="50" r={RING_R} ref={ringRef} stroke-dasharray={RING_LEN} transform="rotate(-90 50 50)" />
          </svg>
          <div class="sh-ring-num" ref={numRef} dir="ltr" />
          <div class="sh-ring-pause">⏸</div>
        </div>
        <div class="sh-frozen-note">עוצרים רגע · מסתכלים על המסך</div>
      </aside>
      {funny.node}
    </section>
  );
}
