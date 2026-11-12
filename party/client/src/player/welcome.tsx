/**
 * The way in, three steps that look like one product (the party design language of
 * client/public/assets/shimi/README.md, the same frame as the dressing room: sunburst stage
 * on top, cobalt tray below):
 *
 *   1. JoinScreen      the name (and the room code only when the link has none), one button
 *   2. DressingScreen  the dressing room, full screen: the guest dresses their own Shimi
 *   3. LobbyScreen     the waiting room: the dressed doll, who else is here, back to step 2
 *
 * Which of 2 / 3 shows is decided in app.tsx from the controller's snapshot (dressing-state.ts).
 */
import './welcome.css';

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { decodeLook, encodeLook } from '../../../shared/avatar';
import { NAME_MAX_LEN, ROOM_CODE_LEN } from '../../../shared/protocol';
import { Avatar as LookAvatar, preloadAvatarAssets } from '../avatar';
import { isMuted, setMuted, sfx, unlockAudio } from '../kit/audio';
import { haptic } from '../kit/haptics';
import { isStandalone, keepAwake } from '../kit/mobile';
import { goFullscreen } from './device';
import { dressStepEnabled } from './dressing-state';
import { dismissTip, isTipDismissed } from './identity';
import { BootScreen, Dots, Movement } from './screens';
import { Avatar, fmt, medal, standings } from './ui';

import type { JSX } from 'preact';
import type { AvatarLook } from '../../../shared/avatar';
import type { RoomState } from '../../../shared/protocol';
import type { DressingRoomFullProps } from '../avatar/dressing';
import type { PlayerController, Snapshot } from './controller';

// ───────────────────────────── the dressing room's code ─────────────────────────────

type RoomComponent = (props: DressingRoomFullProps) => JSX.Element;

let roomLoaded: RoomComponent | null = null;
let roomLoading: Promise<RoomComponent> | null = null;

/**
 * The dressing room is a chunk of its own (client/src/avatar/README.md): never imported
 * statically. It is fetched once, as early as the join screen, so it is there when the guest
 * has typed a name. A failed fetch may be tried again.
 */
function loadDressingRoom(): Promise<RoomComponent> {
  if (roomLoading === null) {
    const loading = import('../avatar/dressing').then((m): RoomComponent => {
      roomLoaded = m.DressingRoom;
      return m.DressingRoom;
    });
    roomLoading = loading;
    loading.catch(() => {
      if (roomLoading === loading) roomLoading = null;
    });
  }
  return roomLoading;
}

// ───────────────────────────── 1. the name ─────────────────────────────

/** Three dolls on the cover: what a guest is about to make. Only the 17 original accessories. */
const COVER_LOOKS: readonly string[] = ['1.5.3.0.0.11.0', '1.8.8-17.9.0.0.7', '1.2.12.5.0.0.15'];

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

  // While the guest types a name: fetch the dressing room and its pictures (about 2 MB, once),
  // so the next step opens ready. Not when the step is switched off (dressing-state.ts).
  useEffect(() => {
    if (!dressStepEnabled(window.location.search, navigator.webdriver === true)) return undefined;
    const t = setTimeout(() => {
      void loadDressingRoom().catch(() => undefined);
      void preloadAvatarAssets();
    }, 500);
    return (): void => clearTimeout(t);
  }, []);

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
  // the cover dolls: bigger on a tall phone (the stage has the room), decided once
  const [tall] = useState(() => window.innerHeight >= 760);
  return (
    <form class="pp-screen pp-join pw pw-join" onSubmit={submit} autocomplete="off">
      <div class="pw-stage pw-cover">
        <div class="pw-glow" aria-hidden="true" />
        <div class="pw-dots" aria-hidden="true" />
        {showCodeInput ? null : (
          <div class="pp-room-chip">
            <span>חדר</span>
            <b dir="ltr">{snap.code}</b>
          </div>
        )}
        <h1 class="pp-brand">
          פארטי <span>ארנה</span>
        </h1>
        <div class="pw-cover-dolls" aria-hidden="true">
          <LookAvatar look={COVER_LOOKS[0]} size={tall ? 78 : 60} ring class="pw-cd pw-cd-a" />
          <LookAvatar look={COVER_LOOKS[1]} size={tall ? 104 : 78} ring class="pw-cd pw-cd-b" />
          <LookAvatar look={COVER_LOOKS[2]} size={tall ? 78 : 60} ring class="pw-cd pw-cd-c" />
        </div>
        <div class="pp-sub">5 משחקים · בובה לכל אחד · פרס בכל סיבוב</div>
      </div>

      <div class="pp-join-card pw-tray">
        <A2hsTip />
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
        ) : null}
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
        <div class="pw-next">ומיד אחר כך: מלבישים את הבובה שלך</div>
      </div>
    </form>
  );
}

// ───────────────────────────── 2. the dressing room ─────────────────────────────

/** How long the room's own "done" burst plays before the waiting room takes over. */
const DONE_BEAT_MS = 650;
/** The room's code is tried this many times (flaky Wi-Fi) before the guest is let through to the waiting room. */
const ROOM_LOAD_TRIES = 4;
const ROOM_RETRY_MS = 1_500;

/**
 * The dressing room, full screen. Every change goes to the controller at once (it remembers
 * it and sends it throttled, so the TV lobby shows the doll being dressed); "מוכן!" ends the
 * step. A round that starts simply unmounts this screen: the room reports what it still holds
 * on its way out and the controller sends it without waiting.
 */
export function DressingScreen(props: { readonly ctl: PlayerController; readonly snap: Snapshot }): JSX.Element {
  const { ctl, snap } = props;
  const look = useMemo<AvatarLook>(() => decodeLook(snap.look), [snap.look]);
  const [Room, setRoom] = useState<RoomComponent | null>(() => roomLoaded);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Room !== null) return undefined;
    let alive = true;
    let tries = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const go = (): void => {
      loadDressingRoom().then(
        (R) => {
          if (alive) setRoom(() => R);
        },
        () => {
          if (!alive) return;
          tries++;
          // No dressing room on this connection: the guest waits with the doll they have;
          // the waiting room's button tries again.
          if (tries >= ROOM_LOAD_TRIES) ctl.closeDressing();
          else retry = setTimeout(go, ROOM_RETRY_MS);
        },
      );
    };
    go();
    return (): void => {
      alive = false;
      if (retry !== null) clearTimeout(retry);
    };
  }, [Room]);

  useEffect(
    () => () => {
      if (doneTimer.current !== null) clearTimeout(doneTimer.current);
    },
    [],
  );

  return (
    <div class="pp-screen pw pw-dress" data-look={snap.look ?? ''} data-ready={Room !== null ? '1' : '0'}>
      {Room === null ? (
        <div class="pw-stage pw-dress-wait">
          <div class="pw-glow" aria-hidden="true" />
          <div class="pw-dots" aria-hidden="true" />
          <LookAvatar look={snap.look} size={128} crop="bust" ring />
          <div class="pw-dress-wait-text">
            פותחים את חדר ההלבשה
            <Dots />
          </div>
        </div>
      ) : (
        <div class="pw-dress-room">
          <Room
            look={look}
            name={snap.name}
            onChange={(l) => ctl.setLook(encodeLook(l))}
            onDone={(l) => {
              ctl.setLook(encodeLook(l));
              if (doneTimer.current !== null) return;
              doneTimer.current = setTimeout(() => {
                doneTimer.current = null;
                ctl.closeDressing();
              }, DONE_BEAT_MS);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── 3. the waiting room ─────────────────────────────

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

function StandingsList(props: { readonly state: RoomState; readonly me: string; readonly myLook: string | null }): JSX.Element {
  const rows = standings(props.state.players);
  const prevById = new Map<string, number | null>();
  for (const r of props.state.results?.rows ?? []) prevById.set(r.playerId, r.prevRank);
  return (
    <ol class="pp-standings kit-scroll">
      {rows.map(({ player, rank }) => (
        <li key={player.id} class={player.id === props.me ? 'is-me' : ''} data-player={player.id} data-look={player.look}>
          <span class="pp-st-rank">{medal(rank) || rank}</span>
          <Avatar look={player.id === props.me ? (props.myLook ?? player.look) : player.look} size={32} />
          <span class="pp-st-name">{player.name}</span>
          {prevById.has(player.id) ? <Movement rank={rank} prev={prevById.get(player.id) ?? null} /> : null}
          <span class="pp-st-total">{fmt(player.total)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Between rounds the table is what matters: a small doll, by the phone's height. */
function stripDoll(): number {
  const h = window.innerHeight;
  return h >= 800 ? 92 : h >= 660 ? 76 : 60;
}

/**
 * The size of the doll on the waiting room's stage. The stage is as high as what it holds
 * and the tray gets the rest, so the doll decides the split: before the first round a good
 * fifth of the room under the bar (at most 148 px: sharp on 3x screens, the avatar cache
 * tops out at 384 px), between rounds see stripDoll(). Measured on the screen itself, so the
 * notch, the home indicator and the me bar are all counted.
 */
function useStageDoll(between: boolean): { ref: (el: HTMLElement | null) => void; size: number } {
  const [size, setSize] = useState(between ? stripDoll() : 128);
  const elRef = useRef<HTMLElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const betweenRef = useRef(between);
  betweenRef.current = between;
  const measure = (): void => {
    const el = elRef.current;
    if (el === null) return;
    let next = stripDoll();
    if (!betweenRef.current) {
      const cs = getComputedStyle(el);
      const inner = el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      const bar = el.querySelector('.pw-bar')?.getBoundingClientRect().height ?? 56;
      next = Math.round(Math.max(56, Math.min(148, (inner - bar) * 0.22, el.clientWidth * 0.42)) / 4) * 4;
    }
    setSize((s) => (s === next ? s : next));
  };
  const ref = useRef((el: HTMLElement | null): void => {
    roRef.current?.disconnect();
    roRef.current = null;
    elRef.current = el;
    if (el === null) return;
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      roRef.current = ro;
    }
  });
  useEffect(measure, [between]);
  useEffect(() => () => roRef.current?.disconnect(), []);
  return { ref: ref.current, size };
}

export function LobbyScreen(props: { readonly ctl: PlayerController; readonly snap: Snapshot; readonly state: RoomState }): JSX.Element {
  const { ctl, state, snap } = props;
  const me = state.players.find((p) => p.id === snap.playerId);
  const others = state.players.filter((p) => p.id !== snap.playerId);
  const played = state.played.length > 0;
  const mine = standings(state.players).find((s) => s.player.id === snap.playerId);
  const doll = useStageDoll(played);

  if (me === undefined) return <BootScreen />;
  // this phone's own look is ahead of the server's by a moment
  const myLook = snap.look ?? me.look;
  return (
    <div class={`pp-screen pp-lobby pw pw-wait ${played ? 'is-between' : 'is-first'}`} ref={doll.ref}>
      <header class="pw-bar">
        <span class="pw-live">
          <i aria-hidden="true" />
          {played ? 'בין הסיבובים' : 'חדר ההמתנה'}
        </span>
        <MuteButton />
      </header>

      <div class="pw-stage pw-me-stage">
        <div class="pw-glow" aria-hidden="true" />
        <div class="pw-dots" aria-hidden="true" />
        {played ? null : (
          <span class="pw-burst" aria-hidden="true">
            <span>בפנים!</span>
          </span>
        )}
        <div class="pw-me-doll" data-look={myLook}>
          <LookAvatar look={myLook} size={doll.size} crop="bust" ring label={`הבובה של ${me.name}`} />
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
          <div class="pp-me-in">ככה רואים אותך על המסך הגדול</div>
        )}
        <button type="button" class="pw-btn pw-redress" onClick={() => ctl.openDressing()}>
          חזרה לחדר ההלבשה
        </button>
      </div>

      <div class="pw-tray pw-wait-tray">
        {played ? (
          <div class="pp-panel pp-grow">
            <div class="pp-panel-title">הטבלה עד עכשיו</div>
            <StandingsList state={state} me={snap.playerId ?? ''} myLook={myLook} />
          </div>
        ) : (
          <div class="pp-panel pp-grow">
            <div class="pp-panel-title">
              כבר כאן <span class="pp-count">{state.players.length}</span>
            </div>
            {others.length === 0 ? (
              <div class="pp-empty">עוד אף אחד… תגידו לחברים לסרוק את הקוד</div>
            ) : (
              <div class="pp-chips kit-scroll">
                {others.map((p) => (
                  <span key={p.id} class={`pp-chip ${p.connected ? '' : 'is-off'}`} data-player={p.id} data-look={p.look}>
                    <Avatar look={p.look} size={30} />
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
          <span>
            {played ? 'מחכים לסיבוב הבא' : 'מחכים שהמנחה יתחיל'}
            <Dots />
          </span>
        </div>
      </div>
    </div>
  );
}
