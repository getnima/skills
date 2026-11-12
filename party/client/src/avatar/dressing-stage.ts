/**
 * Dressing room: where the doll stands on the stage. Pure geometry, no DOM.
 *
 * The doll box is the 483 x 1200 doll picture scaled by `s` (CSS px per doll px) with its top-left
 * corner at (x, y) in stage px. Two framings:
 *   'full' the whole doll standing on the cobalt disc (tall stages);
 *   'bust' head and shoulders, the doll cut by the tray's top edge like a host behind a desk (short stages).
 * The framing is chosen from the stage size alone (never from the look), so tapping an item never
 * switches it. The scale shrinks only when the worn things (a hat tower) would leave the stage.
 */
import { DOLL } from './catalog';
import { layoutLook } from './layout';

import type { AvatarLook } from '../../../shared/avatar';
import type { PlacedItem } from './layout';

export type StageMode = 'full' | 'bust';

export interface StageFrame {
  mode: StageMode;
  /** CSS px per doll px. */
  s: number;
  /** Top-left of the doll box in stage px. */
  x: number;
  y: number;
  /** Where the feet / the cut line are, in stage px (the disc's centre in 'full'). */
  floorY: number;
  /** Disc size in stage px ('full' only, 0 in 'bust'). */
  discW: number;
  discH: number;
}

const W = DOLL.width;
const H = DOLL.height;
const CX = (DOLL.centerX / 100) * W;
/** Room kept above the bare head, as a fraction of the doll height (one ordinary hat fits). */
const HEADROOM = 0.18;
/** Where the doll is cut in 'bust' (fraction of its height). */
const BUST_CUT = 0.7;
/** Where the soles are (fraction of the doll height). */
const FEET = 0.985;
/** Disc: width / doll width, height / disc width. */
const DISC_W = 1.08;
const DISC_H = 0.26;

/** Bounds of the worn things in doll px: top edge and the widest half-width around the centre line. */
function contentBounds(placed: readonly PlacedItem[]): {
  top: number;
  half: number;
} {
  let top = 0;
  let half = CX - (13 / 100) * W;
  for (const p of placed) {
    top = Math.min(top, p.y);
    half = Math.max(half, CX - p.x, p.x + p.w - CX);
  }
  return { top, half };
}

/** The framing ('full' / 'bust') a stage of this size gets. */
export function stageMode(sw: number, sh: number, padTop: number, padBottom = 0): StageMode {
  if (sw <= 0 || sh <= 0) return 'bust';
  const f = fitScale('full', sw, sh - padBottom, padTop, 0, CX - (13 / 100) * W);
  const headPx = 0.765 * W * f;
  return headPx >= Math.min(0.32 * sw, 120) ? 'full' : 'bust';
}

function fitScale(mode: StageMode, sw: number, sh: number, padTop: number, top: number, half: number): number {
  const above = Math.min(top, -HEADROOM * H);
  const discK = mode === 'full' ? DISC_W * W * DISC_H * 0.62 : 0;
  const span = (mode === 'full' ? FEET * H : BUST_CUT * H) - above + discK;
  const avail = Math.max(40, sh - padTop - (mode === 'full' ? 6 : 0));
  let s = avail / span;
  // the bare doll never gets wider than 58% of the stage, the worn things never wider than the stage
  s = Math.min(s, (sw * 0.58) / W, (sw * 0.98) / (2 * half));
  return Math.max(0.05, s);
}

/**
 * Where the doll goes for this look on a stage of sw x sh px. `padBottom` is kept free under the
 * disc in 'full' (the speech box lives there, like the source page's lower third).
 */
export function frameStage(sw: number, sh0: number, look: AvatarLook, mode: StageMode, padTop = 8, padBottom = 0): StageFrame {
  const sh = mode === 'full' ? sh0 - padBottom : sh0;
  const placed = layoutLook(look);
  const { top, half } = contentBounds(placed);
  const s = fitScale(mode, sw, sh, padTop, top, half);
  const x = sw / 2 - CX * s;
  if (mode === 'full') {
    const discW = DISC_W * W * s;
    const discH = discW * DISC_H;
    const floorY = sh - 6 - discH * 0.62;
    return { mode, s, x, y: floorY - FEET * H * s, floorY, discW, discH };
  }
  return {
    mode,
    s,
    x,
    y: sh - BUST_CUT * H * s,
    floorY: sh,
    discW: 0,
    discH: 0,
  };
}

/** An item's box (doll px) in stage px. */
export function boxOnStage(f: StageFrame, b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  return { x: f.x + b.x * f.s, y: f.y + b.y * f.s, w: b.w * f.s, h: b.h * f.s };
}
