/**
 * The round prize, presented like a holy relic: rotating god-rays, a halo,
 * little wings, sparkles and a gentle float. A photo (prize.jpg) is cropped
 * around the figurine in the middle and set in an arched golden frame; a
 * transparent cut-out (prize.png) floats free in the light.
 */
import { prizeArt, raysUrl } from './art';

import type { JSX } from 'preact';

export interface PrizeRelicProps {
  /** 'full' for the ceremony, 'mini' for the winner banner (no rays, no wings). */
  readonly variant?: 'full' | 'mini';
  readonly class?: string;
}

const SPARKLES: ReadonlyArray<readonly [number, number, number, number]> = [
  // x %, y %, size (u), delay (s)
  [-8, 12, 46, 0],
  [104, 6, 38, 0.6],
  [-16, 58, 30, 1.1],
  [112, 50, 44, 0.3],
  [8, -8, 28, 1.6],
  [92, 88, 34, 0.9],
  [-4, 92, 40, 1.9],
  [50, -14, 36, 1.3],
  [118, 24, 26, 2.2],
  [-20, 34, 32, 2.5],
];

const WING_SHAPE = 'M112 96 C70 20 22 8 6 14 C14 36 12 52 4 66 C18 70 24 82 20 96 C34 96 42 106 42 120 C62 114 92 118 112 96 Z';
const WING_LINES = 'M100 92 C74 50 44 34 22 30 M96 100 C74 74 52 66 30 66 M92 106 C76 94 60 92 44 96';

function Wing(props: { side: 'l' | 'r' }): JSX.Element {
  return (
    <svg class={`sh-prize-wing sh-prize-wing--${props.side}`} viewBox="0 0 120 160" aria-hidden="true">
      <g transform={props.side === 'r' ? 'matrix(-1 0 0 1 120 0)' : undefined}>
        <path d={WING_SHAPE} fill="#ffffff" stroke="#d9d2ff" stroke-width="4" stroke-linejoin="round" />
        <path d={WING_LINES} fill="none" stroke="#d9d2ff" stroke-width="4" stroke-linecap="round" />
      </g>
    </svg>
  );
}

export function PrizeRelic(props: PrizeRelicProps): JSX.Element {
  const art = prizeArt();
  const mini = props.variant === 'mini';
  return (
    <div class={`sh-prize ${mini ? 'sh-prize--mini' : ''} ${art.cutout ? 'sh-prize--cutout' : ''} ${props.class ?? ''}`}>
      {mini ? null : <img class="sh-prize-rays" src={raysUrl()} alt="" />}
      <div class="sh-prize-glow" />
      <div class="sh-prize-float">
        {mini ? null : <Wing side="l" />}
        {mini ? null : <Wing side="r" />}
        <div class="sh-prize-frame">
          <img class="sh-prize-img" src={art.url} alt="" draggable={false} />
          <div class="sh-prize-shine" />
        </div>
        <div class="sh-prize-halo" />
        {mini
          ? null
          : SPARKLES.map(([x, y, s, d], i) => (
              <span
                class="sh-sparkle"
                key={i}
                style={{ left: `${x}%`, top: `${y}%`, fontSize: `calc(${s} * var(--u))`, animationDelay: `${d}s` }}
              >
                ✦
              </span>
            ))}
      </div>
    </div>
  );
}
