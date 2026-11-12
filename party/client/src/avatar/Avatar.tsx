/**
 * <Avatar look size /> : a guest's dressed Shimi as an icon. Works on the phone and on the TV.
 * The box has its final size and the plate's colour from the first paint; the picture is put in
 * when it is composed (at once when it is cached), so lists never jump.
 */
import './avatar.css';

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { lookKey } from '../../../shared/avatar';
import { plateColor } from './catalog';
import { avatarBitmap, avatarUrl, holdAvatarUrl, peekAvatarBitmap, peekAvatarUrl } from './compose';

import type { JSX } from 'preact';

import type { AvatarLook } from '../../../shared/avatar';
import type { AvatarCrop } from './compose';

export interface AvatarProps {
  /** The look, as an object or as its encoded string (what the server sends). */
  look: AvatarLook | string | null | undefined;
  /** Side in CSS pixels. */
  size: number;
  /** 'icon' the head (default), 'bust' head and shoulders, 'full' the whole doll. */
  crop?: AvatarCrop;
  /** Ink border with a hard shadow (the design system's chip look). */
  ring?: boolean;
  /** A circle instead of the rounded square (hat tips in the corners are cut). */
  round?: boolean;
  class?: string;
  /** Accessible name, e.g. the player's name. Without it the avatar is decorative. */
  label?: string;
}

const DEFAULT_KEY = '1.0.0.0.0.0.0';

function keyOf(look: AvatarLook | string | null | undefined): string {
  if (look === null || look === undefined) return DEFAULT_KEY;
  try {
    return lookKey(look);
  } catch {
    return DEFAULT_KEY;
  }
}

/**
 * The picture URL of a look (for your own <img> or a CSS background), or null until it is ready.
 * The URL is kept alive while the component is mounted. `size` is in CSS pixels.
 * <Avatar /> itself does not use it: it paints the cached canvas, which is cheaper.
 */
export function useAvatarUrl(look: AvatarLook | string | null | undefined, size: number, crop: AvatarCrop = 'icon'): string | null {
  const key = keyOf(look);
  const [state, setState] = useState<{ id: string; url: string | null }>(() => ({
    id: `${key}|${size}|${crop}`,
    url: peekAvatarUrl(key, size, crop),
  }));
  const id = `${key}|${size}|${crop}`;

  useEffect(() => {
    let alive = true;
    const release = holdAvatarUrl(key, size, crop);
    const cached = peekAvatarUrl(key, size, crop);
    if (cached !== null) setState((s) => (s.id === id && s.url === cached ? s : { id, url: cached }));
    else {
      void avatarUrl(key, size, crop).then((url) => {
        if (alive) setState({ id, url });
      });
    }
    return () => {
      alive = false;
      release();
    };
  }, [id]);

  // while a new look is being composed the old picture stays (no flash on every dressing-room tap)
  return state.id === id ? state.url : (peekAvatarUrl(key, size, crop) ?? state.url);
}

/** Plate number of a look without decoding all of it twice. */
function bgOf(key: string): number {
  return Number(key.split('.')[1] ?? 0) || 0;
}

function paint(target: HTMLCanvasElement | null, source: HTMLCanvasElement): void {
  if (target === null) return;
  if (target.width !== source.width || target.height !== source.height) {
    target.width = source.width;
    target.height = source.height;
  }
  const g = target.getContext('2d');
  if (g === null) return;
  g.clearRect(0, 0, target.width, target.height);
  g.drawImage(source, 0, 0);
  target.dataset.ready = '1';
}

/**
 * The avatar. A fixed square span in the plate's colour with a small canvas inside; the cached
 * composed picture is painted into it (no PNG encode / decode, so a wall of 120 is cheap).
 * While a new look is being composed the previous picture stays.
 */
export function Avatar(props: AvatarProps): JSX.Element {
  const { size, crop = 'icon', ring = false, round = false, label } = props;
  const key = keyOf(props.look);
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    let alive = true;
    const cached = peekAvatarBitmap(key, size, crop);
    if (cached !== null) paint(ref.current, cached);
    else {
      void avatarBitmap(key, size, crop).then((c) => {
        if (alive) paint(ref.current, c);
      });
    }
    return () => {
      alive = false;
    };
  }, [key, size, crop]);

  const cls = `av${ring ? ' av-ring' : ''}${round ? ' av-round' : ''}${props.class !== undefined ? ` ${props.class}` : ''}`;
  return (
    <span
      class={cls}
      style={{ '--av-size': `${size}px`, '--av-bg': plateColor(bgOf(key)) }}
      role={label !== undefined ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label === undefined ? 'true' : undefined}
    >
      <canvas ref={ref} width={1} height={1} />
    </span>
  );
}
