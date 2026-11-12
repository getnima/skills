/**
 * The guest's own dressed Shimi head as the bird (and the small heads of the "out" view).
 *
 * Made ONCE at load into a cached canvas at the size it is drawn at: the frame loop only blits it.
 * The bird keeps the whole hat tower: the head is composed with the 'bust' crop (which always holds
 * the whole tower), cut just under the chin (or under the neck item, like the 'icon' crop) and
 * trimmed to its pixels. Everything here is looks only: nothing feeds the flight.
 *
 * Never throws and never rejects: no look, a look whose pictures did not all load, or any failure
 * gives null, and the game draws its own round token as before.
 */
import { decodeLook } from '../../../../shared/avatar';
import { DOLL, normalizeLook } from '../../avatar/catalog';
import { avatarBitmap, avatarCanvas, peekAvatarBitmap } from '../../avatar/compose';
import { frameLook } from '../../avatar/layout';

/** A dressed head, ready to blit. Sizes are in units of the HEAD's height (the bare head, chin to crown). */
export interface HeadSprite {
  readonly look: string;
  /** Device pixels, transparent around the doll; a plain (GPU-friendly) canvas. */
  readonly canvas: HTMLCanvasElement;
  /** The canvas's size, in head heights. */
  readonly w: number;
  readonly h: number;
  /** The head's centre inside the canvas (from its top-left), in head heights. */
  readonly cx: number;
  readonly cy: number;
  /** Half the head's width (ears included), in head heights: where the wings' roots go. */
  readonly halfW: number;
}

/** The bare head in doll pixels (DOLL.headBox: ears included, crown to chin). */
const HEAD_W = ((DOLL.headBox[2] - DOLL.headBox[0]) / 100) * DOLL.width;
const HEAD_H = ((DOLL.headBox[3] - DOLL.headBox[1]) / 100) * DOLL.height;
const HEAD_MID_Y = (((DOLL.headBox[1] + DOLL.headBox[3]) / 2) / 100) * DOLL.height;
const CENTER_X = (DOLL.centerX / 100) * DOLL.width;
/**
 * The cut under the head, in % of the doll's height: just under the chin, or a little lower with a neck
 * item (as the 'icon' crop, so a bow or a chain shows). The last rows fade out from FADE_* down to the cut,
 * so there is no hard edge through the neck.
 */
const CUT_BARE = 50.6;
const FADE_BARE = 48.2;
const CUT_NECK = 57;
const FADE_NECK = 52;
/** Biggest canvas we compose for one head (device px): a three-hat tower on a large phone stays well under it. */
const MAX_PX = 1400;

function plainCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * True when every picture the look needs is loaded (the compositor caches a picture only when it is
 * complete). A look drawn without the doll (a plain stand-in head) or without one of its items is
 * not "their" head: the game keeps its own art then.
 */
async function isComplete(look: string): Promise<boolean> {
  try {
    await avatarBitmap(look, 1);
    return peekAvatarBitmap(look, 1) !== null;
  } catch {
    return false;
  }
}

/**
 * Starts loading the look's pictures now (while the game's own art loads), so making the sprite
 * later is only composing. Never rejects; resolves at once without a look.
 */
export function warmHead(look: string | null | undefined): Promise<void> {
  if (typeof look !== 'string' || look.trim() === '') return Promise.resolve();
  try {
    return avatarBitmap(look, 1).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

/** Opaque bounds of rows [0, rows) of a canvas, or null when it is empty. */
function opaqueBox(c: HTMLCanvasElement, rows: number): { x: number; y: number; w: number; h: number } | null {
  const g = c.getContext('2d', { willReadFrequently: true });
  if (g === null) return null;
  const w = c.width;
  const h = Math.max(1, Math.min(c.height, rows));
  const data = g.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if ((data[row + x * 4 + 3] ?? 0) < 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * The bird's head for `look`, made for a bare head `headPx` device px tall. Null when there is no
 * look or it cannot be drawn whole.
 */
export async function makeHeadSprite(look: string | null | undefined, headPx: number): Promise<HeadSprite | null> {
  if (typeof look !== 'string' || look.trim() === '') return null;
  try {
    const l = normalizeLook(decodeLook(look));
    const frame = frameLook(l, 'bust');
    // device px per doll px, then the square that holds head, shoulders and the whole tower
    const want = Math.max(8, headPx) / HEAD_H;
    const side = Math.min(MAX_PX, Math.max(48, Math.round(frame.w * want)));
    const bust = await avatarCanvas(l, side, { crop: 'bust', plate: false });
    if (!(await isComplete(look))) return null;
    const k = bust.width / frame.w;
    if (!Number.isFinite(k) || k <= 0) return null;
    const cutY = ((l.neck !== null ? CUT_NECK : CUT_BARE) / 100) * DOLL.height;
    const fadeY = ((l.neck !== null ? FADE_NECK : FADE_BARE) / 100) * DOLL.height;
    const rows = Math.round((cutY - frame.y) * k);
    const box = opaqueBox(bust, rows);
    if (box === null) return null;
    // a little air for the smoothing at the edges
    const pad = 1;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const w = Math.min(bust.width - x, box.w + pad * 2);
    const h = Math.min(rows - y, box.h + pad * 2);
    const out = plainCanvas(w, h);
    const g = out.getContext('2d');
    if (g === null) return null;
    g.drawImage(bust, x, y, w, h, 0, 0, w, h);
    // the neck fades out instead of a straight cut
    const f0 = (fadeY - frame.y) * k - y;
    const f1 = rows - y;
    if (f1 - f0 >= 2) {
      const grad = g.createLinearGradient(0, f0, 0, f1);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = grad;
      g.fillRect(0, Math.max(0, Math.floor(f0)), w, h);
      g.globalCompositeOperation = 'source-over';
    }
    const headH = HEAD_H * k;
    return {
      look,
      canvas: out,
      w: w / headH,
      h: h / headH,
      cx: ((CENTER_X - frame.x) * k - x) / headH,
      cy: ((HEAD_MID_Y - frame.y) * k - y) / headH,
      halfW: HEAD_W / 2 / HEAD_H,
    };
  } catch {
    return null;
  }
}

// ───────────────────────── the "out" view: small heads next to the names ─────────────────────────

/** Small cut-out heads for the "out" view, one per player, made one at a time (one per `pump()`). */
export interface HeadShelf {
  /** The player's head canvas when it is ready (each player has their own element), else null. Asks for it. */
  get(id: string, look: string | undefined): HTMLCanvasElement | null;
  /** Make the next head that was asked for (at most one per call; call it once per step). */
  pump(): void;
  /** Heads ready so far. */
  readonly ready: number;
}

/** `cssSize`: the chip head's side in CSS px. `onReady`: a head that was asked for is ready (repaint the list). */
export function createHeadShelf(cssSize: number, onReady: () => void): HeadShelf {
  const dpr = Math.min(3, Math.max(1, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const px = Math.round(cssSize * dpr);
  const made = new Map<string, { look: string; canvas: HTMLCanvasElement | null }>();
  const queue: Array<{ id: string; look: string }> = [];
  let busy = false;
  let ready = 0;
  return {
    get(id: string, look: string | undefined): HTMLCanvasElement | null {
      if (typeof look !== 'string' || look === '') return null;
      const have = made.get(id);
      if (have !== undefined && have.look === look) return have.canvas;
      if (!queue.some((q) => q.id === id && q.look === look)) queue.push({ id, look });
      return null;
    },
    pump(): void {
      if (busy) return;
      const next = queue.shift();
      if (next === undefined) return;
      busy = true;
      void (async (): Promise<void> => {
        let canvas: HTMLCanvasElement | null = null;
        try {
          const c = await avatarCanvas(next.look, px, { crop: 'icon', plate: false });
          if (await isComplete(next.look)) {
            c.className = 'fl-chip-head';
            c.setAttribute('aria-hidden', 'true');
            canvas = c;
          }
        } catch {
          canvas = null;
        }
        made.set(next.id, { look: next.look, canvas });
        busy = false;
        if (canvas !== null) {
          ready++;
          onReady();
        }
      })();
    },
    get ready(): number {
      return ready;
    },
  };
}
