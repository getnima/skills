/**
 * Juice: particles, confetti, floating score text, screen shake, tweens.
 *
 * One Fx per game: call fx.update(dt) from the loop's update and fx.draw(ctx)
 * from its render. Everything advances only inside update(), so it freezes
 * with the game; update() is also a no-op while the kit is paused, for callers
 * that drive it from their own frame callback.
 * Pools are fixed-size: nothing is allocated per particle.
 */
import { drawText } from './canvas';
import { isKitPaused } from './loop';
import { PARTY_COLORS, font } from './theme';

// ───────────────────────────── Easing ─────────────────────────────

export type EaseFn = (t: number) => number;

/** Easing functions, t in 0..1 → 0..1 (outBack / outElastic overshoot on purpose). */
export const ease = {
  linear: (t: number): number => t,
  inQuad: (t: number): number => t * t,
  outQuad: (t: number): number => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t: number): number => t * t * t,
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number): number => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  outElastic: (t: number): number =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  outBounce: (t: number): number => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
} as const satisfies Record<string, EaseFn>;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ───────────────────────────── Types ─────────────────────────────

export interface BurstOptions {
  /** How many particles (default 12). */
  readonly count?: number;
  /** One color or a list to pick from (default: the party palette). */
  readonly colors?: string | readonly string[];
  /** Launch speed in px/s (default 260); each particle gets 40%..100% of it. */
  readonly speed?: number;
  /** Radius in px (default 5). */
  readonly size?: number;
  /** Seconds (default 0.6). */
  readonly life?: number;
  /** px/s² downwards (default 700). */
  readonly gravity?: number;
  /** Direction in radians (0 = right, -PI/2 = up) and the arc around it (default: full circle). */
  readonly angle?: number;
  readonly spread?: number;
  /** 'dot' (default), 'square' or 'star'. */
  readonly shape?: 'dot' | 'square' | 'star';
}

export interface ConfettiOptions {
  /** Pieces (default 60). */
  readonly count?: number;
  /** Rain from the top across this width, or shoot up from a point when x/y are given. */
  readonly width?: number;
  readonly x?: number;
  readonly y?: number;
  readonly colors?: readonly string[];
}

export interface FloatTextOptions {
  readonly color?: string;
  /** Font px (default 26). */
  readonly size?: number;
  /** Seconds (default 0.9). */
  readonly life?: number;
  /** px travelled upwards over its life (default 60). */
  readonly rise?: number;
}

export interface TweenOptions {
  /** Duration in ms of game time. */
  readonly ms: number;
  readonly from?: number;
  readonly to?: number;
  readonly ease?: EaseFn;
  /** Wait this many ms of game time first. */
  readonly delay?: number;
  /** Called every step with the eased value between from and to. */
  update(value: number): void;
  done?(): void;
}

export interface Fx {
  /** Radial burst of particles at (x, y). */
  burst(x: number, y: number, opts?: BurstOptions): void;
  /** Tumbling paper confetti. */
  confetti(opts?: ConfettiOptions): void;
  /** Floating text such as "+10" that rises and fades. */
  text(x: number, y: number, text: string, opts?: FloatTextOptions): void;
  /** Screen shake: `strength` px, decaying over `ms` (default 300). */
  shake(strength: number, ms?: number): void;
  /** Current shake offset. Use via applyShake(), or read for DOM transforms. */
  readonly shakeX: number;
  readonly shakeY: number;
  /** ctx.translate by the current shake. Wrap the world in save() / restore(). */
  applyShake(ctx: CanvasRenderingContext2D): void;
  /** Tween a number in game time. Returns a cancel function. */
  tween(opts: TweenOptions): () => void;
  /** Advance everything by dt seconds. Call once per loop update. */
  update(dt: number): void;
  /** Draw particles, confetti and texts (call after the world, outside the shake transform or inside: your choice). */
  draw(ctx: CanvasRenderingContext2D): void;
  /** Drop everything. */
  clear(): void;
  /** Live particle count (debugging). */
  readonly count: number;
}

// ───────────────────────────── Implementation ─────────────────────────────

const SHAPE_DOT = 0;
const SHAPE_SQUARE = 1;
const SHAPE_STAR = 2;
const SHAPE_PAPER = 3;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  drag: number;
  color: string;
  shape: number;
}

interface FloatText {
  x: number;
  y: number;
  life: number;
  max: number;
  rise: number;
  size: number;
  color: string;
  text: string;
}

interface Tween {
  t: number;
  readonly o: TweenOptions;
  dead: boolean;
}

function starPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** `maxParticles` is the fixed pool size (default 500); extra spawns are dropped. */
export function createFx(maxParticles = 500): Fx {
  const pool: Particle[] = [];
  for (let i = 0; i < maxParticles; i++) {
    pool.push({ x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, size: 1, rot: 0, vr: 0, drag: 0, color: '#fff', shape: 0 });
  }
  let live = 0;
  const texts: FloatText[] = [];
  const tweens: Tween[] = [];
  let shakeStrength = 0;
  let shakeLeft = 0;
  let shakeTotal = 1;
  let shakeX = 0;
  let shakeY = 0;

  function spawn(): Particle | null {
    if (live >= pool.length) return null;
    return pool[live++] ?? null;
  }

  function pickColor(colors: string | readonly string[] | undefined): string {
    if (typeof colors === 'string') return colors;
    const list = colors && colors.length > 0 ? colors : PARTY_COLORS;
    return list[Math.floor(Math.random() * list.length)] ?? '#fff';
  }

  function burst(x: number, y: number, o: BurstOptions = {}): void {
    const count = o.count ?? 12;
    const speed = o.speed ?? 260;
    const spread = o.spread ?? Math.PI * 2;
    const angle = o.angle ?? 0;
    const shape = o.shape === 'square' ? SHAPE_SQUARE : o.shape === 'star' ? SHAPE_STAR : SHAPE_DOT;
    for (let i = 0; i < count; i++) {
      const p = spawn();
      if (!p) return;
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.4 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.g = o.gravity ?? 700;
      p.max = (o.life ?? 0.6) * (0.7 + Math.random() * 0.6);
      p.life = p.max;
      p.size = (o.size ?? 5) * (0.6 + Math.random() * 0.8);
      p.rot = Math.random() * Math.PI * 2;
      p.vr = (Math.random() - 0.5) * 12;
      p.drag = 1.5;
      p.color = pickColor(o.colors);
      p.shape = shape;
    }
  }

  function confetti(o: ConfettiOptions = {}): void {
    const count = o.count ?? 60;
    const fromPoint = o.x !== undefined && o.y !== undefined;
    const width = o.width ?? 400;
    for (let i = 0; i < count; i++) {
      const p = spawn();
      if (!p) return;
      if (fromPoint) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
        const v = 350 + Math.random() * 450;
        p.x = o.x ?? 0;
        p.y = o.y ?? 0;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v;
      } else {
        p.x = Math.random() * width;
        p.y = -20 - Math.random() * 160;
        p.vx = (Math.random() - 0.5) * 120;
        p.vy = 60 + Math.random() * 160;
      }
      p.g = 520;
      p.max = 2.2 + Math.random() * 1.6;
      p.life = p.max;
      p.size = 6 + Math.random() * 6;
      p.rot = Math.random() * Math.PI * 2;
      p.vr = (Math.random() - 0.5) * 16;
      p.drag = 2.2;
      p.color = pickColor(o.colors);
      p.shape = SHAPE_PAPER;
    }
  }

  function text(x: number, y: number, str: string, o: FloatTextOptions = {}): void {
    if (texts.length >= 40) texts.shift();
    const max = o.life ?? 0.9;
    texts.push({ x, y, life: max, max, rise: o.rise ?? 60, size: o.size ?? 26, color: o.color ?? '#ffffff', text: str });
  }

  function shake(strength: number, ms = 300): void {
    if (strength >= shakeStrength * (shakeLeft / shakeTotal)) {
      shakeStrength = strength;
      shakeLeft = ms / 1000;
      shakeTotal = Math.max(0.001, shakeLeft);
    }
  }

  function tween(o: TweenOptions): () => void {
    const tw: Tween = { t: -(o.delay ?? 0) / 1000, o, dead: false };
    tweens.push(tw);
    return (): void => {
      tw.dead = true;
    };
  }

  function update(dt: number): void {
    if (isKitPaused()) return;

    for (let i = live - 1; i >= 0; i--) {
      const p = pool[i];
      if (!p) continue;
      p.life -= dt;
      if (p.life <= 0) {
        live--;
        const lastP = pool[live];
        if (lastP && lastP !== p) {
          pool[live] = p;
          pool[i] = lastP;
        }
        continue;
      }
      const k = 1 - p.drag * dt;
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }

    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      if (!t) continue;
      t.life -= dt;
      if (t.life <= 0) texts.splice(i, 1);
    }

    if (shakeLeft > 0) {
      shakeLeft -= dt;
      if (shakeLeft <= 0) {
        shakeLeft = 0;
        shakeStrength = 0;
        shakeX = 0;
        shakeY = 0;
      } else {
        const s = shakeStrength * (shakeLeft / shakeTotal);
        shakeX = (Math.random() * 2 - 1) * s;
        shakeY = (Math.random() * 2 - 1) * s;
      }
    }

    let deadTweens = 0;
    const n = tweens.length;
    for (let i = 0; i < n; i++) {
      const tw = tweens[i];
      if (!tw) continue;
      if (!tw.dead) {
        tw.t += dt;
        if (tw.t >= 0) {
          const dur = Math.max(0.0001, tw.o.ms / 1000);
          const p = Math.min(1, tw.t / dur);
          const from = tw.o.from ?? 0;
          const to = tw.o.to ?? 1;
          tw.o.update(from + (to - from) * (tw.o.ease ?? ease.outCubic)(p));
          if (p >= 1) {
            tw.dead = true;
            tw.o.done?.();
          }
        }
      }
      if (tw.dead) deadTweens++;
    }
    if (deadTweens > 0) {
      let w = 0;
      for (let i = 0; i < tweens.length; i++) {
        const tw = tweens[i];
        if (tw && !tw.dead) tweens[w++] = tw;
      }
      tweens.length = w;
    }
  }

  function draw(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < live; i++) {
      const p = pool[i];
      if (!p) continue;
      const a = p.life / p.max;
      ctx.fillStyle = p.color;
      if (p.shape === SHAPE_DOT) {
        ctx.globalAlpha = a < 0.5 ? a * 2 : 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.globalAlpha = a < 0.3 ? a / 0.3 : 1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.shape === SHAPE_PAPER) {
        // squash along one axis to fake a 3D tumble
        ctx.scale(1, Math.cos(p.rot * 1.7));
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      } else if (p.shape === SHAPE_SQUARE) {
        ctx.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
      } else {
        starPath(ctx, p.size * 1.6);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (texts.length > 0) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (const t of texts) {
        const p = 1 - t.life / t.max;
        const scale = p < 0.15 ? ease.outBack(p / 0.15) : 1;
        ctx.globalAlpha = p > 0.65 ? 1 - (p - 0.65) / 0.35 : 1;
        ctx.font = font(t.size * scale);
        const y = t.y - t.rise * ease.outCubic(p);
        ctx.lineWidth = Math.max(3, t.size * 0.18);
        ctx.strokeStyle = 'rgba(20, 8, 50, 0.85)';
        ctx.fillStyle = t.color;
        drawText(ctx, t.text, t.x, y, true);
      }
      ctx.restore();
    }
  }

  return {
    burst,
    confetti,
    text,
    shake,
    get shakeX(): number {
      return shakeX;
    },
    get shakeY(): number {
      return shakeY;
    },
    applyShake(ctx: CanvasRenderingContext2D): void {
      if (shakeX !== 0 || shakeY !== 0) ctx.translate(shakeX, shakeY);
    },
    tween,
    update,
    draw,
    clear(): void {
      live = 0;
      texts.length = 0;
      tweens.length = 0;
      shakeLeft = 0;
      shakeStrength = 0;
      shakeX = 0;
      shakeY = 0;
    },
    get count(): number {
      return live;
    },
  };
}
