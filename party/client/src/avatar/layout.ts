/**
 * Where everything sits: pure geometry in doll pixels (doll.png is 483 x 1200), no DOM.
 * The compositor draws from it; the dressing room can use the same numbers for its live doll
 * (divide by DOLL.width / DOLL.height to get % of the doll box).
 */
import { DEFAULT_TOWER, DOLL, getItem, itemAr, normalizeLook } from './catalog';

import type { AvatarLook } from '../../../shared/avatar';
import type { AvatarItem } from './catalog';

export type AvatarCrop = 'icon' | 'bust' | 'full';
export type AvatarLayer = 'EARS' | 'FACE' | 'EYES' | 'HEAD' | 'TOWER' | 'NECK';

export interface PlacedItem {
  item: AvatarItem;
  layer: AvatarLayer;
  /** Tower level: 0 = the first hat above the worn one. Only for layer 'TOWER'. */
  level?: number;
  /** Box in doll pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const W = DOLL.width;
const H = DOLL.height;

/** An item's box on the bare doll (its `place`), in doll pixels. */
export function placeBox(it: AvatarItem): Box {
  const [l, t, w, h] = it.place;
  return { x: (l / 100) * W, y: (t / 100) * H, w: (w / 100) * W, h: (h / 100) * H };
}

/**
 * The worn accessories in paint order (draw the doll first, then these, first to last):
 * EARS, FACE, EYES, the worn hat, the tower hats bottom to top, NECK.
 *
 * The tower is the source page's chain at rest (no wobble): hat `level` is
 * place.width * 0.93^(level+1) wide, its `tw.bottom` line sits on the anchor, and the anchor then
 * moves up by (bottom - crown - sink) of that hat. The first anchor is the worn hat's top edge
 * plus (crown + sink) of its height, on the worn hat's centre line.
 */
export function layoutLook(input: AvatarLook): PlacedItem[] {
  const look = normalizeLook(input);
  const out: PlacedItem[] = [];
  const single = (id: number | null, layer: AvatarLayer): void => {
    const it = id === null ? undefined : getItem(id);
    if (it !== undefined) out.push({ item: it, layer, ...placeBox(it) });
  };
  single(look.ears, 'EARS');
  single(look.face, 'FACE');
  single(look.eyes, 'EYES');

  const baseId = look.head[0];
  const base = baseId === undefined ? undefined : getItem(baseId);
  if (base !== undefined) {
    const b = placeBox(base);
    out.push({ item: base, layer: 'HEAD', ...b });
    const btw = base.tw ?? DEFAULT_TOWER;
    const ax = b.x + b.w / 2;
    let ay = b.y + (btw.crown + btw.sink) * b.h;
    for (let i = 1; i < look.head.length; i++) {
      const it = getItem(look.head[i] ?? -1);
      if (it === undefined) continue;
      const level = i - 1;
      const tw = it.tw ?? DEFAULT_TOWER;
      const w = (it.place[2] / 100) * W * Math.pow(DOLL.towerShrink, level + 1);
      const h = w * itemAr(it);
      out.push({ item: it, layer: 'TOWER', level, x: ax - w / 2, y: ay - tw.bottom * h, w, h });
      ay -= (tw.bottom - tw.crown - tw.sink) * h;
    }
  }
  single(look.neck, 'NECK');
  return out;
}

/** Margin around the content, as a fraction of the square's side. */
export const FRAME_MARGIN = 0.05;
/** The icon ends here (% of the doll height) with a bare neck, and here when something is worn on the neck. */
const ICON_BOTTOM = 48.6;
const ICON_BOTTOM_NECK = 53;

/**
 * The square (in doll pixels) that a crop shows.
 * It contains the doll part of the crop ('icon' the head, 'bust' head and shoulders, 'full' everything)
 * and every worn accessory with the whole hat tower, plus a small margin. It is centred on the doll's
 * centre line, so the face stays in the middle however far a hat sticks out to one side, and it is the
 * smallest such square, so the face is as large as the look allows.
 * In 'icon' and 'bust' a neck accessory does not stretch the frame: it is cut at the bottom edge.
 */
export function frameLook(look: AvatarLook, crop: AvatarCrop, placed: readonly PlacedItem[] = layoutLook(look)): Box {
  const box = crop === 'icon' ? DOLL.headBox : crop === 'bust' ? DOLL.bustBox : DOLL.fullBox;
  let left = (box[0] / 100) * W;
  let top = (box[1] / 100) * H;
  let right = (box[2] / 100) * W;
  let bottom = (box[3] / 100) * H;
  if (crop === 'icon') bottom = ((placed.some((p) => p.layer === 'NECK') ? ICON_BOTTOM_NECK : ICON_BOTTOM) / 100) * H;
  for (const p of placed) {
    if (p.layer === 'NECK' && crop !== 'full') continue;
    left = Math.min(left, p.x);
    right = Math.max(right, p.x + p.w);
    top = Math.min(top, p.y);
    if (crop === 'full') bottom = Math.max(bottom, p.y + p.h);
  }
  const cx = (DOLL.centerX / 100) * W;
  const half = Math.max(cx - left, right - cx);
  const side = Math.max(half * 2, bottom - top) / (1 - 2 * FRAME_MARGIN);
  return { x: cx - side / 2, y: (top + bottom) / 2 - side / 2, w: side, h: side };
}
