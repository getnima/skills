/**
 * Preview: try the five games and the dressing room alone, without a server and
 * without the TV. Everything happens in ONE page with no navigation and no query
 * strings, so the page also runs inside a sandboxed frame (tools/preview builds
 * it into a single shareable page). Not part of the party build.
 */
import '../kit/base.css';
import './preview.css';

import { GAMES, GAME_IDS } from '../../../shared/protocol';
import { randomLook } from '../../../shared/avatar';
import { sfx, unlockAudio } from '../kit/audio';
import { initMobileViewport } from '../kit/mobile';
import { mountStage } from '../play/stage';

import type { AvatarLook } from '../../../shared/avatar';
import type { GameId } from '../../../shared/protocol';
import type { RoundClockSample, Stage, StageOptions } from '../games/types';

const app = document.getElementById('app') as HTMLElement;

/** After a game says it has nothing more to gain (fell in flappy, the tap sprint is over): its last frame stays this long. */
const FINISH_HOLD_MS = 3000;

/** One plain line per game: what you do, in the owner's words. */
const BLURB: Readonly<Record<GameId, string>> = {
  tap: '30 שניות להתחיל, ואז 20 שניות של ספאם על שימי',
  icy: 'מחזיקים צד והוא קופץ לבד. כמה שיותר גבוה',
  flappy: 'חיים אחד. האחרון שנשאר באוויר מנצח',
  plotzel: 'משימי לפלוץ. 80% מהירות, 20% צעדים',
  ninja: 'חותכים את כל האוכל. לא את הפצצות',
};

function h(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, onTap: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.addEventListener('click', onTap);
  return b;
}

/** What is on screen now; leaving a screen always goes through its cleanup. */
let leave: (() => void) | null = null;
function show(nodes: readonly Node[], cleanup: (() => void) | null = null): void {
  const old = leave;
  leave = null;
  try {
    old?.();
  } catch (err) {
    console.error('[preview] cleanup failed', err);
  }
  app.replaceChildren(...nodes);
  leave = cleanup;
}

// ───────────────────────────── Menu ─────────────────────────────

function renderMenu(): void {
  const page = h('div', 'pv-menu kit-scroll');

  const head = h('header', 'pv-head');
  const title = h('h1', 'pv-title');
  title.append(h('span', 'pv-title-a', 'פארטי'), h('span', 'pv-title-b', 'ארנה'));
  head.append(h('div', 'pv-sticker', 'טעימה!'), title, h('p', 'pv-sub', 'משחקים כאן לבד, בלי שרת. במסיבה כולם משחקים יחד והטלוויזיה מראה את הטבלה.'));

  const grid = h('div', 'pv-grid');
  GAME_IDS.forEach((id, i) => {
    const meta = GAMES[id];
    const card = button(`pv-card is-c${i % 5}`, '', () => void play(id));
    card.dataset.game = id;
    const text = h('span', 'pv-card-text');
    text.append(h('span', 'pv-card-title', meta.title), h('span', 'pv-card-blurb', BLURB[id]));
    // an elimination game has no fixed length: alone it ends when you fall
    const length = meta.mode === 'elimination' ? 'עד שנופלים' : `${Math.round(meta.durationMs / 1000)} שנ׳`;
    card.append(h('span', 'pv-card-emoji', meta.emoji), text, h('span', 'pv-card-secs', length));
    grid.append(card);
  });
  const dress = button('pv-card is-dress', '', () => void dressingRoom());
  dress.dataset.game = 'dress';
  const dressText = h('span', 'pv-card-text');
  dressText.append(h('span', 'pv-card-title', 'חדר הלבשה'), h('span', 'pv-card-blurb', 'מלבישים את שימי. ככה נראים בטבלה'));
  dress.append(h('span', 'pv-card-emoji', '🎩'), dressText, h('span', 'pv-card-secs', 'חופשי'));
  grid.append(dress);

  const foot = h('p', 'pv-foot', 'לא כאן: החדר עם כל האורחים, מסך הטלוויזיה והשלט מהטלפון.');
  page.append(head, grid, foot);
  show([page]);
}

// ───────────────────────────── Play ─────────────────────────────

async function play(gameId: GameId): Promise<void> {
  const meta = GAMES[gameId];
  const durationMs = meta.durationMs;
  const seed = 1 + Math.floor(Math.random() * 1_000_000);

  // local round clock (the party's clock comes from the server)
  const t0 = performance.now();
  let ended = false;
  let stage: Stage | null = null;
  const clock = (): RoundClockSample => ({ leftMs: Math.max(0, durationMs - (performance.now() - t0)), frozen: false });

  const quit = button('pv-quit', '✕ יציאה', () => renderMenu());
  quit.setAttribute('aria-label', 'יציאה לתפריט');
  const host = h('div', 'pv-stage');
  show([host, quit], () => {
    ended = true;
    stage?.destroy();
    stage = null;
  });

  function finish(finalScore: number, stopGame: boolean): void {
    if (ended) return;
    ended = true;
    quit.remove();
    if (stopGame) {
      // alone there is nobody to wait for: stop the game (its loops and sounds) under the end card
      stage?.destroy();
      stage = null;
    }
    sfx.success();
    host.append(endCard(gameId, finalScore));
  }

  const opts: StageOptions = {
    parent: host,
    gameId,
    seed,
    durationMs,
    clock,
    onScore: (): void => undefined,
    onFinish(score: number): void {
      window.setTimeout(() => finish(score, true), FINISH_HOLD_MS);
    },
    onEnd(finalScore: number): void {
      finish(finalScore, false);
    },
  };
  try {
    const mounted = await mountStage(opts);
    if (ended) mounted.destroy();
    else stage = mounted;
  } catch (err) {
    console.error('[preview] the game did not start', err);
    if (!ended) {
      ended = true;
      const box = h('div', 'pv-end');
      box.append(h('div', 'pv-end-title', 'המשחק לא עלה'), button('pv-btn', 'לתפריט', () => renderMenu()));
      host.append(box);
    }
  }
}

function endCard(gameId: GameId, finalScore: number): HTMLElement {
  const meta = GAMES[gameId];
  const end = h('div', 'pv-end');
  const row = h('div', 'pv-end-row');
  row.append(
    button('pv-btn is-red', 'שוב!', () => void play(gameId)),
    button('pv-btn', 'לתפריט', () => renderMenu()),
  );
  end.append(
    h('div', 'pv-end-sticker', 'נגמר!'),
    h('div', 'pv-end-game', `${meta.emoji} ${meta.title}`),
    h('div', 'pv-end-score', finalScore.toLocaleString('en-US')),
    h('div', 'pv-end-label', 'הניקוד שלך'),
    row,
  );
  return end;
}

// ───────────────────────────── Dressing room ─────────────────────────────

let myLook: AvatarLook = randomLook(1 + Math.floor(Math.random() * 1_000_000));

async function dressingRoom(): Promise<void> {
  const host = h('div', 'pv-room');
  let gone = false;
  let unmount: (() => void) | null = null;
  show([host], () => {
    gone = true;
    unmount?.();
  });
  try {
    const { mountDressingRoom } = await import('../avatar/dressing-mount');
    if (gone) return;
    const room = mountDressingRoom(host, {
      look: myLook,
      name: 'אורח',
      compact: host.clientHeight < 560,
      onChange: (look) => {
        myLook = look;
      },
      onDone: (look) => {
        myLook = look;
        renderMenu();
      },
    });
    unmount = () => room.unmount();
  } catch (err) {
    console.error('[preview] the dressing room did not load', err);
    if (!gone) renderMenu();
  }
}

// ───────────────────────────── Boot ─────────────────────────────

initMobileViewport();
window.addEventListener('pointerdown', () => unlockAudio(), { once: true });
renderMenu();
