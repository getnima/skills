/**
 * Embed Plotzel: the owner's live site in an iframe below the HUD.
 *
 * Score sources, in order:
 *   1. the postMessage bridge (bridge.ts): progress / solved / failed from the
 *      iframe's own origin;
 *   2. our self-report bar under the iframe ("פתרתי! בכמה ניסיונות?"), shown
 *      until the first bridge message arrives, then hidden for good.
 * If the iframe does not load within 6 s (or the site is unreachable) a notice
 * offers to switch this player to the builtin game for the rest of the round.
 * While the round is frozen an opaque cover hides the iframe.
 */
import './plotzel.css';

import { sfx } from '../../kit/audio';
import { haptic } from '../../kit/haptics';
import { createLoop } from '../../kit/loop';
import { parseBridgeMessage } from './bridge';
import { createBuiltin } from './builtin';
import { buildEmbedSrc } from './config';
import { MAX_TRIES, partialScore, PARTIAL_MAX, solvedScore } from './logic';

import type { GameContext, GameInstance } from '../types';
import type { BridgeMessage } from './bridge';
import type { PlotzelConfig } from './config';

/** No load (or bridge) signal for this long = show the "switch to builtin" notice. */
export const EMBED_LOAD_TIMEOUT_MS = 6_000;
const FINISH_DELAY_MS = 1_400;

type EmbedState = 'loading' | 'ready' | 'bridge' | 'failed' | 'done' | 'builtin';

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

function cover(className: string, emoji: string, title: string, sub?: string): HTMLElement {
  const c = el('div', `pze-cover ${className}`);
  c.append(el('div', 'pze-cover-emoji', emoji), el('div', 'pze-cover-title', title));
  if (sub !== undefined) c.append(el('div', 'pze-cover-sub', sub));
  return c;
}

export async function createEmbed(ctx: GameContext, cfg: PlotzelConfig): Promise<GameInstance> {
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
  // sandbox: the site keeps its scripts / storage / alerts, but can never navigate our page away (frame busting)
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox');
  frame.referrerPolicy = 'strict-origin-when-cross-origin';

  const loadingCover = cover('pze-loading', '💨', 'טוען את פלוצל…');
  loadingCover.append(el('div', 'pze-spinner'));
  const failedCover = cover(
    'pze-failed',
    '😬',
    'פלוצל לא נטען',
    'אין חיבור לאתר של פלוצל. אפשר לשחק בגרסה שלנו – אותם חוקים, והניקוד נספר.',
  );
  const toBuiltinBtn = button('pze-btn', 'לשחק כאן ▶', 'builtin');
  const retryBtn = button('pze-btn is-ghost', 'לנסות שוב', 'retry');
  failedCover.append(toBuiltinBtn, retryBtn);
  const freezeCover = cover('pze-freeze', '📺', 'מסתכלים על הטלוויזיה!');
  box.append(frame, loadingCover, failedCover, freezeCover);

  // self-report bar
  const bar = el('div', 'pze-bar');
  const barTop = el('div', 'pze-bar-top');
  const label = el('div', 'pze-bar-label', 'פתרתי! בכמה ניסיונות?');
  const help = button('pze-link', 'לא נטען? משחק חלופי', 'help');
  barTop.append(label, help);
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
  let best = 0;
  let armed: number | 'fail' | null = null;
  let destroyed = false;
  let paused = ctx.isPaused();
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  let builtin: GameInstance | null = null;

  // game-time timers (the finish delay stands still during a freeze)
  const loop = createLoop({ update: (): void => undefined });
  loop.start();

  function setState(next: EmbedState): void {
    state = next;
    wrap.dataset.state = next;
  }
  setState('loading');

  function showCover(which: 'loading' | 'failed' | null): void {
    loadingCover.classList.toggle('is-on', which === 'loading');
    failedCover.classList.toggle('is-on', which === 'failed');
  }

  function applyPaused(): void {
    freezeCover.classList.toggle('is-on', paused);
    wrap.classList.toggle('is-paused', paused);
  }
  applyPaused();

  function clearLoadTimer(): void {
    if (loadTimer !== null) clearTimeout(loadTimer);
    loadTimer = null;
  }

  function markLoaded(): void {
    if (loaded) return;
    loaded = true;
    clearLoadTimer();
    if (state === 'loading') {
      setState(bridgeSeen ? 'bridge' : 'ready');
      showCover(null);
    }
  }

  function fail(): void {
    if (destroyed || bridgeSeen || state === 'done' || state === 'builtin') return;
    clearLoadTimer();
    setState('failed');
    showCover('failed');
    sfx.fail();
  }

  function startLoad(): void {
    loaded = false;
    setState('loading');
    showCover('loading');
    clearLoadTimer();
    loadTimer = setTimeout(() => {
      loadTimer = null;
      if (!loaded) fail();
    }, EMBED_LOAD_TIMEOUT_MS);
    frame.src = src;
    // An unreachable site still fires `load` (with the browser's error page),
    // so ask the network directly too: a rejected no-cors fetch = no site.
    if (typeof fetch === 'function') {
      fetch(src, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' }).catch(() => {
        if (!bridgeSeen) fail();
      });
    }
  }

  function finishSoon(): void {
    setState('done');
    disarm();
    loop.after(FINISH_DELAY_MS, () => ctx.finish());
  }

  // ── bridge ──
  function onBridge(m: BridgeMessage): void {
    if (!bridgeSeen) {
      bridgeSeen = true;
      bar.classList.add('is-hidden');
      markLoaded();
      if (state === 'failed' || state === 'ready' || state === 'loading') {
        setState('bridge');
        showCover(null);
      }
    }
    if (state === 'done') return;
    const partial =
      m.greens !== null || m.yellows !== null
        ? partialScore(m.greens ?? 0, m.yellows ?? 0)
        : m.score !== null
          ? Math.min(PARTIAL_MAX, m.score)
          : 0;
    if (m.type === 'progress') {
      best = Math.max(best, partial);
      ctx.setScore(best);
      return;
    }
    if (m.type === 'solved') {
      const raw = m.score ?? solvedScore(m.tries ?? MAX_TRIES, ctx.timeLeftMs(), ctx.durationMs);
      ctx.setScore(raw);
      sfx.fanfare();
      haptic.success();
      finishSoon();
      return;
    }
    // failed
    best = Math.max(best, partial);
    ctx.setScore(best);
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
    for (const b of numBtns) b.classList.remove('is-armed');
    failBtn.classList.remove('is-armed');
    label.classList.remove('is-armed');
    label.textContent = 'פתרתי! בכמה ניסיונות?';
  }

  function arm(which: number | 'fail'): void {
    disarm();
    armed = which;
    const b = which === 'fail' ? failBtn : numBtns[which - 1];
    b?.classList.add('is-armed');
    label.classList.add('is-armed');
    label.textContent = which === 'fail' ? 'בטוח? הקישו שוב על "לא הצלחתי"' : `בטוח? ${which} ניסיונות – הקישו שוב`;
    sfx.tap(1.2);
    haptic.tap();
  }

  function selfReport(which: number | 'fail'): void {
    if (destroyed || paused || bridgeSeen || state === 'done' || state === 'builtin') return;
    if (armed !== which) {
      arm(which);
      return;
    }
    if (which === 'fail') {
      ctx.setScore(best);
      sfx.fart(1, 0.75);
    } else {
      ctx.setScore(solvedScore(which, ctx.timeLeftMs(), ctx.durationMs));
      sfx.fanfare();
      haptic.success();
    }
    bar.classList.add('is-done');
    finishSoon();
  }

  numBtns.forEach((b, i) => b.addEventListener('click', () => selfReport(i + 1)));
  failBtn.addEventListener('click', () => selfReport('fail'));
  help.addEventListener('click', () => {
    if (paused || state === 'done' || state === 'builtin') return;
    disarm();
    setState('failed');
    showCover('failed');
  });
  retryBtn.addEventListener('click', () => {
    if (paused) return;
    startLoad();
  });

  // ── switch to the builtin game (rest of this round, this player only) ──
  async function switchToBuiltin(): Promise<void> {
    if (destroyed || paused || state === 'builtin' || state === 'done') return;
    setState('builtin');
    clearLoadTimer();
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
  toBuiltinBtn.addEventListener('click', () => {
    void switchToBuiltin();
  });

  frame.addEventListener('load', () => {
    if (destroyed || state === 'builtin') return;
    if (frame.src === '' || frame.src === 'about:blank') return;
    markLoaded();
  });
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
      builtin?.destroy();
      builtin = null;
      wrap.remove();
    },
  };
}
