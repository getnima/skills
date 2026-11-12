/**
 * Art of the icy tower climber. Every replaceable picture is a kit file slot under
 * client/public/assets/icy/ (listed in the README there). The climber's head defaults to the
 * owner's doll head (client/public/assets/shimi/head.png) and falls back to a generic cartoon
 * face when that file is missing. The tower itself (walls, back wall, floors, zones) is drawn
 * by the game from tower.ts when no picture is dropped in.
 */
import { drawFace, loadAssets, paintDrawable } from '../../kit/assets';
import { roundRectPath } from '../../kit/canvas';
import { PAL } from './look';

import type { Drawable, FaceExpression, Painter } from '../../kit/assets';

/** Logical box of a face slot in CSS px (pre-rendered at 2x = 256px). */
export const FACE_BOX = 128;
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
  /** True when the head is the owner's doll head (shimi/head.png) rather than an icy face file or the cartoon. */
  readonly shimiHead: boolean;
  /** Which icy slots use a real dropped-in file. */
  readonly real: Readonly<Record<string, boolean>>;
  /** UI sprite (not replaceable). */
  readonly finger: Drawable;
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

export async function loadIcyArt(): Promise<IcyArt> {
  const [a, s] = await Promise.all([
    loadAssets('icy', [
      { key: 'face', file: 'face.png', size: FACE_BOX, placeholder: beanieFace('happy') },
      { key: 'faceJump', file: 'face_jump.png', size: FACE_BOX, placeholder: beanieFace('laughing') },
      { key: 'faceFall', file: 'face_fall.png', size: FACE_BOX, placeholder: beanieFace('shocked') },
      { key: 'platform', file: 'platform.png', size: 64, height: 16, fit: 'cover', placeholder: ledgePainter(PAL.paper, '#bcd2ff') },
      { key: 'milestone', file: 'milestone.png', size: 64, height: 16, fit: 'cover', placeholder: ledgePainter(PAL.yel, PAL.red) },
      { key: 'wall', file: 'wall.png', size: 16, height: 128, fit: 'cover', placeholder: wallPainter },
      { key: 'bg', file: 'bg.png', size: 360, height: 640, fit: 'cover', placeholder: emptyPainter },
      { key: 'shirt', file: 'shirt.png', size: 64, placeholder: shirtPainter },
    ]),
    // the default head: the owner's doll (the icy face slots win when they hold a file)
    loadAssets('shimi', [{ key: 'head', file: 'head.png', size: FACE_BOX, placeholder: emptyPainter }]),
  ]);
  const real: Record<string, boolean> = {};
  for (const [k, d] of Object.entries(a)) real[k] = !d.isPlaceholder;
  const doll = s.head.isPlaceholder ? null : s.head;
  // head priority: icy/face*.png → icy/face.png → shimi/head.png → cartoon
  const face = !a.face.isPlaceholder ? a.face : (doll ?? a.face);
  const pick = (d: Drawable): Drawable => (!d.isPlaceholder ? d : !a.face.isPlaceholder ? a.face : (doll ?? d));
  return {
    face,
    faceJump: pick(a.faceJump),
    faceFall: pick(a.faceFall),
    platform: a.platform,
    milestone: a.milestone,
    wall: a.wall,
    bg: a.bg,
    shirt: a.shirt,
    shimiHead: a.face.isPlaceholder && doll !== null,
    real,
    finger: paintDrawable('finger', fingerPainter, 64, 64),
  };
}
