/**
 * Builtin Plotzel (פלוצל): our own Hebrew five-letter word game, the safety net
 * behind the embed. DOM grid + on-screen keyboard, kit loop for every timer and
 * animation (so a cutscene freeze stops everything), kit fx canvas on top for
 * clouds and confetti.
 */
import './plotzel.css';

import { sfx } from '../../kit/audio';
import { createGameCanvas } from '../../kit/canvas';
import { clamp, createFx, ease } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createLoop } from '../../kit/loop';
import { COLORS } from '../../kit/theme';
import { loadPlotzelArt } from './art';
import {
  betterState,
  countStates,
  displayLetter,
  evaluateGuess,
  isHebrewLetter,
  MAX_TRIES,
  normalizeLetter,
  partialScore,
  pickAnswer,
  solvedScore,
  WORD_LEN,
} from './logic';

import type { Drawable } from '../../kit/assets';
import type { GameContext, GameInstance } from '../types';
import type { LetterState } from './logic';

/** Keyboard rows in the physical Hebrew order (left to right), base letters only. */
const KB_ROWS: readonly (readonly string[])[] = [
  ['ENTER', 'ק', 'ר', 'א', 'ט', 'ו', 'פ', 'DEL'],
  ['ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל'],
  ['ז', 'ס', 'ב', 'ה', 'נ', 'מ', 'צ', 'ת'],
];

const FLIP_MS = 300;
const FLIP_STAGGER_MS = 230;
const FINISH_AFTER_WIN_MS = 2400;
const FINISH_AFTER_LOSS_MS = 3400;
/** Fart per wrong row: [variant, pitch]. */
const ROW_FARTS: ReadonlyArray<readonly [number, number]> = [
  [0, 1.35],
  [2, 1.2],
  [3, 1.05],
  [0, 0.92],
  [2, 0.8],
  [1, 0.7],
];
const WIN_LINES = ['גאונות! בניסיון הראשון!', 'מדהים! שני ניסיונות!', 'יפה מאוד! שלושה ניסיונות', 'כל הכבוד! ארבעה ניסיונות', 'הצלחת! חמישה ניסיונות', 'על הקשקש! ניסיון אחרון!'];
const OOPS_LINES = ['פלוץ! נסו שוב', 'פררט… עוד ניסיון', 'אופס, זה לא זה', 'מתקרבים!', 'עוד שניים בלבד!', ''];

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
}

export interface BuiltinOptions {
  /** Parent element (default ctx.root). */
  readonly root?: HTMLElement;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const STATE_CLASS: Record<LetterState, string> = { correct: 'is-correct', present: 'is-present', absent: 'is-absent' };

function setStateClass(node: HTMLElement, state: LetterState | undefined): void {
  node.classList.remove('is-correct', 'is-present', 'is-absent');
  if (state) node.classList.add(STATE_CLASS[state]);
}

/** Mount the builtin game into `opts.root ?? ctx.root`. */
export async function createBuiltin(ctx: GameContext, opts: BuiltinOptions = {}): Promise<GameInstance> {
  const parent = opts.root ?? ctx.root;
  const art = await loadPlotzelArt();
  const answer = pickAnswer(ctx.seed);
  const answerLetters = [...answer].map(normalizeLetter);

  // ── DOM ──
  const wrap = el('div', 'pz');
  wrap.dataset.plotzel = 'builtin';
  wrap.dataset.state = 'playing';
  wrap.style.setProperty('--pz-top', `${ctx.hudHeight}px`);
  wrap.style.setProperty('--pz-bottom', `${ctx.safeBottom}px`);

  const board = el('div', 'pz-board');
  const grid = el('div', 'pz-grid');
  const rowEls: HTMLElement[] = [];
  const tileEls: HTMLElement[][] = [];
  for (let r = 0; r < MAX_TRIES; r++) {
    const row = el('div', 'pz-row');
    const tiles: HTMLElement[] = [];
    for (let c = 0; c < WORD_LEN; c++) {
      const t = el('div', 'pz-tile');
      row.append(t);
      tiles.push(t);
    }
    grid.append(row);
    rowEls.push(row);
    tileEls.push(tiles);
  }
  const reveal = el('div', 'pz-reveal');
  const revealWord = el('div', 'pz-reveal-word');
  reveal.append(el('div', 'pz-reveal-title', 'המילה הייתה:'), revealWord);
  board.append(grid, reveal);

  const msg = el('div', 'pz-msg');
  const mascot = document.createElement('img');
  mascot.className = 'pz-mascot';
  mascot.alt = '';
  mascot.draggable = false;
  const bubble = el('div', 'pz-bubble', 'נחשו את המילה! 💨');
  msg.append(mascot, bubble);

  const kb = el('div', 'pz-kb');
  const keyEls = new Map<string, HTMLButtonElement>();
  for (const rowKeys of KB_ROWS) {
    const row = el('div', 'pz-kb-row');
    for (const k of rowKeys) {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = 'pz-key';
      b.dataset.k = k;
      if (k === 'ENTER') {
        b.classList.add('is-wide', 'is-enter');
        b.textContent = 'שלח';
      } else if (k === 'DEL') {
        b.classList.add('is-wide', 'is-del');
        b.textContent = '⌫';
        b.setAttribute('aria-label', 'מחיקה');
      } else {
        b.textContent = k;
        keyEls.set(k, b);
      }
      row.append(b);
    }
    kb.append(row);
  }

  const fxRoot = el('div', 'pz-fx');
  wrap.append(board, msg, kb, fxRoot);
  parent.appendChild(wrap);

  const view = createGameCanvas(fxRoot);
  const fx = createFx(400);

  // ── sizing (layout only, not gameplay) ──
  function layout(): void {
    const kbWidth = wrap.clientWidth - 12;
    const u = clamp(Math.floor((kbWidth - 7 * 5) / 9), 30, 46);
    kb.style.setProperty('--u', `${u}px`);
    const bw = board.clientWidth;
    const bh = board.clientHeight - 12;
    const tile = Math.floor(clamp(Math.min((bh - 5 * 6) / MAX_TRIES, (bw - 4 * 6 - 8) / WORD_LEN), 30, 64));
    grid.style.setProperty('--tile', `${tile}px`);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null;
  ro?.observe(wrap);
  window.addEventListener('resize', layout);
  layout();

  // ── state ──
  const rows: string[][] = Array.from({ length: MAX_TRIES }, () => []);
  let rowIdx = 0;
  let locked = false;
  let done = false;
  let destroyed = false;
  let best = 0;
  const keyState = new Map<string, LetterState>();
  const puffs: Puff[] = [];
  let cancelMsg: (() => void) | null = null;

  function setMascot(d: Drawable): void {
    if (mascot.src !== d.url) mascot.src = d.url;
  }
  setMascot(art.mascot);

  function say(text: string, kind: 'info' | 'bad' | 'win' = 'info', ms = 0): void {
    bubble.textContent = text;
    bubble.classList.toggle('is-bad', kind === 'bad');
    bubble.classList.toggle('is-win', kind === 'win');
    cancelMsg?.();
    cancelMsg = null;
    if (ms > 0) {
      cancelMsg = loop.after(ms, () => {
        cancelMsg = null;
        if (!done) say(rowIdx === 0 ? 'נחשו את המילה! 💨' : `ניסיון ${rowIdx + 1} מתוך ${MAX_TRIES}`);
      });
    }
  }

  function markCurrentRow(): void {
    rowEls.forEach((r, i) => r.classList.toggle('is-current', i === rowIdx && !done));
  }
  markCurrentRow();

  function paintRow(r: number): void {
    const letters = rows[r] ?? [];
    const tiles = tileEls[r] ?? [];
    for (let c = 0; c < WORD_LEN; c++) {
      const t = tiles[c];
      if (!t) continue;
      const ch = letters[c];
      t.textContent = ch === undefined ? '' : displayLetter(ch, c);
      t.classList.toggle('is-filled', ch !== undefined);
    }
  }

  function pop(node: HTMLElement, from = 1.14): void {
    fx.tween({
      ms: 120,
      ease: ease.outQuad,
      update(v: number): void {
        node.style.transform = `scale(${from + (1 - from) * v})`;
      },
      done(): void {
        node.style.transform = '';
      },
    });
  }

  function shakeRow(r: number): void {
    const row = rowEls[r];
    if (!row) return;
    fx.tween({
      ms: 420,
      update(v: number): void {
        row.style.transform = `translateX(${Math.sin(v * Math.PI * 7) * (1 - v) * 12}px)`;
      },
      done(): void {
        row.style.transform = '';
      },
    });
  }

  /** Center of an element in fx-canvas coordinates. */
  function centerOf(node: Element, side: 'center' | 'end' = 'center'): { x: number; y: number } {
    const a = node.getBoundingClientRect();
    const b = fxRoot.getBoundingClientRect();
    // RTL row: the "end" of the word is its left edge
    const x = side === 'end' ? a.left - b.left : a.left - b.left + a.width / 2;
    return { x, y: a.top - b.top + a.height / 2 };
  }

  function puffAt(x: number, y: number, n: number, rowNo: number): void {
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n;
      const max = 1.1 + 0.25 * k;
      puffs.push({
        x: x + (i - n / 2) * 8,
        y: y + ((i * 7) % 11) - 5,
        vx: -25 - 45 * k,
        vy: -12 - 10 * ((i * 3) % 4),
        life: max,
        max,
        size: 38 + 10 * ((rowNo + i) % 3),
        rot: (i - 1) * 0.3,
        vr: (i % 2 === 0 ? 1 : -1) * 0.6,
      });
    }
    fx.burst(x, y, { count: 14, colors: ['#7fe08a', '#b7f5a0', '#4fbf6a'], speed: 160, size: 6, life: 0.7, gravity: -120 });
  }

  // ── typing ──
  function typeLetter(ch: string): void {
    const letters = rows[rowIdx];
    if (!letters || letters.length >= WORD_LEN) return;
    letters.push(normalizeLetter(ch));
    paintRow(rowIdx);
    const tile = tileEls[rowIdx]?.[letters.length - 1];
    if (tile) pop(tile);
    sfx.key(1 + letters.length * 0.04);
    haptic.tap();
  }

  function deleteLetter(): void {
    const letters = rows[rowIdx];
    if (!letters || letters.length === 0) return;
    letters.pop();
    paintRow(rowIdx);
    sfx.tap(0.8);
  }

  function submit(): void {
    const letters = rows[rowIdx];
    if (!letters) return;
    if (letters.length < WORD_LEN) {
      shakeRow(rowIdx);
      say(letters.length === 0 ? 'מקלידים 5 אותיות 👇' : 'חסרות אותיות!', 'bad', 1400);
      sfx.tap(0.55);
      haptic.fail();
      return;
    }
    const guess = letters.join('');
    const states = evaluateGuess(guess, answer);
    const tries = rowIdx + 1;
    const solved = states.every((s) => s === 'correct');
    // the score is decided at the moment of submitting; the flip is cosmetic
    if (solved) {
      ctx.setScore(solvedScore(tries, ctx.timeLeftMs(), ctx.durationMs));
    } else {
      const { greens, yellows } = countStates(states);
      best = Math.max(best, partialScore(greens, yellows));
      ctx.setScore(best);
    }
    locked = true;
    const r = rowIdx;
    const tiles = tileEls[r] ?? [];
    tiles.forEach((tile, c) => {
      let applied = false;
      fx.tween({
        ms: FLIP_MS,
        delay: c * FLIP_STAGGER_MS,
        update(v: number): void {
          if (v >= 0.5 && !applied) {
            applied = true;
            setStateClass(tile, states[c]);
            if (states[c] === 'correct') sfx.pop(1 + c * 0.08);
            else if (states[c] === 'present') sfx.coin(0.9 + c * 0.04);
            else sfx.tap(0.7);
          }
          tile.style.transform = `scaleY(${Math.abs(1 - 2 * v)})`;
        },
        done(): void {
          tile.style.transform = '';
        },
      });
    });
    loop.after((WORD_LEN - 1) * FLIP_STAGGER_MS + FLIP_MS + 60, () => afterReveal(r, states, solved));
  }

  function afterReveal(r: number, states: readonly LetterState[], solved: boolean): void {
    const letters = rows[r] ?? [];
    letters.forEach((ch, i) => {
      const s = states[i];
      if (s === undefined) return;
      const next = betterState(keyState.get(ch), s);
      keyState.set(ch, next);
      const key = keyEls.get(ch);
      if (key) setStateClass(key, next);
    });
    const rowEl = rowEls[r];
    if (solved) {
      win(r);
      return;
    }
    const [variant, pitch] = ROW_FARTS[r] ?? [1, 0.7];
    sfx.fart(variant, pitch);
    haptic.bump();
    if (rowEl) {
      const p = centerOf(rowEl, 'end');
      puffAt(p.x + 14, p.y, 3 + Math.min(3, r), r);
    }
    setMascot(art.mascotOops);
    loop.after(900, () => {
      if (!done) setMascot(art.mascot);
    });
    if (r >= MAX_TRIES - 1) {
      lose();
      return;
    }
    rowIdx = r + 1;
    locked = false;
    markCurrentRow();
    say(OOPS_LINES[r] ?? '', 'info', 1600);
  }

  function win(r: number): void {
    done = true;
    wrap.dataset.state = 'solved';
    markCurrentRow();
    setMascot(art.mascotHappy);
    say(WIN_LINES[r] ?? 'הצלחת!', 'win');
    sfx.fanfare();
    sfx.cheer();
    haptic.success();
    fx.confetti({ count: 160, width: view.width });
    const rowEl = rowEls[r];
    if (rowEl) {
      const p = centerOf(rowEl);
      fx.burst(p.x, p.y, { count: 30, shape: 'star', colors: [COLORS.yellow, COLORS.green, '#fff'], speed: 420 });
    }
    (tileEls[r] ?? []).forEach((tile, c) => {
      fx.tween({
        ms: 520,
        delay: c * 90,
        update(v: number): void {
          tile.style.transform = `translateY(${-Math.sin(v * Math.PI) * 22}px) rotate(${Math.sin(v * Math.PI) * 8}deg)`;
        },
        done(): void {
          tile.style.transform = '';
        },
      });
    });
    loop.after(FINISH_AFTER_WIN_MS, () => ctx.finish());
  }

  function lose(): void {
    done = true;
    wrap.dataset.state = 'failed';
    markCurrentRow();
    say('נגמרו הניסיונות 💨', 'bad');
    setMascot(art.mascotOops);
    revealWord.replaceChildren();
    answerLetters.forEach((ch, i) => {
      const t = el('div', 'pz-tile is-correct', displayLetter(ch, i));
      revealWord.append(t);
    });
    loop.after(700, () => {
      reveal.classList.add('is-on');
      pop(reveal, 0.6);
      sfx.fart(1, 0.62);
      const box = reveal.getBoundingClientRect();
      const origin = fxRoot.getBoundingClientRect();
      puffAt(box.left - origin.left + 20, box.bottom - origin.top + 10, 5, 2);
    });
    loop.after(FINISH_AFTER_LOSS_MS, () => ctx.finish());
  }

  function press(k: string): void {
    if (destroyed || done || locked || ctx.isPaused()) return;
    if (k === 'ENTER') submit();
    else if (k === 'DEL') deleteLetter();
    else if (isHebrewLetter(k)) typeLetter(k);
  }

  // ── input: on-screen keys (pointer) + a physical keyboard for desktops ──
  let downKey: HTMLElement | null = null;
  const onKbDown = (e: PointerEvent): void => {
    e.preventDefault(); // no focus, no selection, no ghost click
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>('.pz-key') : null;
    if (!target) return;
    downKey?.classList.remove('is-down');
    downKey = target;
    target.classList.add('is-down');
    press(target.dataset.k ?? '');
  };
  const onKbUp = (): void => {
    downKey?.classList.remove('is-down');
    downKey = null;
  };
  kb.addEventListener('pointerdown', onKbDown);
  window.addEventListener('pointerup', onKbUp);
  window.addEventListener('pointercancel', onKbUp);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') press('ENTER');
    else if (e.key === 'Backspace') press('DEL');
    else if (e.key.length === 1 && isHebrewLetter(e.key)) press(e.key);
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown);

  // ── loop: fx canvas (puffs, confetti) ──
  const loop = createLoop({
    update(dt: number): void {
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        if (!p) continue;
        p.life -= dt;
        if (p.life <= 0) {
          puffs.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.97;
        p.vy *= 0.985;
        p.rot += p.vr * dt;
      }
      fx.update(dt);
    },
    render(): void {
      const g = view.ctx;
      view.clear();
      for (const p of puffs) {
        const t = 1 - p.life / p.max; // 0 → 1
        const s = p.size * (0.5 + ease.outBack(Math.min(1, t * 3)) * 0.6 + t * 0.5);
        g.globalAlpha = Math.max(0, Math.min(1, (1 - t) * 1.6));
        art.cloud.draw(g, p.x, p.y, s, s, p.rot);
      }
      g.globalAlpha = 1;
      fx.draw(g);
    },
  });
  loop.start();

  return {
    setPaused(paused: boolean): void {
      wrap.classList.toggle('is-paused', paused);
      onKbUp();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      loop.stop();
      ro?.disconnect();
      window.removeEventListener('resize', layout);
      kb.removeEventListener('pointerdown', onKbDown);
      window.removeEventListener('pointerup', onKbUp);
      window.removeEventListener('pointercancel', onKbUp);
      window.removeEventListener('keydown', onKeyDown);
      view.dispose();
      wrap.remove();
    },
  };
}
