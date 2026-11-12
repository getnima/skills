import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { JSX } from 'preact';

/** Avatar palette: PlayerPublic.avatar is an index into it (wraps around). */
export const AVATAR_COLORS: readonly string[] = [
  '#ff3d8b',
  '#2de2e6',
  '#ffd23f',
  '#3ddc84',
  '#8b5cf6',
  '#ff8a3d',
  '#4d8dff',
  '#ff6ad5',
  '#9be15d',
  '#f95f62',
  '#00c2a8',
  '#c77dff',
];

export function avatarColor(index: number): string {
  const n = AVATAR_COLORS.length;
  return AVATAR_COLORS[((Math.floor(index) % n) + n) % n] ?? '#ff3d8b';
}

export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first === undefined ? '?' : first.toUpperCase();
}

const numberFormat = new Intl.NumberFormat('en-US');

export function formatScore(n: number): string {
  return numberFormat.format(Math.round(n));
}

/** Wrap a name so a Latin / numeric name cannot scramble the Hebrew sentence around it. */
export function isolate(name: string): string {
  return `⁨${name}⁩`;
}

export interface AvatarProps {
  readonly avatar: number;
  readonly name: string;
  readonly class?: string;
}

export function Avatar(props: AvatarProps): JSX.Element {
  return (
    <span class={`sh-avatar ${props.class ?? ''}`} style={{ backgroundColor: avatarColor(props.avatar) }}>
      {initialOf(props.name)}
    </span>
  );
}

export interface StageSize {
  readonly w: number;
  readonly h: number;
  readonly portrait: boolean;
  /** One design unit in px: the scene is drawn on a 1920x1080 (landscape) or 640x1380 (portrait) board. */
  readonly u: number;
}

const NO_SIZE: StageSize = { w: 0, h: 0, portrait: false, u: 1 };

function measure(el: HTMLElement, land: readonly [number, number], port: readonly [number, number]): StageSize {
  const w = el.clientWidth;
  const h = el.clientHeight;
  const portrait = h > w * 1.05;
  const board = portrait ? port : land;
  const u = Math.max(0.05, Math.min(w / board[0], h / board[1]));
  return { w, h, portrait, u };
}

/**
 * Scene root helper: follows the size of the element, exposes it as the CSS
 * variable --u (px per design unit) plus data-orient, and returns the size so
 * a scene can lay rows out in px. Re-renders only on a real resize.
 */
export function useStage(
  land: readonly [number, number] = [1920, 1080],
  port: readonly [number, number] = [640, 1380],
): { ref: (el: HTMLElement | null) => void; size: StageSize } {
  const [size, setSize] = useState<StageSize>(NO_SIZE);
  const elRef = useRef<HTMLElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const boards = useRef({ land, port });
  boards.current = { land, port };

  const apply = (el: HTMLElement): void => {
    const next = measure(el, boards.current.land, boards.current.port);
    el.style.setProperty('--u', `${next.u}px`);
    el.dataset.orient = next.portrait ? 'portrait' : 'landscape';
    setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
  };

  const ref = useRef((el: HTMLElement | null): void => {
    roRef.current?.disconnect();
    roRef.current = null;
    elRef.current = el;
    if (!el) return;
    apply(el);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => apply(el));
      ro.observe(el);
      roRef.current = ro;
    }
  });

  useEffect(() => {
    const onResize = (): void => {
      if (elRef.current) apply(elRef.current);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      roRef.current?.disconnect();
    };
  }, []);

  return { ref: ref.current, size };
}

/** requestAnimationFrame loop for the lifetime of the component. `dt` is clamped to 100ms. */
export function useFrame(fn: (dtMs: number, nowMs: number) => void): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number): void => {
      const dt = Math.min(100, Math.max(0, t - last));
      last = t;
      fnRef.current(dt, t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** Re-render every `ms` (expiring row effects, rotating pages). */
export function useTicker(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

export interface CountUpProps {
  readonly value: number;
  /** Start value on mount (default: `value`, no animation). With it, every digit takes a full spin on mount. */
  readonly from?: number;
  /** Roughly how long a change takes to settle (default 900). */
  readonly ms?: number;
  readonly prefix?: string;
  readonly class?: string;
}

/** The strip under each digit shows 0-9 twice, so a digit can always roll upwards (9 -> 0 included). */
const ODO_CELLS = 20;
const odoY = (pos: number): string => `translateY(${(-pos * 100) / ODO_CELLS}%)`;
const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface OdoDigitProps {
  readonly digit: number;
  /** Digit shown before the first roll. */
  readonly start: number;
  /** Take a full extra turn on the first roll (score reveals). */
  readonly spin: boolean;
  readonly ms: number;
  readonly delay: number;
}

/**
 * One odometer digit. The real digit stays in the DOM as (hidden) text, so
 * `textContent` of the whole number is still the plain formatted value; the
 * rolling strip is a pseudo-element moved by transform only.
 */
function OdoDigit(props: OdoDigitProps): JSX.Element {
  const strip = useRef<HTMLSpanElement | null>(null);
  /** Strip position (0..19) the last roll was sent to. */
  const pos = useRef(props.start);
  const anim = useRef<Animation | null>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const wasFirst = first.current;
    if (wasFirst) {
      first.current = false;
      el.style.transform = odoY(pos.current);
      if (props.digit === pos.current && !props.spin) return;
    }
    try {
      // where the strip really is right now: it may be in the middle of a roll
      let at = pos.current;
      const cell = el.offsetHeight / ODO_CELLS;
      if (!wasFirst && cell > 0) {
        const y = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
        if (Number.isFinite(y)) at = -y / cell;
      }
      if (at >= 10) at -= 10;
      at = Math.min(9.999, Math.max(0, at));
      let target = props.digit >= at - 0.01 ? props.digit : props.digit + 10;
      if (wasFirst && props.spin && target < 10) target += 10;
      anim.current?.cancel();
      anim.current = null;
      pos.current = target;
      el.style.transform = odoY(target);
      if (Math.abs(target - at) < 0.02 || reducedMotion() || typeof el.animate !== 'function') return;
      anim.current = el.animate([{ transform: odoY(at) }, { transform: odoY(target) }], {
        duration: props.ms,
        delay: props.delay,
        easing: 'cubic-bezier(0.2, 0.85, 0.3, 1)',
        fill: 'backwards',
      });
    } catch {
      // the number is still right (hidden text + final transform); only the roll is lost
      pos.current = props.digit;
      el.style.transform = odoY(props.digit);
    }
  }, [props.digit]);
  useEffect(() => () => anim.current?.cancel(), []);
  return (
    <span class="sh-odo-d">
      <span class="sh-odo-g">{props.digit}</span>
      <span class="sh-odo-s" ref={strip} aria-hidden="true" />
    </span>
  );
}

const isDigit = (ch: string | undefined): ch is string => ch !== undefined && ch >= '0' && ch <= '9';

/**
 * Odometer number: every digit that changes rolls upwards to its new value
 * (units first, higher places a beat later). Used for every score on the TV.
 */
export function CountUp(props: CountUpProps): JSX.Element {
  const prefix = props.prefix ?? '';
  const ms = props.ms ?? 900;
  const roll = Math.max(180, Math.round(ms * 0.7));
  const stagger = Math.min(90, Math.round(ms * 0.08));
  const mount = useRef({ chars: [...formatScore(props.from ?? props.value)], spin: props.from !== undefined && props.from !== props.value });
  const chars = [...formatScore(props.value)];
  const from = mount.current.chars;
  const cells: JSX.Element[] = [];
  let place = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i] ?? '';
    const fromRight = chars.length - 1 - i;
    if (isDigit(ch)) {
      const was = from[from.length - 1 - fromRight];
      cells.unshift(
        <OdoDigit key={`d${fromRight}`} digit={Number(ch)} start={isDigit(was) ? Number(was) : 0} spin={mount.current.spin} ms={roll} delay={place * stagger} />,
      );
      place++;
    } else {
      cells.unshift(<span key={`s${fromRight}`}>{ch}</span>);
    }
  }
  return (
    <span class={props.class ? `sh-odo ${props.class}` : 'sh-odo'} dir="ltr" data-value={Math.round(props.value)}>
      {prefix}
      {cells}
    </span>
  );
}

/** Competition ranks (ties share a rank) for a list already sorted best-first. */
export function sharedRanks(sortedValues: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < sortedValues.length; i++) {
    const prev = out[i - 1];
    out.push(i > 0 && prev !== undefined && sortedValues[i] === sortedValues[i - 1] ? prev : i + 1);
  }
  return out;
}
