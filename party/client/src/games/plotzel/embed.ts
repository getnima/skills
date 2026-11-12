/**
 * Embed Plotzel: the owner's live site in an iframe below the HUD.
 *
 * Score sources, in order:
 *   1. the postMessage bridge (bridge.ts): progress / solved / failed from the
 *      iframe's own origin;
 *   2. our self-report bar under the iframe ("פתרתם? בכמה ניסיונות?"): tap a
 *      number, tap it again to confirm; a correction is open for
 *      SELF_REPORT_CORRECT_MS after each report (round time), then the player is
 *      finished so the round can end early. Shown until the first bridge
 *      message arrives, then hidden for good.
 *
 * Safety net: until the site shows a sign of life (a bridge message) the bar
 * carries a one-tap "לא נטען? לשחק כאן" link to the builtin game, from the
 * first second. A page blocked by X-Frame-Options / CSP, or the browser's own
 * error page, cannot be told apart from the real site, so the player decides.
 * No load event within 6 s shows a notice that offers the same switch. The
 * switch is remembered for the round (memory.ts) and is gone once the player
 * self-reported, so nobody scores twice.
 *
 * The iframe is sandboxed: the site keeps scripts, storage and forms, but
 * cannot navigate our page, open popups / new tabs, or block the phone with
 * alert() / confirm().
 * While the round is frozen an opaque cover hides the iframe.
 */
import './plotzel.css';

import { sfx } from '../../kit/audio';
import { haptic } from '../../kit/haptics';
import { createLoop } from '../../kit/loop';
import { parseBridgeMessage } from './bridge';
import { createBuiltin } from './builtin';
import { buildEmbedSrc } from './config';
import { FAIL_MIN, MAX_TRIES, partialScore, PARTIAL_MAX, selfReportScore, solvedScore } from './logic';
import { memoryAge, recallRound, rememberRound } from './memory';

import type { GameContext, GameInstance } from '../types';
import type { BridgeMessage } from './bridge';
import type { PlotzelConfig } from './config';
import type { ReportChoice } from './memory';

/** No load (or bridge) signal for this long = show the "slow / play here" notice. */
export const EMBED_LOAD_TIMEOUT_MS = 6_000;
/** No sign of life (bridge) and no touch inside the frame for this long = the switch link starts to pulse. */
export const EMBED_NUDGE_MS = 10_000;
const FINISH_DELAY_MS = 1_400;
/**
 * After a confirmed self-report the bar stays open this long (round time, a
 * freeze stops it; every correction restarts it) for a correction, then the
 * player is finished, so the round can still end early when everyone is done.
 */
export const SELF_REPORT_CORRECT_MS = 8_000;
/** The viewport shrank below this share of its tallest height while the frame has focus = an on-screen keyboard is up. */
const KEYBOARD_RATIO = 0.8;
/** sandbox: no allow-top-navigation, no allow-popups, no allow-modals (an alert() would freeze the phone's round). */
export const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-forms';

const LABEL_IDLE = 'פתרתם? בכמה ניסיונות?';

type EmbedState = 'loading' | 'ready' | 'bridge' | 'slow' | 'failed' | 'done' | 'builtin';

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, act: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.dataset.act = act;
  return b;
}

function cover(className: string, emoji: string, title: string, sub?: string): { root: HTMLElement; title: HTMLElement; sub: HTMLElement } {
  const root = el('div', `pze-cover ${className}`);
  const t = el('div', 'pze-cover-title', title);
  const s = el('div', 'pze-cover-sub', sub ?? '');
  root.append(el('div', 'pze-cover-emoji', emoji), t, s);
  return { root, title: t, sub: s };
}

function triesText(which: ReportChoice): string {
  if (which === 'fail') return 'לא הצלחתי';
  return which === 1 ? 'ניסיון אחד' : `${which} ניסיונות`;
}

export async function createEmbed(ctx: GameContext, cfg: PlotzelConfig): Promise<GameInstance> {
  const memAge = memoryAge(ctx.durationMs);
  const memory = recallRound(ctx.seed, memAge);
  // The player already switched to the builtin game this round (reload / remount): stay there.
  if (memory.builtin === true) return createBuiltin(ctx);

  const src = buildEmbedSrc(cfg.embedUrl, ctx.seed);
  const embedOrigin = new URL(src).origin;

  // ── DOM ──
  const wrap = el('div', 'pze');
  wrap.dataset.plotzel = 'embed';
  wrap.style.setProperty('--pz-top', `${ctx.hudHeight + 6}px`);
  wrap.style.setProperty('--pz-bottom', `${ctx.safeBottom}px`);

  const box = el('div', 'pze-frame-box');
  const frame = document.createElement('iframe');
  frame.className = 'pze-frame';
  frame.title = 'פלוצל';
  frame.setAttribute('allow', "autoplay; fullscreen 'none'");
  frame.setAttribute('sandbox', EMBED_SANDBOX);
  frame.referrerPolicy = 'strict-origin-when-cross-origin';

  const loadingCover = cover('pze-loading', '💨', 'טוען את פלוצל…');
  loadingCover.root.append(el('div', 'pze-spinner'));
  const failedCover = cover('pze-failed', '😬', '', '');
  const toBuiltinBtn = button('pze-btn', 'לשחק כאן ▶', 'builtin');
  const secondBtn = button('pze-btn is-ghost', '', 'second');
  failedCover.root.append(toBuiltinBtn, secondBtn);
  const freezeCover = cover('pze-freeze', '📺', 'מסתכלים על הטלוויזיה!');
  box.append(frame, loadingCover.root, failedCover.root, freezeCover.root);

  // self-report bar
  const bar = el('div', 'pze-bar');
  const barTop = el('div', 'pze-bar-top');
  const label = el('div', 'pze-bar-label', LABEL_IDLE);
  const switchLink = button('pze-link', 'לא נטען? לשחק כאן ▶', 'switch');
  barTop.append(label, switchLink);
  const barRow = el('div', 'pze-bar-row');
  const numBtns: HTMLButtonElement[] = [];
  for (let n = 1; n <= MAX_TRIES; n++) {
    const b = button('pze-n', String(n), `tries-${n}`);
    numBtns.push(b);
    barRow.append(b);
  }
  const failBtn = button('pze-n is-fail', 'לא הצלחתי', 'fail');
  barRow.append(failBtn);
  bar.append(barTop, barRow);

  wrap.append(box, bar);
  ctx.root.appendChild(wrap);

  // ── state ──
  let state: EmbedState = 'loading';
  let loaded = false;
  let bridgeSeen = false;
  let touched = false; // the player tapped inside the frame at least once
  let best = 0;
  let armed: ReportChoice | null = null;
  /** Round time left at the first tap of the report being made (the solve moment). */
  let armedLeftMs = 0;
  let report: { which: ReportChoice; score: number; leftMs: number } | null = null;
  let destroyed = false;
  let paused = ctx.isPaused();
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  let builtin: GameInstance | null = null;
  let keyboardUp = false;
  let tallest = 0;

  // game-time timers (the finish delay and the nudge stand still during a freeze)
  /** Ms left of the correction window after a self-report; 0 = no window running. */
  let correctLeftMs = 0;
  let shownCorrectSecs = -1;
  const loop = createLoop({
    update(dt: number): void {
      // an armed correction holds the window open until it is confirmed or dropped
      if (correctLeftMs <= 0 || armed !== null || state === 'done') return;
      correctLeftMs -= dt * 1000;
      if (correctLeftMs <= 0) {
        correctLeftMs = 0;
        finishReported();
        return;
      }
      if (Math.ceil(correctLeftMs / 1000) !== shownCorrectSecs) paintBar();
    },
  });
  loop.start();

  function setState(next: EmbedState): void {
    state = next;
    wrap.dataset.state = next;
  }
  setState('loading');

  function showCover(which: 'loading' | 'failed' | null): void {
    loadingCover.root.classList.toggle('is-on', which === 'loading');
    failedCover.root.classList.toggle('is-on', which === 'failed');
  }

  function applyPaused(): void {
    freezeCover.root.classList.toggle('is-on', paused);
    wrap.classList.toggle('is-paused', paused);
  }
  applyPaused();

  /** The switch link exists only while the site gave no sign of life and nothing was reported. */
  function paintSwitch(): void {
    const can = !bridgeSeen && report === null && state !== 'done' && state !== 'builtin';
    switchLink.hidden = !can;
    toBuiltinBtn.hidden = !can;
  }

  function paintBar(): void {
    for (const [i, b] of numBtns.entries()) {
      b.classList.toggle('is-armed', armed === i + 1);
      b.classList.toggle('is-chosen', report?.which === i + 1);
    }
    failBtn.classList.toggle('is-armed', armed === 'fail');
    failBtn.classList.toggle('is-chosen', report?.which === 'fail');
    label.classList.toggle('is-armed', armed !== null);
    label.classList.toggle('is-chosen', armed === null && report !== null);
    if (armed !== null) {
      label.textContent = armed === 'fail' ? 'לאישור הקישו שוב על "לא הצלחתי"' : `לאישור הקישו שוב על ${armed}`;
    } else if (report !== null) {
      shownCorrectSecs = Math.ceil(correctLeftMs / 1000);
      label.textContent =
        state === 'done' ? `✓ נרשם: ${triesText(report.which)}` : `✓ נרשם: ${triesText(report.which)} · טעות? אפשר לתקן (${shownCorrectSecs})`;
    } else {
      label.textContent = LABEL_IDLE;
    }
    paintSwitch();
  }

  function clearLoadTimer(): void {
    if (loadTimer !== null) clearTimeout(loadTimer);
    loadTimer = null;
  }

  function markLoaded(): void {
    if (loaded) return;
    loaded = true;
    clearLoadTimer();
    // a late load after the "slow" notice: the site is there after all
    if (state === 'loading' || state === 'slow') {
      setState(bridgeSeen ? 'bridge' : 'ready');
      showCover(null);
    }
  }

  function showFailed(kind: 'slow' | 'failed'): void {
    if (destroyed || bridgeSeen || state === 'done' || state === 'builtin') return;
    clearLoadTimer();
    disarm();
    setState(kind);
    if (kind === 'slow') {
      failedCover.title.textContent = 'פלוצל נטען לאט…';
      failedCover.sub.textContent = 'אפשר לשחק בגרסה שלנו – אותם חוקים, והניקוד נספר.';
      secondBtn.textContent = 'להמשיך לחכות';
      secondBtn.dataset.act = 'wait';
    } else {
      failedCover.title.textContent = 'פלוצל לא נטען';
      failedCover.sub.textContent = 'אין חיבור לאתר של פלוצל. אפשר לשחק בגרסה שלנו – והניקוד נספר.';
      secondBtn.textContent = 'לנסות שוב';
      secondBtn.dataset.act = 'retry';
    }
    showCover('failed');
    paintSwitch();
    sfx.fail();
  }

  function startLoad(): void {
    loaded = false;
    setState('loading');
    showCover('loading');
    clearLoadTimer();
    loadTimer = setTimeout(() => {
      loadTimer = null;
      if (!loaded) showFailed('slow');
    }, EMBED_LOAD_TIMEOUT_MS);
    frame.src = src;
    // An unreachable site still fires `load` (with the browser's error page),
    // so ask the network directly too: a rejected no-cors fetch = no site.
    if (typeof fetch === 'function') {
      fetch(src, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' }).catch(() => {
        if (!bridgeSeen && !destroyed) showFailed('failed');
      });
    }
  }

  /** The correction window ran out: the self-report is final. */
  function finishReported(): void {
    if (destroyed || report === null || state === 'done' || state === 'builtin') return;
    setState('done');
    armed = null;
    bar.classList.add('is-done');
    paintBar();
    ctx.finish();
  }

  function finishSoon(): void {
    setState('done');
    disarm();
    paintSwitch();
    loop.after(FINISH_DELAY_MS, () => ctx.finish());
  }

  // ── bridge ──
  function onBridge(m: BridgeMessage): void {
    if (!bridgeSeen) {
      bridgeSeen = true;
      bar.classList.add('is-hidden');
      wrap.classList.remove('is-nudge');
      markLoaded();
      if (state === 'failed' || state === 'slow' || state === 'ready' || state === 'loading') {
        setState('bridge');
        showCover(null);
      }
      // the site reports for itself now: a self-report made before it no longer counts
      if (report !== null) {
        report = null;
        correctLeftMs = 0;
        best = 0;
        ctx.setScore(0);
        rememberRound(ctx.seed, memAge, { report: null });
      }
      paintSwitch();
    }
    if (state === 'done') return;
    const hasColours = m.greens !== null || m.yellows !== null;
    const partial = hasColours ? partialScore(m.greens ?? 0, m.yellows ?? 0) : m.score !== null ? Math.min(PARTIAL_MAX, m.score) : 0;
    if (m.type === 'progress') {
      best = Math.max(best, partial);
      ctx.setScore(best);
      return;
    }
    if (m.type === 'solved') {
      // tries win over a site-made score, so a bridge solve is worth what a builtin solve is
      const raw = m.tries !== null ? solvedScore(m.tries, ctx.timeLeftMs(), ctx.durationMs) : (m.score ?? 0);
      ctx.setScore(raw);
      sfx.fanfare();
      haptic.success();
      finishSoon();
      return;
    }
    // failed: the best row's colours, at least FAIL_MIN
    best = Math.max(best, partial);
    ctx.setScore(Math.max(FAIL_MIN, best));
    sfx.fart(1, 0.7);
    finishSoon();
  }

  const onMessage = (e: MessageEvent): void => {
    if (destroyed || builtin !== null) return;
    if (e.source !== frame.contentWindow || e.origin !== embedOrigin) return;
    const m = parseBridgeMessage(e.data);
    if (m) onBridge(m);
  };
  window.addEventListener('message', onMessage);

  // ── self-report bar ──
  function disarm(): void {
    armed = null;
    paintBar();
  }

  function arm(which: ReportChoice): void {
    armed = which;
    // the solve moment is the first tap (a correction keeps the moment of the first solve report)
    armedLeftMs = report !== null && report.which !== 'fail' ? armedLeftMs : ctx.timeLeftMs();
    paintBar();
    sfx.tap(1.2);
    haptic.tap();
  }

  function selfReport(which: ReportChoice): void {
    if (destroyed || paused || bridgeSeen || state === 'done' || state === 'builtin') return;
    if (armed !== which) {
      if (report !== null && report.which === which) return; // already the reported choice
      arm(which);
      return;
    }
    armed = null;
    const score = selfReportScore(which, armedLeftMs, ctx.durationMs);
    const first = report === null;
    report = { which, score, leftMs: armedLeftMs };
    ctx.setScore(score);
    rememberRound(ctx.seed, memAge, { report });
    if (which === 'fail') sfx.fart(1, 0.75);
    else {
      sfx.fanfare();
      haptic.success();
    }
    if (first) wrap.classList.remove('is-nudge');
    correctLeftMs = SELF_REPORT_CORRECT_MS;
    paintBar();
  }

  numBtns.forEach((b, i) => b.addEventListener('click', () => selfReport(i + 1)));
  failBtn.addEventListener('click', () => selfReport('fail'));
  secondBtn.addEventListener('click', () => {
    if (paused) return;
    if (secondBtn.dataset.act === 'retry') {
      startLoad();
      return;
    }
    // "keep waiting": show whatever the frame has (a page whose load event hangs on a slow script may be playable)
    if (state === 'slow') {
      setState('ready');
      showCover(null);
    }
  });

  // ── switch to the builtin game (rest of this round, this player only) ──
  async function switchToBuiltin(): Promise<void> {
    if (destroyed || bridgeSeen || report !== null || state === 'builtin' || state === 'done') return;
    setState('builtin');
    clearLoadTimer();
    rememberRound(ctx.seed, memAge, { builtin: true });
    window.removeEventListener('message', onMessage);
    frame.src = 'about:blank';
    wrap.remove();
    const inst = await createBuiltin(ctx);
    if (destroyed) {
      inst.destroy();
      return;
    }
    builtin = inst;
    builtin.setPaused?.(paused);
  }
  toBuiltinBtn.addEventListener('click', () => void switchToBuiltin());
  switchLink.addEventListener('click', () => void switchToBuiltin());

  frame.addEventListener('load', () => {
    if (destroyed || state === 'builtin') return;
    if (frame.src === '' || frame.src === 'about:blank') return;
    markLoaded();
  });

  // ── signs of the player: a tap into the frame moves focus to it ──
  function checkFocus(): void {
    if (destroyed) return;
    if (document.activeElement === frame) {
      touched = true;
      wrap.classList.remove('is-nudge');
    }
    checkKeyboard();
  }
  const onBlur = (): void => {
    // activeElement is updated after the blur event
    setTimeout(checkFocus, 0);
  };
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', checkFocus);

  // ── on-screen keyboard over the site (native input inside the frame) ──
  // The bar would squeeze the game into a sliver above the keyboard: hide it while typing.
  function viewportHeight(): number {
    const vv = window.visualViewport;
    return Math.min(window.innerHeight, vv ? vv.height : window.innerHeight);
  }
  let lastWidth = window.innerWidth;
  function checkKeyboard(): void {
    if (destroyed) return;
    const h = viewportHeight();
    if (window.innerWidth !== lastWidth) {
      // rotated: the tallest height of the old orientation means nothing now
      lastWidth = window.innerWidth;
      tallest = h;
    }
    const focused = document.activeElement === frame;
    if (!focused || !keyboardUp) tallest = Math.max(tallest, h);
    const up = focused && h < tallest * KEYBOARD_RATIO;
    if (up !== keyboardUp) {
      keyboardUp = up;
      wrap.classList.toggle('is-kb', up);
    }
  }
  tallest = viewportHeight();
  const vv = window.visualViewport;
  vv?.addEventListener('resize', checkKeyboard);
  window.addEventListener('resize', checkKeyboard);

  // the nudge: the switch link pulses when the frame shows no sign of life for a while
  loop.after(EMBED_NUDGE_MS, () => {
    if (!bridgeSeen && !touched && report === null && state !== 'builtin' && state !== 'done') wrap.classList.add('is-nudge');
  });

  // a self-report from before a reload / remount
  if (memory.report !== undefined && memory.report !== null) {
    report = { ...memory.report };
    armedLeftMs = report.leftMs;
    correctLeftMs = SELF_REPORT_CORRECT_MS;
    ctx.setScore(report.score);
  }
  paintBar();
  startLoad();

  return {
    setPaused(next: boolean): void {
      paused = next;
      applyPaused();
      if (next) disarm();
      builtin?.setPaused?.(next);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      clearLoadTimer();
      loop.stop();
      window.removeEventListener('message', onMessage);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', checkFocus);
      vv?.removeEventListener('resize', checkKeyboard);
      window.removeEventListener('resize', checkKeyboard);
      builtin?.destroy();
      builtin = null;
      wrap.remove();
    },
  };
}
