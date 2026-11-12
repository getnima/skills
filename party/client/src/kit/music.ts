/**
 * Song slots. playTrack('victory') plays client/public/audio/victory.mp3
 * (or .m4a / .ogg / .wav) when that file exists; otherwise a synthesized
 * fallback. Drop the real song in tomorrow: no code change.
 * Tracks are NOT game time: they keep playing through a kit freeze.
 */
import { getAudioContext, getAudioOutput, isMuted, midiHz, noise, onMuteChange, playFanfare, tone, whenAudioReady } from './audio';
import { findPublicFile } from './files';

export type TrackFallback = 'victory' | 'fanfare' | 'none';

export interface PlayTrackOptions {
  /** Repeat until stopTrack (default false). */
  readonly loop?: boolean;
  /** 0..1 (default 1). */
  readonly volume?: number;
  /**
   * What to play when no audio file exists for the name. Default: 'victory'
   * for names starting with "victory", 'fanfare' for names starting with
   * "fanfare", otherwise 'none'.
   */
  readonly fallback?: TrackFallback;
}

interface Track {
  readonly name: string;
  stopped: boolean;
  el: HTMLAudioElement | null;
  gain: GainNode | null;
  loopTimer: ReturnType<typeof setTimeout> | null;
  fadeTimer: ReturnType<typeof setInterval> | null;
  /** Paused because the page went hidden; played again when it is visible. */
  hiddenPause?: boolean;
}

const AUDIO_EXTS = ['mp3', 'm4a', 'ogg', 'wav', 'webm'] as const;
const tracks = new Map<string, Track>();
/** Names passed to playTrack, in order (read by the browser tests through window.__partyMusic). */
const startedLog: string[] = [];

declare global {
  interface Window {
    __partyMusic?: { readonly started: readonly string[]; playing(name: string): boolean };
  }
}
if (typeof window !== 'undefined') {
  window.__partyMusic = { started: startedLog, playing: (name: string): boolean => isTrackPlaying(name) };
}

// A song file must not keep playing from a locked phone or a background tab.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    for (const t of tracks.values()) {
      const el = t.el;
      if (!el || t.stopped) continue;
      try {
        if (hidden && !el.paused) {
          t.hiddenPause = true;
          el.pause();
        } else if (!hidden && t.hiddenPause) {
          t.hiddenPause = false;
          void el.play().catch(() => undefined);
        }
      } catch {
        // ignore
      }
    }
  });
}

onMuteChange((m) => {
  for (const t of tracks.values()) if (t.el) t.el.muted = m;
});

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function defaultFallback(name: string): TrackFallback {
  if (name.startsWith('victory')) return 'victory';
  if (name.startsWith('fanfare')) return 'fanfare';
  return 'none';
}

/** True when a real audio file is present for this track name. */
export function hasTrackFile(name: string): boolean {
  return findPublicFile(`/audio/${name}.mp3`, AUDIO_EXTS) !== null;
}

/**
 * Start a track (restarts it when it is already playing). Never throws; a
 * missing file is silent and falls back to the synth.
 */
export function playTrack(name: string, opts: PlayTrackOptions = {}): void {
  try {
    kill(name);
    startedLog.push(name);
    if (startedLog.length > 200) startedLog.shift();
    const track: Track = { name, stopped: false, el: null, gain: null, loopTimer: null, fadeTimer: null };
    tracks.set(name, track);
    const volume = clamp01(opts.volume ?? 1);
    const loop = opts.loop ?? false;
    const fallback = opts.fallback ?? defaultFallback(name);
    const url = findPublicFile(`/audio/${name}.mp3`, AUDIO_EXTS);
    if (url !== null) playFile(track, url, loop, volume, fallback);
    else playSynth(track, fallback, loop, volume);
  } catch {
    // music must never break the show
  }
}

/** Stop one track, or every track when no name is given. Fades out over `fadeMs` (default 400). */
export function stopTrack(name?: string, fadeMs = 400): void {
  try {
    const list = name === undefined ? [...tracks.values()] : [tracks.get(name)];
    for (const t of list) if (t) fadeOut(t, Math.max(0, fadeMs));
  } catch {
    // ignore
  }
}

/** True while the named track is playing (or fading out is not counted). */
export function isTrackPlaying(name: string): boolean {
  const t = tracks.get(name);
  return t !== undefined && !t.stopped;
}

function forget(t: Track): void {
  if (tracks.get(t.name) === t) tracks.delete(t.name);
}

function release(t: Track): void {
  if (t.loopTimer !== null) clearTimeout(t.loopTimer);
  if (t.fadeTimer !== null) clearInterval(t.fadeTimer);
  t.loopTimer = null;
  t.fadeTimer = null;
  if (t.el) {
    try {
      t.el.pause();
      t.el.removeAttribute('src');
      t.el.load();
    } catch {
      // ignore
    }
    t.el = null;
  }
  if (t.gain) {
    try {
      t.gain.disconnect();
    } catch {
      // ignore
    }
    t.gain = null;
  }
}

/** Immediate stop (used for restarts). */
function kill(name: string): void {
  const t = tracks.get(name);
  if (!t) return;
  t.stopped = true;
  release(t);
  tracks.delete(name);
}

function fadeOut(t: Track, fadeMs: number): void {
  if (t.stopped) return;
  t.stopped = true;
  forget(t);
  if (t.loopTimer !== null) clearTimeout(t.loopTimer);
  t.loopTimer = null;
  if (fadeMs <= 0) {
    release(t);
    return;
  }
  const ctx = getAudioContext();
  if (t.gain && ctx) {
    try {
      const now = ctx.currentTime;
      t.gain.gain.cancelScheduledValues(now);
      t.gain.gain.setValueAtTime(t.gain.gain.value, now);
      t.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
    } catch {
      // ignore
    }
  }
  const el = t.el;
  const from = el ? el.volume : 0;
  const started = performance.now();
  t.fadeTimer = setInterval(() => {
    const p = (performance.now() - started) / fadeMs;
    if (p >= 1) {
      release(t);
      return;
    }
    if (el) el.volume = clamp01(from * (1 - p));
  }, 40);
}

// ───────────────────────────── File playback ─────────────────────────────

function playFile(t: Track, url: string, loop: boolean, volume: number, fallback: TrackFallback): void {
  const el = new Audio();
  el.preload = 'auto';
  el.loop = loop;
  el.volume = volume;
  el.muted = isMuted();
  el.src = url;
  t.el = el;
  let fellBack = false;
  const toSynth = (): void => {
    if (fellBack || t.stopped) return;
    fellBack = true;
    t.el = null;
    playSynth(t, fallback, loop, volume);
  };
  el.addEventListener('error', toSynth);
  el.addEventListener('ended', () => {
    if (!el.loop && !t.stopped) {
      t.stopped = true;
      release(t);
      forget(t);
    }
  });
  const attempt = (): void => {
    if (t.stopped || fellBack) return;
    el.play().catch((err: unknown) => {
      if (t.stopped || fellBack) return;
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError') {
        // Autoplay policy: start on the first gesture instead.
        const retry = (): void => {
          window.removeEventListener('pointerdown', retry, true);
          window.removeEventListener('keydown', retry, true);
          attempt();
        };
        window.addEventListener('pointerdown', retry, true);
        window.addEventListener('keydown', retry, true);
      } else if (name !== 'AbortError') {
        toSynth();
      }
    });
  };
  attempt();
}

// ───────────────────────────── Synth fallbacks ─────────────────────────────

function playSynth(t: Track, kind: TrackFallback, loop: boolean, volume: number): void {
  if (kind === 'none') {
    t.stopped = true;
    forget(t);
    return;
  }
  whenAudioReady(() => {
    if (t.stopped) return;
    const ctx = getAudioContext();
    const out = getAudioOutput();
    if (!ctx || !out) return;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(out);
    t.gain = gain;
    const lengthS = kind === 'victory' ? VICTORY_LEN_S : FANFARE_LEN_S;
    const schedule = (at: number): void => {
      if (t.stopped) return;
      if (kind === 'victory') scheduleVictory(at, gain);
      else playFanfare(Math.max(0, at - ctx.currentTime), gain);
      const next = at + lengthS;
      const waitMs = Math.max(0, (next - ctx.currentTime - 0.25) * 1000);
      t.loopTimer = setTimeout(() => {
        if (t.stopped) return;
        if (loop) {
          schedule(Math.max(next, ctx.currentTime + 0.02));
          return;
        }
        // let the last notes ring out, then free the slot
        t.loopTimer = setTimeout(() => {
          if (t.stopped) return;
          t.stopped = true;
          release(t);
          forget(t);
        }, 1400);
      }, waitMs);
    };
    schedule(ctx.currentTime + 0.06);
  });
}

const FANFARE_LEN_S = 2.4;

// The fallback victory tune: 4 bars of 4/4 in C major, I - IV - V - I.
const BPM = 112;
const EIGHTH_S = 60 / BPM / 2;
const BAR_S = EIGHTH_S * 8;
const VICTORY_LEN_S = BAR_S * 4;

/** [midi note, length in eighths] per bar. Each bar adds up to 8. */
const MELODY: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[72, 1], [72, 1], [76, 1], [79, 2], [79, 1], [76, 1], [79, 1]],
  [[81, 2], [81, 1], [79, 1], [77, 1], [81, 1], [79, 2]],
  [[79, 1], [77, 1], [76, 1], [74, 2], [74, 1], [76, 1], [77, 1]],
  [[79, 2], [76, 1], [72, 1], [84, 4]],
];
/** Bass root (midi) and the triad above it, per bar. */
const HARMONY: ReadonlyArray<{ readonly root: number; readonly chord: readonly number[] }> = [
  { root: 36, chord: [60, 64, 67] },
  { root: 41, chord: [60, 65, 69] },
  { root: 43, chord: [59, 62, 67] },
  { root: 36, chord: [60, 64, 67] },
];

function scheduleVictory(t0: number, dest: AudioNode): void {
  for (let bar = 0; bar < 4; bar++) {
    const barAt = t0 + bar * BAR_S;
    const harmony = HARMONY[bar];
    const melody = MELODY[bar];
    if (!harmony || !melody) continue;

    // lead: two detuned voices + a sparkle an octave up
    let step = 0;
    for (const [m, len] of melody) {
      const at = barAt + step * EIGHTH_S;
      const dur = len * EIGHTH_S * 0.92;
      const f = midiHz(m);
      tone({ freq: f, dur, type: 'square', vol: 0.085, at, abs: true, attack: 0.012, lowpass: 3200, dest });
      tone({ freq: f * 1.006, dur, type: 'sawtooth', vol: 0.07, at, abs: true, attack: 0.012, lowpass: 2600, dest });
      tone({ freq: f * 2, dur: Math.min(dur, 0.16), type: 'triangle', vol: 0.035, at, abs: true, dest });
      step += len;
    }

    // bass: bouncing octaves on every eighth
    for (let i = 0; i < 8; i++) {
      const m = harmony.root + (i % 2 === 0 ? 0 : 12);
      tone({ freq: midiHz(m), dur: EIGHTH_S * 0.85, type: 'triangle', vol: 0.2, at: barAt + i * EIGHTH_S, abs: true, dest });
    }

    // pad: off-beat chord stabs
    for (let beat = 0; beat < 4; beat++) {
      const at = barAt + (beat * 2 + 1) * EIGHTH_S;
      for (const m of harmony.chord) {
        tone({ freq: midiHz(m), dur: EIGHTH_S * 0.7, type: 'sawtooth', vol: 0.028, at, abs: true, lowpass: 1800, dest });
      }
    }

    // drums: kick on every beat, clap on 2 and 4, hats on the off-beats
    for (let beat = 0; beat < 4; beat++) {
      const at = barAt + beat * 2 * EIGHTH_S;
      tone({ freq: 150, to: 42, dur: 0.16, type: 'sine', vol: 0.36, at, abs: true, dest });
      if (beat % 2 === 1) {
        noise({ dur: 0.13, vol: 0.2, at, abs: true, filter: { type: 'bandpass', freq: 1500, q: 0.9 }, dest });
        noise({ dur: 0.05, vol: 0.14, at: at + 0.012, abs: true, filter: { type: 'bandpass', freq: 1900, q: 0.9 }, dest });
      }
      noise({ dur: 0.04, vol: 0.06, at: at + EIGHTH_S, abs: true, filter: { type: 'highpass', freq: 7000 }, dest });
    }
  }
  // crash into the loop point / the ending
  noise({ dur: 0.9, vol: 0.09, at: t0 + 3 * BAR_S + 4 * EIGHTH_S, abs: true, filter: { type: 'highpass', freq: 5200 }, dest });
}
