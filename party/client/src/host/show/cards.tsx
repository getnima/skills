/**
 * PlayerCard: one guest on the TV's leaderboards, as a sticker card instead of a thin row. The
 * dressed doll the guest made in the dressing room fills the top of the card (head and
 * shoulders, big enough to see the hats), with the place on a sticker in the corner, the name
 * and the points under it. The card's size comes from its board (show/card-grid.ts) as --cw,
 * and everything inside scales with it.
 *
 * The board places the cards (absolute, moved with a transform so a change of place slides);
 * the card only draws itself. Styles: cards.css.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { Avatar } from './common';
import './cards.css';

import type { ComponentChildren, JSX } from 'preact';

export interface PlayerCardProps {
  readonly name: string;
  readonly avatar: number;
  readonly look?: string | null;
  /** The place shown on the corner sticker; null shows a dot (nobody has points yet). */
  readonly rank: number | null;
  /** Card width in px (from the board's grid). */
  readonly cw: number;
  /** One design unit in px, to pick a doll picture that is sharp enough. */
  readonly u: number;
  /** Where the board puts the card (px from the board's top-left corner). */
  readonly x: number;
  readonly y: number;
  readonly hidden?: boolean;
  /** Extra state classes: is-first, is-spot, is-away, is-out ... */
  readonly class?: string;
  /** A small sticker in the other top corner: the move in the table (▲2), "חדש". */
  readonly move?: { readonly text: string; readonly kind: 'up' | 'down' | 'new' | 'flat' } | null;
  /** A ribbon over the card's top edge (מוביל חדש, מטפס הסיבוב). */
  readonly ribbon?: ComponentChildren;
  /** Something over the bottom of the doll (the points of this round). */
  readonly badge?: ComponentChildren;
  /** The line under the name: the points. */
  readonly children?: ComponentChildren;
  readonly testId?: string;
}

/**
 * A name's own direction, from its first letter: Hebrew reads right to left, a Latin name left to
 * right (so a long name is cut at its end either way). Not dir="auto": that skips a <bdi> inside.
 */
export function nameDir(name: string): 'rtl' | 'ltr' {
  const m = /[A-Za-z\u00C0-\u024F\u0590-\u05FF\u0600-\u06FF]/.exec(name);
  return m !== null && /[A-Za-z\u00C0-\u024F]/.test(m[0]) ? 'ltr' : 'rtl';
}

function rankClass(rank: number | null): string {
  if (rank === 1) return 'pc-rank--1';
  if (rank === 2) return 'pc-rank--2';
  if (rank === 3) return 'pc-rank--3';
  return '';
}

export function PlayerCard(props: PlayerCardProps): JSX.Element {
  const style: Record<string, string> = {
    '--cw': `${props.cw.toFixed(1)}px`,
    transform: `translate3d(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px, 0)`,
  };
  const move = props.move ?? null;
  return (
    <div class={`pc ${props.hidden === true ? 'is-hidden' : ''} ${props.class ?? ''}`} style={style} data-testid={props.testId ?? 'player-card'}>
      <div class="pc-in">
        <div class="pc-pic">
          <Avatar avatar={props.avatar} name={props.name} look={props.look} crop="bust" class="pc-doll" units={props.cw / Math.max(0.05, props.u)} />
          {props.badge !== undefined && props.badge !== null ? <span class="pc-badge">{props.badge}</span> : null}
        </div>
        <div class="pc-foot">
          <span class="pc-name" dir={nameDir(props.name)}>
            {props.name}
          </span>
          <span class="pc-score">{props.children}</span>
        </div>
      </div>
      <span class={`pc-rank ${rankClass(props.rank)}`}>{props.rank === null ? '·' : props.rank}</span>
      {move !== null && move.text !== '' ? (
        <span class={`pc-move pc-move--${move.kind}`} dir="ltr">
          {move.text}
        </span>
      ) : null}
      {props.ribbon !== undefined && props.ribbon !== null ? <span class="pc-ribbon">{props.ribbon}</span> : null}
    </div>
  );
}

/** A board's box in px, kept up to date (a ResizeObserver): the grid is laid out from it. Pass `ref` to the board. */
export function useBoardBox(): { ref: (el: HTMLDivElement | null) => void; w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useRef((el: HTMLDivElement | null): void => {
    observer.current?.disconnect();
    observer.current = null;
    if (el === null) return;
    const read = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    observer.current = ro;
  });
  useEffect(() => () => observer.current?.disconnect(), []);
  return { ref: ref.current, w: box.w, h: box.h };
}
