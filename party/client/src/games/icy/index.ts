/**
 * "אייסי שימי": a vertical ice-platform climber.
 *
 * Hold the left / right half of the screen to run on slippery ice; the face
 * jumps by itself every time it lands while a side is held (or on a quick
 * tap), and the faster it runs the higher it jumps. The floors scroll down,
 * slowly at first and steadily faster; falling off the bottom ends the run,
 * a new one starts from the ground and the best run of the round counts.
 *
 * All gameplay time is fixed steps of the kit loop (freeze-safe), the tower
 * comes from the round seed in screen-independent world units (same tower on
 * every phone), and the art comes from file slots (see art.ts).
 *
 * Look (render-only, never read by the game logic): you are inside a stone tower. The inner
 * back wall of the current zone (and of the next one near its first floor) is a pre-rendered
 * tile blitted down the shaft at half the floor speed; the side walls are pre-rendered tiles
 * blitted per row; every floor is a pre-rendered ledge sprite; the hero is a full-body sprite
 * frame (stand / run / jump / fall / spin) picked from the body's motion. All of them come
 * from pictures (art.ts, sprites.ts) with a painted fallback (tower.ts and the small drawn
 * runner here). The ledges change material every 25 floors. A quality flag drops snow / wind
 * streaks when frames are slow.
 */
import { GAMES } from '../../../../shared/protocol';
import { sfx } from '../../kit/audio';
import { createGameCanvas, drawText, roundRectPath } from '../../kit/canvas';
import { clamp, createFx, ease, lerp } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createInput } from '../../kit/input';
import { STEP_HZ, createLoop } from '../../kit/loop';
import { HERO_BASELINE, HERO_PIVOT, HERO_STAND, MILESTONE_FLOOR_SLICE, ZONE_FLOOR_SLICES, loadIcyArt } from './art';
import { FLOOR_H, INNER_L, INNER_R, MILESTONE_EVERY, WALL_W, WORLD_W, buildLevel, floorAtOrBelow, isMilestone } from './level';
import { PAL, blit, createStickerCache, displayFont, loadDisplayFont, makeLayer, renderChip, renderSticker } from './look';
import { MAX_VX, R, copyBody, createBody, createEvents, stepBody } from './physics';
import { bakeFinish, bakeIcicles, createScratch, drawIcicles, drawSlicedLedge, stampSticker } from './sprites';
import { BACK_TILE_W, STONE_LOOKS, WALL_TILE_W, ZONE_FLOORS, ZONE_LOOKS, greyCopy, paintBackDeco, paintBackTile, paintHazard, paintPictureTile, paintWallTile, renderFloorSign, renderStar, zoneLook, zoneOfFloor } from './tower';

import type { GameContext, GameInstance, GameModule } from '../types';
import type { Drawable } from '../../kit/assets';
import type { KitPointer } from '../../kit/input';
import type { FloorSlice, HeroFrame } from './art';
import type { Sticker } from './look';
import type { Body } from './physics';
import type { Baked, BakedIcicles, StickerFinish } from './sprites';
import type { ZoneLook } from './tower';

/** Test hook (QA bots and e2e): live state plus a predictor that runs the real physics. */
export interface IcyDebug {
  readonly state: {
    mode: string;
    x: number;
    py: number;
    vx: number;
    vy: number;
    grounded: number;
    cam: number;
    camV: number;
    camOn: boolean;
    follow: number;
    runs: number;
    runFloor: number;
    best: number;
    dir: number;
    steps: number;
    paused: boolean;
  };
  /** Which art slots use a real dropped-in file (true) instead of the placeholder. */
  readonly art: Record<string, boolean>;
  floors(from: number, n: number): Array<{ i: number; alt: number; x: number; half: number }>;
  /** Start (n > 0) or stop (0) recording [step, dir, x, py, vx, vy, grounded, cam] per fixed step. */
  trace(n: number): void;
  readonly traced: ReadonlyArray<readonly number[]>;
  /**
   * Run the real physics from the current state with `plan` ([dir, steps] pairs,
   * the last one repeats; dir 2 = push the way the face moves), at most `maxSteps` steps. Returns every landing and
   * whether the face would fall off the bottom (camera modelled as in the game).
   */
  predict(plan: ReadonlyArray<readonly [number, number]>, maxSteps: number): { landings: Array<{ step: number; floor: number; x: number }>; deadAt: number; x: number; py: number; vx: number; margin: number };
  /** Look only (tests): zone shown, quality flag, offscreen canvases held, where the hero's feet were last drawn (CSS px). */
  readonly look: { zone: number; lowQuality: boolean; canvases: number; heroX: number; heroY: number; heroFrame: string };
}

declare global {
  interface Window {
    __icy?: IcyDebug;
  }
}

// ───────────────────────────── Tuning (world units, seconds) ─────────────────────────────

/** Jumps this strong spin the face and leave a streak. */
const SUPER_JUMP_VY = 1250;
/** A combo dies when no 2+ floor jump lands within this many steps. */
const COMBO_WINDOW = Math.round(3 * STEP_HZ);
const COMBO_MULT_CAP = 10;
const COMBO_POINTS = 4;
const FLOOR_POINTS = 10;
/** The floors start scrolling once the face reached this floor, or after CAM_START_STEPS. */
const CAM_START_FLOOR = 4;
const CAM_START_STEPS = Math.round(4.5 * STEP_HZ);
const CAM_V0 = 55;
const CAM_ACC = 5.5;
const CAM_MAX = 320;
const CAM_SPEEDUP_EVERY = 15 * STEP_HZ;
/**
 * Camera keeps the head at most this many world units above the bottom edge
 * (the death line). A world constant, not a share of the screen: a tall phone
 * sees further up but gets exactly the same room below the face as a small one.
 * Only a very short play area (landscape) uses less, so the face stays on screen.
 */
const CAM_FOLLOW_WORLD = 360;
const CAM_FOLLOW_MAX_SHARE = 0.62;
/** The camera bottom starts a bit below the ground so the ground slab is visible. */
const START_CAM = -48;
/** The beat between a fall and the next run. */
const DEAD_STEPS = Math.round(0.8 * STEP_HZ);
const DEAD_SWOOSH_AT = Math.round(0.42 * STEP_HZ);
/** Taps: hold the side for at least this long, and jump if grounded within the buffer. */
const TAP_HOLD_STEPS = 7;
const JUMP_BUFFER_STEPS = 8;
const HINT_STEPS = Math.round(2.6 * STEP_HZ);
const MAX_SCORE = GAMES.icy.maxRaw - 1;

const TRAIL = 10;
const SNOW = 34;
const BANNER_POP = 12;

// ── look only ──
const STREAKS = 16;
const POPS = 8;
const PUFFS = 4;
/** Look-only test flag (?icyLookFloor=N): paint the tower as if the camera were at floor N. Gameplay is untouched. */
const LOOK_FLOOR = ((): number => {
  try {
    const v = Number(new URLSearchParams(window.location.search).get('icyLookFloor'));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
})();
/** Frame time (ms, moving average) above which snow and wind streaks are dropped, and below which they come back. */
const SLOW_FRAME_MS = 24;
const FAST_FRAME_MS = 19;
const HEAD_BOX = 2.6;
/** A round head token (face in a disc) is drawn this big (head radii), its bottom on the neck. */
const TOKEN_BOX = 2.4;
const STAR_COLORS = [PAL.yel, PAL.pink, PAL.white, PAL.cobL] as const;
/** Height of the standing hero sprite in world units (the collision body is physics.ts, untouched). */
const HERO_H = 76;
/** World units travelled per stride of the run cycle. */
const STRIDE = 70;
/** A ledge picture is drawn this thick (world units), its top edge on the walkable line. */
const LEDGE_H = 26;
/** Sticker finish of the picture sprites: ink outline (+ hard shadow under the ledges), CSS px. */
const LEDGE_FINISH: StickerFinish = { outline: 1.6, shadowX: 4, shadowY: 6, shadowAlpha: 0.42 };
const HERO_FINISH: StickerFinish = { outline: 1.5, shadowX: 0, shadowY: 0, shadowAlpha: 0 };
const SPRITE_MARGIN = 3;
/** Words that fly out of the hero on a big jump inside a combo (the owner's slang). */
const COMBO_WORDS = ['וואו!', 'אש!', 'נודר!'] as const;

// ───────────────────────────── Camera (pure, shared with the predictor) ─────────────────────────────

interface CamState {
  /** Altitude of the bottom edge of the view (the death line). */
  cam: number;
  camOn: boolean;
  /** Seconds since the floors started scrolling in this run. */
  camT: number;
}
const CAM_STARTED = 1;
const CAM_FASTER = 2;

function camSpeed(camT: number): number {
  return Math.min(CAM_MAX, CAM_V0 + CAM_ACC * camT);
}

function resetCam(c: CamState): void {
  c.cam = START_CAM;
  c.camOn = false;
  c.camT = 0;
}

/** One step of the camera. Returns CAM_STARTED / CAM_FASTER when that happened, else 0. */
function advanceCam(c: CamState, runFloor: number, runSteps: number, head: number, follow: number, dt: number): number {
  let r = 0;
  if (!c.camOn && (runFloor >= CAM_START_FLOOR || runSteps >= CAM_START_STEPS)) {
    c.camOn = true;
    c.camT = 0;
    r = CAM_STARTED;
  }
  if (c.camOn) {
    const before = Math.floor((c.camT * STEP_HZ) / CAM_SPEEDUP_EVERY);
    c.camT += dt;
    const after = Math.floor((c.camT * STEP_HZ) / CAM_SPEEDUP_EVERY);
    if (after > before) r = CAM_FASTER;
    c.cam += camSpeed(c.camT) * dt;
  }
  const limit = c.cam + follow;
  if (head > limit) c.cam += (head - limit) * Math.min(1, 10 * dt);
  return r;
}

/** The head left the bottom of the view. */
function fellOff(b: Body, cam: number): boolean {
  return b.py + 2 * R < cam - 8;
}
/**
 * The alpha of a few pixels of a picture, in ONE readback of a tiny copy: the picture itself is
 * never read back (no "multiple readback" console warnings, and it stays on the GPU for the frames).
 */
function alphaAt(src: HTMLCanvasElement, points: ReadonlyArray<readonly [number, number]>): number[] | null {
  const probe = document.createElement('canvas');
  probe.width = points.length;
  probe.height = 1;
  const g = probe.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  points.forEach(([x, y], i) => g.drawImage(src, x, y, 1, 1, i, 0, 1, 1));
  const d = g.getImageData(0, 0, points.length, 1).data;
  return points.map((_, i) => d[i * 4 + 3] ?? 0);
}

/** Is this picture fully opaque (sampled at its corners, edge middles and centre)? */
function isOpaque(c: HTMLCanvasElement): boolean {
  try {
    const w = c.width - 1;
    const h = c.height - 1;
    const points = ([[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5], [0.5, 0.5]] as const).map(
      ([u, v]) => [Math.round(u * w), Math.round(v * h)] as const,
    );
    const alpha = alphaAt(c, points);
    return alpha !== null && alpha.every((a) => a >= 250);
  } catch {
    return false;
  }
}
const DASH: number[] = [10, 8];
const NO_DASH: number[] = [];

const F_HINT_PX = 22;
/**
 * Announcements (zone names, milestones, combos, "נפלת!") are drawn in one lane at the top of the
 * play area, between the floor chip and the combo chip, never on the climb (the owner's rule,
 * 2026-11-12: "the announcements are hiding the game play"). Font px of the lane's first line.
 */
const LANE_PX = 28;
/** The lane's tallest drawing, CSS px (times `ui`). */
const LANE_MAX_H = 70;
/** A word on a big single jump shows in the combo chip for this long (seconds). */
const COMBO_WORD_S = 0.8;
/** Room kept for the combo chip at the right of the lane (CSS px). */
const COMBO_RESERVE = 60;
/** From this much sky beside the tower (CSS px), the lane moves off the tower into the sky. */
const SIDE_LANE_MIN = 150;

type Mode = 'run' | 'dead';

interface Banner {
  text: string;
  sub: string;
  color: string;
  age: number;
  life: number;
  /** A newer message replaces this one unless this one is more important and under half a second old. */
  prio: number;
}

interface Pop {
  active: boolean;
  sticker: Sticker | null;
  x: number;
  y: number;
  age: number;
  life: number;
  rise: number;
}

export const game: GameModule = {
  id: 'icy',
  async create(ctx: GameContext): Promise<GameInstance> {
    const [art] = await Promise.all([loadIcyArt(), loadDisplayFont()]);
    const view = createGameCanvas(ctx.root);
    const input = createInput(view.canvas);
    const fx = createFx(260);
    const level = buildLevel(ctx.seed);
    view.canvas.dataset.level = level.hash;
    // the stone tower theme goes with the tower pictures; with none of them the painted comic tower shows
    const stone = !art.wall.isPlaceholder || !art.bg.isPlaceholder || art.milestoneFloor !== null || art.zoneFloors.some((d) => d !== null);
    const looks = stone ? STONE_LOOKS : ZONE_LOOKS;
    const lookOf = (z: number): ZoneLook => zoneLook(z, looks);

    // ── layout (CSS px), recomputed on resize ──
    let top = 0;
    let bottom = 0;
    let playH = 1;
    let playW = 1;
    let offX = 0;
    let scale = 1;
    let visH = 1;
    /** Camera follow distance in world units (see CAM_FOLLOW_WORLD). */
    let follow = CAM_FOLLOW_WORLD;
    /** UI scale for short play areas (landscape phones). */
    let ui = 1;
    function layout(): void {
      top = ctx.hudHeight;
      bottom = Math.max(top + 200, view.height - ctx.safeBottom);
      playH = bottom - top;
      playW = Math.min(view.width, Math.max(260, playH * 0.72));
      offX = (view.width - playW) / 2;
      scale = playW / WORLD_W;
      visH = playH / scale;
      follow = Math.min(CAM_FOLLOW_WORLD, visH * CAM_FOLLOW_MAX_SHARE);
      ui = clamp(Math.min(playW / 360, playH / 560), 0.62, 1.1);
      invalidateLook();
    }

    // ── the sky outside the tower (landscape / desktop only): static CSS layers behind the
    // transparent canvas, hidden while the tower fills the screen (a phone in portrait) ──
    const skyA = document.createElement('div');
    const skyB = document.createElement('div');
    for (const el of [skyA, skyB]) el.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none';
    ctx.root.prepend(skyA, skyB);
    let skyZone = -1;
    let skyMix = -1;
    let skyOn = false;
    let shownZone = 0;
    // held-side markers: flat bars above the canvas, below the stage HUD, never catch touches
    const glowEls = [document.createElement('div'), document.createElement('div')] as const;
    glowEls[0].style.cssText = `position:absolute;left:0;top:0;bottom:0;width:9px;pointer-events:none;opacity:0;background:${PAL.yel};border-right:3px solid ${PAL.ink}`;
    glowEls[1].style.cssText = `position:absolute;right:0;top:0;bottom:0;width:9px;pointer-events:none;opacity:0;background:${PAL.pink};border-left:3px solid ${PAL.ink}`;
    ctx.root.append(glowEls[0], glowEls[1]);
    let glowShown = 0;

    // ── pre-rendered look (rebuilt on resize) ──
    const backTiles: Array<HTMLCanvasElement | null> = [null, null, null, null];
    const wallTiles: Array<HTMLCanvasElement | null> = [null, null, null, null, null, null, null, null];
    let hazard: HTMLCanvasElement | null = null;
    let hazardPattern: CanvasPattern | null = null;
    const stars = STAR_COLORS.map((c) => renderStar(26, c));
    const stickers = createStickerCache(24);
    const signs = new Map<number, { canvas: HTMLCanvasElement; w: number; h: number }>();
    /** Pre-rendered floors (ledge + outline + hard shadow), by floor index; the ones on screen. Drawn at (left - ox, top - oy). */
    const floorSprites = new Map<number, { canvas: HTMLCanvasElement; w: number; h: number; ox: number; oy: number }>();
    /** The hero's frames at the size they are drawn (ink outline included), made on first use. */
    const heroSprites = new Map<HeroFrame, HTMLCanvasElement>();
    const scratch = createScratch();
    /** The ledge pictures with their outline and shadow baked in at the drawn size (per layout): zones 0-3, then the every-10th-floor one. */
    const bakedLedges: Array<Baked | null> = [null, null, null, null, null];
    let bakedIcicles: BakedIcicles | null = null;
    /** Grey copies of the wall pictures (coloured per zone), made on first use. */
    let greyWall: HTMLCanvasElement | null = null;
    let greyBg: HTMLCanvasElement | null = null;
    /** Tile heights in world units: a picture's own shape, else the painted tile. */
    const wallTileW = art.wall.isPlaceholder ? WALL_TILE_W : (WALL_W * art.wall.height) / art.wall.width;
    const backTileW = art.bg.isPlaceholder ? BACK_TILE_W : (WORLD_W * art.bg.height) / art.bg.width;
    /** A back-wall picture with see-through parts needs the play area cleared under it every frame. */
    const bgClear = !art.bg.isPlaceholder && !isOpaque(art.bg.source);
    /** Altitude where each zone starts. */
    const zoneAlt = looks.map((_, z) => level.alt[z * ZONE_FLOORS] ?? 0);
    function zoneOfAlt(a: number): number {
      let z = 0;
      for (let i = 1; i < zoneAlt.length; i++) if (a >= (zoneAlt[i] ?? Infinity)) z = i;
      return z;
    }
    function invalidateLook(): void {
      for (let i = 0; i < backTiles.length; i++) {
        const t = backTiles[i];
        if (t) t.width = 0;
        backTiles[i] = null;
      }
      for (let i = 0; i < wallTiles.length; i++) {
        const t = wallTiles[i];
        if (t) t.width = 0;
        wallTiles[i] = null;
      }
      for (const sp of floorSprites.values()) sp.canvas.width = 0;
      floorSprites.clear();
      for (const c of heroSprites.values()) c.width = 0;
      heroSprites.clear();
      for (let i = 0; i < bakedLedges.length; i++) {
        const b = bakedLedges[i];
        if (b) b.canvas.width = 0;
        bakedLedges[i] = null;
      }
      if (bakedIcicles) for (const c of bakedIcicles.cells) c.canvas.width = 0;
      bakedIcicles = null;
    }
    function backTile(z: number): HTMLCanvasElement {
      const hit = backTiles[z];
      if (hit) return hit;
      const L = lookOf(z);
      let canvas: HTMLCanvasElement;
      if (!art.bg.isPlaceholder) {
        // a real bg.png: one picture per tile (a whole number of device pixels tall, so the
        // tiles meet without a line), coloured for the zone, the zone's windows on top
        const th = Math.max(1, Math.round(backTileW * scale * view.dpr)) / view.dpr;
        const l = makeLayer(playW, th, view.dpr);
        canvas = l.canvas;
        if (l.ctx) {
          let src = art.bg.source;
          if (L.backGrey) {
            greyBg ??= greyCopy(art.bg.source);
            src = greyBg;
          }
          paintPictureTile(l.ctx, src, playW, th, L.backTint ?? null);
          paintBackDeco(l.ctx, playW, th, scale, L);
        }
      } else {
        const th = BACK_TILE_W * scale;
        const l = makeLayer(playW, th, view.dpr);
        canvas = l.canvas;
        if (l.ctx) paintBackTile(l.ctx, playW, th, scale, z, L);
      }
      backTiles[z] = canvas;
      return canvas;
    }
    function wallTile(z: number, left: boolean): HTMLCanvasElement {
      const k = z * 2 + (left ? 0 : 1);
      const hit = wallTiles[k];
      if (hit) return hit;
      const L = lookOf(z);
      const ww = WALL_W * scale;
      const th = wallTileW * scale;
      const { canvas, ctx: g } = makeLayer(ww, th, view.dpr);
      if (g) {
        if (!art.wall.isPlaceholder) {
          // a real wall.png: the stone picture, coloured for the zone, mirrored on the right
          let src = art.wall.source;
          if (L.stone) {
            greyWall ??= greyCopy(art.wall.source);
            src = greyWall;
          }
          paintPictureTile(g, src, ww, th, L.stone ?? null, !left);
        } else paintWallTile(g, ww, th, scale, z, left, L);
      }
      wallTiles[k] = canvas;
      return canvas;
    }
    /** Box of a hero frame in CSS px (the standing figure is HERO_H world units tall). */
    function heroBox(): number {
      return (HERO_H / HERO_STAND) * scale;
    }
    function heroSprite(f: HeroFrame): HTMLCanvasElement | null {
      if (!art.hero) return null;
      const hit = heroSprites.get(f);
      if (hit) return hit;
      const box = heroBox();
      const src = art.hero[f].source;
      const l = makeLayer(box + 2 * SPRITE_MARGIN, box + 2 * SPRITE_MARGIN, view.dpr);
      if (l.ctx) {
        l.ctx.translate(SPRITE_MARGIN, SPRITE_MARGIN);
        stampSticker(l.ctx, scratch, box, box, view.dpr, HERO_FINISH, (c) => {
          c.imageSmoothingQuality = 'high';
          c.drawImage(src, 0, 0, box, box);
        });
      }
      heroSprites.set(f, l.canvas);
      return l.canvas;
    }
    /** The ledge picture of floor `j` (its zone's, or the every-10th-floor one), or null when it is not dropped in. */
    function floorPicture(j: number): { pic: Drawable; sl: FloorSlice; slot: number } | null {
      if (isMilestone(j)) return art.milestoneFloor ? { pic: art.milestoneFloor, sl: MILESTONE_FLOOR_SLICE, slot: 4 } : null;
      const z = zoneOfFloor(j + LOOK_FLOOR);
      const pic = art.zoneFloors[z];
      const sl = ZONE_FLOOR_SLICES[z];
      return pic && sl ? { pic, sl, slot: z } : null;
    }
    /** A ledge picture with its finish baked in at the drawn size (made once per layout). */
    function bakedLedge(fp: { pic: Drawable; sl: FloorSlice; slot: number }): Baked {
      const hit = bakedLedges[fp.slot];
      if (hit) return hit;
      const b = bakeFinish(fp.pic.source, fp.sl.w, fp.sl.h, (LEDGE_H * scale) / fp.sl.h, view.dpr, LEDGE_FINISH, scratch);
      bakedLedges[fp.slot] = b;
      return b;
    }
    function bakedIcicleCells(): BakedIcicles | null {
      if (!art.icicles) return null;
      bakedIcicles ??= bakeIcicles(art.icicles, LEDGE_H * scale * 0.5, view.dpr, LEDGE_FINISH.outline * 0.8, scratch);
      return bakedIcicles;
    }
    function hazardFill(g: CanvasRenderingContext2D): CanvasPattern | string {
      if (!hazard) {
        const l = makeLayer(48, 24, 1);
        if (l.ctx) paintHazard(l.ctx, 48, 24);
        hazard = l.canvas;
        hazardPattern = null;
      }
      hazardPattern ??= g.createPattern(hazard, 'repeat-x');
      return hazardPattern ?? PAL.red;
    }
    function floorSign(n: number): { canvas: HTMLCanvasElement; w: number; h: number } {
      const hit = signs.get(n);
      if (hit) return hit;
      if (signs.size >= 6) {
        const oldest = signs.keys().next().value;
        if (oldest !== undefined) {
          const o = signs.get(oldest);
          if (o) o.canvas.width = 0;
          signs.delete(oldest);
        }
      }
      const s = renderFloorSign(n, 15);
      signs.set(n, s);
      return s;
    }

    layout();
    const offResize = view.onResize(layout);
    // made now rather than on the first frame that needs them (a zone change, the first jump)
    if (stone) {
      if (!art.wall.isPlaceholder && looks.some((L) => L.stone)) greyWall = greyCopy(art.wall.source);
      if (!art.bg.isPlaceholder && looks.some((L) => L.backGrey)) greyBg = greyCopy(art.bg.source);
    }
    if (art.hero) for (const f of ['stand', 'run1', 'run2', 'jump', 'fall', 'ball'] as const) heroSprite(f);
    art.zoneFloors.forEach((pic, z) => {
      const sl = ZONE_FLOOR_SLICES[z];
      if (pic && sl) bakedLedge({ pic, sl, slot: z });
    });
    if (art.milestoneFloor) bakedLedge({ pic: art.milestoneFloor, sl: MILESTONE_FLOOR_SLICE, slot: 4 });
    bakedIcicleCells();

    // ── input: which half is held. Several fingers: the last one pressed wins. ──
    const sides = new Map<number, number>(); // insertion order = press order
    let tapDir = 0;
    let tapSteps = 0;
    let jumpBuffer = 0;
    function sideOf(p: KitPointer): number {
      return p.x < view.width / 2 ? -1 : 1;
    }
    /** Side of the most recently pressed finger that is still down (0 = none). */
    function fingerDir(): number {
      let d = 0;
      for (const v of sides.values()) d = v;
      return d;
    }
    /** The side pushed now: a fresh tap (always the newest touch), else the newest held finger. */
    function heldDir(): number {
      return tapSteps > 0 ? tapDir : fingerDir();
    }
    const offDown = input.onDown((p) => {
      const s = sideOf(p);
      sides.delete(p.id);
      sides.set(p.id, s);
      tapDir = s;
      tapSteps = TAP_HOLD_STEPS;
      jumpBuffer = JUMP_BUFFER_STEPS;
    });
    const offMove = input.onMove((p) => {
      if (sides.has(p.id)) sides.set(p.id, sideOf(p));
    });
    const offUp = input.onUp((p) => {
      sides.delete(p.id);
      // a cancelled touch (freeze, notification, system gesture) leaves nothing pushed
      if (p.cancelled) {
        tapSteps = 0;
        jumpBuffer = 0;
      }
    });

    // ── state ──
    let mode: Mode = 'run';
    const body: Body = createBody();
    const ev = createEvents();
    let prevX = body.x;
    let prevPy = body.py;
    let runFloor = 0;
    let runBonus = 0;
    let best = 0;
    let bestFloor = 0;
    let bestBefore = 0; // best of the previous runs
    let recordShown = false;
    let runs = 0;
    let runSteps = 0;
    let shownScore = -1;
    let comboJumps = 0;
    let comboFloors = 0;
    let comboBonus = 0;
    let comboTimer = 0;
    let comboPop = 0;
    /** The word a big single jump earned, shown in the combo chip while comboWordT > 0 (looks only). */
    let comboWord = '';
    let comboWordT = 0;
    let superAir = false;
    let rot = 0;
    let squash = 0;
    let squashV = 0;
    const cam: CamState = { cam: START_CAM, camOn: false, camT: 0 };
    let prevCam = cam.cam;
    let deadSteps = 0;
    let deathCam = 0;
    let deathX = 0;
    let popY = 0;
    let popV = 0;
    let prevPopY = 0;
    let hintSteps = 0;
    let lastTenShown = false;
    let lowFloor = 0;
    let steps = 0;
    let destroyed = false;
    let traceLeft = 0;
    const traced: number[][] = [];

    const trailX = new Float64Array(TRAIL);
    const trailA = new Float64Array(TRAIL);
    const trailR = new Float64Array(TRAIL);
    let trailHead = 0;
    let trailLen = 0;

    // ambient snow (cosmetic: Math.random is fine), screen space
    const snowX = new Float64Array(SNOW);
    const snowY = new Float64Array(SNOW);
    const snowV = new Float64Array(SNOW);
    const snowR = new Float64Array(SNOW);
    const snowP = new Float64Array(SNOW);
    for (let i = 0; i < SNOW; i++) {
      snowX[i] = Math.random();
      snowY[i] = Math.random();
      snowV[i] = 0.04 + Math.random() * 0.07;
      snowR[i] = 1 + Math.random() * 2.2;
      snowP[i] = Math.random() * 6.28;
    }

    // ── look-only state (advanced in update so a freeze stands still; never read by the logic) ──
    let runPhase = 0;
    /** Where the hero was last drawn (test hook only). */
    let heroAtX = 0;
    let heroAtY = 0;
    let heroAtFrame = '';
    /** World units run on a floor (drives the hero's stride frames). */
    let runDist = 0;
    let facing = 1;
    let lowQuality = false;
    let frameEma = 16.7;
    let lastFrameAt = 0;
    let slowSteps = 0;
    let zoneShown = 0;
    const streakX = new Float64Array(STREAKS);
    const streakY = new Float64Array(STREAKS);
    const streakL = new Float64Array(STREAKS);
    const streakV = new Float64Array(STREAKS);
    let streakOn = 0;
    const pops: Pop[] = Array.from({ length: POPS }, () => ({ active: false, sticker: null, x: 0, y: 0, age: 0, life: 1, rise: 60 }));
    let popCursor = 0;
    const puffX = new Float64Array(PUFFS);
    const puffA = new Float64Array(PUFFS);
    const puffAge = new Float64Array(PUFFS).fill(1);
    const puffK = new Float64Array(PUFFS);
    let puffCursor = 0;

    const banner: Banner = { text: '', sub: '', color: PAL.yel, age: 0, life: 0, prio: 0 };
    /** One message in the top lane at a time (see LANE_PX). */
    function showBanner(text: string, sub: string, color: string, seconds = 1.4, prio = 1): void {
      if (banner.life > 0 && prio < banner.prio && banner.age < STEP_HZ / 2) return;
      banner.text = text;
      banner.sub = sub;
      banner.color = color;
      banner.age = 0;
      banner.life = Math.round(seconds * STEP_HZ);
      banner.prio = prio;
    }

    /** A small "+points" that trails behind the hero, at world px (x, y) (look only). */
    function addPop(x: number, y: number, text: string, color: string, px: number): void {
      const p = pops[popCursor];
      popCursor = (popCursor + 1) % POPS;
      if (!p) return;
      p.active = true;
      p.sticker = stickers.get(`p|${text}|${color}|${px}`, (old) => renderSticker(text, { size: px, fill: color }, old));
      p.x = x;
      p.y = y;
      p.age = 0;
      p.life = 0.6;
      p.rise = 34;
    }

    function addPuff(x: number, a: number, k: number): void {
      puffX[puffCursor] = x;
      puffA[puffCursor] = a;
      puffAge[puffCursor] = 0;
      puffK[puffCursor] = k;
      puffCursor = (puffCursor + 1) % PUFFS;
    }

    // ── world <-> screen ──
    const wx = (v: number): number => offX + v * scale;
    // fx live in "world px": x on screen, y = -altitude * scale (translated by the camera when drawn)
    const fy = (a: number): number => -a * scale;

    function runScore(): number {
      return runFloor * FLOOR_POINTS + runBonus;
    }

    function publish(): void {
      const s = Math.min(MAX_SCORE, Math.max(best, runScore()));
      // test hook: runs | floor of this run | combo bonus of this run | best run | score
      view.canvas.dataset.icy = `${runs}|${runFloor}|${runBonus}|${best}|${s}`;
      if (s === shownScore) return;
      shownScore = s;
      ctx.setScore(s);
    }

    function endCombo(): void {
      if (comboJumps >= 2) {
        const mega = comboFloors >= 20;
        // the bigger the combo, the bigger the word (the owner's slang; looks only)
        const word = comboFloors >= 25 ? 'מחורחר!' : comboFloors >= 15 ? 'בן פורת יוסף!' : comboFloors >= 8 ? 'אש!' : 'וואו!';
        // the points are an LTR isolate, so the plus stays in front of the number in the Hebrew line
        showBanner(word, `${comboFloors} קומות · \u2066+${comboBonus}\u2069`, mega ? PAL.yel : PAL.pink, 1.6, mega ? 2 : 1);
        if (mega) {
          fx.confetti({ count: 70, width: view.width, colors: [PAL.yel, PAL.red, PAL.pink, PAL.cobL, PAL.white] });
          sfx.cheer();
        } else sfx.success();
        haptic.success();
      }
      comboJumps = 0;
      comboFloors = 0;
      comboBonus = 0;
      comboTimer = 0;
    }

    /** Effects of a take-off (the physics already happened in stepBody). */
    function onJump(power: number): void {
      superAir = body.vy >= SUPER_JUMP_VY;
      squash = -0.28 - (superAir ? 0.12 : 0);
      squashV = 0;
      sfx.jump(0.85 + power / 1600);
      fx.burst(wx(body.x), fy(body.py), {
        count: superAir ? 14 : 6,
        colors: [PAL.white, PAL.paper, PAL.yel],
        speed: superAir ? 300 : 170,
        size: 3.5,
        life: 0.45,
        gravity: 500,
        angle: Math.PI / 2,
        spread: Math.PI * 0.9,
      });
      if (superAir) haptic.tap();
    }

    /** Effects and score of a landing on floor `j`, `delta` floors above the take-off. */
    function onLand(j: number, delta: number, impact: number): void {
      if (superAir) rot = Math.atan2(Math.sin(rot), Math.cos(rot));
      superAir = false;
      squash = Math.min(0.42, 0.12 + impact / 4200);
      squashV = 0;
      const sx = wx(body.x);
      const sy = fy(level.alt[j] ?? 0);
      addPuff(body.x, level.alt[j] ?? 0, Math.min(1.6, 0.6 + impact / 1800));
      if (delta >= 2) {
        comboJumps++;
        comboFloors += delta;
        const bonus = delta * Math.min(comboJumps, COMBO_MULT_CAP) * COMBO_POINTS;
        comboBonus += bonus;
        runBonus += bonus;
        comboTimer = COMBO_WINDOW;
        comboPop = 1;
        // the points trail behind the hero (where he came from), never on the floors ahead
        const back = body.vx > 30 ? -1 : body.vx < -30 ? 1 : 0;
        const popX = clamp(sx + back * 46 * scale, wx(INNER_L) + 24, wx(INNER_R) - 24);
        addPop(popX, sy - (back === 0 ? 70 : 34) * scale, `+${bonus}`, PAL.yel, 15 + Math.min(5, comboJumps));
        // a word on a big single jump: in the combo chip, not on the climb
        if (delta >= 4) {
          comboWord = COMBO_WORDS[comboJumps % COMBO_WORDS.length] ?? 'וואו!';
          comboWordT = COMBO_WORD_S;
        }
        fx.burst(sx, sy, { count: 10 + Math.min(14, comboJumps * 2), shape: 'star', colors: [PAL.yel, PAL.red, PAL.white, PAL.pink], speed: 320, size: 6, life: 0.6 });
        sfx.coin(1 + Math.min(10, comboJumps) * 0.07);
        haptic.tap();
      } else {
        if (comboJumps > 0) endCombo();
        fx.burst(sx, sy, {
          count: 5,
          colors: [PAL.white, PAL.paper],
          speed: 140,
          size: 3,
          life: 0.35,
          gravity: 400,
          angle: -Math.PI / 2,
          spread: Math.PI * 0.9,
        });
      }
      if (j > runFloor) {
        const before = Math.floor(runFloor / 10);
        runFloor = j;
        if (Math.floor(j / 10) > before && j >= 10) {
          const m = Math.floor(j / 10) * 10;
          showBanner(`קומה ${m}!`, m % 50 === 0 ? 'אגדה של קרח 🧊' : '', PAL.yel, 1.3, 2);
          const ma = level.alt[m] ?? body.py;
          fx.confetti({ x: view.width / 2, y: fy(ma), colors: [PAL.yel, PAL.red, PAL.pink, PAL.cobL, PAL.white] });
          sfx.success();
          haptic.success();
        }
      }
      if (!recordShown && runs > 0 && bestBefore > 0 && runScore() > bestBefore) {
        recordShown = true;
        showBanner('שיא חדש!', 'נודר, הריצה הכי טובה שלך', '#3ddc84', 1.3, 3);
        sfx.success();
      }
      publish();
    }

    function die(): void {
      if (comboJumps > 0) endCombo();
      const score = runScore();
      if (score > best) best = score;
      bestFloor = Math.max(bestFloor, runFloor);
      runs++;
      mode = 'dead';
      deadSteps = 0;
      deathCam = cam.cam;
      deathX = body.x;
      popY = -30;
      prevPopY = popY;
      popV = 1250;
      showBanner('נפלת!', `קומה ${runFloor} · שיא ${bestFloor}`, PAL.red, 1.1, 3);
      fx.shake(12, 380);
      sfx.fall();
      haptic.fail();
      publish();
    }

    function restart(): void {
      mode = 'run';
      copyBody(createBody(), body);
      prevX = body.x;
      prevPy = body.py;
      runFloor = 0;
      runBonus = 0;
      bestBefore = best;
      recordShown = false;
      runSteps = 0;
      superAir = false;
      rot = 0;
      squash = 0.3;
      squashV = 0;
      resetCam(cam);
      prevCam = cam.cam;
      lowFloor = 0;
      trailLen = 0;
      fx.burst(wx(body.x), fy(body.py + R), { count: 18, shape: 'star', colors: [PAL.yel, PAL.red, PAL.white, PAL.pink], speed: 260, life: 0.5 });
      sfx.pop(1.2);
    }

    function updateSnow(dt: number): void {
      for (let i = 0; i < SNOW; i++) {
        let y = (snowY[i] ?? 0) + (snowV[i] ?? 0) * dt;
        if (y > 1.02) y -= 1.04;
        snowY[i] = y;
        snowP[i] = (snowP[i] ?? 0) + dt * 1.3;
      }
    }

    function updateCamera(dt: number): void {
      const r = advanceCam(cam, runFloor, runSteps, body.py + 2 * R, follow, dt);
      if (r === CAM_STARTED) sfx.whoosh(0.8);
      else if (r === CAM_FASTER) {
        showBanner('מהר יותר!', '', PAL.cobL, 1.1);
        sfx.whoosh(1.3);
      }
    }

    function stepRun(dt: number): void {
      runSteps++;
      const dir = heldDir();
      if (tapSteps > 0) tapSteps--;
      const held = dir !== 0;

      stepBody(body, dir, held, held || jumpBuffer > 0, level, dt, ev);
      if (traceLeft > 0) {
        traceLeft--;
        traced.push([steps, dir, body.x, body.py, body.vx, body.vy, body.grounded, cam.cam]);
      }
      if (ev.jumped) jumpBuffer = 0;
      else if (jumpBuffer > 0) jumpBuffer--;

      // a take-off from the ground (a landing + jump comes after the landing below)
      if (ev.jumped && ev.landed < 0) onJump(ev.jumpPower);

      if (ev.wall !== 0) {
        if (ev.wallKick) {
          const sx = wx(ev.wall < 0 ? INNER_L : INNER_R);
          fx.burst(sx, fy(body.py + R), {
            count: 8,
            colors: [PAL.white, PAL.yel],
            speed: 240,
            size: 3.5,
            life: 0.35,
            angle: ev.wall < 0 ? 0 : Math.PI,
            spread: 1.4,
          });
          sfx.tap(0.7 + ev.wallSpeed / 1400);
          if (ev.wallSpeed > 600) {
            fx.shake(4, 140);
            haptic.bump();
          }
        }
        squash = 0.18;
      }

      if (ev.landed >= 0) {
        onLand(ev.landed, ev.landedDelta, ev.impact);
        if (ev.jumped) onJump(ev.jumpPower);
        else sfx.land(1 + Math.min(0.6, ev.impact / 3000));
      }

      // combo clock
      if (comboJumps > 0) {
        comboTimer--;
        if (comboTimer <= 0) endCombo();
      }

      // looks
      if (superAir && body.grounded < 0) rot += Math.sign(body.vx || 1) * 13 * dt;
      else rot *= 0.78;
      if ((comboJumps > 0 || superAir) && steps % 2 === 0) {
        trailX[trailHead] = body.x;
        trailA[trailHead] = body.py;
        trailR[trailHead] = rot;
        trailHead = (trailHead + 1) % TRAIL;
        if (trailLen < TRAIL) trailLen++;
      } else if (trailLen > 0 && steps % 3 === 0) trailLen--;

      updateCamera(dt);
      if (fellOff(body, cam.cam)) die();
    }

    function stepDead(dt: number): void {
      deadSteps++;
      prevPopY = popY;
      popV -= 2600 * dt;
      popY += popV * dt;
      if (deadSteps >= DEAD_SWOOSH_AT) {
        const t = (deadSteps - DEAD_SWOOSH_AT) / (DEAD_STEPS - DEAD_SWOOSH_AT);
        cam.cam = lerp(deathCam, START_CAM, ease.inOutCubic(Math.min(1, t)));
      }
      if (deadSteps >= DEAD_STEPS) restart();
    }

    /** Look-only bookkeeping, one fixed step (reads the game state, never writes it). */
    function updateLooks(dt: number): void {
      // the quality flag follows the measured frame time (it changes only here, so a frozen frame never changes)
      if (frameEma > SLOW_FRAME_MS) slowSteps = Math.min(120, slowSteps + 1);
      else if (frameEma < FAST_FRAME_MS) slowSteps = Math.max(-120, slowSteps - 1);
      if (!lowQuality && slowSteps >= 90) lowQuality = true;
      else if (lowQuality && slowSteps <= -90) lowQuality = false;
      if (mode === 'run') {
        if (Math.abs(body.vx) > 30) facing = body.vx < 0 ? -1 : 1;
        if (body.grounded >= 0) {
          runPhase += (Math.abs(body.vx) * dt) / 15;
          runDist += Math.abs(body.vx) * dt;
        } else runPhase += dt * 9;
      }
      // the zone's name in the lane when the player first climbs into a new zone this round
      // (a milestone reached on the same landing, "קומה 50!", becomes its second line)
      const z = zoneOfFloor(runFloor);
      if (mode === 'run' && z > zoneShown) {
        zoneShown = z;
        const L = lookOf(z);
        const same = banner.life > 0 && banner.age <= 1 && banner.text.startsWith('קומה ') ? banner.text : '';
        showBanner(L.name, same, z === 3 ? PAL.yel : PAL.white, 1.6, 2);
        fx.confetti({ count: 40, width: view.width, colors: [L.wall, L.wallHi, PAL.yel, PAL.white] });
      }
      if (comboWordT > 0) comboWordT = Math.max(0, comboWordT - dt);
      for (const p of pops) {
        if (!p.active) continue;
        p.age += dt;
        if (p.age >= p.life) p.active = false;
      }
      for (let i = 0; i < PUFFS; i++) if ((puffAge[i] ?? 1) < 1) puffAge[i] = (puffAge[i] ?? 0) + dt * 3.2;
      // wind streaks while climbing fast (screen space, cosmetic randomness)
      const fast = mode === 'run' && !lowQuality && (body.vy > 950 || (cam.camOn && camSpeed(cam.camT) > 230 && body.grounded < 0));
      for (let i = 0; i < STREAKS; i++) {
        const l = streakL[i] ?? 0;
        if (l > 0) {
          const y = (streakY[i] ?? 0) + (streakV[i] ?? 0) * dt;
          streakY[i] = y;
          if (y - l > view.height) {
            streakL[i] = 0;
            streakOn--;
          }
        } else if (fast && streakOn < STREAKS && Math.random() < 0.18) {
          streakX[i] = 0.06 + Math.random() * 0.88;
          streakY[i] = top - 40;
          streakL[i] = 40 + Math.random() * 90;
          streakV[i] = 1100 + Math.random() * 900;
          streakOn++;
        }
      }
    }

    const loop = createLoop({
      update(dt: number): void {
        steps++;
        prevX = body.x;
        prevPy = body.py;
        prevCam = cam.cam;
        if (mode === 'run') stepRun(dt);
        else stepDead(dt);
        // spring for squash and stretch
        squashV += (-280 * squash - 16 * squashV) * dt;
        squash += squashV * dt;
        if (comboPop > 0) comboPop = Math.max(0, comboPop - dt * 4);
        if (banner.life > 0) {
          banner.age++;
          if (banner.age >= banner.life) banner.life = 0;
        }
        if (hintSteps < HINT_STEPS) hintSteps++;
        if (!lastTenShown && ctx.timeLeftMs() <= 10_000 && ctx.timeLeftMs() > 0 && steps > 60) {
          lastTenShown = true;
          showBanner('10 שניות אחרונות!', 'עוד קפיצה אחת גדולה', PAL.org, 1.5, 3);
          sfx.beep();
        }
        updateSnow(dt);
        fx.update(dt);
        updateLooks(dt);
      },
      render(alpha: number): void {
        draw(alpha);
      },
    });

    // ───────────────────────────── drawing ─────────────────────────────

    /** Camera altitude used for the look (the test flag shifts the look only). */
    function lookAlt(c: number): number {
      return LOOK_FLOOR > 0 ? c + (level.alt[LOOK_FLOOR] ?? 0) : c;
    }

    /**
     * The inner back wall: the zone's pre-rendered tile blitted 1:1 in device pixels down the
     * shaft (parallax at half the floor speed); the next zone fades in near its first floor.
     * The tiles are opaque, so they also replace the per-frame clear of the play area.
     */
    function drawBackground(c: number): void {
      const g = view.ctx;
      const la = lookAlt(c);
      const mid = la + visH * 0.5;
      const z = zoneOfAlt(mid);
      const nextAt = zoneAlt[z + 1];
      const mix = nextAt === undefined ? 0 : Math.round(clamp((mid - (nextAt - 260)) / 260, 0, 1) * 20) / 20;
      // outside the tower (landscape / desktop): CSS sky behind the cleared side strips
      const outside = offX > 0.5;
      if (outside !== skyOn) {
        skyOn = outside;
        skyA.style.display = outside ? 'block' : 'none';
        skyB.style.display = outside ? 'block' : 'none';
      }
      if (outside) {
        if (z !== skyZone) {
          skyZone = z;
          skyA.style.background = lookOf(z).sky;
          skyB.style.background = lookOf(z + 1).sky;
        }
        if (mix !== skyMix) {
          skyMix = mix;
          skyB.style.opacity = String(mix);
        }
        g.clearRect(0, 0, offX + 1, view.height);
        g.clearRect(offX + playW - 1, 0, offX + 2, view.height);
      }
      shownZone = z;
      const d = view.dpr;
      const tile = backTile(z);
      const th = tile.height;
      let off = (la * scale * 0.5 * d) % th;
      if (off < 0) off += th;
      const ox = Math.round(offX * d);
      const hd = view.height * d;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (bgClear) g.clearRect(ox, 0, tile.width, hd);
      for (let y = Math.round(off) - th; y < hd; y += th) g.drawImage(tile, ox, y);
      if (mix > 0) {
        const next = backTile(Math.min(looks.length - 1, z + 1));
        g.globalAlpha = mix;
        for (let y = Math.round(off) - th; y < hd; y += th) g.drawImage(next, ox, y);
        g.globalAlpha = 1;
      }
      g.restore();
    }

    function drawWalls(c: number): void {
      const g = view.ctx;
      const ww = WALL_W * scale;
      const la = lookAlt(c);
      // hard shadows the walls cast on the back wall
      g.fillStyle = 'rgba(22, 18, 14, 0.38)';
      g.fillRect(offX + ww, 0, Math.max(4, 7 * scale), view.height);
      g.fillRect(offX + playW - ww - Math.max(2, 3 * scale), 0, Math.max(2, 3 * scale), view.height);
      // rows in world altitude, each in the zone of its altitude (pre-rendered tiles: the stone picture or the painted blocks)
      const tw = wallTileW;
      const minA = la - (view.height - bottom) / scale - tw;
      const maxA = la + bottom / scale + tw;
      const th = tw * scale;
      for (let k = Math.floor(minA / tw); k * tw < maxA; k++) {
        const a = k * tw;
        const z = zoneOfAlt(a);
        const yTop = bottom - (a + tw - la) * scale;
        g.drawImage(wallTile(z, true), offX, yTop, ww, th + 0.5);
        g.drawImage(wallTile(z, false), offX + playW - ww, yTop, ww, th + 0.5);
      }
      // the bounce faces
      g.fillStyle = PAL.ink;
      g.fillRect(offX + ww - 1.5, 0, 3, view.height);
      g.fillRect(offX + playW - ww - 1.5, 0, 3, view.height);
      // outside the tower (landscape / desktop)
      if (offX > 0.5) {
        g.fillStyle = 'rgba(8, 4, 30, 0.35)';
        g.fillRect(0, 0, offX, view.height);
        g.fillRect(offX + playW, 0, offX + 1, view.height);
      }
    }

    function drawGround(c: number): void {
      const g = view.ctx;
      const gy = bottom - (0 - c) * scale;
      if (gy > view.height + 10) return;
      const ww = WALL_W * scale;
      const h = FLOOR_H * scale;
      if (floorPicture(0)) {
        // stone foundation under the ground ledge (the first zone's ledge picture, full width)
        const L = lookOf(0);
        g.fillStyle = L.backLo;
        g.fillRect(offX + ww, gy + h * 0.5, playW - 2 * ww, view.height - gy + 2);
        g.fillStyle = 'rgba(22, 18, 14, 0.5)';
        const bw0 = 60 * scale;
        for (let r = 0; r < 4; r++) {
          const y = gy + LEDGE_H * scale + r * 34 * scale;
          g.fillRect(offX + ww, y + 34 * scale - 2, playW - 2 * ww, 2);
          for (let x = offX + ww + (r % 2) * bw0 * 0.5; x < offX + playW - ww; x += bw0) g.fillRect(x, y, 2, 34 * scale);
        }
        drawFloor(0, gy);
        return;
      }
      // foundation: cobalt block slab with a paper top
      g.fillStyle = PAL.cobD;
      g.fillRect(offX + ww, gy, playW - 2 * ww, view.height - gy + 2);
      g.fillStyle = PAL.paper;
      g.fillRect(offX + ww, gy, playW - 2 * ww, h * 0.55);
      g.fillStyle = PAL.ink;
      g.fillRect(offX + ww, gy - 1.5, playW - 2 * ww, 3);
      g.fillRect(offX + ww, gy + h * 0.55, playW - 2 * ww, 2.5);
      g.fillStyle = 'rgba(22, 18, 14, 0.5)';
      const bw = 60 * scale;
      for (let r = 0; r < 4; r++) {
        const y = gy + h * 0.55 + r * 34 * scale;
        g.fillRect(offX + ww, y + 34 * scale - 2, playW - 2 * ww, 2);
        for (let x = offX + ww + (r % 2) * bw * 0.5; x < offX + playW - ww; x += bw) g.fillRect(x, y, 2, 34 * scale);
      }
    }

    /** One floor, from its pre-rendered sprite (rendered the first time it shows up). */
    function drawFloor(j: number, sy: number): void {
      const g = view.ctx;
      const half = level.half[j] ?? 0;
      const left = wx((level.x[j] ?? 0) - half);
      let sp = floorSprites.get(j);
      if (!sp) {
        if (floorSprites.size >= 32) {
          const oldest = floorSprites.keys().next().value;
          if (oldest !== undefined) {
            const o = floorSprites.get(oldest);
            if (o) o.canvas.width = 0;
            floorSprites.delete(oldest);
          }
        }
        const w = half * 2 * scale;
        const fp = floorPicture(j);
        if (fp) {
          // a ledge picture: caps + repeating middle at this floor's exact width, icicles under
          // the stone and ice ledges, then the ink outline and the hard shadow from its silhouette
          // (outline and shadow come baked into the picture: this is a few blits)
          const hb = LEDGE_H * scale;
          const zone = zoneOfFloor(j + LOOK_FLOOR);
          const ic = j > 0 && !isMilestone(j) && zone <= 1 ? bakedIcicleCells() : null;
          const hang = ic ? hb * (zone === 0 ? 0.66 : 0.42) + 2 : 0;
          const bk = bakedLedge(fp);
          const k = hb / fp.sl.h;
          const mL = Math.ceil(bk.padL * k);
          const mT = Math.ceil(bk.padT * k);
          const sw = w + mL + Math.ceil(bk.padR * k);
          const sh = hb + mT + Math.max(Math.ceil(bk.padB * k), hang);
          const l = makeLayer(sw, sh, view.dpr);
          if (l.ctx) {
            l.ctx.translate(mL, mT);
            if (ic) drawIcicles(l.ctx, ic, w, hb, j, zone === 0 ? 0.62 : 0.3, zone === 0 ? 0.6 : 0.38);
            drawSlicedLedge(l.ctx, bk, fp.sl, w, hb, j, view.dpr);
          }
          sp = { canvas: l.canvas, w: sw, h: sh, ox: mL, oy: mT };
        } else {
          const h = FLOOR_H * scale * 1.35;
          const l = makeLayer(w + 10, h + 12, view.dpr);
          if (l.ctx) {
            l.ctx.translate(2, 2);
            paintFloor(l.ctx, j, 0, 0);
          }
          sp = { canvas: l.canvas, w: w + 10, h: h + 12, ox: 2, oy: 2 };
        }
        floorSprites.set(j, sp);
      }
      g.drawImage(sp.canvas, left - sp.ox, sy - sp.oy, sp.w, sp.h);
      if (isMilestone(j)) {
        const s = floorSign(j);
        g.drawImage(s.canvas, offX + WALL_W * scale + 10, sy - s.h - 10 * scale, s.w, s.h);
      }
    }

    /** Paint floor `j` with its top-left at (left, sy) into `g` (once per floor, into its sprite). */
    function paintFloor(g: CanvasRenderingContext2D, j: number, left: number, sy: number): void {
      const milestone = isMilestone(j);
      const half = level.half[j] ?? 0;
      const w = half * 2 * scale;
      // drawn a bit thicker than FLOOR_H (looks only: the walkable line is the top edge)
      const h = FLOOR_H * scale * 1.35;
      const tile = milestone ? art.milestone : art.platform;
      const r = Math.min(h * 0.4, 6);
      // hard shadow on the back wall
      g.fillStyle = 'rgba(22, 18, 14, 0.42)';
      g.fillRect(left + 4, sy + 6, w, h);
      if (!tile.isPlaceholder) {
        g.save();
        roundRectPath(g, left, sy, w, h, r);
        g.clip();
        const tw = (h * tile.width) / tile.height;
        const phase = (j * 37) % 64;
        for (let tx = left - (phase / 64) * tw; tx < left + w; tx += tw) tile.draw(g, tx + tw / 2, sy + h / 2, tw, h);
        g.restore();
      } else {
        const L = lookOf(zoneOfFloor(j + LOOK_FLOOR));
        // front face, then the walkable top surface
        g.fillStyle = milestone ? PAL.red : L.face;
        roundRectPath(g, left, sy, w, h, r);
        g.fill();
        g.fillStyle = milestone ? PAL.redD : 'rgba(22, 18, 14, 0.22)';
        g.fillRect(left + 1.5, sy + h * 0.74, w - 3, h * 0.26 - 1.5);
        g.fillStyle = milestone ? PAL.yel : PAL.paper;
        g.fillRect(left + 1.5, sy + 1.5, w - 3, h * 0.42);
        // ice shine on the face
        g.fillStyle = 'rgba(255, 255, 255, 0.7)';
        const n = Math.max(1, Math.floor(w / (70 * scale)));
        for (let k = 0; k < n; k++) {
          const ix = left + ((k + 0.3) / n) * w + ((j * 13 + k * 7) % 9) * scale;
          g.fillRect(ix, sy + h * 0.6, 10 * scale, 2.2);
        }
      }
      g.lineWidth = 2.5;
      g.strokeStyle = PAL.ink;
      roundRectPath(g, left, sy, w, h, r);
      g.stroke();
      g.fillStyle = PAL.ink;
      g.fillRect(left + 2, sy + h * 0.44, w - 4, 1.5);
    }

    function drawBestLine(c: number): void {
      if (runs === 0 || bestFloor <= 0 || mode === 'dead') return;
      const a = level.alt[bestFloor] ?? 0;
      const sy = bottom - (a - c) * scale - 6;
      if (sy < top - 10 || sy > view.height + 10) return;
      const g = view.ctx;
      g.strokeStyle = PAL.ink;
      g.lineWidth = 5;
      g.setLineDash(DASH);
      g.beginPath();
      g.moveTo(offX + WALL_W * scale, sy);
      g.lineTo(offX + playW - WALL_W * scale, sy);
      g.stroke();
      g.strokeStyle = '#3ddc84';
      g.lineWidth = 3;
      g.stroke();
      g.setLineDash(NO_DASH);
      const chip = stickers.get('best', (old) => renderChip('שיא', 15, '#3ddc84', PAL.ink, old));
      g.drawImage(chip.canvas, offX + WALL_W * scale + 6, sy - chip.h / 2, chip.w, chip.h);
    }

    /** Is this head picture a round token (opaque at the middle of its left edge, see-through in the corner)? Cached. */
    const tokenOf = new Map<Drawable, boolean>();
    function isToken(d: Drawable): boolean {
      const hit = tokenOf.get(d);
      if (hit !== undefined) return hit;
      let round = false;
      try {
        const w = d.source.width;
        const h = d.source.height;
        const alpha = alphaAt(d.source, [
          [Math.round(w * 0.025), Math.round(h * 0.5)],
          [Math.round(w * 0.04), Math.round(h * 0.04)],
        ]);
        if (alpha !== null) round = (alpha[0] ?? 0) > 180 && (alpha[1] ?? 255) < 40;
      } catch {
        round = false;
      }
      tokenOf.set(d, round);
      return round;
    }

    function headFor(): Drawable {
      if (mode === 'dead') return art.faceFall;
      if (body.grounded >= 0) return art.face;
      if (body.vy < -1100 || body.py + R < cam.cam + 70) return art.faceFall;
      return body.vy > 0 ? art.faceJump : art.face;
    }

    /** The hero's sprite frame for the body's motion (looks only). */
    function heroFrame(): HeroFrame {
      if (mode === 'dead') return 'fall';
      if (body.grounded >= 0) {
        if (Math.abs(body.vx) < 45) return 'stand';
        return Math.floor(runDist / STRIDE) % 2 === 0 ? 'run1' : 'run2';
      }
      // a big combo jump: tucked into a ball, spinning
      if (superAir) return 'ball';
      // a long drop, or the bottom edge is close: arms flailing
      if (body.vy < -1100 || body.py + R < cam.cam + 70) return 'fall';
      // going up: fists in the air, knees tucked; over the top and coming down: legs out to land
      return body.vy > 140 ? 'jump' : 'stand';
    }

    /**
     * The hero sprite, feet at (x, feet): squash / stretch about the feet, lean with the speed,
     * `spin` about the middle of the body, mirrored when facing left. `mul` scales the sprite.
     */
    function drawHero(g: CanvasRenderingContext2D, x: number, feet: number, sx: number, sy: number, spin: number, lean: number, frame: HeroFrame, mul: number): void {
      const sprite = heroSprite(frame);
      if (!sprite) return;
      const box = heroBox() * mul;
      const m = SPRITE_MARGIN * mul;
      g.save();
      g.translate(x, feet);
      if (lean !== 0) g.rotate(lean);
      g.scale(sx, sy);
      if (spin !== 0) {
        const pivot = HERO_PIVOT * box;
        g.translate(0, -pivot);
        g.rotate(spin);
        g.translate(0, pivot);
      }
      if (facing < 0) g.scale(-1, 1);
      g.drawImage(sprite, -box / 2 - m, -HERO_BASELINE * box - m, box + 2 * m, box + 2 * m);
      g.restore();
    }

    /**
     * The small drawn runner (shown when the hero sprites are missing), feet at (x, feet), head
     * radius k px: legs, jacket, arms, scarf and the big head from the face slot. `air`: +1 rising (tuck) .. -1 falling (stretch), 0 = on a floor.
     */
    function drawClimber(g: CanvasRenderingContext2D, x: number, feet: number, k: number, sx: number, sy: number, spin: number, lean: number, air: number, run: number, vxs: number, vys: number, head: Drawable, onFloor: boolean): void {
      const f = facing;
      g.save();
      g.translate(x, feet);
      g.rotate(lean);
      g.scale(sx, sy);
      if (spin !== 0) {
        g.translate(0, -1.5 * k);
        g.rotate(spin);
        g.translate(0, 1.5 * k);
      }
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const tuck = Math.max(0, air);
      const stretch = Math.max(0, -air);
      const hipY = -0.52 * k;
      // legs: ink outline then trousers, shoes
      for (let side = -1; side <= 1; side += 2) {
        const ph = runPhase + (side < 0 ? 0 : Math.PI);
        let footX: number;
        let footY: number;
        let kneeX: number;
        let kneeY: number;
        if (onFloor) {
          footX = f * Math.sin(ph) * 0.46 * k * run + side * 0.17 * k * (1 - run);
          footY = -Math.max(0, -Math.cos(ph)) * 0.3 * k * run;
          kneeX = footX * 0.5 + f * 0.14 * k * run;
          kneeY = hipY * 0.5 + footY * 0.5;
        } else {
          footX = side * (0.2 * k) + f * 0.12 * k * tuck + side * 0.08 * k * stretch;
          footY = -0.34 * k * tuck + 0.1 * k * stretch;
          kneeX = side * 0.2 * k + f * 0.36 * k * tuck;
          kneeY = hipY * 0.5 - 0.3 * k * tuck + 0.08 * k * stretch;
        }
        const hx = side * 0.16 * k;
        g.beginPath();
        g.moveTo(hx, hipY);
        g.lineTo(kneeX, kneeY);
        g.lineTo(footX, footY);
        g.strokeStyle = PAL.ink;
        g.lineWidth = 0.38 * k;
        g.stroke();
        g.strokeStyle = PAL.cobD;
        g.lineWidth = 0.2 * k;
        g.stroke();
        g.beginPath();
        g.ellipse(footX + f * 0.08 * k, footY - 0.04 * k, 0.2 * k, 0.12 * k, 0, 0, Math.PI * 2);
        g.fillStyle = PAL.red;
        g.fill();
        g.lineWidth = 0.08 * k;
        g.strokeStyle = PAL.ink;
        g.stroke();
      }
      // jacket (or the shirt slot picture)
      const tw = 0.82 * k;
      const tTop = -1.12 * k;
      const tH = 0.68 * k;
      if (!art.shirt.isPlaceholder) {
        art.shirt.draw(g, 0, tTop + tH / 2, tw * 1.25, tH * 1.25);
      } else {
        roundRectPath(g, -tw / 2, tTop, tw, tH, 0.22 * k);
        g.fillStyle = PAL.red;
        g.fill();
        g.lineWidth = 0.1 * k;
        g.strokeStyle = PAL.ink;
        g.stroke();
        g.fillStyle = PAL.yel;
        g.fillRect(-0.05 * k, tTop + 0.1 * k, 0.1 * k, tH - 0.16 * k);
      }
      // scarf: a wrap at the neck and a tail trailing against the motion
      const sp = Math.hypot(vxs, vys);
      let tx = -f * 0.3 * k;
      let ty = 0.38 * k;
      if (sp > 120) {
        const len = (0.55 + Math.min(1, sp / 900) * 0.95) * k;
        tx = (-vxs / sp) * len;
        ty = (-vys / sp) * len;
      }
      const wave = Math.sin(runPhase * 1.7) * 0.14 * k * Math.min(1, sp / 500);
      const nx = -f * 0.18 * k;
      const ny = -1.1 * k;
      g.beginPath();
      g.moveTo(nx, ny);
      g.quadraticCurveTo(nx + tx * 0.5 - ty * 0.25 + wave, ny + ty * 0.5 + tx * 0.25, nx + tx, ny + ty + wave);
      g.strokeStyle = PAL.ink;
      g.lineWidth = 0.32 * k;
      g.stroke();
      g.strokeStyle = PAL.yel;
      g.lineWidth = 0.18 * k;
      g.stroke();
      // the head (bobs while running), in front of the scarf tail
      const bob = onFloor ? Math.abs(Math.sin(runPhase)) * 0.08 * k * run : 0;
      const tilt = onFloor ? Math.sin(runPhase) * 0.05 * run : air * 0.06 * f;
      if (isToken(head)) {
        // a round token (face in a disc with its own ring): a short neck, the disc sits on it
        const hs = TOKEN_BOX * k;
        g.fillStyle = PAL.paper;
        g.fillRect(-0.13 * k, -1.36 * k - bob, 0.26 * k, 0.3 * k);
        g.lineWidth = 0.07 * k;
        g.strokeStyle = PAL.ink;
        g.strokeRect(-0.13 * k, -1.36 * k - bob, 0.26 * k, 0.3 * k);
        head.draw(g, 0, -1.3 * k - hs * 0.49 - bob, hs, hs, tilt);
      } else {
        const hs = HEAD_BOX * k;
        head.draw(g, 0, -1.12 * k - hs * 0.43 - bob, hs, hs, tilt);
      }
      roundRectPath(g, -0.36 * k, -1.2 * k, 0.72 * k, 0.18 * k, 0.09 * k);
      g.fillStyle = PAL.yel;
      g.fill();
      g.lineWidth = 0.08 * k;
      g.strokeStyle = PAL.ink;
      g.stroke();
      // arms (in front)
      for (let side = -1; side <= 1; side += 2) {
        const ph = runPhase + (side < 0 ? Math.PI : 0);
        const shx = side * 0.36 * k;
        const shy = -0.98 * k;
        let hx: number;
        let hy: number;
        if (onFloor) {
          hx = shx + f * -Math.sin(ph) * 0.38 * k * run + side * 0.08 * k;
          hy = shy + 0.48 * k - Math.max(0, Math.sin(ph) * f) * 0.1 * k * run;
        } else {
          hx = side * (0.5 + 0.28 * tuck + 0.3 * stretch) * k;
          hy = -1.42 * k * tuck + (-1.5 * k + Math.sin(runPhase * 2 + side) * 0.14 * k) * stretch + (shy + 0.3 * k) * (1 - tuck - stretch);
        }
        const ex = (shx + hx) / 2 + side * 0.12 * k;
        const ey = (shy + hy) / 2;
        g.beginPath();
        g.moveTo(shx, shy);
        g.lineTo(ex, ey);
        g.lineTo(hx, hy);
        g.strokeStyle = PAL.ink;
        g.lineWidth = 0.3 * k;
        g.stroke();
        g.strokeStyle = PAL.red;
        g.lineWidth = 0.15 * k;
        g.stroke();
        g.beginPath();
        g.arc(hx, hy, 0.13 * k, 0, Math.PI * 2);
        g.fillStyle = PAL.paper;
        g.fill();
        g.lineWidth = 0.07 * k;
        g.strokeStyle = PAL.ink;
        g.stroke();
      }
      g.restore();
    }

    function drawPlayer(c: number, alpha: number): void {
      const g = view.ctx;
      const px = wx(lerp(prevX, body.x, alpha));
      const feet = bottom - (lerp(prevPy, body.py, alpha) - c) * scale;
      const k = R * scale;
      const stretch = body.grounded < 0 ? clamp(body.vy / 3200, -0.14, 0.16) : 0;
      const sq = clamp(squash, -0.4, 0.45);
      const sx = (1 + sq) * (1 - stretch * 0.5);
      const sy = (1 - sq) * (1 + stretch);
      const cy = feet - 1.5 * k * sy;

      // afterimage trail on combos: star stickers
      if (trailLen > 0) {
        for (let i = 0; i < trailLen; i++) {
          const idx = (trailHead - 1 - i + TRAIL * 2) % TRAIL;
          const t = 1 - i / TRAIL;
          const tx = wx(trailX[idx] ?? 0);
          const ty = bottom - ((trailA[idx] ?? 0) + R - c) * scale;
          const st = stars[(i + (steps >> 2)) % stars.length];
          if (!st) continue;
          const s = (14 + 20 * t) * Math.min(1.3, scale);
          g.globalAlpha = 0.35 + 0.6 * t;
          g.drawImage(st, tx - s / 2, ty - s / 2, s, s);
        }
        g.globalAlpha = 1;
      }

      // speed lines behind the runner
      const speed = Math.abs(body.vx);
      if (speed > 560) {
        const back = -Math.sign(body.vx);
        const len = (speed - 480) * 0.11 * scale;
        g.lineCap = 'round';
        g.beginPath();
        for (let i = -1; i <= 1; i++) {
          const ly = cy + i * 0.55 * k;
          const lx = px + back * (0.9 * k + Math.abs(i) * 6 * scale);
          g.moveTo(lx, ly);
          g.lineTo(lx + back * len * (1 - Math.abs(i) * 0.3), ly);
        }
        g.strokeStyle = PAL.ink;
        g.lineWidth = 5;
        g.stroke();
        g.strokeStyle = PAL.white;
        g.lineWidth = 2.5;
        g.stroke();
      }

      // frost puffs where it landed
      for (let i = 0; i < PUFFS; i++) {
        const a = puffAge[i] ?? 1;
        if (a >= 1) continue;
        const ppx = wx(puffX[i] ?? 0);
        const ppy = bottom - ((puffA[i] ?? 0) - c) * scale;
        const e = ease.outCubic(a);
        const r = (6 + 16 * e) * scale * (puffK[i] ?? 1);
        g.globalAlpha = 1 - a;
        g.fillStyle = PAL.white;
        g.strokeStyle = PAL.ink;
        g.lineWidth = 2;
        for (let s = -1; s <= 1; s += 2) {
          g.beginPath();
          g.ellipse(ppx + s * (0.6 * k + r), ppy - r * 0.45, r, r * 0.6, 0, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        g.globalAlpha = 1;
      }

      // contact shadow while standing
      if (body.grounded >= 0) {
        g.fillStyle = 'rgba(22, 18, 14, 0.4)';
        g.beginPath();
        g.ellipse(px + 3, feet + 2, k * (0.75 + sq * 0.5), 3.5 * scale + 1.5, 0, 0, Math.PI * 2);
        g.fill();
      }
      const lean = (body.vx / MAX_VX) * 0.22;
      const air = body.grounded >= 0 ? 0 : clamp(body.vy / 650, -1, 1);
      const run = clamp(Math.abs(body.vx) / 380, 0, 1);
      heroAtX = px;
      heroAtY = feet;
      heroAtFrame = art.hero ? heroFrame() : 'runner';
      if (art.hero) drawHero(g, px, feet, sx, sy, rot, lean * 0.5, heroFrame(), 1);
      else drawClimber(g, px, feet, k, sx, sy, rot, lean, air, run, body.vx * scale, -body.vy * scale, headFor(), body.grounded >= 0);
    }

    function drawStreaks(): void {
      if (streakOn <= 0) return;
      const g = view.ctx;
      g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i < STREAKS; i++) {
        const l = streakL[i] ?? 0;
        if (l <= 0) continue;
        const x = offX + (streakX[i] ?? 0) * playW;
        const y = streakY[i] ?? 0;
        g.moveTo(x, y - l);
        g.lineTo(x, y);
      }
      g.stroke();
    }

    function drawPops(): void {
      const g = view.ctx;
      for (const p of pops) {
        if (!p.active || !p.sticker) continue;
        const t = p.age / p.life;
        const k = t < 0.15 ? ease.outBack(t / 0.15) : 1;
        g.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
        blit(g, p.sticker, p.x, p.y - p.rise * ease.outCubic(t), k);
      }
      g.globalAlpha = 1;
    }

    /** Hazard tape rising at the bottom when the floors are about to catch the player. */
    function drawDanger(): void {
      if (mode !== 'run' || !cam.camOn) return;
      const margin = body.py + 2 * R - cam.cam;
      const k = clamp(1 - (margin - 10) / 170, 0, 1);
      if (k <= 0) return;
      const g = view.ctx;
      const pulse = 0.75 + 0.25 * Math.sin(steps * (0.25 + k * 0.25));
      const h = (10 + 30 * k) * pulse;
      const yb = view.height;
      const y0 = bottom - h;
      // stepped flat red bands above the tape (no gradient)
      g.fillStyle = PAL.red;
      for (let i = 1; i <= 3; i++) {
        g.globalAlpha = 0.2 * k * (4 - i) * 0.5;
        g.fillRect(offX, y0 - i * 16 * k, playW, 16 * k);
      }
      g.globalAlpha = 0.55 + 0.45 * k;
      g.save();
      g.translate(offX - ((steps * 2) % 48), y0);
      g.fillStyle = hazardFill(g);
      g.fillRect(0, 0, playW + 48, yb - y0);
      g.restore();
      g.globalAlpha = 1;
      g.fillStyle = PAL.ink;
      g.fillRect(offX, y0 - 1.5, playW, 3);
    }

    /** How visible the first-run hint is now (0 when it is gone). */
    function hintFade(): number {
      if (runs > 0 || hintSteps >= HINT_STEPS) return 0;
      return Math.min(1, (HINT_STEPS - hintSteps) / 24) * Math.min(1, hintSteps / 8);
    }

    function drawHint(): void {
      if (runs > 0 || hintSteps >= HINT_STEPS) return;
      const g = view.ctx;
      const t = hintSteps / STEP_HZ;
      const fade = hintFade();
      const half = view.width / 2;
      const phaseLen = 0.65;
      const side = Math.floor(t / phaseLen) % 2 === 0 ? 1 : -1;
      const pt = (t % phaseLen) / phaseLen;
      // the two halves
      g.globalAlpha = 0.18 * fade;
      g.fillStyle = side < 0 ? PAL.yel : '#ffffff';
      g.fillRect(0, top, half, playH);
      g.fillStyle = side > 0 ? PAL.pink : '#ffffff';
      g.fillRect(half, top, half, playH);
      g.globalAlpha = 0.6 * fade;
      g.fillStyle = PAL.ink;
      g.fillRect(half - 1.5, top + 20, 3, playH - 40);
      // arrows
      const ay = top + playH * 0.55;
      const as = Math.min(46, view.width * 0.11);
      for (let s = -1; s <= 1; s += 2) {
        const on = s === side;
        const ax = half + s * view.width * 0.25 + (on ? s * 8 * Math.sin(pt * Math.PI) : 0);
        g.globalAlpha = (on ? 0.95 : 0.45) * fade;
        g.lineJoin = 'round';
        g.lineWidth = 4;
        g.strokeStyle = PAL.ink;
        g.beginPath();
        g.moveTo(ax + s * as + 4, ay + 5);
        g.lineTo(ax - s * as * 0.4 + 4, ay - as * 0.8 + 5);
        g.lineTo(ax - s * as * 0.4 + 4, ay + as * 0.8 + 5);
        g.closePath();
        g.fillStyle = PAL.ink;
        g.fill();
        g.fillStyle = s < 0 ? PAL.yel : PAL.pink;
        g.beginPath();
        g.moveTo(ax + s * as, ay);
        g.lineTo(ax - s * as * 0.4, ay - as * 0.8);
        g.lineTo(ax - s * as * 0.4, ay + as * 0.8);
        g.closePath();
        g.fill();
        g.stroke();
      }
      // ghost finger pressing the active side
      const press = pt < 0.25 ? ease.outCubic(pt / 0.25) : 1;
      const fxp = half + side * view.width * 0.25;
      const fyp = ay + as * 1.6 + (1 - press) * -26;
      g.globalAlpha = fade * 0.9 * press;
      g.strokeStyle = PAL.white;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(fxp, fyp + 26, 12 + pt * 30, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = fade;
      art.finger.draw(g, fxp + 10, fyp, 64, 64, -0.25 * side);
      // one short line
      const line = stickers.get('hint', (old) => renderSticker('החזיקו צד כדי לרוץ ולקפוץ', { size: Math.round(F_HINT_PX * Math.min(1, ui + 0.1)), fill: PAL.white, shadow: PAL.cob }, old));
      // in the lane, like every other message
      const lane = laneBox();
      const lk = Math.min(1, lane.w / line.w);
      blit(g, line, lane.cx, lane.y + (line.h * lk) / 2, lk);
      g.globalAlpha = 1;
    }

    /** Show which half is pushed: a flat bar on that edge (CSS, so it costs no canvas fill). */
    function drawHeldGlow(): void {
      // the side that pushes now (the newest finger), so two fingers never light both
      const d = mode === 'run' ? heldDir() : 0;
      if (d === glowShown) return;
      glowShown = d;
      glowEls[0].style.opacity = d < 0 ? '1' : '0';
      glowEls[1].style.opacity = d > 0 ? '1' : '0';
    }

    function drawSnow(c: number): void {
      if (lowQuality) return;
      const g = view.ctx;
      g.fillStyle = lookOf(zoneOfAlt(lookAlt(c) + visH * 0.5)).snow;
      g.beginPath();
      for (let i = 0; i < SNOW; i++) {
        const sx = ((snowX[i] ?? 0) * view.width + Math.sin(snowP[i] ?? 0) * 12 + view.width) % view.width;
        const sy = (snowY[i] ?? 0) * view.height;
        const r = snowR[i] ?? 1;
        g.moveTo(sx + r, sy);
        g.arc(sx, sy, r, 0, Math.PI * 2);
      }
      g.fill();
    }

    function drawUi(): void {
      const g = view.ctx;
      const lane = laneBox();
      // while the lane talks in the tower's top row, the floor chips step aside (the combo chip stays: its clock is play)
      const msg = banner.life > 0 ? Math.min(1, (banner.life - banner.age) / 14, banner.age / 4) : 0;
      const away = lane.side ? 0 : Math.max(msg, hintFade());
      // floor chip (top left, under the HUD)
      const fl = stickers.get(`f|${runFloor}`, (old) => renderChip(`קומה ${runFloor}`, 17, PAL.paper, PAL.ink, old));
      const chipsOut = offX > fl.w + 16;
      const pxl = chipsOut ? offX - fl.w - 10 : offX + WALL_W * scale + 8;
      const chipAlpha = chipsOut ? 1 : 1 - away;
      if (chipAlpha > 0.01) {
        g.globalAlpha = chipAlpha;
        g.drawImage(fl.canvas, pxl, top + 8, fl.w, fl.h);
        // best floor of the round so far (after the first fall)
        if (bestFloor > 0) {
          const bl = stickers.get(`b|${bestFloor}`, (old) => renderChip(`שיא ${bestFloor}`, 14, '#3ddc84', PAL.ink, old));
          const bx = offX > bl.w + 16 ? offX - bl.w - 10 : offX + WALL_W * scale + 8;
          g.drawImage(bl.canvas, bx, top + 12 + fl.h, bl.w, bl.h);
        }
        g.globalAlpha = 1;
      }

      // combo chip (top right, mirroring the floor chip) and its clock: full on every combo jump,
      // drains until the combo is lost. A big single jump's word replaces "קומבו" for a moment.
      if (comboJumps > 0) {
        const n = Math.min(comboJumps, 99);
        const word = comboWordT > 0 ? comboWord : 'קומבו';
        const ch = stickers.get(`c|${n}|${word}`, (old) => renderChip(`×${n}`, 18, PAL.red, PAL.yel, old, word));
        const cxr = offX > COMBO_RESERVE + 16 ? offX + playW + 10 : offX + playW - WALL_W * scale - 8 - ch.w;
        const s = 1 + comboPop * 0.22;
        g.drawImage(ch.canvas, cxr + (ch.w * (1 - s)) / 2, top + 8 + (ch.h * (1 - s)) / 2, ch.w * s, ch.h * s);
        const bw = ch.w - 6;
        const bh = 6;
        const by = top + 8 + ch.h + 3;
        const frac = clamp(comboTimer / COMBO_WINDOW, 0, 1);
        g.fillStyle = PAL.ink;
        g.fillRect(cxr - 2, by - 2, bw + 4, bh + 4);
        g.fillStyle = PAL.paper;
        g.fillRect(cxr, by, bw, bh);
        g.fillStyle = comboPop > 0.55 ? PAL.white : frac < 0.3 ? PAL.red : PAL.yel;
        g.fillRect(cxr, by, bw * frac, bh);
      }

      // the lane: one message at a time
      if (banner.life > 0) {
        const a = banner.age;
        const pop = a < BANNER_POP ? ease.outBack(a / BANNER_POP) : 1;
        const fade = Math.min(1, (banner.life - a) / 14);
        const b = banner;
        const st = stickers.get(`n|${b.text}|${b.sub}|${b.color}`, (old) => renderSticker(b.text, { size: LANE_PX, fill: b.color, shadow: b.color === PAL.red ? PAL.yel : PAL.red, sub: b.sub || undefined }, old));
        // the sky lane (landscape) has room to spare, so it is not shrunk with the short tower
        const cap = lane.side ? 1 : ui;
        const k = Math.min(cap, (LANE_MAX_H * cap) / Math.max(1, st.h), lane.w / Math.max(1, st.w));
        g.globalAlpha = fade;
        blit(g, st, lane.cx, lane.y + (st.h * k) / 2, pop * k);
        g.globalAlpha = 1;
      }
    }

    /**
     * Where the lane draws. In portrait it is the tower's top row, from the left wall to the combo
     * chip's place (kept free whether or not a combo runs, so a message never jumps sideways); the
     * floor chips step aside while it talks. When the tower leaves wide sky on its sides (landscape,
     * desktop) it is the sky on the left, under the floor chips, and covers no tower at all.
     */
    function laneBox(): { cx: number; y: number; w: number; side: boolean } {
      if (offX >= SIDE_LANE_MIN) return { cx: offX / 2, y: top + 80, w: offX - 24, side: true };
      const l = offX + WALL_W * scale + 8;
      const inR = offX + playW - WALL_W * scale - 8;
      const r = offX > COMBO_RESERVE + 16 ? inR : inR - COMBO_RESERVE - 6;
      return { cx: (l + r) / 2, y: top + 6, w: r - l, side: false };
    }

    function draw(alpha: number): void {
      if (destroyed) return;
      const now = performance.now();
      if (lastFrameAt > 0) frameEma = frameEma * 0.9 + Math.min(100, now - lastFrameAt) * 0.1;
      lastFrameAt = now;
      const g = view.ctx;
      const c = lerp(prevCam, cam.cam, alpha);
      drawBackground(c);
      drawSnow(c);
      g.save();
      fx.applyShake(g);
      drawWalls(c);
      drawGround(c);
      // floors on screen
      const minAlt = c - (view.height - bottom) / scale - FLOOR_H - 40;
      const maxAlt = c + bottom / scale + 40;
      if (lowFloor > 0 && (level.alt[lowFloor] ?? 0) > minAlt) lowFloor = Math.max(0, floorAtOrBelow(level, minAlt));
      while (lowFloor < level.count - 1 && (level.alt[lowFloor + 1] ?? 0) < minAlt) lowFloor++;
      for (let j = Math.max(1, lowFloor); j < level.count; j++) {
        const a = level.alt[j] ?? 0;
        if (a > maxAlt + 60) break;
        drawFloor(j, bottom - (a - c) * scale);
      }
      drawBestLine(c);
      drawStreaks();
      if (mode === 'run') drawPlayer(c, alpha);
      g.save();
      g.translate(0, bottom + c * scale);
      fx.draw(g);
      drawPops();
      g.restore();
      g.restore();
      if (mode === 'dead') {
        const py0 = bottom - lerp(prevPopY, popY, alpha);
        const k = R * scale * 1.2;
        if (art.hero) drawHero(g, wx(deathX), py0 + HERO_PIVOT * heroBox() * 1.2, 1, 1, deadSteps * 0.12, 0, 'fall', 1.2);
        else drawClimber(g, wx(deathX), py0 + 1.5 * k, k, 1, 1, deadSteps * 0.12, 0, -1, 0, 0, 400, art.faceFall, false);
      }
      drawDanger();
      drawHeldGlow();
      drawHint();
      drawUi();
    }

    // ── test hook ──
    const simBody = createBody();
    const simEv = createEvents();
    const simCam: CamState = { cam: 0, camOn: false, camT: 0 };
    const debug: IcyDebug = {
      get state() {
        return {
          mode,
          x: body.x,
          py: body.py,
          vx: body.vx,
          vy: body.vy,
          grounded: body.grounded,
          cam: cam.cam,
          camV: cam.camOn ? camSpeed(cam.camT) : 0,
          camOn: cam.camOn,
          follow,
          runs,
          runFloor,
          best,
          dir: heldDir(),
          steps,
          paused: ctx.isPaused(),
        };
      },
      get art() {
        return { ...art.real };
      },
      floors(from: number, n: number) {
        const out: Array<{ i: number; alt: number; x: number; half: number }> = [];
        for (let i = Math.max(0, from); i < Math.min(level.count, from + n); i++) {
          out.push({ i, alt: level.alt[i] ?? 0, x: level.x[i] ?? 0, half: level.half[i] ?? 0 });
        }
        return out;
      },
      trace(n: number): void {
        traced.length = 0;
        traceLeft = Math.max(0, n);
      },
      get traced() {
        return traced;
      },
      predict(plan, maxSteps) {
        copyBody(body, simBody);
        simCam.cam = cam.cam;
        simCam.camOn = cam.camOn;
        simCam.camT = cam.camT;
        let floor = runFloor;
        let rs = runSteps;
        const landings: Array<{ step: number; floor: number; x: number }> = [];
        let deadAt = -1;
        let margin = Infinity; // closest the head came to the bottom edge (world units)
        let k = 0;
        let left = plan[0]?.[1] ?? maxSteps;
        for (let s = 1; s <= maxSteps && mode === 'run'; s++) {
          while (left <= 0 && k < plan.length - 1) {
            k++;
            left = plan[k]?.[1] ?? maxSteps;
          }
          left--;
          const want = plan[k]?.[0] ?? 0;
          // 2 = "follow the motion": push the way the face is moving
          const d = want === 2 ? (simBody.vx < 0 ? -1 : 1) : want;
          rs++;
          stepBody(simBody, d, d !== 0, d !== 0, level, 1 / STEP_HZ, simEv);
          if (simEv.landed >= 0) {
            landings.push({ step: s, floor: simEv.landed, x: simBody.x });
            if (simEv.landed > floor) floor = simEv.landed;
          }
          advanceCam(simCam, floor, rs, simBody.py + 2 * R, follow, 1 / STEP_HZ);
          margin = Math.min(margin, simBody.py + 2 * R - (simCam.cam - 8));
          if (fellOff(simBody, simCam.cam)) {
            deadAt = s;
            break;
          }
        }
        return { landings, deadAt, x: simBody.x, py: simBody.py, vx: simBody.vx, margin };
      },
      get look() {
        let n = stars.length + stickers.size + signs.size + (hazard ? 1 : 0);
        for (const t of backTiles) if (t) n++;
        for (const t of wallTiles) if (t) n++;
        for (const b of bakedLedges) if (b) n++;
        return { zone: shownZone, lowQuality, canvases: n + floorSprites.size + heroSprites.size + (greyWall ? 1 : 0) + (greyBg ? 1 : 0) + (bakedIcicles ? bakedIcicles.cells.length : 0), heroX: heroAtX, heroY: heroAtY, heroFrame: heroAtFrame };
      },
    };
    window.__icy = debug;

    loop.start();
    view.canvas.dataset.icy = '0|0|0|0|0';

    return {
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        loop.stop();
        offDown();
        offMove();
        offUp();
        offResize();
        input.dispose();
        fx.clear();
        view.dispose();
        skyA.remove();
        skyB.remove();
        glowEls[0].remove();
        glowEls[1].remove();
        // release every offscreen canvas this round made
        invalidateLook();
        for (const s of stars) s.width = 0;
        stickers.dispose();
        for (const s of signs.values()) s.canvas.width = 0;
        signs.clear();
        if (hazard) hazard.width = 0;
        hazard = null;
        hazardPattern = null;
        // the art of this round (kit drawables made by loadIcyArt for this round only)
        for (const d of art.all) d.source.width = 0;
        scratch.dispose();
        if (greyWall) greyWall.width = 0;
        if (greyBg) greyBg.width = 0;
        greyWall = null;
        greyBg = null;
        if (window.__icy === debug) delete window.__icy;
      },
    };
  },
};
