/**
 * The owner's phone remote (/remote): unlock with the password, then run the
 * night with one thumb. Every button is an action of the TV's model (./link.ts
 * receives it over the relay); the TV runs the press through its own
 * dispatcher, so the phone and the TV never disagree.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { GAMES } from '../../../shared/protocol';
import { Avatar } from '../avatar';
import { haptic } from '../kit/haptics';
import { keepAwake } from '../kit/mobile';
import { findAction } from '../host/actions';
import { askFor, bigButton, connectedCount, defaultPick, liveCountText, phaseText, roundClockText, secondaryActions, topFive } from './logic';
import { useRemoteLink } from './link';

import type { ComponentChildren, JSX } from 'preact';
import type { GameId } from '../../../shared/protocol';
import type { ActionId, ControlAction, ControlModel } from '../host/actions';
import type { RemoteLink, RunResult } from './link';

/** Automation hook for the browser tests (read-only). */
declare global {
  interface Window {
    __remote?: { phase(): string; tv(): string; server(): string; model(): ControlModel | null };
  }
}

type Sheet = 'none' | 'more' | 'cutscenes' | 'players';

interface Ask {
  readonly id: ActionId;
  readonly arg?: string;
  readonly question: string;
  readonly text?: string;
  readonly yes: string;
  readonly danger: boolean;
  /** Straight to the server (the TV is away). */
  readonly rescue?: 'endRound';
}

interface Flash {
  readonly n: number;
  readonly ok: boolean;
  readonly text: string;
}

const press = (): void => haptic.tap();

/** The big button takes no second press within this long of the last one (a double tap is one decision). */
const BIG_AGAIN_MS = 1_000;
/** ...nor within this long of the screen or its next step changing (the second tap would land on the new screen). */
const BIG_AFTER_SCREEN_MS = 700;

/** Re-render every `ms` while `on`. */
function useEvery(ms: number, on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => set((n) => (n + 1) % 1_000_000), ms);
    return () => clearInterval(id);
  }, [ms, on]);
}

// ───────────────────────────── unlock ─────────────────────────────

function Title(): JSX.Element {
  return (
    <div class="rm-title">
      <span class="rm-title-small">השלט של</span>
      <span class="rm-title-big">פארטי ארנה</span>
    </div>
  );
}

function Unlock(props: { readonly link: RemoteLink }): JSX.Element {
  const { link } = props;
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEvery(250, link.retryAt !== null);
  const waitMs = link.retryAt !== null ? link.retryAt - Date.now() : 0;
  const waiting = waitMs > 0;
  const checking = link.phase === 'checking';
  const submit = (e: Event): void => {
    e.preventDefault();
    press();
    if (waiting || checking) return;
    link.unlock(value);
    setValue('');
    input.current?.blur();
  };
  let message: JSX.Element | null = null;
  if (waiting) {
    message = (
      <p class="rm-msg rm-msg--wait" data-testid="unlock-wait" role="alert">
        יותר מדי ניסיונות. נסו שוב בעוד <b data-testid="unlock-wait-s">{Math.ceil(waitMs / 1000)}</b> שניות
      </p>
    );
  } else if (link.error !== null) {
    message = (
      <p class="rm-msg rm-msg--bad" data-testid="unlock-error" role="alert">
        {link.error}
      </p>
    );
  }
  return (
    <div class="rm-page rm-unlock" data-testid="unlock">
      <Title />
      <form class="rm-unlock-card" onSubmit={submit} autocomplete="off" action="#" method="post">
        <label class="rm-label" for="rm-pw">
          🔒 סיסמה
        </label>
        <input
          id="rm-pw"
          ref={input}
          class="rm-input"
          type="password"
          value={value}
          dir="ltr"
          inputMode="text"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          enterKeyHint="go"
          data-testid="unlock-input"
          disabled={waiting}
          onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="rm-btn rm-btn--red rm-btn--wide" data-testid="unlock-go" disabled={waiting || checking}>
          {checking ? 'בודקים…' : 'כניסה'}
        </button>
        {message}
      </form>
    </div>
  );
}

function Waiting(props: { readonly link: RemoteLink }): JSX.Element {
  const { link } = props;
  return (
    <div class="rm-page rm-waiting" data-testid="waiting">
      <Title />
      <div class="rm-card">
        <div class="rm-tv-icon">📺</div>
        <p class="rm-card-big">{link.server === 'online' ? 'עוד אין מסך פתוח' : 'מתחברים לשרת…'}</p>
        <p class="rm-card-small">פתחו את עמוד הטלוויזיה. השלט יתחבר לבד.</p>
        <div class="rm-dots-loader">
          <span />
          <span />
          <span />
        </div>
      </div>
      <button type="button" class="rm-link-btn" onClick={() => link.logout()} data-testid="logout">
        התנתק
      </button>
    </div>
  );
}

function Choose(props: { readonly link: RemoteLink }): JSX.Element {
  const { link } = props;
  return (
    <div class="rm-page rm-choose" data-testid="choose">
      <Title />
      <div class="rm-card">
        <p class="rm-card-big">כמה מסכים פתוחים</p>
        <p class="rm-card-small">איזה חדר? הקוד מופיע על הטלוויזיה.</p>
        <div class="rm-room-list">
          {link.rooms.map((code) => (
            <button
              type="button"
              key={code}
              class="rm-btn rm-btn--yellow rm-room"
              dir="ltr"
              data-testid={`room-${code}`}
              onClick={() => {
                press();
                link.pickRoom(code);
              }}
            >
              {code}
            </button>
          ))}
        </div>
      </div>
      <button type="button" class="rm-link-btn" onClick={() => link.logout()}>
        התנתק
      </button>
    </div>
  );
}

// ───────────────────────────── main ─────────────────────────────

function Dot(props: { readonly on: boolean | null; readonly label: string; readonly testId: string }): JSX.Element {
  const cls = props.on === null ? 'is-wait' : props.on ? 'is-on' : 'is-off';
  return (
    <span class={`rm-dot ${cls}`} data-testid={props.testId} data-on={String(props.on)}>
      <i />
      {props.label}
    </span>
  );
}

function Header(props: { readonly link: RemoteLink }): JSX.Element {
  const { link } = props;
  const s = link.state;
  const running = s !== null && (s.phase === 'intro' || s.phase === 'countdown' || s.phase === 'playing');
  useEvery(250, running);
  const clock = roundClockText(s, link.clock.now());
  const { online, total } = connectedCount(s);
  return (
    <header class="rm-top" data-testid="status">
      <div class="rm-top-row">
        <span class="rm-code" dir="ltr" data-testid="code">
          {s?.code ?? '····'}
        </span>
        <span class="rm-phase" data-testid="phase">
          {phaseText(s)}
        </span>
        {clock !== null ? (
          <span class="rm-clock" data-testid="clock">
            {clock}
          </span>
        ) : null}
      </div>
      <div class="rm-top-row rm-top-row--links">
        <Dot on={link.server === 'online' ? true : link.server === 'offline' ? false : null} label="שרת" testId="dot-server" />
        <Dot on={link.tv === 'online' ? true : link.tv === 'offline' ? false : null} label="מסך" testId="dot-tv" />
        <span class="rm-people" data-testid="people">
          👥 {online}/{total} מחוברים
        </span>
      </div>
    </header>
  );
}

function Picker(props: {
  readonly model: ControlModel;
  readonly selected: GameId | null;
  readonly enabled: boolean;
  onPick(g: GameId): void;
}): JSX.Element | null {
  const start = findAction(props.model, 'start');
  if (start?.items === undefined) return null;
  const lit = props.selected ?? defaultPick(props.model);
  return (
    <section class="rm-games" data-testid="picker">
      <div class="rm-sec-title">
        <span>בחרו משחק</span>
        <span class="rm-live-count">נגיעה בוחרת · הכפתור מתחיל</span>
      </div>
      <div class="rm-game-row">
        {start.items.map((item) => {
          const g = item.arg as GameId;
          const on = lit === g;
          return (
            <button
              type="button"
              key={g}
              class={`rm-game ${on ? 'is-on' : ''} ${item.mark === 'played' ? 'is-played' : ''}`}
              disabled={!props.enabled || !item.enabled}
              data-testid={`pick-${g}`}
              aria-pressed={on}
              onClick={() => {
                press();
                props.onPick(g);
              }}
            >
              <span class="rm-game-emoji">{item.icon}</span>
              <span class="rm-game-name">{GAMES[g].title}</span>
              {item.mark === 'played' ? <span class="rm-game-tick">✓</span> : null}
              {item.mark === 'next' ? <span class="rm-game-next">הבא</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LiveTop(props: { readonly link: RemoteLink }): JSX.Element {
  const { link } = props;
  const gameId = link.state?.round?.gameId;
  const elimination = gameId !== undefined && GAMES[gameId].mode === 'elimination';
  const rows = topFive(link.state, link.scores, elimination ? link.out : null);
  const looks = new Map((link.state?.players ?? []).map((p) => [p.id, p.look]));
  return (
    <section class="rm-live" data-testid="live">
      <div class="rm-sec-title">
        <span>🔴 בשידור חי</span>
        <span class="rm-live-count" data-testid="live-connected">
          {liveCountText(link.state, link.active)}
        </span>
      </div>
      <ol class="rm-top5" data-testid="top5">
        {rows.length === 0 ? <li class="rm-top5-empty">עוד אין נקודות…</li> : null}
        {rows.map((r) => (
          <li
            key={r.id}
            class={`rm-top5-row ${r.place === 1 && !r.out ? 'is-first' : ''} ${r.connected ? '' : 'is-away'} ${r.out ? 'is-out' : ''}`}
            data-testid="top5-row"
          >
            {/* like the TV: in an elimination round a place means something only once you are out */}
            <span class="rm-place">{elimination && !r.out && gameId !== undefined ? GAMES[gameId].emoji : r.place}</span>
            <Avatar look={looks.get(r.id)} size={26} ring />
            <span class="rm-name" dir="auto">
              {r.name}
            </span>
            {elimination ? (
              <span class={`rm-status ${r.out ? 'is-out' : 'is-in'}`}>{r.out ? 'בחוץ' : 'באוויר'}</span>
            ) : (
              <span class="rm-score" dir="ltr">
                {r.score.toLocaleString('he-IL')}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Players(props: { readonly link: RemoteLink }): JSX.Element {
  const players = props.link.state?.players ?? [];
  const { online } = connectedCount(props.link.state);
  return (
    <section class="rm-live" data-testid="players-panel">
      <div class="rm-sec-title">
        <span>👥 בחדר</span>
        <span class="rm-live-count">
          {players.length} שחקנים{online < players.length ? ` · ${online} מחוברים` : ''}
        </span>
      </div>
      {players.length === 0 ? (
        <p class="rm-top5-empty">עוד אף אחד… הקוד על המסך</p>
      ) : (
        <div class="rm-chips">
          {players.map((p) => (
            <span key={p.id} class={`rm-chip ${p.connected ? '' : 'is-away'}`}>
              <Avatar look={p.look} size={24} ring />
              <span dir="auto">{p.name}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/** The round's results, once the TV revealed the winner (the owner is not spoiled either). */
function RoundTop(props: { readonly link: RemoteLink }): JSX.Element {
  const res = props.link.state?.results ?? null;
  const revealed = res !== null && props.link.clock.now() >= res.revealAt;
  useEvery(500, res !== null && !revealed);
  if (res === null || !revealed) {
    return (
      <section class="rm-live" data-testid="round-top">
        <div class="rm-sec-title">
          <span>🥁 התוצאות</span>
        </div>
        <p class="rm-top5-empty">נחשפות עכשיו על המסך…</p>
      </section>
    );
  }
  const rows = [...res.rows].sort((a, b) => a.roundRank - b.roundRank).slice(0, 5);
  return (
    <section class="rm-live" data-testid="round-top">
      <div class="rm-sec-title">
        <span>🏆 {GAMES[res.gameId].title}</span>
        <span class="rm-live-count">נקודות בסיבוב</span>
      </div>
      <ol class="rm-top5">
        {rows.map((r) => (
          <li key={r.playerId} class={`rm-top5-row ${r.roundRank === 1 ? 'is-first' : ''}`}>
            <span class="rm-place">{r.roundRank}</span>
            <Avatar look={r.look} size={26} ring />
            <span class="rm-name" dir="auto">
              {r.name}
            </span>
            <span class="rm-score" dir="ltr">
              +{r.points.toLocaleString('he-IL')}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Standings(props: { readonly link: RemoteLink; readonly title: string }): JSX.Element {
  const players = [...(props.link.state?.players ?? [])].sort((a, b) => a.rank - b.rank).slice(0, 5);
  return (
    <section class="rm-live" data-testid="standings">
      <div class="rm-sec-title">
        <span>{props.title}</span>
      </div>
      <ol class="rm-top5">
        {players.map((p) => (
          <li key={p.id} class={`rm-top5-row ${p.rank === 1 ? 'is-first' : ''}`}>
            <span class="rm-place">{p.rank}</span>
            <Avatar look={p.look} size={26} ring />
            <span class="rm-name" dir="auto">
              {p.name}
            </span>
            <span class="rm-score" dir="ltr">
              {p.total.toLocaleString('he-IL')}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SheetFrame(props: { readonly title: string; readonly testId: string; readonly children: ComponentChildren; onClose(): void }): JSX.Element {
  return (
    <div class="rm-sheet-back" onClick={props.onClose} data-testid={`${props.testId}-back`}>
      <div class="rm-sheet" role="dialog" data-testid={props.testId} onClick={(e) => e.stopPropagation()}>
        <div class="rm-sheet-grip" />
        <header class="rm-sheet-head">
          <h2>{props.title}</h2>
          <button type="button" class="rm-x" aria-label="סגירה" onClick={props.onClose} data-testid={`${props.testId}-close`}>
            ✕
          </button>
        </header>
        <div class="rm-sheet-body kit-scroll">{props.children}</div>
      </div>
    </div>
  );
}

/** "Sure?": a second tap, or holding the button down. */
function ConfirmSheet(props: { readonly ask: Ask; onYes(): void; onClose(): void }): JSX.Element {
  const { ask } = props;
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const fire = (): void => {
    if (fired.current) return;
    fired.current = true;
    haptic.bump();
    props.onYes();
  };
  useEffect(
    () => () => {
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (armedAt === null) return undefined;
    const t = setTimeout(() => setArmedAt(null), 4_000);
    return () => clearTimeout(t);
  }, [armedAt]);
  const stopHold = (): void => {
    setHolding(false);
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  return (
    <SheetFrame title={ask.question} testId="confirm" onClose={props.onClose}>
      {ask.text !== undefined ? <p class="rm-confirm-text">{ask.text}</p> : null}
      <button
        type="button"
        class={`rm-btn rm-btn--wide rm-confirm-yes ${ask.danger ? 'rm-btn--red' : 'rm-btn--yellow'} ${armedAt !== null ? 'is-armed' : ''} ${holding ? 'is-holding' : ''}`}
        data-testid="confirm-yes"
        onPointerDown={(e) => {
          // a wobbling thumb stays on the button: only lifting it (or the browser cancelling) stops the hold
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // not capturable: fine
          }
          setHolding(true);
          if (holdTimer.current !== null) clearTimeout(holdTimer.current);
          holdTimer.current = setTimeout(fire, 700);
        }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onClick={() => {
          press();
          const t = performance.now();
          if (armedAt !== null && t - armedAt > 300) fire();
          else if (armedAt === null) setArmedAt(t);
        }}
      >
        <span class="rm-hold-fill" />
        <span class="rm-confirm-label">{armedAt !== null ? 'לחצו שוב לאישור' : `${ask.yes} · החזיקו או לחצו פעמיים`}</span>
      </button>
      <button type="button" class="rm-btn rm-btn--white rm-btn--wide" data-testid="confirm-no" onClick={props.onClose}>
        ביטול
      </button>
    </SheetFrame>
  );
}

function SheetRow(props: {
  readonly action: ControlAction | undefined;
  readonly label?: string;
  readonly icon?: string;
  readonly chevron?: boolean;
  readonly testId: string;
  onPress(): void;
}): JSX.Element | null {
  const a = props.action;
  if (a === undefined) return null;
  const toggle = a.kind === 'toggle';
  return (
    <button
      type="button"
      class={`rm-row ${a.kind === 'danger' ? 'is-danger' : ''} ${toggle && a.on === true ? 'is-on' : ''}`}
      disabled={!a.enabled}
      data-testid={props.testId}
      aria-pressed={toggle ? a.on === true : undefined}
      onClick={() => {
        press();
        props.onPress();
      }}
    >
      <span class="rm-row-icon">{props.icon ?? a.icon}</span>
      <span class="rm-row-label">{props.label ?? a.label}</span>
      {toggle ? (
        <span class={`rm-switch ${a.on === true ? 'is-on' : ''}`}>
          <i />
        </span>
      ) : props.chevron === true ? (
        <span class="rm-row-chev">‹</span>
      ) : null}
    </button>
  );
}

function Main(props: { readonly link: RemoteLink }): JSX.Element {
  const { link } = props;
  const model = link.model;
  const s = link.state;
  const tvDown = link.tv === 'offline';
  const serverDown = link.server !== 'online';
  const live = model !== null && link.tv === 'online' && !serverDown;
  const [sheet, setSheet] = useState<Sheet>('none');
  const [ask, setAsk] = useState<Ask | null>(null);
  const [selected, setSelected] = useState<GameId | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [lockedKey, setLockedKey] = useState<{ readonly key: string; readonly until: number } | null>(null);
  const flashN = useRef(0);
  useEvery(400, lockedKey !== null);

  const key = model?.key ?? 'none';
  useEffect(() => {
    setSelected(null);
    setLockedKey(null);
  }, [key]);
  // The TV's new model lands ~20 ms after a press, so the second tap of a double tap would be a fresh
  // press of the NEW screen's big button (skip the video, start the next game). Stamped during render,
  // like the TV's own key guard, so the very render that shows the new screen is already guarded.
  const lastBigAt = useRef(0);
  const screenAt = useRef(0);
  const screen = `${key}|${model?.primary ?? ''}|${s?.cutscene?.startedAt ?? ''}`;
  const lastScreen = useRef(screen);
  if (lastScreen.current !== screen) {
    lastScreen.current = screen;
    screenAt.current = Date.now();
  }
  const sinceBig = Date.now() - lastBigAt.current;
  const sinceScreen = Date.now() - screenAt.current;
  const bigCooling = sinceBig < BIG_AGAIN_MS || sinceScreen < BIG_AFTER_SCREEN_MS;
  useEvery(150, bigCooling);
  // a cutscene / a new screen closes what was open under it
  useEffect(() => {
    setAsk(null);
  }, [key, s?.cutscene?.startedAt]);

  const say = (r: RunResult): void => {
    flashN.current += 1;
    setFlash({ n: flashN.current, ok: r.ok, text: r.ok ? 'נשלח ✓' : r.text });
    if (!r.ok) haptic.fail();
  };
  useEffect(() => {
    if (flash === null) return undefined;
    const t = setTimeout(() => setFlash(null), flash.ok ? 1_400 : 3_000);
    return () => clearTimeout(t);
  }, [flash?.n]);

  const send = (id: ActionId, arg: string | undefined, confirmed: boolean): void => {
    void link.run(id, arg, confirmed).then(say);
  };
  /** A press of a model action: ask first when it needs it. */
  const tap = (a: ControlAction, arg?: string, overrideAsk?: string | null): void => {
    if (!a.enabled) return;
    const question = overrideAsk !== undefined ? overrideAsk : askFor(a, arg);
    if (question !== null) {
      setAsk({
        id: a.id,
        ...(arg !== undefined ? { arg } : {}),
        question,
        ...(a.confirmText !== undefined ? { text: a.confirmText } : {}),
        yes: a.confirmYes ?? 'כן',
        danger: a.kind === 'danger' || a.id === 'reset',
      });
      return;
    }
    send(a.id, arg, false);
  };
  const toggle = (a: ControlAction | undefined): void => {
    if (a === undefined) return;
    send(a.id, a.on === true ? 'off' : 'on', false);
  };

  const big = live && model !== null ? bigButton(model, selected) : null;
  const lockId = `${key}:${big?.id ?? ''}:${big?.arg ?? ''}`;
  const bigLocked = lockedKey !== null && lockedKey.key === lockId && Date.now() < lockedKey.until;
  const pressBig = (): void => {
    if (big === null || !big.enabled || bigLocked || model === null) return;
    const t = Date.now();
    if (t - lastBigAt.current < BIG_AGAIN_MS || t - screenAt.current < BIG_AFTER_SCREEN_MS) return;
    lastBigAt.current = t;
    press();
    const a = findAction(model, big.id);
    if (a === undefined) return;
    // the same press again is a double tap until the screen or the step changes (or 1.5 s pass)
    setLockedKey({ key: lockId, until: Date.now() + 1_500 });
    if (big.ask !== null) {
      setLockedKey(null);
      setAsk({
        id: big.id,
        ...(big.arg !== undefined ? { arg: big.arg } : {}),
        question: big.ask,
        ...(big.askText !== undefined ? { text: big.askText } : {}),
        yes: big.askYes ?? 'כן',
        danger: big.kind === 'danger' || big.id === 'reset',
      });
      return;
    }
    send(big.id, big.arg, false);
  };

  const phase = s?.phase ?? null;
  const running = phase === 'intro' || phase === 'countdown' || phase === 'playing';
  const between = phase === 'lobby' || phase === 'results';
  const secondary = live && model !== null ? secondaryActions(model, big).slice(0, 2) : [];
  const act = (id: ActionId): ControlAction | undefined => (model !== null ? findAction(model, id) : undefined);
  const cutAction = act('cutscene');
  const kickAction = act('kick');
  /** The dolls of the players in the kick list (the action model only carries ids and names). */
  const kickLooks = new Map((link.state?.players ?? []).map((p) => [p.id, p.look]));

  // the top half is for reading, the bottom half (the thumb's reach) for pressing
  let mid: JSX.Element | null = null;
  if (running) mid = <LiveTop link={link} />;
  else if (phase === 'results') mid = <RoundTop link={link} />;
  else if (phase === 'final') mid = <Standings link={link} title="🏆 הדירוג הסופי" />;
  else if (phase === 'lobby') mid = s !== null && (s.played.length > 0 || s.results !== null) ? <Standings link={link} title="🏅 הדירוג עד עכשיו" /> : <Players link={link} />;
  const picker =
    between && model !== null ? (
      <Picker model={model} selected={selected} enabled={live} onPick={(g) => setSelected((cur) => (cur === g ? null : g))} />
    ) : null;

  return (
    <div class={`rm-page rm-main ${live ? '' : 'is-dead'}`} data-testid="main" data-phase={phase ?? 'none'}>
      <Header link={link} />
      {serverDown ? (
        <div class="rm-banner rm-banner--bad" data-testid="server-down">
          📡 אין חיבור לשרת. מתחברים מחדש…
        </div>
      ) : tvDown ? (
        <div class="rm-banner rm-banner--bad" data-testid="tv-down">
          📺 המסך לא מחובר - פתחו את עמוד הטלוויזיה
        </div>
      ) : (
        <div class="rm-hint" data-testid="hint">
          {model?.hint ?? 'מחכים למסך…'}
        </div>
      )}

      <div class="rm-mid">{mid}</div>

      {tvDown && !serverDown ? null : picker}

      <div class={`rm-flash ${flash === null ? '' : flash.ok ? 'is-ok' : 'is-bad'}`} data-testid="flash" role="status">
        {flash?.text ?? ''}
      </div>

      {tvDown && !serverDown ? (
        <div class="rm-rescue" data-testid="rescue">
          <button
            type="button"
            class="rm-btn rm-btn--red rm-btn--wide"
            data-testid="rescue-end"
            disabled={!running}
            onClick={() => {
              press();
              setAsk({ id: 'end-round', question: 'לסיים את הסיבוב?', yes: 'לסיים', danger: true, rescue: 'endRound' });
            }}
          >
            ⏹ סיום סיבוב
          </button>
          <button
            type="button"
            class="rm-btn rm-btn--white rm-btn--wide"
            data-testid="rescue-lobby"
            disabled={phase !== 'results' && phase !== 'final'}
            onClick={() => {
              press();
              void link.rescue('lobby').then(say);
            }}
          >
            🏠 חזרה ללובי
          </button>
        </div>
      ) : (
        <button
          type="button"
          class={`rm-big ${big?.kind === 'danger' ? 'rm-big--danger' : big?.ask !== null && big?.ask !== undefined ? 'rm-big--ask' : ''}`}
          disabled={big === null || !big.enabled || bigLocked || bigCooling}
          data-testid="big"
          data-action={big?.id ?? ''}
          onClick={pressBig}
        >
          <span class="rm-big-icon">{big?.icon ?? '⏳'}</span>
          <span class="rm-big-label">{big?.label ?? (live ? 'אין מה ללחוץ עכשיו' : 'מחכים למסך…')}</span>
        </button>
      )}

      <nav class="rm-tray">
        {secondary.map((a) => (
          <button
            type="button"
            key={a.id}
            class={`rm-tray-btn ${a.kind === 'danger' ? 'is-danger' : ''}`}
            data-testid={`sec-${a.id}`}
            onClick={() => {
              press();
              tap(a);
            }}
          >
            <span class="rm-tray-icon">{a.icon}</span>
            <span class="rm-tray-label">{a.label}</span>
          </button>
        ))}
        <button
          type="button"
          class="rm-tray-btn"
          data-testid="tray-cutscenes"
          disabled={!live || cutAction?.enabled !== true}
          onClick={() => {
            press();
            setSheet('cutscenes');
          }}
        >
          <span class="rm-tray-icon">🎬</span>
          <span class="rm-tray-label">סרטון</span>
        </button>
        <button
          type="button"
          class="rm-tray-btn"
          data-testid="tray-more"
          onClick={() => {
            press();
            setSheet('more');
          }}
        >
          <span class="rm-tray-icon">☰</span>
          <span class="rm-tray-label">עוד</span>
        </button>
      </nav>

      {sheet === 'more' ? (
        <SheetFrame title="עוד" testId="more" onClose={() => setSheet('none')}>
          <div class="rm-rows">
            <SheetRow action={cutAction} label="סרטונים" chevron testId="more-cutscenes" onPress={() => setSheet('cutscenes')} />
            <SheetRow
              action={act('cutscene-skip')}
              testId="more-skip"
              onPress={() => {
                setSheet('none');
                const a = act('cutscene-skip');
                if (a !== undefined) tap(a);
              }}
            />
            <SheetRow action={act('auto-cutscenes')} testId="more-auto" onPress={() => toggle(act('auto-cutscenes'))} />
            <SheetRow
              action={act('replay')}
              testId="more-replay"
              onPress={() => {
                setSheet('none');
                const a = act('replay');
                if (a !== undefined) tap(a);
              }}
            />
            <SheetRow
              action={act('podium')}
              label="לפודיום הסופי"
              icon="🏆"
              testId="more-podium"
              onPress={() => {
                setSheet('none');
                const a = act('podium');
                if (a !== undefined) tap(a, undefined, askFor(a) ?? 'לעבור לפודיום הסופי?');
              }}
            />
            <SheetRow action={kickAction} chevron testId="more-kick" onPress={() => setSheet('players')} />
            <SheetRow action={act('mute')} testId="more-mute" onPress={() => toggle(act('mute'))} />
            <SheetRow action={act('calm')} testId="more-calm" onPress={() => toggle(act('calm'))} />
            <SheetRow
              action={act('reset')}
              label="איפוס התחרות"
              icon="♻️"
              testId="more-reset"
              onPress={() => {
                setSheet('none');
                const a = act('reset');
                if (a !== undefined) tap(a);
              }}
            />
            <button
              type="button"
              class="rm-row rm-row--quiet"
              data-testid="logout"
              onClick={() => {
                press();
                setSheet('none');
                link.logout();
              }}
            >
              <span class="rm-row-icon">🚪</span>
              <span class="rm-row-label">התנתק מהשלט</span>
            </button>
          </div>
        </SheetFrame>
      ) : null}

      {sheet === 'cutscenes' && cutAction !== undefined ? (
        <SheetFrame title="🎬 סרטונים" testId="cutscenes" onClose={() => setSheet('none')}>
          <div class="rm-rows">
            {(cutAction.items ?? []).map((item) => (
              <button
                type="button"
                key={item.arg}
                class="rm-row"
                disabled={!item.enabled || !cutAction.enabled}
                data-testid={`cut-${item.arg}`}
                onClick={() => {
                  press();
                  setSheet('none');
                  send('cutscene', item.arg, false);
                }}
              >
                <span class="rm-row-icon">▶</span>
                <span class="rm-row-label">{item.label}</span>
              </button>
            ))}
          </div>
        </SheetFrame>
      ) : null}

      {sheet === 'players' && kickAction !== undefined ? (
        <SheetFrame title="🚪 להוציא שחקן" testId="players" onClose={() => setSheet('none')}>
          <div class="rm-rows">
            {(kickAction.items ?? []).length === 0 ? <p class="rm-confirm-text">אין שחקנים בחדר</p> : null}
            {(kickAction.items ?? []).map((item) => (
              <button
                type="button"
                key={item.arg}
                class={`rm-row ${item.mark === 'away' ? 'is-away' : ''}`}
                data-testid="kick-row"
                data-name={item.label}
                onClick={() => {
                  press();
                  setSheet('none');
                  tap(kickAction, item.arg);
                }}
              >
                <span class="rm-row-icon">
                  <Avatar look={kickLooks.get(item.arg)} size={28} ring />
                </span>
                <span class="rm-row-label" dir="auto">
                  {item.label}
                  {item.mark === 'away' ? ' 💤' : ''}
                </span>
                <span class="rm-row-chev">✕</span>
              </button>
            ))}
          </div>
        </SheetFrame>
      ) : null}

      {ask !== null ? (
        <ConfirmSheet
          key={`${ask.id}:${ask.arg ?? ''}`}
          ask={ask}
          onClose={() => setAsk(null)}
          onYes={() => {
            const a = ask;
            setAsk(null);
            if (a.rescue === 'endRound') void link.rescue('endRound').then(say);
            else send(a.id, a.arg, true);
          }}
        />
      ) : null}
    </div>
  );
}

export function App(): JSX.Element {
  const link = useRemoteLink();
  const ref = useRef(link);
  ref.current = link;
  useEffect(() => {
    window.__remote = {
      phase: () => ref.current.phase,
      tv: () => ref.current.tv,
      server: () => ref.current.server,
      model: () => ref.current.model,
    };
    void keepAwake();
    const again = (): void => void keepAwake();
    window.addEventListener('pointerdown', again, true);
    return () => window.removeEventListener('pointerdown', again, true);
  }, []);
  switch (link.phase) {
    case 'locked':
      return <Unlock link={link} />;
    case 'checking':
      // a re-attach after a reconnect keeps the main screen; a first check shows a spinner (or the wait)
      if (link.state !== null) return <Main link={link} />;
      return link.retryAt !== null ? <Unlock link={link} /> : <Checking />;
    case 'waiting':
      return <Waiting link={link} />;
    case 'choose':
      return <Choose link={link} />;
    case 'attached':
      return <Main link={link} />;
    default: {
      const _exhaustive: never = link.phase;
      throw new Error(`Unhandled phase: ${String(_exhaustive)}`);
    }
  }
}

function Checking(): JSX.Element {
  return (
    <div class="rm-page rm-waiting" data-testid="checking">
      <Title />
      <div class="rm-card">
        <p class="rm-card-big">מתחברים…</p>
        <div class="rm-dots-loader">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

