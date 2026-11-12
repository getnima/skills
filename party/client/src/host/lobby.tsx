/** The lobby: the join QR, the players popping in, the five games, and the standings between rounds. */
import { create as createQr } from 'qrcode';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';

import { GAME_IDS, GAMES, MAX_PLAYERS } from '../../../shared/protocol';
import { peekAvatarUrl, useAvatarUrl } from '../avatar';
import { StandingsPanel } from './show/index';
import { hostDollUrl } from './show/art';
import { lookPlateColor, unitPx } from './show/common';
import { PrizeRelic } from './show/prize';
import { prettyUrl, useJoinInfo } from './util';

import type { JSX } from 'preact';
import type { GameId, PlayerPublic, RoomState } from '../../../shared/protocol';

// ───────────────────────────── QR ─────────────────────────────

function qrPath(text: string): { size: number; d: string } {
  const qr = createQr(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (data[y * size + x]) {
        let run = 1;
        while (x + run < size && data[y * size + x + run]) run++;
        d += `M${x} ${y}h${run}v1h-${run}z`;
        x += run;
      } else {
        x++;
      }
    }
  }
  return { size, d };
}

export function QrCode(props: { readonly text: string; readonly class?: string }): JSX.Element {
  const { size, d } = useMemo(() => qrPath(props.text), [props.text]);
  // quiet zone in modules: with the white card around it this is more than the 4 the standard asks for
  const pad = 3;
  return (
    <svg
      class={`hs-qr-svg ${props.class ?? ''}`}
      viewBox={`${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}`}
      shape-rendering="crispEdges"
      role="img"
      aria-label="QR להצטרפות"
      data-testid="qr"
    >
      <rect x={-pad} y={-pad} width={size + pad * 2} height={size + pad * 2} fill="#ffffff" />
      <path d={d} fill="#16120e" />
    </svg>
  );
}

function JoinPanel(props: { readonly code: string; readonly compact: boolean }): JSX.Element {
  const info = useJoinInfo(props.code);
  return (
    <section class={`hs-join ${props.compact ? 'is-compact' : ''}`} data-testid="join">
      {props.compact ? <div class="hs-join-late">עוד לא בפנים? סרקו!</div> : <div class="hs-join-title">סרקו עם המצלמה</div>}
      <div class="hs-qr-card">
        <QrCode text={info.url} />
      </div>
      <div class="hs-code-row">
        <span class="hs-code-label">קוד החדר</span>
        {/* one tile per letter; the element's text is still the plain code */}
        <span class="hs-code" dir="ltr" data-testid="room-code">
          {Array.from(props.code).map((ch, i) => (
            <i key={i}>{ch}</i>
          ))}
        </span>
      </div>
      <div class="hs-url" dir="ltr" data-testid="join-url">
        {prettyUrl(info.url)}
      </div>
      {info.local && !info.pending ? (
        <div class="hs-local-warn" data-testid="local-warn">
          <span class="hs-warn-long">⚠️ הכתובת היא localhost: טלפונים לא יגיעו אליה. פתחו את הדף דרך כתובת הרשת של המחשב, או הוסיפו לכתובת:</span>
          <span class="hs-warn-short">⚠️ localhost: הטלפונים לא יגיעו. הוסיפו לכתובת:</span>
          <code dir="ltr">?join=http://192.168.x.x{window.location.port ? `:${window.location.port}` : ''}</code>
        </div>
      ) : null}
    </section>
  );
}

// ───────────────────────────── Players ─────────────────────────────

/**
 * Up to this many guests each one is a CARD: the dressed doll, big, with the name under it
 * (the room watches people dress). Above it the room is too full for cards: a pill with a
 * smaller doll and the name beside it, which keeps the names readable at 60.
 */
const CARD_MAX = 24;
/** The doll's side in design units at scale 1 (host.css: .hs-chip-av). */
const CARD_DOLL = 132;
const PILL_DOLL = 62;

/**
 * Starting chip scale by head count; the fit pass below shrinks further if needed.
 * The dolls are the stars: a small room gets them as big as the stage allows.
 */
function chipTier(n: number): number {
  if (n <= 2) return 2.2;
  if (n <= 4) return 1.8;
  if (n <= 6) return 1.5;
  if (n <= 8) return 1.3;
  if (n <= 12) return 1.12;
  if (n <= 18) return 0.96;
  if (n <= CARD_MAX) return 0.86;
  if (n <= 32) return 0.9;
  if (n <= 45) return 0.76;
  return 0.64;
}

/** "Your hosts": the two host dolls wait on the stage until the first guest is in. */
function WaitingHosts(): JSX.Element {
  const a = hostDollUrl('a');
  const b = hostDollUrl('b');
  return (
    <div class="hs-chips-empty">
      {a !== null && b !== null ? (
        <div class="hs-hosts" data-testid="hosts">
          <span class="hs-hosts-tag">
            <span>יאללה!</span>
          </span>
          <img src={b} alt="" draggable={false} />
          <img src={a} alt="" draggable={false} />
        </div>
      ) : (
        <span class="hs-bounce">📱</span>
      )}
      <span class="hs-chips-empty-text">מחכים לשחקנים הראשונים…</span>
    </div>
  );
}

/**
 * The guest's dressed Shimi in a chip. The box is sized by CSS (--hu x --cs); `px` only picks
 * a picture that is sharp enough. The picture comes from the avatar module's cache: a state
 * message that does not change this guest's look costs nothing here, and while a new look is
 * being composed the old picture stays.
 */
function ChipDoll(props: { readonly look: string; readonly px: number }): JSX.Element {
  const url = useAvatarUrl(props.look, props.px);
  // data-drawn: the picture on screen is the one of data-look (not the previous look's, kept while composing)
  const drawn = url !== null && peekAvatarUrl(props.look, props.px) === url;
  return (
    <span class="hs-chip-av" style={{ backgroundColor: lookPlateColor(props.look) }} data-look={props.look} data-drawn={drawn ? '1' : '0'}>
      {url !== null ? <img key={url} src={url} alt="" draggable={false} /> : null}
    </span>
  );
}

function PlayerChips(props: { readonly players: readonly PlayerPublic[]; onKick(p: PlayerPublic): void }): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const n = props.players.length;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = (): void => {
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const floor = portrait ? 0.95 : 0.3;
      let s = Math.max(floor, chipTier(n));
      el.style.setProperty('--cs', String(s));
      for (let i = 0; i < 30 && el.scrollHeight > el.clientHeight + 1 && s * 0.94 >= floor; i++) {
        s *= 0.94;
        el.style.setProperty('--cs', s.toFixed(3));
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n]);

  const cards = n <= CARD_MAX;
  // an upper bound of the doll's size on screen (the fit pass only shrinks): the picture is never blurry
  const dollPx = Math.max(32, Math.round((cards ? CARD_DOLL : PILL_DOLL) * chipTier(n) * unitPx()));
  return (
    <div class={`hs-chips kit-scroll ${cards ? 'is-cards' : 'is-pills'}`} ref={box} data-testid="chips">
      {n === 0 ? (
        <WaitingHosts />
      ) : (
        props.players.map((p, i) => (
          <button
            type="button"
            key={p.id}
            class={`hs-chip ${p.connected ? '' : 'is-away'}`}
            style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
            title="לחצו כדי להוציא מהמשחק"
            data-testid="chip"
            data-player={p.id}
            onClick={(e) => {
              e.stopPropagation();
              props.onKick(p);
            }}
          >
            <ChipDoll look={p.look} px={dollPx} />
            <span class="hs-chip-name" dir="auto">
              {p.name}
            </span>
            {p.connected ? null : <span class="hs-chip-off">💤</span>}
          </button>
        ))
      )}
    </div>
  );
}

// ───────────────────────────── Games ─────────────────────────────

export function nextGame(played: readonly GameId[]): GameId | null {
  return GAME_IDS.find((g) => !played.includes(g)) ?? null;
}

function secondsLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s >= 60 && s % 60 === 0) return s === 60 ? 'דקה' : `${s / 60} דקות`;
  return `${s} שניות`;
}

function GameCards(props: { readonly played: readonly GameId[]; onStart(g: GameId): void }): JSX.Element {
  const next = nextGame(props.played);
  return (
    <section class="hs-games" data-testid="games">
      {GAME_IDS.map((id) => {
        const g = GAMES[id];
        const done = props.played.includes(id);
        const isNext = id === next;
        return (
          <button
            type="button"
            key={id}
            class={`hs-game ${done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}`}
            data-testid={`game-${id}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onStart(id);
            }}
          >
            {isNext ? <span class="hs-game-tag">הבא בתור</span> : null}
            {done ? <span class="hs-game-done">שיחקנו ✓</span> : null}
            <span class="hs-game-emoji">{g.emoji}</span>
            <span class="hs-game-title">{g.title}</span>
            <span class="hs-game-dur">⏱ {secondsLabel(g.durationMs)}</span>
          </button>
        );
      })}
    </section>
  );
}

// ───────────────────────────── Lobby ─────────────────────────────

export interface LobbyProps {
  readonly state: RoomState;
  onStart(g: GameId): void;
  onKick(p: PlayerPublic): void;
}

export function Lobby(props: LobbyProps): JSX.Element {
  const { state } = props;
  const between = state.played.length > 0 || state.results !== null;
  const online = state.players.filter((p) => p.connected).length;
  const n = state.players.length;
  return (
    <div class={`hs-lobby ${between ? 'is-between' : 'is-first'}`} data-testid="lobby">
      <JoinPanel code={state.code} compact={between} />
      {between ? (
        <div class="hs-standings-slot" data-testid="standings">
          <StandingsPanel players={state.players} results={state.results} />
        </div>
      ) : null}
      <section class="hs-players">
        <header class="hs-players-head">
          {between ? null : (
            <div class="hs-logo" aria-hidden="true">
              <span>פארטי</span>
              <span>ארנה</span>
            </div>
          )}
          {between ? null : (
            <div class="hs-prize-ribbon">
              <span class="hs-prize-mini">
                <PrizeRelic variant="mini" />
              </span>
              <span class="hs-prize-text">
                <b>פרס בכל סיבוב!</b>
                <span>המנצח לוקח הביתה מלאך שימי בעבודת יד</span>
              </span>
            </div>
          )}
          <div class="hs-count" data-testid="player-count">
            <span class="hs-count-num">{n}</span>
            <span class="hs-count-label">
              <span>{n === 1 ? 'שחקן' : 'שחקנים'}</span>
              {n > 0 && online < n ? <small>{online} מחוברים</small> : null}
              {n >= MAX_PLAYERS ? <small>החדר מלא</small> : null}
            </span>
          </div>
        </header>
        <PlayerChips players={state.players} onKick={props.onKick} />
      </section>
      <GameCards played={state.played} onStart={props.onStart} />
    </div>
  );
}
