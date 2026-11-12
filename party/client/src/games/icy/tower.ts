/**
 * The tower's look: zones (moods by floor), and the painters of the pre-rendered tiles the
 * game blits (inner back wall, side walls, hazard tape, floor-number signs). Pure drawing:
 * nothing here touches the level, the physics or the score.
 */
import { drawText, roundRectPath } from '../../kit/canvas';
import { PAL, STAR10, displayFont, halftone, makeLayer, stickerShape } from './look';

/** A new zone (mood) every this many floors. */
export const ZONE_FLOORS = 25;

export interface ZoneLook {
  /** Sticker text when a player first climbs into the zone (zone 0 has none). */
  readonly name: string;
  /** Side walls: block, highlight, shade. */
  readonly wall: string;
  readonly wallHi: string;
  readonly wallLo: string;
  /** Inner back wall: block, highlight, shade, joints. */
  readonly back: string;
  readonly backHi: string;
  readonly backLo: string;
  readonly joint: string;
  /** What hangs on the back wall. */
  readonly deco: 'window' | 'heart' | 'torch' | 'sun';
  /** Front face of a normal floor (its top is always paper). */
  readonly face: string;
  /** CSS sky outside the tower (landscape / desktop only). */
  readonly sky: string;
  /** Snow colour. */
  readonly snow: string;
}

export const ZONE_LOOKS: readonly ZoneLook[] = [
  {
    name: '',
    wall: PAL.cob,
    wallHi: PAL.cobL,
    wallLo: PAL.cobD,
    back: '#142c9c',
    backHi: '#2342c4',
    backLo: '#0c1a66',
    joint: 'rgba(22, 18, 14, 0.55)',
    deco: 'window',
    face: '#bcd2ff',
    sky: `linear-gradient(to bottom, ${PAL.cobD}, ${PAL.cob})`,
    snow: 'rgba(255, 255, 255, 0.8)',
  },
  {
    name: 'קומות ורודות!',
    wall: PAL.pink,
    wallHi: '#ffb6d6',
    wallLo: '#c4487f',
    back: '#7a1f5c',
    backHi: '#9a2c75',
    backLo: '#51123c',
    joint: 'rgba(22, 18, 14, 0.6)',
    deco: 'heart',
    face: '#ffd2e6',
    sky: `linear-gradient(to bottom, #51123c, ${PAL.pink})`,
    snow: 'rgba(255, 220, 238, 0.85)',
  },
  {
    name: 'קומות לוהטות!',
    wall: PAL.red,
    wallHi: '#ff7a5e',
    wallLo: PAL.redD,
    back: '#5c1206',
    backHi: '#7a1d0b',
    backLo: '#3a0a02',
    joint: 'rgba(22, 18, 14, 0.65)',
    deco: 'torch',
    face: '#ffd3bd',
    sky: `linear-gradient(to bottom, #3a0a02, ${PAL.red})`,
    snow: 'rgba(255, 210, 120, 0.8)',
  },
  {
    name: 'הפסגה!',
    wall: PAL.yel,
    wallHi: PAL.yel2,
    wallLo: PAL.org,
    back: '#d86f00',
    backHi: '#ee8a10',
    backLo: '#a85000',
    joint: 'rgba(22, 18, 14, 0.55)',
    deco: 'sun',
    face: '#fff0a8',
    sky: `repeating-conic-gradient(from 0deg at 50% 40%, ${PAL.yel} 0deg 10deg, ${PAL.yel2} 10deg 20deg)`,
    snow: 'rgba(255, 255, 255, 0.85)',
  },
];

export function zoneLook(z: number): ZoneLook {
  return ZONE_LOOKS[Math.max(0, Math.min(ZONE_LOOKS.length - 1, z))] ?? (ZONE_LOOKS[0] as ZoneLook);
}

/** Zone of floor `j`. */
export function zoneOfFloor(j: number): number {
  return Math.max(0, Math.min(ZONE_LOOKS.length - 1, Math.floor(j / ZONE_FLOORS)));
}

// ───────────────────────────── Back wall ─────────────────────────────

/** Height of one back-wall tile in world units (6 block courses). */
export const BACK_TILE_W = 240;
const COURSE = 40;
const BRICK = 84;

function hash(a: number, b: number): number {
  let h = Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35);
  h ^= h >>> 13;
  return (Math.imul(h, 0x27d4eb2f) >>> 0) / 4294967296;
}

function archWindow(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: string, litHi: string, s: number): void {
  const path = (ox: number, oy: number): void => {
    g.beginPath();
    g.moveTo(x + ox, y + h + oy);
    g.lineTo(x + ox, y + w / 2 + oy);
    g.arc(x + w / 2 + ox, y + w / 2 + oy, w / 2, Math.PI, 0);
    g.lineTo(x + w + ox, y + h + oy);
    g.closePath();
  };
  // hard shadow, frame, lit glass, mullions, sill
  path(4 * s, 5 * s);
  g.fillStyle = 'rgba(22, 18, 14, 0.55)';
  g.fill();
  path(0, 0);
  g.fillStyle = lit;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = litHi;
  g.fillRect(x, y, w * 0.45, h * 0.5);
  g.restore();
  g.lineWidth = Math.max(2, 3 * s);
  g.strokeStyle = PAL.ink;
  g.stroke();
  g.beginPath();
  g.moveTo(x + w / 2, y + 2 * s);
  g.lineTo(x + w / 2, y + h);
  g.moveTo(x, y + h * 0.55);
  g.lineTo(x + w, y + h * 0.55);
  g.lineWidth = Math.max(1.5, 2.4 * s);
  g.stroke();
  g.fillStyle = PAL.paper;
  roundRectPath(g, x - 5 * s, y + h - 1, w + 10 * s, 7 * s, 2 * s);
  g.fill();
  g.lineWidth = Math.max(1.5, 2 * s);
  g.stroke();
}

function heartPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  g.moveTo(cx, cy + r * 0.9);
  g.bezierCurveTo(cx - r * 1.4, cy, cx - r * 0.8, cy - r * 1.1, cx, cy - r * 0.4);
  g.bezierCurveTo(cx + r * 0.8, cy - r * 1.1, cx + r * 1.4, cy, cx, cy + r * 0.9);
  g.closePath();
}

function torch(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // bracket
  g.fillStyle = PAL.ink;
  g.fillRect(cx - 4 * s, cy, 8 * s, 22 * s);
  g.fillRect(cx - 9 * s, cy - 2 * s, 18 * s, 6 * s);
  // flame: outer orange, inner yellow, white core, ink outline
  const flame = (k: number): void => {
    g.beginPath();
    g.moveTo(cx, cy - 34 * s * k);
    g.quadraticCurveTo(cx + 14 * s * k, cy - 14 * s * k, cx + 9 * s * k, cy - 2 * s);
    g.quadraticCurveTo(cx, cy + 3 * s, cx - 9 * s * k, cy - 2 * s);
    g.quadraticCurveTo(cx - 14 * s * k, cy - 16 * s * k, cx, cy - 34 * s * k);
    g.closePath();
  };
  flame(1);
  g.fillStyle = PAL.org;
  g.fill();
  g.lineWidth = Math.max(1.5, 2.5 * s);
  g.strokeStyle = PAL.ink;
  g.stroke();
  flame(0.66);
  g.fillStyle = PAL.yel;
  g.fill();
  flame(0.33);
  g.fillStyle = PAL.white;
  g.fill();
}

function sunWindow(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, s: number): void {
  g.beginPath();
  g.arc(cx + 4 * s, cy + 5 * s, r, 0, Math.PI * 2);
  g.fillStyle = 'rgba(22, 18, 14, 0.5)';
  g.fill();
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = PAL.yel;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.fillStyle = PAL.yel2;
  g.beginPath();
  for (let i = 0; i < 16; i += 2) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = ((i + 1) / 16) * Math.PI * 2;
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a0) * r * 1.5, cy + Math.sin(a0) * r * 1.5);
    g.lineTo(cx + Math.cos(a1) * r * 1.5, cy + Math.sin(a1) * r * 1.5);
    g.closePath();
  }
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.lineWidth = Math.max(2, 3.5 * s);
  g.strokeStyle = PAL.ink;
  g.stroke();
}

/**
 * One tile of the inner back wall (CSS px w x h, h = BACK_TILE_W * scale): staggered block
 * courses with ink joints, highlight / shade edges, halftone shading, a few cracks and the
 * zone's decorations. Tiles vertically (nothing crosses the top or bottom edge).
 */
export function paintBackTile(g: CanvasRenderingContext2D, w: number, h: number, scale: number, z: number): void {
  const L = zoneLook(z);
  const ch = COURSE * scale;
  const bw = BRICK * scale;
  const rows = Math.round(BACK_TILE_W / COURSE);
  g.fillStyle = L.back;
  g.fillRect(0, 0, w, h);
  // edges of every block: highlight top + left, shade bottom
  for (let r = 0; r < rows; r++) {
    const y = r * ch;
    const off = r % 2 === 0 ? 0 : bw / 2;
    for (let x = -off; x < w; x += bw) {
      const k = hash(r, Math.round(x));
      g.fillStyle = k < 0.18 ? L.backLo : k > 0.86 ? L.backHi : L.back;
      g.fillRect(x, y, bw, ch);
      g.fillStyle = L.backHi;
      g.fillRect(x + 1, y + 1, bw - 2, Math.max(2, 3 * scale));
      g.fillRect(x + 1, y + 1, Math.max(2, 3 * scale), ch - 2);
      g.fillStyle = L.backLo;
      g.fillRect(x + 1, y + ch - Math.max(3, 5 * scale), bw - 2, Math.max(3, 5 * scale));
    }
  }
  // halftone shade in the lower half of each course
  halftone(g, 0, 0, w, h, Math.max(4, 6 * scale), 'rgba(22, 18, 14, 0.22)', (_u, v) => {
    const f = (v * rows) % 1;
    return (f - 0.42) * 1.9;
  });
  // ink joints
  g.strokeStyle = L.joint;
  g.lineWidth = Math.max(1.5, 2.5 * scale);
  g.beginPath();
  for (let r = 0; r <= rows; r++) {
    g.moveTo(0, r * ch);
    g.lineTo(w, r * ch);
  }
  for (let r = 0; r < rows; r++) {
    const off = r % 2 === 0 ? 0 : bw / 2;
    for (let x = -off; x < w + bw; x += bw) {
      g.moveTo(x, r * ch);
      g.lineTo(x, (r + 1) * ch);
    }
  }
  g.stroke();
  // cracks
  g.strokeStyle = 'rgba(22, 18, 14, 0.6)';
  g.lineWidth = Math.max(1.2, 1.8 * scale);
  g.beginPath();
  for (let r = 0; r < rows; r++) {
    const off = r % 2 === 0 ? 0 : bw / 2;
    for (let x = -off; x < w; x += bw) {
      if (hash(r + 11, Math.round(x)) > 0.16) continue;
      const cx = x + bw * 0.3;
      const cy = r * ch + ch * 0.2;
      g.moveTo(cx, cy);
      g.lineTo(cx + 8 * scale, cy + 9 * scale);
      g.lineTo(cx + 5 * scale, cy + 17 * scale);
      g.lineTo(cx + 14 * scale, cy + 26 * scale);
    }
  }
  g.stroke();
  // decorations (inside the tile, between the side walls)
  const s = scale;
  const ww = 18 * s;
  const span = w - 2 * ww;
  const spots: Array<[number, number]> = [
    [ww + span * 0.2, ch * 1.2],
    [ww + span * 0.66, ch * 4.1],
  ];
  for (const [x, y] of spots) {
    switch (L.deco) {
      case 'window':
        archWindow(g, x, y, 44 * s, 62 * s, PAL.yel, PAL.yel2, s);
        break;
      case 'heart':
        archWindow(g, x, y, 44 * s, 62 * s, PAL.pink, '#ffc4de', s);
        heartPath(g, x + 22 * s, y + 38 * s, 9 * s);
        g.fillStyle = PAL.red;
        g.fill();
        g.lineWidth = Math.max(1.5, 2 * s);
        g.strokeStyle = PAL.ink;
        g.stroke();
        break;
      case 'torch':
        torch(g, x + 22 * s, y + 40 * s, s);
        break;
      case 'sun':
        sunWindow(g, x + 26 * s, y + 34 * s, 30 * s, s);
        stickerShape(g, STAR10, x + 70 * s, y - 10 * s, 26 * s, 26 * s, PAL.yel2, PAL.ink, Math.max(1.5, 2.2 * s));
        break;
      default: {
        const never: never = L.deco;
        throw new Error(`Unhandled deco: ${String(never)}`);
      }
    }
  }
}

// ───────────────────────────── Side walls ─────────────────────────────

/** Height of one side-wall tile in world units (5 blocks). */
export const WALL_TILE_W = 160;

/** One tile of a side wall (CSS px w x h): big stone / ice blocks you bounce off. `left` = the left wall (light from the right). */
export function paintWallTile(g: CanvasRenderingContext2D, w: number, h: number, scale: number, z: number, left: boolean): void {
  const L = zoneLook(z);
  const n = 5;
  const bh = h / n;
  for (let i = 0; i < n; i++) {
    const y = i * bh;
    g.fillStyle = L.wall;
    g.fillRect(0, y, w, bh);
    // the face towards the shaft is lit, the outside is in shade
    const lit = Math.max(2, 4 * scale);
    g.fillStyle = L.wallHi;
    g.fillRect(left ? w - lit - 2 : 2, y + 2, lit, bh - 4);
    g.fillRect(0, y + 1, w, Math.max(2, 3 * scale));
    g.fillStyle = L.wallLo;
    g.fillRect(left ? 0 : w - lit, y, lit, bh);
    g.fillRect(0, y + bh - Math.max(3, 5 * scale), w, Math.max(3, 5 * scale));
    // frost chips (zone 0) / sparkles
    g.fillStyle = 'rgba(255, 255, 255, 0.75)';
    const k = hash(i, z + (left ? 1 : 2));
    g.fillRect(w * (0.25 + k * 0.3), y + bh * 0.3, Math.max(2, 3 * scale), bh * 0.28);
  }
  halftone(g, 0, 0, w, h, Math.max(3.5, 5 * scale), 'rgba(22, 18, 14, 0.25)', (u, v) => {
    const f = (v * n) % 1;
    return (left ? 1 - u : u) * 0.7 + (f - 0.6);
  });
  g.strokeStyle = PAL.ink;
  g.lineWidth = Math.max(1.5, 2.5 * scale);
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    g.moveTo(0, i * bh);
    g.lineTo(w, i * bh);
  }
  g.stroke();
}

// ───────────────────────────── Small sprites ─────────────────────────────

/** Hazard tape (red / yellow diagonal stripes), 48 x 24 CSS px, tiles horizontally. */
export function paintHazard(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = PAL.yel;
  g.fillRect(0, 0, w, h);
  g.fillStyle = PAL.red;
  g.beginPath();
  for (let x = -h; x < w + h; x += 16) {
    g.moveTo(x, h);
    g.lineTo(x + 8, h);
    g.lineTo(x + 8 + h, 0);
    g.lineTo(x + h, 0);
    g.closePath();
  }
  g.fill();
}

/** "קומה N" sign bolted to the wall above a milestone floor: red plate, ink border, hard shadow. */
export function renderFloorSign(n: number, px: number): { canvas: HTMLCanvasElement; w: number; h: number } {
  const label = `קומה ${n}`;
  const probe = makeLayer(1, 1);
  let tw = px * 4;
  if (probe.ctx) {
    probe.ctx.font = displayFont(px);
    tw = probe.ctx.measureText(label).width;
  }
  probe.canvas.width = 0;
  const w = Math.ceil(tw + px * 1.9);
  const h = Math.ceil(px * 1.75);
  const { canvas, ctx } = makeLayer(w + 5, h + 6);
  if (!ctx) return { canvas, w: w + 5, h: h + 6 };
  roundRectPath(ctx, 4, 5, w - 2, h - 2, px * 0.35);
  ctx.fillStyle = PAL.ink;
  ctx.fill();
  roundRectPath(ctx, 1.5, 1.5, w - 2, h - 2, px * 0.35);
  ctx.fillStyle = PAL.red;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PAL.ink;
  ctx.stroke();
  // bolts
  for (const bx of [px * 0.45, w - px * 0.45]) {
    ctx.beginPath();
    ctx.arc(bx, h / 2, px * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = PAL.paper;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.font = displayFont(px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = px * 0.2;
  ctx.strokeStyle = PAL.ink;
  ctx.fillStyle = PAL.yel;
  drawText(ctx, label, w / 2, h / 2 + px * 0.06, true);
  return { canvas, w: w + 5, h: h + 6 };
}

/** Small star sticker (afterimage trail, sparkles), size x size CSS px. */
export function renderStar(size: number, fill: string): HTMLCanvasElement {
  const { canvas, ctx } = makeLayer(size, size);
  if (ctx) stickerShape(ctx, STAR10, 1, 1, size - 4, size - 4, fill, PAL.ink, 2);
  return canvas;
}
