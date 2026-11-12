/**
 * פלוצל (Plotzel): the owner's word ladder (original/plotzel.netlify.app.html),
 * native in our kit and party look. From a start word reach פלוץ; every step
 * changes exactly one letter and must be a dictionary word. One round = a
 * seeded sequence of ladders (round.ts) that always opens with חמוד, פוקי, נדיר, שימי; solve one
 * and the next slides in. No hints (the owner's rule); "דלג" shows the shortest
 * path for no points. A ladder's score is 80% speed and 20% steps (round.ts);
 * the tray shows what the ladder is worth right now, counting down.
 *
 * Rules and texts: ladder.ts (the original's logic) and round.ts (sequence,
 * scoring). DOM board + on-screen keyboard; every timer is a kit loop timer and
 * every animation a CSS animation paused by setPaused, so a freeze stops all.
 *
 * Announcements never cover a row: toasts, the first ladder's demo and the solve
 * celebration live in the lane, a band of its own between the ladder and the keyboard
 * that the rows never use (the demo and the celebration may also take the free room
 * right above it). One at a time, a newer one replaces the older one; a toast lives
 * 1.4 s, and the celebration is over before the next ladder slides in.
 */
import './plotzel.css';

import { GAMES } from '../../../../shared/protocol';
import { sfx } from '../../kit/audio';
import { createGameCanvas } from '../../kit/canvas';
import { clamp, createFx, ease } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createLoop, isKitPaused } from '../../kit/loop';
import { loadPlotzelArt } from './art';
import { checkStep, diffCount, disp, getLadder, HEB, ladderBuildMs, REGULAR_OF, TARGET, TARGET_D, WORD_LEN } from './ladder';
import { ladderScore, roundSequence, startPar, startPath } from './round';
import { loadSnapshot, saveSnapshot } from './snapshot';

import type { GameContext, GameInstance, GameModule } from '../types';
import type { PuzzleResult, Snapshot } from './snapshot';

// ───────────────────────────── Tuning ─────────────────────────────

const MAX_RAW = GAMES.plotzel.maxRaw;
/** Solve → the next ladder slides in. */
const CELEBRATE_MS = 1200;
/** Skip → the shortest path stays up this long. */
const REVEAL_MS = 2500;
/** "דלג" unlocks after this much play on the same ladder. */
const SKIP_AFTER_MS = 15_000;
/** The confirm tap must come within this. */
const SKIP_ARM_MS = 3000;
/** A lane message lives this long (never more than 1.4 s). */
const TOAST_MS = 1400;
/** The first ladder's how-to (the demo, or its toast when there is no room): until the first step, at most this long. */
const DEMO_MS = 3400;
const HURRY_MS = 10_000;
/** The solve celebration (sticker, puff, face) is over before the next ladder slides in (CELEBRATE_MS). The sticker's CSS animation is 1 s too. */
const PUFF_S = 0.9;
const MASCOT_S = 1;
/** The celebration sticker's height in px, fitted between the solved row and the keyboard. */
const STICKER_MIN = 48;
const STICKER_MAX = 116;

/** The standard Israeli layout, exactly as the original lays it out (left to right). */
const KB_ROWS: ReadonlyArray<readonly [string, 'BACK' | 'ENTER' | null]> = [
  ['קראטוןםפ', 'BACK'],
  ['שדגכעיחלךף', null],
  ['זסבהנמצתץ', 'ENTER'],
];
/** Physical keyboards on an English layout still type Hebrew by key position (the original's CODE_MAP). */
const CODE_MAP: Readonly<Record<string, string>> = {
  KeyE: 'ק', KeyR: 'ר', KeyT: 'א', KeyY: 'ט', KeyU: 'ו', KeyI: 'ן', KeyO: 'ם', KeyP: 'פ', KeyA: 'ש', KeyS: 'ד', KeyD: 'ג', KeyF: 'כ', KeyG: 'ע',
  KeyH: 'י', KeyJ: 'ח', KeyK: 'ל', KeyL: 'ך', Semicolon: 'ף', KeyZ: 'ז', KeyX: 'ס', KeyC: 'ב', KeyV: 'ה', KeyB: 'נ', KeyN: 'מ', KeyM: 'צ', Comma: 'ת', Period: 'ץ',
};

/** Canvas fx colours: the design system's (plotzel.css --pz-*). */
const FX = { yel: '#ffd21f', red: '#f2361b', white: '#fff8e6', pink: '#ff7eb6', org: '#ff9f0a' } as const;
/** The owner's words for a solve in exactly par (README "Voice"). */
const PERFECT_WORDS: readonly string[] = ['שיא!', 'אש!', 'וואו!', 'מחורחר!'];

type Phase = 'play' | 'celebrate' | 'reveal' | 'done';

export interface PlotzelDebug {
  readonly start: string;
  readonly target: string;
  readonly par: number;
  readonly words: readonly string[];
  readonly puzzleIndex: number;
  readonly solved: number;
  readonly score: number;
  readonly phase: Phase;
  readonly typed: string;
  readonly skipReady: boolean;
  /** Round ms spent on the current ladder (the score's clock). */
  readonly elapsedMs: number;
  /** What the ladder is worth if the next word solves it (the number in the tray). */
  readonly worth: number;
  readonly results: readonly PuzzleResult[];
  readonly buildMs: number;
  /** Shortest path from the current word (the start until the first step) to פלוץ, as shown. */
  path(): string[];
  /** The first n start words of this round, as shown. */
  sequence(n: number): string[];
}

declare global {
  interface Window {
    /** Read-only state of the running Plotzel game for test scripts. Removed on destroy. */
    __plotzel?: PlotzelDebug;
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Restart a CSS animation class. */
function replay(node: Element, cls: string): void {
  node.classList.remove(cls);
  void (node as HTMLElement).offsetWidth;
  node.classList.add(cls);
}

function wordRow(w: string, prev: string | undefined, cls = ''): HTMLElement {
  const row = el('div', `pz-row${cls ? ' ' + cls : ''}`);
  const shown = disp(w);
  row.setAttribute('aria-label', shown);
  for (let j = 0; j < WORD_LEN; j++) {
    const t = el('div', 'pz-tile', shown[j] ?? '');
    if (w[j] === TARGET[j]) t.classList.add('is-hit');
    if (prev !== undefined && prev[j] !== w[j]) t.classList.add('is-changed');
    row.append(t);
  }
  return row;
}

function chips(ws: readonly string[]): HTMLElement {
  const box = el('div', 'pz-chips');
  ws.forEach((w, i) => {
    if (i > 0) box.append(el('span', 'pz-arrow', '←'));
    box.append(el('span', `pz-chip${w === TARGET ? ' is-goal' : ''}`, disp(w)));
  });
  return box;
}

export const game: GameModule = {
  id: 'plotzel',
  async create(ctx: GameContext): Promise<GameInstance> {
    // The graph is built here, once: in the party the stage mounts the game during
    // the countdown (frozen), so this never costs a frame of play.
    const ladder = getLadder();
    const seq = roundSequence(ctx.seed, ladder);
    const art = await loadPlotzelArt();

    // ── DOM ──
    const root = el('div', 'pz');
    root.dataset.plotzel = 'ladder';
    root.style.setProperty('--pz-top', `${ctx.hudHeight}px`);
    root.style.setProperty('--pz-bottom', `${ctx.safeBottom}px`);
    if (!art.background.isPlaceholder) root.style.setProperty('--pz-bg', `url("${art.background.url}")`);

    const head = el('div', 'pz-head');
    const route = el('div', 'pz-route');
    const startChip = el('span', 'pz-chip is-start');
    route.append(startChip, el('span', 'pz-arrow', '←'), el('span', 'pz-chip is-goal', TARGET_D));
    const stats = el('div', 'pz-stats');
    const stepsEl = el('div', 'pz-steps');
    const parEl = el('div', 'pz-par');
    stats.append(stepsEl, parEl);
    head.append(route, stats);

    const board = el('div', 'pz-board');
    const rowsEl = el('div', 'pz-rows');
    const moreEl = el('div', 'pz-more');
    const activeRow = el('div', 'pz-row is-active');
    activeRow.id = 'pz-active';
    const activeTiles: HTMLElement[] = [];
    for (let j = 0; j < WORD_LEN; j++) {
      const t = el('div', 'pz-tile');
      activeTiles.push(t);
      activeRow.append(t);
    }
    const ghostRow = el('div', 'pz-row is-ghost');
    ghostRow.setAttribute('aria-hidden', 'true');
    for (const ch of TARGET_D) ghostRow.append(el('div', 'pz-tile', ch));
    rowsEl.append(moreEl, activeRow, ghostRow);
    const toastEl = el('div', 'pz-toast');
    toastEl.setAttribute('role', 'status');
    const revealEl = el('div', 'pz-reveal');
    const demoEl = el('div', 'pz-demo');
    demoEl.setAttribute('aria-hidden', 'true');
    const stickerEl = el('div', 'pz-sticker');
    const stickerWord = el('div', 'pz-sticker-word');
    const stickerPts = el('div', 'pz-sticker-pts');
    const stickerFace = el('div', 'pz-sticker-face');
    stickerFace.append(stickerWord, stickerPts);
    stickerEl.append(stickerFace);
    stickerEl.setAttribute('aria-hidden', 'true');
    board.append(rowsEl, revealEl);
    // the announcement lane: its own band between the ladder and the keyboard (rows never reach it)
    const laneEl = el('div', 'pz-lane');
    laneEl.append(demoEl, stickerEl, toastEl);

    const kb = el('div', 'pz-kb');
    kb.dir = 'ltr';
    const keyEls: HTMLElement[] = [];
    let enterKey: HTMLElement | null = null;
    for (const [letters, extra] of KB_ROWS) {
      const row = el('div', 'pz-kb-row');
      const add = (label: string, k: string, cls = ''): HTMLElement => {
        const b = el('button', `pz-key${cls ? ' ' + cls : ''}`, label);
        b.setAttribute('type', 'button');
        b.tabIndex = -1;
        b.dataset.k = k;
        row.append(b);
        keyEls.push(b);
        return b;
      };
      for (const ch of letters) add(ch, ch);
      if (extra === 'BACK') add('⌫', 'BACK', 'is-wide is-back').setAttribute('aria-label', 'מחיקת אות');
      if (extra === 'ENTER') enterKey = add('אישור', 'ENTER', 'is-wide is-enter');
      kb.append(row);
    }

    const tools = el('div', 'pz-tools');
    const countEl = el('div', 'pz-count');
    const countNum = el('span', 'pz-count-num');
    const doneEl = el('span', 'pz-done');
    doneEl.dir = 'ltr';
    countEl.append(countNum, doneEl);
    // what this ladder is worth if the next word solves it: counts down (80% of a ladder is speed)
    const worthEl = el('div', 'pz-worth');
    const worthNum = el('span', 'pz-worth-num');
    worthNum.dir = 'ltr';
    worthEl.append(el('span', 'pz-worth-cap', 'שווה'), worthNum);
    const skipBtn = el('button', 'pz-tool is-skip');
    skipBtn.dataset.act = 'skip';
    const skipLabel = el('span', 'pz-tool-label', 'דלג');
    skipBtn.append(el('span', 'pz-skip-fill'), skipLabel);
    skipBtn.setAttribute('type', 'button');
    skipBtn.tabIndex = -1;
    tools.append(countEl, worthEl, skipBtn);

    const fxRoot = el('div', 'pz-fx');
    root.append(head, board, laneEl, kb, tools, fxRoot);
    ctx.root.appendChild(root);

    const view = createGameCanvas(fxRoot);
    view.canvas.style.pointerEvents = 'none';
    const fx = createFx(320);

    // ── state ──
    let idx = 0;
    let start = seq[0] ?? TARGET;
    let par = startPar(ladder, start) ?? 0;
    let words: string[] = [start];
    let typed = '';
    let puzzleT0 = 0;
    /** Round time left (ms) when this ladder began: the score's clock, kept across a reload. */
    let puzzleLeft0 = ctx.durationMs;
    let shownWorth = -1;
    let score = 0;
    let results: PuzzleResult[] = [];
    let phase: Phase = 'play';
    let skipArmed = false;
    let cancelDisarm: (() => void) | null = null;
    let cancelToast: (() => void) | null = null;
    let cancelDemo: (() => void) | null = null;
    let hurry = false;
    let destroyed = false;
    let wordRows: HTMLElement[] = [];
    let tile = 52;
    let rowGap = 6;
    let laneH = 46;
    let shownSkipP = -1;
    let fxBusyUntil = 0;
    let solveCount = 0;
    const puffs: Array<{ x: number; y: number; t: number; size: number }> = [];
    let mascot: { x: number; y: number; t: number; r: number } | null = null;

    const current = (): string => words[words.length - 1] ?? start;
    const steps = (): number => words.length - 1;
    const isPaused = (): boolean => isKitPaused() || ctx.isPaused();
    /** Round time left now; the countdown before the round is "the round has not begun". */
    const leftNow = (): number => clamp(ctx.timeLeftMs(), 0, ctx.durationMs);
    /**
     * Time spent on this ladder, for the score: by the round clock (it survives a reload and
     * stands still in a freeze), and never less than the game's own clock.
     */
    const elapsedMs = (): number => Math.max(0, puzzleLeft0 - leftNow(), loop.timeMs - puzzleT0);
    /** What the ladder is worth if the next word solves it. */
    const worthNow = (): number => ladderScore(Math.max(par, steps() + 1), par, elapsedMs());

    // ── snapshot (reload resumes) ──
    function snapshot(over?: Partial<Snapshot>): void {
      saveSnapshot(ctx.seed, {
        idx,
        words,
        spentMs: phase === 'play' ? Math.max(0, loop.timeMs - puzzleT0) : 0,
        leftAtStartMs: phase === 'play' ? puzzleLeft0 : null,
        score,
        results,
        ...over,
      });
    }
    /** The committed state after a solve / skip: the next puzzle, fresh. */
    function snapshotNext(): void {
      const next = seq[idx + 1];
      snapshot({ idx: idx + 1, words: next !== undefined ? [next] : [], spentMs: 0, leftAtStartMs: null });
    }

    // ── layout (sizes only, never gameplay) ──
    function layout(): void {
      const W = root.clientWidth;
      const H = root.clientHeight;
      if (W <= 0 || H <= 0) return;
      const avail = H - ctx.hudHeight - ctx.safeBottom;
      const portrait = H >= W;
      const keyH = portrait ? clamp(Math.round(avail * 0.088), 44, 56) : clamp(Math.round(avail * 0.11), 32, 44);
      const keyGap = W < 340 ? 1.6 : W < 380 ? 4 : 5;
      root.style.setProperty('--key-h', `${keyH}px`);
      root.style.setProperty('--key-gap', `${keyGap}px`);
      root.style.setProperty('--key-fs', `${clamp(Math.round(keyH * 0.4), 17, 22)}px`);
      root.style.setProperty('--kb-row-gap', `${portrait ? (avail < 560 ? 5 : 7) : 4}px`);
      root.classList.toggle('is-landscape', !portrait);
      root.classList.toggle('is-short', avail < 560);
      // the lane first (the board is what is left after it): one toast line
      laneH = portrait ? clamp(Math.round(avail * 0.06), 36, 46) : 28;
      root.style.setProperty('--lane-h', `${laneH}px`);
      root.style.setProperty('--toast-fs', `${clamp(Math.round(laneH * 0.4), 13, 18)}px`);
      // the board gets what is left: tiles for about five rows, never wider than four of 64 px
      const bw = board.clientWidth;
      const bh = board.clientHeight;
      rowGap = bh < 300 ? 5 : 6;
      tile = Math.floor(clamp(Math.min((bw - 3 * rowGap - 8) / 4, (bh - 4 * rowGap - 8) / 5), 30, 64));
      // a very short board (landscape): the last word, the active row and the goal must still fit
      if (3 * tile + 2 * rowGap + 10 > bh) tile = Math.max(18, Math.floor((bh - 2 * rowGap - 10) / 3));
      root.style.setProperty('--tile', `${tile}px`);
      root.style.setProperty('--row-gap', `${rowGap}px`);
      if (enterKey) enterKey.classList.toggle('is-tight', enterKey.clientWidth < 46);
      fitRows();
    }

    /**
     * Show the latest rows that fit; older ones collapse into "+N". Never scrolls. While a solve
     * is celebrated the solved word takes the typing row's place and the goal row's place stays
     * free: the celebration sits there and in the lane, never on a word.
     */
    function fitRows(): void {
      const live = phase === 'play';
      activeRow.hidden = !live;
      ghostRow.hidden = !live;
      const bh = board.clientHeight - 8;
      const rowH = tile + rowGap;
      const fixed = live ? 2 : phase === 'celebrate' ? 1 : 0;
      const slots = Math.max(0, Math.floor((bh + rowGap) / rowH) - fixed);
      let hidden = 0;
      let marker = false;
      if (wordRows.length > slots) {
        // the marker takes about half a row; on a very short board there is no room for it
        const withMarker = Math.floor((bh + rowGap - 26) / rowH) - fixed;
        marker = withMarker >= 1;
        hidden = Math.max(0, wordRows.length - (marker ? withMarker : Math.max(live ? 0 : 1, slots)));
      }
      wordRows.forEach((r, i) => {
        r.hidden = i < hidden;
      });
      moreEl.hidden = !marker;
      moreEl.textContent = `+${hidden}`;
      positionDemo();
    }

    // ── rendering ──
    function renderHead(): void {
      startChip.textContent = disp(start);
      stepsEl.textContent = `צעדים ${steps()}`;
      parEl.textContent = `מינימום ${par}`;
      countNum.textContent = `חידה ${idx + 1}`;
      doneEl.textContent = `✓ ${solveCount}`;
      doneEl.hidden = solveCount === 0;
      worthEl.classList.toggle('is-off', phase !== 'play');
    }

    function renderActive(popAt = -1): void {
      const shown = disp(typed);
      for (let j = 0; j < WORD_LEN; j++) {
        const t = activeTiles[j];
        if (!t) continue;
        t.textContent = shown[j] ?? '';
        t.classList.toggle('is-filled', typed[j] !== undefined);
        t.classList.toggle('is-cursor', j === typed.length);
        if (j === popAt) replay(t, 'is-pop');
      }
    }

    function rebuildRows(): void {
      for (const r of wordRows) r.remove();
      wordRows = words.map((w, i) => wordRow(w, words[i - 1]));
      for (const r of wordRows) rowsEl.insertBefore(r, activeRow);
      renderActive();
      renderHead();
      fitRows();
    }

    function setupPuzzle(i: number, restored: Snapshot | null): void {
      idx = i;
      start = seq[i] ?? TARGET;
      par = startPar(ladder, start) ?? 0;
      words = [start];
      if (restored && isValidLadder(restored.words)) words = [...restored.words];
      typed = '';
      phase = 'play';
      puzzleT0 = loop.timeMs - (restored ? clamp(restored.spentMs, 0, SKIP_AFTER_MS) : 0);
      // the first ladder begins with the round; a restored one keeps the start it had
      const left = leftNow();
      const kept = restored ? restored.leftAtStartMs : null;
      puzzleLeft0 = kept !== null ? clamp(kept, left, ctx.durationMs) : i === 0 ? ctx.durationMs : left;
      shownWorth = -1;
      disarmSkip();
      revealEl.classList.remove('is-on');
      revealEl.replaceChildren();
      stickerEl.classList.remove('is-on');
      shownSkipP = -1;
      rebuildRows();
    }

    function isValidLadder(ws: readonly string[]): boolean {
      if (ws[0] !== start || ws.includes(TARGET)) return false;
      for (let i = 1; i < ws.length; i++) {
        const w = ws[i] ?? '';
        if (!ladder.has(w) || diffCount(w, ws[i - 1] ?? '') !== 1 || ws.indexOf(w) !== i) return false;
      }
      return true;
    }

    // ── the lane: one message at a time (a toast, the demo or the celebration); a newer one replaces it ──
    function hideToast(): void {
      cancelToast?.();
      cancelToast = null;
      toastEl.classList.remove('is-on');
    }
    function hideDemo(): void {
      cancelDemo?.();
      cancelDemo = null;
      demoEl.classList.remove('is-on');
    }
    function hideCelebration(): void {
      stickerEl.classList.remove('is-on');
      puffs.length = 0;
      mascot = null;
    }

    function toast(msg: string, kind: 'bad' | 'info' | 'hurry' = 'info', ms = TOAST_MS): void {
      hideDemo();
      hideCelebration();
      toastEl.textContent = msg;
      toastEl.dataset.kind = kind;
      fitToast();
      replay(toastEl, 'is-on');
      cancelToast?.();
      cancelToast = loop.after(ms, () => {
        cancelToast = null;
        toastEl.classList.remove('is-on');
      });
    }

    /** One line, never cut: a long message on a narrow phone gets a smaller font. */
    function fitToast(): void {
      toastEl.style.fontSize = '';
      for (let i = 0; i < 8 && toastEl.scrollWidth > toastEl.clientWidth + 0.5; i++) {
        const fs = parseFloat(getComputedStyle(toastEl).fontSize) || 16;
        if (fs <= 11) break;
        toastEl.style.fontSize = `${Math.max(11, fs - 1)}px`;
      }
    }

    function reject(msg: string): void {
      toast(msg, 'bad');
      replay(activeRow, 'is-shake');
      sfx.tap(0.5);
      haptic.fail();
    }

    // ── fx helpers (fx canvas = the whole .pz root) ──
    function centerOf(node: Element): { x: number; y: number } {
      const a = node.getBoundingClientRect();
      const b = fxRoot.getBoundingClientRect();
      return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
    }
    function busy(ms: number): void {
      fxBusyUntil = Math.max(fxBusyUntil, loop.timeMs + ms);
    }

    // ── actions ──
    function press(k: string): void {
      if (destroyed || phase !== 'play' || isPaused()) return;
      if (k === 'ENTER') {
        submit();
        return;
      }
      if (k === 'BACK') {
        if (typed.length === 0) return;
        typed = typed.slice(0, -1);
        renderActive();
        return;
      }
      const ch = REGULAR_OF[k] ?? k;
      if (ch.length === 1 && HEB.includes(ch) && typed.length < WORD_LEN) {
        typed += ch;
        renderActive(typed.length - 1);
      }
    }

    function submit(): void {
      const r = checkStep(ladder, typed, words);
      if (!r.ok) {
        reject(r.message);
        return;
      }
      const prev = current();
      words.push(r.word);
      typed = '';
      const row = wordRow(r.word, prev, r.solved ? 'is-win' : 'is-new');
      rowsEl.insertBefore(row, activeRow);
      wordRows.push(row);
      if (r.solved) {
        solved(row);
        return;
      }
      renderActive();
      renderHead();
      fitRows();
      snapshot();
      sfx.pop(1 + Math.min(steps(), 8) * 0.05);
      haptic.tap();
    }

    function solved(row: HTMLElement): void {
      const s = steps();
      const ms = Math.round(elapsedMs());
      const points = ladderScore(s, par, ms);
      score = Math.min(MAX_RAW, score + points);
      ctx.setScore(score);
      results = [...results, { start, par, steps: s, ms, points }];
      solveCount++;
      phase = 'celebrate';
      snapshotNext();
      renderHead();
      fitRows();
      const perfect = s <= par;
      const c = centerOf(row);
      const W = view.width;
      // the celebration replaces whatever was in the lane
      hideToast();
      hideDemo();
      // a star-burst sticker with the owner's words and the points, in the band under the solved row
      // (the goal row's free place and the lane), Shimi's head popping up on its right, the 💨 flying
      // off on its left; all of it is over before the next ladder slides in
      const near = s === par + 1;
      stickerWord.textContent = perfect ? (PERFECT_WORDS[(solveCount - 1) % PERFECT_WORDS.length] ?? 'וואו!') : near ? 'כמעט מושלם!' : 'פלוץ!';
      stickerPts.textContent = `+${points}`;
      stickerEl.classList.toggle('is-near', near);
      stickerEl.classList.toggle('is-plain', !perfect && !near);
      const lr = laneEl.getBoundingClientRect();
      const origin = fxRoot.getBoundingClientRect();
      // (12 px clear of the row: room for the sticker's pop-in overshoot)
      const band = lr.bottom - 8 - (row.getBoundingClientRect().bottom + 12);
      const stk = Math.round(clamp(band, STICKER_MIN, STICKER_MAX));
      const stkW = Math.round(Math.min(stk * 1.35, lr.width * 0.5));
      stickerEl.style.setProperty('--stk', `${stk}px`);
      stickerEl.style.setProperty('--stk-w', `${stkW}px`);
      replay(stickerEl, 'is-on');
      const cx = lr.left - origin.left + lr.width / 2;
      const stkBottom = lr.bottom - origin.top - 8;
      const r = Math.round(clamp(stk * 0.32, 18, 36));
      mascot = { x: Math.min(W - r - 4, cx + stkW / 2 + r * 0.25), y: stkBottom - r * 0.9, t: 0, r };
      const puff = clamp(stk * 0.85, 52, 96);
      puffs.push({ x: Math.max(puff * 0.6, cx - stkW / 2 - puff * 0.32), y: stkBottom - stk / 2, t: 0, size: puff });
      // stars off the solved row (gone in half a second)
      fx.burst(c.x, c.y, { count: 14, shape: 'star', colors: [FX.yel, FX.red, FX.white], speed: 300, life: 0.5 });
      if (perfect) fx.confetti({ count: 70, width: W, colors: [FX.yel, FX.red, FX.white, FX.pink, FX.org] });
      sfx.fart(solveCount % 4, 0.75 + ((solveCount * 37) % 9) * 0.09);
      if (perfect) sfx.success();
      haptic.success();
      busy(CELEBRATE_MS + 100);
      loop.after(CELEBRATE_MS, nextPuzzle);
    }

    function nextPuzzle(): void {
      if (destroyed) return;
      // nothing of the celebration (confetti included) is left over the next ladder
      hideCelebration();
      fx.clear();
      fxBusyUntil = 0;
      if (idx + 1 >= seq.length) {
        phase = 'done';
        fitRows();
        renderHead();
        ctx.finish();
        return;
      }
      setupPuzzle(idx + 1, null);
      snapshot(); // the ladder's start time is kept from its first moment
      replay(head, 'is-enter');
      replay(rowsEl, 'is-enter');
      sfx.whoosh(1.2);
    }

    function skipReady(): boolean {
      return phase === 'play' && loop.timeMs - puzzleT0 >= SKIP_AFTER_MS;
    }

    function disarmSkip(): void {
      skipArmed = false;
      cancelDisarm?.();
      cancelDisarm = null;
      skipBtn.classList.remove('is-armed');
      skipLabel.textContent = 'דלג';
    }

    function skip(): void {
      if (destroyed || isPaused() || !skipReady()) return;
      if (!skipArmed) {
        skipArmed = true;
        skipBtn.classList.add('is-armed');
        skipLabel.textContent = 'בטוח? שוב';
        cancelDisarm = loop.after(SKIP_ARM_MS, disarmSkip);
        sfx.tap(0.9);
        haptic.tap();
        return;
      }
      disarmSkip();
      // the original's give-up: reveal the shortest path, nothing scored
      results = [...results, { start, par, steps: null, ms: Math.round(elapsedMs()), points: 0 }];
      phase = 'reveal';
      snapshotNext();
      typed = '';
      renderHead();
      fitRows();
      const path = startPath(ladder, start);
      revealEl.replaceChildren(el('div', 'pz-reveal-title', 'המסלול הקצר ביותר'), el('div', 'pz-reveal-sub', `מ${disp(start)} אפשר להגיע ל־${TARGET_D} ב־${par === 1 ? 'צעד אחד' : `${par} צעדים`}`), chips(path));
      replay(revealEl, 'is-on');
      sfx.fart(1, 0.62);
      haptic.bump();
      loop.after(REVEAL_MS, nextPuzzle);
    }

    // ── first puzzle: a ghost demo of one step (the original's help: חלום → חלוץ) ──
    function showDemo(): void {
      const rows = el('div', 'pz-demo-rows');
      rows.append(wordRow('חלומ', undefined, 'is-d1'), el('span', 'pz-arrow is-d2', '←'), wordRow('חלוצ', 'חלומ', 'is-d2'));
      demoEl.replaceChildren(el('div', 'pz-demo-cap', 'משנים אות אחת בכל צעד'), rows, el('div', 'pz-demo-cap is-sub', `כל צעד מילה אמיתית, עד ${TARGET_D}`));
      replay(demoEl, 'is-on');
      cancelDemo = loop.after(DEMO_MS, () => {
        cancelDemo = null;
        demoEl.classList.remove('is-on');
      });
      positionDemo(true);
    }
    /**
     * The demo sits in the lane and the free space right above it, under the rows. With no room
     * at first it becomes a toast; once the player has made a step (or rows grew into it) it
     * simply goes away.
     */
    function positionDemo(first = false): void {
      if (!demoEl.classList.contains('is-on')) return;
      const free = board.clientHeight - rowsEl.offsetHeight - 8 + laneH - 4;
      if (words.length > 1 || phase !== 'play' || free < demoEl.offsetHeight + 6) {
        hideDemo();
        if (first) toast('משנים אות אחת בכל צעד, עד פלוץ', 'info', 3000);
      }
    }

    // ── input ──
    let downKey: HTMLElement | null = null;
    const onKbDown = (e: PointerEvent): void => {
      if (e.cancelable) e.preventDefault(); // no focus, no selection, no ghost click
      if (destroyed || isPaused()) return;
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>('.pz-key') : null;
      if (!target) return;
      downKey?.classList.remove('is-down');
      downKey = target;
      target.classList.add('is-down');
      if (phase === 'play') {
        sfx.key(1 + typed.length * 0.04);
        haptic.tap();
      }
      press(target.dataset.k ?? '');
    };
    const onUp = (): void => {
      downKey?.classList.remove('is-down');
      downKey = null;
    };
    /** The skip button is drawn 92x36 (32 on a short phone); it answers to the bar's whole height and a finger's width more: a 44+ px target. */
    const nearSkip = (e: PointerEvent): boolean => {
      const r = skipBtn.getBoundingClientRect();
      const bar = tools.getBoundingClientRect();
      return e.clientX >= r.left - 12 && e.clientX <= r.right + 12 && e.clientY >= bar.top && e.clientY <= bar.bottom;
    };
    const onToolDown = (e: PointerEvent): void => {
      if (e.cancelable) e.preventDefault();
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
      if (target?.dataset.act === 'skip' || nearSkip(e)) skip();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let k: string | null = null;
      if (e.key === 'Enter') k = 'ENTER';
      else if (e.key === 'Backspace') k = 'BACK';
      else if (/^[א-ת]$/.test(e.key)) k = e.key;
      else k = CODE_MAP[e.code] ?? null;
      if (k === null) return;
      e.preventDefault();
      press(k);
    };
    const onHide = (): void => {
      if (document.visibilityState === 'hidden' && phase === 'play') snapshot();
    };
    kb.addEventListener('pointerdown', onKbDown);
    tools.addEventListener('pointerdown', onToolDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
    ro?.observe(root);

    // ── loop: timers, skip meter, urgency, the fx canvas ──
    let drawnIdle = false;
    const loop = createLoop({
      update(dt: number): void {
        if (phase === 'play' && (shownWorth < 0 || loop.steps % 6 === 0)) {
          const w = worthNow();
          if (w !== shownWorth) {
            shownWorth = w;
            worthNum.textContent = String(w);
          }
        }
        if (phase === 'play') {
          const p = Math.min(100, Math.floor(((loop.timeMs - puzzleT0) / SKIP_AFTER_MS) * 100));
          if (p !== shownSkipP) {
            shownSkipP = p;
            skipBtn.style.setProperty('--p', String(p / 100));
            const ready = p >= 100;
            skipBtn.classList.toggle('is-ready', ready);
            skipBtn.toggleAttribute('disabled', !ready);
          }
        } else if (shownSkipP !== -2) {
          shownSkipP = -2;
          skipBtn.toggleAttribute('disabled', true);
          skipBtn.classList.remove('is-ready');
          skipBtn.style.setProperty('--p', '0');
        }
        if (!hurry && loop.steps > 60) {
          const left = ctx.timeLeftMs();
          if (left > 0 && left <= HURRY_MS) {
            hurry = true;
            root.classList.add('is-hurry');
            // never over a "why was my word rejected" toast: the blinking start chip and the beep say it too
            const rejecting = toastEl.classList.contains('is-on') && toastEl.dataset.kind === 'bad';
            if (!rejecting) toast('10 שניות אחרונות!', 'hurry');
            sfx.beep();
          }
        }
        for (let i = puffs.length - 1; i >= 0; i--) {
          const p = puffs[i];
          if (!p) continue;
          p.t += dt;
          if (p.t >= PUFF_S) puffs.splice(i, 1);
        }
        if (mascot) {
          mascot.t += dt;
          if (mascot.t >= MASCOT_S) mascot = null;
        }
        fx.update(dt);
      },
      render(): void {
        if (loop.timeMs > fxBusyUntil && puffs.length === 0 && mascot === null) {
          if (!drawnIdle) view.clear();
          drawnIdle = true;
          return;
        }
        drawnIdle = false;
        const g = view.ctx;
        view.clear();
        for (const p of puffs) {
          // the original's puff: pops in, then drifts off to the left and grows a little as it fades (inside the band)
          const k = p.t / PUFF_S;
          const inK = clamp(k / 0.22, 0, 1);
          const out = clamp((k - 0.3) / 0.7, 0, 1);
          const s = p.size * (0.4 + 0.6 * ease.outBack(inK) + 0.2 * out);
          g.globalAlpha = k < 0.22 ? inK : 1 - ease.inQuad(out);
          art.puff.draw(g, p.x - p.size * 0.35 * ease.outQuad(out), p.y - p.size * 0.08 * ease.outQuad(out), s, s);
        }
        g.globalAlpha = 1;
        if (mascot) drawMascot(g, mascot);
        fx.draw(g);
      },
    });

    function drawMascot(g: CanvasRenderingContext2D, m: { x: number; y: number; t: number; r: number }): void {
      const inK = clamp(m.t / 0.26, 0, 1);
      const outK = clamp((m.t - (MASCOT_S - 0.2)) / 0.2, 0, 1);
      const s = ease.outBack(inK) * (1 - outK);
      if (s <= 0.01) return;
      const r = m.r;
      g.save();
      g.translate(m.x, m.y);
      g.scale(s, s);
      g.rotate(Math.sin(m.t * 9) * 0.08);
      art.mascot.draw(g, 0, 0, r * 2, r * 2);
      g.restore();
    }

    // ── boot: restore a reload, else the first ladder (+ the demo) ──
    const snap = loadSnapshot(ctx.seed);
    loop.start();
    if (snap && snap.idx >= 0 && snap.idx < seq.length) {
      score = clamp(Math.round(snap.score), 0, MAX_RAW);
      results = [...snap.results];
      solveCount = results.filter((r) => r.steps !== null).length;
      setupPuzzle(snap.idx, snap.words[0] === seq[snap.idx] ? snap : null);
      ctx.setScore(score);
    } else if (snap && snap.idx >= seq.length) {
      score = clamp(Math.round(snap.score), 0, MAX_RAW);
      results = [...snap.results];
      ctx.setScore(score);
      setupPuzzle(seq.length - 1, null);
      phase = 'done';
      fitRows();
      ctx.finish();
    } else {
      setupPuzzle(0, null);
    }
    layout();
    if (idx === 0 && words.length === 1 && phase === 'play') showDemo();

    // ── test hook ──
    const debug: PlotzelDebug = Object.freeze({
      get start(): string {
        return disp(start);
      },
      target: TARGET_D,
      get par(): number {
        return par;
      },
      get words(): readonly string[] {
        return words.map(disp);
      },
      get puzzleIndex(): number {
        return idx;
      },
      get solved(): number {
        return solveCount;
      },
      get score(): number {
        return score;
      },
      get phase(): Phase {
        return phase;
      },
      get typed(): string {
        return disp(typed);
      },
      get skipReady(): boolean {
        return skipReady();
      },
      get elapsedMs(): number {
        return Math.round(elapsedMs());
      },
      get worth(): number {
        return worthNow();
      },
      get results(): readonly PuzzleResult[] {
        return results.map((r) => ({ ...r }));
      },
      buildMs: ladderBuildMs(),
      path: (): string[] => startPath(ladder, current()).map(disp),
      sequence: (n: number): string[] => seq.slice(0, Math.max(0, Math.floor(n))).map(disp),
    });
    window.__plotzel = debug;

    return {
      setPaused(paused: boolean): void {
        root.classList.toggle('is-paused', paused);
        onUp();
      },
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        if (phase === 'play') snapshot();
        loop.stop();
        ro?.disconnect();
        kb.removeEventListener('pointerdown', onKbDown);
        tools.removeEventListener('pointerdown', onToolDown);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('pagehide', onHide);
        fx.clear();
        view.dispose();
        root.remove();
        if (window.__plotzel === debug) delete window.__plotzel;
      },
    };
  },
};
