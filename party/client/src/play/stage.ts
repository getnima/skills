/**
 * The stage: HUD (live place + chase line, score, time left) and the lifecycle of one mini game.
 * See StageOptions / Stage in games/types.ts for the contract. The live place is fed by the shell
 * through PlayStage.setStanding (the games never see it).
 */
import '../kit/base.css';
import './stage.css';

import { SCORE_SEND_INTERVAL_MS } from '../../../shared/protocol';
import { loadGame } from '../games/registry';
import { sfx } from '../kit/audio';
import { haptic } from '../kit/haptics';
import { setKitErrorHandler, setKitPaused } from '../kit/loop';
import { getSafeArea, initMobileViewport, keepAwake } from '../kit/mobile';
import { createPlaceHud } from './hud-place';

import type { GameContext, GameInstance, GameModule, Stage, StageOptions } from '../games/types';
import type { PlaceShown } from './hud-place';
import type { LiveStanding } from './standing';

/**
 * Height of the HUD block in CSS px, without the safe-area inset: the chip row (37) + the chase
 * line (17) + padding. Must equal `.pa-hud`'s height in stage.css (tests/e2e/qa-hud.cjs checks it).
 */
export const HUD_ROW_PX = 66;

/** The stage as the phone shell sees it: the game contract's Stage + the live place. */
export interface PlayStage extends Stage {
  /** Latest live standing of this player in this round (null: not ranked in it). */
  setStanding(standing: LiveStanding | null): void;
  /** What the place chip / chase line show right now. */
  placeShown(): PlaceShown;
  /** ctx.hudHeight as given to the game (HUD block + safe-area top). */
  readonly hudHeight: number;
}

/** Shell-only extras (not part of the game contract). */
export interface StageExtras {
  /** Called whenever the HUD painted a new place / chase line (test hooks). */
  onPlaceShown?(shown: PlaceShown): void;
}
const URGENT_MS = 5_000;

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function overlay(emoji: string, title: string): { root: HTMLElement; score: HTMLElement; sub: HTMLElement } {
  const root = el('div', 'pa-overlay');
  const score = el('div', 'pa-overlay-score');
  const sub = el('div', 'pa-overlay-sub');
  root.append(el('div', 'pa-overlay-emoji', emoji), el('div', 'pa-overlay-title', title), score, sub);
  return { root, score, sub };
}

/** A game chunk that failed to download (a Wi-Fi blip at round start) is tried again before giving up. */
async function loadWithRetry(load: () => Promise<GameModule>, gaveUp: () => boolean): Promise<GameModule> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await load();
    } catch (err) {
      lastErr = err;
      if (gaveUp()) break;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Mount the stage and the game `opts.gameId` (loaded through the registry). */
export function mountStage(opts: StageOptions, extras: StageExtras = {}): Promise<PlayStage> {
  return mountStageWith(opts, () => loadGame(opts.gameId), extras);
}

/** Same as mountStage, with the game module supplied by the caller (dev harness, tests). */
export async function mountStageWith(
  opts: StageOptions,
  load: () => Promise<GameModule>,
  extras: StageExtras = {},
): Promise<PlayStage> {
  initMobileViewport();
  void keepAwake();

  // ── DOM ──
  const root = el('div', 'pa-stage');
  const gameRoot = el('div', 'pa-stage-game');
  const veil = el('div', 'pa-veil');
  const hud = el('div', 'pa-hud');
  const scoreBox = el('div', 'pa-hud-score');
  const scoreNum = el('span', 'pa-hud-num', '0');
  scoreBox.append(el('span', 'pa-hud-star', '★'), scoreNum);
  const bar = el('div', 'pa-hud-bar');
  const fill = el('div', 'pa-hud-fill');
  bar.append(fill);
  const secs = el('div', 'pa-hud-secs', '');
  const place = createPlaceHud(extras.onPlaceShown);
  const row = el('div', 'pa-hud-row');
  row.append(place.chip, scoreBox, bar, secs);
  hud.append(row, place.line);
  const wait = overlay('🎉', 'סיימת!');
  wait.sub.innerHTML = 'ממתינים לשאר<span class="pa-dots"><span>.</span><span>.</span><span>.</span></span>';
  const crash = overlay('🙈', 'אופס, המשחק נתקע');
  crash.sub.textContent = 'הניקוד שלך נשמר. ממשיכים בסיבוב הבא!';
  root.append(gameRoot, veil, hud, wait.root, crash.root);
  opts.parent.appendChild(root);

  const safe = getSafeArea();
  const durationMs = Math.max(1, opts.durationMs);

  // ── state ──
  let score = 0;
  let sentScore = 0;
  let lastSentAt = 0;
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let frozen = false;
  let over = false; // ended or destroyed: nothing runs any more
  let gameAlive = false;
  let finished = false;
  let instance: GameInstance | null = null;
  let raf = 0;
  let backup: ReturnType<typeof setInterval> | null = null;
  let shownSecs = -1;
  let shownScore = -1;
  let shownFill = -1;

  // ── score reporting (throttled, the last value always goes out) ──
  function sendScore(): void {
    if (sendTimer !== null) {
      clearTimeout(sendTimer);
      sendTimer = null;
    }
    if (score === sentScore) return;
    sentScore = score;
    lastSentAt = performance.now();
    try {
      opts.onScore(score);
    } catch (err) {
      console.error('[stage] onScore failed', err);
    }
  }

  function queueScore(): void {
    if (over || sendTimer !== null) return;
    const wait = SCORE_SEND_INTERVAL_MS - (performance.now() - lastSentAt);
    if (wait <= 0) sendScore();
    else sendTimer = setTimeout(sendScore, wait);
  }

  function showScore(): void {
    if (score === shownScore) return;
    const grew = score > shownScore && shownScore >= 0;
    shownScore = score;
    scoreNum.textContent = score.toLocaleString('en-US');
    if (grew && typeof scoreBox.animate === 'function') {
      scoreBox.animate([{ transform: 'scale(1.3) rotate(-4deg)' }, { transform: 'scale(1) rotate(0)' }], {
        duration: 220,
        easing: 'cubic-bezier(.2,1.6,.4,1)',
      });
    }
  }

  function setScore(value: number): void {
    if (over || !Number.isFinite(value)) return;
    const next = Math.max(0, Math.round(value));
    if (next === score) return;
    score = next;
    showScore();
    queueScore();
  }

  // ── game lifecycle ──
  function killGame(): void {
    gameAlive = false;
    const inst = instance;
    instance = null;
    if (inst) {
      try {
        inst.destroy();
      } catch (err) {
        console.error('[stage] game destroy failed', err);
      }
    }
    gameRoot.replaceChildren();
  }

  function onGameError(err: unknown): void {
    if (over || crash.root.classList.contains('is-on')) return;
    console.error('[stage] game crashed', err);
    killGame();
    wait.root.classList.remove('is-on');
    crash.score.textContent = `⭐ ${score.toLocaleString('en-US')}`;
    crash.root.classList.add('is-on');
  }

  function setFrozen(next: boolean): void {
    if (next === frozen) return;
    frozen = next;
    root.classList.toggle('is-frozen', next);
    place.setHeld(next); // a cutscene keeps the place as it was
    setKitPaused(next);
    if (gameAlive && instance?.setPaused) {
      try {
        instance.setPaused(next);
      } catch (err) {
        onGameError(err);
      }
    }
    shownSecs = -1; // repaint the seconds box
  }

  function paintClock(leftMs: number): void {
    const frac = Math.min(1, Math.max(0, leftMs / durationMs));
    const fillStep = Math.round(frac * 500);
    if (fillStep !== shownFill) {
      shownFill = fillStep;
      fill.style.transform = `scaleX(${fillStep / 500})`;
    }
    const s = Math.ceil(leftMs / 1000);
    const urgent = leftMs <= URGENT_MS && leftMs > 0;
    if (s !== shownSecs) {
      const first = shownSecs === -1;
      shownSecs = s;
      secs.textContent = frozen ? '⏸' : String(s);
      root.classList.toggle('is-urgent', urgent);
      if (urgent && !frozen && !first) {
        sfx.tick(s <= 1 ? 1.5 : 1);
        haptic.tap();
      }
    }
  }

  function stopTicking(): void {
    cancelAnimationFrame(raf);
    if (backup !== null) clearInterval(backup);
    backup = null;
    place.destroy();
    if (sendTimer !== null) clearTimeout(sendTimer);
    sendTimer = null;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', sendScore);
  }

  function end(): void {
    if (over) return;
    killGame();
    sendScore();
    over = true;
    stopTicking();
    setKitErrorHandler(null);
    setKitPaused(false);
    root.classList.remove('is-urgent', 'is-frozen');
    wait.root.classList.remove('is-on');
    secs.textContent = '0';
    fill.style.transform = 'scaleX(0)';
    try {
      opts.onEnd(score);
    } catch (err) {
      console.error('[stage] onEnd failed', err);
    }
  }

  function tick(): void {
    if (over) return;
    let sample;
    try {
      sample = opts.clock();
    } catch (err) {
      console.error('[stage] clock failed', err);
      return;
    }
    setFrozen(sample.frozen);
    paintClock(sample.leftMs);
    if (!sample.frozen && sample.leftMs <= 0) end();
  }

  /** Hiding (lock, app switch, notification) flushes the score now: the page may never wake up in time. */
  function onVisibility(): void {
    if (document.visibilityState === 'hidden' && !over) sendScore();
    tick();
  }

  function frame(): void {
    if (over) return;
    raf = requestAnimationFrame(frame);
    tick();
  }

  const ctx: GameContext = {
    root: gameRoot,
    seed: opts.seed,
    durationMs: opts.durationMs,
    timeLeftMs: (): number => {
      if (over) return 0;
      try {
        return Math.max(0, opts.clock().leftMs);
      } catch {
        return 0;
      }
    },
    isPaused: (): boolean => frozen,
    hudHeight: HUD_ROW_PX + safe.top,
    safeBottom: safe.bottom,
    setScore,
    finish(): void {
      if (over || finished || !gameAlive) return;
      finished = true;
      sendScore();
      wait.score.textContent = `⭐ ${score.toLocaleString('en-US')}`;
      wait.root.classList.add('is-on');
      try {
        opts.onFinish?.(score);
      } catch (err) {
        console.error('[stage] onFinish failed', err);
      }
    },
  };

  // ── boot ──
  showScore();
  setKitPaused(false);
  setKitErrorHandler(onGameError);
  try {
    const first = opts.clock();
    paintClock(first.leftMs);
  } catch {
    // the tick loop reports it
  }

  try {
    const mod = await loadWithRetry(load, () => over);
    gameAlive = true;
    instance = await mod.create(ctx);
  } catch (err) {
    onGameError(err);
  }

  const stage: PlayStage = {
    getScore: (): number => score,
    setStanding(standing: LiveStanding | null): void {
      if (!over) place.set(standing);
    },
    placeShown: (): PlaceShown => place.shown(),
    hudHeight: ctx.hudHeight,
    destroy(): void {
      if (root.isConnected) root.remove();
      if (over) return;
      over = true;
      stopTicking();
      killGame();
      setKitErrorHandler(null);
      setKitPaused(false);
    },
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', sendScore);
  backup = setInterval(tick, 250);
  raf = requestAnimationFrame(frame);
  tick();
  return stage;
}
