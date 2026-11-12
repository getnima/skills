/**
 * THE FUNNY LAYER, shared by every scene: the commentator, sticker fly-bys,
 * screen punches and confetti. It sits on top of a scene (pointer-events:
 * none), animates only transforms and opacity, caps what runs at the same
 * time, and obeys the global calm switch (settings.ts).
 */
import { useEffect, useRef } from 'preact/hooks';

import { sfx } from '../../kit/audio';
import { createRng } from '../../kit/rng';
import { commentatorUrl, commentatorUrls, STICKER_COUNT, stickerArt } from './art';
import { createConfetti } from './confetti';
import { createLinePicker } from './lines';
import { isShowCalm } from './settings';

import type { JSX } from 'preact';
import type { MascotMood, StickerArt } from './art';
import type { Confetti } from './confetti';
import type { LineArgs, LinePool } from './lines';
import type { Moment, MomentType } from './moments';

export type StickerStyle = 'bounce' | 'spin' | 'zoom' | 'rain';

export interface SayOptions {
  /** 1..10. A higher priority line waiting in the queue is spoken first. */
  readonly priority?: number;
  /** Speak now, replacing whatever is on screen (ceremonies). */
  readonly force?: boolean;
  /** The mascot loses its mind: jumps and shakes while it talks. */
  readonly crazy?: boolean;
  readonly holdMs?: number;
  /** Checked again when a queued line comes up: false drops it (the race moved on). */
  readonly valid?: () => boolean;
}

export interface FunnyLayer {
  say(text: string, mood: MascotMood, opts?: SayOptions): void;
  /** Pick a line from a pool (no repeats) and say it. */
  sayLine(pool: LinePool, args: LineArgs, mood: MascotMood, opts?: SayOptions): void;
  hush(): void;
  sticker(style: StickerStyle, art?: StickerArt): void;
  flash(color?: string): void;
  zoom(): void;
  /** Confetti from a point (0..1 of the scene). */
  burst(x: number, y: number, count?: number): void;
  cannons(count?: number): void;
  rain(count?: number): void;
  /**
   * React to a race moment: a mix of commentary, stickers, punches and sfx.
   * `force`: speak right now (the demo's moment buttons). Each kind of moment
   * has a cooldown; returns false when this one was dropped (nothing happened).
   */
  moment(m: Moment, force?: boolean, valid?: () => boolean): boolean;
  dispose(): void;
}

interface Pending {
  readonly text: string;
  readonly mood: MascotMood;
  readonly priority: number;
  readonly crazy: boolean;
  readonly holdMs: number;
  readonly at: number;
  readonly valid: (() => boolean) | null;
}

const MAX_STICKERS = 8;
const QUEUE_MAX = 3;
const STALE_MS = 4_500;
const GAP_MS = 1_400;
const CALM_GAP_MS = 9_000;
const PUNCH_GAP_MS = 1_100;
/** Sticker fly-bys of ordinary moments keep this distance; the big moments (priority 8+) always get theirs. */
const STICKER_GAP_MS = 2_600;
/** The same kind of race moment fires its effects at most this often. */
const MOMENT_GAP_MS: Partial<Record<MomentType, number>> = {
  lead: 3_500,
  overtake: 3_000,
  drop: 2_500,
  jump: 2_500,
  tie: 4_000,
  streak: 3_000,
  comeback: 3_000,
};
/** Any two ordinary moments (priority < 8) keep at least this distance. */
const ANY_MOMENT_GAP_MS = 700;

const MOMENT_MOOD: Readonly<Record<MomentType, MascotMood>> = {
  lead: 'happy',
  overtake: 'normal',
  jump: 'shocked',
  drop: 'laugh',
  tie: 'shocked',
  last: 'laugh',
  comeback: 'happy',
  zero: 'angry',
  final10: 'shocked',
  photo: 'shocked',
  streak: 'happy',
};

export function createFunnyLayer(host: HTMLElement, seed: number): FunnyLayer {
  const rng = createRng(seed).fork('funny');
  const random = (): number => rng.next();
  const picker = createLinePicker(random);

  const canvas = document.createElement('canvas');
  canvas.className = 'sh-fx-confetti';
  const stickers = document.createElement('div');
  stickers.className = 'sh-fx-stickers';
  const flashEl = document.createElement('div');
  flashEl.className = 'sh-fx-flash';
  const comm = document.createElement('div');
  comm.className = 'sh-comm';
  const pic = document.createElement('img');
  pic.className = 'sh-comm-pic';
  pic.alt = '';
  pic.decoding = 'async';
  pic.src = commentatorUrl('normal', 0);
  const bubble = document.createElement('div');
  bubble.className = 'sh-comm-bubble';
  bubble.dir = 'rtl';
  comm.append(pic, bubble);
  host.append(canvas, stickers, flashEl, comm);
  // warm the other pictures (the moods, or the second host) so the first swap does not blink
  for (const url of commentatorUrls()) new Image().src = url;

  const confetti: Confetti = createConfetti(canvas, random);
  const queue: Pending[] = [];
  let disposed = false;
  let speaking = false;
  let nextAllowed = 0;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;
  let liveStickers = 0;
  let lastPunch = 0;
  let lastSticker = Number.NEGATIVE_INFINITY;
  let stickerTurn = Math.floor(random() * STICKER_COUNT);
  /** Lines spoken so far: the two hosts take turns at the microphone. */
  let lineTurn = Math.floor(random() * 2);
  // tomorrow's funny photos: once any sticker file exists, fly-bys use the photos instead of themed emoji
  const realStickers: StickerArt[] = [];
  for (let i = 0; i < STICKER_COUNT; i++) {
    const a = stickerArt(i);
    if (a.kind === 'img') realStickers.push(a);
  }

  function themed(char: string): StickerArt {
    if (realStickers.length === 0) return { kind: 'emoji', char };
    return realStickers[stickerTurn++ % realStickers.length] ?? { kind: 'emoji', char };
  }

  function show(p: Pending): void {
    speaking = true;
    pic.src = commentatorUrl(p.mood, lineTurn++);
    bubble.textContent = p.text;
    comm.classList.toggle('is-crazy', p.crazy);
    comm.classList.remove('is-on');
    void comm.offsetWidth; // restart the entrance
    comm.classList.add('is-on');
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, p.holdMs);
  }

  function hide(): void {
    hideTimer = null;
    speaking = false;
    comm.classList.remove('is-on');
    nextAllowed = performance.now() + (isShowCalm() ? CALM_GAP_MS : GAP_MS);
    schedulePump();
  }

  function schedulePump(): void {
    if (pumpTimer !== null || disposed) return;
    const wait = Math.max(0, nextAllowed - performance.now());
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump();
    }, wait + 20);
  }

  function pump(): void {
    if (disposed || speaking) return;
    const now = performance.now();
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (q && (now - q.at > STALE_MS || (q.valid !== null && !q.valid()))) queue.splice(i, 1);
    }
    if (queue.length === 0) return;
    if (now < nextAllowed) {
      schedulePump();
      return;
    }
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
      if ((queue[i]?.priority ?? 0) > (queue[best]?.priority ?? 0)) best = i;
    }
    const [next] = queue.splice(best, 1);
    if (next) show(next);
  }

  function say(text: string, mood: MascotMood, opts: SayOptions = {}): void {
    if (disposed || text === '') return;
    const p: Pending = {
      text,
      mood,
      priority: opts.priority ?? 5,
      crazy: opts.crazy ?? false,
      holdMs: opts.holdMs ?? Math.min(4_400, Math.max(2_500, 1_700 + text.length * 48)),
      at: performance.now(),
      valid: opts.valid ?? null,
    };
    if (opts.force) {
      queue.length = 0;
      show(p);
      return;
    }
    if (isShowCalm() && p.priority < 7) return;
    queue.push(p);
    if (queue.length > QUEUE_MAX) {
      let worst = 0;
      for (let i = 1; i < queue.length; i++) {
        if ((queue[i]?.priority ?? 0) < (queue[worst]?.priority ?? 0)) worst = i;
      }
      queue.splice(worst, 1);
    }
    pump();
  }

  function sayLine(pool: LinePool, args: LineArgs, mood: MascotMood, opts?: SayOptions): void {
    say(picker.pick(pool, args), mood, opts);
  }

  function sticker(style: StickerStyle, art?: StickerArt): void {
    if (disposed || isShowCalm()) return;
    const W = host.clientWidth;
    const H = host.clientHeight;
    if (W === 0 || H === 0) return;
    const unit = Math.min(W / 1920, H / 1080) < 0.5 ? Math.min(W, H) / 640 : Math.min(W / 1920, H / 1080);
    const n = style === 'rain' ? 9 : 1;
    for (let i = 0; i < n; i++) {
      if (liveStickers >= MAX_STICKERS) return;
      const a = art ?? (realStickers.length > 0 ? themed('') : stickerArt(stickerTurn++));
      const size = (style === 'rain' ? 110 + random() * 70 : style === 'zoom' ? 300 : 200 + random() * 90) * unit;
      let el: HTMLElement;
      if (a.kind === 'img') {
        const img = document.createElement('img');
        img.src = a.url;
        img.alt = '';
        img.style.width = `${size}px`;
        img.style.height = `${size}px`;
        el = img;
      } else {
        el = document.createElement('span');
        el.textContent = a.char;
        el.style.fontSize = `${size * 0.82}px`;
      }
      el.className = 'sh-sticker';
      stickers.appendChild(el);
      liveStickers++;
      const half = size / 2;
      let frames: Keyframe[];
      let timing: KeyframeAnimationOptions;
      if (style === 'bounce') {
        const dir = random() < 0.5 ? 1 : -1;
        const x0 = dir > 0 ? -size : W + size;
        const x1 = dir > 0 ? W + size : -size;
        const floor = H * (0.78 + random() * 0.12) - half;
        const peak = H * (0.18 + random() * 0.2);
        frames = [];
        const hops = 3;
        for (let k = 0; k <= hops * 2; k++) {
          const p = k / (hops * 2);
          const y = k % 2 === 0 ? floor : peak + (floor - peak) * (k / (hops * 2)) * 0.5;
          frames.push({
            transform: `translate3d(${x0 + (x1 - x0) * p - half}px, ${y}px, 0) rotate(${dir * p * 540}deg) scale(${k % 2 === 0 ? '1.12, 0.88' : '1, 1'})`,
            easing: k % 2 === 0 ? 'cubic-bezier(0.2, 0.7, 0.5, 1)' : 'cubic-bezier(0.5, 0, 0.8, 0.3)',
          });
        }
        timing = { duration: 2_700 + random() * 500 };
      } else if (style === 'spin') {
        const dir = random() < 0.5 ? 1 : -1;
        const y0 = H * (0.1 + random() * 0.5);
        const y1 = H * (0.1 + random() * 0.5);
        frames = [
          { transform: `translate3d(${dir > 0 ? -size : W}px, ${y0}px, 0) rotate(0deg) scale(0.7)` },
          { transform: `translate3d(${W / 2 - half}px, ${(y0 + y1) / 2 - H * 0.08}px, 0) rotate(${dir * 540}deg) scale(1.35)` },
          { transform: `translate3d(${dir > 0 ? W : -size}px, ${y1}px, 0) rotate(${dir * 1080}deg) scale(0.7)` },
        ];
        timing = { duration: 2_100, easing: 'linear' };
      } else if (style === 'zoom') {
        const x = W * (0.3 + random() * 0.4) - half;
        const y = H * (0.22 + random() * 0.3) - half;
        const tilt = (random() - 0.5) * 30;
        frames = [
          { transform: `translate3d(${x}px, ${y}px, 0) scale(0.05) rotate(${tilt - 40}deg)`, opacity: 0 },
          { transform: `translate3d(${x}px, ${y}px, 0) scale(1.15) rotate(${tilt}deg)`, opacity: 1, offset: 0.22, easing: 'ease-out' },
          { transform: `translate3d(${x}px, ${y}px, 0) scale(0.95) rotate(${tilt + 4}deg)`, opacity: 1, offset: 0.34 },
          { transform: `translate3d(${x}px, ${y}px, 0) scale(1) rotate(${tilt - 3}deg)`, opacity: 1, offset: 0.7 },
          { transform: `translate3d(${x}px, ${y - H * 0.1}px, 0) scale(1.6) rotate(${tilt}deg)`, opacity: 0 },
        ];
        timing = { duration: 1_500 };
      } else {
        const x = random() * (W - size);
        const sway = (random() - 0.5) * W * 0.12;
        const turn = (random() - 0.5) * 500;
        frames = [
          { transform: `translate3d(${x}px, ${-size * 1.2}px, 0) rotate(0deg)` },
          { transform: `translate3d(${x + sway}px, ${H + size * 0.2}px, 0) rotate(${turn}deg)` },
        ];
        timing = { duration: 1_500 + random() * 900, delay: random() * 700, easing: 'cubic-bezier(0.4, 0, 0.9, 0.6)', fill: 'backwards' };
      }
      const anim = el.animate(frames, timing);
      const done = (): void => {
        if (el.isConnected) {
          el.remove();
          liveStickers--;
        }
      };
      anim.onfinish = done;
      anim.oncancel = done;
    }
  }

  function punchAllowed(): boolean {
    if (disposed || isShowCalm()) return false;
    const now = performance.now();
    if (now - lastPunch < PUNCH_GAP_MS) return false;
    lastPunch = now;
    return true;
  }

  function flash(color = '#ffffff'): void {
    if (!punchAllowed()) return;
    flashEl.style.backgroundColor = color;
    flashEl.animate([{ opacity: 0.35 }, { opacity: 0 }], { duration: 520, easing: 'ease-out' });
  }

  function zoom(): void {
    if (disposed || isShowCalm()) return;
    const scene = host.parentElement;
    if (!scene) return;
    scene.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: 0.3 }, { transform: 'scale(1)' }], {
      duration: 460,
      easing: 'ease-out',
    });
  }

  function scaled(count: number): number {
    return isShowCalm() ? Math.ceil(count * 0.25) : count;
  }

  const momentAt = new Map<MomentType, number>();
  let anyMomentAt = Number.NEGATIVE_INFINITY;

  function moment(m: Moment, force = false, valid?: () => boolean): boolean {
    if (disposed) return false;
    const t = performance.now();
    if (!force) {
      // rate limits: a leader change every 250 ms must not strobe the room
      if (t - (momentAt.get(m.type) ?? Number.NEGATIVE_INFINITY) < (MOMENT_GAP_MS[m.type] ?? 2_000)) return false;
      if (m.priority < 8 && t - anyMomentAt < ANY_MOMENT_GAP_MS) return false;
    }
    momentAt.set(m.type, t);
    anyMomentAt = t;
    const args: LineArgs = { a: m.a?.name, b: m.b?.name };
    const mood = MOMENT_MOOD[m.type];
    // no line twice in one round: a pool that ran dry stays quiet (the effects still play)
    const line = force ? picker.pick(m.type, args) : picker.fresh(m.type, args);
    if (line !== null) say(line, mood, { priority: m.priority, force, valid });
    const showy = force || m.priority >= 8 || t - lastSticker >= STICKER_GAP_MS;
    if (showy) lastSticker = t;
    const fly = (style: StickerStyle, art?: StickerArt): void => {
      if (showy) sticker(style, art);
    };
    switch (m.type) {
      case 'lead':
        sfx.success();
        confetti.shoot(0.5, 0.2, scaled(50), -Math.PI / 2, Math.PI * 2, 0.6);
        fly('zoom', themed('👑'));
        break;
      case 'overtake':
        sfx.whoosh();
        fly('bounce');
        break;
      case 'jump':
        sfx.coin();
        fly('spin', themed('🚀'));
        break;
      case 'drop':
        sfx.explode();
        flash('#f2361b');
        fly('rain', { kind: 'emoji', char: '💣' });
        break;
      case 'tie':
        sfx.beep();
        zoom();
        fly('zoom', themed('🤜'));
        break;
      case 'last':
        sfx.fart();
        fly('bounce', themed('🐌'));
        break;
      case 'comeback':
        sfx.cheer();
        fly('spin');
        confetti.shoot(0.5, 0.9, scaled(40), -Math.PI / 2, 1.2, 1.1);
        break;
      case 'zero':
        sfx.fail();
        fly('zoom', themed('😴'));
        break;
      case 'final10':
        sfx.go();
        flash('#ffd21f');
        zoom();
        fly('rain', { kind: 'emoji', char: '⏰' });
        break;
      case 'photo':
        sfx.slice();
        flash('#ffffff');
        fly('zoom', themed('📸'));
        break;
      case 'streak':
        sfx.success();
        fly('spin', themed('🔥'));
        break;
      default: {
        const _exhaustive: never = m.type;
        throw new Error(`Unhandled moment: ${String(_exhaustive)}`);
      }
    }
    return true;
  }

  return {
    say,
    sayLine,
    hush(): void {
      queue.length = 0;
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hide();
      }
    },
    sticker,
    flash,
    zoom,
    burst(x: number, y: number, count = 60): void {
      if (!disposed) confetti.shoot(x, y, scaled(count), -Math.PI / 2, Math.PI * 2, 0.75);
    },
    cannons(count = 90): void {
      if (!disposed) confetti.cannons(scaled(count));
    },
    rain(count = 80): void {
      if (!disposed) confetti.rain(scaled(count));
    },
    moment,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (hideTimer !== null) clearTimeout(hideTimer);
      if (pumpTimer !== null) clearTimeout(pumpTimer);
      confetti.dispose();
      for (const a of stickers.getAnimations({ subtree: true })) a.cancel();
      canvas.remove();
      stickers.remove();
      flashEl.remove();
      comm.remove();
    },
  };
}

/**
 * Mount the funny layer inside a scene: render `node` as the LAST child of the
 * scene root and call `layer()` from effects / frame callbacks.
 */
export function useFunnyLayer(seed: number): { node: JSX.Element; layer(): FunnyLayer | null } {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<FunnyLayer | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const layer = createFunnyLayer(host, seed);
    layerRef.current = layer;
    return () => {
      layer.dispose();
      layerRef.current = null;
    };
  }, [seed]);
  const get = useRef((): FunnyLayer | null => layerRef.current);
  return { node: <div class="sh-fx" ref={hostRef} aria-hidden="true" />, layer: get.current };
}
