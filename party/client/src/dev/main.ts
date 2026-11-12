/**
 * Game harness: play any mini game alone, on a local clock, without a server.
 *
 *   /dev.html                                         the list
 *   /dev.html?game=tap&seed=1&duration=20000          play (duration in ms)
 *   ...&freezeAt=5000&freezeMs=4000                   freeze once at 5s of round time, for 4s
 *   ...&look=1.8.8-17.9.0.11.7                        the guest's own doll (an encoded look) for GameContext.myLook
 *   /dev.html?game=demo                               the kit's reference game
 *   /dev.html?kit=1                                   placeholder art + every sound and song
 *
 * For automated checks: window.__party = { score, ended, gameId, frozen, leftMs, freeze(ms) }.
 */
import '../kit/base.css';
import './dev.css';

import { GAMES, GAME_IDS } from '../../../shared/protocol';
import { isMuted, setMuted, sfx, unlockAudio } from '../kit/audio';
import { enterFullscreen, initMobileViewport } from '../kit/mobile';
import { PARTY_COLORS } from '../kit/theme';
import { mountStage, mountStageWith } from '../play/stage';

import type { GameId } from '../../../shared/protocol';
import type { RoundClockSample, Stage, StageOptions } from '../games/types';

interface PartyDebug {
  readonly score: number;
  readonly ended: boolean;
  readonly gameId: string | null;
  readonly frozen: boolean;
  readonly leftMs: number;
  freeze(ms: number): void;
}

declare global {
  interface Window {
    __party?: PartyDebug;
  }
}

const DEMO_ID = 'demo';
const app = document.getElementById('app') as HTMLElement;
const params = new URLSearchParams(window.location.search);

function numParam(name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function isGameId(v: string | null): v is GameId {
  return v !== null && (GAME_IDS as readonly string[]).includes(v);
}

function h(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ───────────────────────────── Index ─────────────────────────────

function renderIndex(): void {
  window.__party = { score: 0, ended: false, gameId: null, frozen: false, leftMs: 0, freeze: (): void => undefined };
  const page = h('div', 'dv-index');
  const title = h('h1', 'dv-title');
  title.innerHTML = '🧪 מעבדת <b>המשחקים</b>';
  const sub = h('p', 'dv-sub', 'בוחרים משחק ומשחקים לבד, בלי שרת ובלי טלוויזיה.');

  const opts = h('div', 'dv-opts');
  const seedField = h('label', 'dv-field', 'גרעין');
  const seedInput = document.createElement('input');
  seedInput.type = 'number';
  seedInput.inputMode = 'numeric';
  seedInput.value = String(numParam('seed', 1));
  seedField.append(seedInput);
  const durField = h('label', 'dv-field', 'שניות');
  const durInput = document.createElement('input');
  durInput.type = 'number';
  durInput.inputMode = 'numeric';
  durInput.placeholder = 'מלא';
  durField.append(durInput);
  opts.append(seedField, durField);

  const grid = h('div', 'dv-grid kit-scroll');
  const cards: Array<{ a: HTMLAnchorElement; id: string }> = [];
  const entries: Array<{ id: string; emoji: string; title: string; meta: string }> = GAME_IDS.map((id) => ({
    id,
    emoji: GAMES[id].emoji,
    title: GAMES[id].title,
    meta: `${Math.round(GAMES[id].durationMs / 1000)} שניות`,
  }));
  entries.push({ id: DEMO_ID, emoji: '⭐', title: 'דמו של הערכה', meta: 'משחק לדוגמה' });
  entries.forEach((entry, i) => {
    const a = document.createElement('a');
    a.className = 'dv-card';
    a.style.setProperty('--card', PARTY_COLORS[i % PARTY_COLORS.length] ?? '#ffd23f');
    a.dataset.game = entry.id;
    a.append(h('div', 'dv-card-emoji', entry.emoji), h('div', 'dv-card-title', entry.title), h('div', 'dv-card-meta', entry.meta));
    grid.append(a);
    cards.push({ a, id: entry.id });
  });

  const refresh = (): void => {
    for (const { a, id } of cards) {
      const q = new URLSearchParams({ game: id, seed: String(Number(seedInput.value) || 1) });
      const secs = Number(durInput.value);
      if (Number.isFinite(secs) && secs > 0) q.set('duration', String(Math.round(secs * 1000)));
      a.href = `?${q.toString()}`;
    }
  };
  seedInput.addEventListener('input', refresh);
  durInput.addEventListener('input', refresh);
  refresh();

  page.append(title, sub, opts, grid);
  app.replaceChildren(page);
}

// ───────────────────────────── Play ─────────────────────────────

async function play(gameId: string): Promise<void> {
  const meta = isGameId(gameId) ? GAMES[gameId] : null;
  const durationMs = Math.max(1000, numParam('duration', meta ? meta.durationMs : 30_000));
  const seed = numParam('seed', 1);
  const freezeAt = numParam('freezeAt', -1);
  const freezeMs = numParam('freezeMs', 4000);
  // ?look=<encoded look>: the guest's own doll (the game decodes and checks it; none = unknown)
  const lookParam = (params.get('look') ?? '').trim() || null;

  // Local round clock: round time only advances while not frozen.
  let playedMs = 0;
  let last = performance.now();
  let frozenUntil = 0;
  let autoFreezeDone = freezeAt < 0;
  let ended = false;
  let stage: Stage | null = null;

  function freeze(ms: number): void {
    if (ended) return;
    const now = performance.now();
    advance(now);
    frozenUntil = Math.max(frozenUntil, now) + Math.max(0, ms);
  }

  function advance(now: number): void {
    if (now >= frozenUntil) {
      // time that passed after the freeze ended counts; the frozen part does not
      playedMs += now - Math.max(last, Math.min(frozenUntil, now));
    }
    last = now;
    if (!autoFreezeDone && playedMs >= freezeAt) {
      autoFreezeDone = true;
      playedMs = freezeAt;
      frozenUntil = now + freezeMs;
    }
  }

  function clock(): RoundClockSample {
    const now = performance.now();
    advance(now);
    return { leftMs: Math.max(0, durationMs - playedMs), frozen: now < frozenUntil };
  }

  // Freeze banner (the real shell shows its own "watch the TV" screen).
  const banner = h('div', 'dv-freeze');
  const count = h('div', 'dv-freeze-count', '');
  banner.append(h('div', 'dv-freeze-emoji', '📺'), h('div', 'dv-freeze-title', 'מסתכלים על הטלוויזיה!'), count);

  const tools = h('div', 'dv-tools');
  const freezeBtn = h('button', 'dv-tool', '❄️ 4');
  freezeBtn.setAttribute('aria-label', 'הקפאה ל-4 שניות');
  freezeBtn.dataset.act = 'freeze';
  freezeBtn.addEventListener('click', () => freeze(4000));
  const muteBtn = h('button', 'dv-tool', isMuted() ? '🔇' : '🔊');
  muteBtn.dataset.act = 'mute';
  muteBtn.addEventListener('click', () => {
    setMuted(!isMuted());
    muteBtn.textContent = isMuted() ? '🔇' : '🔊';
  });
  const backBtn = h('button', 'dv-tool', '✕');
  backBtn.dataset.act = 'back';
  backBtn.addEventListener('click', () => {
    stage?.destroy();
    window.location.href = window.location.pathname;
  });
  tools.append(freezeBtn, muteBtn, backBtn);
  app.replaceChildren(banner, tools);

  let bannerOn = false;
  let shownCount = '';
  function paintBanner(): void {
    if (ended) return;
    requestAnimationFrame(paintBanner);
    const leftMs = frozenUntil - performance.now();
    const on = leftMs > 0;
    if (on !== bannerOn) {
      bannerOn = on;
      banner.classList.toggle('is-on', on);
    }
    const text = on ? String(Math.ceil(leftMs / 1000)) : '';
    if (text !== shownCount) {
      shownCount = text;
      count.textContent = text;
    }
  }

  window.__party = {
    get score(): number {
      return stage ? stage.getScore() : 0;
    },
    get ended(): boolean {
      return ended;
    },
    gameId,
    get frozen(): boolean {
      return !ended && performance.now() < frozenUntil;
    },
    get leftMs(): number {
      return ended ? 0 : clock().leftMs;
    },
    freeze,
  };

  const opts: StageOptions = {
    parent: app,
    gameId: isGameId(gameId) ? gameId : 'tap',
    seed,
    durationMs,
    clock,
    myLook: (): string | null => lookParam,
    onScore: (): void => undefined,
    onEnd(finalScore: number): void {
      ended = true;
      banner.classList.remove('is-on');
      tools.remove();
      sfx.success();
      showEnd(finalScore, meta ? `${meta.emoji} ${meta.title}` : '⭐ דמו של הערכה');
    },
  };

  last = performance.now();
  if (isGameId(gameId)) stage = await mountStage(opts);
  else stage = await mountStageWith(opts, async () => (await import('./demo-game')).game);
  paintBanner();
}

function showEnd(finalScore: number, gameTitle: string): void {
  const end = h('div', 'dv-end');
  const row = h('div', 'dv-end-row');
  const again = h('button', 'dv-btn', 'שוב 🔁');
  again.dataset.act = 'again';
  again.addEventListener('click', () => window.location.reload());
  const back = h('button', 'dv-btn is-ghost', 'חזרה');
  back.dataset.act = 'back';
  back.addEventListener('click', () => {
    window.location.href = window.location.pathname;
  });
  row.append(again, back);
  end.append(
    h('div', 'dv-end-emoji', '🏁'),
    h('div', 'dv-end-title', 'נגמר הזמן!'),
    h('div', 'dv-end-label', gameTitle),
    h('div', 'dv-end-score', finalScore.toLocaleString('en-US')),
    h('div', 'dv-end-label', 'ניקוד סופי'),
    row,
  );
  app.append(end);
}

// ───────────────────────────── Boot ─────────────────────────────

initMobileViewport();
window.addEventListener(
  'pointerdown',
  () => {
    unlockAudio();
    void enterFullscreen();
  },
  { once: true },
);

const requested = params.get('game');
if (requested !== null && (isGameId(requested) || requested === DEMO_ID)) void play(requested);
else if (params.has('kit')) void import('./gallery').then((m) => m.renderGallery(app));
else renderIndex();
