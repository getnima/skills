/**
 * Art of נינג׳ה תבורי. Every replaceable picture is a kit file slot under
 * client/public/assets/ninja/ (see the README there): the Israeli food that is thrown
 * (food/*.png), the golden falafel trophy, and one bomb per party host (bombs/*.png).
 * Which throw wears which picture is decided in skins.ts (looks only).
 *
 * The pictures are not round and not framed alike, so each is measured once when it loads
 * and becomes a Sprite: the smallest circle around its solid pixels is the hit circle the
 * game draws to (aspect kept), and the sprite is trimmed to what it shows, so a blit costs
 * what the food covers, not a whole box. A bomb is framed by its black sphere instead
 * (BOMB_FRAME): the sphere is the hit circle and the cap, hat and hair stand out of it. The
 * bomb's fuse, its spark, the warning burst and the blade are drawn in code by the game, so
 * they survive an art swap. A missing file falls back to a drawing made here, which goes
 * through the same measuring. Everything else the game shows (the stage, splats, halves, UI
 * stickers) is pre-rendered once here so the hot path only calls drawImage.
 *
 * Style: the party look (shimi/README.md): flat colours, thick ink outlines, hard highlights,
 * no soft glows.
 */
import { assetFileUrl, drawFace, loadAssets, paintDrawable, shade } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';
import { KABOOM, PAL, STAR10, halftone, makeLayer, polyPath, stickerShape } from './look';
import { BOMB_KEYS, TARGET_KEYS } from './skins';

import type { Drawable, FaceExpression, Painter } from '../../kit/assets';
import type { TargetKey } from './skins';

/** Logical box of a target in CSS px, as the game lays it out (rastered at 2x). */
export const SPRITE_BOX = 128;
/** Share of that box the body circle covers (radius / box): the hit circle, and what a picture is fitted into. */
export const BODY_RADIUS = 0.42;
/** Raster px of one hit radius in every sprite (the body circle of SPRITE_BOX at 2x). */
const UNIT_PX = SPRITE_BOX * 2 * BODY_RADIUS;

const INK = PAL.ink;

/**
 * What the cut face of a half shows, drawn over its `flesh` in its `detail` (and `extra`)
 * colours:
 * - plain: nothing (plastic)                 - star: a star (gold)
 * - stone: one round thing in the middle     - seeds: a ring of seeds (pickle)
 * - speckles: dots all over (slush with mint and ice, an airy puff)
 * - wrap: meat shreds, salad flecks and a sauce drizzle (shawarma in laffa)
 * - pool: a pool in the middle, chickpeas and spice around it (hummus plate)
 * - stuffed: an egg slice, a sauce drip and salad on a dark filling (sabich)
 * - balls: three cut falafel balls and salad
 * - flaky: thin pastry layers around a filling (bourekas)
 * - eggs: sunny eggs in sauce (shakshuka)
 * - fibers: short meat fibres (schnitzel)
 * - jam: a jam core in airy dough (sufganiya)
 */
export type CutPattern = 'plain' | 'star' | 'stone' | 'seeds' | 'speckles' | 'wrap' | 'pool' | 'stuffed' | 'balls' | 'flaky' | 'eggs' | 'fibers' | 'jam';
/** How a cut splashes: thin fast juice, thick slow sauce (tahini, amba, jam), or dry crumbs (falafel, pastry, plastic). */
export type SplashKind = 'juice' | 'sauce' | 'crumbs';

/** The look of a cut, per picture: the halves' cut face, the droplets and the splat decals. Looks only. */
export interface CutLook {
  /** Outer ring of the cut face (skin, crust, pita, plate, pan). */
  readonly rind: string;
  /** Optional band between the ring and the inside (the soft inside of a pita). */
  readonly band?: string;
  /** The inside. */
  readonly flesh: string;
  /** Main colour of the pattern (seeds, yolk, jam, filling). */
  readonly detail: string;
  /** More colours of the pattern, in the order its drawing says. */
  readonly extra?: readonly string[];
  readonly pattern: CutPattern;
  /** Height of the cut face as a share of its width (default 0.36): lower for flat things, higher for a round stick. */
  readonly depth?: number;
  /**
   * Turn of the picture inside its halves (radians, clockwise): the picture is cut along its
   * own horizontal middle line after this turn, so a long diagonal thing can be cut across.
   */
  readonly turn?: number;
  /** Colour of the droplets and the splat decals. */
  readonly splash: string;
  /** Second colour: every other droplet; in a decal the inner pool of a sauce, or every other crumb. */
  readonly splash2?: string;
  /** Small dots over the decal and among the droplets (powdered sugar on jam, mint in limonana). */
  readonly specks?: string;
  /** Crumbs only: a small sauce puddle under the crumbs of the decal (the tahini of a falafel). */
  readonly puddle?: string;
  readonly splashKind: SplashKind;
}

/** A picture that has a cut look: the ordinary targets and the golden one. */
export type CutKey = TargetKey | 'gold_falafel';

const PITA = '#F0D3A0';
const PITA_CRUST = '#DDAE66';
const TAHINI = '#F4EEDD';

/**
 * THE table: picture → how its cut looks. Colours and splash kinds follow the "Slice colours"
 * table of client/public/assets/ninja/food/README.md. Changing how a food cuts means changing
 * its row here (and adding a CutPattern when none fits).
 */
export const CUT_LOOKS: Readonly<Record<CutKey, CutLook>> = {
  // laffa around meat, salad flecks (tomato, cucumber, pink turnip), an amba / tahini drizzle; cut across the roll
  shawarma: { rind: '#E2BC7C', band: '#F1D9A8', flesh: '#7A4A2A', detail: '#F2C230', extra: ['#E83A2A', '#5DBB3F', '#F06AA8'], pattern: 'wrap', depth: 0.62, turn: -0.98, splash: '#F2C230', splash2: TAHINI, splashKind: 'sauce' },
  // plate edge, hummus, the olive-oil pool, chickpeas, paprika and parsley
  hummus: { rind: '#3EC1C9', flesh: '#E9D2A6', detail: '#9A9A22', extra: ['#D4472A', '#4E9A3A'], pattern: 'pool', depth: 0.24, splash: '#E3C997', splash2: '#9A9A22', splashKind: 'sauce' },
  // pita, fried eggplant, a slice of egg (white + yolk), amba, salad
  sabich: { rind: PITA_CRUST, band: PITA, flesh: '#4A2340', detail: '#FFC71A', extra: ['#FAFAF2', '#F4A01C', '#5DBB3F', '#E83A2A'], pattern: 'stuffed', splash: '#F4A01C', splash2: TAHINI, splashKind: 'sauce' },
  // pita, tahini, three falafel balls (brown crust, green inside), tomato
  falafel: { rind: PITA_CRUST, band: PITA, flesh: TAHINI, detail: '#6CB33A', extra: ['#6B3D1E', '#E83A2A'], pattern: 'balls', splash: '#6B3D1E', splash2: '#6CB33A', puddle: TAHINI, splashKind: 'crumbs' },
  // glazed crust, pale flaky layers, white cheese
  bourekas: { rind: '#D9912F', flesh: '#F3DDB0', detail: '#FBF6E8', extra: ['#D9B47A'], pattern: 'flaky', depth: 0.3, splash: '#E7B76A', splash2: '#F3DDB0', splashKind: 'crumbs' },
  // pan rim, tomato sauce, eggs (white + yolk), parsley
  shakshuka: { rind: '#1E1E1E', flesh: '#E2321F', detail: '#FFB21A', extra: ['#FFFFFF', '#4E9A3A'], pattern: 'eggs', depth: 0.32, splash: '#D62A18', splash2: '#FFB21A', splashKind: 'sauce' },
  // crumb crust, white chicken
  schnitzel: { rind: '#D9802A', flesh: '#F6EBD6', detail: '#DCC9A6', pattern: 'fibers', depth: 0.28, splash: '#E39A3B', splash2: '#D9802A', splashKind: 'crumbs' },
  // fried outside, fluffy dough, jam core; jam and powdered sugar fly
  sufganiya: { rind: '#D08A3A', flesh: '#F7E2B6', detail: '#C8102E', pattern: 'jam', splash: '#D21A3A', specks: '#FFFFFF', splashKind: 'sauce' },
  // skin, pale flesh, seeds; brine
  pickle: { rind: '#556B1F', flesh: '#C9D97A', detail: '#E9EDB8', pattern: 'seeds', depth: 0.7, turn: 0.22, splash: '#B7C95A', splash2: '#C9D97A', splashKind: 'juice' },
  // glass, green slush with mint and ice
  limonana: { rind: '#DDF4EE', flesh: '#8EE53F', detail: '#2E8B3A', extra: ['#FFFFFF'], pattern: 'speckles', depth: 0.45, splash: '#9BEA4A', specks: '#2E8B3A', splashKind: 'juice' },
  // an airy puff
  peanut_puffs: { rind: '#E0A63A', flesh: '#F2CF6A', detail: '#D9A93F', pattern: 'speckles', depth: 0.3, splash: '#E9B740', splash2: '#F2CF6A', splashKind: 'crumbs' },
  // white plastic shards
  garden_chair: { rind: '#DADADA', flesh: '#F4F4F2', detail: '#DADADA', pattern: 'plain', depth: 0.5, splash: '#DADADA', splash2: '#F4F4F2', splashKind: 'crumbs' },
  // blue foam with the white side stripe, the red strap's plug; foam bits
  flip_flop: { rind: '#1F7FC4', band: '#FFFFFF', flesh: '#2E9BE0', detail: '#E0342A', pattern: 'stone', depth: 0.26, splash: '#2E9BE0', splash2: '#E0342A', splashKind: 'crumbs' },
  // gold with a star; the game adds the coin burst
  gold_falafel: { rind: '#E6A100', flesh: '#FFD21F', detail: '#FFF8E6', pattern: 'star', splash: '#FFC21A', splash2: '#FFFFFF', splashKind: 'crumbs' },
};

type Mood = 'smile' | 'oh' | 'grin' | 'tongue' | 'cheeky';
const MOODS: readonly Mood[] = ['grin', 'smile', 'oh', 'tongue', 'cheeky'];

/** Tiny cute face on a drawn fallback, in unit space (body radius = 1). */
function cuteFace(ctx: CanvasRenderingContext2D, mood: Mood, dx = 0, dy = 0.08): void {
  ctx.save();
  ctx.translate(dx, dy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // eyes
  for (const ex of [-0.3, 0.3]) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    if (mood === 'cheeky' && ex > 0) {
      ctx.lineWidth = 0.09;
      ctx.strokeStyle = INK;
      ctx.moveTo(ex - 0.12, -0.12);
      ctx.quadraticCurveTo(ex, -0.24, ex + 0.12, -0.12);
      ctx.stroke();
      continue;
    }
    ctx.ellipse(ex, -0.12, 0.1, 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex - 0.03, -0.17, 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
  // cheeks
  ctx.fillStyle = 'rgba(255, 80, 120, 0.45)';
  ctx.beginPath();
  ctx.ellipse(-0.5, 0.08, 0.13, 0.08, 0, 0, Math.PI * 2);
  ctx.ellipse(0.5, 0.08, 0.13, 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  // mouth
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#5a1030';
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  switch (mood) {
    case 'smile':
    case 'cheeky':
      ctx.moveTo(-0.17, 0.12);
      ctx.quadraticCurveTo(0, 0.3, 0.17, 0.12);
      ctx.stroke();
      break;
    case 'oh':
      ctx.ellipse(0, 0.2, 0.09, 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'grin':
      ctx.moveTo(-0.22, 0.1);
      ctx.quadraticCurveTo(0, 0.42, 0.22, 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'tongue':
      ctx.moveTo(-0.18, 0.12);
      ctx.quadraticCurveTo(0, 0.28, 0.18, 0.12);
      ctx.stroke();
      ctx.fillStyle = '#ff6b8f';
      ctx.beginPath();
      ctx.ellipse(0.04, 0.27, 0.08, 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 0.04;
      ctx.stroke();
      break;
    default: {
      const never: never = mood;
      throw new Error(`Unhandled mood: ${String(never)}`);
    }
  }
  ctx.restore();
}

/** Runs `paint` in unit space: (0,0) = box center, 1 = body radius. */
function unit(paint: (ctx: CanvasRenderingContext2D) => void): Painter {
  return (ctx, w, h) => {
    const r = Math.min(w, h) * BODY_RADIUS;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(r, r);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    paint(ctx);
    ctx.restore();
  };
}

/** Flat comic body: base colour, a darker crescent bottom-right, ink outline. */
function body(ctx: CanvasRenderingContext2D, color: string, rx = 1, ry = 1): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shade(color, -0.28);
  ctx.beginPath();
  ctx.ellipse(0.32 * rx, 0.38 * ry, rx * 1.02, ry * 0.98, 0, 0, Math.PI * 2);
  ctx.ellipse(-0.1 * rx, -0.08 * ry, rx * 1.05, ry * 1.02, 0, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** Hard white highlight (flat shapes, no gradient). */
function shine(ctx: CanvasRenderingContext2D, rx = 1, ry = 1): void {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(-0.44 * rx, -0.5 * ry, 0.22 * rx, 0.11 * ry, -0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-0.66 * rx, -0.22 * ry, 0.06 * Math.min(rx, ry), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The drawn stand-in of each target, used only when its file is missing or did not load: a
 * flat sticker blob in the food's colour and rough proportions (body radius = 1) with a
 * little face. It is painted where the picture would be and measured like one, and it is
 * cut with the same CUT_LOOKS row, so its inside is still the food's.
 */
const FALLBACK_SHAPES: Readonly<Record<TargetKey, readonly [color: string, rx: number, ry: number]>> = {
  shawarma: ['#F1D9A8', 1, 0.62],
  hummus: ['#3EC1C9', 1, 0.6],
  sabich: ['#F0C27A', 0.92, 1],
  falafel: ['#9A6A32', 1, 0.96],
  bourekas: ['#E7B76A', 1, 0.66],
  shakshuka: ['#E2321F', 1, 0.8],
  schnitzel: ['#D9802A', 1, 0.72],
  sufganiya: ['#E5A552', 1, 0.82],
  pickle: ['#6B8A2A', 0.52, 1],
  limonana: ['#8EE53F', 0.62, 1],
  peanut_puffs: ['#F2CF6A', 1, 0.7],
  garden_chair: ['#F4F4F2', 0.85, 1],
  flip_flop: ['#2E9BE0', 1, 0.52],
};

function fallbackPainter(key: TargetKey, index: number): Painter {
  const [color, rx, ry] = FALLBACK_SHAPES[key];
  return unit((ctx) => {
    body(ctx, color, rx, ry);
    shine(ctx, rx, ry);
    cuteFace(ctx, MOODS[index % MOODS.length] ?? 'smile', 0, 0.08 * ry);
  });
}

/** The gold coin (used when neither food/gold_falafel.png nor the party props exist). */
const goldPainter = unit((ctx) => {
  ctx.fillStyle = PAL.yel;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAL.org;
  ctx.beginPath();
  ctx.ellipse(0.35, 0.4, 1, 0.95, 0, 0, Math.PI * 2);
  ctx.ellipse(-0.06, -0.06, 1.02, 1, 0, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.arc(0, 0, 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = PAL.yel2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? 0.58 : 0.25;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  shine(ctx);
});

// ───────────────────────────── Bombs ─────────────────────────────

/**
 * Framing of the host bomb pictures (client/public/assets/ninja/bombs/README.md), as shares
 * of the picture: the black sphere (centre and radius, measured on both files) and the top
 * of the metal cap, where the game attaches its fuse. The drawn stand-ins use the same frame.
 */
export const BOMB_FRAME = { cx: 0.5, cy: 0.603, r: 0.365, capX: 0.505, capY: 0.031 } as const;
/** Top of the metal cap from the sphere's centre, in sphere radii (the fuse starts here; y < 0 = up). */
export const BOMB_CAP_X = (BOMB_FRAME.capX - BOMB_FRAME.cx) / BOMB_FRAME.r;
export const BOMB_CAP_Y = (BOMB_FRAME.capY - BOMB_FRAME.cy) / BOMB_FRAME.r;

/** The drawn stand-in of a host bomb, in the frame of the real pictures (unit = the picture). */
function paintBombFallback(ctx: CanvasRenderingContext2D, ring: string, face: FaceExpression): void {
  const { cx, cy, r, capX, capY } = BOMB_FRAME;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  // metal cap (the fuse comes out of its top), then the black collar under it
  const capW = 0.07;
  const capBottom = cy - r * 0.98;
  ctx.fillStyle = '#b9bcc6';
  ctx.lineWidth = 0.012;
  roundRectPath(ctx, capX - capW / 2, capY, capW, capBottom - capY - 0.02, 0.012);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(capX - capW / 2 + 0.012, capY + 0.02, 0.012, capBottom - capY - 0.07);
  ctx.fillStyle = '#26212f';
  roundRectPath(ctx, capX - 0.07, capBottom - 0.035, 0.14, 0.07, 0.015);
  ctx.fill();
  ctx.stroke();
  // sphere
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r, r);
  ctx.fillStyle = '#26212f';
  ctx.beginPath();
  ctx.arc(0, 0, 0.97, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#0b0912';
  ctx.beginPath();
  ctx.ellipse(0.35, 0.42, 1, 0.95, 0, 0, Math.PI * 2);
  ctx.ellipse(-0.06, -0.06, 1.02, 1, 0, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.arc(0, 0, 0.97, 0, Math.PI * 2);
  ctx.stroke();
  // face window: a coloured ring (one colour per host), ink outline, a generic face
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(0, 0.06, 0.68, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.06;
  ctx.stroke();
  drawFace(ctx, 0, 0.06, 0.56, face, '#ffc79a');
  // hard highlight
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  ctx.arc(0, 0, 0.82, Math.PI * 1.12, Math.PI * 1.36);
  ctx.stroke();
  ctx.restore();
}

/** The two stand-ins differ, so the hosts' turns still show: [ring colour, expression]. */
const BOMB_FALLBACKS: readonly (readonly [string, FaceExpression])[] = [
  [PAL.red, 'laughing'],
  [PAL.pink, 'wink'],
];

/** Slot placeholder of host bomb `index`: its stand-in, painted in the picture's own frame. */
function bombFallbackPainter(index: number): Painter {
  const [ring, face] = BOMB_FALLBACKS[index % BOMB_FALLBACKS.length] ?? [PAL.red, 'laughing'];
  return (ctx, w, h) => {
    ctx.save();
    ctx.scale(w, h);
    paintBombFallback(ctx, ring, face);
    ctx.restore();
  };
}

// ───────────────────────────── Sprites: measuring and fitting a picture ─────────────────────────────

/**
 * A picture pre-rendered for the game: scaled so that one hit radius is UNIT_PX px, trimmed
 * to what it shows, and placed around a centre (a target: the middle of the smallest circle
 * around it; a bomb: the middle of its sphere).
 */
export interface Sprite {
  readonly key: string;
  readonly source: HTMLCanvasElement;
  /** The box of `source` from the sprite's centre, in hit radii (see drawSprite). */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Points around what it shows (x0, y0, x1, y1, ...) from the centre, in hit radii: its halves are trimmed with them. */
  readonly outline: Float32Array;
  /** True when the file was missing (or did not load) and the game's own drawing is shown. */
  readonly isPlaceholder: boolean;
}

/** Draw `s` around (x, y) so that its hit circle has the radius `r` (CSS px), turned by `rotation` radians. */
export function drawSprite(g: CanvasRenderingContext2D, s: Sprite, x: number, y: number, r: number, rotation = 0): void {
  if (rotation) {
    g.save();
    g.translate(x, y);
    g.rotate(rotation);
    g.drawImage(s.source, s.left * r, s.top * r, s.width * r, s.height * r);
    g.restore();
  } else {
    g.drawImage(s.source, x + s.left * r, y + s.top * r, s.width * r, s.height * r);
  }
}

// ───────────────────────────── Fitting a picture into the body circle ─────────────────────────────

/** Side of the small copy a picture is measured on (px). */
const MEASURE = 96;
/** A pixel is solid above this alpha (0..255): the hit circle goes around these; soft edges and shadows do not count. */
const SOLID_ALPHA = 24;
/** A pixel is visible above this alpha: a sprite is trimmed around these, so nothing that can be seen is cut off. */
const VISIBLE_ALPHA = 3;

/** Smallest circle around the points (x0, y0, x1, y1, ...): [cx, cy, r]. Exact; expected linear time. */
function enclosingCircle(pts: Float32Array, n: number): [number, number, number] {
  // visit the points in a scrambled order (rows in order would be the slow case)
  const order = new Uint16Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  let seed = 12345;
  for (let i = n - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const j = seed % (i + 1);
    const t = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = t;
  }
  const X = (i: number): number => pts[(order[i] ?? 0) * 2] ?? 0;
  const Y = (i: number): number => pts[(order[i] ?? 0) * 2 + 1] ?? 0;
  let cx = X(0);
  let cy = Y(0);
  let r = 0;
  const outside = (x: number, y: number): boolean => Math.hypot(x - cx, y - cy) > r + 1e-4;
  for (let i = 1; i < n; i++) {
    const px = X(i);
    const py = Y(i);
    if (!outside(px, py)) continue;
    cx = px;
    cy = py;
    r = 0;
    for (let j = 0; j < i; j++) {
      const qx = X(j);
      const qy = Y(j);
      if (!outside(qx, qy)) continue;
      cx = (px + qx) / 2;
      cy = (py + qy) / 2;
      r = Math.hypot(px - qx, py - qy) / 2;
      for (let k = 0; k < j; k++) {
        const sx = X(k);
        const sy = Y(k);
        if (!outside(sx, sy)) continue;
        // the circle through the three
        const d = 2 * (px * (qy - sy) + qx * (sy - py) + sx * (py - qy));
        if (Math.abs(d) < 1e-9) continue;
        const p2 = px * px + py * py;
        const q2 = qx * qx + qy * qy;
        const s2 = sx * sx + sy * sy;
        cx = (p2 * (qy - sy) + q2 * (sy - py) + s2 * (py - qy)) / d;
        cy = (p2 * (sx - qx) + q2 * (px - sx) + s2 * (qx - px)) / d;
        r = Math.hypot(px - cx, py - cy);
      }
    }
  }
  return [cx, cy, r];
}

/** What a picture shows, measured once on a small copy. Everything in px of the picture. */
interface Scan {
  /** The smallest circle around its solid pixels. */
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** The box around everything visible (soft edges too), with a little room. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** The outer corners of every row's first and last visible pixel. */
  readonly outline: Float32Array;
}

/**
 * Measure `src` on a small copy (MEASURE px, aspect kept): per row its first and last solid
 * and visible pixel. The circle goes around the outer corners of the solid ones, so it never
 * cuts into the picture. Null for an empty picture, or when its pixels cannot be read.
 */
function scanPicture(src: HTMLCanvasElement): Scan | null {
  const m = measureContext();
  if (!m || src.width === 0 || src.height === 0) return null;
  const N = MEASURE;
  const k = N / Math.max(src.width, src.height);
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.clearRect(0, 0, N, N);
  m.drawImage(src, 0, 0, src.width * k, src.height * k);
  let data: Uint8ClampedArray;
  try {
    data = m.getImageData(0, 0, N, N).data;
  } catch {
    return null; // a tainted canvas (a picture from another origin): use the picture as it is framed
  }
  const solid = new Float32Array(N * 8);
  const seen = new Float32Array(N * 8);
  let ns = 0;
  let nv = 0;
  let bx0 = N;
  let bx1 = 0;
  let by0 = N;
  let by1 = 0;
  for (let y = 0; y < N; y++) {
    let s0 = -1;
    let s1 = -1;
    let v0 = -1;
    let v1 = -1;
    for (let x = 0; x < N; x++) {
      const alpha = data[(y * N + x) * 4 + 3] ?? 0;
      if (alpha <= VISIBLE_ALPHA) continue;
      if (v0 < 0) v0 = x;
      v1 = x;
      if (alpha <= SOLID_ALPHA) continue;
      if (s0 < 0) s0 = x;
      s1 = x;
    }
    if (v0 < 0) continue;
    for (const px of [v0, v1 + 1]) {
      for (const py of [y, y + 1]) {
        seen[nv * 2] = px / k;
        seen[nv * 2 + 1] = py / k;
        nv++;
      }
    }
    bx0 = Math.min(bx0, v0);
    bx1 = Math.max(bx1, v1 + 1);
    by0 = Math.min(by0, y);
    by1 = y + 1;
    if (s0 < 0) continue;
    for (const px of [s0, s1 + 1]) {
      for (const py of [y, y + 1]) {
        solid[ns * 2] = px;
        solid[ns * 2 + 1] = py;
        ns++;
      }
    }
  }
  if (ns === 0) return null;
  const [cx, cy, r] = enclosingCircle(solid, ns);
  if (!(r > 0)) return null;
  return {
    cx: cx / k,
    cy: cy / k,
    r: r / k,
    // one px of the copy of room on every side
    x0: Math.max(0, (bx0 - 1) / k),
    y0: Math.max(0, (by0 - 1) / k),
    x1: Math.min(src.width, (bx1 + 1) / k),
    y1: Math.min(src.height, (by1 + 1) / k),
    outline: seen.slice(0, nv * 2),
  };
}

/**
 * `src` as a sprite: (cx, cy) px of it is the sprite's centre and `unit` px of it one hit
 * radius; trimmed to the scan's box (the whole picture without a scan).
 */
function makeSprite(key: string, src: HTMLCanvasElement, scan: Scan | null, cx: number, cy: number, unit: number, isPlaceholder: boolean): Sprite {
  const k = UNIT_PX / unit;
  const x0 = scan ? scan.x0 : 0;
  const y0 = scan ? scan.y0 : 0;
  const x1 = scan ? scan.x1 : src.width;
  const y1 = scan ? scan.y1 : src.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((x1 - x0) * k));
  canvas.height = Math.max(1, Math.ceil((y1 - y0) * k));
  const g = canvas.getContext('2d');
  if (g) {
    g.imageSmoothingQuality = 'high';
    g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    g.drawImage(src, 0, 0);
  }
  const pts = scan ? scan.outline : new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]);
  const outline = new Float32Array(pts.length);
  for (let i = 0; i + 1 < pts.length; i += 2) {
    outline[i] = ((pts[i] ?? 0) - cx) / unit;
    outline[i + 1] = ((pts[i + 1] ?? 0) - cy) / unit;
  }
  return { key, source: canvas, left: (x0 - cx) / unit, top: (y0 - cy) / unit, width: canvas.width / UNIT_PX, height: canvas.height / UNIT_PX, outline, isPlaceholder };
}

/**
 * A picture as a target sprite: the smallest circle around what it shows is its hit circle.
 * Whatever its shape, it then sits inside the hit circle the game draws to, as large as it
 * can, aspect kept.
 */
function fitSprite(key: string, pic: Drawable): Sprite {
  const src = pic.source;
  const scan = scanPicture(src);
  if (!scan) return makeSprite(key, src, null, src.width / 2, src.height / 2, Math.min(src.width, src.height) / 2, pic.isPlaceholder);
  return makeSprite(key, src, scan, scan.cx, scan.cy, scan.r, pic.isPlaceholder);
}

/** A bomb picture as a sprite: its black sphere (BOMB_FRAME) is the hit circle. */
function bombSprite(key: string, pic: Drawable): Sprite {
  const src = pic.source;
  return makeSprite(key, src, scanPicture(src), BOMB_FRAME.cx * src.width, BOMB_FRAME.cy * src.height, BOMB_FRAME.r * src.width, pic.isPlaceholder);
}

// ───────────────────────────── Stage, hint hand ─────────────────────────────

/** The slot placeholder of background.jpg (unused: the game paints its stage at device pixels). */
const backgroundPainter: Painter = (ctx, w, h) => {
  ctx.fillStyle = PAL.cobD;
  ctx.fillRect(0, 0, w, h);
};

/**
 * The stage (painted once per canvas size, straight at device pixels): a cobalt TV-show stage
 * with a faint sunburst, a halftone vignette, red side curtains, a string of light bulbs and
 * a stage floor with marquee bulbs. Dark in the middle so bright fruit pops.
 */
export function paintStage(ctx: CanvasRenderingContext2D, w: number, h: number, top: number): void {
  const cx = w / 2;
  const cy = top + (h - top) * 0.42;
  ctx.fillStyle = PAL.cobD;
  ctx.fillRect(0, 0, w, h);
  // sunburst hint
  ctx.fillStyle = '#14299e';
  ctx.beginPath();
  const n = 28;
  const R = Math.hypot(w, h);
  for (let i = 0; i < n; i += 2) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
    ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
    ctx.closePath();
  }
  ctx.fill();
  // halftone vignette (dots grow towards the edges)
  const maxD = Math.hypot(w / 2, h / 2);
  halftone(ctx, 0, 0, w, h, 11, 'rgba(6, 10, 50, 0.55)', (u, v) => {
    const d = Math.hypot((u - 0.5) * w, (v - 0.45) * h) / maxD;
    return (d - 0.38) * 2.1;
  });
  // stage floor
  const fy = h * 0.88;
  ctx.fillStyle = PAL.cob;
  ctx.fillRect(0, fy, w, h - fy);
  ctx.strokeStyle = 'rgba(22, 18, 14, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -6; i <= 6; i++) {
    ctx.moveTo(cx + i * w * 0.09, fy);
    ctx.lineTo(cx + i * w * 0.2, h);
  }
  ctx.stroke();
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, fy - 2, w, 4);
  ctx.fillStyle = PAL.red;
  ctx.fillRect(0, fy + 2, w, Math.max(10, h * 0.018));
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, fy + 2 + Math.max(10, h * 0.018), w, 3);
  // marquee bulbs on the stage edge
  const bulbs = (y: number, r: number, gap: number, colors: readonly string[]): void => {
    let k = 0;
    for (let x = gap / 2; x < w; x += gap, k++) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = colors[k % colors.length] ?? PAL.yel;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = PAL.ink;
      ctx.stroke();
    }
  };
  bulbs(fy + 2 + Math.max(10, h * 0.018) / 2, Math.max(3, h * 0.0045), Math.max(18, w * 0.055), [PAL.yel, PAL.white]);
  // string lights across the top, under the HUD
  const sy = top + (h - top) * 0.05;
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, sy);
  ctx.quadraticCurveTo(w / 2, sy + h * 0.07, w, sy);
  ctx.stroke();
  const lights = [PAL.yel, PAL.pink, PAL.white, PAL.org];
  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    const x = t * w;
    const y = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * (sy + h * 0.07) + t * t * sy;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x - 2.5, y, 5, 5);
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 5, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = lights[i % lights.length] ?? PAL.yel;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // side curtains
  const cw = Math.max(14, w * 0.055);
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 0 : w - cw;
    ctx.fillStyle = PAL.red;
    ctx.fillRect(x0, 0, cw, fy);
    ctx.fillStyle = PAL.redD;
    for (let k = 0; k < 3; k++) ctx.fillRect(x0 + (k + 0.55) * (cw / 3), 0, cw / 9, fy);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(side === 0 ? cw - 1.5 : w - cw - 1.5, 0, 3, fy);
  }
}

/** Ghost hand of the opening hint: a white glove pointing finger. */
const handPainter: Painter = (ctx, w, h) => {
  const s = Math.min(w, h) / 100;
  ctx.save();
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  // finger (tip at 30, 8)
  roundRectPath(ctx, 22, 6, 17, 48, 8.5);
  ctx.fill();
  ctx.stroke();
  // palm + folded fingers
  ctx.beginPath();
  ctx.moveTo(22, 46);
  ctx.quadraticCurveTo(10, 50, 14, 68);
  ctx.quadraticCurveTo(18, 90, 44, 92);
  ctx.quadraticCurveTo(72, 92, 76, 70);
  ctx.quadraticCurveTo(80, 50, 66, 46);
  ctx.quadraticCurveTo(58, 40, 50, 46);
  ctx.quadraticCurveTo(44, 40, 38, 46);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(50, 46);
  ctx.lineTo(50, 60);
  ctx.moveTo(62, 47);
  ctx.lineTo(62, 60);
  ctx.stroke();
  ctx.restore();
};

// ───────────────────────────── Loading ─────────────────────────────

/** Golden target skins from the owner's party props (used when food/gold_falafel.png is missing). */
const GOLD_PROPS = [
  { key: 'crown', file: 'prop_08_crown.png' },
  { key: 'party', file: 'prop_17_party_hat.png' },
  { key: 'hearts', file: 'prop_09_heart_glasses.png' },
] as const;

/** A gold disc (body-sized, flat, ink outlined) wearing a party prop. */
function goldSkin(key: string, prop: Drawable): Drawable {
  return paintDrawable(
    `gold_${key}`,
    (ctx, w, h) => {
      const r = Math.min(w, h) * BODY_RADIUS;
      const cx = w / 2;
      const cy = h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = PAL.yel;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = PAL.org;
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.35, cy + r * 0.4, r, r * 0.95, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - r * 0.06, cy - r * 0.06, r * 1.02, r, 0, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
      ctx.lineWidth = Math.max(3, r * 0.1);
      ctx.strokeStyle = PAL.ink;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = Math.max(2, r * 0.05);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      const k = Math.min((r * 1.75) / prop.width, (r * 1.5) / prop.height);
      prop.draw(ctx, cx, cy + r * 0.02, prop.width * k, prop.height * k, -0.12);
      // hard highlight
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.5, cy - r * 0.6, r * 0.2, r * 0.09, -0.7, 0, Math.PI * 2);
      ctx.fill();
    },
    SPRITE_BOX,
  );
}

export interface NinjaArt {
  /** The ordinary targets, index = skin (skins.ts TARGET_KEYS: the 11 foods, then the joke items). */
  readonly targets: readonly Sprite[];
  /** Cut look per target skin (CUT_LOOKS). */
  readonly cuts: readonly CutLook[];
  /** Cut look of the golden target. */
  readonly goldCut: CutLook;
  /** The golden target's looks: the gold falafel trophy (without the file: gold props, one per throw by its id). */
  readonly golds: readonly Sprite[];
  /** The host bombs, index = skin (skins.ts BOMB_KEYS). */
  readonly bombs: readonly Sprite[];
  readonly background: Drawable;
  readonly hand: Drawable;
  /** UI sprites (pre-rendered, not replaceable). */
  readonly sunburst: HTMLCanvasElement;
  readonly kaboom: HTMLCanvasElement;
  readonly spark: HTMLCanvasElement;
  /** Which ninja pictures come from a real file (false = the drawn stand-in is shown). */
  readonly real: Readonly<Record<string, boolean>>;
}

/**
 * Slot size the pictures are loaded at: the kit rasters a slot at 2x, so 192 keeps the files'
 * own 384 px. They are then measured and made into sprites, and these big copies are released.
 */
const PICTURE = 192;
const nothing: Painter = () => undefined;

export async function loadNinjaArt(): Promise<NinjaArt> {
  const [a, p] = await Promise.all([
    loadAssets('ninja', [
      ...TARGET_KEYS.map((key, i) => ({ key, file: `food/${key}.png`, size: PICTURE, placeholder: fallbackPainter(key, i) })),
      { key: 'gold_falafel', file: 'food/gold_falafel.png', size: PICTURE, placeholder: goldPainter },
      ...BOMB_KEYS.map((key, i) => ({ key, file: `bombs/${key}.png`, size: PICTURE, placeholder: bombFallbackPainter(i) })),
      { key: 'background', file: 'background.jpg', size: 430, height: 932, fit: 'cover', placeholder: backgroundPainter },
    ]),
    // the props are fetched only when no gold falafel file is there
    assetFileUrl('ninja', 'food/gold_falafel.png')
      ? Promise.resolve({} as Record<string, Drawable>)
      : loadAssets(
          'shimi',
          GOLD_PROPS.map((g) => ({ key: g.key, file: g.file, size: 96, placeholder: nothing })),
        ),
  ]);
  const real: Record<string, boolean> = {};
  for (const [k, d] of Object.entries(a)) real[k] = !d.isPlaceholder;
  // every picture (a file, or the drawing that stands in for it) becomes a sprite; its big copy goes
  const targets = TARGET_KEYS.map((key) => {
    const sprite = fitSprite(key, a[key]);
    a[key].source.width = 0;
    return sprite;
  });
  let golds: Sprite[];
  const props = GOLD_PROPS.map((g) => p[g.key]).filter((d): d is Drawable => !!d && !d.isPlaceholder);
  if (a.gold_falafel.isPlaceholder && props.length > 0) {
    golds = props.map((d) => {
      const skin = goldSkin(d.key, d);
      const sprite = fitSprite(skin.key, skin);
      skin.source.width = 0;
      return sprite;
    });
  } else {
    golds = [fitSprite('gold_falafel', a.gold_falafel)];
  }
  a.gold_falafel.source.width = 0;
  for (const d of Object.values(p)) d.source.width = 0;
  const bombs = BOMB_KEYS.map((key) => {
    const sprite = bombSprite(key, a[key]);
    a[key].source.width = 0;
    return sprite;
  });
  // the warning burst behind a bomb: red kaboom with an ink outline
  const kb = makeLayer(128, 128);
  if (kb.ctx) {
    stickerShape(kb.ctx, KABOOM, 4, 4, 116, 116, PAL.yel, PAL.ink, 3);
    kb.ctx.translate(64, 64);
    kb.ctx.rotate(0.3);
    stickerShape(kb.ctx, KABOOM, -46, -46, 92, 92, PAL.red, PAL.redD, 2.5);
    kb.ctx.setTransform(2, 0, 0, 2, 0, 0);
  }
  // fuse spark: small yellow star
  const sp = makeLayer(48, 48);
  if (sp.ctx) {
    polyPath(sp.ctx, STAR10, 3, 3, 42, 42);
    sp.ctx.fillStyle = PAL.yel;
    sp.ctx.fill();
    sp.ctx.lineWidth = 2.5;
    sp.ctx.strokeStyle = PAL.ink;
    sp.ctx.stroke();
    sp.ctx.beginPath();
    sp.ctx.arc(24, 24, 6, 0, Math.PI * 2);
    sp.ctx.fillStyle = '#ffffff';
    sp.ctx.fill();
  }
  return {
    targets,
    cuts: TARGET_KEYS.map((key) => CUT_LOOKS[key]),
    goldCut: CUT_LOOKS.gold_falafel,
    golds,
    bombs,
    background: a.background,
    hand: paintDrawable('hand', handPainter, 100),
    sunburst: renderSunburst(),
    kaboom: kb.canvas,
    spark: sp.canvas,
    real,
  };
}

/** Yellow / orange rays (behind the golden target), 128 x 128 CSS px. */
function renderSunburst(): HTMLCanvasElement {
  const { canvas, ctx } = makeLayer(128, 128);
  if (!ctx) return canvas;
  const c = 64;
  ctx.beginPath();
  for (let i = 0; i < 16; i += 2) {
    const a0 = (i / 16) * Math.PI * 2;
    const a1 = ((i + 1) / 16) * Math.PI * 2;
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a0) * 62, c + Math.sin(a0) * 62);
    ctx.lineTo(c + Math.cos(a1) * 62, c + Math.sin(a1) * 62);
    ctx.closePath();
  }
  ctx.fillStyle = PAL.yel;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = PAL.ink;
  ctx.stroke();
  return canvas;
}

/**
 * The backdrop pre-scaled once to the canvas' device pixels and then copied 1:1 every
 * frame. A cover-scaled drawImage of a full-screen picture is a resample of every pixel
 * every frame: on a slow phone that alone cost a whole frame (measured at CPU 4x).
 * Redrawn only when the canvas size changes. Draw it first, outside any shake. Without a
 * real background file the stage is painted straight at device pixels (crisp halftone).
 */
export interface Backdrop {
  draw(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, top: number): void;
  dispose(): void;
}

export function createBackdrop(bg: Drawable, overscale = 1): Backdrop {
  let cache: HTMLCanvasElement | null = null;
  let cw = 0;
  let ch = 0;
  return {
    draw(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, top: number): void {
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (!cache || pw !== cw || ph !== ch) {
        cache ??= document.createElement('canvas');
        cw = pw;
        ch = ph;
        cache.width = pw;
        cache.height = ph;
        const c = cache.getContext('2d');
        if (c) {
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (bg.isPlaceholder) paintStage(c, w, h, top);
          else {
            const k = Math.max(w / bg.width, h / bg.height) * overscale;
            bg.draw(c, w / 2, h / 2, bg.width * k, bg.height * k);
          }
        }
      }
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(cache, 0, 0);
      g.restore();
    },
    dispose(): void {
      if (cache) {
        cache.width = 0;
        cache.height = 0;
      }
      cache = null;
    },
  };
}

// ───────────────────────────── Halves and splats ─────────────────────────────

/**
 * The one small canvas pictures are measured on (their circle and box, where a cut line
 * crosses them). Pixels are read back only from here, never from a sprite the game draws
 * every frame: a canvas that is read back may stop being drawn fast. Kept for the page's life.
 */
let measure: CanvasRenderingContext2D | null = null;
function measureContext(): CanvasRenderingContext2D | null {
  if (measure) return measure;
  const c = document.createElement('canvas');
  c.width = MEASURE;
  c.height = MEASURE;
  measure = c.getContext('2d', { willReadFrequently: true });
  return measure;
}

/** The cut face of `look`: ring, optional band, inside and its pattern, centred, rx x ry. */
function cutFace(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, look: CutLook): void {
  const TAU = Math.PI * 2;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  g.fillStyle = look.rind;
  g.fill();
  g.lineWidth = Math.max(3, rx * 0.06);
  g.strokeStyle = INK;
  g.stroke();
  if (look.band) {
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.93, ry * 0.88, 0, 0, TAU);
    g.fillStyle = look.band;
    g.fill();
  }
  const fx = rx * (look.band ? 0.78 : 0.86);
  const fy = ry * (look.band ? 0.68 : 0.78);
  g.beginPath();
  g.ellipse(cx, cy, fx, fy, 0, 0, TAU);
  g.fillStyle = look.flesh;
  g.fill();
  g.save();
  g.clip();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const c = look.detail;
  const extra = look.extra ?? [];
  // (u, v) in -1..1 across the inside; sizes as shares of its half width / half height
  const X = (u: number): number => cx + u * fx;
  const Y = (v: number): number => cy + v * fy;
  const blob = (u: number, v: number, a: number, b: number, color: string, turn = 0): void => {
    g.beginPath();
    g.ellipse(X(u), Y(v), a * fx, b * fy, turn, 0, TAU);
    g.fillStyle = color;
    g.fill();
  };
  /** Small squarish bits (chopped salad) on a spiral, colours taking turns. */
  const flecks = (colors: readonly string[], n: number, from: number, to: number, phase: number): void => {
    if (colors.length === 0) return;
    const s = Math.max(4, fx * 0.13);
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + phase;
      const d = from + ((to - from) * (i + 0.5)) / n;
      g.fillStyle = colors[i % colors.length] ?? c;
      g.fillRect(X(Math.cos(a) * d) - s / 2, Y(Math.sin(a) * d) - s * 0.4, s, s * 0.8);
    }
  };
  switch (look.pattern) {
    case 'plain':
      break;
    case 'star': {
      g.fillStyle = c;
      polyPath(g, STAR10, cx - rx * 0.32, cy - ry * 0.55, rx * 0.64, ry * 1.1);
      g.fill();
      break;
    }
    case 'stone': {
      g.beginPath();
      g.ellipse(cx, cy, fx * 0.36, fy * 0.5, 0, 0, TAU);
      g.fillStyle = c;
      g.fill();
      g.lineWidth = Math.max(2, rx * 0.035);
      g.strokeStyle = INK;
      g.stroke();
      break;
    }
    case 'seeds': {
      // a paler heart, then seeds around it
      blob(0, 0, 0.5, 0.5, shade(look.flesh, 0.3));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + 0.3;
        const d = i % 2 === 0 ? 0.56 : 0.3;
        blob(Math.cos(a) * d, Math.sin(a) * d, 0.07, 0.15, c, a);
      }
      break;
    }
    case 'speckles': {
      // dots all over in the detail colour; every third in the extra colour, when there is one
      for (let i = 0; i < 26; i++) {
        const a = i * 2.39996;
        const d = Math.sqrt((i + 0.5) / 26) * 0.9;
        g.beginPath();
        g.arc(X(Math.cos(a) * d), Y(Math.sin(a) * d), rx * (0.03 + (i % 3) * 0.014), 0, TAU);
        g.fillStyle = i % 3 === 1 ? (extra[0] ?? c) : c;
        g.fill();
      }
      break;
    }
    case 'wrap': {
      // meat shreds (darker, lighter), salad flecks, a drizzle of sauce
      const dark = shade(look.flesh, -0.32);
      const light = shade(look.flesh, 0.2);
      blob(-0.42, -0.25, 0.34, 0.3, dark, 0.4);
      blob(0.36, 0.32, 0.36, 0.3, dark, -0.3);
      blob(0.2, -0.42, 0.28, 0.22, light);
      blob(-0.3, 0.42, 0.26, 0.2, light);
      flecks(extra, 9, 0.2, 0.86, 0.5);
      g.strokeStyle = c;
      g.lineWidth = Math.max(4, fy * 0.2);
      g.beginPath();
      g.moveTo(X(-0.62), Y(-0.05));
      g.lineTo(X(-0.3), Y(-0.38));
      g.lineTo(X(-0.05), Y(0.1));
      g.lineTo(X(0.26), Y(-0.3));
      g.lineTo(X(0.56), Y(0.08));
      g.stroke();
      break;
    }
    case 'pool': {
      // the pool in the middle with a peak of the spread in it, chickpeas, spice (extra[0]) and herbs (extra[1])
      blob(0, 0, 0.5, 0.52, c);
      blob(0.02, 0.02, 0.2, 0.22, shade(look.flesh, 0.3));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.4;
        blob(Math.cos(a) * 0.74, Math.sin(a) * 0.72, 0.09, 0.14, shade(look.flesh, -0.2));
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 1.05;
        g.beginPath();
        g.arc(X(Math.cos(a) * 0.76), Y(Math.sin(a) * 0.7), Math.max(2.5, rx * 0.032), 0, TAU);
        g.fillStyle = extra[i % 2] ?? c;
        g.fill();
      }
      break;
    }
    case 'stuffed': {
      // on the dark filling: a slice of egg (white extra[0], yolk), a sauce drip (extra[1]), salad (extra[2..])
      blob(-0.55, -0.3, 0.4, 0.5, shade(look.flesh, 0.22), 0.3);
      blob(-0.42, 0.12, 0.34, 0.46, extra[1] ?? c, -0.2);
      blob(-0.72, 0.5, 0.14, 0.24, extra[1] ?? c);
      blob(0.34, -0.04, 0.44, 0.66, extra[0] ?? '#ffffff');
      blob(0.36, -0.04, 0.21, 0.34, c);
      flecks(extra.slice(2), 6, 0.55, 0.9, 2.2);
      break;
    }
    case 'balls': {
      // three falafel balls cut open (crust extra[0], inside in the detail colour), tomato (extra[1])
      const dark = shade(c, -0.25);
      for (const [u, v] of [
        [-0.52, 0.12],
        [0, -0.14],
        [0.52, 0.12],
      ] as const) {
        blob(u, v, 0.29, 0.62, extra[0] ?? INK);
        blob(u, v, 0.21, 0.45, c);
        for (let i = 0; i < 3; i++) {
          const a = i * 2.1 + u * 3;
          blob(u + Math.cos(a) * 0.09, v + Math.sin(a) * 0.2, 0.035, 0.07, dark);
        }
      }
      flecks(extra.slice(1), 4, 0.5, 0.78, 1.25);
      break;
    }
    case 'flaky': {
      // thin wavy pastry layers (extra[0]), the filling in the middle
      g.strokeStyle = extra[0] ?? shade(look.flesh, -0.18);
      g.lineWidth = Math.max(2, fy * 0.09);
      g.beginPath();
      for (let k = -3; k <= 3; k++) {
        const y = Y(k * 0.27);
        g.moveTo(X(-1), y);
        for (let i = 1; i <= 8; i++) g.lineTo(X(-1 + i / 4), y + (i % 2 === 0 ? -1 : 1) * fy * 0.06);
      }
      g.stroke();
      blob(0, 0.02, 0.5, 0.42, c);
      g.lineWidth = Math.max(1.5, fy * 0.05);
      g.strokeStyle = shade(c, -0.2);
      g.stroke();
      break;
    }
    case 'eggs': {
      // darker swirls of sauce, two sunny eggs (white extra[0], yolk), herbs (extra[1])
      g.strokeStyle = shade(look.flesh, -0.22);
      g.lineWidth = Math.max(2, fy * 0.1);
      g.beginPath();
      g.ellipse(X(0), Y(0), fx * 0.8, fy * 0.74, 0, 0.3, 2.2);
      g.moveTo(X(0.7), Y(-0.35));
      g.ellipse(X(0), Y(0), fx * 0.8, fy * 0.74, 0, 3.6, 5.6);
      g.stroke();
      const white = extra[0] ?? '#ffffff';
      blob(-0.3, 0, 0.4, 0.6, white);
      blob(-0.08, 0.24, 0.3, 0.4, white);
      blob(-0.3, -0.02, 0.19, 0.3, c);
      blob(-0.36, -0.12, 0.05, 0.08, '#ffffff');
      blob(0.5, -0.08, 0.26, 0.42, white);
      blob(0.5, -0.08, 0.12, 0.2, c);
      flecks(extra.slice(1), 4, 0.6, 0.88, 0.2);
      break;
    }
    case 'fibers': {
      // short slanted meat fibres
      g.strokeStyle = c;
      g.lineWidth = Math.max(2, fy * 0.1);
      g.beginPath();
      for (let i = 0; i < 9; i++) {
        const u = -0.76 + i * 0.19;
        const v = ((i % 3) - 1) * 0.42;
        g.moveTo(X(u - 0.06), Y(v + 0.2));
        g.lineTo(X(u + 0.06), Y(v - 0.2));
      }
      g.stroke();
      break;
    }
    case 'jam': {
      // air bubbles in the dough, a jam core with a drip and a shine
      const hole = shade(look.flesh, -0.14);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + 0.5;
        blob(Math.cos(a) * 0.74, Math.sin(a) * 0.7, 0.06, 0.1, hole);
      }
      blob(0, 0, 0.44, 0.52, c);
      blob(0.34, 0.3, 0.17, 0.24, c);
      blob(-0.14, -0.16, 0.1, 0.11, 'rgba(255, 255, 255, 0.8)');
      break;
    }
    default: {
      const never: never = look.pattern;
      throw new Error(`Unhandled cut pattern: ${String(never)}`);
    }
  }
  // wet highlight (not on dry things)
  if (look.splashKind !== 'crumbs') {
    g.fillStyle = 'rgba(255, 255, 255, 0.75)';
    g.beginPath();
    g.ellipse(cx - fx * 0.5, cy - fy * 0.5, fx * 0.16, fy * 0.13, -0.3, 0, TAU);
    g.fill();
  }
  g.restore();
}

/**
 * Where the horizontal line through the centre of `d` (turned by `turn`) crosses something
 * solid: [x0, x1, x0, x1, ...] in sprite px from the centre. Gaps and bits narrower than 5%
 * of the sprite box are ignored (a chair gives one span per leg; a solid food gives one).
 * Empty when the line crosses nothing, or when pixels cannot be read.
 */
function cutSpans(d: Sprite, turn: number): number[] {
  const m = measureContext();
  const out: number[] = [];
  if (!m) return out;
  const N = MEASURE;
  const half = SPRITE_BOX; // the sprite box at 2x is SPRITE_BOX px on each side of the centre
  const rows = 3;
  const band = 4; // px on each side of the line
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.clearRect(0, 0, N, N);
  // the band around the line squeezed into a few rows, the box's width across the canvas
  m.setTransform(N / (2 * half), 0, 0, rows / (2 * band), N / 2, rows / 2);
  m.rotate(turn);
  m.drawImage(d.source, d.left * UNIT_PX, d.top * UNIT_PX, d.width * UNIT_PX, d.height * UNIT_PX);
  m.setTransform(1, 0, 0, 1, 0, 0);
  let data: Uint8ClampedArray;
  try {
    data = m.getImageData(0, 0, N, rows).data;
  } catch {
    return out;
  }
  const min = Math.ceil(N * 0.05);
  const px = (col: number): number => (col / N) * 2 * half - half;
  let start = -1;
  let gap = 0;
  const close = (end: number): void => {
    if (start >= 0 && end - start >= min) out.push(px(start), px(end));
    start = -1;
  };
  for (let x = 0; x < N; x++) {
    let solid = false;
    for (let y = 0; y < rows; y++) if ((data[(y * N + x) * 4 + 3] ?? 0) > 96) solid = true;
    if (solid) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0 && ++gap >= min) {
      close(x - gap + 1);
    }
  }
  close(N - gap);
  return out;
}

const NO_OUTLINE = new Float32Array(0);

/**
 * The two halves of a sliced target, pre-cut once along the horizontal line through its
 * centre (after the look's `turn`), each showing the cut face of its food wherever that
 * line crosses the picture: as wide as the food is there, not as the hit circle.
 * [upper half, lower half], each a sprite around the same centre, trimmed to its own half
 * and its cut face. Drawing a half is then one rotated drawImage of a small picture, not a
 * clip per half per frame.
 */
export function buildHalves(d: Sprite, look: CutLook): readonly [Sprite, Sprite] {
  const U = UNIT_PX;
  const turn = look.turn ?? 0;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  // the box of the turned picture, px from the centre
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < d.outline.length; i += 2) {
    const x = (d.outline[i] ?? 0) * U;
    const y = (d.outline[i + 1] ?? 0) * U;
    const tx = x * cos - y * sin;
    const ty = x * sin + y * cos;
    x0 = Math.min(x0, tx);
    x1 = Math.max(x1, tx);
    y0 = Math.min(y0, ty);
    y1 = Math.max(y1, ty);
  }
  if (!(x1 > x0 && y1 > y0)) {
    // no outline: the whole sprite box
    x0 = y0 = -SPRITE_BOX;
    x1 = y1 = SPRITE_BOX;
  }
  let spans = cutSpans(d, turn);
  // nothing measured (no 2D read-back): one face as wide as the body circle
  if (spans.length === 0) spans = [-U * 0.94, U * 0.94];
  const depth = look.depth ?? 0.36;
  const make = (upper: boolean): Sprite => {
    // this half's own box: its side of the picture, and the cut faces (they lean over the line)
    let bx0 = x0;
    let bx1 = x1;
    let by0 = upper ? y0 : 0;
    let by1 = upper ? 0 : y1;
    const faces: number[] = [];
    for (let i = 0; i + 1 < spans.length; i += 2) {
      const a = spans[i] ?? 0;
      const b = spans[i + 1] ?? 0;
      const rx = ((b - a) / 2) * 0.98;
      const ry = Math.min(rx * depth, U * 0.4);
      // the face leans towards the viewer: the upper half shows it below its cut, the lower above
      const fx = (a + b) / 2;
      const fy = upper ? ry * 0.15 : -ry * 0.15;
      const line = Math.max(3, rx * 0.06) / 2;
      faces.push(fx, fy, rx, ry);
      bx0 = Math.min(bx0, fx - rx - line);
      bx1 = Math.max(bx1, fx + rx + line);
      by0 = Math.min(by0, fy - ry - line);
      by1 = Math.max(by1, fy + ry + line);
    }
    bx0 = Math.floor(bx0) - 1;
    by0 = Math.floor(by0) - 1;
    bx1 = Math.ceil(bx1) + 1;
    by1 = Math.ceil(by1) + 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, bx1 - bx0);
    c.height = Math.max(1, by1 - by0);
    const g = c.getContext('2d');
    if (g) {
      g.translate(-bx0, -by0); // from here on: px from the centre
      g.save();
      g.beginPath();
      if (upper) g.rect(bx0, by0, bx1 - bx0, -by0);
      else g.rect(bx0, 0, bx1 - bx0, by1);
      g.clip();
      g.rotate(turn);
      g.drawImage(d.source, d.left * U, d.top * U, d.width * U, d.height * U);
      g.restore();
      for (let i = 0; i + 3 < faces.length; i += 4) cutFace(g, faces[i] ?? 0, faces[i + 1] ?? 0, faces[i + 2] ?? 0, faces[i + 3] ?? 0, look);
    }
    return { key: d.key, source: c, left: bx0 / U, top: by0 / U, width: c.width / U, height: c.height / U, outline: NO_OUTLINE, isPlaceholder: d.isPlaceholder };
  };
  return [make(true), make(false)];
}

/**
 * Splat decals of one cut look, `count` shapes, `size` x `size` CSS px each at `scale` (the
 * canvas' device pixel ratio, so the game blits them 1:1), flat with an ink outline:
 * juice = a splashy blob with drops, sauce = a thick round puddle with an inner pool in the
 * second colour, crumbs = scattered bits in both colours (over a small puddle, when the look
 * has one). `specks` are dotted over a juice or a sauce.
 */
export function buildSplats(look: CutLook, count: number, size = 96, scale = 2): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  const color = look.splash;
  const kind = look.splashKind;
  for (let s = 0; s < count; s++) {
    const { canvas, ctx } = makeLayer(size, size, scale);
    if (ctx) {
      // paint in a 96-unit box, each shape turned differently
      ctx.scale(size / 96, size / 96);
      ctx.translate(48, 48);
      ctx.rotate(s * 2.1);
      ctx.translate(-48, -48);
      ctx.lineJoin = 'round';
      // a sauce and the puddle under crumbs are thick and round; a juice is spiky
      const sauce = kind !== 'juice';
      const blob = (k: number, ox: number, oy: number): void => {
        ctx.beginPath();
        const n = sauce ? 5 + s : 9 + s * 2;
        for (let i = 0; i <= n * 2; i++) {
          const a = (i / (n * 2)) * Math.PI * 2;
          const wob = sauce ? 0.9 + 0.1 * Math.sin(i * 1.3 + s) : i % 2 === 0 ? 1 : 0.62 + 0.18 * Math.sin(i * 1.7 + s);
          const r = (sauce ? 27 : 30) * k * wob * (1 + 0.12 * Math.sin(a * 3 + s * 2));
          const x = 48 + ox + Math.cos(a) * r;
          const y = 48 + oy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.quadraticCurveTo(48 + ox + Math.cos(a - 0.15) * r * 1.08, 48 + oy + Math.sin(a - 0.15) * r * 1.08, x, y);
        }
        ctx.closePath();
      };
      if (kind === 'crumbs') {
        if (look.puddle) {
          blob(0.72, 0, 0);
          ctx.fillStyle = look.puddle;
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = PAL.ink;
          ctx.stroke();
        }
        // irregular little chunks, a few big ones, the two colours taking turns
        for (let pass = 0; pass < 2; pass++) {
          ctx.beginPath();
          for (let i = pass; i < 16; i += 2) {
            // evenly scattered (a sunflower), the big ones near the middle
            const a = i * 2.39996 + s;
            const d = 5 + 33 * Math.sqrt((i + 0.5) / 16);
            const r = i < 4 ? 7 : 3.5 + (i % 3);
            const x = 48 + Math.cos(a) * d;
            const y = 48 + Math.sin(a) * d;
            ctx.moveTo(x - r, y - r * 0.4);
            ctx.lineTo(x + r * 0.3, y - r);
            ctx.lineTo(x + r, y + r * 0.2);
            ctx.lineTo(x - r * 0.2, y + r);
            ctx.closePath();
          }
          ctx.fillStyle = pass === 0 ? color : (look.splash2 ?? color);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = PAL.ink;
          ctx.stroke();
        }
      } else {
        blob(1, 0, 0);
        // drops around the blob (a sauce has two fat ones)
        for (let i = 0; i < (sauce ? 2 : 5); i++) {
          const a = i * 1.37 + s;
          const d = sauce ? 36 : 36 + (i % 2) * 6;
          const r = sauce ? 7 : 4 + (i % 3);
          ctx.moveTo(48 + Math.cos(a) * d + r, 48 + Math.sin(a) * d);
          ctx.arc(48 + Math.cos(a) * d, 48 + Math.sin(a) * d, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = sauce ? 3 : 2.5;
        ctx.strokeStyle = PAL.ink;
        ctx.stroke();
        // an inner pool: the second colour in a sauce (oil in hummus, yolk in shakshuka), else lighter
        blob(sauce ? 0.55 : 0.45, -6, -6);
        ctx.fillStyle = sauce && look.splash2 ? look.splash2 : shade(color, 0.3);
        ctx.fill();
        if (look.specks) {
          ctx.fillStyle = look.specks;
          ctx.beginPath();
          for (let i = 0; i < 9; i++) {
            const a = i * 2.39996 + s * 1.3;
            const d = 5 + 19 * Math.sqrt((i + 0.5) / 9);
            const x = 48 + Math.cos(a) * d;
            const y = 48 + Math.sin(a) * d;
            const r = 1.5 + (i % 2) * 0.7;
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
          ctx.fill();
        }
        ctx.beginPath();
        ctx.ellipse(36, 36, sauce ? 8 : 6, sauce ? 4.5 : 3.5, -0.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fill();
      }
    }
    out.push(canvas);
  }
  return out;
}
