/**
 * The TV's background music: lobby.mp3 in the lobby, each game's own song
 * (tap.mp3, icy.mp3, …, else round.mp3, else silence) from its intro to the
 * end of play, and the "🎵 בדיקת סאונד" panel. Everything follows the room
 * state and the server clock (music-plan.ts); levels live in music-config.ts.
 * victory.mp3 / final.mp3 are played by the show scenes themselves.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { GAMES, GAME_IDS } from '../../../shared/protocol';
import { setMuted } from '../kit/audio';
import { findTrackFile, getTrackInfo, hasTrackFile, isTrackPlaying, pauseTrack, playTrack, resumeTrack, setTrackVolume, stopTrack } from '../kit/music';
import { MUSIC_FADES } from './music-config';
import { DEFAULT_PRELUDE_MS, planMusic, preludeOf, resolveGameSlot, tuningOf } from './music-plan';
import { Btn, Modal } from './ui';
import { useMuted } from './util';

import type { JSX } from 'preact';
import type { RoomState } from '../../../shared/protocol';
import type { ServerClock } from '../net/connection';
import type { MusicSlot } from './music-config';
import type { MusicPlan } from './music-plan';

const PRELUDE_STORE = 'party.musicPrelude';
/** A song that keeps vanishing (an undecodable file) is not restarted more often than this per round. */
const MAX_RESTARTS = 2;

interface Current {
  readonly key: string;
  readonly slot: MusicSlot;
  paused: boolean;
  volume: number;
}

/** Automation hook for the browser tests (read-only). */
export interface HostMusicHooks {
  plan(): MusicPlan;
  current(): { readonly key: string; readonly slot: string; readonly paused: boolean; readonly volume: number } | null;
  /** The hook's pending wake-up timer. */
  timers(): number;
  prelude(): number | null;
}

declare global {
  interface Window {
    __hostMusic?: HostMusicHooks;
  }
}

function roundKey(state: RoomState): string | null {
  const r = state.round;
  return r === null ? null : `${state.code}:${r.index}:${r.seed}`;
}

function readPrelude(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(PRELUDE_STORE);
    if (raw === null) return null;
    const v = JSON.parse(raw) as { key?: unknown; ms?: unknown };
    return v.key === key && typeof v.ms === 'number' && Number.isFinite(v.ms) ? v.ms : null;
  } catch {
    return null;
  }
}

function writePrelude(key: string, ms: number): void {
  try {
    sessionStorage.setItem(PRELUDE_STORE, JSON.stringify({ key, ms }));
  } catch {
    // private mode: a reload then uses the default
  }
}

/**
 * Plays the TV's background music from the room state. `soundCheck`: the
 * sound check panel is open (it owns the speakers; the bed stays quiet).
 */
export function useShowMusic(state: RoomState | null, clock: ServerClock, soundCheck: boolean): void {
  const stateRef = useRef(state);
  stateRef.current = state;
  const checkRef = useRef(soundCheck);
  checkRef.current = soundCheck;
  /** round key → intro + countdown ms */
  const preludes = useRef(new Map<string, number>());
  const sawState = useRef(false);
  const cur = useRef<Current | null>(null);
  const restarts = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const preludeFor = (st: RoomState): number => {
    const key = roundKey(st);
    if (key === null || st.round === null) return DEFAULT_PRELUDE_MS;
    const known = preludes.current.get(key);
    if (known !== undefined) return known;
    // The TV saw this round appear: its first snapshot tells the intro's real length.
    // Otherwise (the page was reloaded mid-round) what this tab learned before, else the production timing.
    const ms = sawState.current ? preludeOf(st.round, st.serverNow) : (readPrelude(key) ?? DEFAULT_PRELUDE_MS);
    preludes.current.set(key, ms);
    if (preludes.current.size > 20) preludes.current.delete(preludes.current.keys().next().value ?? '');
    writePrelude(key, ms);
    return ms;
  };

  const planNow = (): MusicPlan => {
    const st = stateRef.current;
    return planMusic({
      phase: st?.phase ?? null,
      round: st?.round ?? null,
      cutscene: st?.cutscene != null,
      now: clock.now(),
      preludeMs: st !== null ? preludeFor(st) : DEFAULT_PRELUDE_MS,
      soundCheck: checkRef.current,
      hasFile: hasTrackFile,
    });
  };

  const reconcile = (): void => {
    try {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      const plan = planNow();
      if (stateRef.current !== null) sawState.current = true;
      let c = cur.current;
      // stopped behind our back (stopTrack() of a show scene) or a file that could not be played
      if (c !== null && getTrackInfo(c.slot) === null) {
        restarts.current.set(c.key, (restarts.current.get(c.key) ?? 0) + 1);
        cur.current = c = null;
      }
      if (c !== null && c.key !== plan.key) {
        stopTrack(c.slot, c.slot === 'lobby' ? MUSIC_FADES.lobbyEndMs : MUSIC_FADES.roundEndMs);
        cur.current = c = null;
      }
      if (plan.slot !== null && plan.key !== null) {
        if (c === null) {
          if (plan.run === 'play' && (restarts.current.get(plan.key) ?? 0) <= MAX_RESTARTS) {
            const slot = plan.slot;
            playTrack(slot, {
              loop: true,
              volume: plan.volume,
              fallback: 'none',
              // read when the sound really starts (after loading, or after the first click)
              startAt: () => planNow().positionSec,
            });
            cur.current = { key: plan.key, slot, paused: false, volume: plan.volume };
          }
        } else if (plan.run === 'pause') {
          if (!c.paused) pauseTrack(c.slot, MUSIC_FADES.pauseMs);
          c.paused = true;
        } else if (c.paused) {
          setTrackVolume(c.slot, plan.volume, 0);
          resumeTrack(c.slot, MUSIC_FADES.resumeMs);
          c.paused = false;
          c.volume = plan.volume;
        } else if (c.volume !== plan.volume) {
          setTrackVolume(c.slot, plan.volume, MUSIC_FADES.rampUpMs);
          c.volume = plan.volume;
        }
      }
      if (restarts.current.size > 20) restarts.current.clear();
      if (plan.nextAt !== null) {
        const wait = Math.max(0, plan.nextAt - clock.now()) + 30;
        timer.current = setTimeout(() => {
          timer.current = null;
          reconcile();
        }, wait);
      }
    } catch {
      // music must never break the show
    }
  };
  const reconcileRef = useRef(reconcile);
  reconcileRef.current = reconcile;

  useEffect(() => {
    reconcileRef.current();
  }, [state, soundCheck]);

  useEffect(() => {
    window.__hostMusic = {
      plan: () => planNow(),
      current: () => (cur.current === null ? null : { ...cur.current }),
      timers: () => (timer.current === null ? 0 : 1),
      prelude: () => {
        const st = stateRef.current;
        const key = st !== null ? roundKey(st) : null;
        return key !== null ? (preludes.current.get(key) ?? null) : null;
      },
    };
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      if (cur.current !== null) stopTrack(cur.current.slot, 300);
      cur.current = null;
    };
  }, []);
}

// ───────────────────────────── Sound check panel ─────────────────────────────

type CheckSlot = MusicSlot | 'victory' | 'final';

const CHECK_SLOTS: readonly CheckSlot[] = ['lobby', ...GAME_IDS, 'round', 'victory', 'final'];

function slotLabel(slot: CheckSlot): string {
  switch (slot) {
    case 'lobby':
      return '🏠 לובי';
    case 'round':
      return '🎶 גיבוי למשחקים';
    case 'victory':
      return '🏆 שיר הניצחון';
    case 'final':
      return '👑 שיר האלוף';
    default:
      return `${GAMES[slot].emoji} ${GAMES[slot].title}`;
  }
}

function slotWhen(slot: CheckSlot): string {
  switch (slot) {
    case 'lobby':
      return 'בלובי ובין סיבובים, בלופ';
    case 'round':
      return 'במשחק שאין לו שיר משלו';
    case 'victory':
      return 'כשמנצח הסיבוב נחשף';
    case 'final':
      return 'כשהאלוף עולה לפודיום';
    default:
      return 'מההסבר עד סוף המשחק, בלופ';
  }
}

/** What the show really plays for a slot: the track name and how. */
interface Playback {
  readonly track: string;
  readonly loop: boolean;
  readonly volume: number;
  readonly startSec: number;
  readonly fallback: 'victory' | 'none';
}

function playbackOf(slot: CheckSlot): Playback | null {
  if (slot === 'victory' || slot === 'final') return { track: slot, loop: false, volume: 1, startSec: 0, fallback: 'victory' };
  const real = slot === 'lobby' || slot === 'round' ? (hasTrackFile(slot) ? slot : null) : resolveGameSlot(slot, hasTrackFile);
  if (real === null) return null;
  const tune = tuningOf(real);
  return { track: real, loop: true, volume: tune.volume, startSec: tune.startSec, fallback: 'none' };
}

function missingText(slot: CheckSlot): string {
  if (slot === 'victory' || slot === 'final') return 'חסר - תושמע מנגינת ניצחון מובנית';
  if (slot === 'lobby' || slot === 'round') return 'חסר - יושמע שקט';
  const round = findTrackFile('round');
  return round !== null ? `חסר - יושמע ${round}` : 'חסר - יושמע שקט';
}

function formatSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** The ☰ → "🎵 בדיקת סאונד" panel: every slot, found or missing, with a preview at the show's levels. */
export function SoundCheck(props: { onClose(): void }): JSX.Element {
  const muted = useMuted();
  const [previewing, setPreviewing] = useState<{ readonly slot: CheckSlot; readonly track: string } | null>(null);
  const previewRef = useRef(previewing);
  previewRef.current = previewing;

  const stop = (): void => {
    const p = previewRef.current;
    if (p !== null) stopTrack(p.track, 300);
    previewRef.current = null;
    setPreviewing(null);
  };

  const play = (slot: CheckSlot): void => {
    const pb = playbackOf(slot);
    const prev = previewRef.current;
    if (prev !== null) stopTrack(prev.track, 200);
    if (pb === null) {
      previewRef.current = null;
      setPreviewing(null);
      return;
    }
    playTrack(pb.track, { loop: pb.loop, volume: pb.volume, fallback: pb.fallback, startAt: pb.startSec > 0 ? pb.startSec : undefined });
    const next = { slot, track: pb.track };
    previewRef.current = next;
    setPreviewing(next);
  };

  // a one-shot song (victory / final) that played out: the button goes back to ▶
  useEffect(() => {
    if (previewing === null) return undefined;
    const id = setInterval(() => {
      const p = previewRef.current;
      if (p !== null && !isTrackPlaying(p.track)) {
        previewRef.current = null;
        setPreviewing(null);
      }
    }, 400);
    return () => clearInterval(id);
  }, [previewing]);

  // closing the panel (or a round starting) stops the preview
  useEffect(
    () => () => {
      const p = previewRef.current;
      if (p !== null) stopTrack(p.track, 300);
    },
    [],
  );

  return (
    <Modal title="🎵 בדיקת סאונד" wide onClose={props.onClose} testId="sound-check">
      {muted ? (
        <div class="hs-sc-muted" data-testid="sc-muted">
          <span>🔇 הסאונד מושתק</span>
          <Btn label="הפעלת סאונד" icon="🔊" tone="primary" onClick={() => setMuted(false)} />
        </div>
      ) : null}
      <ul class="hs-sc-list">
        {CHECK_SLOTS.map((slot) => {
          const file = findTrackFile(slot);
          const pb = playbackOf(slot);
          const on = previewing?.slot === slot;
          const levels = pb !== null ? `התחלה ${formatSec(pb.startSec)} · עוצמה ${Math.round(pb.volume * 100)}%` : null;
          return (
            <li class={`hs-sc-row ${on ? 'is-on' : ''}`} key={slot} data-testid={`sc-${slot}`} data-found={file !== null ? 'yes' : 'no'}>
              <span class={`hs-dot hs-dot--${file !== null ? 'ok' : 'missing'}`} />
              <span class="hs-sc-main">
                <span class="hs-sc-title">{slotLabel(slot)}</span>
                <span class="hs-sc-meta">{slotWhen(slot)}</span>
              </span>
              <span class="hs-sc-file">
                <code dir="ltr">{slot}.mp3</code>
                <span class={`hs-sc-state ${file !== null ? 'is-found' : 'is-missing'}`} data-testid={`sc-state-${slot}`}>
                  {file !== null ? (
                    <>
                      ✓ נמצא: <bdi dir="ltr">{file}</bdi>
                    </>
                  ) : (
                    missingText(slot)
                  )}
                </span>
                {levels !== null ? <span class="hs-sc-levels">{levels}</span> : null}
              </span>
              <Btn
                label={on ? 'עצור' : 'נגן'}
                icon={on ? '⏹' : '▶'}
                tone={on ? 'danger' : 'primary'}
                class="hs-sc-play"
                disabled={pb === null}
                title={pb === null ? 'אין מה לנגן: שקט' : undefined}
                testId={`sc-play-${slot}`}
                onClick={() => (on ? stop() : play(slot))}
              />
            </li>
          );
        })}
      </ul>
      <p class="hs-sc-foot">
        הקבצים בתיקייה <code dir="ltr">client/public/audio/</code>, ונקלטים רק בבנייה: אחרי הוספת קובץ בונים ומעלים מחדש (או מפעילים מחדש את <code dir="ltr">npm run dev</code>). עוצמות ונקודת התחלה: <code dir="ltr">client/src/host/music-config.ts</code>.
      </p>
    </Modal>
  );
}
