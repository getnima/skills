/**
 * שימי טאפ: a personal 20-second sprint of tapping Shimi (the round is 53 s: a 30 s start
 * window, then 20 s of tapping from the player's own first touch, or from the end of the
 * window when they never touch, then a 3 s hold). Score = counted taps, nothing else (rules in
 * pick.ts; how to change a line or a threshold: README.md next to this file).
 *
 * The show is ONE thing: the doll picks his nose, and the faster you tap, the further his hand
 * rises and the deeper the finger goes. The doll lives in a round token (a porthole: every
 * head frame is cut to the circle once at load). His picture is a clip of 40 frames (one
 * image-to-video take: the hand rises, the finger slides into the nostril, the eyes close in
 * bliss and roll up) driven by one continuous state, the picking depth d, stepped at the fixed
 * step: d follows the smoothed tap rate (critically damped, so it eases in and out), every
 * counted tap adds a quick jab (a spring impulse inward that eases back), and while deep the
 * finger wiggles. d is mapped to a clip position and the two nearest frames are crossfaded, so
 * the motion never steps; the few still faces (the waiting bits, the paparazzi, the whistle,
 * the final frame) are crossfaded over the clip too. Short lines in the doll's voice come with
 * the milestones; the final frame (a picture per rank, the count on a red star) stays until
 * the round ends.
 *
 * Fairness: taps are stamped with their round time and applied by the pure engine at the
 * fixed step that covers that time, so frame rate does not change the score; the look is
 * started from engine events at fixed steps and animated on the kit loop's game time, so a
 * cutscene freeze stops everything and the same taps give the same show on every phone.
 */
import { noise, sfx, tone } from '../../kit/audio';
import { createGameCanvas } from '../../kit/canvas';
import { clamp, createFx, ease, lerp } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createInput } from '../../kit/input';
import { createLoop } from '../../kit/loop';
import { CLIP_KEYS, CLIP_SRC, createBackdrop, FR, FRAME, FRAME_SCALE, FRAME_TOP, freeTapArt, loadTapArt, STILL_HAS_HAND, STILL_NAMES } from './art';
import { blit, createStickerCache, loadDisplayFont, makeLayer, PAL, renderChip, renderSticker } from './look';
import { drawBarWell, freeLayer, paintCounter, paintFingerprint, paintNote } from './paint';
import { createTapEngine, rankOf, TAP } from './pick';
import { ALIVE, buildLevel, FILLER, IDLE_BIT, seeded } from './schedule';

import type { GameContext, GameInstance, GameModule } from '../types';
import type { Sticker } from './look';
import type { Layer } from './paint';
import type { MilestoneId, TapPhase } from './pick';

// ───────────────────────────── Tuning (cosmetic; the rules are in pick.ts) ─────────────────────────────

const STEP_MS = 1000 / 60;
/** The game clock catches up with the round clock when it falls this far behind. */
const RESYNC_MS = 400;
/** Taps wait for the step that covers their round time, unless the game lags more than this (a 20 fps phone lags ~130 ms). */
const FLUSH_LAG_MS = 250;
/** A touch is stamped with when the finger landed (the event's own timeStamp), at most this far back (a first frame on a slow phone can take ~1 s). */
const MAX_TOUCH_AGE_MS = 1200;
const FP_N = 10;
const NOTE_COLOR_SIZE = 34;
/** Beats queued behind a running one cut it after max(its snap, this). */
const MIN_SNAP_S = 0.7;
const SOFT_GAP_S = 2.5;
const FILLER_QUIET_S = 1.2;
const INNOCENT_GAP_MS = 900;
/** Final frame: one small alive gag every this many seconds. */
const ALIVE_EVERY_S = 2;

// The picking (depth d: 0 the hand is down out of sight, ~0.35 the fingertip at the nostril, 1 deep).
/** Crossfade between two pictures (a still face and the clip, or two stills). */
const FADE_S = 0.14;
/** A still face without the hand shows only once the clip's hand is this far down (no ghost hand). */
const HANDFREE_D = 0.1;
/** Smoothed taps/s -> resting depth, piecewise linear (the engine's hand levels sit at 0.8 / 1.8 / 2.8 / 5 / 8). */
const D_RATE: readonly number[] = [0, 0, 0.8, 0.12, 1.8, 0.36, 2.8, 0.55, 5, 0.8, 8, 0.94, 11, 1];
/** How fast the depth follows its target (rad/s of a critically damped spring: about 0.3 s to settle). */
const D_FOLLOW = 11;
/** The same while the hand gets out of the way of a still face. */
const D_DROP = 14;
/** The depth never moves faster than this (per second): even the innocent whip-out is a motion, not a cut. */
const D_MAX_V = 2.4;
/** Every counted tap: a jab on a stiff spring (in ~60 ms, back in ~150 ms), worth this many clip frames at its peak (~2.5). */
const JAB_V = 1.6;
const JAB_K = 420;
const JAB_C = 30;
const JAB_FRAMES = 58;
/** While deep, the finger digs: the clip rocks (frames each way) and the head turns about the nostril, like a key in a lock. */
const WIGGLE_FRAMES = 3;
const WIGGLE_ROT = 2.4 * (Math.PI / 180);
/** A milestone line stays up at least this long before the next one replaces it (it is read in under a second). */
const LINE_MIN_S = 0.9;
/** The last clip frame: a jab past it comes back softly (the finger is all the way in). */
const CLIP_END = CLIP_SRC[CLIP_SRC.length - 1] ?? 96;
/** In the last 5 seconds the finger stays in at least this deep (the engine's level floor is the knuckle too). */
const LAST_D_FLOOR = 0.55;
/** Final frame per rank: the depth of the clip (rank 1, 2), or a still (rank 0 proud, rank 3 both hands). */
const FINAL_D: readonly number[] = [0, 0.62, 0.86, 1];

// ───────────────────────────── Words (the doll's voice) ─────────────────────────────

const W = {
  start: 'הקישו כדי להתחיל!',
  sneak1: 'לא ראית כלום.',
  sneak2: 'זה לא מה שנראה. זה פילאטיס.',
  yawn: 'נו? יש לי הופעה בבת ים.',
  knock: 'טוק טוק. יש פה מישהו?',
  sleep: 'רק עצמתי עיניים.',
  self: 'טוב. אני מתחיל לבד.',
  auto: 'התחלתי בלעדיך.',
  autoSub: 'נודר.',
  click: 'קליק!',
  pose: 'צלמו מהצד הטוב.',
  /** One per milestone (8, 18, 28, 40, 54, 68, 84, 120, 150 taps): the owner's exclamations between the lines. */
  milestones: ['אש!', 'כורה ביטקוין מחולון.', 'מחורחר!', 'ארכיאולוג. של רשות העתיקות.', 'טפו חמסה!', 'חופר כמו בקו האדום.', 'וואו!', 'מנהרות הכרמל. בלי אגרה.', 'אחשילי.'],
  /** Held at the top speed: the first time, the second time. */
  turbo: ['סגרתי קיסריה.', 'נודר.'],
  notMe: 'לא אני.',
  /** Slow-player lines (FILLER order): the doll is in no hurry, by choice. */
  fillers: [
    ['לאט.', 'כמו ספא בים המלח.'],
    ['כפרה!', 'אייקונים לא ממהרים.'],
    ['קצב של שישי בצהריים.', 'מי ממהר.'],
  ],
  lastSub: 'תן הכול!',
  ranks: ['חוטט מתחיל.', 'חוטט מוסמך.', 'דוקטור לחטטנות.', 'האף של המדינה.'],
  rankSubs: ['גם ביונסה התחילה ככה.', 'תעודה ממוסגרת בסלון.', 'מרצה אורח בטכניון.', 'מחר בכל המהדורות.'],
  wait: 'תראו לשכן. מחכים לכולם.',
} as const;

// ───────────────────────────── Debug (tests) ─────────────────────────────

export interface TapBeatLog {
  readonly id: string;
  /** Counted taps when it started. */
  readonly taps: number;
  /** Round time (ms) it started at. */
  readonly roundMs: number;
  /** ms since the sprint started (negative while waiting). */
  readonly sprintMs: number;
}

export interface TapDebugState {
  readonly fingerprint: string;
  readonly elapsedMs: number;
  readonly phase: TapPhase;
  readonly startWindowMs: number;
  readonly sprintMs: number;
  /** Round time the sprint started / ends at (-1 while waiting). */
  readonly t0: number;
  readonly endAt: number;
  readonly auto: boolean;
  /** Touches received (every finger of every touchstart below the HUD, while not frozen). */
  readonly touches: number;
  /** Round time of every touch given to the engine, in order (at most 600; for replays). */
  readonly touchTimes: readonly number[];
  /** Counted taps = the score. */
  readonly taps: number;
  readonly score: number;
  readonly bounces: number;
  readonly late: number;
  readonly rate: number;
  readonly rateSm: number;
  /** Hand level 0..5 (0 low, 1 rising, 2 at the nostril, 3 knuckle, 4 deep, 5 absurd). */
  readonly level: number;
  /** The picking as drawn: 'hidden' | 'rising' | 'nostril' | 'knuckle' | 'deep' | 'absurd' | 'beat' | 'innocent' | 'final'. */
  readonly hand: string;
  /** The picking depth (0 hand down .. 1 deep) and the clip position it gives (clip frame number, 0..96). */
  readonly depth: number;
  readonly clip: number;
  /** The picture that shows most: a still's name, or 'pick_NN' (the nearest clip frame). */
  readonly frame: string;
  /** The still face over the clip (its name and weight), or null. */
  readonly still: string | null;
  readonly stillW: number;
  readonly beat: string | null;
  /** Seconds into the running beat. */
  readonly beatT: number;
  /** What the sticker band says: a line's name ('milestone-3', 'filler-1', 'not-me', 'rank-2', 'click', ...), 'digit-N', 'start', or null. */
  readonly sticker: string | null;
  /** Seconds the band's sticker has been up. */
  readonly stickerT: number;
  readonly queuedBeats: number;
  /** The last quarter of the sprint ("last 5 seconds") is on. */
  readonly lastQuarter: boolean;
  readonly beats: readonly TapBeatLog[];
  /** Smaller things the player sees: milestone lines, the innocence gag, soft stickers, fillers. */
  readonly events: readonly TapBeatLog[];
  readonly finished: boolean;
  /** Round time when the game called ctx.finish() (-1 = not yet). */
  readonly finishedAtMs: number;
  readonly sprites: {
    readonly fingerprints: number;
    readonly fx: number;
  };
  /** Token centre and radius (CSS px), and the layout bands. */
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly layout: { readonly top: number; readonly bandTop: number; readonly bandBottom: number; readonly tokenTop: number; readonly tokenBottom: number; readonly pileTop: number; readonly counterTop: number; readonly bottom: number; readonly w: number; readonly h: number };
  readonly queued: number;
  /** ctx.hudHeight (old bots read it). */
  readonly hudTop: number;
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

// ───────────────────────────── Helpers ─────────────────────────────

interface Print {
  live: boolean;
  x: number;
  y: number;
  t: number;
  rot: number;
}

/** What the doll does this step: the picking depth (or the beat's), a still face, the token's motion. */
interface Pose {
  /** A still face over the clip, or -1 = the clip alone. */
  still: number;
  /** The beat sets the depth itself (scripted, already smooth), or -1. */
  dSet: number;
  /** A depth the follow spring goes to instead of the rate's (-1 = the rate's). */
  dTarget: number;
  sx: number;
  sy: number;
  rot: number;
  dx: number;
  dy: number;
  /** Picture only (inside the ring). */
  prot: number;
  pscale: number;
  /** No tap squash (the paparazzi freeze). */
  noBob: boolean;
  /** Overrides the label of the picking (a beat, the final frame, the innocence gag). */
  label: string;
}

interface Beat {
  readonly id: string;
  readonly dur: number;
  readonly snap: number;
  t: number;
  cue(prev: number, t: number): void;
  pose(t: number, p: Pose): void;
  end(cut: boolean): void;
}

function crossed(prev: number, t: number, at: number): boolean {
  return prev < at && t >= at;
}

/** 0 -> 1 -> 0 bump over [a, b] (sine). */
function bump(t: number, a: number, b: number): number {
  if (t <= a || t >= b) return 0;
  return Math.sin(((t - a) / (b - a)) * Math.PI);
}

/** Piecewise linear through (t_i, v_i) pairs. */
function keys(t: number, k: readonly number[]): number {
  if (k.length < 2) return k[1] ?? 0;
  if (t <= (k[0] ?? 0)) return k[1] ?? 0;
  for (let i = 2; i < k.length; i += 2) {
    const t1 = k[i] ?? 0;
    if (t <= t1) {
      const t0 = k[i - 2] ?? 0;
      const v0 = k[i - 1] ?? 0;
      const v1 = k[i + 1] ?? 0;
      return lerp(v0, v1, (t - t0) / Math.max(1e-6, t1 - t0));
    }
  }
  return k[k.length - 1] ?? 0;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

const DEG = Math.PI / 180;

// ───────────────────────────── Game ─────────────────────────────

/** The sprint this phone played in this round, kept across a reload (sessionStorage). */
interface SavedSprint {
  readonly t0: number;
  readonly taps: number;
  readonly done: boolean;
  /** Round time when it was written (a later create() at an earlier round time is a new round). */
  readonly at: number;
}

function saveKey(ctx: GameContext): string {
  return `party.tap.${ctx.seed}.${ctx.durationMs}`;
}

function readSaved(ctx: GameContext): SavedSprint | null {
  try {
    const raw = window.sessionStorage.getItem(saveKey(ctx));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedSprint>;
    if (typeof v.t0 !== 'number' || typeof v.taps !== 'number' || typeof v.at !== 'number') return null;
    return { t0: v.t0, taps: v.taps, done: v.done === true, at: v.at };
  } catch {
    return null;
  }
}

function writeSaved(ctx: GameContext, v: SavedSprint | null): void {
  try {
    if (v) window.sessionStorage.setItem(saveKey(ctx), JSON.stringify(v));
    else window.sessionStorage.removeItem(saveKey(ctx));
  } catch {
    // private mode / storage full: a reload then simply starts over
  }
}

export const game: GameModule = {
  id: 'tap',
  // the final frame (the picture per rank and the tap count) IS the "waiting for the others" screen
  ownsFinalScreen: true,
  async create(ctx: GameContext): Promise<GameInstance> {
    const [art] = await Promise.all([loadTapArt(), loadDisplayFont()]);
    const backdrop = createBackdrop(art.background);
    const view = createGameCanvas(ctx.root);
    const input = createInput(view.canvas);
    const fx = createFx(180);

    // When did the finger land? The kit's pointer has no event time, so a capture listener on
    // the game root (it runs before the canvas' own listener) keeps each pointerdown's
    // timeStamp: a touch handled late (a long frame on a slow phone) is still stamped with
    // when it happened, so bunched touches are not thrown away by the minimum gap.
    const downStamp = new Map<number, number>();
    const onDownCapture = (e: PointerEvent): void => {
      downStamp.set(e.pointerId, e.timeStamp);
      if (downStamp.size > 32) downStamp.clear();
    };
    ctx.root.addEventListener('pointerdown', onDownCapture, { capture: true });

    // Round time already gone when we start (slow load / late join), snapped to whole steps.
    let startOffset = clamp(Math.round((ctx.durationMs - ctx.timeLeftMs()) / STEP_MS) * STEP_MS, 0, ctx.durationMs);
    const joinedAt = startOffset;

    // ── engine (rules) ──
    let destroyed = false;
    let finished = false;
    let finishedAtMs = -1;
    let elapsed = startOffset;
    let touches = 0;
    /** Round time of every touch given to the engine (tests replay them through pick.ts). */
    const touchTimes: number[] = [];
    const touchPts: Array<{ x: number; y: number }> = [];

    const engine = createTapEngine(
      ctx.durationMs,
      {
        start: (auto: boolean): void => onStart(auto),
        tap: (n: number): void => onTap(n),
        bounce: (): void => onBounce(),
        late: (): void => onLate(),
        milestone: (id: MilestoneId, index: number): void => onMilestone(id, index),
        level: (from: number, to: number): void => onLevel(from, to),
        last: (): void => onLast(),
        done: (n: number): void => onDone(n),
      },
      joinedAt,
    );
    const timing = engine.timing;

    // A reload in the middle of the round: continue the sprint this phone already played
    // (same start, same taps, same end), or go straight to its final frame. Never a second try.
    const saved = readSaved(ctx);
    let resumed: SavedSprint | null = null;
    if (saved && saved.at <= startOffset + 2000 && saved.t0 <= startOffset + 2000) {
      engine.resume(saved.t0, saved.taps, saved.done || startOffset >= saved.t0 + timing.sprintMs);
      resumed = saved;
    } else if (saved) writeSaved(ctx, null);
    let savedTaps = -1;
    function persist(force: boolean): void {
      const st = engine.state;
      if (st.phase === 'waiting') return;
      if (!force && st.taps - savedTaps < 5) return;
      savedTaps = st.taps;
      writeSaved(ctx, { t0: st.t0, taps: st.taps, done: st.phase === 'done', at: Math.round(elapsed) });
    }
    const level = buildLevel(ctx.seed, ctx.durationMs);
    view.canvas.dataset.level = level.fingerprint;

    // ── pre-rendered words (display font, once); every one is named for the tests ──
    const stickerNames = new Map<Sticker, string>();
    const named = (s: Sticker, id: string): Sticker => {
      stickerNames.set(s, id);
      return s;
    };
    const stStart = renderSticker(W.start, { flat: true, size: 30, fill: PAL.white, burst: PAL.red, shadow: PAL.redD });
    const chipRemark = (t: string): Sticker => renderChip(t, 20, PAL.white, PAL.ink);
    const ckSneak1 = named(chipRemark(W.sneak1), 'sneak1');
    const ckSneak2 = named(chipRemark(W.sneak2), 'sneak2');
    const ckYawn = named(chipRemark(W.yawn), 'yawn');
    const ckKnock = named(chipRemark(W.knock), 'knock');
    const ckSleep = named(chipRemark(W.sleep), 'sleep');
    const ckSelf = named(renderChip(W.self, 20, PAL.cob, PAL.white), 'self');
    const stAuto = named(renderSticker(W.auto, { flat: true, size: 28, sub: W.autoSub, subScale: 0.8, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD }), 'auto');
    const stClick = named(renderSticker(W.click, { size: 34, fill: PAL.white, burst: PAL.red, shadow: PAL.redD }), 'click');
    const stPose = named(renderSticker(W.pose, { size: 28, fill: PAL.white, shadow: PAL.cob }), 'pose');
    // a milestone: the owner's one-word exclamations on a burst, the lines as a plain sticker
    const stMilestones = W.milestones.map((t, i) => {
      const id = `milestone-${i}`;
      if (!t.includes(' ')) return named(renderSticker(t, { size: 36, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD }), id);
      if (t.endsWith('!')) return named(renderSticker(t, { flat: true, size: 32, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD }), id);
      return named(renderSticker(t, { size: 26, fill: PAL.white, shadow: PAL.cob }), id);
    });
    const stTurbo = W.turbo.map((t, i) => named(i === 0 ? renderSticker(t, { size: 30, fill: PAL.white, shadow: PAL.red }) : renderSticker(t, { size: 36, fill: PAL.yel, shadow: PAL.red }), `turbo-${i}`));
    const ckNotMe = named(chipRemark(W.notMe), 'not-me');
    const ckFillers = W.fillers.map(([a, b], i) => named(renderChip(a, 24, PAL.white, PAL.ink, null, b), `filler-${i}`));
    // countdown digits 5..1 (the start window's last 5 s and the sprint's): red star stickers
    const stDigits = [1, 2, 3, 4, 5].map((d) => renderSticker(String(d), { size: 64, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD, tilt: -0.06 }));
    const stDigit5Last = renderSticker('5', { size: 64, sub: W.lastSub, subScale: 0.42, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD, tilt: -0.06 });
    const stRanks = W.ranks.map((t, i) => named(renderSticker(t, { flat: true, size: 30, sub: W.rankSubs[i], subScale: 0.6, fill: PAL.yel, burst: PAL.cob, shadow: PAL.cobD }), `rank-${i}`));
    // the final tap count: a red star sticker on the token (rendered once, at the end)
    let stScore: Sticker | null = null;
    const ckWait = renderChip(W.wait, 17, PAL.yel, PAL.ink);
    const chipCache = createStickerCache(8);

    // ── geometry ──
    const geo = {
      w: 0,
      h: 0,
      top: 0,
      bottom: 0,
      D: 0,
      R: 0,
      cx: 0,
      cy: 0,
      ring: 0,
      bandTop: 0,
      bandBottom: 0,
      bandH: 0,
      pileTop: 0,
      counterTop: 0,
      counterH: 56,
    };
    let geoKey = '';
    function computeGeo(): void {
      const w = view.width;
      const h = view.height;
      const k = `${w}x${h}`;
      if (k === geoKey) return;
      geoKey = k;
      const top = ctx.hudHeight;
      const bottom = h - ctx.safeBottom;
      const areaH = Math.max(120, bottom - top);
      // a very short screen (a phone on its side): no sticker band, a smaller token
      const stickerBand = areaH < 300 ? 0 : clamp(0.18 * areaH, 64, 120);
      // under the token: a little floor (the fingerprints of the glass, nothing to read)
      const floorBand = areaH < 300 ? clamp(0.06 * areaH, 8, 20) : clamp(0.06 * areaH, 16, 48);
      const counterH = areaH < 300 ? 44 : 56;
      const D = clamp(Math.min(w - 36, areaH - stickerBand - floorBand - counterH - 8), 60, 420);
      geo.w = w;
      geo.h = h;
      geo.top = top;
      geo.bottom = bottom;
      geo.D = D;
      geo.R = D / 2;
      geo.ring = 0.035 * D;
      geo.counterH = counterH;
      geo.counterTop = bottom - counterH;
      geo.pileTop = geo.counterTop - floorBand;
      // spare height: 30% goes under the token, the rest stays above (the sticker band)
      const slack = Math.max(0, areaH - stickerBand - floorBand - counterH - 8 - D);
      geo.pileTop -= slack * 0.3;
      geo.cx = w / 2;
      geo.cy = geo.pileTop - 4 - D / 2;
      geo.bandBottom = geo.cy - D / 2 - 4;
      geo.bandH = stickerBand;
      geo.bandTop = Math.max(top, geo.bandBottom - stickerBand);
      rebuildLayers();
    }
    /** Frame point (u, v of a head frame) in CSS px (the frame is FRAME_SCALE * D wide, its top FRAME_TOP * D above the centre). */
    function fx_(u: number): number {
      return geo.cx + (u - 0.5) * FRAME_SCALE * geo.D;
    }
    function fy_(v: number): number {
      return geo.cy - FRAME_TOP * geo.D + v * FRAME_SCALE * geo.D;
    }
    const nx = (): number => fx_(FRAME.nostrilX);
    const ny = (): number => fy_(FRAME.nostrilY);

    // ── pre-rendered layers (per size) ──
    let counter: Layer | null = null;
    const print = paintFingerprint();
    const note = paintNote(NOTE_COLOR_SIZE);
    /** The backdrop at the screen size (one blit per frame). */
    let glass: HTMLCanvasElement | null = null;
    function rebuildLayers(): void {
      const scale = Math.min(2, view.dpr);
      freeLayer(counter);
      counter = paintCounter(geo.w, geo.counterH + ctx.safeBottom, scale);
      if (glass) {
        glass.width = 0;
        glass.height = 0;
      }
      const gl = makeLayer(geo.w, geo.h, scale);
      glass = gl.canvas;
      if (gl.ctx) backdrop.draw(gl.ctx, geo.w, geo.h, scale, geo.cx, geo.cy);
    }

    // ── state ──
    let gt = 0; // game time, s (kit loop)
    let lastScore = -1;
    let lastSfxStep = -1;
    let bobT = 9;
    /** The milestone pop of the token (seconds since). */
    let popT = 9;
    let flash = 0;
    let flashMax = 0.9;
    let flashDur = 0.22;
    let finalShown = false;
    let l5Held = 0;
    let l5Count = 0;
    let l5Fired = false;
    let innocentArmed = true;
    let innocentCount = 0;
    let lastQuarter = false;
    let quietT = 0;
    let fillersUsed = 0;
    let finalT = -1;
    let finalRank = 0;
    let aliveIdx = 0;
    let aliveT = 0;
    let aliveKind = -1;
    let aliveAge = 9;
    let nextIdleAt = timing.startWindowMs * 0.05;
    /** Seconds since the countdown digit changed (its punch-in). */
    let digitT = 9;
    let idleIdx = 0;
    let sneakSeen = 0;
    let countdownDigit = 6;
    let lastDigit = 6;
    let quarterDigit = 6;
    /** The countdown digit on the band: 1..5, or 0 = none. */
    let bandDigit = 0;
    let lastFwip = -9;
    /** The innocence gag: 0 none, 1 the hand drops and he whistles (until the next tap). */
    let inno = 0;

    // ── the picking: one continuous state ──
    /** Depth that follows the rate (or a beat), its velocity; the jab spring; the wiggle phase. */
    let dBase = 0;
    let dVel = 0;
    let jab = 0;
    let jabV = 0;
    let wigPh = 0;
    let wigK = 0;
    /** The depth as drawn (for the labels), the clip position (after the jab and the wiggle), the frame pair and the blend. */
    let pDraw = 0;
    let clipF = 0;
    let clipI = 0;
    let clipT = 0;
    /** Still faces over the clip: the one coming in (cur, weight w) over the one it replaces (prev, pw). */
    const pic = { cur: -1, w: 0, prev: -1, pw: 0 };
    let handLabel = 'hidden';

    const prints: Print[] = [];
    for (let i = 0; i < FP_N; i++) prints.push({ live: false, x: 0, y: 0, t: 0, rot: 0 });
    let printNext = 0;
    let printSerial = 0;

    // ── sticker band ──
    let band: { s: Sticker; t: number; life: number; chip: boolean } | null = null;
    let pendingSoft: { s: Sticker; life: number; age: number; chip: boolean } | null = null;
    /** The next milestone line, while the one before is still being read. */
    let pendingLine: { s: Sticker; life: number } | null = null;
    let lastSoftAt = -99;
    let remark: { s: Sticker; t: number; life: number } | null = null;
    function showSticker(s: Sticker, life = 1.2, chip = false): void {
      band = { s, t: 0, life, chip };
      quietT = 0;
    }
    function softSticker(s: Sticker, life = 1.2, chip = true): void {
      pendingSoft = { s, life, age: 0, chip };
    }
    function showRemark(s: Sticker, life = 1.4): void {
      if (engine.state.phase === 'waiting') remark = { s, t: 0, life };
      else softSticker(s, life, true);
    }

    // ── sounds (kit synth; silent until unlocked, never throws) ──
    function oncePerStep(): boolean {
      if (loop.steps === lastSfxStep) return false;
      lastSfxStep = loop.steps;
      return true;
    }
    function cameraClick(): void {
      noise({ dur: 0.04, vol: 0.4, filter: { type: 'highpass', freq: 2000 } });
      tone({ freq: 2000, dur: 0.03, type: 'square', vol: 0.12 });
    }
    function squeak(f0: number, f1: number, f2: number, dur: number): void {
      tone({ freq: f0, to: f1, dur: dur / 2, type: 'sine', vol: 0.12, vibrato: { depth: 30, rate: 9 } });
      tone({ freq: f1, to: f2, dur: dur / 2, type: 'sine', vol: 0.12, at: dur / 2, vibrato: { depth: 30, rate: 9 } });
    }

    // ── fingerprints on the glass ──
    function addPrint(x: number, y: number): void {
      for (const q of prints) {
        if (q.live && q.t < 0.5 && Math.abs(q.x - x) < 12 && Math.abs(q.y - y) < 12) {
          q.t = 0;
          return;
        }
      }
      const p = prints[printNext];
      printNext = (printNext + 1) % prints.length;
      if (!p) return;
      p.live = true;
      p.x = x;
      p.y = y;
      p.t = 0;
      p.rot = (seeded(ctx.seed, 11, printSerial++) - 0.5) * 1.6;
    }

    // ── pose ──
    const pose: Pose = { still: -1, dSet: -1, dTarget: -1, sx: 1, sy: 1, rot: 0, dx: 0, dy: 0, prot: 0, pscale: 1, noBob: false, label: '' };
    function resetPose(): void {
      pose.still = -1;
      pose.dSet = -1;
      pose.dTarget = -1;
      pose.sx = 1;
      pose.sy = 1;
      pose.rot = 0;
      pose.dx = 0;
      pose.dy = 0;
      pose.prot = 0;
      pose.pscale = 1;
      pose.noBob = false;
      pose.label = '';
    }

    /** The resting depth for the tap rate (with the last-5-seconds floor). */
    function rateDepth(): number {
      const s = engine.state;
      const d = keys(s.rateSm, D_RATE);
      return lastQuarter ? Math.max(LAST_D_FLOOR, d) : d;
    }

    /** Faces of the start window's countdown, for the digits 5..3 (at 2 and 1 his finger starts by itself). */
    const COUNTDOWN_FACE: readonly number[] = [-1, -1, FR.Angry, FR.Surprised, FR.Surprised];
    function levelPose(): void {
      const s = engine.state;
      if (s.phase === 'waiting') {
        const br = 0.01 * Math.sin(gt * Math.PI);
        pose.sx = 1 + br;
        pose.sy = 1 + br;
        pose.dTarget = 0;
        // the countdown: he gets impatient, then his finger is on its way in by itself
        if (countdownDigit <= 5) {
          pose.still = COUNTDOWN_FACE[countdownDigit - 1] ?? -1;
          if (countdownDigit <= 2) pose.dTarget = countdownDigit === 2 ? 0.24 : 0.42;
        }
        return;
      }
      if (s.phase === 'done') return;
      if (lastQuarter) {
        // the last 5 seconds: the head rocks harder and harder with the effort
        const k = clamp((elapsed - (s.endAt - timing.sprintMs * TAP.LAST_SHARE)) / (timing.sprintMs * TAP.LAST_SHARE), 0, 1);
        pose.prot = Math.sin(gt * Math.PI * 2.4) * lerp(2, 5, k) * DEG;
      }
      if (s.level >= 5) {
        // the absurd rate: a tiny shake (speed lines are drawn around the token)
        pose.dx = Math.sin(gt * 97) * 0.004 * geo.D;
        pose.dy = Math.cos(gt * 83) * 0.004 * geo.D;
      }
      if (inno !== 0) {
        // fake innocence: the hand drops, he whistles (the still waits for the hand to be down)
        pose.dTarget = 0;
        pose.still = FR.Whistle;
        pose.label = 'innocent';
      }
    }

    /** Step the picking depth, the jab and the wiggle, and the still faces over the clip. */
    function stepPicture(dt: number): void {
      const s = engine.state;
      let want = pose.still;
      // a still face without the hand waits until the clip's hand is down, and pulls it down
      const handFree = want >= 0 && !STILL_HAS_HAND.has(want);
      let target = pose.dTarget >= 0 ? pose.dTarget : s.phase === 'sprint' ? rateDepth() : 0;
      let follow = D_FOLLOW;
      if (handFree && pose.dSet < 0) {
        target = 0;
        follow = D_DROP;
      }
      if (pose.dSet >= 0) {
        dVel = clamp((pose.dSet - dBase) / dt, -D_MAX_V, D_MAX_V);
        dBase = clamp(dBase + dVel * dt, 0, 1);
      } else {
        const a = follow * follow * (target - dBase) - 2 * follow * dVel;
        dVel = clamp(dVel + a * dt, -D_MAX_V, D_MAX_V);
        dBase = clamp(dBase + dVel * dt, 0, 1);
      }
      if (handFree && dBase > HANDFREE_D) want = pic.cur >= 0 && !STILL_HAS_HAND.has(pic.cur) ? pic.cur : -1;

      // the jab: a stiff spring kicked by every counted tap
      jabV += (-JAB_K * jab - JAB_C * jabV) * dt;
      jab += jabV * dt;
      // the wiggle while deep (faster with the tap rate)
      wigK += (smoothstep(0.55, 0.85, dBase) - wigK) * Math.min(1, dt * 6);
      wigPh += dt * Math.PI * 2 * (1.3 + 0.07 * Math.min(12, s.rateSm));
      const pPrev = pDraw;
      pDraw = dBase;
      // a little "fwip" when the finger goes in
      if (pDraw > 0.4 && pPrev <= 0.4 && gt - lastFwip > 0.5 && s.phase !== 'waiting') {
        lastFwip = gt;
        tone({ freq: 380, to: 760, dur: 0.07, type: 'sine', vol: 0.07 });
      }
      // the jab and the wiggle in clip frames (the same small motion at any depth); past the
      // last frame the finger is all the way in and the jab comes back softly (no frame jump)
      let f = keys(dBase, CLIP_KEYS) + JAB_FRAMES * jab + WIGGLE_FRAMES * wigK * Math.sin(wigPh);
      if (f > CLIP_END) f = CLIP_END - (f - CLIP_END) * 0.5;
      clipF = clamp(f, 0, CLIP_END);
      let i = 0;
      while (i < CLIP_SRC.length - 2 && (CLIP_SRC[i + 1] ?? 0) <= clipF) i++;
      const a0 = CLIP_SRC[i] ?? 0;
      const a1 = CLIP_SRC[i + 1] ?? a0 + 1;
      clipI = i;
      clipT = clamp((clipF - a0) / Math.max(1e-6, a1 - a0), 0, 1);

      // the still faces: crossfade in over what shows, crossfade out to the clip
      const k = dt / FADE_S;
      if (want >= 0 && want !== pic.cur) {
        if (pic.cur >= 0 && pic.w > 0.02) {
          pic.prev = pic.cur;
          pic.pw = pic.w;
        }
        pic.cur = want;
        pic.w = 0;
      }
      const up = want >= 0 && want === pic.cur;
      pic.w = up ? Math.min(1, pic.w + k) : Math.max(0, pic.w - k);
      if (!up && pic.w <= 0) pic.cur = -1;
      if (pic.prev >= 0) {
        if (up && pic.w >= 1) pic.prev = -1;
        else if (!up) pic.pw = Math.max(0, pic.pw - k);
        if (pic.pw <= 0) pic.prev = -1;
      }

      // what the picking shows (for tests and the shots)
      if (pose.label) handLabel = pose.label;
      else if (s.level >= 5) handLabel = 'absurd';
      else if (pDraw < 0.06) handLabel = 'hidden';
      else if (pDraw < 0.3) handLabel = 'rising';
      else if (pDraw < 0.5) handLabel = 'nostril';
      else if (pDraw < 0.75) handLabel = 'knuckle';
      else handLabel = 'deep';
    }
    /** Show a still at once (under the white flash of the camera or the final frame). */
    function snapStill(still: number, d: number): void {
      pic.cur = still;
      pic.w = still >= 0 ? 1 : 0;
      pic.prev = -1;
      pic.pw = 0;
      dBase = d;
      dVel = 0;
    }

    // ── beats ──
    let cur: Beat | null = null;
    const queue: Beat[] = [];
    const beatLog: TapBeatLog[] = [];
    const eventLog: TapBeatLog[] = [];
    function logEvent(id: string): void {
      const s = engine.state;
      if (eventLog.length < 400) eventLog.push({ id, taps: s.taps, roundMs: Math.round(elapsed), sprintMs: s.t0 >= 0 ? Math.max(0, Math.round(elapsed - s.t0)) : -1 });
    }
    function logBeat(id: string): void {
      const s = engine.state;
      // the first touch starts the sprint just before it is counted (it is tap #1)
      if (beatLog.length < 200) beatLog.push({ id, taps: id === 'first' ? Math.max(1, s.taps) : s.taps, roundMs: Math.round(elapsed), sprintMs: s.t0 >= 0 ? Math.max(0, Math.round(elapsed - s.t0)) : -1 });
    }
    function startBeat(b: Beat): void {
      cur = b;
      b.t = 0;
      logBeat(b.id);
      b.cue(-1, 0);
    }
    function enqueue(b: Beat): void {
      if (!cur) startBeat(b);
      else queue.push(b);
    }
    /** Cut everything now and play `b` (start of the sprint, the final frame). */
    function preempt(b: Beat | null): void {
      if (cur) cur.end(true);
      cur = null;
      while (queue.length) queue.shift()?.end(true);
      if (b) startBeat(b);
    }
    function stepBeats(dt: number): void {
      if (cur) {
        const prev = cur.t;
        cur.t += dt;
        cur.cue(prev, cur.t);
        if (cur.t >= cur.dur) {
          cur.end(false);
          cur = null;
        } else if (queue.length > 0 && cur.t >= Math.max(MIN_SNAP_S, cur.snap)) {
          cur.end(true);
          cur = null;
        }
      }
      if (!cur && queue.length > 0) {
        const next = queue.shift();
        if (next) startBeat(next);
      }
    }

    // the waiting bits: the fist knocking, the Z's
    const knock = { on: false, up: 0, punch: 0, cracks: 0 };
    const zzz = { t: 9 };

    function beatSneak(): Beat {
      // the hand sneaks up to the nostril (1.4 s), a little dig, CAUGHT by your stare,
      // the hand drops like nothing happened and he whistles
      return {
        id: 'wait-sneak',
        dur: 3.85,
        snap: 0,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 1.9)) {
            sfx.pop(0.9);
            sneakSeen++;
            showRemark(sneakSeen === 1 ? ckSneak1 : ckSneak2, 1.8);
          }
          if (crossed(prev, t, 2.5)) sfx.whoosh(1.2);
        },
        pose(t, p) {
          p.label = 'beat';
          if (t < 1.4) p.dSet = 0.42 * ease.inOutQuad(t / 1.4);
          else if (t < 1.9) p.dSet = 0.42 + 0.025 * Math.sin((t - 1.4) * Math.PI * 6);
          else if (t < 2.5) {
            p.dSet = 0.42;
            p.still = FR.Caught;
            p.dy = 4 * bump(t, 1.9, 2.05);
          } else if (t < 2.8) p.dSet = 0.42 * (1 - ease.inQuad((t - 2.5) / 0.3));
          else {
            p.dSet = 0;
            p.still = FR.Whistle;
          }
        },
        end() {},
      };
    }
    function beatYawn(): Beat {
      return {
        id: 'wait-yawn',
        dur: 1.6,
        snap: 0,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) {
            tone({ freq: 220, to: 140, dur: 0.6, type: 'triangle', vol: 0.16 });
            showRemark(ckYawn, 1.8);
          }
        },
        pose(t, p) {
          p.label = 'beat';
          p.still = t < 1.45 ? FR.Bored : -1;
          if (t < 0.7) {
            const k = ease.inOutQuad(t / 0.7);
            p.sy *= lerp(1, 1.08, k);
            p.sx *= lerp(1, 0.94, k);
          } else if (t < 1.0) {
            p.sy *= 0.95;
            p.sx *= 1.05;
          } else {
            const k = clamp((t - 1.0) / 0.2, 0, 1);
            p.sy *= lerp(0.95, 1, k);
            p.sx *= lerp(1.05, 1, k);
          }
        },
        end() {},
      };
    }
    function beatKnock(): Beat {
      // his fist comes up to the glass and knocks three times (a crack star on the glass at
      // each knock), then he squashes his face to the glass to look for you
      return {
        id: 'wait-knock',
        dur: 2.3,
        snap: 0,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) showRemark(ckKnock, 2.2);
          for (let i = 0; i < 3; i++) {
            if (crossed(prev, t, 0.35 + i * 0.22)) {
              sfx.tap(0.7);
              haptic.tap();
              fx.shake(3, 90);
              knock.cracks = i + 1;
            }
          }
          if (crossed(prev, t, 1.2)) squeak(520, 380, 300, 0.25);
        },
        pose(t, p) {
          p.still = t < 1.15 ? FR.Angry : t < 2.15 ? FR.GlassPress : -1;
          if (t >= 1.15 && t < 2.15) p.pscale = lerp(1, 1.06, ease.outBack(clamp((t - 1.15) / 0.25, 0, 1)) * (1 - clamp((t - 1.95) / 0.2, 0, 1)));
          // the fist: up from below (0.3 s), three knocks (a punch towards the glass), down
          knock.on = t < 1.15;
          knock.up = t < 0.3 ? ease.outBack(t / 0.3) : t < 0.95 ? 1 : 1 - ease.inQuad(clamp((t - 0.95) / 0.2, 0, 1));
          let k = 0;
          for (let i = 0; i < 3; i++) k = Math.max(k, bump(t, 0.3 + i * 0.22, 0.42 + i * 0.22));
          knock.punch = k;
          p.label = 'beat';
        },
        end() {
          knock.on = false;
          knock.cracks = 0;
        },
      };
    }
    function beatSleep(): Beat {
      // he dozes off (eyes shut, snoring, Z's rising), then jolts awake: "I just closed my eyes"
      return {
        id: 'wait-sleep',
        dur: 2.9,
        snap: 0,
        t: 0,
        cue(prev, t) {
          for (let i = 0; i < 2; i++) if (crossed(prev, t, 0.2 + i * 0.85)) tone({ freq: 110, to: 70, dur: 0.6, type: 'sawtooth', vol: 0.07, lowpass: 400 });
          if (crossed(prev, t, 2.0)) {
            sfx.pop(1.3);
            haptic.bump();
            showRemark(ckSleep, 1.6);
          }
        },
        pose(t, p) {
          p.label = 'beat';
          if (t < 2.0) {
            p.still = FR.Squeeze;
            const br = Math.sin(((t - 0.2) / 0.85) * Math.PI * 2);
            p.sy *= 1 + 0.025 * br;
            p.sx *= 1 + 0.015 * br;
            p.prot = 7 * DEG * ease.inOutQuad(clamp(t / 0.8, 0, 1)) * (1 - ease.inOutQuad(clamp((t - 1.8) / 0.2, 0, 1)));
            zzz.t = t;
          } else {
            p.still = t < 2.75 ? FR.Surprised : -1;
            p.dy = -12 * bump(t, 2.0, 2.25);
            zzz.t = 9;
          }
        },
        end() {
          zzz.t = 9;
        },
      };
    }

    function beatAutoStart(): Beat {
      let d0 = 0;
      return {
        id: 'autostart',
        dur: 1.2,
        snap: 0.4,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) {
            d0 = dBase;
            fx.burst(nx(), ny(), { count: 14, speed: 380, size: 6, life: 0.6, gravity: 300, shape: 'star', colors: [PAL.yel, PAL.white] });
            sfx.go();
            haptic.bump();
            showSticker(stAuto, 1.2);
          }
        },
        pose(t, p) {
          // his finger goes in by itself (the hand was already on its way at the countdown)
          if (t < 0.6) p.dSet = lerp(d0, 0.7, ease.outBack(clamp(t / 0.3, 0, 1)));
          p.dy = -10 * bump(t, 0, 0.26);
          p.sy *= keys(t, [0, 0.9, 0.12, 1.05, 0.26, 1]);
          p.label = 'beat';
        },
        end() {},
      };
    }
    function beatFirst(): Beat {
      // the paparazzi: a flash, CAUGHT with the finger at the nostril, and he poses
      return {
        id: 'first',
        dur: 1.26,
        snap: 0.5,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) {
            flash = 1;
            flashMax = 0.9;
            flashDur = 0.22;
            cameraClick();
            haptic.bump();
            showSticker(stClick, 0.6);
            // under the flash: the finger is at the nostril, his stare into the camera
            snapStill(FR.Caught, 0.44);
          }
          if (crossed(prev, t, 0.55)) showSticker(stPose, 1.1);
        },
        pose(t, p) {
          if (t < 0.55) {
            p.still = FR.Caught;
            p.dSet = 0.44;
            p.noBob = true;
          }
          p.label = 'beat';
        },
        end() {},
      };
    }

    /**
     * The final frame, per rank: a picture to show the person next to you (rank 0 the proud
     * face, ranks 1-2 the clip with the finger in, rank 3 both hands), the tap count on a red
     * star sticker on the token, the rank and its line on the band above.
     */
    function beatFinal(): Beat {
      return {
        id: 'final',
        dur: 1e9,
        snap: 1e9,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) {
            sfx.beep();
            haptic.success();
            flash = 1;
            flashMax = 0.8;
            flashDur = 0.3;
            knock.on = false;
            const taps = engine.state.taps;
            finalRank = rankOf(taps, timing.tapScale);
            const st = stRanks[finalRank];
            if (st) showSticker(st, 1e9);
            stScore = renderSticker(String(taps), { size: Math.max(22, Math.round(geo.D * 0.15)), fill: PAL.yel, burst: PAL.red, shadow: PAL.redD, tilt: -0.08 });
            // the picture changes under the flash
            snapStill(finalStill(), FINAL_D[finalRank] ?? 0);
          }
          if (crossed(prev, t, 0.35)) {
            sfx.land(1.1);
            fx.burst(geo.cx, fy_(0.02), { count: 12, speed: 260, size: 6, life: 0.5, gravity: 300, shape: 'star', colors: [PAL.yel, PAL.white] });
            finalShown = true;
          }
          if (crossed(prev, t, 0.55)) {
            if (finalRank >= 2) sfx.cheer();
            else sfx.laugh(1.1);
          }
        },
        pose(t, p) {
          p.label = 'final';
          p.still = finalStill();
          // the clip ranks keep the finger in; a dig now and then (the alive gag)
          const d = FINAL_D[finalRank] ?? 0;
          const wig = aliveKind === ALIVE.Wiggle && aliveAge < 0.6 ? 0.05 * Math.sin((aliveAge / 0.6) * Math.PI * 3) : 0;
          p.dSet = p.still >= 0 ? d : clamp(d + wig, 0, 1);
          if (t >= 0.35) p.sy *= keys(t - 0.35, [0, 0.94, 0.1, 1.04, 0.25, 1]);
          if (aliveKind === ALIVE.Nod && aliveAge < 0.8) p.prot = Math.sin((aliveAge / 0.8) * Math.PI * 2) * 4 * DEG;
          if (aliveKind === ALIVE.Bob && aliveAge < 0.3) p.sy *= 1 - 0.04 * bump(aliveAge, 0, 0.3);
          if (aliveKind === ALIVE.Wiggle && aliveAge < 0.6 && p.still >= 0) p.rot += 2 * DEG * Math.sin((aliveAge / 0.6) * Math.PI * 3);
        },
        end() {},
      };
    }
    function finalStill(): number {
      if (finalRank <= 0) return FR.Proud;
      if (finalRank >= 3) return FR.Double;
      return -1;
    }

    // ── engine events ──
    function onStart(auto: boolean): void {
      remark = null;
      band = null;
      if (auto) preempt(beatAutoStart());
      else preempt(beatFirst());
      persist(true);
    }

    function onTap(n: number): void {
      const p = touchPts.shift();
      if (p) addPrint(p.x, p.y);
      const s = engine.state;
      innocentArmed = true;
      if (lastScore !== n) {
        lastScore = n;
        ctx.setScore(n);
      }
      persist(false);
      // the jab (looks only), a gentle squash, a blip, a buzz
      jabV += JAB_V;
      bobT = 0;
      if (oncePerStep()) {
        tone({ freq: 300 + 50 * Math.min(14, s.rate), dur: 0.06, type: 'triangle', vol: 0.13 });
        haptic.tap();
      }
      if (inno !== 0) inno = 0;
    }
    function onBounce(): void {
      touchPts.shift();
    }
    function onLate(): void {
      const p = touchPts.shift();
      if (p) addPrint(p.x, p.y);
      if (oncePerStep()) tone({ freq: 700, to: 500, dur: 0.06, type: 'sine', vol: 0.04 });
    }
    function onMilestone(id: MilestoneId, index: number): void {
      logEvent(`milestone-${id}`);
      fx.burst(nx(), ny(), { count: lastQuarter ? 10 : 8, speed: 300, size: 6, life: 0.5, gravity: 400, shape: 'star', colors: [PAL.yel, PAL.white] });
      sfx.pop(1.3);
      haptic.bump();
      popT = 0;
      // in the last 5 seconds the countdown owns the band: the stars and the pop are enough
      if (lastQuarter) return;
      const st = stMilestones[index];
      if (!st) return;
      if (band && band.t < LINE_MIN_S) pendingLine = { s: st, life: 1.3 };
      else showSticker(st, 1.3);
    }
    function onLevel(from: number, to: number): void {
      if (from >= 3 && to <= 1) triggerInnocence();
    }
    function onLast(): void {
      lastQuarter = true;
      // what is waiting does not start any more; a running beat finishes
      while (queue.length) queue.shift()?.end(true);
      pendingSoft = null;
      pendingLine = null;
      inno = 0;
      logEvent('last');
    }
    function onDone(n: number): void {
      pendingSoft = null;
      pendingLine = null;
      lastScore = n;
      ctx.setScore(n);
      inno = 0;
      preempt(beatFinal());
      finalT = 0;
      view.canvas.dataset.tapFinal = '1';
      persist(true);
      if (!finished) {
        finished = true;
        finishedAtMs = Math.round(elapsed);
        ctx.finish();
      }
    }
    function triggerInnocence(): void {
      if (cur || inno !== 0 || lastQuarter || engine.state.phase !== 'sprint') return;
      inno = 1;
      innocentArmed = false;
      logEvent('innocent');
      innocentCount++;
      sfx.whoosh(1.3);
      if (innocentCount === 1 || innocentCount === 3 || innocentCount === 5) softSticker(ckNotMe, 1.2, true);
    }

    // ── input: stamp with the round time, the engine applies it at its step ──
    input.onDown((p) => {
      if (destroyed || ctx.isPaused() || p.y < ctx.hudHeight) return;
      touches++;
      touchPts.push({ x: p.x, y: p.y });
      if (touchPts.length > 64) touchPts.shift();
      // stamp: the round time when the finger landed (the event's own time, not when we got it)
      const stamp = downStamp.get(p.id);
      downStamp.delete(p.id);
      const age = stamp === undefined ? 0 : clamp(performance.now() - stamp, 0, MAX_TOUCH_AGE_MS);
      const t = ctx.durationMs - ctx.timeLeftMs() - age;
      if (touchTimes.length < 600) touchTimes.push(t);
      engine.tap(t, 1);
    });

    // ── waiting timeline (round time) ──
    function stepWaiting(): void {
      const s = engine.state;
      if (s.phase !== 'waiting') return;
      const W0 = timing.startWindowMs;
      // the 5-4-3-2-1 before the sprint starts by itself: a second a digit where the window has
      // the room (the 8 s window: 3 s free, then the five digits), never more than 5/8 of the window
      const cdLen = Math.max(W0 / 6, Math.min(5_000, W0 * 0.625));
      const cdStart = W0 - cdLen;
      const notch = cdLen / 5;
      if (elapsed >= cdStart) {
        const d = clamp(5 - Math.floor((elapsed - cdStart) / notch), 1, 5);
        countdownDigit = d;
        if (d !== lastDigit) {
          lastDigit = d;
          if (cur && cur.id.startsWith('wait-')) preempt(null);
          digitT = 0;
          sfx.tick(1 + (5 - d) * 0.1);
          haptic.tap();
          fx.shake(2 + (5 - d), 200);
          remark = d === 2 ? { s: ckSelf, t: 0, life: 2.2 } : null;
        }
        return;
      }
      // one bit every 11% of the window, never closer than 2.5 s, all four before any repeats; a
      // bit that is still running pushes the next one back a little instead of skipping it
      if (elapsed >= nextIdleAt) {
        if (cur || queue.length > 0) nextIdleAt = elapsed + 300;
        else {
          nextIdleAt = elapsed + Math.max(2_500, timing.startWindowMs * 0.11);
          if (elapsed + 2200 < cdStart) {
            const b = level.idleBits[idleIdx % level.idleBits.length] ?? IDLE_BIT.Yawn;
            idleIdx++;
            enqueue(idleBeat(b));
          }
        }
      }
    }
    function idleBeat(b: number): Beat {
      switch (b) {
        case IDLE_BIT.Sneak:
          return beatSneak();
        case IDLE_BIT.Knock:
          return beatKnock();
        case IDLE_BIT.Sleep:
          return beatSleep();
        default:
          return beatYawn();
      }
    }

    // ── loop ──
    const trace = Array.isArray(window.__tapTrace) ? window.__tapTrace : null;
    const loop = createLoop({
      update(dt: number): void {
        computeGeo();
        gt = loop.timeMs / 1000;
        // Behind the round clock (the page slept: locked phone, another app, very long frames)?
        // Catch up so the round stays in step with everyone else's; the skipped part is lost.
        const roundElapsed = ctx.durationMs - ctx.timeLeftMs();
        if (roundElapsed - (startOffset + loop.timeMs) > RESYNC_MS) {
          startOffset = Math.round((roundElapsed - loop.timeMs) / STEP_MS) * STEP_MS;
        }
        elapsed = startOffset + loop.timeMs;
        engine.step(elapsed, roundElapsed - elapsed > FLUSH_LAG_MS);
        const s = engine.state;

        // HUD clock: the start window, then the personal sprint
        if (ctx.setClock) {
          if (s.phase === 'waiting') ctx.setClock(Math.max(0, timing.startWindowMs - elapsed), timing.startWindowMs);
          else if (s.phase === 'sprint') ctx.setClock(Math.max(0, s.endAt - elapsed), timing.sprintMs);
          else ctx.setClock(0, timing.sprintMs);
        }

        stepWaiting();
        stepBeats(dt);

        // timers
        bobT += dt;
        popT += dt;
        flash = Math.max(0, flash - dt / Math.max(0.05, flashDur));
        digitT += dt;
        if (band) {
          band.t += dt;
          if (band.t >= band.life) band = null;
        }
        if (remark) {
          remark.t += dt;
          if (remark.t >= remark.life) remark = null;
        }
        if (pendingLine && (!band || band.t >= LINE_MIN_S)) {
          if (!lastQuarter) showSticker(pendingLine.s, pendingLine.life);
          pendingLine = null;
        }
        if (pendingSoft) {
          pendingSoft.age += dt;
          if (pendingSoft.age > 5) pendingSoft = null;
          else if (!band && gt - lastSoftAt >= SOFT_GAP_S) {
            showSticker(pendingSoft.s, pendingSoft.life, pendingSoft.chip);
            logEvent('soft-sticker');
            lastSoftAt = gt;
            pendingSoft = null;
          }
        }

        // fake innocence (sprint only, never during a beat, not in the last 5 seconds)
        if (s.phase === 'sprint' && !lastQuarter && inno === 0 && innocentArmed && !cur) {
          if (s.lastTapMs >= 0 && elapsed - Math.max(s.lastTapMs, s.t0) > INNOCENT_GAP_MS) triggerInnocence();
          else if (s.lastTapMs < 0 && elapsed - s.t0 > INNOCENT_GAP_MS + 600) triggerInnocence();
        }

        // the top speed held: his lines
        if (s.phase === 'sprint' && s.level >= 5 && !lastQuarter) {
          if (!cur) l5Held += dt;
          // (it waits for a gap between the milestone lines)
          if (!l5Fired && l5Held >= 1.5 && !band && !pendingLine) {
            l5Fired = true;
            const st = stTurbo[l5Count];
            l5Count++;
            if (st) {
              showSticker(st, 1.3);
              logEvent(`turbo-${l5Count - 1}`);
            }
          }
        } else {
          l5Held = 0;
          l5Fired = false;
        }

        // slow-player lines (the doll is in no hurry)
        if (s.phase === 'sprint') {
          if (band || cur) quietT = 0;
          else quietT += dt;
          if (quietT >= FILLER_QUIET_S && !cur && !lastQuarter && s.rateSm < 5 && fillersUsed < level.fillers.length) {
            const f = level.fillers[fillersUsed] ?? FILLER.Spa;
            fillersUsed++;
            quietT = 0;
            const ck = ckFillers[f];
            if (ck) showSticker(ck, 1.6, true);
            logEvent(`filler-${f}`);
          }
        }

        // the countdown digit on the band: the start window's last 5 s, the sprint's last 5 s
        if (s.phase === 'waiting') bandDigit = countdownDigit <= 5 ? countdownDigit : 0;
        else if (s.phase === 'sprint' && lastQuarter) {
          const q = timing.sprintMs * TAP.LAST_SHARE;
          const d = clamp(Math.ceil(((s.endAt - elapsed) / q) * 5), 1, 5);
          if (d !== quarterDigit) {
            quarterDigit = d;
            digitT = 0;
            sfx.tick(1 + (5 - d) * 0.1);
            haptic.tap();
            logEvent(`digit-${d}`);
          }
          bandDigit = d;
        } else bandDigit = 0;

        // final frame: alive but never changing the shot
        if (finalT >= 0) {
          finalT += dt;
          aliveT += dt;
          aliveAge += dt;
          if (aliveT >= ALIVE_EVERY_S) {
            aliveT = 0;
            aliveAge = 0;
            aliveKind = level.alive[aliveIdx % level.alive.length] ?? ALIVE.Nod;
            aliveIdx++;
            if (aliveKind === ALIVE.Nod) squeak(520, 420, 320, 0.2);
            else if (aliveKind === ALIVE.Bob) sfx.pop(0.8);
          }
        }

        // pose: the picking, the waiting / innocence faces, then the running beat
        resetPose();
        levelPose();
        if (cur) {
          // a beat owns the doll: no absurd-rate shake
          pose.dx = 0;
          pose.dy = 0;
          cur.pose(cur.t, pose);
        }
        stepPicture(dt);

        for (const p of prints) {
          if (!p.live) continue;
          p.t += dt;
          if (p.t >= 1.5) p.live = false;
        }
        fx.update(dt);

        if (trace && loop.steps % 30 === 0 && trace.length < 400) {
          trace.push(`${Math.round(elapsed / STEP_MS)}|${s.phase}|${s.rate.toFixed(3)}|${s.level}|${s.taps}|${cur ? cur.id : '-'}|${pDraw.toFixed(3)}`);
        }
      },
      render(): void {
        computeGeo();
        draw();
      },
    });

    // ── drawing ──
    /**
     * The doll's picture is blended at the frames' own size into one canvas, only when it
     * changed (the blend weights in 1/48 steps, finer than the eye sees): the screen then gets
     * ONE scaled drawImage per frame, as with a single head frame, and nothing at all is
     * blended while the doll holds still (waiting, the final frame).
     */
    const PIC_Q = 48;
    let picCanvas: HTMLCanvasElement | null = null;
    let picCtx: CanvasRenderingContext2D | null = null;
    let picKey = '';
    function layer(c: CanvasRenderingContext2D, d: HTMLCanvasElement | undefined, alpha: number, first: boolean): boolean {
      if (!d || alpha <= 0) return first;
      c.globalCompositeOperation = first ? 'copy' : 'source-over';
      c.globalAlpha = first ? 1 : alpha;
      c.drawImage(d, 0, 0, c.canvas.width, c.canvas.height);
      return false;
    }
    function renderPicture(): HTMLCanvasElement | null {
      const size = art.clip[0]?.source.width ?? 0;
      if (size <= 0) return null;
      if (!picCanvas) {
        picCanvas = document.createElement('canvas');
        picCanvas.width = size;
        picCanvas.height = size;
        picCtx = picCanvas.getContext('2d');
      }
      const c = picCtx;
      if (!c) return null;
      const tq = Math.round(clipT * PIC_Q);
      const wq = pic.cur >= 0 ? Math.round(pic.w * PIC_Q) : 0;
      const pq = pic.prev >= 0 ? Math.round(pic.pw * PIC_Q) : 0;
      const key = `${clipI}|${tq}|${pic.prev}|${pq}|${pic.cur}|${wq}`;
      if (key === picKey) return picCanvas;
      picKey = key;
      let first = true;
      // a still fully in front hides everything under it
      if (!(wq >= PIC_Q && pq === 0)) {
        if (tq < PIC_Q) first = layer(c, art.clip[clipI]?.source, 1, first);
        if (tq > 0) first = layer(c, art.clip[clipI + 1]?.source, tq / PIC_Q, first);
        if (pq > 0) first = layer(c, art.stills[pic.prev]?.source, pq / PIC_Q, first);
      }
      if (wq > 0) first = layer(c, art.stills[pic.cur]?.source, wq / PIC_Q, first);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      return picCanvas;
    }

    /** The doll: the clip (two nearest frames crossfaded) with the stills over it, in one draw. */
    function drawPicture(g: CanvasRenderingContext2D): void {
      const S = FRAME_SCALE * geo.D;
      const src = renderPicture();
      if (src) g.drawImage(src, geo.cx - S / 2, geo.cy - FRAME_TOP * geo.D, S, S);
    }

    function drawToken(g: CanvasRenderingContext2D): void {
      const { cx, cy, D, R } = geo;
      const p = pose;
      // a gentle squash on every tap, the milestone pop, on top of the pose
      let sy = p.sy;
      let sx = p.sx;
      if (!p.noBob && bobT < 0.12) {
        const b = 0.015 * Math.sin((bobT / 0.12) * Math.PI);
        sy *= 1 - b;
        sx *= 1 + b;
      }
      if (popT < 0.32) {
        const k = keys(popT, [0, 1, 0.08, 1.06, 0.22, 0.985, 0.32, 1]);
        sx *= k;
        sy *= k;
      }
      g.save();
      g.translate(cx + p.dx, cy + p.dy);
      if (p.rot !== 0) g.rotate(p.rot);
      g.scale(sx, sy);
      g.translate(-cx, -cy);
      // the hard ink shadow (one filled circle, it moves with the token), then the cream disc
      g.fillStyle = PAL.ink;
      g.beginPath();
      g.arc(cx + 5, cy + 6, R, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#FFF6E0';
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fill();
      // the picture: every head frame is pre-cut to the circle (art.ts), so a plain drawImage
      // is a perfect porthole; the wiggle turns it a hair about the nostril
      const wr = WIGGLE_ROT * wigK * Math.sin(wigPh + 0.8) * (pic.cur >= 0 ? 1 - pic.w : 1);
      const turned = p.prot !== 0 || p.pscale !== 1 || Math.abs(wr) > 1e-4;
      if (turned) {
        g.save();
        g.translate(cx, cy);
        g.rotate(p.prot);
        const ps = Math.min(1.065, p.pscale);
        g.scale(ps, ps);
        g.translate(-cx, -cy);
        if (Math.abs(wr) > 1e-4) {
          const nX = nx();
          const nY = ny();
          g.translate(nX, nY);
          g.rotate(wr);
          g.translate(-nX, -nY);
        }
      }
      drawPicture(g);
      if (turned) g.restore();

      // the knocking fist comes up from below the rim: it needs the porthole
      if (knock.on && knock.up > 0.01) {
        g.save();
        g.beginPath();
        g.arc(cx, cy, R - geo.ring * 0.5, 0, Math.PI * 2);
        g.clip();
        const fw = 0.34 * D * (1 + 0.14 * knock.punch);
        const fh = (fw * art.fist.height) / art.fist.width;
        art.fist.draw(g, cx + 0.25 * D, cy + R + fh * 0.5 - knock.up * (fh * 0.5 + 0.26 * D), fw, fh, -0.12);
        g.restore();
      }
      // crack stars on the glass where he knocked
      if (knock.on && knock.cracks > 0) {
        g.lineCap = 'round';
        g.beginPath();
        for (let c = 0; c < knock.cracks; c++) {
          const kx = cx + (0.36 - c * 0.08) * D;
          const ky = cy + (-0.02 + c * 0.05) * D;
          for (let i = 0; i < 6; i++) {
            const a = i * 1.05 + c;
            const l = (0.05 + 0.03 * ((i + c) % 3)) * D;
            g.moveTo(kx, ky);
            g.lineTo(kx + Math.cos(a) * l, ky + Math.sin(a) * l);
          }
        }
        g.strokeStyle = PAL.ink;
        g.lineWidth = 5;
        g.stroke();
        g.strokeStyle = PAL.white;
        g.lineWidth = 2.5;
        g.stroke();
      }
      // the ink ring, last
      g.lineWidth = geo.ring;
      g.strokeStyle = PAL.ink;
      g.beginPath();
      g.arc(cx, cy, R - geo.ring * 0.5, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    function drawBand(g: CanvasRenderingContext2D): void {
      const s = engine.state;
      if (geo.bandH <= 0) return;
      const maxW = geo.w * 0.86;
      // stickers may grow into the free glass above the band (up to 1.5 bands)
      const maxH = Math.max(geo.bandH, Math.min(geo.bandBottom - geo.top - 6, geo.bandH * 1.5));
      const centreFor = (h: number): number => geo.bandBottom - Math.min(maxH, Math.max(h, geo.bandH)) / 2;
      // the countdown digit (last 5 s of the wait, last 5 s of the sprint): a red star sticker
      // that punches in every second; it never covers the doll
      if (bandDigit > 0) {
        const st = s.phase === 'sprint' && bandDigit === 5 ? stDigit5Last : stDigits[bandDigit - 1];
        if (st) {
          const fit = Math.min(maxW / st.w, maxH / st.h, (0.36 * geo.D) / (st.h * 0.62));
          const punch = 1 + 0.4 * (1 - ease.outBack(clamp(digitT / 0.22, 0, 1)));
          blit(g, st, geo.w / 2, centreFor(st.h * fit), fit * punch);
        }
        if (remark && s.phase === 'waiting') drawRemark(g, remark, geo.top + 4, maxW);
        return;
      }
      if (s.phase === 'waiting') {
        // a remark replaces the start sticker for its time; otherwise the start sticker pulses
        if (remark) {
          const r = remark;
          const f = Math.min(1.3, maxW / r.s.w, maxH / r.s.h);
          drawRemark(g, r, centreFor(r.s.h * f) - (r.s.h * f) / 2, maxW, 1.3);
          return;
        }
        const fit = Math.min(1.15, maxW / stStart.w, maxH / stStart.h);
        const pulse = 1 + 0.03 * (1 + Math.sin(gt * Math.PI * 3));
        blit(g, stStart, geo.w / 2, centreFor(stStart.h * fit), fit * pulse);
        return;
      }
      if (!band) return;
      const b = band;
      const fit = Math.min(1.1, maxW / b.s.w, maxH / b.s.h);
      const cyBand = centreFor(b.s.h * fit);
      const inK = clamp(b.t / 0.25, 0, 1);
      const sc = ease.outBack(inK) * (b.chip ? 1 : 1 + Math.sin(gt * 9) * 0.02);
      g.globalAlpha = b.life - b.t < 0.2 ? clamp((b.life - b.t) / 0.2, 0, 1) : 1;
      blit(g, b.s, geo.w / 2, cyBand, sc * fit);
      g.globalAlpha = 1;
    }
    /** A remark chip with its top at `top`, popping in and fading out. */
    function drawRemark(g: CanvasRenderingContext2D, r: { s: Sticker; t: number; life: number }, top: number, maxW: number, maxK = 1): void {
      const k = r.t / r.life;
      const f = Math.min(maxK, maxW / r.s.w);
      g.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
      blit(g, r.s, geo.w / 2, Math.max(geo.top + 4, top) + (r.s.h * f) / 2, f * ease.outBack(clamp(r.t / 0.2, 0, 1)));
      g.globalAlpha = 1;
    }

    function drawCounter(g: CanvasRenderingContext2D): void {
      const s = engine.state;
      const top = geo.counterTop;
      if (counter) g.drawImage(counter.canvas, 0, top, counter.w, counter.h);
      const y = top + 12 + (geo.counterH - 12) / 2;
      let chip: Sticker;
      if (s.phase === 'waiting') {
        const secs = Math.max(0, Math.ceil((timing.startWindowMs - elapsed) / 1000));
        chip = chipCache.get(`w${secs}`, (old) => renderChip(`מתחיל לבד בעוד ${secs}`, 16, PAL.white, PAL.ink, old));
      } else if (s.phase === 'sprint') {
        const secs = Math.max(0, Math.ceil((s.endAt - elapsed) / 1000));
        const red = lastQuarter;
        chip = chipCache.get(`s${secs}${red ? 'r' : ''}`, (old) => renderChip(String(secs), 20, red ? PAL.red : PAL.yel, red ? PAL.white : PAL.ink, old));
      } else {
        const f = Math.min(1, (geo.w - 20) / ckWait.w);
        blit(g, ckWait, geo.w / 2, y, f);
        return;
      }
      const f = Math.min(1, (geo.w * 0.6) / chip.w);
      const chipW = chip.w * f;
      blit(g, chip, geo.w - 12 - chipW / 2, y, f);
      // the sprint bar: drains towards the chip (right), Hebrew reading order
      const left = 14;
      const right = geo.w - 12 - chipW - 10;
      const barW = Math.max(30, right - left);
      const barH = 18;
      drawBarWell(g, left, y - barH / 2, barW, barH);
      let frac = 0;
      if (s.phase === 'sprint') frac = clamp((s.endAt - elapsed) / timing.sprintMs, 0, 1);
      if (frac > 0) {
        const blink = lastQuarter && Math.sin(gt * Math.PI * 8) < 0;
        g.fillStyle = lastQuarter ? (blink ? PAL.redD : PAL.red) : PAL.yel;
        g.fillRect(left + barW * (1 - frac) + 2, y - barH / 2 + 2, Math.max(0, barW * frac - 4), barH - 4);
      }
      g.lineWidth = 2.5;
      g.strokeStyle = PAL.ink;
      g.beginPath();
      g.moveTo(left + barH / 2, y - barH / 2);
      g.arcTo(left + barW, y - barH / 2, left + barW, y + barH / 2, barH / 2);
      g.arcTo(left + barW, y + barH / 2, left, y + barH / 2, barH / 2);
      g.arcTo(left, y + barH / 2, left, y - barH / 2, barH / 2);
      g.arcTo(left, y - barH / 2, left + barW, y - barH / 2, barH / 2);
      g.closePath();
      g.stroke();
    }

    /** The waiting screen's hint: a white hand taps the glass five times a second, rings spread. */
    function drawGhost(g: CanvasRenderingContext2D): void {
      const cycle = (gt % 0.2) / 0.2;
      const press = cycle < 0.4 ? ease.inQuad(cycle / 0.4) : 1 - ease.outQuad((cycle - 0.4) / 0.6);
      const tipX = geo.cx + 0.33 * geo.D;
      const tipY = geo.cy + 0.3 * geo.D;
      const lift = (1 - press) * 0.05 * geo.D;
      const gw = 0.2 * geo.D;
      const gh = (gw * art.ghost.height) / art.ghost.width;
      if (cycle < 0.5) {
        g.globalAlpha = 0.9 * (1 - cycle * 2);
        g.strokeStyle = PAL.white;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(tipX, tipY, 8 + cycle * 40, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.save();
      g.translate(tipX + lift * 0.4, tipY + lift);
      g.rotate(-0.35);
      // the fingertip of the drawn hand is at (0.5 w, 0.04 h)
      art.ghost.draw(g, 0, gh * 0.46, gw, gh);
      g.restore();
    }

    function draw(): void {
      const g = view.ctx;
      const { w, h } = geo;
      const s = engine.state;
      if (glass) {
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(glass, 0, 0);
        g.restore();
      }

      g.save();
      fx.applyShake(g);
      const absurd = handLabel === 'absurd' && !cur && s.phase === 'sprint';
      // the absurd rate: speed lines around the token (outside the ring)
      if (absurd) {
        g.strokeStyle = PAL.ink;
        g.lineWidth = 3;
        g.lineCap = 'round';
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + 0.2;
          const r0 = geo.R + 8 + ((gt * 160 + i * 9) % 14);
          g.moveTo(geo.cx + Math.cos(a) * r0, geo.cy + Math.sin(a) * r0);
          g.lineTo(geo.cx + Math.cos(a) * (r0 + 0.07 * geo.D), geo.cy + Math.sin(a) * (r0 + 0.07 * geo.D));
        }
        g.stroke();
      }
      drawToken(g);

      // fingerprints on the glass, never over the doll
      for (const p of prints) {
        if (!p.live) continue;
        if (Math.hypot(p.x - geo.cx, p.y - geo.cy) < geo.R + 10) continue;
        g.globalAlpha = 0.3 * (1 - p.t / 1.5);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.drawImage(print.canvas, -print.w / 2, -print.h / 2, print.w, print.h);
        g.restore();
      }
      g.globalAlpha = 1;

      // whistling: a music note bobbing beside him
      const whistleW = (pic.cur === FR.Whistle ? pic.w : 0) + (pic.prev === FR.Whistle ? pic.pw : 0);
      if (whistleW > 0.05) {
        const x = fx_(0.8);
        const y = fy_(0.4) + Math.sin(gt * 6) * 6;
        g.globalAlpha = Math.min(1, whistleW);
        g.drawImage(note.canvas, x - note.w / 2, y - note.h / 2, note.w, note.h);
        g.globalAlpha = 1;
      }
      // dozing: Z's rising from his head
      if (zzz.t < 2.1) {
        g.lineJoin = 'round';
        for (let i = 0; i < 3; i++) {
          const ph = (zzz.t * 0.7 + i / 3) % 1;
          const zs = (0.05 + 0.03 * i) * geo.D * (0.6 + ph * 0.6);
          const x = fx_(0.78) + ph * 0.1 * geo.D + i * 0.02 * geo.D;
          const y = fy_(0.25) - ph * 0.3 * geo.D;
          g.globalAlpha = 1 - ph * ph;
          g.beginPath();
          g.moveTo(x - zs / 2, y - zs / 2);
          g.lineTo(x + zs / 2, y - zs / 2);
          g.lineTo(x - zs / 2, y + zs / 2);
          g.lineTo(x + zs / 2, y + zs / 2);
          g.strokeStyle = PAL.ink;
          g.lineWidth = 7;
          g.stroke();
          g.strokeStyle = PAL.white;
          g.lineWidth = 3.5;
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      // the tap count on a red star sticker, on the token's lower left (clear of his hand)
      if (stScore && finalShown) {
        const k = ease.outBack(clamp((finalT - 0.35) / 0.3, 0, 1));
        const f = Math.min(1, (0.42 * geo.D) / stScore.w);
        blit(g, stScore, geo.cx - 0.34 * geo.D, geo.cy + 0.36 * geo.D, f * k);
      }
      g.restore();

      fx.draw(g);
      drawCounter(g);
      if (s.phase === 'waiting' && !cur && countdownDigit > 5) drawGhost(g);
      drawBand(g);

      // last 5 s of the sprint: a hard red frame pulses
      if (s.phase === 'sprint' && lastQuarter) {
        const k = 0.5 + 0.5 * Math.sin(gt * 14);
        g.strokeStyle = PAL.red;
        g.lineWidth = 5 + 5 * k;
        g.strokeRect(0, geo.top, w, geo.counterTop - geo.top);
      }
      if (flash > 0) {
        g.fillStyle = `rgba(255,255,255,${(flashMax * flash).toFixed(3)})`;
        g.fillRect(0, 0, w, h);
      }
    }

    const placeholders = [...art.clip, ...art.stills, art.fist].filter((d) => d.isPlaceholder).map((d) => d.key);
    function bandName(): string | null {
      const s = engine.state;
      if (bandDigit > 0) return `digit-${bandDigit}`;
      if (s.phase === 'waiting') return remark ? (stickerNames.get(remark.s) ?? 'remark') : 'start';
      return band ? (stickerNames.get(band.s) ?? 'sticker') : null;
    }
    function frameName(): string {
      if (pic.cur >= 0 && pic.w >= 0.5) return STILL_NAMES[pic.cur] ?? '';
      return `pick_${String(clipT >= 0.5 ? clipI + 1 : clipI).padStart(2, '0')}`;
    }
    debugSource = (): TapDebugState => {
      const s = engine.state;
      let fpN = 0;
      for (const p of prints) if (p.live) fpN++;
      return {
        fingerprint: level.fingerprint,
        elapsedMs: elapsed,
        phase: s.phase,
        startWindowMs: timing.startWindowMs,
        sprintMs: timing.sprintMs,
        t0: s.t0,
        endAt: s.endAt,
        auto: s.auto,
        touches,
        touchTimes: touchTimes.slice(),
        taps: s.taps,
        score: s.taps,
        bounces: s.bounces,
        late: s.late,
        rate: s.rate,
        rateSm: s.rateSm,
        level: s.level,
        hand: handLabel,
        depth: pDraw,
        clip: clipF,
        frame: frameName(),
        still: pic.cur >= 0 ? (STILL_NAMES[pic.cur] ?? null) : null,
        stillW: pic.cur >= 0 ? pic.w : 0,
        beat: cur ? cur.id : null,
        beatT: cur ? cur.t : 0,
        sticker: bandName(),
        stickerT: band ? band.t : remark ? remark.t : 0,
        queuedBeats: queue.length,
        lastQuarter,
        beats: beatLog.slice(),
        events: eventLog.slice(),
        finished,
        finishedAtMs,
        sprites: { fingerprints: fpN, fx: fx.count },
        x: geo.cx,
        y: geo.cy,
        r: geo.R,
        layout: { top: geo.top, bandTop: geo.bandTop, bandBottom: geo.bandBottom, tokenTop: geo.cy - geo.R, tokenBottom: geo.cy + geo.R, pileTop: geo.pileTop, counterTop: geo.counterTop, bottom: geo.bottom, w: geo.w, h: geo.h },
        queued: engine.queued,
        hudTop: ctx.hudHeight,
        placeholders,
      };
    };
    window.__tap = tapDebug;

    computeGeo();
    // a reload: continue the sprint (or show the final frame) this phone already played
    if (resumed) {
      const st = engine.state;
      lastScore = st.taps;
      ctx.setScore(st.taps);
      savedTaps = st.taps;
      logEvent('resumed');
      if (st.phase === 'done') onDone(st.taps);
      else if (st.endAt - startOffset <= timing.sprintMs * TAP.LAST_SHARE) onLast();
    }
    const onPageHide = (): void => persist(true);
    window.addEventListener('pagehide', onPageHide);
    loop.start();

    return {
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        loop.stop();
        input.dispose();
        fx.clear();
        ctx.setClock?.(null);
        ctx.root.removeEventListener('pointerdown', onDownCapture, { capture: true });
        window.removeEventListener('pagehide', onPageHide);
        downStamp.clear();
        view.dispose();
        backdrop.dispose();
        chipCache.dispose();
        for (const l of [counter, print, note]) freeLayer(l);
        if (glass) {
          glass.width = 0;
          glass.height = 0;
        }
        glass = null;
        counter = null;
        if (picCanvas) {
          picCanvas.width = 0;
          picCanvas.height = 0;
        }
        picCanvas = null;
        picCtx = null;
        freeTapArt(art);
        debugSource = null;
      },
    };
  },
};
