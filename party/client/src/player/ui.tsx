/** Small shared pieces of the phone UI: avatars, stickers, ticking hooks, confetti, rank helpers. */
import { useEffect, useRef, useState } from 'preact/hooks';

import { Avatar as LookAvatar } from '../avatar';
import { createGameCanvas } from '../kit/canvas';
import { createFx } from '../kit/fx';
import { createLoop } from '../kit/loop';

import type { JSX } from 'preact';
import type { PlayerPublic } from '../../../shared/protocol';

// ───────────────────────────── Avatars ─────────────────────────────

/**
 * A player's icon on the phone: their dressed Shimi (PlayerPublic.look / ResultRow.look),
 * in the design system's chip look (ink ring, hard shadow). Pictures are composed and cached
 * by the avatar module; a look that is still loading shows its plate colour, never a jump.
 */
export function Avatar(props: {
  readonly look: string | null | undefined;
  readonly size: number;
  readonly class?: string;
  /** 'icon' the head (default, for rows and chips); 'bust' head and shoulders, for a doll that is the subject of the screen. */
  readonly crop?: 'icon' | 'bust';
}): JSX.Element {
  return (
    <LookAvatar look={props.look} size={props.size} crop={props.crop ?? 'icon'} ring class={props.class !== undefined ? `pp-doll ${props.class}` : 'pp-doll'} />
  );
}

/** The phone page's size in CSS px, live (a resized window, a rotated phone). */
export interface Viewport {
  readonly w: number;
  readonly h: number;
}

export function useViewport(): Viewport {
  const [v, setV] = useState<Viewport>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = (): void => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setV((p) => (p.w === w && p.h === h ? p : { w, h }));
    };
    on();
    window.addEventListener('resize', on);
    return (): void => window.removeEventListener('resize', on);
  }, []);
  return v;
}

/**
 * The side of a big doll: `ofW` of the page's width, at most `ofH` of its height, within
 * [min, max], on a 4 px grid (the avatar pictures are cached per size). At most 160: the
 * avatar cache tops out at 384 px, which is sharp up to there on a 2x screen.
 */
export function dollPx(v: Viewport, ofW: number, ofH: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, 160, v.w * ofW, v.h * ofH)) / 4) * 4;
}

// ───────────────────────────── Stickers ─────────────────────────────

/**
 * A star-burst sticker with one or two short Hebrew words (the frame's .pw-burst, show.css).
 * `tone`: the sticker's colour. Where it sits is the screen's business (`class`).
 */
export function Burst(props: { readonly text: string; readonly tone?: 'pink' | 'red' | 'yellow' | 'white'; readonly class?: string }): JSX.Element {
  return (
    <span class={`pw-burst ps-burst is-${props.tone ?? 'pink'}${props.class !== undefined ? ` ${props.class}` : ''}`} aria-hidden="true">
      <span>{props.text}</span>
    </span>
  );
}

/** A number inside a Motaleh headline: digits are always set in Rubik (Motaleh's 2 reads as a Z). */
export function Num(props: { readonly children: string | number }): JSX.Element {
  return <b class="ps-n">{props.children}</b>;
}

// ───────────────────────────── Ticking ─────────────────────────────

/** Re-render every animation frame (or every `ms`) while mounted and `active`. */
export function useTick(ms = 0, active = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    if (ms > 0) {
      const id = setInterval(() => setN((v) => v + 1), ms);
      return (): void => {
        alive = false;
        clearInterval(id);
      };
    }
    let raf = 0;
    const loop = (): void => {
      if (!alive) return;
      setN((v) => v + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return (): void => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [ms, active]);
  return n;
}

/** Number that counts up from `from` to `to` over `ms` once mounted (ease-out). */
export function useCountUp(to: number, ms: number, delayMs = 0, from = 0): number {
  const [v, setV] = useState(from);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now() + delayMs;
    const step = (): void => {
      const t = Math.min(1, Math.max(0, (performance.now() - t0) / ms));
      const e = 1 - Math.pow(1 - t, 3);
      setV(Math.round(from + (to - from) * e));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return (): void => cancelAnimationFrame(raf);
  }, [to, ms, delayMs, from]);
  return v;
}

// ───────────────────────────── Confetti ─────────────────────────────

/** The party palette (show.css) for paper on a yellow sunburst: no yellow, so every piece shows. */
const CONFETTI_COLORS: readonly string[] = ['#f2361b', '#1e3fd8', '#ff7eb6', '#ffffff', '#4f6cff', '#16120e'];

/** Full-screen confetti layer (pointer-events: none). `bursts` = how many waves. */
export function Confetti(props: { readonly bursts?: number; readonly intensity?: number }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const bursts = props.bursts ?? 3;
  const intensity = props.intensity ?? 1;
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    let view: ReturnType<typeof createGameCanvas>;
    try {
      view = createGameCanvas(root);
    } catch {
      return;
    }
    const fx = createFx(700);
    const loop = createLoop({
      update(dt: number): void {
        fx.update(dt);
      },
      render(): void {
        view.clear();
        fx.draw(view.ctx);
      },
    });
    const w = view.width;
    const h = view.height;
    fx.confetti({ count: Math.round(110 * intensity), width: w, colors: CONFETTI_COLORS });
    fx.confetti({ count: Math.round(40 * intensity), x: w * 0.15, y: h, colors: CONFETTI_COLORS });
    fx.confetti({ count: Math.round(40 * intensity), x: w * 0.85, y: h, colors: CONFETTI_COLORS });
    for (let i = 1; i < bursts; i++) {
      loop.after(i * 1300, () => {
        fx.confetti({ count: Math.round(70 * intensity), width: view.width, colors: CONFETTI_COLORS });
        fx.burst(view.width * (0.25 + 0.5 * (i % 2)), view.height * 0.3, { count: 26, shape: 'star', speed: 420, colors: CONFETTI_COLORS });
      });
    }
    loop.start();
    return (): void => {
      loop.stop();
      view.dispose();
    };
  }, [bursts, intensity]);
  return <div class="pp-confetti" ref={ref} />;
}

// ───────────────────────────── Ranks ─────────────────────────────

export interface Standing {
  readonly player: PlayerPublic;
  /** 1-based strict rank from the server: 1..n, never shared. */
  readonly rank: number;
}

/** Players in the server's strict overall order. No rank is derived from totals on the phone. */
export function standings(players: readonly PlayerPublic[]): Standing[] {
  return [...players].sort((a, b) => a.rank - b.rank).map((player) => ({ player, rank: player.rank }));
}

export function medal(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Join names the Hebrew way: "א", "א ו־ב", "א, ב ו־ג". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  const head = names.slice(0, -1).join(', ');
  return `${head} ו־${names[names.length - 1] ?? ''}`;
}
