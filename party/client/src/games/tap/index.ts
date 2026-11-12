/**
 * שימי טאפ: make Shimi pick his nose. Every tap on the doll pushes its little hand up
 * towards the nose (the pick meter, rules in pick.ts); spam fast enough and the finger
 * goes INTO the nostril: from then every tap is a dig worth 5 that throws a booger at the
 * screen. Slow down and the finger comes out and the hand sinks. Every so many digs the
 * BIG booger comes out (bonus). Boogers stick to the glass, slide down and pile up at the
 * bottom, so the pile shows how hard you picked.
 *
 * Fairness: taps are stamped with their round time and applied by the pure engine at the
 * fixed step that covers that time (pick.ts), so frame rate does not change the score.
 * Everything else runs on the kit loop's game time, so a cutscene freeze needs no code.
 */
import { GAMES } from '../../../../shared/protocol';
import { noise, sfx, tone } from '../../kit/audio';
import { createGameCanvas } from '../../kit/canvas';
import { clamp, createFx, ease, lerp } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createInput } from '../../kit/input';
import { createLoop } from '../../kit/loop';
import { createBackdrop, FACE, FRAME, HAND, loadTapArt, paintTray, PICKF, TRAY_H } from './art';
import { blit, loadDisplayFont, makeLayer, PAL, renderChip, renderSticker } from './look';
import { createPickEngine, PICK } from './pick';
import { BOOGER, boogerTraits, buildLevel } from './schedule';

import type { Drawable } from '../../kit/assets';
import type { GameContext, GameInstance, GameModule } from '../types';
import type { Sticker } from './look';
import type { PickPhase } from './pick';
import type { BoogerKind } from './schedule';

// ───────────────────────────── Tuning (cosmetic; the rules are in pick.ts) ─────────────────────────────

const MAX_RAW = GAMES.tap.maxRaw;
const STEP_MS = 1000 / 60;
/** The game clock catches up with the round clock when it falls this far behind. */
const RESYNC_MS = 400;
/** Taps wait for the step that covers their round time, unless the game lags more than this. */
const FLUSH_LAG_MS = 120;
const TUTORIAL_MS = 3_400;
/** Live boogers (flying + on the glass); the oldest one on the glass merges into the pile. */
const GOO_POOL = 18;
const FLY_S = 0.3;
const OUT_FRAME_S = 0.45;
const BORED_AFTER_MS = 1_500;
const SIDE_PAD = 6;
const PILE_STAMPS = 160;
/** The pile grows up to this share of the head size (it must not bury the doll's mouth). */
const PILE_LIFT_MAX = 0.08;

// ───────────────────────────── Words (the owner's voice) ─────────────────────────────

const T_HINT = 'הקישו מהר';
const T_HINT_SUB = 'להכניס את האצבע לאף!';
const T_PICK = 'מחטט!';
const T_PICK_SUB = 'כל הקשה פי 5';
const T_FRENZY = 'שימי משתולל!';
const T_FRENZY_SUB = 'מהר מהר!';
const T_MORE = 'עוד! עוד!';
const T_GOLD = 'מטמון!';
const T_BORED = 'נו?';
const T_GAUGE = 'מד חיטוט';
const BIG_LINES: readonly string[] = ['בן פורת יוסף!', 'מחורחר!', 'צדיק!', 'עד המוח!', 'וואו!', 'בול בנחיר!', 'נודר', 'שלל!'];
const NUMBERS: readonly number[] = [1, 2, 3, 5, 10, 25];

// ───────────────────────────── Debug (tests) ─────────────────────────────

export interface TapDebugState {
  readonly fingerprint: string;
  readonly elapsedMs: number;
  /** Tap target (the head): centre and radius in CSS px. */
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly meter: number;
  readonly phase: PickPhase;
  readonly picking: boolean;
  readonly digs: number;
  readonly bigBoogers: number;
  readonly bigActive: boolean;
  readonly picks: number;
  readonly pickingMs: number;
  readonly combo: number;
  readonly mult: number;
  readonly score: number;
  readonly hits: number;
  readonly misses: number;
  readonly bounces: number;
  readonly frenzy: boolean;
  /** Head frame on screen (face_* / pick_* slot name). */
  readonly frame: string;
  /** Fingertip of the rising hand (CSS px), null while the frame shows the hand. */
  readonly handY: number | null;
  readonly glass: number;
  readonly pile: number;
  readonly queued: number;
  readonly hudTop: number;
  readonly trayTop: number;
  /** Art slots that fell back to their drawn placeholder (no file, or it failed to load). */
  readonly placeholders: readonly string[];
}

let debugSource: (() => TapDebugState) | null = null;

declare global {
  interface Window {
    /** Read-only state of the running tap game for test scripts (like __flappy / __ninja). */
    __tap?: () => TapDebugState | null;
    /** Set to [] before the game starts: the engine state every 30 steps (fairness checks). */
    __tapTrace?: string[];
  }
}

/** Live state of the running tap game, for automated checks. Null when none runs. */
export function tapDebug(): TapDebugState | null {
  return debugSource ? debugSource() : null;
}

// ───────────────────────────── Pools ─────────────────────────────

interface Goo {
  live: boolean;
  kind: BoogerKind;
  /** 0 flying to the glass, 1 on the glass. */
  stage: number;
  t: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** Where it lands (CSS px) and where it stuck (for the slime trail). */
  tx: number;
  ty: number;
  size: number;
  rot: number;
  vrot: number;
  vy: number;
  stretch: number;
  born: number;
}

interface Floater {
  live: boolean;
  s: Sticker | null;
  x: number;
  y: number;
  t: number;
  life: number;
}

interface Ripple {
  live: boolean;
  x: number;
  y: number;
  t: number;
  hit: boolean;
}

interface Stamp {
  u: number;
  lift: number;
  kind: BoogerKind;
  k: number;
  rot: number;
}

const IDLE_FACES: readonly number[] = [FACE.Bored, FACE.Tongue, FACE.Bored, FACE.Wink];
const FACE_NAMES: readonly string[] = ['face_normal', 'face_happy', 'face_surprised', 'face_angry', 'face_tongue', 'face_wink', 'face_bored', 'face_proud'];
const PICK_NAMES: readonly string[] = ['face_nosepick', 'pick_knuckle', 'pick_deep', 'pick_out', 'pick_big'];

// ───────────────────────────── Game ─────────────────────────────

export const game: GameModule = {
  id: 'tap',
  async create(ctx: GameContext): Promise<GameInstance> {
    const level = buildLevel(ctx.seed, ctx.durationMs);
    const [art] = await Promise.all([loadTapArt(), loadDisplayFont()]);
    const backdrop = createBackdrop(art.background);
    const view = createGameCanvas(ctx.root);
    view.canvas.dataset.level = level.fingerprint;
    const input = createInput(view.canvas);
    const fx = createFx(180);

    // ── pre-rendered words (display font, once) ──
    const stHint = renderSticker(T_HINT, { size: 34, sub: T_HINT_SUB, fill: PAL.white, shadow: PAL.red });
    const stPick = renderSticker(T_PICK, { size: 32, sub: T_PICK_SUB, fill: PAL.yel, burst: PAL.red });
    const stFrenzy = renderSticker(T_FRENZY, { size: 30, sub: T_FRENZY_SUB, fill: PAL.yel, burst: PAL.red });
    const stMore = renderSticker(T_MORE, { size: 30, fill: PAL.white, shadow: PAL.cob });
    const stGold = renderSticker(T_GOLD, { size: 30, fill: PAL.yel, shadow: PAL.org });
    const stBored = renderChip(T_BORED, 22, PAL.white, PAL.ink);
    const stBig = BIG_LINES.map((t, i) => renderSticker(t, { size: 32, fill: i % 2 === 0 ? PAL.yel : PAL.white, burst: i % 3 === 0 ? PAL.pink : PAL.cob, shadow: PAL.red }));
    const stNum = new Map<number, Sticker>();
    for (const n of NUMBERS) stNum.set(n, renderSticker(`+${n}`, { size: n >= 5 ? 30 : 24, fill: n >= 10 ? PAL.yel : PAL.white, shadow: n >= 5 ? PAL.red : PAL.cob, skew: 0.1 }));
    const stMinus = renderSticker('-1', { size: 22, fill: PAL.white, shadow: PAL.ink });
    const stGauge = renderChip(T_GAUGE, 14, PAL.yel, PAL.ink);
    const stMult = [renderChip('פי 1', 16, PAL.white, PAL.ink), renderChip('פי 2', 16, PAL.pink, PAL.ink), renderChip('פי 3', 16, PAL.red, PAL.white)];

    // Round time already gone when we start (slow load / late join), snapped to whole steps.
    let startOffset = clamp(Math.round((ctx.durationMs - ctx.timeLeftMs()) / STEP_MS) * STEP_MS, 0, ctx.durationMs);
    const firstOffset = startOffset;
    let elapsed = startOffset;
    let destroyed = false;
    let lastScore = -1;

    // ── animation state (all advanced in update = game time) ──
    let dm = 0; // displayed meter
    let jab = 0; // hand jab (0..1, eases back)
    let jabV = 0;
    let squash = 0;
    let squashV = 0;
    let twist = 0;
    let twistV = 0;
    let digAnim = 0;
    let digSign = 1;
    let enterT = 99; // s since the finger went in
    let outT = 99; // s since it came out
    let handFromOut = 0;
    let bigT = 99; // s since the BIG booger started
    let popT = 99; // s since it popped
    let reactFace: number = FACE.Normal;
    let reactT = 0;
    let sessionBigs = 0;
    let multFlash = 0;
    let frenzyAge = 99;
    let tutorialAlpha = 1;
    let boredIdx = 0;
    let boredT = 0;
    let lastSfxStep = -1;
    let lastSplatStep = -1;
    let calloutS: Sticker | null = null;
    let calloutT = 99;
    let calloutLife = 1;
    let calloutY = 0;

    const goos: Goo[] = [];
    for (let i = 0; i < GOO_POOL; i++) goos.push({ live: false, kind: BOOGER.Round, stage: 0, t: 0, x0: 0, y0: 0, x: 0, y: 0, tx: 0, ty: 0, size: 0, rot: 0, vrot: 0, vy: 0, stretch: 1, born: 0 });
    let gooSerial = 0;
    const floaters: Floater[] = [];
    for (let i = 0; i < 18; i++) floaters.push({ live: false, s: null, x: 0, y: 0, t: 0, life: 0.7 });
    let floaterNext = 0;
    const ripples: Ripple[] = [];
    for (let i = 0; i < 12; i++) ripples.push({ live: false, x: 0, y: 0, t: 0, hit: false });
    let rippleNext = 0;

    // ── geometry ──
    const geo = { w: 0, h: 0, top: 0, trayTop: 0, S: 0, hx: 0, hy: 0, hitX: 0, hitY: 0, hitR: 0, noseX: 0, noseY: 0, restX: 0, restY: 0 };
    function computeGeo(): void {
      const w = view.width;
      const h = view.height;
      const top = ctx.hudHeight + 6;
      const trayTop = Math.max(top + 140, h - ctx.safeBottom - TRAY_H);
      // the head image (a square, chin at its bottom) sits on the tray, chin just behind its edge
      const S = clamp(Math.min((w - SIDE_PAD * 2) * 1.25, (trayTop - top) / 0.94, 620), 150, 620);
      const hx = w / 2 - S / 2;
      const hy = trayTop + 0.06 * S - S;
      geo.w = w;
      geo.h = h;
      geo.top = top;
      geo.trayTop = trayTop;
      geo.S = S;
      geo.hx = hx;
      geo.hy = hy;
      geo.hitX = hx + FRAME.hitX * S;
      geo.hitY = Math.max(top + FRAME.hitR * S * 0.8, hy + FRAME.hitY * S);
      geo.hitR = FRAME.hitR * S;
      geo.noseX = hx + FRAME.nostrilX * S;
      geo.noseY = hy + FRAME.nostrilY * S;
      geo.restX = hx + 0.6 * S;
      geo.restY = trayTop - 0.14 * S;
    }

    // ── the pile (boogers merged at the bottom of the glass), painted incrementally ──
    const PILE_COLS = 28;
    const pileH: number[] = new Array<number>(PILE_COLS).fill(0);
    const stamps: Stamp[] = [];
    let pileCanvas: HTMLCanvasElement | null = null;
    let pileCtx: CanvasRenderingContext2D | null = null;
    let pileKey = '';
    let pileTotal = 0;
    function pileMax(): number {
      return geo.S * 0.12;
    }
    function ensurePile(): void {
      const k = `${geo.w}x${Math.round(geo.S)}@${view.dpr}`;
      if (k === pileKey && pileCanvas) return;
      pileKey = k;
      if (pileCanvas) {
        pileCanvas.width = 0;
        pileCanvas.height = 0;
      }
      const layer = makeLayer(geo.w, pileMax() * 1.8, view.dpr);
      pileCanvas = layer.canvas;
      pileCtx = layer.ctx;
      for (const s of stamps) paintStamp(s);
    }
    function paintStamp(s: Stamp): void {
      const c = pileCtx;
      const d = art.boogers[s.kind];
      if (!c || !d) return;
      const H = pileMax() * 1.8;
      const size = geo.S * s.k;
      const x = s.u * geo.w;
      const y = H - s.lift * geo.S - size * 0.28;
      // slime underneath, so the old ones melt into one silhouette
      c.fillStyle = s.kind === BOOGER.Golden ? '#d9a514' : '#6fbf2a';
      c.beginPath();
      c.ellipse(x, y + size * 0.2, size * 0.62, size * 0.32, 0, 0, Math.PI * 2);
      c.fill();
      const dw = s.kind === BOOGER.Stretchy ? size * 0.36 : size;
      const dh = s.kind === BOOGER.Stretchy ? size * 0.95 : (size * d.height) / d.width;
      d.draw(c, x, y, dw, dh, s.rot);
    }
    function mergeIntoPile(gd: Goo): void {
      const col = clamp(Math.floor((gd.x / Math.max(1, geo.w)) * PILE_COLS), 0, PILE_COLS - 1);
      const h0 = pileH[col] ?? 0;
      const k = (gd.size / geo.S) * (gd.kind === BOOGER.Boss ? 0.55 : 1);
      const s: Stamp = { u: gd.x / Math.max(1, geo.w), lift: Math.min(h0, PILE_LIFT_MAX), kind: gd.kind, k: k * 0.85, rot: gd.rot };
      for (let c = col - 1; c <= col + 1; c++) {
        if (c < 0 || c >= PILE_COLS) continue;
        pileH[c] = Math.min(PILE_LIFT_MAX, (pileH[c] ?? 0) + k * (c === col ? 0.12 : 0.05));
      }
      stamps.push(s);
      if (stamps.length > PILE_STAMPS) stamps.shift();
      pileTotal++;
      ensurePile();
      paintStamp(s);
      gd.live = false;
    }
    function pileTopAt(x: number): number {
      const col = clamp(Math.floor((x / Math.max(1, geo.w)) * PILE_COLS), 0, PILE_COLS - 1);
      return geo.trayTop + 8 - (pileH[col] ?? 0) * geo.S;
    }

    // ── tray (static part painted once per size) ──
    let trayCanvas: HTMLCanvasElement | null = null;
    let trayKey = '';
    function trayLayer(): HTMLCanvasElement {
      const th = geo.h - geo.trayTop;
      const k = `${geo.w}x${Math.round(th)}`;
      if (!trayCanvas || k !== trayKey) {
        if (trayCanvas) {
          trayCanvas.width = 0;
          trayCanvas.height = 0;
        }
        trayKey = k;
        trayCanvas = paintTray(geo.w, th);
      }
      return trayCanvas;
    }

    // ── boogers on the glass ──
    function throwBooger(kind: BoogerKind, index: number, fromX: number, fromY: number, big: boolean): void {
      let gd: Goo | null = null;
      for (const c of goos) {
        if (!c.live) {
          gd = c;
          break;
        }
      }
      if (!gd) {
        // pool full: the oldest one on the glass melts into the pile
        let old: Goo | null = null;
        for (const c of goos) if (c.stage === 1 && (!old || c.born < old.born)) old = c;
        if (!old) return;
        mergeIntoPile(old);
        gd = old;
      }
      const tr = boogerTraits(ctx.seed, index);
      const w = geo.w;
      const size = big ? geo.S * 0.36 : geo.S * (0.085 + tr.size * 0.05) * (kind === BOOGER.Hairy ? 1.1 : kind === BOOGER.Golden ? 1.15 : 1);
      gd.live = true;
      gd.kind = kind;
      gd.stage = 0;
      gd.t = 0;
      gd.x0 = fromX;
      gd.y0 = fromY;
      gd.x = fromX;
      gd.y = fromY;
      let tx = big ? w / 2 : SIDE_PAD + size * 0.4 + tr.u * Math.max(1, w - 2 * SIDE_PAD - size * 0.8);
      const ty = big ? geo.top + (geo.trayTop - geo.top) * 0.3 : geo.top + size * 0.5 + tr.v * Math.max(1, (geo.trayTop - geo.top) * 0.72 - size);
      if (!big) {
        // keep the eyes and the nose clear: a booger that would land there goes to the side
        const fx0 = geo.hx + 0.5 * geo.S;
        const fy0 = geo.hy + 0.6 * geo.S;
        const rx = 0.22 * geo.S + size * 0.4;
        const ry = 0.2 * geo.S + size * 0.4;
        const ux = (tx - fx0) / rx;
        const uy = (ty - fy0) / ry;
        if (ux * ux + uy * uy < 1) {
          const side = tr.u < 0.5 ? -1 : 1;
          tx = clamp(fx0 + side * rx * Math.sqrt(Math.max(0, 1 - uy * uy)), SIDE_PAD + size * 0.4, w - SIDE_PAD - size * 0.4);
        }
      }
      gd.tx = tx;
      gd.ty = ty;
      gd.size = size;
      // the stretchy one hangs (it is a strand), the others tumble in flight
      const hangs = kind === BOOGER.Stretchy;
      gd.rot = hangs ? (tr.spin - 0.5) * 0.3 : (tr.spin - 0.5) * 0.8;
      gd.vrot = hangs ? 0 : (tr.spin - 0.5) * 14;
      gd.vy = (28 + tr.slide * 40) * (big ? 0.45 : 1);
      gd.stretch = 1;
      gd.born = gooSerial++;
    }

    function updateGoos(dt: number): void {
      for (const gd of goos) {
        if (!gd.live) continue;
        gd.t += dt;
        if (gd.stage === 0) {
          const k = Math.min(1, gd.t / FLY_S);
          const e = ease.outQuad(k);
          gd.x = lerp(gd.x0, gd.tx, e);
          gd.y = lerp(gd.y0, gd.ty, e) - Math.sin(Math.PI * k) * geo.S * 0.12;
          gd.rot += gd.vrot * dt;
          if (k >= 1) {
            gd.stage = 1;
            gd.t = 0;
            gd.x = gd.tx;
            gd.y = gd.ty;
            if (loop.steps - lastSplatStep >= 4) {
              lastSplatStep = loop.steps;
              sfx.splat(0.8 + (gd.born % 5) * 0.08);
            }
          }
          continue;
        }
        // on the glass: a moment of grip, then a slow slide that speeds up a little
        if (gd.t > 0.3) gd.y += gd.vy * (1 + (gd.t - 0.3) * 0.5) * dt;
        if (gd.kind === BOOGER.Stretchy) {
          gd.stretch = Math.min(1.7, gd.stretch + dt * 0.4);
          if (gd.stretch >= 1.7) gd.stretch = 0.75; // snap!
        }
        if (gd.y + gd.size * 0.3 >= pileTopAt(gd.x)) mergeIntoPile(gd);
      }
    }

    function gooCount(): number {
      let n = 0;
      for (const gd of goos) if (gd.live) n++;
      return n;
    }

    // ── small floating numbers and callouts ──
    function floatNum(n: number, x: number, y: number): void {
      const s = n < 0 ? stMinus : (stNum.get(n) ?? stNum.get(5) ?? null);
      const f = floaters[floaterNext];
      floaterNext = (floaterNext + 1) % floaters.length;
      if (!f || !s) return;
      f.live = true;
      f.s = s;
      f.x = x;
      f.y = y;
      f.t = 0;
      f.life = n >= 10 ? 1.1 : 0.65;
    }
    function callout(s: Sticker, life: number, y?: number): void {
      calloutS = s;
      calloutT = 0;
      calloutLife = life;
      calloutY = y ?? geo.top + s.h * 0.55 + 6;
    }
    function ripple(x: number, y: number, hit: boolean): void {
      const r = ripples[rippleNext];
      rippleNext = (rippleNext + 1) % ripples.length;
      if (!r) return;
      r.live = true;
      r.x = x;
      r.y = y;
      r.t = 0;
      r.hit = hit;
    }

    // ── sounds (kit synth; silent until unlocked, never throws) ──
    function oncePerStep(): boolean {
      if (loop.steps === lastSfxStep) return false;
      lastSfxStep = loop.steps;
      return true;
    }
    function squelch(i: number): void {
      noise({ dur: 0.13, vol: 0.22, filter: { type: 'bandpass', freq: 760 + (i % 5) * 70, to: 170, q: 3.2 } });
      tone({ freq: 150 + (i % 4) * 18, to: 70, dur: 0.11, type: 'sine', vol: 0.24 });
    }
    function slurpIn(): void {
      noise({ dur: 0.22, vol: 0.2, filter: { type: 'bandpass', freq: 300, to: 1400, q: 2.5 } });
      tone({ freq: 220, to: 620, dur: 0.22, type: 'square', vol: 0.07, lowpass: 1200 });
      tone({ freq: 990, dur: 0.1, type: 'triangle', vol: 0.12, at: 0.2 });
    }
    function plopOut(): void {
      tone({ freq: 640, to: 160, dur: 0.28, type: 'sine', vol: 0.18 });
      noise({ dur: 0.06, vol: 0.2, at: 0.02, filter: { type: 'highpass', freq: 1600 } });
    }
    function stretchSound(): void {
      tone({ freq: 160, to: 560, dur: PICK.BIG_MS / 1000, type: 'sawtooth', vol: 0.08, lowpass: 900, vibrato: { depth: 14, rate: 9 } });
    }
    function bigPopSound(): void {
      tone({ freq: 260, to: 1100, dur: 0.09, type: 'sine', vol: 0.34 });
      noise({ dur: 0.1, vol: 0.3, filter: { type: 'highpass', freq: 1400 } });
      sfx.splat(0.6);
      sfx.laugh(1.1);
    }

    // ── engine and its events ──
    const engine = createPickEngine(level, MAX_RAW, {
      hit(points: number): void {
        jabV += 9;
        squashV += 3.2;
        twistV += digSign * 1.5;
        digSign = -digSign;
        const tip = handTip();
        floatNum(points, tip.x + geo.S * 0.06, tip.y - geo.S * 0.04);
        if (oncePerStep()) {
          tone({ freq: 300 + dm * 520, to: 420 + dm * 700, dur: 0.06, type: 'triangle', vol: 0.15 });
          haptic.tap();
        }
      },
      dig(index: number, kind: BoogerKind, points: number): void {
        digAnim = 1;
        twistV += digSign * 7;
        digSign = -digSign;
        squashV += 4;
        throwBooger(kind, index, geo.noseX, geo.noseY, false);
        if (engine.state.frenzy) throwBooger(kind === BOOGER.Golden ? BOOGER.Round : kind, index + 7919, geo.noseX, geo.noseY, false);
        floatNum(points, geo.noseX + (digSign > 0 ? 1 : -1) * geo.S * 0.3, geo.noseY + geo.S * 0.06);
        if (kind === BOOGER.Golden) {
          callout(stGold, 0.8, geo.hy + geo.S * 0.25);
          fx.burst(geo.noseX, geo.noseY, { count: 10, speed: 320, size: 5, life: 0.5, gravity: 400, shape: 'star', colors: [PAL.yel, PAL.white, PAL.org] });
        }
        if (oncePerStep()) {
          squelch(index);
          haptic.tap();
        }
      },
      pull(): void {
        twistV += digSign * 3;
        digSign = -digSign;
        squashV += 2;
        if (oncePerStep()) tone({ freq: 300 + (bigT / (PICK.BIG_MS / 1000)) * 500, dur: 0.05, type: 'square', vol: 0.06, lowpass: 1500 });
      },
      miss(cost: number): void {
        if (cost > 0) floatNum(-1, geo.w / 2, geo.trayTop - 20);
        sfx.tap(0.55);
      },
      bounce(): void {
        squashV += 1;
      },
      enter(): void {
        enterT = 0;
        sessionBigs = 0;
        squashV -= 6;
        fx.shake(5, 220);
        fx.burst(geo.noseX, geo.noseY, { count: 18, speed: 380, size: 6, life: 0.6, gravity: 300, shape: 'star', colors: [PAL.yel, PAL.white, '#86d93a'] });
        if (engine.state.picks === 1 || engine.state.picks % 3 === 0) callout(stPick, 1.2);
        slurpIn();
        haptic.bump();
      },
      exit(): void {
        outT = 0;
        handFromOut = 1;
        reactFace = sessionBigs > 0 ? FACE.Proud : (engine.state.picks % 2 === 0 ? FACE.Tongue : FACE.Wink);
        reactT = 1.1;
        // the booger on the finger gets flicked at the glass
        throwBooger(BOOGER.Round, 100_000 + engine.state.picks, geo.hx + FRAME.outTipX * geo.S, geo.hy + FRAME.outTipY * geo.S, false);
        callout(stMore, 0.9, geo.hy + geo.S * 0.2);
        plopOut();
      },
      bigStart(): void {
        bigT = 0;
        sessionBigs++;
        fx.shake(4, 900);
        stretchSound();
        haptic.bump();
      },
      bigPop(index: number): void {
        popT = 0;
        throwBooger(BOOGER.Boss, 200_000 + index, geo.hx + FRAME.bigTipX * geo.S, geo.hy + FRAME.bigTipY * geo.S, true);
        const line = stBig[(index * 3 + ctx.seed) % stBig.length] ?? stBig[0];
        if (line) callout(line, 1.5, geo.top + (geo.trayTop - geo.top) * 0.2);
        floatNum(25, geo.w / 2, geo.top + (geo.trayTop - geo.top) * 0.42);
        fx.confetti({ x: geo.w / 2, y: geo.noseY, count: 40 });
        fx.shake(10, 380);
        bigPopSound();
        haptic.heavy();
      },
      mult(m: number): void {
        multFlash = 1;
        if (m >= 3) sfx.success();
      },
      comboBreak(): void {
        tone({ freq: 420, to: 160, dur: 0.3, type: 'sawtooth', vol: 0.08, lowpass: 1400 });
      },
      frenzy(): void {
        frenzyAge = 0;
        callout(stFrenzy, 1.8);
        fx.shake(9, 450);
        sfx.go();
        haptic.bump();
      },
    });

    // ── which head frame, and where the rising hand is ──
    const tipOut = { x: 0, y: 0 };
    function handTip(): { x: number; y: number } {
      const k = ease.inOutQuad(clamp(dm, 0, 1));
      let x = lerp(geo.restX, geo.noseX + geo.S * 0.005, k);
      let y = lerp(geo.restY, geo.noseY + geo.S * 0.02, k) - jab * geo.S * 0.07;
      if (handFromOut > 0) {
        x = lerp(x, geo.hx + FRAME.outTipX * geo.S, handFromOut);
        y = lerp(y, geo.hy + FRAME.outTipY * geo.S, handFromOut);
      }
      tipOut.x = x;
      tipOut.y = y;
      return tipOut;
    }

    /** -1 = a reaction face (faceIdx), else a picking frame (PICKF). */
    let pickFrame = -1;
    let faceIdx: number = FACE.Normal;
    function chooseFrame(): void {
      const s = engine.state;
      if (s.picking) {
        if (s.bigLeftMs > 0) pickFrame = PICKF.Big;
        else if (enterT < 0.12) pickFrame = PICKF.Enter;
        else pickFrame = digAnim > 0.45 ? PICKF.Deep : PICKF.Knuckle;
        return;
      }
      if (outT < OUT_FRAME_S) {
        pickFrame = PICKF.Out;
        return;
      }
      pickFrame = -1;
      if (reactT > 0) faceIdx = reactFace;
      else if (s.lastTapMs < 0 ? elapsed - firstOffset > BORED_AFTER_MS + 2000 : elapsed - s.lastTapMs > BORED_AFTER_MS) faceIdx = IDLE_FACES[level.idleFaces[boredIdx % level.idleFaces.length] ?? 0] ?? FACE.Bored;
      else if (dm > 0.8) faceIdx = FACE.Surprised;
      else if (dm > 0.45) faceIdx = FACE.Angry;
      else faceIdx = s.frenzy ? FACE.Happy : FACE.Normal;
    }

    // ── input: stamp with the round time, the engine applies it at its step ──
    input.onDown((p) => {
      if (destroyed || p.y < ctx.hudHeight) return;
      computeGeo();
      const dx = p.x - geo.hitX;
      const dy = p.y - geo.hitY;
      const onFace = dx * dx + dy * dy <= geo.hitR * geo.hitR;
      engine.tap(ctx.durationMs - ctx.timeLeftMs(), onFace);
      ripple(p.x, p.y, onFace);
    });

    // ── loop ──
    const trace = Array.isArray(window.__tapTrace) ? window.__tapTrace : null;
    const loop = createLoop({
      update(dt: number): void {
        // Behind the round clock (the page slept: locked phone, another app, very long frames)?
        // Catch up so the round stays in step with everyone else's; the skipped part is lost.
        const roundElapsed = ctx.durationMs - ctx.timeLeftMs();
        if (roundElapsed - (startOffset + loop.timeMs) > RESYNC_MS) {
          startOffset = Math.round((roundElapsed - loop.timeMs) / STEP_MS) * STEP_MS;
        }
        elapsed = startOffset + loop.timeMs;
        computeGeo();
        engine.step(elapsed, roundElapsed - elapsed > FLUSH_LAG_MS);
        const s = engine.state;
        if (s.score !== lastScore) {
          lastScore = s.score;
          ctx.setScore(s.score);
        }

        // springs and timers
        dm += (s.meter - dm) * Math.min(1, dt * 11);
        jabV += (-260 * jab - 18 * jabV) * dt;
        jab = clamp(jab + jabV * dt, -0.3, 1.2);
        squashV += (-320 * squash - 16 * squashV) * dt;
        squash += squashV * dt;
        twistV += (-300 * twist - 15 * twistV) * dt;
        twist += twistV * dt;
        digAnim = Math.max(0, digAnim - dt / 0.14);
        enterT += dt;
        outT += dt;
        handFromOut = outT < OUT_FRAME_S ? 1 : Math.max(0, handFromOut - dt / 0.25);
        if (s.bigLeftMs > 0) bigT += dt;
        else bigT = 99;
        popT += dt;
        reactT = Math.max(0, reactT - dt);
        multFlash = Math.max(0, multFlash - dt * 1.6);
        frenzyAge += dt;
        calloutT += dt;
        boredT += dt;
        if (boredT > 1.6) {
          boredT = 0;
          boredIdx++;
        }
        const tutorialOn = elapsed - firstOffset < TUTORIAL_MS && s.hits < 4;
        tutorialAlpha = tutorialOn ? Math.min(1, tutorialAlpha + dt * 4) : Math.max(0, tutorialAlpha - dt * 3);
        for (const f of floaters) {
          if (!f.live) continue;
          f.t += dt;
          if (f.t >= f.life) f.live = false;
        }
        for (const r of ripples) {
          if (!r.live) continue;
          r.t += dt;
          if (r.t > 0.4) r.live = false;
        }
        updateGoos(dt);
        fx.update(dt);
        chooseFrame();

        const roundStep = Math.round(elapsed / STEP_MS);
        if (trace && roundStep % 30 === 0 && trace.length < 400) {
          trace.push(`${roundStep}|${s.phase}|${s.rate.toFixed(3)}|${s.digs}|${s.bigBoogers}|${s.score}|${s.combo}`);
        }
      },
      render(): void {
        computeGeo();
        draw();
      },
    });

    // ── drawing ──
    function headFrame(): Drawable | undefined {
      return pickFrame >= 0 ? art.pick[pickFrame] : art.faces[faceIdx];
    }

    function draw(): void {
      const g = view.ctx;
      const { w, h, S, hx, hy } = geo;
      const t = loop.timeMs / 1000;
      const s = engine.state;
      backdrop.draw(g, w, h, view.dpr, w / 2, hy + S * 0.5);

      if (s.frenzy) {
        const k = 0.5 + 0.5 * Math.sin(t * (ctx.timeLeftMs() < 5_000 ? 14 : 7));
        g.globalAlpha = 0.5 + 0.4 * k;
        g.strokeStyle = PAL.red;
        g.lineWidth = 10 + 8 * k;
        g.strokeRect(0, 0, w, h);
        g.globalAlpha = 1;
      }

      g.save();
      fx.applyShake(g);

      // the head: squash and stretch on the chin, a twist around the nostril per dig
      const frame = headFrame();
      if (frame) {
        const sq = clamp(squash * 0.05, -0.12, 0.12);
        const sway = s.frenzy ? Math.sin(t * 9) * S * 0.012 : 0;
        const nx = geo.noseX + sway;
        const ny = geo.noseY;
        g.save();
        g.translate(nx, hy + S);
        g.scale(1 + sq, 1 - sq);
        g.translate(0, ny - (hy + S));
        g.rotate(clamp(twist * 0.012, -0.08, 0.08));
        g.scale(1 - digAnim * 0.025, 1 + digAnim * 0.05); // the nose stretches with every dig
        g.translate(-nx, -ny);
        frame.draw(g, hx + S / 2 + sway, hy + S / 2, S, S);
        g.restore();
      }

      // the BIG booger growing on the end of the strand
      if (pickFrame === PICKF.Big) {
        const boss = art.boogers[BOOGER.Boss];
        if (boss) {
          const k = clamp(bigT / (PICK.BIG_MS / 1000), 0, 1);
          const sz = S * (0.1 + 0.22 * ease.outCubic(k)) * (1 + Math.sin(t * 30) * 0.04);
          boss.draw(g, hx + FRAME.bigTipX * S, hy + FRAME.bigTipY * S - sz * 0.15, sz, sz, Math.sin(t * 17) * 0.12);
        }
      }

      // the rising hand (when the frame does not show the doll's own hand)
      if (pickFrame < 0) {
        const tip = handTip();
        const hw = S * 0.23;
        const hh = (hw * HAND.h) / HAND.w;
        const rot = -0.12 + jab * 0.05;
        const cx = tip.x + (0.5 - HAND.tipX) * hw;
        const cy = tip.y + hh / 2;
        art.hand.draw(g, cx, cy, hw, hh, rot);
        if (handFromOut > 0) {
          const b = art.boogers[BOOGER.Round];
          if (b) b.draw(g, tip.x, tip.y, S * 0.05 * handFromOut, S * 0.05 * handFromOut);
        }
      }

      // tray (in front of the chin and the forearm)
      const tray = trayLayer();
      g.drawImage(tray, 0, geo.trayTop, w, h - geo.trayTop);
      g.restore();

      drawGlass(g);
      drawTrayUi(g, t);
      fx.draw(g);
      drawFloaters(g);
      drawRipples(g);
      if (calloutS && calloutT < calloutLife) drawCallout(g, t);
      if (tutorialAlpha > 0) drawTutorial(g, t);
      else if (pickFrame < 0 && faceIdx === FACE.Bored && reactT <= 0) blit(g, stBored, geo.hx + S * 0.82, geo.hy + S * 0.3, 1 + Math.sin(t * 5) * 0.05);
    }

    function drawGlass(g: CanvasRenderingContext2D): void {
      // the pile
      if (pileCanvas && stamps.length > 0) {
        const H = pileMax() * 1.8;
        g.drawImage(pileCanvas, 0, geo.trayTop + 8 - H, geo.w, H);
      }
      // short slime trails behind the sliding ones (one path)
      g.strokeStyle = 'rgba(111, 191, 42, 0.55)';
      g.lineCap = 'round';
      g.lineWidth = Math.max(3, geo.S * 0.018);
      g.beginPath();
      for (const gd of goos) {
        if (!gd.live || gd.stage !== 1 || gd.y - gd.ty < 3) continue;
        g.moveTo(gd.x, Math.max(gd.ty, gd.y - gd.size * 1.3));
        g.lineTo(gd.x, gd.y);
      }
      g.stroke();
      for (const gd of goos) {
        if (!gd.live) continue;
        const d = art.boogers[gd.kind];
        if (!d) continue;
        let w = gd.size;
        let hgt = (gd.size * d.height) / d.width;
        if (gd.kind === BOOGER.Stretchy) {
          w = gd.size * 0.36;
          hgt = gd.size * 0.95 * gd.stretch;
        }
        if (gd.stage === 0) {
          // flying at the camera: small -> full size
          const k = 0.25 + 0.75 * ease.inQuad(Math.min(1, gd.t / FLY_S));
          d.draw(g, gd.x, gd.y, w * k, hgt * k, gd.rot);
        } else {
          // splat on the glass: wide and flat for a moment
          const sp = gd.t < 0.16 ? 1 - gd.t / 0.16 : 0;
          d.draw(g, gd.x, gd.y + (hgt * (gd.stretch - 1)) / 2, w * (1 + sp * 0.35), hgt * (1 - sp * 0.25), gd.rot);
        }
      }
    }

    function drawTrayUi(g: CanvasRenderingContext2D, t: number): void {
      const s = engine.state;
      const y = geo.trayTop + 18 + (geo.h - ctx.safeBottom - geo.trayTop - 18) / 2;
      const barH = 22;
      const chip = stMult[Math.max(0, Math.min(2, s.mult - 1))] ?? stMult[0];
      const chipW = chip ? chip.w : 50;
      const left = 12 + chipW + 10;
      const right = geo.w - 12 - stGauge.w - 8;
      const barW = Math.max(40, right - left);
      // gauge (fills right to left, Hebrew reading order)
      g.fillStyle = PAL.ink;
      g.fillRect(left + 3, y - barH / 2 + 3, barW, barH);
      g.fillStyle = PAL.white;
      g.fillRect(left, y - barH / 2, barW, barH);
      const fill = s.picking ? 1 : clamp(dm, 0, 1);
      const hot = s.picking && Math.sin(t * 22) > 0;
      g.fillStyle = s.picking ? (hot ? PAL.red : PAL.yel) : dm > 0.8 ? PAL.org : PAL.yel;
      g.fillRect(left + barW * (1 - fill), y - barH / 2, barW * fill, barH);
      g.lineWidth = 3;
      g.strokeStyle = PAL.ink;
      g.strokeRect(left, y - barH / 2, barW, barH);
      // the nose mark at the far end
      g.fillStyle = PAL.ink;
      g.fillRect(left + 2, y - barH / 2, 3, barH);
      blit(g, stGauge, geo.w - 12 - stGauge.w / 2, y);
      if (chip) blit(g, chip, 12 + chip.w / 2, y, 1 + multFlash * 0.4);
    }

    function drawFloaters(g: CanvasRenderingContext2D): void {
      for (const f of floaters) {
        if (!f.live || !f.s) continue;
        const k = f.t / f.life;
        const pop = k < 0.2 ? ease.outBack(k / 0.2) : 1;
        g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        blit(g, f.s, f.x, Math.max(geo.top + 14, f.y - k * 46), 0.85 * pop);
      }
      g.globalAlpha = 1;
    }

    function drawRipples(g: CanvasRenderingContext2D): void {
      g.lineWidth = 3;
      for (const r of ripples) {
        if (!r.live) continue;
        const k = r.t / 0.4;
        g.globalAlpha = 1 - k;
        g.strokeStyle = r.hit ? PAL.white : PAL.red;
        g.beginPath();
        g.arc(r.x, r.y, 8 + k * (r.hit ? 36 : 22), 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    function drawCallout(g: CanvasRenderingContext2D, t: number): void {
      const s = calloutS;
      if (!s) return;
      const k = calloutT / calloutLife;
      const inK = clamp(calloutT / 0.25, 0, 1);
      const sc = ease.outBack(inK) * (1 + Math.sin(t * 14) * 0.03);
      const maxW = geo.w * 0.86;
      const fit = Math.min(1, maxW / s.w);
      g.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      blit(g, s, geo.w / 2, Math.max(geo.top + (s.h * fit) / 2, calloutY), sc * fit);
      g.globalAlpha = 1;
    }

    function drawTutorial(g: CanvasRenderingContext2D, t: number): void {
      const { S } = geo;
      // a ghost finger tapping fast on the cheek
      const cycle = (t % 0.2) / 0.2;
      const press = cycle < 0.4 ? ease.inQuad(cycle / 0.4) : 1 - ease.outQuad((cycle - 0.4) / 0.6);
      const px = geo.hx + S * 0.33;
      const py = geo.hy + S * 0.72;
      g.save();
      g.globalAlpha = tutorialAlpha * 0.75;
      const gw = Math.max(64, S * 0.24);
      const gh = (gw * art.ghost.height) / art.ghost.width;
      // fingertip (0.5w, 0.04h of the ghost) on the press point, coming down from below-right
      const lift = (1 - press) * S * 0.07;
      art.ghost.draw(g, px + lift * 0.4, py + lift + gh * 0.46, gw, gh, -0.35);
      if (cycle < 0.5) {
        g.globalAlpha = tutorialAlpha * (1 - cycle * 2);
        g.strokeStyle = PAL.white;
        g.lineWidth = 5;
        g.beginPath();
        g.arc(px, py, 10 + cycle * 60, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = tutorialAlpha;
      const fit = Math.min(1, (geo.w - 12) / stHint.w);
      blit(g, stHint, geo.w / 2, geo.top + (stHint.h * fit) / 2 + 4, fit * (1 + Math.sin(t * 8) * 0.03));
      g.restore();
    }

    const placeholders = [...art.faces, ...art.pick, art.hand, ...art.boogers].filter((d) => d.isPlaceholder).map((d) => d.key);
    debugSource = (): TapDebugState => {
      const s = engine.state;
      return {
        fingerprint: level.fingerprint,
        elapsedMs: elapsed,
        x: geo.hitX,
        y: geo.hitY,
        r: geo.hitR,
        meter: s.meter,
        phase: s.phase,
        picking: s.picking,
        digs: s.digs,
        bigBoogers: s.bigBoogers,
        bigActive: s.bigLeftMs > 0,
        picks: s.picks,
        pickingMs: s.pickingMs,
        combo: s.combo,
        mult: s.mult,
        score: s.score,
        hits: s.hits,
        misses: s.misses,
        bounces: s.bounces,
        frenzy: s.frenzy,
        frame: pickFrame >= 0 ? (PICK_NAMES[pickFrame] ?? '') : (FACE_NAMES[faceIdx] ?? ''),
        handY: pickFrame < 0 ? handTip().y : null,
        glass: gooCount(),
        pile: pileTotal,
        queued: engine.queued,
        hudTop: ctx.hudHeight,
        trayTop: geo.trayTop,
        placeholders,
      };
    };
    window.__tap = tapDebug;

    computeGeo();
    loop.start();

    return {
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        loop.stop();
        input.dispose();
        fx.clear();
        view.dispose();
        backdrop.dispose();
        for (const c of [pileCanvas, trayCanvas]) {
          if (c) {
            c.width = 0;
            c.height = 0;
          }
        }
        pileCanvas = null;
        pileCtx = null;
        trayCanvas = null;
        debugSource = null;
      },
    };
  },
};
