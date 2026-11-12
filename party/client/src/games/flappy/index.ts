/**
 * פלאפי תבורי: last one standing. Tap to fly through the microphone stands; one life.
 *
 * - The flight is locked to the ROUND CLOCK (course.ts): the distance flown is a pure
 *   function of round time, so every phone is at the same point of the same course at the
 *   same moment, whatever its frame rate. A cutscene freeze stops the clock, so it stops
 *   the flight exactly where it is.
 * - The raw score is survival: the distance flown in tenths of a unit. A crash sends the
 *   final at once (ctx.finish()) and this phone watches the rest of the round.
 * - The finale ("only 3 left"): the stage tells when it begins (ctx.finaleInMs); from then on
 *   the course hardens as a pure function of (seed, time since it began).
 * - A reload / a stall longer than REJOIN_AFTER_MS: the bird is put back at the live point
 *   of the course, in the middle of the next gap, hanging and untouchable for
 *   PHYS.rejoinGraceMs or until the first tap (shorter than the time between two obstacles).
 *   A phone that was already out comes back out (ctx.field().outRaw): never a second life.
 */
import { paintDrawable, starPainter } from '../../kit/assets';
import { noise, sfx, tone } from '../../kit/audio';
import { createGameCanvas } from '../../kit/canvas';
import { clamp, createFx, ease, lerp } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createInput } from '../../kit/input';
import { createLoop } from '../../kit/loop';
import { GAMES } from '../../../../shared/protocol';
import { loadFlappyArt, SLOT_SIZES } from './art';
import { pilotFlap } from './bot';
import { createFlight, FIELD, finaleDifficulty, newBird, PASS_BEHIND, PHYS, STEP_MS, STEP_S, stepBird, survivalRaw } from './course';
import { blit, createStickerCache, loadDisplayFont, PAL, renderChip, renderSticker } from './look';
import { createSimField } from './sim-field';
import { createSpectator, finaleText } from './spectator';

import type { FieldPlayer, GameContext, GameInstance, GameModule } from '../types';
import type { Obstacle } from './course';
import type { HeadSprite } from './head';
import type { Sticker } from './look';
import type { SimField } from './sim-field';
import type { SpectatorState } from './spectator';

/** 'fly': in the air. 'dead': the crash (a moment). 'out': watching the rest of the round. */
type Mode = 'fly' | 'dead' | 'out';

interface FlappyDebug {
  readonly mode: Mode;
  /** Obstacles passed. */
  readonly run: number;
  /** Raw score (survival distance in tenths of a unit). */
  readonly raw: number;
  readonly birdY: number;
  readonly vy: number;
  readonly dist: number;
  /** Fixed steps of round time simulated, and the step the round clock is at. */
  readonly steps: number;
  readonly clockStep: number;
  /** Next obstacle not yet passed. */
  readonly next: { readonly x: number; readonly gapY: number; readonly gap: number };
  /** First n obstacles of the course (for determinism checks). */
  course(n: number): Array<{ x: number; gapY: number; gap: number }>;
  /** Distance after `step` steps of round time (pure). */
  distAt(step: number): number;
  readonly phys: typeof PHYS;
  readonly speed: number;
  /** Screen mapping: px per field unit, bird x in px, units visible ahead of the bird. */
  readonly layout: { U: number; birdX: number; W: number; top: number; groundTop: number; ahead: number };
  /** Start (n > 0) or stop (0) recording [step, mode, birdY, vy, dist, run] per fixed step. */
  trace(n: number): void;
  readonly traced: ReadonlyArray<readonly (number | string)[]>;
  /** Which art slots use a real dropped-in file (true) instead of the placeholder. */
  readonly art: Record<string, boolean>;
  /** Opacity of the "tap to fly" hint (0 = hidden). */
  readonly hint: number;
  /** Step at which the finale begins (null: none), its stage now (-1 before it), ms until it. */
  readonly finaleStep: number | null;
  readonly finaleStage: number;
  readonly finaleInMs: number | null;
  /** Players still in the air as this phone knows it (null: unknown). */
  readonly active: number | null;
  readonly place: number | null;
  readonly won: boolean;
  /** Hanging untouchable after a rejoin. */
  readonly grace: boolean;
  /** Times the bird was put back on the live course (reload / stall). */
  readonly rejoins: number;
  /** The announcement on the canvas right now ('' when none: the lane's words, or the big 'ניצחת!') and the finale's words + 3-2-1 digit in the lane ('' when none). */
  readonly banner: string;
  readonly countdown: string;
  /**
   * The announcement lane as last drawn (CSS px): its text ('' when empty), a key that changes with
   * every new message, the digit inside it (null), its box, the top of the play area under the HUD,
   * the "N באוויר" chip's box (null when not shown), the obstacles-passed counter's box (null when not
   * shown) and the big banner on screen ('' or 'ניצחת!').
   */
  readonly lane: { text: string; key: number; digit: number | null; x: number; y: number; w: number; h: number; hudTop: number; chip: [number, number, number, number] | null; counter: [number, number, number, number] | null; big: string };
  /** The "out" view (null while flying). */
  readonly out: { verdict: string; place: string; air: string; names: string[]; finale: string; count: string; winner: string; heads: number; winnerHead: boolean } | null;
  /**
   * The bird's head: the guest's look (null: unknown), whether the dressed head is drawn (false: the
   * game's own round token) and its drawn size in CSS px (0 x 0 with the token).
   */
  readonly head: { look: string | null; dressed: boolean; w: number; h: number };
  /** Let the strong pilot fly (true) / hand the bird back (false). `untilStep`: it stops tapping at that step. */
  autopilot(on: boolean, untilStep?: number): void;
}

declare global {
  interface Window {
    __flappy?: FlappyDebug;
  }
}

interface Feather {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  max: number;
  size: number;
  color: string;
  phase: number;
}

/** The crash moment before the "out" view comes up. */
const DEAD_MS = 950;
const MAX_FEATHERS = 48;
const FEATHER_COLORS = ['#ffffff', PAL.paper, PAL.yel2, '#ffffff'] as const;
const MAX_RAW = GAMES.flappy.maxRaw;
/** Behind the round clock by more than this (a reload, a stalled tab): rejoin instead of catching up. */
const REJOIN_AFTER_MS = 600;
/** Catch-up steps per loop update (a 20 fps phone needs 3). */
const MAX_CATCHUP = 12;
/**
 * The screen is at most this many field units wide. Tall phones (19.5:9) would
 * otherwise get a bigger zoom from their height and see ~38 units of course
 * ahead of the bird against ~48 on a 16:9 phone; capped, every portrait phone
 * sees 47-49 units ahead. Physics never depends on it (all in field units).
 */
const VIEW_W = 68;
/** The dressed head's height (chin to crown, hats not counted) in face-token diameters: about the token's size on screen. */
const HEAD_OF_TOKEN = 1.12;
/** Before GO the game waits this long at most for the dressed head, so it starts with it; later it is swapped in when ready. */
const HEAD_WAIT_MS = 600;
/**
 * The announcement lane: one line at the very top of the play area, under the HUD, beside the
 * "N באוויר" chip (owner's rule: announcements never cover the action). At most this high (CSS px),
 * one message at a time, the newest replaces the older, each for at most LANE_MS.
 */
const LANE_H = 42;
const LANE_MS = 1400;

/** The head code (and the avatar compositor) is loaded only by a game that has a look to draw. */
type HeadModule = typeof import('./head');

/** The owner's words, at these obstacle counts. */
const STREAK_WORDS: ReadonlyArray<readonly [number, string]> = [
  [5, 'וואו!'],
  [10, 'צדיק!'],
  [15, 'נודר!'],
  [20, 'בן פורת יוסף!'],
  [30, 'מחורחר!'],
];

function streakWord(n: number): string {
  let word = 'וואו!';
  for (const [at, w] of STREAK_WORDS) if (n >= at) word = w;
  return word;
}

function numParam(name: string): number | null {
  try {
    const raw = new URLSearchParams(window.location.search).get(name);
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export const game: GameModule = {
  id: 'flappy',
  async create(ctx: GameContext): Promise<GameInstance> {
    // the guest's own dressed doll (looks only; null: unknown, the game's own round token)
    const myLook = ((): string | null => {
      try {
        const look = ctx.myLook?.() ?? null;
        return typeof look === 'string' && look.trim() !== '' ? look : null;
      } catch {
        return null;
      }
    })();
    /** The head code and the doll's pictures (only a game with a look loads them). */
    const loadHead = (look: string): Promise<HeadModule | null> =>
      import('./head').then(
        (m) => {
          void m.warmHead(look);
          return m;
        },
        () => null,
      );
    // Before GO (the countdown: the round clock is frozen) the head loads with the art and the game
    // starts with it. After GO (a reload mid-round, the dev harness) it loads only once the game is
    // up, so it can never delay the boot (a late boot puts the bird back on the live course).
    const headEarly = myLook !== null && elapsedMs() <= 0 ? loadHead(myLook) : null;
    const [art] = await Promise.all([loadFlappyArt(), loadDisplayFont()]);
    const view = createGameCanvas(ctx.root);
    const input = createInput(view.canvas);
    const fx = createFx(260);
    const flight = createFlight(ctx.seed);
    const sparkle = paintDrawable('fl-sparkle', starPainter(PAL.yel), 32);
    const stickers = createStickerCache(24);
    const spectator = createSpectator(ctx.root, ctx.hudHeight, ctx.safeBottom);

    // ── who else is flying ──
    // In a room the stage knows (ctx.activePlayers / finaleInMs / field). In the dev harness
    // there is no server: ?field=N simulates N opponents, ?finaleAt=ms pins the finale.
    const inRoom = ctx.activePlayers !== undefined;
    const simCount = inRoom ? null : numParam('field');
    const simFinale = inRoom ? null : numParam('finaleAt');
    const sim: SimField | null = !inRoom && (simCount !== null || simFinale !== null) ? createSimField(ctx.seed, simCount ?? 0, simFinale) : null;
    const hasField = inRoom || (sim !== null && simCount !== null && simCount > 0);

    // ── layout (CSS px), recomputed from the view each step / frame ──
    // `top` = top of the FIELD (field y 0); `hudTop` = first px below the HUD. On a tall
    // phone the field is narrower than the screen height (see VIEW_W), so the sky
    // between them is open air: the bird may fly up to `ceil` (field units, <= 0).
    const L = { W: 0, H: 0, top: 0, hudTop: 0, ceil: 0, groundTop: 0, groundH: 0, playH: 0, U: 1, birdX: 0, sized: '' };
    const px = { banner: 40, lane: 20, laneChip: 20, score: 28, chip: 20, hint: 26 };
    function measure(): void {
      const W = view.width;
      const H = view.height;
      const key = `${W}x${H}`;
      if (key === L.sized) return;
      L.sized = key;
      L.W = W;
      L.H = H;
      L.hudTop = Math.min(ctx.hudHeight + 4, H * 0.3);
      L.groundH = Math.round(clamp(H * 0.085, 40, 80));
      L.groundTop = H - ctx.safeBottom - L.groundH;
      const availH = Math.max(120, L.groundTop - L.hudTop);
      // px per field unit: the field fills the height, but never so large that a tall
      // phone sees less of the course ahead than a 16:9 one (fairness, see VIEW_W)
      L.U = Math.min(availH / FIELD, W / VIEW_W);
      L.playH = FIELD * L.U;
      L.top = L.groundTop - L.playH;
      L.ceil = Math.min(0, (L.hudTop - L.top) / L.U);
      L.birdX = Math.round(clamp(Math.min(W * 0.3, 34 * L.U + 20), 60, W * 0.45));
      px.banner = Math.round(clamp(W * 0.115, 32, 56));
      px.lane = Math.round(clamp(W * 0.062, 20, 24));
      px.laneChip = Math.round(clamp(W * 0.052, 17, 22));
      px.chip = Math.round(clamp(W * 0.052, 17, 23));
      px.hint = Math.round(clamp(W * 0.07, 22, 30));
      px.score = Math.round(clamp(W * 0.075, 24, 30));
    }
    measure();

    // ── round clock ──
    function elapsedMs(): number {
      return ctx.durationMs - ctx.timeLeftMs();
    }

    // ── state (field units / seconds) ──
    const bird = newBird();
    let mode: Mode = 'fly';
    let simStep = 0;
    let clockStep = 0;
    let dist = 0;
    let nextIdx = 0;
    let graceLeft = 0; // steps of rejoin grace left
    let rejoins = 0;
    let knockX = 0; // units, bird pushed back on a bonk
    let knockVx = 0;
    let landed = false;
    let deadMs = 0;
    let deadDist = 0;
    let finalRaw = 0;
    let passedAtEnd = 0;
    let place: number | null = null;
    let total: number | null = null;
    let won = false;
    let pilot = false;
    let pilotUntil = Number.POSITIVE_INFINITY;
    let flapQueued = false;
    // finale
    let finaleAtMs: number | null = null;
    let finaleLeft: number | null = null; // players in the air when the finale began
    let finaleBegun = false;
    let shownStage = -1;
    let lastCountDigit = 0;
    let winnerName: string | null = null;
    // cosmetics (frame time, never gameplay)
    let tilt = 0;
    let bobT = 0;
    let wingT = 0;
    let flapBoost = 0;
    let flapFaceT = 0;
    let groundScroll = 0;
    let sqX = 1;
    let sqY = 1;
    let birdScale = 1;
    let counterPop = 1;
    let flash = 0;
    let hintAlpha = 1;
    let passGlow = 0;
    let passGlowIdx = -1;
    let bannerText = '';
    let bannerFill: string = PAL.yel;
    let bannerT = 0;
    let bannerMax = 1;
    // the lane (see LANE_H): a word ('word') or the finale's words with the 3-2-1 digit ('count')
    let laneKind: 'word' | 'count' = 'word';
    let laneText = '';
    let laneFill: string = PAL.yel;
    let laneT = 0;
    let laneMax = 1;
    let laneKey = 0;
    let laneBox: { x: number; y: number; w: number; h: number; digit: number | null } | null = null;
    let chipBox: [number, number, number, number] | null = null;
    let counterBox: [number, number, number, number] | null = null;
    let destroyed = false;
    let traceLeft = 0;
    const traced: Array<Array<number | string>> = [];
    let winnerPlayer: FieldPlayer | null = null;

    // ── the bird's head: the guest's dressed doll, made once at the size it is drawn at ──
    // (no look, or a look that cannot be drawn whole: the game's own round token, as before)
    let head: HeadSprite | null = null;
    function makeHead(look: string, mod: Promise<HeadModule | null>): Promise<HeadSprite | null> {
      const headPx = PHYS.radius * L.U * 2.18 * HEAD_OF_TOKEN * view.dpr;
      const made = mod.then((m) => (m === null ? null : m.makeHeadSprite(look, headPx)));
      void made.then((h) => {
        if (!destroyed) head = h;
      });
      return made;
    }
    if (myLook !== null && headEarly !== null) await Promise.race([makeHead(myLook, headEarly), new Promise((r) => setTimeout(r, HEAD_WAIT_MS))]);

    const feathers: Feather[] = [];
    for (let i = 0; i < MAX_FEATHERS; i++) {
      feathers.push({ x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, life: 0, max: 1, size: 1, color: '#fff', phase: 0 });
    }
    let featherCursor = 0;

    function spawnFeathers(x: number, y: number, count: number, power: number): void {
      for (let i = 0; i < count; i++) {
        const f = feathers[featherCursor];
        featherCursor = (featherCursor + 1) % MAX_FEATHERS;
        if (!f) continue;
        // cosmetic only: Math.random is fine here
        const a = Math.random() * Math.PI * 2;
        const s = power * (0.35 + Math.random() * 0.65);
        f.x = x;
        f.y = y;
        f.vx = Math.cos(a) * s;
        f.vy = Math.sin(a) * s - power * 0.4;
        f.rot = Math.random() * Math.PI * 2;
        f.vr = (Math.random() - 0.5) * 9;
        f.max = 0.9 + Math.random() * 0.7;
        f.life = f.max;
        f.size = L.U * (1.6 + Math.random() * 1.6);
        f.color = FEATHER_COLORS[i % FEATHER_COLORS.length] ?? '#fff';
        f.phase = Math.random() * 6;
      }
    }

    function updateFeathers(dt: number): void {
      for (const f of feathers) {
        if (f.life <= 0) continue;
        f.life -= dt;
        f.vx *= 1 - 2.6 * dt;
        f.vy = f.vy * (1 - 2.6 * dt) + 260 * dt; // drag + gentle fall
        f.phase += dt * 6;
        f.x += (f.vx + Math.sin(f.phase) * 40) * dt;
        f.y += f.vy * dt;
        f.rot += f.vr * dt;
      }
    }

    function drawFeathers(g: CanvasRenderingContext2D): void {
      for (const f of feathers) {
        if (f.life <= 0) continue;
        g.globalAlpha = clamp(f.life / (f.max * 0.4), 0, 1);
        g.save();
        g.translate(f.x, f.y);
        g.rotate(f.rot + Math.sin(f.phase) * 0.5);
        g.fillStyle = f.color;
        g.beginPath();
        g.ellipse(0, 0, f.size, f.size * 0.38, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = PAL.ink;
        g.lineWidth = 1.5;
        g.stroke();
        g.restore();
      }
      g.globalAlpha = 1;
    }

    /** One hint fade at a time. */
    let cancelHintFade: (() => void) | null = null;
    function fadeHint(to: number, ms: number): void {
      cancelHintFade?.();
      cancelHintFade = fx.tween({ ms, from: hintAlpha, to, update: (v) => (hintAlpha = v) });
    }

    /** The big banner over the play area: only for 'ניצחת!' (the play is over). */
    function banner(text: string, fill: string = PAL.yel, ms = 1100): void {
      bannerText = text;
      bannerFill = fill;
      bannerMax = ms / 1000;
      bannerT = bannerMax;
    }

    /** A message in the lane: it replaces whatever the lane shows, for at most LANE_MS. */
    function say(text: string, fill: string = PAL.yel, ms = 1100): void {
      laneKind = 'word';
      laneText = text;
      laneFill = fill;
      laneMax = Math.min(LANE_MS, ms) / 1000;
      laneT = laneMax;
      laneKey++;
    }
    /** The finale's words and the new 3-2-1 digit in the lane (each digit is a new message). */
    function sayCount(): void {
      laneKind = 'count';
      laneText = '';
      laneMax = LANE_MS / 1000;
      laneT = laneMax;
      laneKey++;
    }

    // ── sounds that the kit does not have ──
    function flapSound(): void {
      noise({ dur: 0.07, vol: 0.13, attack: 0.005, filter: { type: 'bandpass', freq: 900, to: 2200, q: 1.1 } });
      tone({ freq: 430, to: 640, dur: 0.06, type: 'triangle', vol: 0.07 });
    }
    function bonkSound(): void {
      sfx.hit();
      tone({ freq: 760, to: 210, dur: 0.16, type: 'square', vol: 0.09, lowpass: 2200 });
    }

    // ── the field ──
    function activeNow(): number | null {
      if (sim) return hasField ? sim.active() : null;
      return ctx.activePlayers?.() ?? null;
    }
    function fieldPlayers(): readonly FieldPlayer[] {
      if (sim) return hasField ? sim.field().players : [];
      return ctx.field?.()?.players ?? [];
    }
    function finaleIn(): number | null {
      if (sim) return sim.finaleInMs(elapsedMs());
      return ctx.finaleInMs?.() ?? null;
    }

    /** Reads the finale from the stage and fixes the step it begins at. */
    function syncFinale(): void {
      // ms until it FIRST, the clock after: an interruption between the two reads can only
      // make the sum later than the truth, so the smallest reading is the right one
      const inMs = finaleIn();
      if (inMs === null) return;
      const at = Math.round(inMs + elapsedMs());
      if (finaleAtMs === null || at < finaleAtMs) {
        finaleAtMs = at;
        flight.setFinale(Math.ceil(at / STEP_MS - 1e-6));
        if (mode === 'fly') nextIdx = flight.nextIndex(dist);
      }
    }

    /** The number the finale banner says: how many are in the air now, fixed once the finale begins. */
    function leftForBanner(): number | null {
      const n = finaleLeft ?? activeNow();
      return n !== null && n >= 2 ? n : null;
    }

    // ── flying ──
    function flap(): void {
      if (hintAlpha > 0.01) fadeHint(0, 250);
      flapBoost = 1;
      flapFaceT = 0.18;
      fx.tween({ ms: 260, from: 0, to: 1, ease: ease.outBack, update: (v) => { sqX = lerp(0.8, 1, v); sqY = lerp(1.24, 1, v); } });
      const bx = L.birdX;
      const by = L.top + bird.y * L.U;
      fx.burst(bx - PHYS.radius * L.U * 0.6, by + PHYS.radius * L.U * 0.7, {
        count: 5,
        colors: ['#ffffff', PAL.paper],
        speed: 120,
        size: 3,
        life: 0.32,
        gravity: -60,
        angle: Math.PI * 0.75,
        spread: 1.1,
      });
      flapSound();
      haptic.tap();
    }

    function pass(o: Obstacle): void {
      const run = nextIdx + 1;
      passGlowIdx = o.i;
      passGlow = 1;
      counterPop = 1.25;
      fx.tween({ ms: 300, from: 1.25, to: 1, ease: ease.outCubic, update: (v) => (counterPop = v) });
      const gx = L.birdX;
      const gy = L.top + o.gapY * L.U;
      fx.burst(gx, gy, { count: 9, colors: [PAL.yel, '#ffffff', PAL.red], speed: 240, size: 4, life: 0.45, gravity: 120, shape: 'star' });
      sfx.coin(1 + Math.min(run, 24) * 0.025);
      if (run % 5 === 0 && bannerT <= 0) {
        say(streakWord(run), run % 10 === 0 ? PAL.white : PAL.yel);
        sfx.success();
        haptic.success();
      }
    }

    function die(hitGround: boolean, quiet = false): void {
      if (mode !== 'fly') return;
      mode = 'dead';
      deadMs = 0;
      deadDist = dist;
      landed = hitGround;
      passedAtEnd = nextIdx;
      finalRaw = Math.min(MAX_RAW, survivalRaw(dist));
      // behind everyone who is still in the air
      const n = activeNow();
      const players = fieldPlayers();
      total = players.length > 0 ? players.length : null;
      place = won ? 1 : n !== null ? Math.max(1, n) : null;
      ctx.setScore(finalRaw);
      ctx.finish();
      if (quiet) return;
      const bx = L.birdX;
      const by = L.top + bird.y * L.U;
      spawnFeathers(bx, by, 16, 360);
      fx.burst(bx, by, { count: 10, colors: ['#ffffff', PAL.yel], speed: 300, size: 4, life: 0.4, shape: 'star' });
      fx.shake(Math.max(8, L.U * 2.2), 280);
      bonkSound();
      if (!hitGround) {
        bird.vy = -38;
        knockVx = -16;
      } else {
        bird.vy = 0;
        sqX = 1.35;
        sqY = 0.65;
        fx.tween({ ms: 320, from: 0, to: 1, ease: ease.outElastic, update: (v) => { sqX = lerp(1.35, 1, v); sqY = lerp(0.65, 1, v); } });
      }
      haptic.bump();
      flapBoost = 0;
      bannerT = 0;
      laneT = 0;
    }

    /** Put the bird back on the live course: the middle of the next gap, hanging and untouchable for a moment. */
    function rejoin(target: number): void {
      simStep = target;
      dist = flight.distAt(simStep);
      nextIdx = flight.nextIndex(dist);
      let o = flight.get(nextIdx);
      // an obstacle the bird is already inside of is not "next": aim at the one after it
      if (o.x - dist < PHYS.headW) o = flight.get(nextIdx + 1);
      bird.y = o.gapY;
      bird.vy = 0;
      bird.hover = true;
      graceLeft = Math.round(PHYS.rejoinGraceMs / STEP_MS);
      rejoins++;
      hintAlpha = 0.9;
      birdScale = 0.2;
      fx.tween({ ms: 380, from: 0.2, to: 1, ease: ease.outBack, update: (v) => (birdScale = v) });
    }

    /** One fixed step of round time while in the air. */
    function flyStep(): void {
      const wantFlap = flapQueued || (pilot && simStep < pilotUntil && pilotFlap(flight, simStep, bird, 0));
      flapQueued = false;
      simStep++;
      dist = flight.distAt(simStep);
      // the bird hangs until the first tap, but only for a while: then it falls like anyone's
      if (bird.hover && !wantFlap) {
        if (graceLeft > 0) {
          if (--graceLeft === 0) bird.hover = false;
        } else if (simStep * STEP_MS >= PHYS.hoverMs) bird.hover = false;
      }
      if (wantFlap) {
        graceLeft = 0;
        flap();
      }
      for (;;) {
        const o = flight.get(nextIdx);
        if (o.x - dist < -PASS_BEHIND) {
          pass(o);
          nextIdx++;
        } else break;
      }
      const down = stepBird(bird, wantFlap, flight, nextIdx, dist, L.ceil, graceLeft === 0);
      ctx.setScore(Math.min(MAX_RAW, survivalRaw(dist)));
      if (traceLeft > 0) {
        traceLeft--;
        traced.push([simStep, down ? 'dead' : 'fly', bird.y, bird.vy, dist, nextIdx]);
      }
      if (down) die(bird.y + PHYS.hitRadius >= FIELD);
    }

    function spectatorState(): SpectatorState {
      const players = fieldPlayers();
      const flying = players.filter((p) => !p.out && !p.me);
      const n = activeNow();
      // once the server has this phone's final, the strict order knows its place exactly
      const at = players.findIndex((p) => p.me);
      if (at >= 0 && players[at]?.out === true && !won) place = at + 1;
      if (players.length > 0) total = players.length;
      if (winnerName === null && hasField && n !== null && n <= 1 && (total ?? 0) >= 2 && flying.length === 1) {
        winnerName = flying[0]?.name ?? null;
        winnerPlayer = flying[0] ?? null;
      }
      return {
        kind: won ? 'win' : hasField ? 'out' : 'solo',
        place,
        total,
        passed: passedAtEnd,
        active: hasField ? n : null,
        flying,
        finaleInMs: finaleAtMs === null ? null : finaleAtMs - elapsedMs(),
        finaleLeft: leftForBanner(),
        winner: winnerName,
        winnerPlayer,
      };
    }

    // ── fixed step (the kit loop: frame time; the flight itself follows the round clock) ──
    function step(dt: number): void {
      measure();
      const el = elapsedMs();
      clockStep = Math.max(0, Math.floor(el / STEP_MS + 1e-6));
      sim?.update(el, mode === 'fly');
      syncFinale();

      if (mode === 'fly') {
        const behind = clockStep - simStep;
        if (behind * STEP_MS > REJOIN_AFTER_MS) rejoin(clockStep);
        else for (let k = Math.min(behind, MAX_CATCHUP); k > 0 && mode === 'fly'; k--) flyStep();
        if (mode === 'fly') {
          // the server counted this phone out (away for longer than the grace)
          const me = inRoom ? fieldPlayers().find((p) => p.me) : undefined;
          if (me?.out === true) die(false);
        }
        if (mode === 'fly' && !won && hasField) {
          const n = activeNow();
          if (n === 1 && fieldPlayers().length >= 2) {
            won = true;
            banner('ניצחת!', PAL.yel, 4000);
            fx.confetti({ count: 70, width: L.W });
            sfx.success();
            haptic.success();
          }
        }
      } else if (mode === 'dead') {
        deadMs += dt * 1000;
        knockX += knockVx * dt;
        knockVx *= 1 - 5 * dt;
        if (!landed) {
          bird.vy = Math.min(PHYS.maxFall * 1.2, bird.vy + PHYS.gravity * 1.1 * dt);
          bird.y += bird.vy * dt;
          tilt += 9 * dt;
          const floor = FIELD - PHYS.radius * 0.85;
          if (bird.y >= floor) {
            bird.y = floor;
            landed = true;
            bird.vy = 0;
            sfx.land(0.8);
            spawnFeathers(L.birdX + knockX * L.U, L.groundTop - 4, 5, 160);
          }
        } else {
          tilt += (Math.PI * 0.5 - tilt) * 0.15;
        }
        if (deadMs >= DEAD_MS) mode = 'out';
      }
      if (mode !== 'fly') {
        // the course keeps running behind the "out" view, at the live point
        simStep = clockStep;
      }

      // the finale: 3-2-1, then every stage says so
      if (finaleAtMs !== null) {
        const left = finaleAtMs - el;
        if (left > 0 && left <= 3_000) {
          const digit = Math.ceil(left / 1000);
          if (digit !== lastCountDigit) {
            lastCountDigit = digit;
            if (mode === 'fly') {
              sfx.beep();
              haptic.tap();
              if (!won) sayCount();
            }
          }
        } else if (left <= 0) {
          lastCountDigit = 0;
          const stage = finaleDifficulty(-left / 1000).stage;
          if (!finaleBegun) {
            finaleBegun = true;
            finaleLeft = activeNow() ?? 0;
            shownStage = stage;
            if (mode === 'fly' && !won) {
              say('מחורחר!', PAL.yel, LANE_MS);
              flash = 0.4;
              fx.tween({ ms: 300, from: 0.4, to: 0, update: (v) => (flash = v) });
              fx.shake(6, 300);
              sfx.whoosh(0.8);
            }
          } else if (stage > shownStage) {
            shownStage = stage;
            if (mode === 'fly' && !won && stage % 2 === 0) say('עוד יותר קשה!', PAL.white, 900);
          }
        }
      }

      if (mode === 'out') spectator.show(spectatorState());

      // cosmetics
      bobT += dt;
      const speed = flight.speedAt(simStep);
      groundScroll += speed * dt;
      if (mode === 'fly') {
        const target = bird.hover ? 0 : clamp(bird.vy / PHYS.maxFall, -0.42, 1) * (bird.vy > 0 ? 1.15 : 1);
        tilt += (target - tilt) * (bird.vy > 0 && !bird.hover ? 0.09 : 0.3);
      }
      flapBoost = Math.max(0, flapBoost - dt * 3.2);
      wingT += dt * (mode === 'fly' ? 11 + flapBoost * 26 : 0);
      flapFaceT = Math.max(0, flapFaceT - dt);
      passGlow = Math.max(0, passGlow - dt * 2.4);
      if (bannerT > 0) bannerT = Math.max(0, bannerT - dt);
      if (laneT > 0) laneT = Math.max(0, laneT - dt);
      updateFeathers(dt);
      fx.update(dt);
    }

    // ── drawing ──
    const g = view.ctx;

    /**
     * The backdrop is static: it lives on its own canvas behind the game canvas and is
     * painted once per screen size, so no frame pays a full-screen blit for it.
     */
    const bgCanvas = document.createElement('canvas');
    bgCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none';
    ctx.root.prepend(bgCanvas);
    let bgSized = '';
    function paintBackdrop(): void {
      const key = `${L.W}x${L.H}x${view.dpr}`;
      if (key === bgSized) return;
      bgSized = key;
      bgCanvas.width = Math.max(1, Math.round(L.W * view.dpr));
      bgCanvas.height = Math.max(1, Math.round(L.H * view.dpr));
      const b = bgCanvas.getContext('2d');
      if (!b) return;
      b.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      const bg = art.background;
      const s = Math.max(L.W / bg.width, L.H / bg.height);
      bg.draw(b, L.W / 2, L.H / 2, bg.width * s, bg.height * s);
    }

    function drawTiledX(d: typeof art.ground, y: number, h: number, offset: number): void {
      const tw = (d.width / d.height) * h;
      let x = -((offset % tw) + tw) % tw;
      for (; x < L.W; x += tw) g.drawImage(d.source, x, y, tw + 0.5, h);
    }

    /** Pole from y0 down to y1 (y1 > y0), centered on cx, in the current transform. */
    function drawPole(cx: number, y0: number, y1: number, w: number): void {
      const p = art.obstacle_pole;
      const src = p.source;
      const th = (p.height / p.width) * w;
      for (let y = y0; y < y1; y += th) {
        const h = Math.min(th, y1 - y);
        g.drawImage(src, 0, 0, src.width, (src.height * h) / th, cx - w / 2, y, w, h);
      }
    }

    function drawObstacles(d: number, from: number): void {
      const U = L.U;
      const headW = PHYS.headW * U;
      const headH = PHYS.headH * U;
      const poleW = PHYS.poleW * U;
      const minX = -L.birdX / U - PHYS.headW;
      const maxX = (L.W - L.birdX) / U + PHYS.headW;
      for (let i = Math.max(0, from - 3); ; i++) {
        const o = flight.get(i);
        const ox = o.x - d;
        if (ox > maxX) break;
        if (ox < minX) continue;
        const sx = L.birdX + ox * U;
        const gapTop = L.top + (o.gapY - o.gap / 2) * U;
        const gapBot = L.top + (o.gapY + o.gap / 2) * U;
        const glow = i === passGlowIdx ? passGlow : 0;
        // bottom stand
        drawPole(sx, gapBot + headH * 0.9, L.groundTop + 2, poleW);
        if (glow > 0) {
          // pass ripple around both microphones
          const rr = headW * (0.55 + (1 - glow) * 0.75);
          g.globalAlpha = glow;
          g.strokeStyle = PAL.yel;
          g.lineWidth = 2 + glow * 5;
          g.beginPath();
          g.arc(sx, gapBot + headH * 0.35, rr, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.arc(sx, gapTop - headH * 0.35, rr, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        }
        art.obstacle.draw(g, sx, gapBot + headH / 2, headW, headH);
        // top stand (flipped: the mic points down)
        g.save();
        g.translate(sx, gapTop);
        g.scale(1, -1);
        drawPole(0, headH * 0.9, gapTop + 2, poleW);
        art.obstacle.draw(g, 0, headH / 2, headW, headH);
        g.restore();
      }
    }

    function drawBird(alpha: number): void {
      const U = L.U;
      const r = PHYS.radius * U;
      const dead = mode !== 'fly';
      // between two steps the bird keeps moving at its speed (the world does the same)
      const y = dead || bird.hover ? bird.y + (bird.hover && !dead ? Math.sin(bobT * 4.2) * 1.2 : 0) : bird.y + bird.vy * STEP_S * alpha;
      const bx = L.birdX + knockX * U;
      const by = L.top + y * U;
      // hanging untouchable after a rejoin: the bird blinks
      if (!dead && graceLeft > 0 && Math.floor(bobT * 10) % 2 === 0) g.globalAlpha = 0.45;
      g.save();
      g.translate(bx, by);
      g.rotate(tilt);
      g.scale(sqX * birdScale, sqY * birdScale);
      const D = r * 2.18;
      // the guest's dressed head (a cached cut-out: one blit), else the game's round token
      const hs = head;
      const headH = D * HEAD_OF_TOKEN;
      // wings behind the head: their roots sit on its sides (the circle's sides for the token)
      const wa = dead ? 0.7 : Math.sin(wingT) * (0.45 + flapBoost * 0.35) - 0.15;
      const ww = r * 1.7;
      const wh = ww * (SLOT_SIZES.wing.h / SLOT_SIZES.wing.w);
      const rootX = hs !== null ? Math.max(r * 0.7, hs.halfW * headH * 0.9) : r * 0.86;
      for (let side = -1; side <= 1; side += 2) {
        g.save();
        g.translate(side * rootX, -r * 0.05);
        g.scale(side, 1);
        g.rotate(-wa);
        art.wing.draw(g, ww / 2, 0, ww, wh);
        g.restore();
      }
      if (hs !== null) {
        // the flap and the fall read through the wings, the squash and the tilt (the whole group);
        // a crash keeps the guest's own head, with the dizzy stars and the knocked halo
        g.drawImage(hs.canvas, -hs.cx * headH, -hs.cy * headH, hs.w * headH, hs.h * headH);
      } else {
        // the face is a finished round token (paper disc + ink ring): drawn as it is
        const face = dead ? art.face_dead : flapFaceT > 0 ? art.face_flap : art.face;
        face.draw(g, 0, 0, D, D);
      }
      // halo over the top of the circle, or over the top of the hat tower (tilts off when dead)
      const hw = r * 1.45;
      const hh = hw * (SLOT_SIZES.halo.h / SLOT_SIZES.halo.w);
      const top = hs !== null ? Math.min(-r * 1.3, -hs.cy * headH - hh * 0.15) : -r * 1.3;
      const hy = top + (dead ? -r * 0.15 : Math.sin(bobT * 5) * r * 0.06);
      art.halo.draw(g, dead ? r * 0.35 : 0, hy, hw, hh, dead ? 0.5 : 0);
      g.restore();
      g.globalAlpha = 1;

      if (dead) {
        // dizzy stars
        for (let i = 0; i < 3; i++) {
          const a = bobT * 7 + (i * Math.PI * 2) / 3;
          sparkle.draw(g, bx + Math.cos(a) * r * 1.1, by - r * 1.1 + Math.sin(a) * r * 0.35, r * 0.62, r * 0.62, a);
        }
      }
    }

    function sticker(key: string, make: (old: HTMLCanvasElement | null) => Sticker): Sticker {
      return stickers.get(`${L.sized}|${key}`, make);
    }

    /** Obstacles passed: a small score at the top, in the lane row. */
    function drawCounter(): void {
      counterBox = null;
      if (mode !== 'fly' || nextIdx <= 0) return;
      const n = nextIdx;
      const s = sticker(`n${n}`, (old) => renderSticker(String(n), { size: px.score, fill: PAL.white, shadow: PAL.cobD, outline: 0.14, skew: 0, tilt: 0 }, old));
      // small, at the left end of the lane row (like a classic score): never over the field; the
      // pop of a pass (1.25) stays inside the lane's height
      const k = Math.min(1, (LANE_H * 0.8) / s.h);
      const w = s.w * k;
      const h = s.h * k;
      const x = 8;
      const cy = L.hudTop + 2 + LANE_H / 2;
      blit(g, s, x + w / 2, cy, k * counterPop);
      counterBox = [x, cy - h / 2, w, h];
    }

    /** "N באוויר": how many are still flying, under the HUD. */
    function drawAirChip(): void {
      chipBox = null;
      if (mode !== 'fly' || !hasField) return;
      const n = activeNow();
      if (n === null) return;
      const s = sticker(`air${n}`, (old) => renderChip(`${n} באוויר`, px.chip, n <= 3 ? PAL.red : PAL.yel, n <= 3 ? PAL.white : PAL.ink, old));
      chipBox = [L.W - 8 - s.w, L.hudTop + 4, s.w, s.h];
      g.drawImage(s.canvas, chipBox[0], chipBox[1], s.w, s.h);
    }

    /**
     * The lane: one slim line at the very top of the play area, under the HUD, in the room left of
     * the "N באוויר" chip (the whole width without it). Fitted to that room and to LANE_H.
     */
    function drawLane(): void {
      laneBox = null;
      if (laneT <= 0 || mode !== 'fly') return;
      const pieces: Sticker[] = [];
      let digit: number | null = null;
      if (laneKind === 'count') {
        // the finale's words on a red chip and the digit on a yellow one, as in the "out" view
        const c = countdownShown();
        if (!c) return;
        digit = c.digit;
        pieces.push(sticker(`lw${c.text}`, (old) => renderChip(c.text, px.laneChip, PAL.red, PAL.yel, old)));
        pieces.push(sticker(`ld${c.digit}`, (old) => renderChip(String(c.digit), px.laneChip, PAL.yel, PAL.ink, old)));
      } else {
        if (laneText === '') return;
        const text = laneText;
        const fill = laneFill;
        pieces.push(sticker(`lt${text}${fill}`, (old) => renderSticker(text, { size: px.lane, fill }, old)));
      }
      const gap = 6;
      let w = -gap;
      let h = 0;
      for (const p of pieces) {
        w += p.w + gap;
        h = Math.max(h, p.h);
      }
      // between the obstacles-passed counter (left) and the "N באוויר" chip (right)
      const left = counterBox !== null ? counterBox[0] + counterBox[2] + 8 : 8;
      const right = chipBox !== null ? chipBox[0] - 8 : L.W - 8;
      const room = Math.max(40, right - left);
      const age = laneMax - laneT;
      // a small pop in (never larger than the lane) and a fade out
      const k = Math.min(1, room / w, LANE_H / h) * (0.86 + 0.14 * ease.outCubic(clamp(age / 0.16, 0, 1)));
      const cx = left + room / 2;
      const cy = L.hudTop + 2 + LANE_H / 2;
      g.globalAlpha = clamp(laneT / 0.22, 0, 1);
      // right to left, as it reads: the words, then the digit
      let x = cx + (w * k) / 2;
      for (const p of pieces) {
        const pw = p.w * k;
        blit(g, p, x - pw / 2, cy, k);
        x -= pw + gap * k;
      }
      g.globalAlpha = 1;
      laneBox = { x: cx - (w * k) / 2, y: cy - (h * k) / 2, w: w * k, h: h * k, digit };
    }

    /** The big banner: only 'ניצחת!' uses it now (the play is over); everything else goes to the lane. */
    function drawBanner(): void {
      if (bannerT <= 0 || bannerText === '') return;
      const age = bannerMax - bannerT;
      const pop = age < 0.25 ? ease.outBack(age / 0.25) : 1;
      const s = sticker(`b${bannerText}${bannerFill}`, (old) => renderSticker(bannerText, { size: px.banner, fill: bannerFill }, old));
      const fit = Math.min(1, (L.W - 24) / s.w);
      g.globalAlpha = clamp(bannerT / 0.3, 0, 1);
      blit(g, s, L.W / 2, L.top + L.playH * 0.15, pop * fit);
      g.globalAlpha = 1;
    }

    /** "!נשארו 3" and the 3-2-1 before the finale begins (the game does not stop): shown in the lane. */
    function countdownShown(): { text: string; digit: number } | null {
      if (finaleAtMs === null || mode !== 'fly' || won) return null;
      const left = finaleAtMs - elapsedMs();
      if (left <= 0 || left > 3_000) return null;
      return { text: finaleText(leftForBanner(), false), digit: Math.min(3, Math.ceil(left / 1000)) };
    }

    function drawHint(): void {
      if (hintAlpha <= 0.01 || mode !== 'fly') return;
      const t = bobT % 1.1;
      const U = L.U;
      const r = PHYS.radius * U;
      const fx0 = L.birdX + r * 2.6;
      const fy0 = L.top + bird.y * U + r * 3.2;
      g.save();
      g.globalAlpha = hintAlpha;
      // tap ripple
      if (t > 0.12 && t < 0.9) {
        const k = (t - 0.12) / 0.78;
        g.globalAlpha = hintAlpha * (1 - k);
        g.strokeStyle = PAL.white;
        g.lineWidth = 4 * (1 - k) + 1.5;
        g.beginPath();
        g.arc(fx0, fy0, r * (0.4 + k * 1.6), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = hintAlpha;
      }
      const words = sticker('hint', (old) => renderSticker('הקישו כדי לעוף!', { size: px.hint, fill: PAL.white, shadow: PAL.cobD }, old));
      const fit = Math.min(1, (L.W - 20) / words.w);
      const pulse = 1 + Math.sin(bobT * 6) * 0.04;
      blit(g, words, L.W / 2, Math.min(L.groundTop - words.h * 0.6, fy0 + r * 4.2), fit * pulse);
      g.restore();
    }

    /** The crash moment: "!נפלת" and the place, before the "out" view takes over. */
    function drawCrash(): void {
      if (mode !== 'dead') return;
      const k = clamp(deadMs / 220, 0, 1);
      const sub = place !== null && hasField ? `מקום ${place}` : undefined;
      const s = sticker(`x${sub ?? ''}`, (old) => renderSticker('נפלת!', { size: Math.round(px.banner * 1.25), fill: PAL.yel, burst: PAL.red, ...(sub !== undefined ? { sub } : {}) }, old));
      const fit = Math.min(1, (L.W - 12) / s.w);
      blit(g, s, L.W / 2, L.top + L.playH * 0.36, ease.outBack(k) * fit);
    }

    const loop = createLoop({
      update: step,
      render(): void {
        measure();
        // the world between two steps: exactly where the next step will put it
        const el = elapsedMs();
        const viewStep = mode === 'dead' ? -1 : mode === 'fly' ? simStep : clockStep;
        let d = deadDist;
        let alpha = 0;
        if (viewStep >= 0) {
          alpha = mode === 'fly' && clockStep > simStep ? 1 : clamp(el / STEP_MS - viewStep, 0, 1);
          const d0 = flight.distAt(viewStep);
          d = d0 + (flight.distAt(viewStep + 1) - d0) * alpha;
        }
        const from = mode === 'fly' ? nextIdx : flight.nextIndex(d);
        g.clearRect(0, 0, L.W, L.H);
        paintBackdrop();
        g.save();
        fx.applyShake(g);
        const skyH = L.playH * 0.2;
        drawTiledX(art.skyline, L.top + L.playH * 0.06, skyH, groundScroll * L.U * 0.25);
        drawObstacles(d, from);
        if (mode !== 'out') drawBird(alpha);
        drawTiledX(art.ground, L.groundTop, L.groundH, (mode === 'dead' ? deadDist : d) * L.U);
        if (L.H > L.groundTop + L.groundH) {
          g.fillStyle = PAL.cobD;
          g.fillRect(0, L.groundTop + L.groundH, L.W, L.H - L.groundTop - L.groundH);
        }
        drawFeathers(g);
        g.restore();
        fx.draw(g);
        drawAirChip();
        drawCounter();
        drawLane();
        drawBanner();
        drawHint();
        drawCrash();
        if (flash > 0) {
          g.fillStyle = `rgba(255,255,255,${flash})`;
          g.fillRect(0, 0, L.W, L.H);
        }
      },
    });

    input.onDown(() => {
      if (mode === 'fly') flapQueued = true;
    });

    // dev harness: ?pilot=1 lets the pilot fly from the first step (&pilotUntil=<step>), ?trace=<n> records n steps
    if (!inRoom) {
      if (numParam('pilot') === 1) {
        pilot = true;
        pilotUntil = numParam('pilotUntil') ?? Number.POSITIVE_INFINITY;
      }
      traceLeft = Math.max(0, numParam('trace') ?? 0);
    }

    // ── boot: already out (a reload after the crash), or mid-round (a reload while flying) ──
    const outRaw = inRoom ? (ctx.field?.()?.outRaw ?? null) : null;
    if (outRaw !== null) {
      mode = 'out';
      finalRaw = outRaw;
      // the distance this phone had flown, back from the score
      passedAtEnd = flight.nextIndex(outRaw / 10);
      hintAlpha = 0;
      ctx.setScore(finalRaw);
      ctx.finish();
    } else if (elapsedMs() > REJOIN_AFTER_MS) {
      syncFinale();
      rejoin(Math.floor(elapsedMs() / STEP_MS));
    }

    window.__flappy = {
      get mode(): Mode {
        return mode;
      },
      get run(): number {
        return mode === 'fly' ? nextIdx : passedAtEnd;
      },
      get raw(): number {
        return mode === 'fly' ? Math.min(MAX_RAW, survivalRaw(dist)) : finalRaw;
      },
      get birdY(): number {
        return bird.y;
      },
      get vy(): number {
        return bird.vy;
      },
      get dist(): number {
        return dist;
      },
      get steps(): number {
        return simStep;
      },
      get clockStep(): number {
        return clockStep;
      },
      get next(): { x: number; gapY: number; gap: number } {
        const o = flight.get(nextIdx);
        return { x: o.x - dist, gapY: o.gapY, gap: o.gap };
      },
      phys: PHYS,
      get hint(): number {
        return hintAlpha;
      },
      get art(): Record<string, boolean> {
        const out: Record<string, boolean> = {};
        for (const [k, d] of Object.entries(art)) out[k] = !d.isPlaceholder;
        return out;
      },
      get speed(): number {
        return flight.speedAt(simStep);
      },
      get layout(): { U: number; birdX: number; W: number; top: number; groundTop: number; ahead: number } {
        return { U: L.U, birdX: L.birdX, W: L.W, top: L.top, groundTop: L.groundTop, ahead: (L.W - L.birdX) / L.U };
      },
      trace(n: number): void {
        traced.length = 0;
        traceLeft = Math.max(0, n);
      },
      get traced(): ReadonlyArray<readonly (number | string)[]> {
        return traced;
      },
      course(n: number): Array<{ x: number; gapY: number; gap: number }> {
        const out: Array<{ x: number; gapY: number; gap: number }> = [];
        for (let i = 0; i < n; i++) {
          const o = flight.get(i);
          out.push({ x: o.x, gapY: o.gapY, gap: o.gap });
        }
        return out;
      },
      distAt: (s: number): number => flight.distAt(s),
      get finaleStep(): number | null {
        return flight.finaleStep;
      },
      get finaleStage(): number {
        return finaleAtMs === null || elapsedMs() < finaleAtMs ? -1 : finaleDifficulty((elapsedMs() - finaleAtMs) / 1000).stage;
      },
      get finaleInMs(): number | null {
        return finaleAtMs === null ? null : finaleAtMs - elapsedMs();
      },
      get active(): number | null {
        return activeNow();
      },
      get place(): number | null {
        return place;
      },
      get won(): boolean {
        return won;
      },
      get grace(): boolean {
        return graceLeft > 0;
      },
      get rejoins(): number {
        return rejoins;
      },
      get banner(): string {
        if (bannerT > 0) return bannerText;
        return mode === 'fly' && laneT > 0 && laneKind === 'word' ? laneText : '';
      },
      get countdown(): string {
        const c = laneT > 0 && laneKind === 'count' ? countdownShown() : null;
        return c ? `${c.text} ${c.digit}` : '';
      },
      get lane(): FlappyDebug['lane'] {
        const b = laneBox;
        const text = b === null ? '' : laneKind === 'count' ? (countdownShown()?.text ?? '') : laneText;
        return {
          text,
          key: laneKey,
          digit: b?.digit ?? null,
          x: b?.x ?? 0,
          y: b?.y ?? 0,
          w: b?.w ?? 0,
          h: b?.h ?? 0,
          hudTop: L.hudTop,
          chip: chipBox,
          counter: counterBox,
          big: bannerT > 0 && bannerText !== '' ? bannerText : '',
        };
      },
      get out(): ReturnType<typeof spectator.shown> | null {
        return spectator.visible ? spectator.shown() : null;
      },
      get head(): { look: string | null; dressed: boolean; w: number; h: number } {
        const hs = head;
        const headH = PHYS.radius * L.U * 2.18 * HEAD_OF_TOKEN;
        return { look: myLook, dressed: hs !== null, w: hs !== null ? hs.w * headH : 0, h: hs !== null ? hs.h * headH : 0 };
      },
      autopilot(on: boolean, untilStep?: number): void {
        pilot = on;
        pilotUntil = untilStep ?? Number.POSITIVE_INFINITY;
      },
    };

    loop.start();
    if (myLook !== null && headEarly === null) void makeHead(myLook, loadHead(myLook));

    return {
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        loop.stop();
        input.dispose();
        view.dispose();
        bgCanvas.remove();
        spectator.destroy();
        stickers.dispose();
        fx.clear();
        if (window.__flappy) delete window.__flappy;
      },
    };
  },
};
