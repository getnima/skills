/**
 * The live place chip ("מקום 3 /12") and the chase line of the stage HUD.
 *
 * Cheap by design, because it lives on top of a running game:
 * - at most one paint every PLACE_MIN_MS (the server already sends at most 4 a second),
 * - only the text nodes / classes that changed are touched,
 * - every box has a fixed size and the HUD is `contain: strict`, so a new number re-lays out
 *   a handful of HUD nodes and never the game,
 * - ▲ / ▼ / the bump are Web Animations on transform + opacity only (compositor).
 * While the round is frozen (cutscene) nothing changes: the latest value waits for the thaw.
 */
import { tone } from '../kit/audio';
import { haptic } from '../kit/haptics';
import { chaseParts, chaseText, plainChase } from './standing';

import type { LiveStanding } from './standing';

/** The HUD repaints the place at most this often (4 a second). */
export const PLACE_MIN_MS = 250;
/** The "moved up" sound + haptic at most once a second. */
const CHEER_MIN_MS = 1_000;

export type PlaceMove = 'up' | 'down';

/** What the HUD shows right now (test hooks). */
export interface PlaceShown {
  readonly place: number | null;
  readonly count: number | null;
  /** The chase line as read (no isolation marks), '' when none. */
  readonly chase: string;
  readonly first: boolean;
  readonly ups: number;
  readonly downs: number;
  readonly lastMove: PlaceMove | null;
  /** performance.now() of the last applied standing. */
  readonly appliedAt: number;
}

export interface PlaceHud {
  /** The chip (goes in the HUD row) and the chase line (the HUD's second line). */
  readonly chip: HTMLElement;
  readonly line: HTMLElement;
  set(next: LiveStanding | null): void;
  setHeld(held: boolean): void;
  shown(): PlaceShown;
  destroy(): void;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Sets text only when it differs (no needless layout invalidation). */
function text(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function animate(node: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): void {
  if (typeof node.animate !== 'function') return;
  try {
    node.animate(frames, opts);
  } catch {
    // cosmetic only
  }
}

export function createPlaceHud(onShown?: (s: PlaceShown) => void): PlaceHud {
  // ── chip ──
  const chip = el('div', 'pa-place is-empty');
  const crown = el('span', 'pa-place-crown', '👑');
  crown.setAttribute('aria-hidden', 'true');
  const word = el('span', 'pa-place-word', 'מקום');
  const num = el('span', 'pa-place-num', '–');
  const of = el('span', 'pa-place-of', '');
  of.dir = 'ltr';
  const flash = el('span', 'pa-place-flash');
  const move = el('span', 'pa-place-move', '');
  move.setAttribute('aria-hidden', 'true');
  chip.append(flash, crown, word, num, of, move);

  // ── chase line ──
  const line = el('div', 'pa-chase');
  const cLead = el('span', 'pa-chase-lead');
  const cNum = el('b', 'pa-chase-num');
  cNum.dir = 'ltr';
  const cMid = el('span', 'pa-chase-mid');
  const cName = el('bdi', 'pa-chase-name');
  const cTail = el('span', 'pa-chase-tail');
  line.append(cLead, cNum, cMid, cName, cTail);

  let pending: LiveStanding | null = null;
  let hasPending = false;
  let held = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPaint = -Infinity;
  let lastCheer = -Infinity;
  let dead = false;
  let state: PlaceShown = { place: null, count: null, chase: '', first: false, ups: 0, downs: 0, lastMove: null, appliedAt: 0 };

  function paint(next: LiveStanding | null): void {
    const prev = state;
    const place = next?.place ?? null;
    const count = next?.count ?? null;
    const first = place === 1 && (count ?? 0) > 1;
    let lastMove = prev.lastMove;
    let ups = prev.ups;
    let downs = prev.downs;

    chip.classList.toggle('is-empty', place === null);
    chip.classList.toggle('is-first', first);
    text(num, place === null ? '–' : String(place));
    text(of, count === null ? '' : `/${count}`);

    // A move is an overtake within the same field (a kicked player closing the list is not).
    if (place !== null && prev.place !== null && count === prev.count && place !== prev.place) {
      const up = place < prev.place;
      lastMove = up ? 'up' : 'down';
      if (up) ups++;
      else downs++;
      text(move, up ? '▲' : '▼');
      move.classList.toggle('is-up', up);
      move.classList.toggle('is-down', !up);
      if (up) {
        animate(move, [
          { opacity: 0, transform: 'translateY(8px) scale(0.4)' },
          { opacity: 1, transform: 'translateY(-3px) scale(1.25)', offset: 0.25 },
          { opacity: 1, transform: 'translateY(-5px) scale(1)', offset: 0.7 },
          { opacity: 0, transform: 'translateY(-9px) scale(1)' },
        ], { duration: 750, easing: 'ease-out' });
        animate(chip, [{ transform: 'scale(1.16) rotate(-3deg)' }, { transform: 'scale(1) rotate(0)' }], {
          duration: 260,
          easing: 'cubic-bezier(.2,1.6,.4,1)',
        });
        const now = performance.now();
        if (now - lastCheer >= CHEER_MIN_MS) {
          lastCheer = now;
          // tiny rising blip, quieter than the games' own sounds
          tone({ freq: 660, to: 1320, dur: 0.11, type: 'triangle', vol: 0.11 });
          haptic.tap();
        }
      } else {
        animate(move, [
          { opacity: 0, transform: 'translateY(-6px)' },
          { opacity: 1, transform: 'translateY(2px)', offset: 0.2 },
          { opacity: 1, transform: 'translateY(2px)', offset: 0.65 },
          { opacity: 0, transform: 'translateY(6px)' },
        ], { duration: 650, easing: 'ease-out' });
        animate(flash, [{ opacity: 0 }, { opacity: 0.9, offset: 0.2 }, { opacity: 0 }], { duration: 520, easing: 'ease-out' });
        animate(chip, [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-3px)', offset: 0.25 },
          { transform: 'translateX(3px)', offset: 0.5 },
          { transform: 'translateX(0)' },
        ], { duration: 260 });
      }
    }

    const chase = next?.chase ?? null;
    if (chase === null) {
      text(cLead, '');
      text(cNum, '');
      text(cMid, '');
      text(cName, '');
      text(cTail, '');
      line.classList.remove('is-lead');
    } else {
      const p = chaseParts(chase);
      text(cLead, p.lead);
      text(cNum, p.num);
      text(cMid, p.mid);
      text(cName, p.name);
      text(cTail, p.tail);
      line.classList.toggle('is-lead', chase.kind === 'lead');
    }

    state = { place, count, chase: plainChase(chaseText(chase)), first, ups, downs, lastMove, appliedAt: performance.now() };
    onShown?.(state);
  }

  function flush(): void {
    timer = null;
    if (dead || held || !hasPending) return;
    hasPending = false;
    lastPaint = performance.now();
    paint(pending);
  }

  function schedule(): void {
    if (dead || held || timer !== null) return;
    const wait = PLACE_MIN_MS - (performance.now() - lastPaint);
    if (wait <= 0) flush();
    else timer = setTimeout(flush, wait);
  }

  return {
    chip,
    line,
    set(next: LiveStanding | null): void {
      pending = next;
      hasPending = true;
      schedule();
    },
    setHeld(next: boolean): void {
      if (next === held) return;
      held = next;
      if (held && timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (!held) schedule();
    },
    shown: (): PlaceShown => state,
    destroy(): void {
      dead = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
