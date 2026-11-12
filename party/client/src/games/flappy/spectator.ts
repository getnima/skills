/**
 * The "out" view of an elimination round: the verdict ("!נפלת" + the place), how many are
 * still in the air, who they are, the finale banner with its 3-2-1 and the winner's name.
 * A light DOM overlay over the game canvas; only text nodes that changed are touched.
 */
import './flappy.css';

import { PARTY_COLORS } from '../../kit/theme';

import type { FieldPlayer } from '../types';

export interface SpectatorState {
  /** 'out': crashed. 'win': the last one in the air. 'solo': crashed with no field (the dev harness). */
  readonly kind: 'out' | 'win' | 'solo';
  /** 1-based place of this player, or null when unknown. */
  readonly place: number | null;
  /** Participants of the round, or null when unknown. */
  readonly total: number | null;
  /** Obstacles this player passed. */
  readonly passed: number;
  /** Still flying, or null when unknown. */
  readonly active: number | null;
  /** The players still flying (may be empty when unknown). */
  readonly flying: readonly FieldPlayer[];
  /** Ms of round time until the finale; <= 0 once it runs; null when there is none. */
  readonly finaleInMs: number | null;
  /** The number the finale banner announces ("נשארו 3"); null: say only that it gets harder. */
  readonly finaleLeft: number | null;
  /** Name of the last one standing once the round is decided; null before. */
  readonly winner: string | null;
}

export interface Spectator {
  readonly root: HTMLElement;
  show(state: SpectatorState): void;
  hide(): void;
  readonly visible: boolean;
  /** What the view shows right now (test hooks). */
  shown(): { verdict: string; place: string; air: string; names: string[]; finale: string; count: string; winner: string };
  destroy(): void;
}

const MAX_CHIPS = 8;

function el(tag: string, cls: string, text = ''): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== '') n.textContent = text;
  return n;
}

function setText(n: HTMLElement, value: string): boolean {
  if (n.textContent === value) return false;
  n.textContent = value;
  return true;
}

/** "מקום 7" / "מקום 7 מתוך 12". */
export function placeText(place: number | null, total: number | null): string {
  if (place === null) return '';
  return total !== null && total >= place ? `מקום ${place} מתוך ${total}` : `מקום ${place}`;
}

/** The finale banner's words: "!נשארו 3" before and during, with the real number. */
export function finaleText(left: number | null, begun: boolean): string {
  if (left !== null && left >= 2) return begun ? `נשארו ${left} - מחורחר!` : `נשארו ${left}!`;
  return begun ? 'מחורחר! נהיה קשה' : 'נהיה קשה!';
}

export function createSpectator(parent: HTMLElement, hudHeight: number, safeBottom: number): Spectator {
  const root = el('div', 'fl-out');
  root.style.paddingTop = `${Math.round(hudHeight + 6)}px`;
  root.style.paddingBottom = `${Math.round(safeBottom + 10)}px`;
  const burst = el('div', 'fl-burst');
  const verdict = el('div', 'fl-verdict');
  const place = el('div', 'fl-place');
  burst.append(verdict, place);
  const passed = el('div', 'fl-passed');
  const air = el('div', 'fl-air');
  const airNum = el('div', 'fl-air-num');
  airNum.dir = 'ltr';
  const airLabel = el('div', 'fl-air-label', 'עוד באוויר');
  air.append(airNum, airLabel);
  const finale = el('div', 'fl-finale');
  const finaleWords = el('span', 'fl-finale-words');
  const finaleCount = el('span', 'fl-finale-count');
  finaleCount.dir = 'ltr';
  finale.append(finaleWords, finaleCount);
  const winner = el('div', 'fl-winner');
  const list = el('div', 'fl-list');
  root.append(burst, passed, air, finale, winner, list);
  parent.appendChild(root);

  let visible = false;
  let listKey = '';
  let names: string[] = [];

  return {
    root,
    get visible(): boolean {
      return visible;
    },
    show(s: SpectatorState): void {
      if (!visible) {
        visible = true;
        root.classList.add('is-on');
      }
      root.classList.toggle('is-win', s.kind === 'win');
      setText(verdict, s.kind === 'win' ? 'ניצחת!' : 'נפלת!');
      setText(place, s.kind === 'win' ? 'צדיק! מקום 1' : placeText(s.place, s.total));
      setText(passed, s.passed === 1 ? 'עברת מכשול אחד' : `עברת ${s.passed} מכשולים`);

      const decided = s.winner !== null;
      const showAir = s.active !== null && s.kind !== 'win' && !decided;
      air.classList.toggle('is-hidden', !showAir);
      if (showAir && setText(airNum, String(s.active))) {
        airNum.classList.remove('is-bump');
        void airNum.offsetWidth;
        airNum.classList.add('is-bump');
      }

      // the finale: banner + 3-2-1 until it begins, then the banner stays
      const f = s.finaleInMs;
      const finaleOn = f !== null && f <= 3_000 && !decided && s.kind !== 'win';
      finale.classList.toggle('is-on', finaleOn);
      if (finaleOn && f !== null) {
        setText(finaleWords, finaleText(s.finaleLeft, f <= 0));
        setText(finaleCount, f > 0 ? String(Math.min(3, Math.ceil(f / 1000))) : '');
      }

      winner.classList.toggle('is-on', decided && s.kind !== 'win');
      if (decided && s.kind !== 'win') {
        const key = `w:${s.winner ?? ''}`;
        if (winner.dataset.key !== key) {
          winner.dataset.key = key;
          winner.replaceChildren();
          const name = document.createElement('bdi');
          name.textContent = s.winner ?? '';
          winner.append('👑 ', name, ' ניצח/ה!');
        }
      }

      const showList = s.flying.length > 0 && s.kind !== 'win' && !decided;
      list.classList.toggle('is-hidden', !showList);
      const key = showList ? s.flying.map((p) => p.id).join(',') : '';
      if (key !== listKey) {
        listKey = key;
        list.replaceChildren();
        names = [];
        const shownPlayers = s.flying.slice(0, s.flying.length > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS);
        for (const p of shownPlayers) {
          const chip = el('span', 'fl-chip');
          const dot = document.createElement('i');
          dot.style.background = PARTY_COLORS[Math.abs(p.avatar) % PARTY_COLORS.length] ?? '#ffd21f';
          const name = document.createElement('b');
          name.dir = 'auto';
          name.textContent = p.name === '' ? 'מישהו' : p.name;
          chip.append(dot, name);
          list.append(chip);
          names.push(name.textContent ?? '');
        }
        if (s.flying.length > shownPlayers.length) list.append(el('span', 'fl-chip is-more', `+${s.flying.length - shownPlayers.length}`));
      }
    },
    hide(): void {
      if (!visible) return;
      visible = false;
      root.classList.remove('is-on');
    },
    shown: () => ({
      verdict: verdict.textContent ?? '',
      place: place.textContent ?? '',
      air: air.classList.contains('is-hidden') ? '' : (airNum.textContent ?? ''),
      names: list.classList.contains('is-hidden') ? [] : [...names],
      finale: finale.classList.contains('is-on') ? (finaleWords.textContent ?? '') : '',
      count: finale.classList.contains('is-on') ? (finaleCount.textContent ?? '') : '',
      winner: winner.classList.contains('is-on') ? (winner.textContent ?? '') : '',
    }),
    destroy(): void {
      root.remove();
    },
  };
}
