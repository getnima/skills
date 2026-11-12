/**
 * The custom pictures that announce a game on the phone: one transparent cut-out per game
 * and one of Shimi as the show's host, dropped into client/public/assets/intro/ as
 * `<gameId>.webp` (tap, icy, flappy, plotzel, ninja) and `show.webp` (any of IMAGE_EXTS
 * works, the base name is what counts). Longest side 768 px, made to read at about 200 px.
 *
 * A picture that is not there costs no request and no 404 (kit/files.ts knows the file list
 * at build time): the screen shows the game's emoji on a star sticker instead, and is laid
 * out for both.
 */
import { useState } from 'preact/hooks';

import { GAME_IDS, GAMES } from '../../../shared/protocol';
import { findPublicFile } from '../kit/files';

import type { JSX } from 'preact';
import type { GameId } from '../../../shared/protocol';

export type IntroArtId = GameId | 'show';

const IMAGE_EXTS: readonly string[] = ['webp', 'png', 'jpg', 'jpeg', 'svg'];

/** The picture's URL, or null while the file does not exist. */
export function introArt(id: IntroArtId): string | null {
  return findPublicFile(`/assets/intro/${id}.webp`, IMAGE_EXTS);
}

let preloaded = false;

/**
 * Fetch the pictures that exist once, ahead of the first intro, so none pops in late. Only with
 * the preloader off (?preload=0): otherwise they are part of the phone's background loading
 * (boot-preload.ts), which fetches the same URLs.
 */
export function preloadIntroArt(): void {
  if (preloaded) return;
  preloaded = true;
  for (const id of [...GAME_IDS, 'show'] as const) {
    const url = introArt(id);
    if (url === null) continue;
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
    } catch {
      // no Image: the <img> on the screen loads it
    }
  }
}

/**
 * A game's picture, or its emoji on a white star until the file is there (or when it fails
 * to load). `size`: 'big' the subject of the screen, 'mid' next to a headline, 'chip' inside a
 * pill or the top bar. The box is the same for both, so the screen does not move.
 */
export function GameArt(props: {
  readonly id: IntroArtId;
  /** The stand-in for a picture that is not there. Default: the game's emoji. */
  readonly emoji?: string;
  readonly size: 'big' | 'mid' | 'chip';
  readonly class?: string;
}): JSX.Element {
  const [broken, setBroken] = useState(false);
  const url = introArt(props.id);
  const extra = props.class !== undefined ? ` ${props.class}` : '';
  if (url !== null && !broken) {
    return (
      <span class={`ps-art is-${props.size}${extra}`} data-art={props.id} aria-hidden="true">
        <img src={url} alt="" draggable={false} decoding="async" onError={() => setBroken(true)} />
      </span>
    );
  }
  const emoji = props.emoji ?? (props.id === 'show' ? '🎤' : GAMES[props.id].emoji);
  return (
    <span class={`ps-emoji is-${props.size}${extra}`} data-art="" aria-hidden="true">
      <span>{emoji}</span>
    </span>
  );
}
