/** Every phone screen, from the join form to the final podium. Pure render from props. */
import { useEffect, useRef, useState } from 'preact/hooks';

import { findCutscene } from '../../../shared/cutscenes';
import { GAMES, NAME_MAX_LEN, ROOM_CODE_LEN } from '../../../shared/protocol';
import { roundTime } from '../../../shared/round-clock';
import { preloadGame } from '../games/registry';
import { isMuted, setMuted, sfx, unlockAudio } from '../kit/audio';
import { findPublicFile } from '../kit/files';
import { haptic, vibrate } from '../kit/haptics';
import { isStandalone, keepAwake } from '../kit/mobile';
import { playTrack, stopTrack } from '../kit/music';
import { goFullscreen } from './device';
import { dismissTip, isTipDismissed } from './identity';
import { Avatar, Confetti, fmt, medal, standings, useCountUp, useTick } from './ui';

import type { JSX } from 'preact';
import type { RoomState, RoundPublic, RoundResults } from '../../../shared/protocol';
import type { PlayerController, Snapshot } from './controller';

const DEFAULT_PHONE_TEXT = '👀 תסתכלו על הטלוויזיה!';
const GO_FLASH_MS = 900;

function Dots(): JSX.Element {
  return (
    <span class="pp-dots" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

// ───────────────────────────── Boot / Join ─────────────────────────────

const SLOW_BOOT_MS = 6_000;

export function BootScreen(): JSX.Element {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_BOOT_MS);
    return (): void => clearTimeout(id);
  }, []);
  return (
    <div class="pp-screen pp-center">
      <div class="pp-logo-emoji pp-bob">🎉</div>
      <div class="pp-title">מתחברים למסיבה<Dots /></div>
      {slow ? <div class="pp-text">לוקח רגע… בדקו שיש Wi-Fi או אינטרנט, ממשיכים לנסות</div> : null}
    </div>
  );
}

/** Grapheme-safe cut: an emoji (or a letter with niqqud) is never split in half. */
function cutName(raw: string): string {
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const parts = Array.from(seg.segment(raw), (x) => x.segment);
    return parts.length > NAME_MAX_LEN ? parts.slice(0, NAME_MAX_LEN).join('') : raw;
  } catch {
    const cps = Array.from(raw);
    return cps.length > NAME_MAX_LEN ? cps.slice(0, NAME_MAX_LEN).join('') : raw;
  }
}

export function JoinScreen(props: { readonly ctl: PlayerController; readonly snap: Snapshot }): JSX.Element {
  const { ctl, snap } = props;
  const nameRef = useRef<HTMLInputElement>(null);
  const busy = snap.status === 'joining';
  const [shake, setShake] = useState(0);

  useEffect(() => {
    if (snap.joinError !== null) {
      setShake((n) => n + 1);
      haptic.fail();
    }
  }, [snap.joinError]);

  function submit(e?: Event): void {
    e?.preventDefault();
    if (busy) return;
    // THE user gesture: sound, fullscreen (Android) and the wake lock all need it.
    unlockAudio();
    goFullscreen();
    void keepAwake();
    nameRef.current?.blur();
    sfx.pop(1.2);
    haptic.tap();
    ctl.join(snap.code, nameRef.current?.value ?? snap.name);
  }

  const showCodeInput = !snap.codeLocked;
  return (
    <form class="pp-screen pp-join" onSubmit={submit} autocomplete="off">
      <div class="pp-join-hero">
        <div class="pp-join-faces" aria-hidden="true">
          <Avatar index={0} size={58} class="pp-float-a" />
          <Avatar index={8} size={74} class="pp-float-b" />
          <Avatar index={4} size={58} class="pp-float-c" />
        </div>
        <h1 class="pp-brand">
          פארטי <span>ארנה</span>
        </h1>
        <div class="pp-sub">5 משחקים · מנצח בכל סיבוב · פרס אמיתי 🏆</div>
      </div>

      <A2hsTip />
      <div class="pp-join-card">
        {showCodeInput ? (
          <label class="pp-field">
            <span class="pp-label">קוד החדר (מהטלוויזיה)</span>
            <input
              class="pp-input pp-code-input"
              value={snap.code}
              onInput={(e) => ctl.setCode((e.currentTarget as HTMLInputElement).value)}
              maxLength={ROOM_CODE_LEN}
              placeholder="ABCD"
              autocapitalize="characters"
              autocomplete="off"
              autocorrect="off"
              spellcheck={false}
              enterKeyHint="next"
              inputMode="text"
              dir="ltr"
            />
          </label>
        ) : (
          <div class="pp-room-chip">
            <span>חדר</span>
            <b dir="ltr">{snap.code}</b>
          </div>
        )}
        <label class="pp-field">
          <span class="pp-label">איך קוראים לך?</span>
          <input
            ref={nameRef}
            class="pp-input pp-name-input"
            value={snap.name}
            onInput={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              const v = cutName(el.value);
              if (v !== el.value) el.value = v;
              ctl.setName(v);
            }}
            // maxLength counts UTF-16 units (an emoji is 2, a family emoji 8): only a loose cap
            // here, the real cut is cutName() in graphemes, like the server's.
            maxLength={NAME_MAX_LEN * 8}
            placeholder="השם שלך"
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
            spellcheck={false}
            enterKeyHint="go"
            dir="auto"
          />
        </label>
        {snap.joinError !== null ? (
          <div class="pp-error" key={shake} role="alert">
            {snap.joinError}
          </div>
        ) : null}
        <button class={`pp-btn pp-btn-go ${busy ? 'is-busy' : ''}`} type="submit" disabled={busy}>
          {busy ? (
            <span>
              נכנסים<Dots />
            </span>
          ) : (
            'יאללה!'
          )}
        </button>
      </div>
    </form>
  );
}

// ───────────────────────────── Lobby ─────────────────────────────

function isIphoneSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPod/.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
}

/**
 * iPhone only (no Fullscreen API): "Add to Home Screen" is the only way to lose
 * Safari's bars. Shown on the join screen, BEFORE joining, on purpose: an iPhone
 * home-screen app has its own storage, so a guest who adds it after joining
 * would come back as a second player. Dismissible, in the flow (never over a button).
 */
function A2hsTip(): JSX.Element | null {
  const [show, setShow] = useState(() => isIphoneSafari() && !isStandalone() && !isTipDismissed());
  if (!show) return null;
  return (
    <button
      type="button"
      class="pp-tip"
      onClick={() => {
        dismissTip();
        setShow(false);
      }}
    >
      <span class="pp-tip-icon">⬆️</span>
      <span class="pp-tip-text">
        למסך מלא בלי שורת הכתובת: <b>שיתוף</b> ← <b>הוספה למסך הבית</b>, ונכנסים משם
      </span>
      <span class="pp-tip-x" aria-label="סגירה">✕</span>
    </button>
  );
}

function MuteButton(): JSX.Element {
  const [muted, setM] = useState(isMuted());
  return (
    <button
      type="button"
      class="pp-mute"
      aria-label={muted ? 'הפעלת צלילים' : 'השתקה'}
      onClick={() => {
        setMuted(!muted);
        setM(!muted);
        if (muted) sfx.pop();
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

function Movement(props: { readonly rank: number; readonly prev: number | null }): JSX.Element | null {
  const { rank, prev } = props;
  if (prev === null) return null;
  if (prev > rank) return <span class="pp-move is-up">▲{prev - rank}</span>;
  if (prev < rank) return <span class="pp-move is-down">▼{rank - prev}</span>;
  return <span class="pp-move is-same">●</span>;
}

function StandingsList(props: { readonly state: RoomState; readonly me: string; readonly limit?: number }): JSX.Element {
  const rows = standings(props.state.players);
  const prevById = new Map<string, number | null>();
  for (const r of props.state.results?.rows ?? []) prevById.set(r.playerId, r.prevRank);
  const shown = props.limit !== undefined ? rows.slice(0, props.limit) : rows;
  return (
    <ol class="pp-standings kit-scroll">
      {shown.map(({ player, rank }) => (
        <li key={player.id} class={player.id === props.me ? 'is-me' : ''}>
          <span class="pp-st-rank">{medal(rank) || rank}</span>
          <Avatar index={player.avatar} size={30} />
          <span class="pp-st-name">{player.name}</span>
          {prevById.has(player.id) ? <Movement rank={rank} prev={prevById.get(player.id) ?? null} /> : null}
          <span class="pp-st-total">{fmt(player.total)}</span>
        </li>
      ))}
    </ol>
  );
}

export function LobbyScreen(props: { readonly snap: Snapshot; readonly state: RoomState }): JSX.Element {
  const { state, snap } = props;
  const me = state.players.find((p) => p.id === snap.playerId);
  const others = state.players.filter((p) => p.id !== snap.playerId);
  const played = state.played.length > 0;
  const mine = standings(state.players).find((s) => s.player.id === snap.playerId);

  if (me === undefined) return <BootScreen />;
  return (
    <div class="pp-screen pp-lobby">
      <MuteButton />
      <div class="pp-me">
        <div class="pp-me-avatar">
          <Avatar index={me.avatar} size={played ? 76 : 112} class="pp-bob" />
          <span class="pp-me-glow" />
        </div>
        <div class="pp-me-name">{me.name}</div>
        {played && mine !== undefined ? (
          <div class="pp-me-stats">
            <span class="pp-pill pp-pill-yellow">
              {medal(mine.rank)} מקום {mine.rank}
            </span>
            <span class="pp-pill">⭐ {fmt(me.total)} נק׳</span>
          </div>
        ) : (
          <div class="pp-me-in">נכנסת! 🎉</div>
        )}
      </div>

      {played ? (
        <div class="pp-panel pp-grow">
          <div class="pp-panel-title">הטבלה עד עכשיו</div>
          <StandingsList state={state} me={snap.playerId ?? ''} />
        </div>
      ) : (
        <div class="pp-panel pp-grow">
          <div class="pp-panel-title">
            כבר כאן <span class="pp-count">{state.players.length}</span>
          </div>
          {others.length === 0 ? (
            <div class="pp-empty">עוד אף אחד… תגידו לחברים לסרוק את הקוד 📱</div>
          ) : (
            <div class="pp-chips kit-scroll">
              {others.map((p) => (
                <span key={p.id} class={`pp-chip ${p.connected ? '' : 'is-off'}`}>
                  <Avatar index={p.avatar} size={26} />
                  <span>{p.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div class="pp-waiting">
        <span class="pp-eq" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>{played ? 'מחכים לסיבוב הבא' : 'מחכים שהמנחה יתחיל'}<Dots /></span>
      </div>
    </div>
  );
}

// ───────────────────────────── Intro / countdown / late ─────────────────────────────

export function IntroScreen(props: { readonly round: RoundPublic }): JSX.Element {
  const game = GAMES[props.round.gameId];
  useEffect(() => {
    preloadGame(props.round.gameId);
    sfx.whoosh();
  }, [props.round.gameId]);
  return (
    <div class={`pp-screen pp-intro pp-game-${game.id}`}>
      <div class="pp-pill pp-pill-dim">סיבוב {props.round.number}</div>
      <div class="pp-intro-emoji">{game.emoji}</div>
      <h1 class="pp-intro-title">{game.title}</h1>
      <p class="pp-intro-text">{game.instructions}</p>
      <div class="pp-ready">
        מתכוננים<Dots />
      </div>
    </div>
  );
}

/** Opaque 3-2-1 over the (frozen) game, synced to round.startAt on the server clock; then a GO flash. */
export function CountdownOverlay(props: { readonly ctl: PlayerController; readonly round: RoundPublic }): JSX.Element | null {
  const t = roundTime(props.round, props.ctl.now());
  const done = t.elapsedMs > GO_FLASH_MS;
  useTick(0, !done);
  const until = -t.elapsedMs;
  const n = Math.max(1, Math.min(3, Math.ceil(until / 1000)));
  const go = until <= 0;
  const last = useRef<number | 'go' | null>(null);
  const key: number | 'go' = go ? 'go' : n;
  useEffect(() => {
    if (last.current === key || done) return;
    last.current = key;
    if (key === 'go') {
      sfx.go();
      haptic.success();
    } else {
      sfx.tick(key === 1 ? 1.5 : 1);
      haptic.tap();
    }
  }, [key, done]);
  const game = GAMES[props.round.gameId];
  if (done) return null;
  return (
    <div class={`pp-countdown ${go ? 'is-go' : ''}`}>
      <div class="pp-cd-game">
        {game.emoji} {game.title}
      </div>
      <div class="pp-cd-num" key={String(key)} dir="ltr">
        {go ? 'GO!' : n}
      </div>
      {!go ? <div class="pp-cd-sub">מוכנים?</div> : null}
    </div>
  );
}

export function LateScreen(props: { readonly round: RoundPublic }): JSX.Element {
  const game = GAMES[props.round.gameId];
  return (
    <div class="pp-screen pp-center">
      <div class="pp-big-emoji pp-bob">⏳</div>
      <div class="pp-title">הסיבוב כבר התחיל</div>
      <div class="pp-text">
        עכשיו משחקים {game.emoji} {game.title}.
        <br />
        את/ה בפנים מהסיבוב הבא!
      </div>
      <div class="pp-tv-hint">📺 בינתיים תסתכלו על הטלוויזיה</div>
    </div>
  );
}

// ───────────────────────────── Cutscene ─────────────────────────────

export function CutsceneOverlay(props: { readonly id: string }): JSX.Element {
  const def = findCutscene(props.id);
  const text = def?.phoneText ?? DEFAULT_PHONE_TEXT;
  useEffect(() => {
    haptic.bump();
  }, [props.id]);
  return (
    <div class="pp-cutscene" role="alert">
      <div class="pp-tv">
        <div class="pp-tv-screen">
          <div class="pp-eyes">
            <span class="pp-eye">
              <i />
            </span>
            <span class="pp-eye">
              <i />
            </span>
          </div>
        </div>
        <div class="pp-tv-legs" />
      </div>
      <div class="pp-cut-text">{text}</div>
      <div class="pp-cut-sub">הטלפון מחכה בשבילך ⏸</div>
    </div>
  );
}

/** "ממשיכים!" 3-2-1 after a mid-game cutscene, from roundTime().resumeInMs. */
export function ResumeOverlay(props: { readonly ctl: PlayerController; readonly round: RoundPublic }): JSX.Element | null {
  const t = roundTime(props.round, props.ctl.now());
  const n = Math.ceil(t.resumeInMs / 1000);
  useTick(0, n > 0);
  const last = useRef(-1);
  useEffect(() => {
    if (n === last.current) return;
    const prev = last.current;
    last.current = n;
    if (n > 0) sfx.tick(n === 1 ? 1.5 : 1);
    else if (prev > 0) {
      sfx.go();
      haptic.bump();
    }
  }, [n]);
  if (n <= 0) return null;
  return (
    <div class="pp-resume">
      <div class="pp-resume-label">ממשיכים!</div>
      <div class="pp-cd-num" key={n}>
        {n}
      </div>
      <div class="pp-cd-sub">בדיוק מאיפה שעצרנו</div>
    </div>
  );
}

// ───────────────────────────── After the round ─────────────────────────────

export function SendingScreen(props: { readonly score: number; readonly acked: boolean }): JSX.Element {
  return (
    <div class="pp-screen pp-center">
      <div class="pp-label-big">הניקוד שלך</div>
      <div class="pp-score-big">⭐ {fmt(props.score)}</div>
      <div class={`pp-send ${props.acked ? 'is-done' : ''}`}>
        {props.acked ? (
          <span>✓ נשלח!</span>
        ) : (
          <span>
            📤 שולחים<Dots />
          </span>
        )}
      </div>
    </div>
  );
}

export function SuspenseScreen(): JSX.Element {
  // Whoever wins sees the prize picture in a few seconds: have it in the cache by then.
  useEffect(() => {
    const url = prizeUrl();
    if (url === null) return;
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
    } catch {
      // ignore
    }
  }, []);
  return (
    <div class="pp-screen pp-center pp-suspense">
      <div class="pp-spot" aria-hidden="true" />
      <div class="pp-drum">🥁</div>
      <div class="pp-title pp-xl">מי זכה?</div>
      <div class="pp-tv-hint">📺 תסתכלו על הטלוויזיה</div>
    </div>
  );
}

function prizeUrl(): string | null {
  return findPublicFile('/assets/host/prize.jpg', ['jpg', 'jpeg', 'png', 'webp']);
}

export function WinScreen(props: { readonly onDone: () => void }): JSX.Element {
  const [imgOk, setImgOk] = useState(prizeUrl() !== null);
  const url = prizeUrl();
  useEffect(() => {
    playTrack('victory', { volume: 0.9 });
    sfx.cheer();
    vibrate([300, 120, 300, 120, 600, 150, 200, 80, 200]);
    return (): void => stopTrack('victory', 900);
  }, []);
  return (
    <div class="pp-screen pp-win">
      <div class="pp-rays" aria-hidden="true" />
      <Confetti bursts={5} intensity={1.3} />
      <div class="pp-win-trophy">🏆</div>
      <h1 class="pp-win-title">זכית בשימי אנג׳ל!</h1>
      <div class="pp-prize">
        {imgOk && url !== null ? (
          <img src={url} alt="הפרס" onError={() => setImgOk(false)} draggable={false} />
        ) : (
          <div class="pp-prize-ph">
            <span>👼</span>
          </div>
        )}
        <span class="pp-prize-shine" />
      </div>
      <div class="pp-win-go">לך לקחת את הפרס!</div>
      <button type="button" class="pp-btn pp-btn-ghost" onClick={props.onDone}>
        לתוצאות שלי ←
      </button>
    </div>
  );
}

export function RevealScreen(props: { readonly results: RoundResults; readonly onDone: () => void }): JSX.Element {
  // Exactly one winner whenever anybody scored (the server never names two).
  const winner = props.results.rows.find((r) => r.playerId === props.results.winnerIds[0]);
  const second = props.results.rows.find((r) => r.roundRank === 2);
  const byTime = winner !== undefined && second !== undefined && second.raw === winner.raw;
  useEffect(() => {
    if (winner !== undefined) sfx.cheer();
    else sfx.fail();
    haptic.bump();
  }, []);
  return (
    <div class="pp-screen pp-center pp-reveal" onClick={props.onDone}>
      {winner !== undefined ? (
        <>
          <div class="pp-label-big">הזוכה בסיבוב:</div>
          <div class="pp-reveal-faces">
            <div class="pp-reveal-face">
              <span class="pp-crown">👑</span>
              <Avatar index={winner.avatar} size={128} />
            </div>
          </div>
          <div class="pp-reveal-name">{winner.name}</div>
          <div class="pp-text">לוקח/ת הביתה שימי אנג׳ל 👼 מחיאות כפיים!</div>
          {byTime ? <div class="pp-earlier">⏱ אותו ניקוד, מי שהגיע אליו קודם מנצח</div> : null}
          <Confetti bursts={1} intensity={0.5} />
        </>
      ) : (
        <>
          <div class="pp-big-emoji">🤷</div>
          <div class="pp-title">אף אחד לא קלע הפעם</div>
          <div class="pp-text">השימי נשאר על המדף… בסיבוב הבא!</div>
        </>
      )}
    </div>
  );
}

export function ResultsScreen(props: { readonly results: RoundResults; readonly me: string }): JSX.Element {
  const { results } = props;
  const game = GAMES[results.gameId];
  const row = results.rows.find((r) => r.playerId === props.me);
  const points = useCountUp(row?.points ?? 0, 1400, 300);
  const total = useCountUp(row?.total ?? 0, 1400, 300, row !== undefined ? row.total - row.points : 0);
  // roundRank is the server's strict position (1..n): equal raw scores are already ordered by who got there first.
  const byRound = [...results.rows].sort((a, b) => a.roundRank - b.roundRank);
  const top3 = byRound.slice(0, 3);
  const won = row !== undefined && results.winnerIds[0] === row.playerId;
  const sameRaw = (a: (typeof byRound)[number] | undefined, b: (typeof byRound)[number] | undefined): boolean =>
    a !== undefined && b !== undefined && a.raw > 0 && a.raw === b.raw;
  const mineAt = row === undefined ? -1 : byRound.indexOf(row);
  const above = mineAt > 0 ? byRound[mineAt - 1] : undefined;
  const below = mineAt >= 0 ? byRound[mineAt + 1] : undefined;
  useEffect(() => {
    if (row !== undefined && row.points > 0) sfx.coin(1.2);
  }, []);
  return (
    <div class="pp-screen pp-results">
      <div class="pp-res-head">
        <span class="pp-pill pp-pill-dim">
          {game.emoji} {game.title} · סיבוב {results.roundNumber}
        </span>
      </div>
      {row !== undefined ? (
        <div class={`pp-res-card ${won ? 'is-winner' : ''}`}>
          <div class="pp-res-rank">
            {row.raw <= 0 ? 'לא קלעת הפעם 🙈' : `${won ? '🏆 ' : medal(row.roundRank)}מקום ${row.roundRank} בסיבוב`}
          </div>
          <div class="pp-res-raw">⭐ {fmt(row.raw)} במשחק</div>
          {sameRaw(above, row) ? (
            <div class="pp-earlier">
              ⏱ אותו ניקוד כמו <bdi>{above?.name}</bdi>, שהגיע/ה אליו קודם
            </div>
          ) : sameRaw(row, below) ? (
            <div class="pp-earlier">
              ⏱ הגעת לניקוד לפני <bdi>{below?.name}</bdi>
            </div>
          ) : null}
          <div class="pp-res-points" dir="ltr">
            +{fmt(points)}
          </div>
          <div class="pp-res-points-l">נקודות</div>
          <div class="pp-res-grid">
            <div>
              <span class="pp-res-k">סה״כ</span>
              <span class="pp-res-v">{fmt(total)}</span>
            </div>
            <div>
              <span class="pp-res-k">בטבלה</span>
              <span class="pp-res-v">
                #{row.rank} <Movement rank={row.rank} prev={row.prevRank} />
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div class="pp-res-card">
          <div class="pp-res-rank">לא שיחקת בסיבוב הזה</div>
          <div class="pp-text">בסיבוב הבא גם את/ה בפנים 💪</div>
        </div>
      )}
      <div class="pp-panel">
        <div class="pp-panel-title">הטופ של הסיבוב</div>
        <ol class="pp-top3">
          {top3.map((r, i) => (
            <li key={r.playerId} class={r.playerId === props.me ? 'is-me' : ''}>
              <span class="pp-st-rank">{r.raw > 0 ? medal(r.roundRank) || r.roundRank : '–'}</span>
              <Avatar index={r.avatar} size={30} />
              <span class="pp-st-name">{r.name}</span>
              {sameRaw(r, byRound[i + 1]) ? <span class="pp-earlier-chip">⏱ קודם</span> : null}
              <span class="pp-st-total">⭐ {fmt(r.raw)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ───────────────────────────── Final ─────────────────────────────

const PLACE_WORD = ['', 'ראשון', 'שני', 'שלישי'];

export function FinalScreen(props: { readonly state: RoomState; readonly me: string; readonly active: boolean }): JSX.Element {
  const rows = standings(props.state.players);
  const mine = rows.find((r) => r.player.id === props.me);
  const rank = mine?.rank ?? rows.length;
  const podium = rank <= 3 && (mine?.player.total ?? 0) > 0;
  const total = useCountUp(mine?.player.total ?? 0, 1600, 200);
  const celebrated = useRef(false);
  useEffect(() => {
    if (!props.active || celebrated.current) return;
    celebrated.current = true;
    if (podium) {
      sfx.fanfare();
      vibrate([200, 100, 200, 100, 500]);
    } else {
      sfx.success();
      haptic.success();
    }
  }, [props.active, podium]);
  const top = rows.slice(0, 3);
  return (
    <div class={`pp-screen pp-final ${podium ? 'is-podium' : ''}`}>
      {podium ? <div class="pp-rays" aria-hidden="true" /> : null}
      {props.active && podium ? <Confetti bursts={4} /> : null}
      <div class="pp-pill pp-pill-dim">🏁 הגמר</div>
      <div class="pp-final-medal">{podium ? medal(rank) : '💜'}</div>
      <div class="pp-final-place">{podium ? `מקום ${PLACE_WORD[rank] ?? rank}!` : `מקום ${rank} מתוך ${rows.length}`}</div>
      <div class="pp-score-big">⭐ {fmt(total)} נק׳</div>
      <div class="pp-text pp-final-line">
        {rank === 1 && podium
          ? 'אלופ/ת הערב! אין עליך 👑'
          : podium
            ? 'על הפודיום! כל הכבוד 🎉'
            : 'איזה ערב! תודה ששיחקת איתנו 🥳'}
      </div>
      <div class="pp-mini-podium">
        {[1, 0, 2].map((i) => {
          const row = top[i];
          if (row === undefined) return <div key={i} class="pp-mp-col is-empty" />;
          const p = row.player;
          return (
            <div key={p.id} class={`pp-mp-col pp-mp-${i + 1} ${p.id === props.me ? 'is-me' : ''}`}>
              <Avatar index={p.avatar} size={i === 0 ? 52 : 42} />
              <span class="pp-mp-name">{p.name}</span>
              <span class="pp-mp-block">{row.rank}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────── Kicked / closed / banner ─────────────────────────────

export function KickedScreen(props: { readonly onRestart: () => void }): JSX.Element {
  return (
    <div class="pp-screen pp-center">
      <div class="pp-big-emoji">👋</div>
      <div class="pp-title">יצאת מהמשחק</div>
      <div class="pp-text">המנחה הוציא אותך מהחדר.</div>
      <button type="button" class="pp-btn pp-btn-ghost" onClick={props.onRestart}>
        להצטרף מחדש
      </button>
    </div>
  );
}

export function ClosedScreen(props: { readonly onRestart: () => void }): JSX.Element {
  return (
    <div class="pp-screen pp-center">
      <div class="pp-big-emoji">🚪</div>
      <div class="pp-title">החדר נסגר</div>
      <div class="pp-text">המשחק הזה כבר לא קיים. סרקו שוב את הקוד מהטלוויזיה.</div>
      <button type="button" class="pp-btn pp-btn-go pp-btn-mid" onClick={props.onRestart}>
        להזין קוד חדש
      </button>
    </div>
  );
}

/** Shown by CSS only while a phone is held sideways (html.pp-landscape, see device.ts). Never pauses anything. */
export function RotateOverlay(): JSX.Element {
  return (
    <div class="pp-rotate" aria-hidden="true">
      <div class="pp-rotate-phone">📱</div>
      <div class="pp-title">סובבו את הטלפון</div>
      <div class="pp-text">המשחק עובד רק לאורך ⬆️</div>
    </div>
  );
}

export function ReconnectBanner(): JSX.Element {
  return (
    <div class="pp-banner" role="status">
      <span class="pp-spinner" />
      מתחבר מחדש<Dots />
    </div>
  );
}
