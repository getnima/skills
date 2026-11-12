/**
 * The TV's A/V sync screen (AirPlay): a disc that flashes on every whole second of the server
 * clock, a beep on every flash, and the two delays (kit/av-sync.ts) to nudge until they meet:
 * the beep on the TV's flash (sound), the TV's flash with the remote's flash (picture). Opened
 * with A on the TV or from the remote (which shows its own flash, on the true clock, and the
 * same buttons). The values stay on this TV.
 */
import { useEffect } from 'preact/hooks';

import { scheduleCue } from '../kit/audio';
import { AIRPLAY_SOUND_MS, adjustAvSync, avSync, onAvSyncChange, pictureLeadMs, soundLeadMs, soundOffsetMs } from '../kit/av-sync';
import { Btn, Modal } from './ui';
import { useServerNow } from './util';
import './av-sync.css';

import type { JSX } from 'preact';
import type { ServerClock } from '../net/connection';

/** The flash lasts this long after each whole second. */
const FLASH_MS = 140;
/** Beeps are put on the audio clock this far ahead. */
const AHEAD_MS = 1_200;

/** 1..4: the count the disc shows for the second starting at `ms`. */
export function beatDigit(ms: number): number {
  return (((Math.floor(ms / 1_000) % 4) + 4) % 4) + 1;
}

/** Beeps on every whole server second, leaving early by the sound lead; re-planned when the lead changes. */
function useSyncBeeps(clock: ServerClock): void {
  useEffect(() => {
    const queued = new Map<number, () => void>();
    let planned = soundLeadMs();
    const tick = (): void => {
      const now = clock.now();
      const lead = soundLeadMs();
      if (lead !== planned) {
        for (const stop of queued.values()) stop();
        queued.clear();
        planned = lead;
      }
      for (let b = Math.ceil((now + lead) / 1_000) * 1_000; b - lead <= now + AHEAD_MS; b += 1_000) {
        if (queued.has(b)) continue;
        const stop = scheduleCue(beatDigit(b) === 1 ? 'beepHigh' : 'beep', b - lead - now);
        if (stop !== null) queued.set(b, stop);
      }
      for (const b of [...queued.keys()]) if (b - lead < now - 2_000) queued.delete(b);
    };
    tick();
    const id = setInterval(tick, 100);
    const off = onAvSyncChange(tick);
    return () => {
      clearInterval(id);
      off();
      for (const stop of queued.values()) stop();
    };
  }, [clock]);
}

function Row(props: {
  readonly icon: string;
  readonly title: string;
  readonly value: number;
  readonly note: string | null;
  readonly what: 'sound' | 'picture';
  readonly steps: readonly number[];
  readonly testId: string;
  onAdjust(arg: string): void;
}): JSX.Element {
  return (
    <div class="sy-row" data-testid={props.testId}>
      <div class="sy-row-head">
        <span class="sy-row-icon">{props.icon}</span>
        <span class="sy-row-title">{props.title}</span>
        <b class="sy-row-value" dir="ltr">
          {props.value.toLocaleString('en-US')}
        </b>
        <span class="sy-row-unit">מ״ש</span>
        {props.note !== null ? <span class="sy-row-note">{props.note}</span> : null}
      </div>
      <div class="sy-steps" dir="ltr">
        {props.steps.map((n) => (
          <button type="button" key={n} class="sy-step" onClick={() => props.onAdjust(`${props.what}:${n < 0 ? '-' : '+'}${Math.abs(n)}`)}>
            {n > 0 ? `+${n}` : `−${Math.abs(n)}`}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AvSyncScreen(props: { readonly clock: ServerClock; readonly pictureClock: ServerClock; onAdjust(arg: string): void; onClose(): void }): JSX.Element {
  useSyncBeeps(props.clock);
  // the disc is drawn on the picture clock (ahead by the picture delay), like the 3-2-1
  const now = useServerNow(props.pictureClock);
  const into = ((now % 1_000) + 1_000) % 1_000;
  const flash = into < FLASH_MS;
  const digit = beatDigit(now);
  const s = avSync();
  const sound = soundOffsetMs();

  // the TV's own keys: ↑/↓ the sound, →/← the picture (Shift: a big step); Esc closes (Modal)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const big = e.shiftKey;
      const arg =
        e.code === 'ArrowUp'
          ? `sound:+${big ? 200 : 20}`
          : e.code === 'ArrowDown'
            ? `sound:-${big ? 200 : 20}`
            : e.code === 'ArrowRight'
              ? `picture:+${big ? 50 : 10}`
              : e.code === 'ArrowLeft'
                ? `picture:-${big ? 50 : 10}`
                : null;
      if (arg === null) return;
      e.preventDefault();
      props.onAdjust(arg);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onAdjust]);

  return (
    <Modal title="⏱️ סנכרון סאונד ותמונה" wide onClose={props.onClose} testId="av-sync">
      <div class="sy-body">
        <div class="sy-stage">
          <div class={`sy-disc ${flash ? 'is-flash' : ''} ${digit === 1 ? 'is-one' : ''}`} data-testid="av-sync-disc" data-digit={digit}>
            <span dir="ltr">{digit}</span>
          </div>
          <p class="sy-stage-note">ביפ על כל הבהוב · הגבוה על 1</p>
        </div>
        <div class="sy-side">
          <ol class="sy-howto">
            <li>
              <b>🔊 צליל:</b> הביפ בדיוק על ההבהוב? הביפ מאחר ← <b>+</b> · מקדים ← <b>−</b>
            </li>
            <li>
              <b>📺 תמונה:</b> השלט ליד הטלוויזיה, מהבהבים יחד? הטלוויזיה מאחרת ← <b>+</b>
            </li>
          </ol>
          <Row
            icon="🔊"
            title="הצליל יוצא מוקדם ב־"
            value={sound}
            note={s.soundSet ? null : 'אוטומטי'}
            what="sound"
            steps={[-200, -20, 20, 200]}
            testId="av-sync-sound"
            onAdjust={props.onAdjust}
          />
          <Row
            icon="📺"
            title="התמונה מוקדמת ב־"
            value={pictureLeadMs()}
            note={null}
            what="picture"
            steps={[-50, -10, 10, 50]}
            testId="av-sync-picture"
            onAdjust={props.onAdjust}
          />
          <div class="sy-presets">
            <Btn label="רמקול AirPlay (2 שניות)" icon="🛜" testId="av-sync-airplay" onClick={() => props.onAdjust(`sound:=${AIRPLAY_SOUND_MS}`)} />
            <Btn label="אוטומטי" icon="🪄" onClick={() => props.onAdjust('sound:auto')} />
            <Btn label="איפוס" icon="↺" tone="ghost" onClick={() => props.onAdjust('reset')} />
            <Btn label="סיום" icon="✓" tone="primary" testId="av-sync-done" onClick={props.onClose} />
          </div>
          <p class="sy-keys">
            מקשים: <kbd>↑</kbd>/<kbd>↓</kbd> צליל · <kbd>→</kbd>/<kbd>←</kbd> תמונה · <kbd>Shift</kbd> צעד גדול · <kbd>Esc</kbd> סיום
          </p>
        </div>
      </div>
    </Modal>
  );
}

/** For the TV's keys and the remote: one adjustment (false: not understood). */
export function applyAvAdjust(arg: string | undefined): boolean {
  return arg !== undefined && adjustAvSync(arg);
}
