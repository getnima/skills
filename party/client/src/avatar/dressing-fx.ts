/**
 * Dressing room juice, ported in spirit from the owner's page (design/albert-14-11.source.html):
 * accessories fly onto the doll in their own style, flicked items tumble away under gravity,
 * "kaboom" bursts and sparks pop where things land. Plain DOM + Web Animations, in a layer that
 * covers the room (pointer-events: none). Every element removes itself; nothing throws.
 */
import type { AvatarFly } from './catalog';

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A running flight. `cancel` takes the sprite away at once (no landing); `finish` lands it now. */
export interface Flight {
  id: number;
  cancel(): void;
  finish(): void;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const qb = (a: number, b: number, c: number, t: number): number => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
const easeOut2 = (t: number): number => 1 - (1 - t) * (1 - t);
const easeOut3 = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Too many live effect nodes: skip decoration (never the flights themselves). */
const FX_BUDGET = 70;

interface Frame {
  x: number;
  y: number;
  r?: number;
  s?: number;
  sx?: number;
  sy?: number;
}
const T = (f: Frame): string =>
  `translate(${f.x.toFixed(1)}px,${f.y.toFixed(1)}px) rotate(${(f.r ?? 0).toFixed(1)}deg) scale(${((f.s ?? 1) * (f.sx ?? 1)).toFixed(3)},${((f.s ?? 1) * (f.sy ?? 1)).toFixed(3)})`;

function canAnimate(el: Element): boolean {
  return typeof (el as HTMLElement).animate === 'function';
}

function makeSprite(layer: HTMLElement, src: string, box: Rect, cls: string): HTMLImageElement {
  const im = new Image();
  im.src = src;
  im.alt = '';
  im.draggable = false;
  im.decoding = 'sync';
  im.className = cls;
  Object.assign(im.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
  layer.append(im);
  return im;
}

/** Plays keyframes and removes the element at the end (or after a safety timeout). */
function play(el: HTMLElement, kf: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  const kill = (): void => el.remove();
  if (!canAnimate(el)) {
    kill();
    return null;
  }
  const a = el.animate(kf, { fill: 'forwards', ...opts });
  a.onfinish = kill;
  a.oncancel = kill;
  const total = Number(opts.duration ?? 500) + Number(opts.delay ?? 0) + 1500;
  setTimeout(kill, total);
  return a;
}

interface FlightCtx {
  D: Pt; // start - target centre
  R: Rect; // doll-ish size for the boomerang
  VW: number;
  VH: number;
  spin: number;
}
interface Style {
  edges: readonly ('top' | 'bottom' | 'left' | 'right' | 'tile')[];
  dur: number;
  os: number;
  n: number;
  at(u: number, c: FlightCtx): Frame;
}

const STYLES: Record<AvatarFly, Style> = {
  lob: {
    edges: ['tile'],
    dur: 640,
    os: 0.04,
    n: 14,
    at(u, c) {
      const apex = Math.min(c.D.y, 0) - Math.max(60, c.VH * 0.16);
      return { x: lerp(c.D.x, 0, u), y: qb(c.D.y, apex, 0, u), r: c.spin * 360 * (1 - u), s: lerp(0.55, 1, u) + 0.28 * Math.sin(Math.PI * u) };
    },
  },
  frisbee: {
    edges: ['left', 'right'],
    dur: 620,
    os: 0.08,
    n: 14,
    at(u, c) {
      const t = easeOut3(u);
      const bend = Math.abs(c.D.x) * 0.16;
      const x = (1 - t) ** 3 * c.D.x + 3 * (1 - t) ** 2 * t * c.D.x * 0.66 + 3 * (1 - t) * t * t * c.D.x * 0.33;
      const y = (1 - t) ** 3 * c.D.y + 3 * (1 - t) ** 2 * t * (c.D.y * 0.66 - bend) + 3 * (1 - t) * t * t * (c.D.y * 0.33 + bend * 0.6);
      return { x, y, r: 14 * Math.sin(u * Math.PI * 4) * (1 - u), s: lerp(0.75, 1, t) + 0.1 * Math.sin(Math.PI * u), sy: lerp(0.5, 1, t) };
    },
  },
  boomerang: {
    edges: ['left', 'right'],
    dur: 760,
    os: 0.05,
    n: 18,
    at(u, c) {
      const side = c.D.x < 0 ? 1 : -1;
      const B = { x: side * c.R.w * 1.3, y: -c.R.h * 0.25 };
      let x: number;
      let y: number;
      let s: number;
      if (u <= 0.56) {
        const t = u / 0.56;
        x = qb(c.D.x, (c.D.x + B.x) / 2, B.x, t);
        y = qb(c.D.y, Math.min(c.D.y, B.y) - c.R.h * 0.2, B.y, t);
        s = lerp(0.65, 1.15, t);
      } else {
        const t = easeOut2((u - 0.56) / 0.44);
        x = qb(B.x, B.x + side * c.R.w * 0.4, 0, t);
        y = qb(B.y, c.R.h * 0.12, 0, t);
        s = lerp(1.15, 1, t);
      }
      return { x, y, s, r: c.spin * 900 * (1 - easeOut2(u)) };
    },
  },
  cannon: {
    edges: ['left', 'right'],
    dur: 360,
    os: 0.14,
    n: 10,
    at(u, c) {
      return { x: c.D.x * (1 - u), y: c.D.y * (1 - u) - Math.sin(Math.PI * u) * Math.abs(c.D.x) * 0.05, r: c.spin * 220 * (1 - u), s: lerp(0.82, 1, u) };
    },
  },
  ninja: {
    edges: ['top', 'left', 'right'],
    dur: 440,
    os: 0.06,
    n: 14,
    at(u, c) {
      const t = 1 - Math.pow(1 - u, 3.2);
      return { x: c.D.x * (1 - t), y: c.D.y * (1 - t), r: c.spin * 1080 * (1 - t), s: lerp(0.7, 1, t) };
    },
  },
  snapback: {
    edges: ['tile'],
    dur: 480,
    os: 0.07,
    n: 14,
    at(u, c) {
      const apex = Math.min(c.D.y, 0) - Math.max(40, c.VH * 0.12);
      return { x: lerp(c.D.x, 0, u), y: qb(c.D.y, apex, 0, u), r: c.spin * 540 * (1 - u), s: lerp(0.7, 1, u) + 0.15 * Math.sin(Math.PI * u), sy: Math.cos(u * Math.PI * 2) };
    },
  },
  feather: {
    edges: ['top'],
    dur: 860,
    os: 0,
    n: 18,
    at(u, c) {
      const t = easeOut2(u);
      const sway = Math.sin(u * Math.PI * 3.5) * Math.min(70, c.VW * 0.12) * (1 - u);
      return { x: c.D.x * (1 - t) + sway, y: c.D.y * (1 - t), r: 18 * Math.sin(u * Math.PI * 3.5 + 0.6) * (1 - u), s: lerp(0.85, 1, t) };
    },
  },
};

export interface FlyOptions {
  layer: HTMLElement;
  id: number;
  src: string;
  /** Final box of the picture in layer px. */
  to: Rect;
  /** The tapped tile's centre in layer px (lobs start there). */
  from: Pt | null;
  fly: AvatarFly | undefined;
  /** Size of the doll in layer px (the boomerang's swing). */
  doll: Rect;
  onLand: () => void;
}

/** Flies a picture onto the doll; `onLand` runs exactly once when (and only if) it lands. */
export function flyIn(o: FlyOptions): Flight {
  const style = STYLES[o.fly ?? 'lob'];
  const VW = o.layer.clientWidth || 360;
  const VH = o.layer.clientHeight || 640;
  const C = { x: o.to.x + o.to.w / 2, y: o.to.y + o.to.h / 2 };
  const ir = Math.max(o.to.w, o.to.h) / 2;
  const edge = style.edges[Math.floor(Math.random() * style.edges.length)] ?? 'tile';
  const m = ir + 20;
  let S: Pt;
  if (edge === 'tile' && o.from !== null) S = o.from;
  else if (edge === 'top' || (edge === 'tile' && o.from === null)) S = { x: clamp(C.x + rand(-0.25, 0.25) * VW, 20, VW - 20), y: -m };
  else if (edge === 'bottom') S = { x: rand(0.15, 0.85) * VW, y: VH + m };
  else if (edge === 'left') S = { x: -m, y: clamp(C.y + rand(-0.1, 0.15) * VH, 30, VH * 0.7) };
  else S = { x: VW + m, y: clamp(C.y + rand(-0.1, 0.15) * VH, 30, VH * 0.7) };
  const c: FlightCtx = { D: { x: S.x - C.x, y: S.y - C.y }, R: o.doll, VW, VH, spin: Math.random() < 0.5 ? -1 : 1 };

  const N = style.n;
  const frames: Frame[] = [];
  for (let i = 0; i < N; i++) frames.push(style.at(i / (N - 1), c));
  frames[N - 1] = { x: 0, y: 0 };
  const kf: Keyframe[] = frames.map((f, i) => ({ offset: (i / (N - 1)) * 0.84, transform: T(f) }));
  const a = frames[N - 2] ?? { x: 0, y: 0 };
  const len = Math.hypot(a.x, a.y) || 1;
  const os = style.os * Math.max(o.to.w, 60);
  kf.push({ offset: 0.92, transform: T({ x: (-a.x / len) * os, y: (-a.y / len) * os, r: -c.spin * 5, s: 1.04 }) });
  kf.push({ offset: 1, transform: T({ x: 0, y: 0 }) });

  const el = makeSprite(o.layer, o.src, o.to, 'drfx-flyer');
  let landed = false;
  let gone = false;
  const land = (): void => {
    if (landed || gone) return;
    landed = true;
    el.remove();
    o.onLand();
  };
  if (!canAnimate(el)) {
    land();
    return { id: o.id, cancel: () => undefined, finish: () => undefined };
  }
  const anim = el.animate(kf, { duration: style.dur, easing: 'linear', fill: 'forwards' });
  anim.onfinish = land;
  // never a ghost: whatever happens to the animation, the sprite is gone shortly after it should have landed
  const safety = setTimeout(land, style.dur + 1200);
  return {
    id: o.id,
    cancel(): void {
      if (landed || gone) return;
      gone = true;
      clearTimeout(safety);
      anim.onfinish = null;
      let base = '';
      try {
        base = getComputedStyle(el).transform;
      } catch {
        base = '';
      }
      anim.cancel();
      if (base === 'none') base = '';
      el.style.transform = base;
      const ang = rand(0, Math.PI * 2);
      play(el, [{ transform: base || 'none', opacity: 1 }, { transform: `translate(${Math.cos(ang) * 140}px,${Math.sin(ang) * 140}px) ${base}`, opacity: 0 }], { duration: 170, easing: 'ease-in' });
    },
    finish(): void {
      clearTimeout(safety);
      try {
        anim.onfinish = null;
        anim.cancel();
      } catch {
        /* ignore */
      }
      land();
    },
  };
}

/** A picture leaves the doll: it is knocked off and tumbles out of the room under gravity. */
export function tumble(layer: HTMLElement, src: string, box: Rect, dir: number, power = 1, delay = 0): void {
  if (layer.childElementCount > FX_BUDGET) return;
  const el = makeSprite(layer, src, box, 'drfx-flyer drfx-tumble');
  const VW = layer.clientWidth || 360;
  const VH = layer.clientHeight || 640;
  const g = 2600;
  const C = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const ir = Math.max(box.w, box.h) / 2;
  const k = clamp(VW / 400, 0.6, 1.2);
  const vx = dir * rand(340, 560) * power * k;
  const vy = -rand(700, 900) * Math.min(power, 1.25) * k;
  const spin = dir * rand(540, 1000);
  let Tt = (-vy + Math.sqrt(vy * vy + 2 * g * (VH + ir * 2.2 - C.y))) / g;
  const Ts = (vx > 0 ? VW + ir * 2.2 - C.x : -ir * 2.2 - C.x) / vx;
  if (Ts > 0.35) Tt = Math.min(Tt, Ts);
  Tt = clamp(Tt, 0.45, 1.4);
  const N = 12;
  const kf: Keyframe[] = [];
  for (let i = 0; i < N; i++) {
    const t = (Tt * i) / (N - 1);
    kf.push({ offset: i / (N - 1), transform: T({ x: vx * t, y: vy * t + 0.5 * g * t * t, r: (spin * t) / Tt, s: 1 + (0.15 * t) / Tt }) });
  }
  play(el, kf, { duration: Tt * 1000, delay, easing: 'linear' });
}

export interface BurstOptions {
  text: string;
  color?: string;
  big?: boolean;
  /** Size factor (1 = 200 px wide). */
  k?: number;
  rot?: number;
}

/** The comic "kaboom" sticker with a word in it. At most a few at a time. */
export function kaboom(layer: HTMLElement, p: Pt, o: BurstOptions): void {
  if (layer.childElementCount > FX_BUDGET) return;
  const old = layer.querySelectorAll('.drfx-kb');
  if (old.length > 3) old[0]?.remove();
  const b = document.createElement('div');
  b.className = `drfx-kb${o.big === true ? ' big' : ''}`;
  b.innerHTML = '<b></b><i></i><span></span>';
  const span = b.querySelector('span');
  if (span !== null) span.textContent = o.text;
  if (o.color !== undefined) b.style.setProperty('--b', o.color);
  const k = o.k ?? 1;
  const half = (o.big === true ? 120 : 84) * k;
  const VW = layer.clientWidth || 360;
  const VH = layer.clientHeight || 640;
  b.style.left = `${clamp(p.x, half + 4, VW - half - 4)}px`;
  b.style.top = `${clamp(p.y, 50 * k, VH - 50 * k)}px`;
  layer.append(b);
  const r = o.rot ?? rand(-14, 10);
  play(
    b,
    [
      { transform: `rotate(${r}deg) scale(0)`, opacity: 1 },
      { transform: `rotate(${r}deg) scale(${1.25 * k})`, opacity: 1, offset: 0.16 },
      { transform: `rotate(${r}deg) scale(${k})`, opacity: 1, offset: 0.32 },
      { transform: `rotate(${r}deg) scale(${k})`, opacity: 1, offset: 0.7 },
      { transform: `translateY(-22px) rotate(${r * 0.5}deg) scale(${1.06 * k})`, opacity: 0 },
    ],
    { duration: o.big === true ? 900 : 720, easing: 'ease-out' },
  );
}

/** A ring and a little star-burst of sparks in the item's colours. */
export function sparks(layer: HTMLElement, p: Pt, size: number, colors: readonly string[]): void {
  if (layer.childElementCount > FX_BUDGET) return;
  const s = clamp(size, 40, 220);
  const ring = document.createElement('div');
  ring.className = 'drfx-ring';
  Object.assign(ring.style, { left: `${p.x - s / 2}px`, top: `${p.y - s / 2}px`, width: `${s}px`, height: `${s}px` });
  layer.append(ring);
  play(ring, [{ transform: 'scale(.2)', opacity: 0.9 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' });
  const n = 8;
  const list = colors.length > 0 ? colors : ['#FFD21F', '#F2361B', '#4F6CFF'];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = i % 2 === 0 ? 'drfx-spark star' : 'drfx-spark';
    const ang = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
    const dist = s * rand(0.5, 0.95);
    d.style.left = `${p.x}px`;
    d.style.top = `${p.y}px`;
    d.style.background = list[i % list.length] ?? '#FFD21F';
    layer.append(d);
    play(d, [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * dist}px,${Math.sin(ang) * dist - 10}px) scale(.3) rotate(120deg)`, opacity: 0 }], {
      duration: rand(380, 560),
      easing: 'cubic-bezier(.15,.7,.3,1)',
    });
  }
}

/** Confetti from both bottom corners (the done button). */
export function confetti(layer: HTMLElement, colors: readonly string[]): void {
  const VW = layer.clientWidth || 360;
  const VH = layer.clientHeight || 640;
  const N = 30;
  const g = 2200;
  for (let i = 0; i < N; i++) {
    if (layer.childElementCount > FX_BUDGET + 30) return;
    const left = i % 2 === 0;
    const el = document.createElement('div');
    el.className = 'drfx-conf';
    const s = rand(8, 14);
    el.style.width = `${s}px`;
    el.style.height = `${s * rand(0.5, 1.4)}px`;
    el.style.background = colors[i % colors.length] ?? '#FFD21F';
    el.style.left = `${left ? -10 : VW + 10}px`;
    el.style.top = `${VH + 10}px`;
    layer.append(el);
    const ang = ((left ? -64 : -116) + rand(-18, 18)) * (Math.PI / 180);
    const sp = rand(1050, 1500) * Math.sqrt(VH / 800);
    const vx = Math.cos(ang) * sp;
    const vy = Math.sin(ang) * sp;
    const spin = rand(-720, 720);
    const Tt = clamp((-vy + Math.sqrt(vy * vy + 2 * g * 80)) / g, 1.1, 2.3);
    const kf: Keyframe[] = [];
    for (let k = 0; k < 10; k++) {
      const t = (Tt * k) / 9;
      kf.push({ offset: k / 9, transform: `translate(${vx * t}px,${vy * t + 0.5 * g * t * t}px) rotate(${spin * t}deg)` });
    }
    play(el, kf, { duration: Tt * 1000, delay: i * 14, easing: 'linear' });
  }
}

/** Removes every effect node at once (tab hidden, unmount). */
export function clearFx(layer: HTMLElement | null): void {
  if (layer === null) return;
  for (const a of layer.getAnimations?.({ subtree: true }) ?? []) {
    try {
      a.cancel();
    } catch {
      /* ignore */
    }
  }
  layer.replaceChildren();
}

/** The squash-and-settle of a picture that just landed, by flight style (the source's SQUASH). */
export function squashFrames(fly: AvatarFly | undefined): Keyframe[] {
  switch (fly) {
    case 'lob':
      return [{ transform: 'scale(1.22,.78)' }, { transform: 'scale(.94,1.07)' }, { transform: 'scale(1.02,.98)' }, { transform: 'none' }];
    case 'boomerang':
      return [{ transform: 'scale(.88,1.25)' }, { transform: 'scale(1.06,.86)' }, { transform: 'scale(.98,1.08)' }, { transform: 'none' }];
    case 'feather':
      return [{ transform: 'translateY(-2%) scale(1.06,.94)' }, { transform: 'translateY(1%) scale(.97,1.04)' }, { transform: 'none' }];
    case 'ninja':
      return [{ transform: 'scale(1.1,.9)' }, { transform: 'scale(.97,1.03)' }, { transform: 'none' }];
    case 'frisbee':
    case 'cannon':
    case 'snapback':
    case undefined:
      return [{ transform: 'scale(1.16,.84)' }, { transform: 'scale(.95,1.06)' }, { transform: 'scale(1.02,.98)' }, { transform: 'none' }];
    default: {
      const never: never = fly;
      return never;
    }
  }
}
