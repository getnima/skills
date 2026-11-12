/** The lobby: the join QR, the players popping in, the five games, and the standings between rounds. */
import { create as createQr } from 'qrcode';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';

import { GAME_IDS, GAMES, MAX_PLAYERS } from '../../../shared/protocol';
import { StandingsPanel } from './show/index';
import { avatarColor, initialOf } from './show/common';
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
  const pad = 2;
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
      <path d={d} fill="#12082b" />
    </svg>
  );
}

function JoinPanel(props: { readonly code: string; readonly compact: boolean }): JSX.Element {
  const info = useJoinInfo(props.code);
  return (
    <section class={`hs-join ${props.compact ? 'is-compact' : ''}`} data-testid="join">
      {props.compact ? <div class="hs-join-late">עוד לא הצטרפתם? סרקו!</div> : (
        <div class="hs-join-title">
          <span class="hs-join-step">1</span> סרקו עם המצלמה
        </div>
      )}
      <div class="hs-qr-card">
        <QrCode text={info.url} />
      </div>
      <div class="hs-code-row">
        <span class="hs-code-label">קוד החדר</span>
        <span class="hs-code" dir="ltr" data-testid="room-code">
          {props.code}
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

/** Starting chip scale by head count; the fit pass below shrinks further if needed. */
function chipTier(n: number): number {
  if (n <= 6) return 1.35;
  if (n <= 12) return 1.1;
  if (n <= 20) return 0.95;
  if (n <= 32) return 0.82;
  if (n <= 45) return 0.7;
  return 0.6;
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
      for (let i = 0; i < 14 && el.scrollHeight > el.clientHeight + 1 && s * 0.9 >= floor; i++) {
        s *= 0.9;
        el.style.setProperty('--cs', s.toFixed(3));
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n]);

  return (
    <div class="hs-chips kit-scroll" ref={box} data-testid="chips">
      {n === 0 ? (
        <div class="hs-chips-empty">
          <span class="hs-bounce">📱</span>
          <span>מחכים לשחקנים הראשונים…</span>
        </div>
      ) : (
        props.players.map((p, i) => (
          <button
            type="button"
            key={p.id}
            class={`hs-chip ${p.connected ? '' : 'is-away'}`}
            style={{ '--chip': avatarColor(p.avatar), animationDelay: `${Math.min(i, 8) * 30}ms` }}
            title="לחצו כדי להוציא מהמשחק"
            data-testid="chip"
            onClick={(e) => {
              e.stopPropagation();
              props.onKick(p);
            }}
          >
            <span class="hs-chip-av">{initialOf(p.name)}</span>
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
      {GAME_IDS.map((id, i) => {
        const g = GAMES[id];
        const done = props.played.includes(id);
        const isNext = id === next;
        return (
          <button
            type="button"
            key={id}
            class={`hs-game ${done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}`}
            style={{ '--gc': GAME_COLORS[i % GAME_COLORS.length] }}
            data-testid={`game-${id}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onStart(id);
            }}
          >
            {isNext ? <span class="hs-game-tag">הבא בתור</span> : null}
            {done ? <span class="hs-game-done">✓ שוחק</span> : null}
            <span class="hs-game-emoji">{g.emoji}</span>
            <span class="hs-game-title">{g.title}</span>
            <span class="hs-game-dur">⏱ {secondsLabel(g.durationMs)}</span>
          </button>
        );
      })}
    </section>
  );
}

const GAME_COLORS: readonly string[] = ['#ff3d8b', '#2de2e6', '#ffd23f', '#3ddc84', '#ff8a3d'];

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
            <div class="hs-prize-ribbon">
              <span class="hs-prize-mini">
                <PrizeRelic variant="mini" />
              </span>
              <span class="hs-prize-text">
                <b>בכל סיבוב יש פרס!</b>
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
