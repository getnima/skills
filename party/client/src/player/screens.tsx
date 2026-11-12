/**
 * The phone screens from the round intro to the final podium. Pure render from props.
 * The way in (the name, the dressing room, the waiting room) is in welcome.tsx.
 *
 * The look is the party design system (client/public/assets/shimi/README.md), in the frame
 * the way in uses (show.css): a cobalt-dark bar with the red "live" chip, the yellow sunburst
 * stage, a cobalt tray. Motaleh is for short Hebrew headlines and stickers; names, numbers
 * and instructions are in Rubik (a digit inside a headline goes through <Num />). Motaleh's
 * ז reads as a ב ("זכית" as "בכית") and its 2 as a Z: no ז and no digit in Motaleh text.
 *
 * Words: instructions and buttons are plain. The jokes follow design/punchlines.he.md (the
 * הפשוטע register: a grand frame on a small local thing, one image, the funny word last, never
 * at the guest's expense); the stickers carry the owner's exclamations. There are no ties.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { findCutscene } from '../../../shared/cutscenes';
import { GAMES } from '../../../shared/protocol';
import { roundTime } from '../../../shared/round-clock';
import { preloadGame } from '../games/registry';
import { sfx } from '../kit/audio';
import { findPublicFile } from '../kit/files';
import { haptic, vibrate } from '../kit/haptics';
import { playTrack, stopTrack } from '../kit/music';
import { GameArt } from './intro-art';
import { Avatar, Burst, Confetti, Num, dollPx, fmt, medal, standings, useCountUp, useTick, useViewport } from './ui';

import type { ComponentChildren, JSX } from 'preact';
import type { GameId, RoomState, RoundPublic, RoundResults } from '../../../shared/protocol';
import type { PlayerController } from './controller';

const DEFAULT_PHONE_TEXT = '👀 תסתכלו על הטלוויזיה!';
const GO_FLASH_MS = 900;

export function Dots(): JSX.Element {
  return (
    <span class="pp-dots" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

/** The sunburst stage's two decoration layers (show.css). */
function StageLight(): JSX.Element {
  return (
    <>
      <div class="pw-glow" aria-hidden="true" />
      <div class="pw-dots" aria-hidden="true" />
    </>
  );
}

/** The red "live" chip of the top bar: where the show is right now. */
function Live(props: { readonly children: ComponentChildren }): JSX.Element {
  return (
    <span class="pw-live">
      <i aria-hidden="true" />
      {props.children}
    </span>
  );
}

/** A game's name as a logo: the first word white, the rest red, a line each (like "פארטי ארנה" on the cover). */
function Logo(props: { readonly text: string; readonly class: string }): JSX.Element {
  const cut = props.text.indexOf(' ');
  const first = cut < 0 ? props.text : props.text.slice(0, cut);
  const rest = cut < 0 ? '' : props.text.slice(cut + 1);
  return (
    <h1 class={`${props.class} ps-logo`}>
      {rest === '' ? first : `${first} `}
      {rest === '' ? null : <span class="is-red">{rest}</span>}
    </h1>
  );
}

// ───────────────────────────── Off the air: boot, kicked, closed ─────────────────────────────

/**
 * A TV test card (the design system's idle screen) with one card in the middle: what a phone
 * shows while it is not in the show (still connecting, removed, or the room is gone).
 */
function OffAir(props: { readonly name: string; readonly tab: string; readonly children: ComponentChildren }): JSX.Element {
  return (
    <div class={`pp-screen ps ps-off ps-${props.name}`}>
      <div class="ps-off-card">
        <span class="ps-tab">{props.tab}</span>
        {props.children}
      </div>
    </div>
  );
}

const SLOW_BOOT_MS = 6_000;

export function BootScreen(): JSX.Element {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_BOOT_MS);
    return (): void => clearTimeout(id);
  }, []);
  return (
    <OffAir name="boot" tab="פארטי ארנה">
      <div class="pp-title">
        מתחברים למסיבה
        <Dots />
      </div>
      {slow ? <div class="pp-text">לוקח רגע… בדקו שיש Wi-Fi או אינטרנט, ממשיכים לנסות</div> : null}
    </OffAir>
  );
}

export function Movement(props: { readonly rank: number; readonly prev: number | null }): JSX.Element | null {
  const { rank, prev } = props;
  if (prev === null) return null;
  if (prev > rank) return <span class="pp-move is-up">▲{prev - rank}</span>;
  if (prev < rank) return <span class="pp-move is-down">▼{rank - prev}</span>;
  return <span class="pp-move is-same">●</span>;
}

// ───────────────────────────── Intro / countdown / late ─────────────────────────────

export function IntroScreen(props: { readonly round: RoundPublic }): JSX.Element {
  const game = GAMES[props.round.gameId];
  useEffect(() => {
    preloadGame(props.round.gameId);
    sfx.whoosh();
  }, [props.round.gameId]);
  return (
    <div class={`pp-screen pw ps pp-intro pp-game-${game.id}`}>
      <header class="pw-bar">
        <Live>
          סיבוב <Num>{props.round.number}</Num>
        </Live>
        <span class="pp-ready">
          מתכוננים
          <Dots />
        </span>
      </header>
      <div class="pw-stage ps-intro-stage">
        <StageLight />
        <GameArt id={game.id} size="big" class="pp-intro-emoji" />
        <Logo text={game.title} class="pp-intro-title" />
      </div>
      <div class="pw-tray ps-intro-tray">
        <div class="ps-say">
          <span class="ps-tab">איך משחקים</span>
          <p class="pp-intro-text">{game.instructions}</p>
        </div>
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
    <div class={`pp-countdown ps ${go ? 'is-go' : ''}`}>
      <div class="pp-cd-game">
        <GameArt id={game.id} size="chip" /> {game.title}
      </div>
      <div class="pp-cd-num" key={String(key)} dir={go ? 'rtl' : 'ltr'}>
        {go ? 'יאללה!' : n}
      </div>
      {!go ? <div class="pp-cd-sub">מוכנים?</div> : null}
    </div>
  );
}

export function LateScreen(props: { readonly round: RoundPublic; readonly look: string | null }): JSX.Element {
  const game = GAMES[props.round.gameId];
  const v = useViewport();
  return (
    <div class="pp-screen pw ps ps-late">
      <header class="pw-bar">
        <Live>הסיבוב כבר רץ</Live>
      </header>
      <div class="pw-stage ps-late-stage">
        <StageLight />
        <div class="ps-hero">
          <Avatar look={props.look} size={dollPx(v, 0.36, 0.2, 84, 148)} crop="bust" />
          <Burst text="אחשילי" class="ps-hero-burst" />
        </div>
        <div class="pp-title">איחור אופנתי.</div>
        <div class="pp-text ps-now">
          <GameArt id={game.id} size="mid" />
          <span>
            עכשיו משחקים <b>{game.title}</b>.
            <br />
            את/ה בפנים מהסיבוב הבא!
          </span>
        </div>
        <div class="pp-tv-hint">📺 בינתיים תסתכלו על הטלוויזיה</div>
      </div>
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
    <div class="pp-cutscene ps" role="alert">
      <Live>עכשיו במסך הגדול</Live>
      <div class="pp-tv" aria-hidden="true">
        <div class="ps-tv-ant" />
        <div class="ps-tv-body">
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
          <div class="ps-tv-knobs">
            <i />
            <i />
            <b />
          </div>
        </div>
        <div class="pp-tv-legs" />
      </div>
      <div class="pp-cut-text">{text}</div>
      <div class="pp-cut-sub">⏸ המשחק מחכה לך. באישור ועד הבית.</div>
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
    <div class="pp-resume ps">
      <div class="pp-resume-label">ממשיכים!</div>
      <div class="pp-cd-num" key={n}>
        {n}
      </div>
      <div class="pp-cd-sub">בדיוק מאיפה שעצרנו</div>
    </div>
  );
}

// ───────────────────────────── After the round ─────────────────────────────

export function SendingScreen(props: { readonly score: number; readonly acked: boolean; readonly gameId: GameId }): JSX.Element {
  // An elimination round's raw score is a distance: it says nothing to a guest, so it is not shown.
  const elimination = GAMES[props.gameId].mode === 'elimination';
  return (
    <div class="pp-screen pw ps ps-send">
      <header class="pw-bar">
        <Live>הסיבוב נגמר</Live>
      </header>
      <div class="pw-stage">
        <StageLight />
        {elimination ? (
          <>
            <GameArt id={props.gameId} size="mid" />
            <div class="pp-title">נחתנו בנתב״ג!</div>
          </>
        ) : (
          <>
            <div class="pp-label-big">הניקוד שלך</div>
            <div class="pp-score-big">
              <span class="ps-star">⭐</span> {fmt(props.score)}
            </div>
          </>
        )}
        <div class={`pp-send ${props.acked ? 'is-done' : ''}`}>
          {props.acked ? (
            <span>✓ נשלח!</span>
          ) : (
            <span>
              שולחים את הניקוד
              <Dots />
            </span>
          )}
        </div>
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
    <div class="pp-screen pw ps pp-suspense">
      <header class="pw-bar">
        <Live>רגע של מתח</Live>
      </header>
      <div class="ps-night">
        <div class="pp-spot" aria-hidden="true" />
        <GameArt id="show" emoji="🥁" size="big" class="pp-drum" />
        <div class="pp-title pp-xl">והפרס הולך ל…</div>
        <div class="ps-quip">השופטים מתייעצים. בארומה.</div>
        <div class="pp-tv-hint">📺 תסתכלו על הטלוויזיה</div>
      </div>
    </div>
  );
}

/** The prize: a transparent cut-out of the figurine when there is one (like the TV), else the photo. */
function prizeUrl(): string | null {
  return findPublicFile('/assets/host/prize.png', ['png', 'webp', 'jpg', 'jpeg']);
}

function isCutOut(url: string): boolean {
  return /\.(png|webp)$/i.test(url);
}

/**
 * The Shimi figurine a round winner takes home: the cut-out standing on a cobalt disc (like
 * the doll in the dressing room), a framed photo when the picture has a background, an angel
 * until there is a picture at all.
 */
function Prize(): JSX.Element {
  const url = prizeUrl();
  const [imgOk, setImgOk] = useState(url !== null);
  const shown = imgOk && url !== null;
  return (
    <div class={`pp-prize ${shown && isCutOut(url) ? 'is-cut' : 'is-photo'}`}>
      {shown ? (
        <img src={url} alt="הפרס" onError={() => setImgOk(false)} draggable={false} />
      ) : (
        <div class="pp-prize-ph">
          <span>👼</span>
        </div>
      )}
      <span class="pp-prize-shine" />
    </div>
  );
}

export function WinScreen(props: { readonly onDone: () => void; readonly look: string | null }): JSX.Element {
  const v = useViewport();
  useEffect(() => {
    playTrack('victory', { volume: 0.9 });
    sfx.cheer();
    vibrate([300, 120, 300, 120, 600, 150, 200, 80, 200]);
    return (): void => stopTrack('victory', 900);
  }, []);
  return (
    <div class="pp-screen ps pp-win">
      <div class="pp-rays" aria-hidden="true" />
      <StageLight />
      <Confetti bursts={5} intensity={1.3} />
      <h1 class="pp-win-title ps-logo">ניצחת!</h1>
      <div class="ps-win-sub">זכית בשימי אנג׳ל!</div>
      <div class="ps-quip ps-win-quip">כמו האוסקר, רק בחנוכת בית.</div>
      <div class="ps-win-show">
        <div class="ps-win-me">
          <span class="pp-crown" aria-hidden="true">
            👑
          </span>
          <Avatar look={props.look} size={dollPx(v, 0.42, 0.22, 100, 176)} crop="bust" />
          <Burst text="מחורחר!" class="ps-hero-burst" />
        </div>
        <Prize />
      </div>
      <div class="pp-win-go">לכו לקחת את הפרס!</div>
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
  const elimination = GAMES[props.results.gameId].mode === 'elimination';
  const v = useViewport();
  const size = dollPx(v, 0.44, 0.23, 104, 176);
  useEffect(() => {
    if (winner !== undefined) sfx.cheer();
    else sfx.fail();
    haptic.bump();
  }, []);
  return (
    <div class="pp-screen pw ps pp-reveal" onClick={props.onDone}>
      <div class="pw-stage ps-reveal-stage">
        <StageLight />
        {winner !== undefined ? (
          <>
            <div class="pp-label-big">הפרס הולך ל…</div>
            <div class="pp-reveal-faces" style={{ height: `${size}px` }}>
              <div class="pp-reveal-face ps-hero">
                <span class="pp-crown" aria-hidden="true">
                  👑
                </span>
                <Avatar look={winner.look} size={size} crop="bust" />
                <Burst text="וואו!" class="ps-hero-burst" />
              </div>
              <Prize />
            </div>
            <div class="pp-reveal-name">{winner.name}</div>
            {elimination ? <div class="pp-text">נשאר/ה אחרון/ה באוויר.</div> : null}
            <div class="ps-quip">הכרזה רשמית: שימי אנג׳ל עובר דירה.</div>
            {byTime ? (
              <div class="pp-earlier">⏱ {elimination ? 'אותו מרחק' : 'אותו ניקוד'}, מי שהגיע אליו קודם מנצח</div>
            ) : null}
            <Confetti bursts={1} intensity={0.5} />
          </>
        ) : (
          <>
            <span class="ps-emoji is-mid" aria-hidden="true">
              <span>🤷</span>
            </span>
            <div class="pp-title">אף אחד לא קלע הפעם</div>
            <div class="ps-quip">שימי אנג׳ל נשאר בוויטרינה. כמו בעזריאלי.</div>
          </>
        )}
      </div>
    </div>
  );
}

export function ResultsScreen(props: { readonly results: RoundResults; readonly me: string; readonly look: string | null }): JSX.Element {
  const { results } = props;
  const game = GAMES[results.gameId];
  // An elimination round's raw score is a distance flown: the place says it all, the number is not shown.
  const elimination = game.mode === 'elimination';
  const row = results.rows.find((r) => r.playerId === props.me);
  const points = useCountUp(row?.points ?? 0, 1400, 300);
  const total = useCountUp(row?.total ?? 0, 1400, 300, row !== undefined ? row.total - row.points : 0);
  // roundRank is the server's strict position (1..n): equal raw scores are already ordered by who got there first.
  const byRound = [...results.rows].sort((a, b) => a.roundRank - b.roundRank);
  /** How many played and scored: the "מתוך N" of a round place. */
  const scorers = byRound.filter((r) => r.raw > 0).length;
  const won = row !== undefined && results.winnerIds[0] === row.playerId;
  const sameRaw = (a: (typeof byRound)[number] | undefined, b: (typeof byRound)[number] | undefined): boolean =>
    a !== undefined && b !== undefined && a.raw > 0 && a.raw === b.raw;
  const mineAt = row === undefined ? -1 : byRound.indexOf(row);
  const above = mineAt > 0 ? byRound[mineAt - 1] : undefined;
  const below = mineAt >= 0 ? byRound[mineAt + 1] : undefined;
  const v = useViewport();
  useEffect(() => {
    if (row !== undefined && row.points > 0) sfx.coin(1.2);
  }, []);
  const what = elimination ? 'מרחק' : 'ניקוד';
  return (
    <div class="pp-screen pw ps pp-results">
      <header class="pw-bar pp-res-head">
        <Live>
          {game.title} · סיבוב <Num>{results.roundNumber}</Num>
        </Live>
        <GameArt id={game.id} size="chip" class="ps-bar-art" />
      </header>
      <div class="pw-stage ps-res-stage">
        <StageLight />
        {row !== undefined ? (
          <div class={`pp-res-card ${won ? 'is-winner' : ''}`}>
            <div class="ps-res-me">
              <div class="ps-hero">
                {won ? (
                  <span class="pp-crown" aria-hidden="true">
                    👑
                  </span>
                ) : null}
                <Avatar look={props.look ?? row.look} size={dollPx(v, 0.3, 0.16, 76, 128)} crop="bust" />
                {row.raw > 0 && row.roundRank <= 3 ? <Burst text={won ? 'צדיק!' : 'וואו!'} class="ps-hero-burst" /> : null}
              </div>
              <div class="ps-res-say">
                <div class="pp-res-rank">
                  {row.raw <= 0 ? (
                    'לא קלעת הפעם'
                  ) : (
                    <>
                      מקום <Num>{row.roundRank}</Num> בסיבוב
                    </>
                  )}
                </div>
                {row.raw <= 0 ? (
                  <div class="pp-res-raw">רק חימום. כמו במונדיאל.</div>
                ) : elimination ? (
                  <div class="pp-res-raw">{won ? 'נשארת באוויר עד הסוף!' : `מתוך ${scorers} שעפו`}</div>
                ) : (
                  <div class="pp-res-raw">⭐ {fmt(row.raw)} במשחק</div>
                )}
              </div>
            </div>
            {sameRaw(above, row) ? (
              <div class="pp-earlier">
                ⏱ אותו {what} כמו <bdi>{above?.name}</bdi>, שהגיע/ה אליו קודם
              </div>
            ) : sameRaw(row, below) ? (
              <div class="pp-earlier">
                ⏱ הגעת ל{what} לפני <bdi>{below?.name}</bdi>
              </div>
            ) : null}
            <div class="ps-res-gain">
              <div class="pp-res-points" dir="ltr">
                +{fmt(points)}
              </div>
              <div class="pp-res-points-l">נקודות</div>
            </div>
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
            <div class="ps-res-me">
              <div class="ps-hero">
                <Avatar look={props.look} size={dollPx(v, 0.3, 0.16, 76, 128)} crop="bust" />
              </div>
              <div class="ps-res-say">
                <div class="pp-res-rank">לא שיחקת הפעם</div>
                <div class="pp-res-raw">בסיבוב הבא גם את/ה בפנים</div>
              </div>
            </div>
          </div>
        )}
      </div>
      <div class="pw-tray ps-res-tray">
        <div class="pp-panel pp-grow">
          <div class="pp-panel-title">
            <span>הטבלה של הסיבוב</span>
            <span class="ps-legend">{elimination ? 'נקודות לסיבוב' : 'ניקוד במשחק ⭐'}</span>
          </div>
          <ol class="pp-top3 kit-scroll">
            {byRound.map((r, i) => {
              const mine = r.playerId === props.me;
              return (
                <li key={r.playerId} class={mine ? 'is-me' : ''}>
                  <span class="pp-st-rank">{r.raw > 0 ? medal(r.roundRank) || r.roundRank : '–'}</span>
                  <Avatar look={mine ? (props.look ?? r.look) : r.look} size={mine ? 40 : 32} />
                  <span class="pp-st-name">{r.name}</span>
                  {sameRaw(r, byRound[i + 1]) ? <span class="pp-earlier-chip">⏱ קודם</span> : null}
                  {elimination ? (
                    r.raw > 0 && r.roundRank === 1 ? (
                      <span class="pp-st-total is-last">אחרון באוויר</span>
                    ) : (
                      <span class="pp-st-total">{r.raw > 0 ? `+${fmt(r.points)}` : '–'}</span>
                    )
                  ) : (
                    <span class="pp-st-total">{fmt(r.raw)}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Final ─────────────────────────────

const PLACE_WORD = ['', 'ראשון', 'שני', 'שלישי'];

export function FinalScreen(props: { readonly state: RoomState; readonly me: string; readonly active: boolean; readonly look: string | null }): JSX.Element {
  const rows = standings(props.state.players);
  const mine = rows.find((r) => r.player.id === props.me);
  const rank = mine?.rank ?? rows.length;
  const podium = rank <= 3 && (mine?.player.total ?? 0) > 0;
  const total = useCountUp(mine?.player.total ?? 0, 1600, 200);
  const celebrated = useRef(false);
  const v = useViewport();
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
    <div class={`pp-screen pw ps pp-final ${podium ? 'is-podium' : ''} ${podium && rank === 1 ? 'is-champ' : ''}`}>
      <header class="pw-bar">
        <Live>הגמר</Live>
      </header>
      <div class="pw-stage ps-final-stage">
        {podium ? <div class="pp-rays" aria-hidden="true" /> : null}
        <StageLight />
        {props.active && podium ? <Confetti bursts={4} /> : null}
        <div class="ps-hero">
          {podium && rank === 1 ? (
            <span class="pp-crown" aria-hidden="true">
              👑
            </span>
          ) : null}
          <Avatar look={props.look ?? mine?.player.look} size={dollPx(v, podium ? 0.4 : 0.34, 0.19, 80, 152)} crop="bust" />
          {podium ? <span class="pp-final-medal">{medal(rank)}</span> : null}
          <Burst text={podium ? (rank === 1 ? 'בן פורת יוסף!' : 'צדיק!') : 'נודר'} class="ps-hero-burst" tone={podium ? 'red' : 'pink'} />
        </div>
        <div class="pp-final-place ps-logo">
          {podium ? (
            `מקום ${PLACE_WORD[rank] ?? rank}!`
          ) : (
            <>
              מקום <Num>{rank}</Num>{' '}
              <span class="ps-of">
                מתוך <Num>{rows.length}</Num>
              </span>
            </>
          )}
        </div>
        <div class="pp-score-big">
          <span class="ps-star">⭐</span> {fmt(total)} <small>נק׳</small>
        </div>
        <div class="pp-text pp-final-line">
          {rank === 1 && podium ? 'אלופ/ת הערב. ככה נראה אייקון.' : podium ? 'על הפודיום. טפו חמסה.' : 'תואר כבוד: אורח/ת השנה.'}
        </div>
      </div>
      <div class="pw-tray ps-final-tray">
        <div class="pp-mini-podium">
          {[1, 0, 2].map((i) => {
            const row = top[i];
            if (row === undefined) return <div key={i} class="pp-mp-col is-empty" />;
            const p = row.player;
            const me = p.id === props.me;
            return (
              <div key={p.id} class={`pp-mp-col pp-mp-${i + 1} ${me ? 'is-me' : ''}`}>
                <Avatar look={me ? (props.look ?? p.look) : p.look} size={i === 0 ? 56 : 44} />
                <span class="pp-mp-name">{p.name}</span>
                <span class="pp-mp-block">{row.rank}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Kicked / closed / banner ─────────────────────────────

export function KickedScreen(props: { readonly onRestart: () => void }): JSX.Element {
  return (
    <OffAir name="kicked" tab="הפסקת שידור">
      <div class="pp-title">יצאת מהמשחק</div>
      <div class="pp-text">המנחה הוציא אותך מהחדר.</div>
      <button type="button" class="pp-btn pp-btn-ghost" onClick={props.onRestart}>
        להצטרף מחדש
      </button>
    </OffAir>
  );
}

export function ClosedScreen(props: { readonly onRestart: () => void }): JSX.Element {
  return (
    <OffAir name="closed" tab="הפסקת שידור">
      <div class="pp-title">החדר נסגר</div>
      <div class="pp-text">המשחק הזה כבר לא קיים. סרקו שוב את הקוד מהטלוויזיה.</div>
      <button type="button" class="pp-btn pp-btn-go pp-btn-mid" onClick={props.onRestart}>
        לחדר חדש
      </button>
    </OffAir>
  );
}

/** Shown by CSS only while a phone is held sideways (html.pp-landscape, see device.ts). Never pauses anything. */
export function RotateOverlay(): JSX.Element {
  return (
    <div class="pp-rotate ps" aria-hidden="true">
      <div class="pp-rotate-phone">
        <i />
      </div>
      <div class="ps-rotate-say">
        <div class="pp-title">סובבו את הטלפון</div>
        <div class="pp-text">המשחק עובד רק לאורך</div>
      </div>
    </div>
  );
}

export function ReconnectBanner(): JSX.Element {
  return (
    <div class="pp-banner" role="status">
      <span class="pp-spinner" />
      מתחבר מחדש
      <Dots />
    </div>
  );
}
