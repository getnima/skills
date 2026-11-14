/**
 * WebAudio synth: the sound effects are generated, except a few drop-in clips from
 * client/public/audio (the air horn and the gong) that play when their file exists and
 * fall back to a synth otherwise.
 * Everything here is safe to call before the audio is unlocked, when the
 * AudioContext is missing, and when muted: it then simply does nothing.
 */
import { findPublicFile } from './files';

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ctxFailed = false;
let muted = readMuted();
const muteListeners = new Set<(muted: boolean) => void>();
const readyQueue: Array<() => void> = [];

const MASTER_VOLUME = 0.85;

function readMuted(): boolean {
  try {
    return localStorage.getItem('party.muted') === '1';
  } catch {
    return false;
  }
}

/** The shared AudioContext (created lazily), or null where WebAudio is missing. */
export function getAudioContext(): AudioContext | null {
  if (ctx || ctxFailed) return ctx;
  try {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      ctxFailed = true;
      return null;
    }
    ctx = new Ctor({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(comp);
    ctx.addEventListener('statechange', flushReady);
  } catch {
    ctxFailed = true;
    ctx = null;
    master = null;
  }
  return ctx;
}

/** Master output node (honors mute), or null without WebAudio. Connect custom synth graphs here. */
export function getAudioOutput(): GainNode | null {
  getAudioContext();
  return master;
}

function flushReady(): void {
  if (!ctx || ctx.state !== 'running') return;
  const fns = readyQueue.splice(0, readyQueue.length);
  for (const fn of fns) {
    try {
      fn();
    } catch {
      // a queued sound must never break the caller
    }
  }
}

/** Run `fn` once the AudioContext is actually running (now, or after the first gesture). */
export function whenAudioReady(fn: () => void): void {
  const c = getAudioContext();
  if (!c) return;
  if (c.state === 'running') {
    fn();
    return;
  }
  readyQueue.push(fn);
  void c.resume().then(flushReady, () => undefined);
}

/**
 * Unlock audio. Call from a user gesture (tap / click / key). The kit also
 * calls it by itself on the first pointerdown / keydown anywhere on the page.
 */
export function unlockAudio(): void {
  const c = getAudioContext();
  if (!c) return;
  try {
    if (c.state !== 'running') void c.resume().then(flushReady, () => undefined);
    // iOS needs a buffer started inside the gesture.
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch {
    // ignore
  }
}

/**
 * A hidden page (locked phone, another app, notification) plays nothing: Android
 * keeps a running AudioContext audible from a pocket otherwise. Back on screen it
 * resumes (iOS may still want a tap, which the auto-unlock below gives it).
 */
let suspendedByHide = false;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const c = ctx;
    if (!c) return;
    try {
      if (document.visibilityState === 'hidden') {
        if (c.state === 'running') {
          suspendedByHide = true;
          void c.suspend().catch(() => undefined);
        }
      } else if (suspendedByHide) {
        suspendedByHide = false;
        void c.resume().then(flushReady, () => undefined);
      }
    } catch {
      // ignore
    }
  });
}

if (typeof window !== 'undefined') {
  const auto = (): void => unlockAudio();
  window.addEventListener('pointerdown', auto, { capture: true, passive: true });
  window.addEventListener('touchend', auto, { capture: true, passive: true });
  window.addEventListener('keydown', auto, { capture: true, passive: true });
}

export function setMuted(m: boolean): void {
  if (m === muted) return;
  muted = m;
  try {
    localStorage.setItem('party.muted', m ? '1' : '0');
  } catch {
    // private mode: ignore
  }
  if (ctx && master) {
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(m ? 0 : MASTER_VOLUME, ctx.currentTime, 0.02);
    } catch {
      master.gain.value = m ? 0 : MASTER_VOLUME;
    }
  }
  for (const fn of [...muteListeners]) fn(m);
}

export function isMuted(): boolean {
  return muted;
}

export function onMuteChange(fn: (muted: boolean) => void): () => void {
  muteListeners.add(fn);
  return (): void => {
    muteListeners.delete(fn);
  };
}

// ───────────────────────────── Synth primitives ─────────────────────────────

export interface ToneOptions {
  /** Start frequency in Hz. */
  readonly freq: number;
  /** Glide to this frequency over the note (exponential). */
  readonly to?: number;
  /** Seconds. */
  readonly dur: number;
  readonly type?: OscillatorType;
  /** Peak gain 0..1 (default 0.2). */
  readonly vol?: number;
  /** Seconds from now (default 0), or an absolute context time when `abs` is set. */
  readonly at?: number;
  readonly abs?: boolean;
  /** Attack seconds (default 0.005). */
  readonly attack?: number;
  /** Vibrato: depth in Hz and rate in Hz. */
  readonly vibrato?: { readonly depth: number; readonly rate: number };
  /** Lowpass cutoff in Hz (brass / muffled sounds). */
  readonly lowpass?: number;
  /** Output node (default: the master output). */
  readonly dest?: AudioNode;
}

/** Usable context right now, or null (missing, still locked). */
function live(): AudioContext | null {
  const c = getAudioContext();
  if (!c || !master || c.state !== 'running') return null;
  return c;
}

/** One enveloped oscillator note. No-op while audio is locked. */
export function tone(o: ToneOptions): void {
  const c = live();
  if (!c || !master) return;
  try {
    const t0 = o.abs ? (o.at ?? c.currentTime) : c.currentTime + (o.at ?? 0);
    const vol = o.vol ?? 0.2;
    const attack = Math.min(o.attack ?? 0.005, o.dur * 0.5);
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.freq), t0);
    if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let head: AudioNode = osc;
    if (o.lowpass !== undefined) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      head.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(o.dest ?? master);
    if (o.vibrato) {
      const lfo = c.createOscillator();
      lfo.frequency.value = o.vibrato.rate;
      const lg = c.createGain();
      lg.gain.value = o.vibrato.depth;
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + o.dur + 0.05);
    }
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  } catch {
    // never let a sound break the game
  }
}

export interface NoiseOptions {
  readonly dur: number;
  readonly vol?: number;
  readonly at?: number;
  readonly abs?: boolean;
  readonly attack?: number;
  readonly filter?: { readonly type: BiquadFilterType; readonly freq: number; readonly to?: number; readonly q?: number };
  readonly dest?: AudioNode;
}

let noiseBuf: AudioBuffer | null = null;

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = Math.floor(c.sampleRate * 1.5);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuf = buf;
  return buf;
}

/** One enveloped burst of (optionally filtered) white noise. */
export function noise(o: NoiseOptions): void {
  const c = live();
  if (!c || !master) return;
  try {
    const t0 = o.abs ? (o.at ?? c.currentTime) : c.currentTime + (o.at ?? 0);
    const vol = o.vol ?? 0.2;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + Math.min(o.attack ?? 0.004, o.dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let head: AudioNode = src;
    if (o.filter) {
      const f = c.createBiquadFilter();
      f.type = o.filter.type;
      f.frequency.setValueAtTime(o.filter.freq, t0);
      if (o.filter.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(1, o.filter.to), t0 + o.dur);
      f.Q.value = o.filter.q ?? 1;
      head.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(o.dest ?? master);
    src.start(t0, Math.random());
    src.stop(t0 + o.dur + 0.05);
  } catch {
    // ignore
  }
}

/** MIDI note number → Hz (69 = A4 = 440). */
export function midiHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * Short brass-like flourish (~2.2s). `at` is seconds from now. Shared by
 * sfx.fanfare and the 'fanfare' fallback of kit/music.
 */
export function playFanfare(at = 0, dest?: AudioNode): void {
  const notes: ReadonlyArray<readonly [number, number, number]> = [
    // [midi, start, dur]
    [67, 0.0, 0.16],
    [72, 0.16, 0.16],
    [76, 0.32, 0.16],
    [79, 0.48, 0.34],
    [76, 0.86, 0.16],
    [79, 1.04, 1.1],
  ];
  for (const [m, start, dur] of notes) {
    const f = midiHz(m);
    tone({ freq: f, dur: dur + 0.08, type: 'sawtooth', vol: 0.16, at: at + start, attack: 0.03, lowpass: 2600, dest });
    tone({ freq: f * 1.005, dur: dur + 0.08, type: 'square', vol: 0.06, at: at + start, attack: 0.03, lowpass: 1800, dest });
    tone({ freq: f / 2, dur: dur + 0.08, type: 'sawtooth', vol: 0.08, at: at + start, attack: 0.03, lowpass: 1200, dest });
  }
  tone({ freq: midiHz(84), dur: 1.1, type: 'sawtooth', vol: 0.08, at: at + 1.04, attack: 0.05, lowpass: 3000, dest });
  noise({ dur: 0.9, vol: 0.1, at: at + 1.04, filter: { type: 'highpass', freq: 5000 }, dest });
}

// ───────────────────────────── Sound effects ─────────────────────────────

let fartTurn = 0;

function fart(variant?: number, pitch = 1): void {
  const c = live();
  if (!c || !master) return;
  const v = variant === undefined ? fartTurn++ % 4 : ((Math.floor(variant) % 4) + 4) % 4;
  try {
    const t0 = c.currentTime;
    // [duration, start Hz, end Hz, wobble Hz, wobble depth, sputter Hz (0 = none)]
    const shapes: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
      [0.22, 120, 70, 38, 30, 0], // short "prrt"
      [0.85, 150, 48, 24, 40, 0], // the long sad one
      [0.4, 150, 330, 46, 45, 0], // squeaker
      [0.6, 95, 60, 30, 28, 19], // wet sputter
    ];
    const s = shapes[v];
    if (!s) return;
    const [dur, f0, f1, wobHz, wobDepth, sputter] = s;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * pitch, t0);
    osc.frequency.exponentialRampToValueAtTime(f1 * pitch, t0 + dur);
    const lfo = c.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = wobHz;
    const lg = c.createGain();
    lg.gain.value = wobDepth * pitch;
    lfo.connect(lg);
    lg.connect(osc.frequency);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900 * pitch, t0);
    lp.frequency.exponentialRampToValueAtTime(260 * pitch, t0 + dur);
    lp.Q.value = 5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.34, t0 + 0.02);
    g.gain.setValueAtTime(0.3, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(lp);
    lp.connect(g);
    let tail: AudioNode = g;
    if (sputter > 0) {
      const chop = c.createGain();
      chop.gain.value = 0.55;
      const sq = c.createOscillator();
      sq.type = 'square';
      sq.frequency.value = sputter;
      const sg = c.createGain();
      sg.gain.value = 0.45;
      sq.connect(sg);
      sg.connect(chop.gain);
      sq.start(t0);
      sq.stop(t0 + dur + 0.05);
      g.connect(chop);
      tail = chop;
    }
    tail.connect(master);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + dur + 0.05);
    lfo.stop(t0 + dur + 0.05);
    noise({ dur: dur * 0.8, vol: 0.05, filter: { type: 'bandpass', freq: 500 * pitch, q: 2 } });
  } catch {
    // ignore
  }
}

function drumroll(ms = 1600): void {
  const total = Math.max(0.2, ms / 1000);
  const hits = Math.floor(total * 26);
  for (let i = 0; i < hits; i++) {
    const p = i / hits;
    noise({
      dur: 0.05,
      vol: 0.05 + 0.16 * p * p + (i % 2 === 0 ? 0.02 : 0),
      at: (i / hits) * total,
      filter: { type: 'bandpass', freq: 1400 + 500 * p, q: 0.8 },
    });
  }
}

// ───────────────────────────── Drop-in clips ─────────────────────────────

const CLIP_EXTS = ['mp3', 'm4a', 'ogg', 'wav', 'webm'] as const;
const clips = new Map<string, Promise<AudioBuffer | null>>();
/** Clips already decoded (a scheduled cue needs the buffer now, not a promise). */
const decoded = new Map<string, AudioBuffer | null>();
/** Clips whose file is there but did not load (the network, the decoder): decodeClip tries them again. */
const clipFailed = new Set<string>();

/** Decode /audio/<name>.mp3 (or another extension) once; null when there is no such file or it does not decode. */
function loadClip(name: string): Promise<AudioBuffer | null> {
  const known = clips.get(name);
  if (known) return known;
  const url = findPublicFile(`/audio/${name}.mp3`, CLIP_EXTS);
  const c = getAudioContext();
  const p: Promise<AudioBuffer | null> =
    url === null || !c
      ? Promise.resolve(null)
      : fetch(url)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((b) => c.decodeAudioData(b))
          .catch(() => {
            clipFailed.add(name);
            return null;
          });
  clips.set(name, p);
  void p.then((b) => decoded.set(name, b));
  return p;
}

/** Decode clips ahead, so the first one plays right on its moment (e.g. when the TV boots). */
export function preloadClips(names: readonly string[]): void {
  for (const n of names) void loadClip(n);
}

/**
 * Decode a clip ahead and say whether it is ready to play (false: no such file, no WebAudio, or
 * it did not load). For the preloader (kit/preload.ts): the `after` of the clip's file, run once
 * the file is in the HTTP cache. Unlike a play, it tries again a clip that failed to load earlier,
 * so one bad moment on the network does not leave the synth playing in its place all night. (A
 * play never starts that second try itself: it would hold its sound back for as long as a fetch
 * takes.) Never rejects.
 */
export function decodeClip(name: string): Promise<boolean> {
  if (clipFailed.delete(name)) clips.delete(name);
  return loadClip(name).then((b) => b !== null);
}

/**
 * Play a drop-in clip through the master output (it honours mute), at most `maxS` seconds
 * (faded out over the last second). With no such file, or one that does not decode, `fallback`
 * plays instead. A clip still decoding plays when ready, unless its moment has passed (1.5 s).
 */
function playClip(name: string, fallback: () => void, vol = 1, maxS = 0): void {
  const asked = performance.now();
  void loadClip(name).then((buf) => {
    if (!buf) {
      fallback();
      return;
    }
    if (performance.now() - asked > 1500) return;
    const c = live();
    if (!c || !master) return;
    try {
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      const t0 = c.currentTime;
      g.gain.setValueAtTime(vol, t0);
      const len = maxS > 0 ? Math.min(maxS, buf.duration) : buf.duration;
      if (maxS > 0 && buf.duration > maxS) {
        g.gain.setValueAtTime(vol, t0 + Math.max(0, len - 1));
        g.gain.linearRampToValueAtTime(0.0001, t0 + len);
      }
      src.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + len + 0.02);
    } catch {
      // never let a sound break the show
    }
  });
}

/** A struck gong (the fallback when gong.mp3 is missing): a low inharmonic ring with a long tail. */
function gongSynth(): void {
  const partials: ReadonlyArray<readonly [number, number, number]> = [
    // [Hz, peak, seconds]
    [98, 0.32, 3.6],
    [146, 0.2, 3.0],
    [207, 0.14, 2.4],
    [263, 0.1, 2.0],
    [349, 0.07, 1.6],
  ];
  for (const [f, v, d] of partials) tone({ freq: f, to: f * 0.985, dur: d, type: 'sine', vol: v, attack: 0.01, vibrato: { depth: f * 0.004, rate: 4.5 } });
  noise({ dur: 0.25, vol: 0.12, filter: { type: 'bandpass', freq: 900, q: 0.8 } });
}

/** The DJ air horn: airhorn.mp3 when it is there, else the synthesized one. */
function airhorn(pitch = 1): void {
  playClip('airhorn', () => airhornSynth(pitch), 0.9);
}

/** The gong: gong.mp3 (at most 4.5 s) when it is there, else a synthesized gong. */
function gong(): void {
  playClip('gong', gongSynth, 0.9, 4.5);
}

/** A drop-in clip's file is in client/public/audio/ (known at build time; it may still be decoding). */
export function hasClip(name: string): boolean {
  return findPublicFile(`/audio/${name}.mp3`, CLIP_EXTS) !== null;
}

/** How long a decoded clip is (ms), or null while it is not decoded (or there is no such file). */
export function clipMs(name: string): number | null {
  const b = decoded.get(name);
  return b ? Math.round(b.duration * 1000) : null;
}

/**
 * The podium's drum roll: drumroll.mp3 (the owner's file, 14.11) for at most `ms`, faded over its
 * last second when the file is longer; without the file, the synthesized roll for `ms`.
 */
function podiumDrumroll(ms = 4_200): void {
  playClip('drumroll', () => drumroll(ms), 1, ms / 1000);
}

// ───────────────────────────── Cues on the audio clock ─────────────────────────────

/**
 * How long after the page plays a sound it leaves the output device, as the browser reports it
 * (AudioContext.outputLatency + baseLatency; an AirPlay output can report its whole buffer), or
 * null where the browser does not say or audio is not running yet.
 */
export function reportedOutputLatencyMs(): number | null {
  const c = live();
  if (!c) return null;
  const out = (c as AudioContext & { readonly outputLatency?: number }).outputLatency;
  if (typeof out !== 'number' || !Number.isFinite(out) || out <= 0) return null;
  const base = Number.isFinite(c.baseLatency) ? c.baseLatency : 0;
  return (out + base) * 1000;
}

/**
 * A countdown's sounds, scheduled on the audio clock for an exact moment (sample-accurate, not a
 * timer that fires when the page gets round to it): 'beep' for 3 and 2, 'beepHigh' for 1, 'gong'
 * for a round's start (gong.mp3 when it is decoded, else the synthesized gong), 'go' after a pause.
 */
export type CueKind = 'beep' | 'beepHigh' | 'gong' | 'go';

/**
 * Schedule a cue `inMs` from now. Returns a cancel that stops it if it has not finished, or null
 * when nothing was scheduled (audio locked, muted context missing, or the moment already passed).
 */
export function scheduleCue(kind: CueKind, inMs: number): (() => void) | null {
  const c = live();
  if (!c || !master || inMs < -30) return null;
  const when = c.currentTime + Math.max(0, inMs) / 1000;
  const nodes: AudioScheduledSourceNode[] = [];
  const note = (freq: number, dur: number, type: OscillatorType, vol: number, at = 0): void => {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when + at);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when + at);
    g.gain.linearRampToValueAtTime(vol, when + at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + at + dur);
    osc.connect(g);
    g.connect(master as AudioNode);
    osc.start(when + at);
    osc.stop(when + at + dur + 0.05);
    nodes.push(osc);
  };
  try {
    if (kind === 'beep') {
      note(660, 0.2, 'square', 0.13);
      note(1320, 0.12, 'sine', 0.05);
    } else if (kind === 'beepHigh') {
      note(880, 0.26, 'square', 0.14);
      note(1760, 0.16, 'sine', 0.06);
    } else if (kind === 'go') {
      note(1040, 0.45, 'square', 0.11);
      note(1560, 0.45, 'triangle', 0.09);
    } else {
      const buf = decoded.get('gong') ?? null;
      if (buf !== null) {
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        const len = Math.min(4.5, buf.duration);
        g.gain.setValueAtTime(0.9, when);
        if (buf.duration > 4.5) {
          g.gain.setValueAtTime(0.9, when + len - 1);
          g.gain.linearRampToValueAtTime(0.0001, when + len);
        }
        src.connect(g);
        g.connect(master);
        src.start(when);
        src.stop(when + len + 0.02);
        nodes.push(src);
      } else {
        // the synthesized gong, on the same moment
        const partials: ReadonlyArray<readonly [number, number, number]> = [
          [98, 0.32, 3.6],
          [146, 0.2, 3.0],
          [207, 0.14, 2.4],
          [263, 0.1, 2.0],
          [349, 0.07, 1.6],
        ];
        for (const [f, v, d] of partials) note(f, d, 'sine', v);
      }
    }
  } catch {
    // never let a sound break the show
  }
  return () => {
    for (const n of nodes) {
      try {
        n.stop();
      } catch {
        // already stopped
      }
    }
  };
}

/** A soft-clip curve for the air horn's rasp (made once). */
let hornCurve: Float32Array<ArrayBuffer> | null = null;
function hornShape(): Float32Array<ArrayBuffer> {
  if (hornCurve) return hornCurve;
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 3.2);
  }
  hornCurve = c;
  return c;
}

/**
 * The synthesized DJ air horn (the fallback when airhorn.mp3 is missing): "bwa-bwa-bwaaaa".
 * Three blasts of a detuned, rasped sawtooth stack with a nasal formant, each scooping up into
 * pitch and the last one sagging at its end. `pitch` 1 = about B♭4.
 */
function airhornSynth(pitch = 1): void {
  const c = live();
  if (!c || !master) return;
  try {
    const t0 = c.currentTime + 0.02;
    const f = 466 * pitch;
    // the bus: rasp -> nasal peak -> top cut -> level
    const shaper = c.createWaveShaper();
    shaper.curve = hornShape();
    const peak = c.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 1650;
    peak.Q.value = 1.6;
    peak.gain.value = 9;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    const out = c.createGain();
    out.gain.value = 0.22;
    shaper.connect(peak);
    peak.connect(lp);
    lp.connect(out);
    out.connect(master);
    // [start, length] of each blast
    const blasts: ReadonlyArray<readonly [number, number]> = [
      [0, 0.13],
      [0.19, 0.13],
      [0.38, 0.78],
    ];
    const end = t0 + 0.38 + 0.78 + 0.12;
    for (const [i, [at, len]] of blasts.entries()) {
      const s = t0 + at;
      const last = i === blasts.length - 1;
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, s);
      env.gain.linearRampToValueAtTime(1, s + 0.012);
      env.gain.setValueAtTime(1, s + len - 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, s + len + 0.06);
      env.connect(shaper);
      for (const [mul, type, vol] of [
        [1, 'sawtooth', 0.42],
        [1.006, 'sawtooth', 0.34],
        [0.994, 'sawtooth', 0.34],
        [2.003, 'square', 0.12],
        [0.5, 'sawtooth', 0.16],
      ] as const) {
        const o = c.createOscillator();
        o.type = type;
        const fo = f * mul;
        // the scoop up into the note, and the sag at the end of the long blast
        o.frequency.setValueAtTime(fo * 0.82, s);
        o.frequency.exponentialRampToValueAtTime(fo, s + 0.045);
        if (last) {
          o.frequency.setValueAtTime(fo, s + len - 0.2);
          o.frequency.exponentialRampToValueAtTime(fo * 0.9, s + len + 0.06);
        }
        const g = c.createGain();
        g.gain.value = vol;
        o.connect(g);
        g.connect(env);
        o.start(s);
        o.stop(s + len + 0.1);
      }
      // the air in the horn
      noise({ dur: len + 0.05, vol: 0.05, at: s, abs: true, attack: 0.01, filter: { type: 'bandpass', freq: 2600, q: 0.9 } });
    }
    // let the bus go once the last blast is over
    const stopper = c.createConstantSource();
    stopper.onended = (): void => out.disconnect();
    stopper.start(t0);
    stopper.stop(end);
  } catch {
    // never let a sound break the show
  }
}

function laugh(pitch = 1): void {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const f = (520 - i * 34) * pitch;
    tone({ freq: f * 1.25, to: f, dur: 0.1, type: 'triangle', vol: 0.2, at: i * 0.13, attack: 0.012 });
    tone({ freq: f * 2.5, to: f * 2, dur: 0.07, type: 'sine', vol: 0.05, at: i * 0.13 });
  }
}

/**
 * The sound effects. Every entry is fire-and-forget and silent while audio is
 * locked or muted. `pitch` is a multiplier (1 = normal): raise it with a
 * combo for free juice, e.g. sfx.pop(1 + combo * 0.06).
 */
export const sfx = {
  /** Tiny UI / tap blip. */
  tap: (pitch = 1): void => tone({ freq: 700 * pitch, to: 480 * pitch, dur: 0.05, type: 'triangle', vol: 0.18 }),
  /** Bubbly pop (scored a point). */
  pop: (pitch = 1): void => tone({ freq: 380 * pitch, to: 980 * pitch, dur: 0.09, type: 'sine', vol: 0.3 }),
  /** Two-note pickup. */
  coin: (pitch = 1): void => {
    tone({ freq: 988 * pitch, dur: 0.08, type: 'square', vol: 0.1 });
    tone({ freq: 1319 * pitch, dur: 0.26, type: 'square', vol: 0.1, at: 0.07 });
  },
  /** Airy swipe. */
  whoosh: (pitch = 1): void =>
    noise({ dur: 0.24, vol: 0.2, attack: 0.08, filter: { type: 'bandpass', freq: 500 * pitch, to: 2600 * pitch, q: 1.4 } }),
  /** Blade slice (sharper whoosh). */
  slice: (pitch = 1): void => {
    noise({ dur: 0.13, vol: 0.2, attack: 0.01, filter: { type: 'highpass', freq: 1800 * pitch, to: 6000 * pitch } });
    tone({ freq: 1500 * pitch, to: 500 * pitch, dur: 0.1, type: 'sine', vol: 0.06 });
  },
  jump: (pitch = 1): void => tone({ freq: 250 * pitch, to: 640 * pitch, dur: 0.17, type: 'square', vol: 0.1 }),
  /** Soft landing / bounce thud. */
  land: (pitch = 1): void => tone({ freq: 190 * pitch, to: 90 * pitch, dur: 0.09, type: 'sine', vol: 0.25 }),
  /** Got hurt / bumped into something. */
  hit: (): void => {
    noise({ dur: 0.14, vol: 0.28, filter: { type: 'lowpass', freq: 1400, to: 300 } });
    tone({ freq: 170, to: 55, dur: 0.2, type: 'sine', vol: 0.35 });
  },
  explode: (): void => {
    noise({ dur: 0.7, vol: 0.42, filter: { type: 'lowpass', freq: 2400, to: 70 } });
    tone({ freq: 120, to: 28, dur: 0.6, type: 'sine', vol: 0.45 });
    noise({ dur: 0.12, vol: 0.3, filter: { type: 'highpass', freq: 2500 } });
  },
  /** Wet splat (sliced something juicy). */
  splat: (pitch = 1): void => {
    noise({ dur: 0.16, vol: 0.24, filter: { type: 'bandpass', freq: 900 * pitch, to: 250 * pitch, q: 2.5 } });
    tone({ freq: 300 * pitch, to: 110 * pitch, dur: 0.12, type: 'sine', vol: 0.16 });
  },
  /**
   * Four funny variants: 0 short, 1 long and sad, 2 squeaker, 3 wet sputter.
   * No variant = they take turns. `pitch` 0.6 (bass) .. 1.8 (mouse).
   */
  fart,
  /** Rising arpeggio (right answer, new best). */
  success: (): void => {
    const notes = [72, 76, 79, 84];
    notes.forEach((m, i) => tone({ freq: midiHz(m), dur: i === 3 ? 0.3 : 0.12, type: 'triangle', vol: 0.2, at: i * 0.075 }));
  },
  /** Sad two-step (wrong answer, died). */
  fail: (): void => {
    tone({ freq: 300, to: 220, dur: 0.18, type: 'sawtooth', vol: 0.12, lowpass: 1500 });
    tone({ freq: 210, to: 95, dur: 0.38, type: 'sawtooth', vol: 0.12, at: 0.17, lowpass: 1200 });
  },
  /** Clock tick (last seconds). */
  tick: (pitch = 1): void => tone({ freq: 1050 * pitch, dur: 0.035, type: 'square', vol: 0.08 }),
  /** Countdown beep (3, 2, 1). */
  beep: (): void => tone({ freq: 520, dur: 0.16, type: 'square', vol: 0.11 }),
  /** The "GO!" beep. */
  go: (): void => {
    tone({ freq: 1040, dur: 0.45, type: 'square', vol: 0.11 });
    tone({ freq: 1560, dur: 0.45, type: 'triangle', vol: 0.09 });
  },
  /** Snare roll with a crescendo, `ms` long (default 1600). */
  drumroll,
  /** Brass flourish (~2s). */
  fanfare: (): void => playFanfare(0),
  /** The DJ air horn (airhorn.mp3, ~2.8 s; a synthesized "bwa-bwa-bwaaaa" without it): the TV plays it when the show switches to the next game. */
  airhorn,
  /** A gong (~4 s): the TV strikes it when a round starts and when it is over. */
  gong,
  /** The podium's drum roll while the curtain is still closed (drumroll.mp3; the synthesized roll without it). */
  podiumDrumroll,
  /** Crowd-ish swell. */
  cheer: (): void => {
    noise({ dur: 1.3, vol: 0.2, attack: 0.3, filter: { type: 'bandpass', freq: 1100, to: 2100, q: 0.7 } });
    for (let i = 0; i < 5; i++) tone({ freq: 700 + i * 130, to: 1000 + i * 150, dur: 0.3, type: 'sine', vol: 0.03, at: 0.1 + i * 0.12 });
  },
  boo: (): void => {
    tone({ freq: 165, to: 120, dur: 0.9, type: 'sawtooth', vol: 0.14, attack: 0.08, lowpass: 700, vibrato: { depth: 5, rate: 6 } });
    tone({ freq: 124, to: 92, dur: 0.9, type: 'sawtooth', vol: 0.12, attack: 0.08, lowpass: 600, vibrato: { depth: 4, rate: 5 } });
  },
  /** "Ha-ha-ha" blips. */
  laugh,
  /** Cartoon slide-whistle down (falling). */
  fall: (): void => tone({ freq: 900, to: 140, dur: 0.55, type: 'sine', vol: 0.16 }),
  /** Keyboard click (typing a letter). */
  key: (pitch = 1): void => tone({ freq: 440 * pitch, dur: 0.04, type: 'square', vol: 0.06 }),
} as const;
