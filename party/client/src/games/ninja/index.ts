/**
 * נינג׳ה תבורי: swipe to slice what is tossed up, never the bomb.
 *
 * Throws come from a seeded schedule (waves.ts) in field units, launched by
 * game time, so every phone gets the same arcs at the same moments. Input only
 * records where each finger is; slicing happens inside the kit loop's fixed
 * steps (finger path of that step against the throws), so a cutscene freeze
 * stops everything exactly where it is.
 *
 * Score: +10 per slice, +50 golden, +10 per object of a swipe of 3 or more
 * (+30 when it reaches 3, then +10 per extra), bomb -50 (never below 0) and a
 * 1.2 s stun.
 *
 * Look (render-only, never read by the logic): the party sticker style. A cobalt TV stage
 * pre-rendered once per size, fruit drawn to their hit circle, a tapered white blade
 * ribbon with a yellow edge (pink while a combo lives, grey while stunned), pooled juice
 * splat decals pre-rendered per colour, pre-cut halves with a juicy inside, and every text
 * a pre-rendered sticker. A quality flag drops decals and droplets when frames are slow.
 */
import { sfx } from '../../kit/audio';
import { createGameCanvas, drawText, roundRectPath } from '../../kit/canvas';
import { clamp, createFx, ease, lerp } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createInput } from '../../kit/input';
import { createLoop, STEP_S } from '../../kit/loop';
import { COLORS } from '../../kit/theme';
import { GAMES } from '../../../../shared/protocol';
import { BODY_RADIUS, buildHalves, buildSplats, createBackdrop, FRUIT_STYLES, GOLD_STYLE, loadNinjaArt } from './art';
import { PAL, blit, createStickerCache, loadDisplayFont, renderChip, renderSticker } from './look';
import { buildSchedule, GRAVITY, LAUNCH_Y, scheduleSignature } from './waves';

import type { Drawable } from '../../kit/assets';
import type { BurstOptions } from '../../kit/fx';
import type { KitPointer } from '../../kit/input';
import type { GameContext, GameInstance, GameModule } from '../types';
import type { FruitStyle } from './art';
import type { Sticker } from './look';
import type { ThrowKind } from './waves';

// ───────────────────────────── Tuning ─────────────────────────────

const MAX_RAW = GAMES.ninja.maxRaw;
const POINTS_FRUIT = 10;
const POINTS_GOLD = 50;
const POINTS_COMBO_EACH = 10;
const COMBO_MIN = 3;
const BOMB_PENALTY = 50;
const STUN_STEPS = 72; // 1.2 s
/** A finger cuts only while it moves at least this fast (px/s). */
const SHARP_SPEED = 240;
/** A swipe ends after this many slow steps, or this long without a slice. */
const DULL_STEPS_END = 8;
const COMBO_WINDOW_STEPS = 30;
/** No throw is launched with less than this left: it could not be sliced. */
const MIN_LEFT_TO_LAUNCH_MS = 700;
const HINT_MAX_MS = 3400;
/** The game clock catches up with the round clock when it falls this far behind. */
const RESYNC_MS = 400;

const MAX_FLYERS = 32;
const MAX_HALVES = 48;
const MAX_SPLATS = 18;
const MAX_SLASHES = 10;
const MAX_BLADES = 5;
const TRAIL = 16;
/** Fruit and bombs are drawn to their hit circle (R * 1.05), not inside it. Looks only. */
const DRAW_K = 1.05;
const MAX_POPS = 8;
/** Splat decals stay this long (s) and fade over the last part. */
const SPLAT_LIFE = 1.8;
/** Frame time (ms, moving average) above which decals and droplets thin out, and below which they come back. */
const SLOW_FRAME_MS = 30;
const FAST_FRAME_MS = 21;
/** A trail point fades out after this many steps. */
const TRAIL_LIFE = 9;

/** Constant burst options of the per-step effects (no allocation in the hot path). */
const FUSE_SPARKS: BurstOptions = {
  count: 2,
  colors: [COLORS.yellow, COLORS.orange, '#ffffff'],
  speed: 140,
  size: 2.4,
  life: 0.35,
  gravity: 220,
  angle: -Math.PI / 2,
  spread: Math.PI,
};
const GOLD_SPARKLE: BurstOptions = {
  count: 1,
  colors: ['#ffffff', COLORS.yellow],
  speed: 60,
  size: 3,
  life: 0.5,
  gravity: 0,
  shape: 'star',
};

const COMBO_TEXT: readonly string[] = Array.from({ length: 16 }, (_, n) => `קומבו ×${n}!`);
const PLUS_TEXT: readonly string[] = Array.from({ length: 16 }, (_, n) => `+${n * POINTS_COMBO_EACH}`);

// ───────────────────────────── Types ─────────────────────────────

interface Flyer {
  active: boolean;
  kind: ThrowKind;
  variant: number;
  /** Field units (x 0..1 across the column, y 0..1 down the field). */
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  rot: number;
  prot: number;
  spin: number;
  age: number;
  /** Index in the schedule (stable id). */
  id: number;
}

interface Half {
  active: boolean;
  /** Pre-cut picture of this half (buildHalves). */
  img: HTMLCanvasElement | null;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  cut: number;
  rot: number;
  prot: number;
  spin: number;
  side: number;
  life: number;
}

interface Splat {
  active: boolean;
  x: number;
  y: number;
  r: number;
  color: string;
  life: number;
  rot: number;
  /** Pre-rendered blob (look only). */
  img: HTMLCanvasElement | null;
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

interface Slash {
  active: boolean;
  x: number;
  y: number;
  angle: number;
  life: number;
  gold: boolean;
}

interface Blade {
  active: boolean;
  released: boolean;
  id: number;
  curX: number;
  curY: number;
  lastX: number;
  lastY: number;
  speed: number;
  /** Fixed steps since the finger's position last changed (a slow phone moves it once every few steps). */
  idle: number;
  dull: number;
  swipe: number;
  sinceSlice: number;
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  /** Age of each trail point in steps. */
  readonly ta: Float32Array;
  n: number;
}

interface Callout {
  active: boolean;
  text: string;
  sub: string;
  color: string;
  x: number;
  y: number;
  age: number;
  life: number;
}

interface NinjaDebug {
  readonly seed: number;
  readonly signature: string;
  readonly throws: number;
  readonly steps: number;
  readonly launched: number;
  readonly sliced: number;
  readonly golds: number;
  readonly bombsHit: number;
  readonly comboBonus: number;
  readonly score: number;
  readonly stunned: boolean;
  readonly active: number;
  /** Gravity in CSS px/s² and the top of the play field (bots in tests). */
  readonly gravityPx: number;
  readonly fieldTop: number;
  readonly fieldH: number;
  /** Round time of the game clock (ms since the round began). */
  readonly elapsedMs: number;
  /** Fastest finger right now in px/s (fairness checks across frame rates). */
  readonly bladeSpeed: number;
  /** Fixed steps in which a finger was fast enough to cut, since the start. */
  readonly sharpSteps: number;
  /** With `window.__ninjaTrace = []` set before the game starts: snapshot() every 30 steps. */
  readonly traced: number;
  /** Positions of the throws in the air (determinism checks). */
  snapshot(): string;
  /** Throws in the air in CSS px (bots in tests). */
  targets(): Array<{
    readonly id: number;
    readonly kind: ThrowKind;
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
    readonly r: number;
  }>;
  /** First n throws of the schedule. */
  schedule(n: number): Array<{
    readonly atMs: number;
    readonly kind: ThrowKind;
    readonly x: number;
    readonly vx: number;
  }>;
}

declare global {
  interface Window {
    __ninja?: NinjaDebug;
    __ninjaTrace?: string[];
  }
}

function makeFlyer(): Flyer {
  return {
    active: false,
    kind: 'fruit',
    variant: 0,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    prot: 0,
    spin: 0,
    age: 0,
    id: -1,
  };
}

function makeHalf(): Half {
  return {
    active: false,
    img: null,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    cut: 0,
    rot: 0,
    prot: 0,
    spin: 0,
    side: 1,
    life: 0,
  };
}

function makeBlade(): Blade {
  return {
    active: false,
    released: false,
    id: -1,
    curX: 0,
    curY: 0,
    lastX: 0,
    lastY: 0,
    speed: 0,
    idle: 0,
    dull: 0,
    swipe: 0,
    sinceSlice: 0,
    tx: new Float32Array(TRAIL),
    ty: new Float32Array(TRAIL),
    ta: new Float32Array(TRAIL),
    n: 0,
  };
}

/** Squared distance from (cx, cy) to the segment (ax, ay)-(bx, by). */
function segDist2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - cx;
  const ey = ay + dy * t - cy;
  return ex * ex + ey * ey;
}

function styleOf(kind: ThrowKind, variant: number): FruitStyle {
  if (kind === 'gold') return GOLD_STYLE;
  return FRUIT_STYLES[variant] ?? GOLD_STYLE;
}

// ───────────────────────────── Game ─────────────────────────────

export const game: GameModule = {
  id: 'ninja',
  async create(ctx: GameContext): Promise<GameInstance> {
    const [art] = await Promise.all([loadNinjaArt(), loadDisplayFont()]);
    const backdrop = createBackdrop(art.background, 1.06);
    // pre-cut halves: index = fruit variant, then one per golden look
    const halfArt = [...art.targets.map((d, i) => buildHalves(d, FRUIT_STYLES[i] ?? GOLD_STYLE)), ...art.golds.map((d) => buildHalves(d, GOLD_STYLE))];
    // juice decals: three blob shapes per juice colour, pre-rendered once
    const splatArt = new Map<string, HTMLCanvasElement[]>();
    for (const st of [...FRUIT_STYLES, GOLD_STYLE]) if (!splatArt.has(st.juice)) splatArt.set(st.juice, buildSplats(st.juice, 3));
    const stickers = createStickerCache(24);
    /** Which golden look a throw wears (looks only). */
    const goldLook = (id: number): number => id % art.golds.length;
    const bgOpaque = art.background.isPlaceholder || /\.jpe?g(\?|$)/i.test(art.background.url);
    const view = createGameCanvas(ctx.root);
    const input = createInput(view.canvas);
    const fx = createFx(420);
    const schedule = buildSchedule(ctx.seed, ctx.durationMs);
    const signature = scheduleSignature(schedule);
    const firstBomb = schedule.findIndex((t) => t.kind === 'bomb');
    // Round time already gone when the game starts (slow load, late mount), snapped to whole
    // steps: the schedule is in round time, so a late phone sees the same throws at the same
    // moments as the others and skips the ones it was not there for.
    let startOffset = clamp(Math.round((ctx.durationMs - ctx.timeLeftMs()) / (1000 / 60)) * (1000 / 60), 0, ctx.durationMs);

    const flyers: Flyer[] = Array.from({ length: MAX_FLYERS }, makeFlyer);
    const halves: Half[] = Array.from({ length: MAX_HALVES }, makeHalf);
    const splats: Splat[] = Array.from({ length: MAX_SPLATS }, () => ({
      active: false,
      x: 0,
      y: 0,
      r: 0,
      color: '#fff',
      life: 0,
      rot: 0,
      img: null,
    }));
    const pops: Pop[] = Array.from({ length: MAX_POPS }, () => ({ active: false, sticker: null, x: 0, y: 0, age: 0, life: 1, rise: 60 }));
    let popCursor = 0;
    let lowQuality = false;
    let frameEma = 16.7;
    let lastFrameAt = 0;
    let slowSteps = 0;
    // blade ribbon scratch (normals), reused every frame
    const ribX = new Float32Array(TRAIL);
    const ribY = new Float32Array(TRAIL);
    const ribW = new Float32Array(TRAIL);
    const slashes: Slash[] = Array.from({ length: MAX_SLASHES }, () => ({
      active: false,
      x: 0,
      y: 0,
      angle: 0,
      life: 0,
      gold: false,
    }));
    const blades: Blade[] = Array.from({ length: MAX_BLADES }, makeBlade);
    const callout: Callout = {
      active: false,
      text: '',
      sub: '',
      color: COLORS.yellow,
      x: 0,
      y: 0,
      age: 0,
      life: 0,
    };
    const ring = { active: false, x: 0, y: 0, age: 0 };

    let destroyed = false;
    let nextThrow = 0;
    while (nextThrow < schedule.length && (schedule[nextThrow]?.atMs ?? 0) < startOffset) nextThrow++;
    let score = 0;
    let launched = 0;
    let sliced = 0;
    let golds = 0;
    let bombsHit = 0;
    let comboBonus = 0;
    let stun = 0;
    let flash = 0;
    let hint = 1; // alpha of the opening hint
    let hintDone = false;
    let tenSecondsCalled = ctx.durationMs < 20_000;
    let splatCursor = 0;
    let slashCursor = 0;
    let sharpSteps = 0;

    // ── layout (read every frame; cheap) ──
    let W = 0;
    let H = 0;
    let top = 0;
    let fieldH = 1;
    let colX = 0;
    let colW = 1;
    let R = 40; // body radius px
    let box = 100; // sprite box px
    function layout(): void {
      W = view.width;
      H = view.height;
      top = ctx.hudHeight + 4;
      const bottom = H - ctx.safeBottom;
      fieldH = Math.max(200, bottom - top);
      colW = Math.min(W, fieldH * 0.9);
      colX = (W - colW) / 2;
      R = clamp(Math.min(colW, fieldH * 0.62) * 0.11, 30, 54);
      box = R / BODY_RADIUS;
    }
    layout();
    const toX = (x: number): number => colX + x * colW;
    const toY = (y: number): number => top + y * fieldH;

    function setScore(next: number): void {
      score = clamp(Math.round(next), 0, MAX_RAW);
      ctx.setScore(score);
    }

    // ── spawning ──
    function launch(index: number): void {
      const th = schedule[index];
      if (!th) return;
      let f: Flyer | null = null;
      for (const c of flyers) {
        if (!c.active) {
          f = c;
          break;
        }
      }
      if (!f) return;
      f.active = true;
      f.kind = th.kind;
      f.variant = th.variant;
      f.x = f.px = th.x;
      f.y = f.py = th.y;
      f.vx = th.vx;
      f.vy = th.vy;
      f.rot = f.prot = 0;
      f.spin = th.spin;
      f.age = 0;
      f.id = index;
      launched++;
    }

    function addSplat(x: number, y: number, color: string, r: number): void {
      // slow phone: keep only every other decal slot in use
      if (lowQuality && splatCursor % 2 === 1) splatCursor = (splatCursor + 1) % MAX_SPLATS;
      const s = splats[splatCursor];
      splatCursor = (splatCursor + 1) % MAX_SPLATS;
      if (!s) return;
      const set = splatArt.get(color);
      s.img = set ? (set[(sliced + splatCursor) % set.length] ?? null) : null;
      s.active = true;
      s.x = x;
      s.y = y;
      s.r = r;
      s.color = color;
      s.life = 1;
      s.rot = (x * 13.7 + y * 3.1) % (Math.PI * 2);
    }

    function addSlash(x: number, y: number, angle: number, gold: boolean): void {
      const s = slashes[slashCursor];
      slashCursor = (slashCursor + 1) % MAX_SLASHES;
      if (!s) return;
      s.active = true;
      s.x = x;
      s.y = y;
      s.angle = angle;
      s.life = 1;
      s.gold = gold;
    }

    /** Floating sticker ("+10", "-50") at (x, y) (looks only). */
    function addPop(x: number, y: number, text: string, color: string, px: number, life = 0.85, rise = 60): void {
      const p = pops[popCursor];
      popCursor = (popCursor + 1) % MAX_POPS;
      if (!p) return;
      p.active = true;
      p.sticker = stickers.get(`p|${text}|${color}|${px}`, (old) => renderSticker(text, { size: px, fill: color, shadow: color === PAL.red ? PAL.ink : PAL.red }, old));
      p.x = x;
      p.y = y;
      p.age = 0;
      p.life = life;
      p.rise = rise;
    }

    function addHalves(f: Flyer, x: number, y: number, angle: number): void {
      const pair = f.kind === 'gold' ? halfArt[art.targets.length + goldLook(f.id)] : halfArt[f.variant];
      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);
      const bvx = f.vx * colW;
      const bvy = f.vy * fieldH * 0.5;
      for (const side of [-1, 1]) {
        let h: Half | null = null;
        for (const c of halves) {
          if (!c.active) {
            h = c;
            break;
          }
        }
        if (!h) return;
        h.active = true;
        h.img = pair ? pair[side < 0 ? 0 : 1] : null;
        h.x = h.px = x + nx * side * 3;
        h.y = h.py = y + ny * side * 3;
        h.vx = bvx + nx * side * 150 + Math.cos(angle) * 70;
        h.vy = bvy + ny * side * 150 + Math.sin(angle) * 70 - 80;
        h.cut = angle;
        h.rot = h.prot = 0;
        h.spin = side * (3 + (f.id % 4) * 0.7);
        h.side = side;
        h.life = 3;
      }
    }

    function showCallout(text: string, sub: string, color: string, x: number, y: number): void {
      callout.active = true;
      callout.text = text;
      callout.sub = sub;
      callout.color = color;
      callout.x = clamp(x, 120, Math.max(120, W - 120));
      callout.y = clamp(y - R * 2.3, top + 50, top + fieldH - 80);
      callout.age = 0;
      callout.life = 1.05;
    }

    function hitBomb(x: number, y: number): void {
      bombsHit++;
      setScore(score - BOMB_PENALTY);
      stun = STUN_STEPS;
      flash = 1;
      for (const b of blades) b.swipe = 0;
      ring.active = true;
      ring.x = x;
      ring.y = y;
      ring.age = 0;
      fx.shake(26, 650);
      fx.burst(x, y, {
        count: 46,
        colors: [PAL.org, PAL.yel, PAL.red, '#ffffff'],
        speed: 640,
        size: 7,
        life: 0.8,
        gravity: 300,
        shape: 'star',
      });
      fx.burst(x, y, {
        count: 16,
        colors: ['#3a3348', '#5b5470', '#26212f'],
        speed: 220,
        size: 12,
        life: 1.1,
        gravity: -80,
        shape: 'dot',
      });
      // below the "blade down" pill (top + 12 .. top + 62) for its whole 80 px rise
      addPop(clamp(x, 70, W - 70), Math.max(top + 150, y - R), `-${BOMB_PENALTY}`, PAL.red, 48, 1.2, 80);
      sfx.explode();
      haptic.heavy();
    }

    function slice(f: Flyer, blade: Blade, angle: number): void {
      f.active = false;
      const x = toX(f.x);
      const y = toY(f.y);
      if (f.kind === 'bomb') {
        hitBomb(x, y);
        return;
      }
      hintDone = true;
      sliced++;
      const st = styleOf(f.kind, f.variant);
      addHalves(f, x, y, angle);
      const big = Math.min(blade.swipe + 1, 6);
      addSplat(x, y, st.juice, R * (1.5 + (big >= COMBO_MIN ? 0.18 * big : 0)));
      addSlash(x, y, angle, f.kind === 'gold');
      // juice droplets fly along the cut, both ways
      const drops = (lowQuality ? 5 : 9) + (big >= COMBO_MIN ? big * 2 : 0);
      for (const dir of [0, Math.PI]) {
        fx.burst(x, y, {
          count: drops,
          colors: [st.juice, st.flesh, st.juice],
          speed: 480 + big * 40,
          size: 4.5,
          life: 0.6,
          gravity: 900,
          angle: angle + dir,
          spread: 0.7,
        });
      }
      blade.swipe++;
      blade.sinceSlice = 0;
      let gain = f.kind === 'gold' ? POINTS_GOLD : POINTS_FRUIT;
      if (f.kind === 'gold') {
        golds++;
        addPop(x, y - R * 0.6, `+${POINTS_GOLD}`, PAL.yel, 46, 1.1, 90);
        fx.burst(x, y, {
          count: 22,
          colors: [PAL.yel, '#ffffff', PAL.org],
          speed: 380,
          size: 5,
          life: 0.9,
          gravity: 200,
          shape: 'star',
        });
        // a burst of coins
        fx.burst(x, y, {
          count: 14,
          colors: [PAL.yel, PAL.yel2],
          speed: 520,
          size: 7,
          life: 0.9,
          gravity: 1100,
          angle: -Math.PI / 2,
          spread: Math.PI * 1.2,
          shape: 'square',
        });
        fx.shake(8, 220);
        sfx.coin(1.1);
        haptic.success();
      } else {
        addPop(x, y - R * 0.5, `+${POINTS_FRUIT}`, '#ffffff', 30, 0.75, 55);
        fx.shake(3, 110);
        sfx.slice(1 + Math.min(blade.swipe, 8) * 0.07);
        haptic.tap();
      }
      if (blade.swipe >= COMBO_MIN) {
        const bonus = blade.swipe === COMBO_MIN ? COMBO_MIN * POINTS_COMBO_EACH : POINTS_COMBO_EACH;
        gain += bonus;
        comboBonus += bonus;
        const n = Math.min(blade.swipe, COMBO_TEXT.length - 1);
        showCallout(
          COMBO_TEXT[n] ?? '',
          PLUS_TEXT[Math.min(n, PLUS_TEXT.length - 1)] ?? '',
          blade.swipe >= 5 ? PAL.pink : PAL.yel,
          x,
          y,
        );
        fx.shake(7 + Math.min(blade.swipe, 6), 200);
        sfx.pop(1 + Math.min(blade.swipe, 10) * 0.08);
        if (blade.swipe === COMBO_MIN) sfx.success();
        haptic.bump();
      }
      setScore(score + gain);
    }

    // ── input: only records where fingers are; the loop does the cutting ──
    function bladeOf(id: number): Blade | null {
      for (const b of blades) if (b.active && !b.released && b.id === id) return b;
      return null;
    }
    const offDown = input.onDown((p: KitPointer) => {
      let b: Blade | null = null;
      for (const c of blades) {
        if (!c.active && c.n === 0) {
          b = c;
          break;
        }
      }
      if (!b) for (const c of blades) if (!c.active) b = c;
      if (!b) return;
      b.active = true;
      b.released = false;
      b.id = p.id;
      b.curX = b.lastX = p.x;
      b.curY = b.lastY = p.y;
      b.speed = 0;
      b.idle = 0;
      b.dull = 0;
      b.swipe = 0;
      b.sinceSlice = 0;
      b.n = 0;
    });
    const offMove = input.onMove((p: KitPointer) => {
      const b = bladeOf(p.id);
      if (!b) return;
      b.curX = p.x;
      b.curY = p.y;
    });
    const offUp = input.onUp((p: KitPointer) => {
      const b = bladeOf(p.id);
      if (!b) return;
      if (!p.cancelled) {
        b.curX = p.x;
        b.curY = p.y;
      } else {
        // cancelled (freeze, notification, system gesture): the move not yet cut is dropped
        b.curX = b.lastX;
        b.curY = b.lastY;
      }
      b.released = true;
    });

    function pushTrail(b: Blade, x: number, y: number): void {
      if (b.n < TRAIL) {
        b.tx[b.n] = x;
        b.ty[b.n] = y;
        b.ta[b.n] = 0;
        b.n++;
      } else {
        dropTrail(b, 1);
        b.tx[b.n] = x;
        b.ty[b.n] = y;
        b.ta[b.n] = 0;
        b.n++;
      }
    }

    function dropTrail(b: Blade, k: number): void {
      const m = Math.min(k, b.n);
      if (m <= 0) return;
      b.tx.copyWithin(0, m);
      b.ty.copyWithin(0, m);
      b.ta.copyWithin(0, m);
      b.n -= m;
    }

    function updateBlade(b: Blade, dt: number): void {
      // trail points age; the old ones fall off the tail
      let old = 0;
      for (let i = 0; i < b.n; i++) {
        const a = (b.ta[i] ?? 0) + 1;
        b.ta[i] = a;
        if (a > TRAIL_LIFE) old = i + 1;
      }
      dropTrail(b, old);
      if (!b.active) return;
      const dx = b.curX - b.lastX;
      const dy = b.curY - b.lastY;
      const d = Math.hypot(dx, dy);
      // Finger speed in px per second of game time. A phone at 20-30 fps delivers one move
      // every 2-3 fixed steps: the move covers all of them, so divide by the steps it took
      // (else a slow phone would read 3x the speed and cut with a lazier swipe).
      if (d > 0.5) {
        b.speed = b.speed * 0.5 + (d / (Math.min(b.idle + 1, 3) * dt)) * 0.5;
        b.idle = 0;
      } else {
        b.idle++;
        if (b.idle >= 3) b.speed *= 0.5;
      }
      b.sinceSlice++;
      const sharp = d > 0.5 && b.speed >= SHARP_SPEED;
      if (sharp) {
        sharpSteps++;
        b.dull = 0;
        if (stun === 0) {
          const ang = Math.atan2(dy, dx);
          const hr = R * 1.05;
          const hr2 = hr * hr;
          for (const f of flyers) {
            if (!f.active) continue;
            const fx0 = toX(f.x);
            const fy0 = toY(f.y);
            if (segDist2(b.lastX, b.lastY, b.curX, b.curY, fx0, fy0) <= hr2) slice(f, b, ang);
          }
        }
      } else {
        b.dull++;
      }
      if (b.dull > DULL_STEPS_END || b.sinceSlice > COMBO_WINDOW_STEPS) b.swipe = 0;
      if (d > 0.5) {
        if (b.n === 0) pushTrail(b, b.lastX, b.lastY);
        pushTrail(b, b.curX, b.curY);
      }
      b.lastX = b.curX;
      b.lastY = b.curY;
      if (b.released) {
        b.active = false;
        b.swipe = 0;
      }
    }

    function update(dt: number): void {
      layout();
      // Behind the round clock (the page slept: locked phone, another app, very long frames)?
      // Catch up so the throws stay in step with everyone else's; the ones that flew while
      // this phone slept are skipped, never launched all at once.
      const roundElapsed = ctx.durationMs - ctx.timeLeftMs();
      if (roundElapsed - (startOffset + loop.timeMs) > RESYNC_MS) {
        startOffset = Math.round((roundElapsed - loop.timeMs) / (1000 / 60)) * (1000 / 60);
        const skipBefore = startOffset + loop.timeMs - 250;
        while (nextThrow < schedule.length && (schedule[nextThrow]?.atMs ?? 0) < skipBefore) nextThrow++;
      }
      const now = startOffset + loop.timeMs;
      // launches
      while (nextThrow < schedule.length) {
        const th = schedule[nextThrow];
        if (!th || th.atMs > now) break;
        if (ctx.timeLeftMs() > MIN_LEFT_TO_LAUNCH_MS) {
          launch(nextThrow);
          if (th.kind === 'bomb') sfx.tick(0.6);
          else if (th.kind === 'gold') sfx.coin(1.6);
          else if (nextThrow === 0 || schedule[nextThrow - 1]?.atMs !== th.atMs) sfx.whoosh(0.8 + (th.variant % 3) * 0.1);
        }
        nextThrow++;
      }

      // throws
      for (const f of flyers) {
        if (!f.active) continue;
        f.px = f.x;
        f.py = f.y;
        f.prot = f.rot;
        f.vy += GRAVITY * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rot += f.spin * dt;
        f.age++;
        if (f.vy > 0 && f.y > LAUNCH_Y + 0.08) {
          f.active = false;
          continue;
        }
        if (f.kind === 'bomb' && f.age % 3 === 0) {
          const wob = Math.sin(f.rot) * 0.4;
          const tipX = toX(f.x) + (Math.cos(wob) * 1.02 - Math.sin(wob) * -1.24) * R;
          const tipY = toY(f.y) + (Math.sin(wob) * 1.02 + Math.cos(wob) * -1.24) * R;
          fx.burst(tipX, tipY, FUSE_SPARKS);
        } else if (f.kind === 'gold' && f.age % 5 === 0) {
          fx.burst(toX(f.x), toY(f.y), GOLD_SPARKLE);
        }
      }

      // blades (after the throws moved, so the cut uses this step's positions)
      if (stun > 0) stun--;
      for (const b of blades) updateBlade(b, dt);

      // cosmetics that still live in game time
      const g = GRAVITY * fieldH;
      for (const h of halves) {
        if (!h.active) continue;
        h.px = h.x;
        h.py = h.y;
        h.prot = h.rot;
        h.vy += g * dt;
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        h.rot += h.spin * dt;
        h.life -= dt;
        if (h.life <= 0 || h.y > H + box) h.active = false;
      }
      for (const s of splats) {
        if (!s.active) continue;
        s.life -= dt / SPLAT_LIFE;
        if (s.life <= 0) s.active = false;
      }
      for (const p of pops) {
        if (!p.active) continue;
        p.age += dt;
        if (p.age >= p.life) p.active = false;
      }
      // the quality flag follows the measured frame time (changed only here: a frozen frame never changes)
      if (frameEma > SLOW_FRAME_MS) slowSteps = Math.min(120, slowSteps + 1);
      else if (frameEma < FAST_FRAME_MS) slowSteps = Math.max(-120, slowSteps - 1);
      if (!lowQuality && slowSteps >= 90) lowQuality = true;
      else if (lowQuality && slowSteps <= -90) lowQuality = false;
      for (const s of slashes) {
        if (!s.active) continue;
        s.life -= dt * 4.5;
        if (s.life <= 0) s.active = false;
      }
      if (callout.active) {
        callout.age += dt;
        if (callout.age >= callout.life) callout.active = false;
      }
      if (ring.active) {
        ring.age += dt;
        if (ring.age > 0.6) ring.active = false;
      }
      flash = Math.max(0, flash - dt * 2.6);
      const roundStep = Math.round(now / (1000 / 60));
      if (trace && roundStep % 30 === 0 && trace.length < 400) trace.push(`${roundStep}|${debug.snapshot()}`);
      if (!hintDone && now > HINT_MAX_MS) hintDone = true;
      if (hintDone && hint > 0) hint = Math.max(0, hint - dt * 3.5);
      if (!tenSecondsCalled) {
        const left = ctx.timeLeftMs();
        if (left > 0 && left <= 10_000) {
          tenSecondsCalled = true;
          showCallout('10 שניות!', 'תנו בראש!', PAL.white, W / 2, top + fieldH * 0.32);
          callout.life = 1.4;
          sfx.drumroll(700);
        }
      }
      fx.update(dt);
    }

    // ───────────────────────────── Render ─────────────────────────────

    function drawBackground(g: CanvasRenderingContext2D): void {
      if (!bgOpaque) view.clear();
      backdrop.draw(g, W, H, view.dpr);
    }

    function drawSplats(g: CanvasRenderingContext2D): void {
      for (const s of splats) {
        if (!s.active) continue;
        g.globalAlpha = Math.min(1, s.life * 1.6) * 0.62;
        g.fillStyle = s.color;
        g.beginPath();
        g.arc(s.x, s.y, s.r * 0.36, 0, Math.PI * 2);
        for (let i = 0; i < 7; i++) {
          const a = s.rot + i * 0.898;
          const dist = s.r * (0.5 + (i % 3) * 0.2);
          const rr = s.r * (0.07 + (i % 2) * 0.06);
          g.moveTo(s.x + Math.cos(a) * dist + rr, s.y + Math.sin(a) * dist);
          g.arc(s.x + Math.cos(a) * dist, s.y + Math.sin(a) * dist, rr, 0, Math.PI * 2);
        }
        g.fill();
      }
      g.globalAlpha = 1;
    }

    function drawHalves(g: CanvasRenderingContext2D, alpha: number): void {
      for (const h of halves) {
        if (!h.active || !h.img) continue;
        const x = lerp(h.px, h.x, alpha);
        const y = lerp(h.py, h.y, alpha);
        const rot = lerp(h.prot, h.rot, alpha);
        g.save();
        g.translate(x, y);
        g.rotate(h.cut + rot);
        g.drawImage(h.img, -box / 2, -box / 2, box, box);
        g.restore();
      }
    }

    function drawFuse(g: CanvasRenderingContext2D, f: Flyer, x: number, y: number, wob: number): void {
      g.save();
      g.translate(x, y);
      g.rotate(wob);
      // cap
      g.save();
      g.translate(R * 0.5, -R * 0.9);
      g.rotate(0.55);
      g.fillStyle = '#4b4560';
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      roundRectPath(g, -R * 0.24, -R * 0.15, R * 0.48, R * 0.3, R * 0.07);
      g.fill();
      g.stroke();
      g.restore();
      // fuse
      g.lineCap = 'round';
      g.strokeStyle = '#3a2a14';
      g.lineWidth = R * 0.16;
      g.beginPath();
      g.moveTo(R * 0.6, -R * 1.02);
      g.quadraticCurveTo(R * 0.72, -R * 1.5, R * 1.02, -R * 1.24);
      g.stroke();
      g.strokeStyle = '#d9b27a';
      g.lineWidth = R * 0.09;
      g.stroke();
      // spark at the tip: flickers in game steps
      const flick = ((f.age * 7 + f.id * 13) % 10) / 10;
      const sr = R * (0.2 + flick * 0.14);
      g.globalCompositeOperation = 'lighter';
      art.glowGold.draw(g, R * 1.02, -R * 1.24, R * 1.3, R * 1.3);
      g.globalCompositeOperation = 'source-over';
      g.translate(R * 1.02, -R * 1.24);
      g.rotate(flick * 2);
      g.fillStyle = flick > 0.5 ? '#ffffff' : COLORS.yellow;
      g.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        const rr = i % 2 === 0 ? sr : sr * 0.38;
        if (i === 0) g.moveTo(rr, 0);
        else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.fillStyle = COLORS.orange;
      g.beginPath();
      g.arc(0, 0, sr * 0.3, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    /** Two passes: bombs last, so a bomb is never hidden behind a fruit. */
    function drawFlyers(g: CanvasRenderingContext2D, alpha: number): void {
      for (let pass = 0; pass < 2; pass++) {
        for (const f of flyers) {
          if (f.active && (f.kind === 'bomb') === (pass === 1)) drawFlyer(g, f, alpha);
        }
      }
    }

    function drawFlyer(g: CanvasRenderingContext2D, f: Flyer, alpha: number): void {
      const x = toX(lerp(f.px, f.x, alpha));
      const y = toY(lerp(f.py, f.y, alpha));
      const rot = lerp(f.prot, f.rot, alpha);
      // pop-in squash and stretch
      const k = f.age < 16 ? ease.outBack(f.age / 16) : 1;
      const sx = lerp(0.7, 1, k);
      const sy = lerp(1.3, 1, k);
      if (f.kind === 'bomb') {
        const pulse = 0.55 + 0.45 * Math.sin(f.age * 0.25);
        g.globalAlpha = 0.5 + pulse * 0.4;
        art.glowRed.draw(g, x, y, R * 3.4, R * 3.4);
        g.globalAlpha = 1;
        const wob = Math.sin(rot) * 0.4;
        g.save();
        g.translate(x, y);
        g.scale(sx, sy);
        art.bomb.draw(g, 0, 0, box, box, wob);
        g.restore();
        drawFuse(g, f, x, y, wob);
        if (f.id === firstBomb && f.age < 150) drawTag(g, x, y - R * 2.1, 'לא לחתוך!', COLORS.red);
      } else {
        const d = f.kind === 'gold' ? art.gold : (art.targets[f.variant] ?? art.gold);
        if (f.kind === 'gold') {
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 0.8;
          art.glowGold.draw(g, x, y, R * 3.6, R * 3.6);
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        }
        if (k < 1) {
          g.save();
          g.translate(x, y);
          g.scale(sx, sy);
          d.draw(g, 0, 0, box, box, rot);
          g.restore();
        } else {
          d.draw(g, x, y, box, box, rot);
        }
      }
    }

    function drawTag(g: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
      g.font = font(18, 900);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const w = g.measureText(text).width + 24;
      const tx = clamp(x, w / 2 + 6, W - w / 2 - 6);
      g.fillStyle = color;
      roundRectPath(g, tx - w / 2, y - 16, w, 32, 16);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.5;
      g.stroke();
      g.fillStyle = '#ffffff';
      drawText(g, text, tx, y + 1);
    }

    function drawSlashes(g: CanvasRenderingContext2D): void {
      g.lineCap = 'round';
      for (const s of slashes) {
        if (!s.active) continue;
        const len = R * (1.6 + (1 - s.life) * 1.4);
        const cx = Math.cos(s.angle) * len;
        const cy = Math.sin(s.angle) * len;
        g.globalAlpha = s.life;
        g.strokeStyle = s.gold ? COLORS.yellow : '#ffffff';
        g.lineWidth = 7 * s.life + 1;
        g.beginPath();
        g.moveTo(s.x - cx, s.y - cy);
        g.lineTo(s.x + cx, s.y + cy);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    function drawBlades(g: CanvasRenderingContext2D): void {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const dull = stun > 0;
      for (const b of blades) {
        const n = b.n;
        if (n < 2) continue;
        // glow pass, then the white-hot core; both taper towards the tail
        for (let pass = 0; pass < 2; pass++) {
          g.strokeStyle =
            pass === 0
              ? dull
                ? 'rgba(255, 77, 94, 0.35)'
                : 'rgba(45, 226, 230, 0.42)'
              : dull
                ? 'rgba(200, 190, 210, 0.7)'
                : '#ffffff';
          const maxW = pass === 0 ? 20 : 7;
          for (let i = 1; i < n; i++) {
            // younger points are thicker: the blade tapers towards the tail
            const t = 1 - (b.ta[i] ?? 0) / (TRAIL_LIFE + 1);
            g.lineWidth = Math.max(1, maxW * t);
            g.beginPath();
            g.moveTo(b.tx[i - 1] ?? 0, b.ty[i - 1] ?? 0);
            g.lineTo(b.tx[i] ?? 0, b.ty[i] ?? 0);
            g.stroke();
          }
        }
        if (b.active && !dull) {
          g.globalCompositeOperation = 'lighter';
          art.glowWhite.draw(g, b.tx[n - 1] ?? 0, b.ty[n - 1] ?? 0, 34, 34);
          g.globalCompositeOperation = 'source-over';
        }
      }
    }

    function drawCallout(g: CanvasRenderingContext2D): void {
      if (!callout.active) return;
      const t = callout.age;
      const pop = ease.outBack(clamp(t / 0.22, 0, 1));
      const fade = clamp((callout.life - t) / 0.25, 0, 1);
      const size = clamp(W * 0.105, 32, 48);
      g.save();
      g.globalAlpha = fade;
      g.translate(callout.x, callout.y - t * 22);
      g.rotate(-0.07);
      g.scale(pop, pop);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(size, 900);
      g.lineJoin = 'round';
      g.strokeStyle = '#2b1436';
      g.lineWidth = 9;
      g.fillStyle = callout.color;
      drawText(g, callout.text, 0, 0, true);
      if (callout.sub) {
        g.font = font(size * 0.62, 900);
        g.lineWidth = 7;
        g.fillStyle = '#ffffff';
        drawText(g, callout.sub, 0, size * 0.85, true);
      }
      g.restore();
    }

    function drawHint(g: CanvasRenderingContext2D): void {
      if (hint <= 0) return;
      const now = loop.timeMs;
      const cycle = 1300;
      const ph = (now % cycle) / cycle;
      const ax = W / 2 - colW * 0.3;
      const ay = toY(0.5);
      const bx = W / 2 + colW * 0.3;
      const by = toY(0.3);
      const move = ease.inOutCubic(clamp(ph / 0.6, 0, 1));
      const fade = ph < 0.08 ? ph / 0.08 : ph > 0.82 ? Math.max(0, (1 - ph) / 0.18) : 1;
      const hx = lerp(ax, bx, move);
      const hy = lerp(ay, by, move);
      g.save();
      g.globalAlpha = hint * fade;
      // ghost trail
      g.lineCap = 'round';
      const tail = Math.max(0, move - 0.35);
      const tx = lerp(ax, bx, tail);
      const ty = lerp(ay, by, tail);
      g.strokeStyle = 'rgba(45, 226, 230, 0.5)';
      g.lineWidth = 16;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(hx, hy);
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.stroke();
      // hand: fingertip at (30, 8) of its 100 box
      const hs = 86;
      art.hand.draw(g, hx + hs * 0.2, hy + hs * 0.42, hs, hs);
      g.restore();
      // label
      g.save();
      g.globalAlpha = hint;
      g.font = font(clamp(W * 0.065, 22, 30), 900);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.strokeStyle = '#2b1436';
      g.lineWidth = 7;
      g.fillStyle = '#ffffff';
      drawText(g, 'החליקו כדי לחתוך!', W / 2, toY(0.68), true);
      g.restore();
    }

    function drawStun(g: CanvasRenderingContext2D): void {
      if (stun <= 0) return;
      const k = stun / STUN_STEPS;
      // red vignette frame
      g.save();
      g.globalAlpha = 0.25 + 0.35 * k;
      g.strokeStyle = COLORS.red;
      g.lineWidth = 26;
      g.strokeRect(0, 0, W, H);
      g.restore();
      // "blade down" pill with a draining bar
      const w = Math.min(240, W - 40);
      const x = W / 2 - w / 2;
      const y = top + 12;
      g.fillStyle = 'rgba(43, 20, 54, 0.88)';
      roundRectPath(g, x, y, w, 50, 16);
      g.fill();
      g.strokeStyle = COLORS.red;
      g.lineWidth = 2.5;
      g.stroke();
      g.font = font(19, 900);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      drawText(g, 'בום! הלהב מושבת', W / 2, y + 19);
      g.fillStyle = 'rgba(255, 255, 255, 0.15)';
      roundRectPath(g, x + 14, y + 35, w - 28, 7, 3.5);
      g.fill();
      g.fillStyle = COLORS.red;
      roundRectPath(g, x + 14, y + 35, (w - 28) * k, 7, 3.5);
      g.fill();
    }

    function render(alpha: number): void {
      layout();
      const g = view.ctx;
      drawBackground(g); // outside the shake: the copy stays a 1:1 blit
      g.save();
      fx.applyShake(g);
      drawSplats(g);
      drawHalves(g, alpha);
      drawFlyers(g, alpha);
      drawSlashes(g);
      if (ring.active) {
        const t = ring.age / 0.6;
        g.globalAlpha = 1 - t;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 10 * (1 - t) + 2;
        g.beginPath();
        g.arc(ring.x, ring.y, R * (1 + t * 5), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      drawBlades(g);
      fx.draw(g);
      drawCallout(g);
      g.restore();
      drawHint(g);
      drawStun(g);
      if (flash > 0) {
        g.globalAlpha = Math.min(1, flash * 1.1);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      }
    }

    const loop = createLoop({ update, render });
    const trace = Array.isArray(window.__ninjaTrace) ? window.__ninjaTrace : null;

    const debug: NinjaDebug = {
      seed: ctx.seed,
      signature,
      throws: schedule.length,
      get steps(): number {
        return loop.steps;
      },
      get launched(): number {
        return launched;
      },
      get sliced(): number {
        return sliced;
      },
      get golds(): number {
        return golds;
      },
      get bombsHit(): number {
        return bombsHit;
      },
      get comboBonus(): number {
        return comboBonus;
      },
      get score(): number {
        return score;
      },
      get stunned(): boolean {
        return stun > 0;
      },
      get gravityPx(): number {
        return GRAVITY * fieldH;
      },
      get fieldTop(): number {
        return top;
      },
      get fieldH(): number {
        return fieldH;
      },
      get elapsedMs(): number {
        return startOffset + loop.timeMs;
      },
      get bladeSpeed(): number {
        let v = 0;
        for (const b of blades) if (b.active) v = Math.max(v, b.speed);
        return v;
      },
      get sharpSteps(): number {
        return sharpSteps;
      },
      get traced(): number {
        return trace ? trace.length : 0;
      },
      get active(): number {
        let n = 0;
        for (const f of flyers) if (f.active) n++;
        return n;
      },
      snapshot(): string {
        const parts: string[] = [];
        for (const f of flyers) if (f.active) parts.push(`${f.id}:${f.x.toFixed(4)},${f.y.toFixed(4)}`);
        return parts.sort().join(' ');
      },
      targets() {
        const out = [];
        for (const f of flyers) {
          if (f.active)
            out.push({
              id: f.id,
              kind: f.kind,
              x: toX(f.x),
              y: toY(f.y),
              vx: f.vx * colW,
              vy: f.vy * fieldH,
              r: R,
            });
        }
        return out;
      },
      schedule(n: number) {
        return schedule.slice(0, n).map((t) => ({ atMs: t.atMs, kind: t.kind, x: t.x, vx: t.vx }));
      },
    };
    window.__ninja = debug;

    // a still frame right away (the loop's first render follows on the next frame)
    render(0);
    loop.start();

    return {
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        loop.stop();
        offDown();
        offMove();
        offUp();
        input.dispose();
        view.dispose();
        backdrop.dispose();
        fx.clear();
        // window.__ninja keeps the final counters for test scripts
      },
    };
  },
};
