/**
 * The "me bar": a slim tray pinned to the bottom of every phone screen except the game itself.
 * Avatar, name, overall place ("מקום 5 מתוך 12") and total. Before the first scored round it
 * says "מוכנים?". When the place changes it rolls old → new with ▲ / ▼ and the total counts up.
 * It stays mounted across screens (app.tsx) so it remembers what it showed last.
 * The name and every number are in Rubik; only the words on the chip are Motaleh (player.css).
 */
import { useRef } from 'preact/hooks';

import { Avatar, fmt, useCountUp } from './ui';

import type { JSX } from 'preact';
import type { MeStanding } from './me-standing';

/** Height of the tray in CSS px without the home-indicator inset (player.css --pp-mebar-h). */
export const ME_BAR_PX = 52;

/** The avatar slot: the player's dressed Shimi. */
export function MeBarAvatar(props: { readonly standing: MeStanding }): JSX.Element {
  return (
    <span class="pp-mb-avatar" data-slot="me-avatar" data-look={props.standing.look}>
      <Avatar look={props.standing.look} size={38} />
    </span>
  );
}

interface Shown {
  readonly rank: number | null;
  readonly total: number | null;
}

interface Change {
  readonly from: number | null;
  readonly to: number;
  readonly fromTotal: number;
  readonly key: number;
}

function Roll(props: { readonly change: Change | null; readonly rank: number }): JSX.Element {
  const c = props.change;
  if (c === null || c.from === null || c.from === c.to) {
    return (
      <span class={`pp-mb-num ${c !== null && c.from === null ? 'is-new' : ''}`} key={c?.key ?? 0}>
        {props.rank}
      </span>
    );
  }
  const up = c.to < c.from;
  return (
    <span class={`pp-mb-num pp-mb-roll ${up ? 'is-up' : 'is-down'}`} key={c.key}>
      <span class="pp-mb-old" aria-hidden="true">
        {c.from}
      </span>
      <span class="pp-mb-new">{c.to}</span>
    </span>
  );
}

export function MeBar(props: { readonly standing: MeStanding | null; readonly visible: boolean }): JSX.Element | null {
  const s = props.standing;
  const rank = s?.rank ?? null;
  const total = s?.total ?? null;

  // What changed since the last render that showed something (a ref, so a re-render of the
  // same values never restarts the animation).
  const shown = useRef<Shown | null>(null);
  const change = useRef<Change | null>(null);
  if (s !== null) {
    const prev = shown.current;
    if (prev === null) shown.current = { rank, total };
    else if (prev.rank !== rank || prev.total !== total) {
      if (rank !== null) {
        change.current = { from: prev.rank, to: rank, fromTotal: prev.total ?? 0, key: (change.current?.key ?? 0) + 1 };
      } else change.current = null;
      shown.current = { rank, total };
    }
  }
  const c = change.current;
  const counted = useCountUp(total ?? 0, 1100, 250, c !== null ? c.fromTotal : (total ?? 0));

  if (s === null) return null;
  const moved = c !== null && c.from !== null && c.from !== c.to ? c.to - c.from : 0;
  return (
    <div
      class={`pp-mebar ${props.visible ? 'is-on' : ''} ${rank === 1 ? 'is-first' : ''}`}
      data-rank={rank ?? ''}
      data-count={s.count}
      data-total={total ?? ''}
      aria-hidden={props.visible ? undefined : 'true'}
    >
      <MeBarAvatar standing={s} />
      <span class="pp-mb-who">
        <bdi class={`pp-mb-name ${Array.from(s.name).length > 9 ? 'is-long' : ''}`}>{s.name}</bdi>
        {total !== null ? (
          <span class="pp-mb-total">
            <span class="pp-mb-star">⭐</span>
            {fmt(counted)}
            <span class="pp-mb-pts">נק׳</span>
          </span>
        ) : null}
      </span>
      {rank === null ? (
        <span class="pp-mb-ready">מוכנים?</span>
      ) : (
        <span class="pp-mb-place">
          {rank === 1 ? <span class="pp-mb-crown">👑</span> : null}
          <span class="pp-mb-word">מקום</span>
          <Roll change={c} rank={rank} />
          <span class="pp-mb-of">
            מתוך <b>{s.count}</b>
          </span>
          {moved !== 0 ? (
            <span class={`pp-mb-move ${moved < 0 ? 'is-up' : 'is-down'}`} key={c?.key} dir="ltr">
              {moved < 0 ? `▲${-moved}` : `▼${moved}`}
            </span>
          ) : null}
        </span>
      )}
    </div>
  );
}
