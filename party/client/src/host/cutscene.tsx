/** The full-screen cutscene player and the host's cutscene menu. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { CUTSCENES } from '../../../shared/cutscenes';
import { GAMES } from '../../../shared/protocol';
import { allCutsceneStatuses, cutsceneUrl, resolveSources } from './media';
import { Btn, Modal, Switch } from './ui';

import type { JSX } from 'preact';
import type { CutsceneDef, CutsceneTrigger } from '../../../shared/cutscenes';
import type { CutsceneState } from '../../../shared/protocol';
import type { ServerClock } from '../net/connection';
import type { FileStatus } from './media';

const PLACEHOLDER_MS = 4_000;
/** A video that has not started playing by then is treated as broken. */
const START_TIMEOUT_MS = 9_000;
/** A host that re-attaches this late into a cutscene seeks the video instead of starting over. */
const SEEK_AFTER_MS = 1_500;

type Mode = { kind: 'loading' } | { kind: 'video'; sources: readonly string[]; index: number } | { kind: 'placeholder'; reason: 'missing' | 'failed' };

export interface CutscenePlayerProps {
  readonly cutscene: CutsceneState;
  readonly def: CutsceneDef | undefined;
  readonly clock: ServerClock;
  readonly muted: boolean;
  /** Emit host:cutsceneEnd (idempotent on the server). */
  onEnd(): void;
}

export function CutscenePlayer(props: CutscenePlayerProps): JSX.Element {
  const [mode, setMode] = useState<Mode>({ kind: 'loading' });
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [ended, setEnded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const endedRef = useRef(false);
  const startedRef = useRef(false);
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;
  const mutedRef = useRef(props.muted);
  mutedRef.current = props.muted;
  /** How far into the cutscene we are on mount (a TV refresh mid-video). */
  const offsetMs = useRef(Math.max(0, props.clock.now() - props.cutscene.startedAt));
  const title = props.def?.title ?? 'סרטון';
  const file = props.def?.file ?? `${props.cutscene.id}.mp4`;

  const finish = (): void => {
    if (endedRef.current) return;
    endedRef.current = true;
    setEnded(true);
    try {
      videoRef.current?.pause();
    } catch {
      // ignore
    }
    onEndRef.current();
  };

  // pick a source
  useEffect(() => {
    let alive = true;
    if (props.def === undefined) {
      setMode({ kind: 'placeholder', reason: 'missing' });
      return;
    }
    const sources = resolveSources(props.def);
    if (alive) setMode(sources.length > 0 ? { kind: 'video', sources, index: 0 } : { kind: 'placeholder', reason: 'missing' });
    return () => {
      alive = false;
    };
  }, []);

  // placeholder: a short card, then done (minus what already passed before a refresh)
  useEffect(() => {
    if (mode.kind !== 'placeholder') return;
    const started = performance.now();
    const left = Math.max(400, PLACEHOLDER_MS - (mode.reason === 'missing' ? offsetMs.current : 0));
    let raf = 0;
    const tick = (): void => {
      const p = Math.min(1, (performance.now() - started) / left);
      if (barRef.current) barRef.current.style.transform = `scaleX(${p})`;
      if (p >= 1) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // a hidden tab gets no animation frames: the card still ends on time
    const done = setTimeout(finish, left + 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [mode.kind]);

  // video: play with sound, else muted with a one-click unmute; progress line
  useEffect(() => {
    if (mode.kind !== 'video') return;
    const v = videoRef.current;
    if (!v) return;
    startedRef.current = false;
    const nextSource = (): void => {
      if (endedRef.current) return;
      if (mode.index + 1 < mode.sources.length) setMode({ ...mode, index: mode.index + 1 });
      else setMode({ kind: 'placeholder', reason: 'failed' });
    };
    const start = (): void => {
      if (offsetMs.current > SEEK_AFTER_MS && Number.isFinite(v.duration)) {
        const at = offsetMs.current / 1000;
        offsetMs.current = 0;
        if (at >= v.duration - 0.3) {
          finish();
          return;
        }
        try {
          v.currentTime = at;
        } catch {
          // ignore
        }
      }
      v.muted = mutedRef.current;
      v.play().catch((err: unknown) => {
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError') {
          v.muted = true;
          setNeedsUnmute(true);
          v.play().catch(() => nextSource());
        } else if (name !== 'AbortError') {
          nextSource();
        }
      });
    };
    const onMeta = (): void => start();
    const onPlaying = (): void => {
      startedRef.current = true;
    };
    const onError = (): void => nextSource();
    const onEnded = (): void => finish();
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('error', onError);
    v.addEventListener('ended', onEnded);
    // the file may have failed (or loaded) before these listeners existed
    if (v.error !== null) {
      nextSource();
      return undefined;
    }
    if (v.readyState >= 1) start();
    const watchdog = setTimeout(() => {
      if (!startedRef.current) nextSource();
    }, START_TIMEOUT_MS);
    let raf = 0;
    const tick = (): void => {
      if (barRef.current && v.duration > 0 && Number.isFinite(v.duration)) {
        barRef.current.style.transform = `scaleX(${Math.min(1, v.currentTime / v.duration)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      clearTimeout(watchdog);
      cancelAnimationFrame(raf);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('error', onError);
      v.removeEventListener('ended', onEnded);
    };
  }, [mode]);

  // the host's mute (M) also mutes the video
  useEffect(() => {
    const v = videoRef.current;
    if (v && !needsUnmute) v.muted = props.muted;
  }, [props.muted, needsUnmute]);

  const unmute = (): void => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = props.muted;
    setNeedsUnmute(false);
    void v.play().catch(() => undefined);
  };

  const src = mode.kind === 'video' ? mode.sources[mode.index] : undefined;
  return (
    <div class={`hs-cut ${ended ? 'is-ended' : ''}`} data-testid="cutscene" data-mode={mode.kind}>
      {src !== undefined ? (
        <video
          key={src}
          ref={videoRef}
          class="hs-cut-video"
          src={cutsceneUrl(src)}
          preload="auto"
          playsInline
          data-testid="cutscene-video"
          data-src={src}
        />
      ) : null}
      {mode.kind === 'placeholder' ? (
        <div class="hs-cut-ph" data-testid="cutscene-placeholder">
          <div class="hs-cut-ph-card">
            <div class="hs-cut-ph-clap">🎬</div>
            <div class="hs-cut-ph-title">כאן יהיה סרטון: {title}</div>
            <div class="hs-cut-ph-file">
              {mode.reason === 'missing' ? 'גררו קובץ לתיקייה' : 'הקובץ לא נפתח בדפדפן הזה. בדקו את'}{' '}
              <code dir="ltr">client/public/cutscenes/{file}</code>
            </div>
            <div class="hs-cut-ph-reel">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ animationDelay: `${i * 90}ms` }} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {mode.kind === 'loading' ? <div class="hs-cut-loading">🎬</div> : null}
      <div class="hs-cut-bar">
        <div class="hs-cut-bar-fill" ref={barRef} />
      </div>
      <div class="hs-cut-tools">
        {needsUnmute ? (
          <button type="button" class="hs-cut-unmute" onClick={unmute} data-testid="cutscene-unmute">
            🔊 הפעלת סאונד
          </button>
        ) : null}
        <button type="button" class="hs-cut-skip" onClick={finish} data-testid="cutscene-skip">
          דלג ⏭ <kbd>S</kbd>
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────── Menu ─────────────────────────────

export function triggerLabel(t: CutsceneTrigger): string {
  switch (t.at) {
    case 'manual':
      return 'ידני בלבד';
    case 'before':
      return `לפני ${GAMES[t.gameId].title}`;
    case 'during': {
      const s = Math.round(t.atMs / 1000);
      return t.gameId !== undefined ? `באמצע ${GAMES[t.gameId].title} (שנייה ${s})` : `באמצע כל משחק (שנייה ${s})`;
    }
    case 'after':
      return t.gameId !== undefined ? `בסוף ${GAMES[t.gameId].title}` : 'בסוף כל סיבוב';
    case 'final':
      return 'לפני הפודיום';
    default: {
      const _exhaustive: never = t;
      throw new Error(`Unhandled trigger: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

const STATUS_TEXT: Readonly<Record<FileStatus, string>> = {
  checking: 'בודק…',
  ok: 'יש קובץ',
  unplayable: 'קובץ שהדפדפן לא מנגן',
  missing: 'אין קובץ עדיין',
};

export function useCutsceneStatuses(): Readonly<Record<string, FileStatus>> {
  return useMemo(allCutsceneStatuses, []);
}

export interface CutsceneMenuProps {
  readonly auto: boolean;
  readonly playing: string | null;
  onAuto(on: boolean): void;
  onPlay(id: string): void;
  onClose(): void;
}

export function CutsceneMenu(props: CutsceneMenuProps): JSX.Element {
  const statuses = useCutsceneStatuses();
  return (
    <Modal title="🎬 סרטונים" wide onClose={props.onClose} testId="cutscene-menu">
      <div class="hs-cm-head">
        <Switch on={props.auto} label="הפעלה אוטומטית" testId="auto-switch" onChange={props.onAuto} />
        <span class="hs-cm-hint">כשפועל, סרטונים עם תזמון קופצים לבד (לפני / באמצע / אחרי משחק, לפני הפודיום)</span>
      </div>
      <ul class="hs-cm-list">
        {CUTSCENES.map((c) => {
          const st = statuses[c.id] ?? 'checking';
          return (
            <li class="hs-cm-row" key={c.id} data-testid={`cm-${c.id}`}>
              <span class={`hs-dot hs-dot--${st}`} title={STATUS_TEXT[st]} data-status={st} />
              <span class="hs-cm-main">
                <span class="hs-cm-title">{c.title}</span>
                <span class="hs-cm-meta">
                  {triggerLabel(c.when)}
                  {c.enabled === false ? ' · מושבת' : ''} · <span dir="ltr">{c.file}</span> · {STATUS_TEXT[st]}
                </span>
              </span>
              <Btn
                label="נגן"
                icon="▶"
                tone="primary"
                class="hs-cm-play"
                disabled={props.playing !== null}
                testId={`cm-play-${c.id}`}
                onClick={() => {
                  props.onClose();
                  props.onPlay(c.id);
                }}
              />
            </li>
          );
        })}
      </ul>
      <p class="hs-cm-foot">
        להוספת סרטון: שמים קובץ ב־<code dir="ltr">client/public/cutscenes/</code> ורושמים אותו ב־<code dir="ltr">shared/cutscenes.ts</code>.
      </p>
    </Modal>
  );
}
