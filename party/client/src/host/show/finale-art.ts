/**
 * The final podium's stage pictures: client/public/assets/host/<slot>.<webp|png>. Each one is
 * optional (null while the file is not there: the finale then plays without that piece, as it
 * did before). Made for the owner's "on the finish it should be impressive": a red velvet curtain
 * that opens on the podium, toy spotlights that find each place, a gold trophy with the angel on
 * it for the champion, and toy confetti cannons. The crown and the gold / silver / bronze
 * medallions are the existing slots crown.png and podium_<1|2|3>.png (art.ts).
 */
import { assetFileUrl } from '../../kit/assets';

const GROUP = 'host';

export interface FinaleArt {
  /** The closed curtain's left half (mirrored for the right): it opens at the start. */
  readonly curtain: string | null;
  /** The swagged valance with the gold fringe over the closed curtain. */
  readonly valance: string | null;
  /** A toy stage spotlight, lens to the lower right (mirrored for the right corner). */
  readonly spotlight: string | null;
  /** The evening's trophy: a gold cup, open on top (the angel stands in it). */
  readonly trophy: string | null;
  /** A toy confetti cannon aimed up to the right (mirrored for the right corner). */
  readonly cannon: string | null;
}

let art: FinaleArt | null = null;

export function finaleArt(): FinaleArt {
  if (art === null) {
    art = {
      curtain: assetFileUrl(GROUP, 'curtain.png'),
      valance: assetFileUrl(GROUP, 'valance.png'),
      spotlight: assetFileUrl(GROUP, 'spotlight.png'),
      trophy: assetFileUrl(GROUP, 'trophy.png'),
      cannon: assetFileUrl(GROUP, 'cannon.png'),
    };
  }
  return art;
}

/** Fetch the finale's pictures ahead of the podium, so nothing pops in late. */
export function preloadFinaleArt(extra: readonly (string | null)[] = []): void {
  const a = finaleArt();
  for (const url of [a.curtain, a.valance, a.spotlight, a.trophy, a.cannon, ...extra]) {
    if (url === null) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}
