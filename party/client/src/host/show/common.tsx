import { useEffect, useRef, useState } from 'preact/hooks';

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
  /** Start value on mount (default: `value`, no animation). */
  readonly from?: number;
  readonly ms?: number;
  readonly prefix?: string;
  readonly class?: string;
}

/** A number that rolls to its new value whenever `value` changes. */
export function CountUp(props: CountUpProps): JSX.Element {
  const el = useRef<HTMLSpanElement | null>(null);
  const shown = useRef(props.from ?? props.value);
  const prefix = props.prefix ?? '';
  const ms = props.ms ?? 900;
  useEffect(() => {
    const node = el.current;
    const start = shown.current;
    const end = props.value;
    if (!node) return undefined;
    if (start === end) {
      node.textContent = prefix + formatScore(end);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number): void => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      shown.current = start + (end - start) * eased;
      node.textContent = prefix + formatScore(shown.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.value, ms, prefix]);
  return (
    <span class={props.class} ref={el} dir="ltr">
      {prefix + formatScore(shown.current)}
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
