/**
 * Art of the icy tower climber. Every replaceable picture is a kit file slot under
 * client/public/assets/icy/ (listed in the README there).
 *
 * The hero is a set of full-body sprite frames (hero/*.webp); when they are missing the game
 * draws its small runner with a head from the face slots, whose default is the owner's doll
 * head (client/public/assets/shimi/head.png) and then a generic cartoon face. The tower is
 * stone pictures (side wall, back wall, one ledge per zone, the every-10th-floor ledge,
 * icicles); each one that is missing is drawn by the game from tower.ts instead.
 */
import { assetFileUrl, drawFace, loadAssets, paintDrawable } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';
import { PAL } from './look';

import type { Drawable, FaceExpression, Painter } from '../../kit/assets';

/** Logical box of a face slot in CSS px (pre-rendered at 2x = 256px). */
export const FACE_BOX = 128;

// ───────────────────────────── Hero sprite frames ─────────────────────────────

/**
 * The hero's frames (files hero/<name>.webp, 256 x 256 px, made by tests/e2e/icy-art-hero.py).
 * Every frame shares one anchor: x = the middle of the box, y = the ground line.
 */
export const HERO_FRAMES = ['stand', 'run1', 'run2', 'jump', 'fall', 'ball'] as const;
export type HeroFrame = (typeof HERO_FRAMES)[number];
/** Logical box of a hero frame in CSS px (files are 2x). */
export const HERO_BOX = 128;
/** The ground line (where the feet stand), as a share of the box height from its top. */
export const HERO_BASELINE = 236 / 256;
/** Height of the standing figure as a share of the box. */
export const HERO_STAND = 200 / 256;
/** The spin pivot (the middle of the tucked ball), above the ground line, as a share of the box. */
export const HERO_PIVOT = 87 / 256;

// ───────────────────────────── Ledge pictures (3-slice) ─────────────────────────────

/**
 * Layout of one ledge picture, in its own pixels: left cap, a middle that repeats, right cap.
 * The middle may be cut at `cuts` (joints between blocks): the game strings whole pieces between
 * cuts until the ledge is about as wide as the floor and then scales them a little to fit
 * exactly. The inner edge of each cap fades out over `feather` pixels (the middle runs under it).
 * The whole height is the ledge; its top row is the line the hero stands on.
 * Numbers printed by tests/e2e/icy-art-floor.py.
 */
export interface FloorSlice {
  readonly file: string;
  readonly w: number;
  readonly h: number;
  readonly capL: number;
  readonly capR: number;
  readonly cuts: readonly number[];
  readonly feather: number;
}

/** One ledge per zone (index = zone), then the every-10th-floor ledge. */
export const ZONE_FLOOR_SLICES: readonly FloorSlice[] = [
  { file: 'floors/zone1.png', w: 493, h: 64, capL: 44, capR: 73, cuts: [94, 151, 218, 274, 310, 361], feather: 8 },
  { file: 'floors/zone2.png', w: 345, h: 64, capL: 55, capR: 56, cuts: [108, 169, 234], feather: 8 },
  { file: 'floors/zone3.png', w: 391, h: 64, capL: 51, capR: 37, cuts: [95, 184, 227, 311], feather: 8 },
  { file: 'floors/zone4.png', w: 410, h: 64, capL: 22, capR: 12, cuts: [98, 174, 250, 325], feather: 4 },
];
export const MILESTONE_FLOOR_SLICE: FloorSlice = { file: 'floors/milestone.png', w: 381, h: 64, capL: 43, capR: 50, cuts: [85, 127, 177, 220, 249, 288], feather: 8 };
/** The icicle strip: cells of 32 x 64 px side by side, each one icicle hanging from the top edge. */
export const ICICLE_CELL_W = 32;
export const ICICLE_CELL_H = 64;
export const ICICLE_CELLS = 12;
/** Head radius as a share of the face box (the kit face uses 0.46). */
export const HEAD_SHARE = 0.46;

const FACE_COLOR = '#ffc93c';
const INK = PAL.ink;

/** Generic cartoon face in a red knitted beanie (the fallback head, nobody in particular). */
function beanieFace(expression: FaceExpression): Painter {
  return (ctx, w, h): void => {
    const r = Math.min(w, h) * HEAD_SHARE;
    const cx = w / 2;
    const cy = h / 2 + r * 0.04;
    drawFace(ctx, cx, cy, r, expression, FACE_COLOR);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(r, r);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = INK;
    // hat dome
    ctx.beginPath();
    ctx.moveTo(-0.9, -0.42);
    ctx.bezierCurveTo(-0.9, -1.25, 0.9, -1.25, 0.9, -0.42);
    ctx.closePath();
    ctx.fillStyle = PAL.red;
    ctx.fill();
    ctx.stroke();
    // brim
    roundRectPath(ctx, -0.98, -0.6, 1.96, 0.3, 0.15);
    ctx.fillStyle = PAL.paper;
    ctx.fill();
    ctx.stroke();
    // pompom
    ctx.beginPath();
    ctx.arc(0, -1.12, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = PAL.yel;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
}

/** Placeholder of the floor slots: a paper ledge with an ink outline (64x16 logical). */
function ledgePainter(top: string, face: string): Painter {
  return (ctx, w, h): void => {
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h * 0.4);
    ctx.fillStyle = INK;
    ctx.fillRect(0, h - 2, w, 2);
    ctx.fillRect(0, h * 0.4, w, 1.5);
  };
}

/** Placeholder of the wall slot: one cobalt block course (16x128 logical). */
const wallPainter: Painter = (ctx, w, h) => {
  ctx.fillStyle = PAL.cob;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PAL.cobL;
  ctx.fillRect(w - 4, 0, 3, h);
  ctx.fillStyle = INK;
  for (let y = 0; y < h; y += h / 4) ctx.fillRect(0, y, w, 2);
};

/** Placeholder of the back wall slot: unused (the game paints zone back walls itself), so it stays empty and cheap. */
const emptyPainter: Painter = () => undefined;

/** Placeholder of the shirt slot: unused (the game draws the jacket). */
const shirtPainter: Painter = (ctx, w, h) => {
  ctx.fillStyle = PAL.red;
  roundRectPath(ctx, w * 0.15, h * 0.1, w * 0.7, h * 0.8, w * 0.2);
  ctx.fill();
};

export interface IcyArt {
  readonly face: Drawable;
  readonly faceJump: Drawable;
  readonly faceFall: Drawable;
  readonly platform: Drawable;
  readonly milestone: Drawable;
  readonly wall: Drawable;
  readonly bg: Drawable;
  readonly shirt: Drawable;
  /** The hero's sprite frames (every frame present: a missing one borrows a neighbour), or null when hero/stand is missing. */
  readonly hero: Readonly<Record<HeroFrame, Drawable>> | null;
  /** Ledge picture of each zone (null = not dropped in), the every-10th-floor ledge and the icicle strip. */
  readonly zoneFloors: ReadonlyArray<Drawable | null>;
  readonly milestoneFloor: Drawable | null;
  readonly icicles: Drawable | null;
  /** True when the head is the owner's doll head (shimi/head.png) rather than an icy face file or the cartoon. */
  readonly shimiHead: boolean;
  /** Which icy slots use a real dropped-in file. */
  readonly real: Readonly<Record<string, boolean>>;
  /** UI sprite (not replaceable). */
  readonly finger: Drawable;
  /** Every drawable this round made (for the release on destroy). */
  readonly all: readonly Drawable[];
}

const fingerPainter: Painter = (ctx, w, h) => {
  // a rounded "ghost finger": fingertip pointing down with a hard shadow
  ctx.save();
  ctx.translate(w / 2, h / 2);
  const s = Math.min(w, h) / 100;
  ctx.scale(s, s);
  ctx.fillStyle = INK;
  roundRectPath(ctx, -13, -40, 34, 86, 17);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  roundRectPath(ctx, -18, -44, 34, 86, 17);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PAL.pink;
  roundRectPath(ctx, -10, 14, 18, 20, 8);
  ctx.fill();
  ctx.restore();
};

const FACE_SLOTS = [
  { key: 'face', file: 'face.png', size: FACE_BOX, placeholder: beanieFace('happy') },
  { key: 'faceJump', file: 'face_jump.png', size: FACE_BOX, placeholder: beanieFace('laughing') },
  { key: 'faceFall', file: 'face_fall.png', size: FACE_BOX, placeholder: beanieFace('shocked') },
] as const;

function sliceSlot<K extends string>(key: K, sl: FloorSlice): { key: K; file: string; size: number; height: number; placeholder: Painter } {
  return { key, file: sl.file, size: sl.w / 2, height: sl.h / 2, placeholder: emptyPainter };
}

export async function loadIcyArt(): Promise<IcyArt> {
  const z = ZONE_FLOOR_SLICES;
  const heroWanted = assetFileUrl('icy', 'hero/stand.png') !== null;
  const [a, h] = await Promise.all([
    loadAssets('icy', [
      { key: 'platform', file: 'platform.png', size: 64, height: 16, fit: 'cover', placeholder: ledgePainter(PAL.paper, '#bcd2ff') },
      { key: 'milestone', file: 'milestone.png', size: 64, height: 16, fit: 'cover', placeholder: ledgePainter(PAL.yel, PAL.red) },
      { key: 'wall', file: 'wall.png', size: 20, height: 160, fit: 'cover', placeholder: wallPainter },
      { key: 'bg', file: 'bg.png', size: 360, height: 360, fit: 'cover', placeholder: emptyPainter },
      { key: 'shirt', file: 'shirt.png', size: 64, placeholder: shirtPainter },
      sliceSlot('floor1', z[0] as FloorSlice),
      sliceSlot('floor2', z[1] as FloorSlice),
      sliceSlot('floor3', z[2] as FloorSlice),
      sliceSlot('floor4', z[3] as FloorSlice),
      sliceSlot('floorMilestone', MILESTONE_FLOOR_SLICE),
      { key: 'icicles', file: 'floors/icicles.png', size: (ICICLE_CELL_W * ICICLE_CELLS) / 2, height: ICICLE_CELL_H / 2, placeholder: emptyPainter },
    ]),
    heroWanted
      ? loadAssets(
          'icy',
          HERO_FRAMES.map((f) => ({ key: f, file: `hero/${f}.png`, size: HERO_BOX, placeholder: emptyPainter })),
        )
      : Promise.resolve(null),
  ]);
  const heroSet = h as Record<HeroFrame, Drawable> | null;
  const heroOk = heroSet !== null && !heroSet.stand.isPlaceholder;
  // the head of the small drawn runner: only fetched when the hero sprites are not there
  // (three 256 px pictures that nothing would show otherwise)
  const [f, s] = heroOk
    ? [null, null]
    : await Promise.all([
        loadAssets('icy', FACE_SLOTS),
        // the fallback head: the owner's doll (fetched only when no icy face.png is dropped in)
        assetFileUrl('icy', 'face.png') ? Promise.resolve(null) : loadAssets('shimi', [{ key: 'head', file: 'head.png', size: FACE_BOX, placeholder: emptyPainter }]),
      ]);
  const none = paintDrawable('none', emptyPainter, 1, 1);
  const faces = f ?? { face: none, faceJump: none, faceFall: none };
  const real: Record<string, boolean> = {};
  for (const [k, d] of Object.entries(a)) real[k] = !d.isPlaceholder;
  // a face file counts as dropped in when it exists (it is not fetched while the hero sprites are shown)
  for (const sl of FACE_SLOTS) real[sl.key] = f ? !f[sl.key].isPlaceholder : assetFileUrl('icy', sl.file) !== null;
  for (const fr of HERO_FRAMES) real[`hero_${fr}`] = heroSet !== null && !heroSet[fr].isPlaceholder;
  const doll = s && !s.head.isPlaceholder ? s.head : null;
  // head priority: icy/face*.png → icy/face.png → shimi/head.png → cartoon
  const face = !faces.face.isPlaceholder ? faces.face : (doll ?? faces.face);
  const pick = (d: Drawable): Drawable => (!d.isPlaceholder ? d : !faces.face.isPlaceholder ? faces.face : (doll ?? d));
  // hero frames: a missing frame borrows the nearest pose
  let hero: Record<HeroFrame, Drawable> | null = null;
  if (heroOk && heroSet) {
    const or = (d: Drawable, alt: Drawable): Drawable => (d.isPlaceholder ? alt : d);
    const stand = heroSet.stand;
    const run1 = or(heroSet.run1, or(heroSet.run2, stand));
    const jump = or(heroSet.jump, stand);
    hero = { stand, run1, run2: or(heroSet.run2, run1), jump, fall: or(heroSet.fall, jump), ball: or(heroSet.ball, jump) };
  }
  const opt = (d: Drawable): Drawable | null => (d.isPlaceholder ? null : d);
  const finger = paintDrawable('finger', fingerPainter, 64, 64);
  const all: Drawable[] = [...Object.values(a), finger, none];
  if (heroSet) all.push(...Object.values(heroSet));
  if (f) all.push(...Object.values(f));
  if (s) all.push(s.head);
  return {
    face,
    faceJump: pick(faces.faceJump),
    faceFall: pick(faces.faceFall),
    platform: a.platform,
    milestone: a.milestone,
    wall: a.wall,
    bg: a.bg,
    shirt: a.shirt,
    hero,
    zoneFloors: [opt(a.floor1), opt(a.floor2), opt(a.floor3), opt(a.floor4)],
    milestoneFloor: opt(a.floorMilestone),
    icicles: opt(a.icicles),
    shimiHead: f !== null && f.face.isPlaceholder && doll !== null,
    real,
    finger,
    all,
  };
}
