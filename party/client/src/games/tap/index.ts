/**
 * שימי טאפ: a personal 20-second sprint of tapping Shimi (the round is 53 s: a 30 s start
 * window, then 20 s of tapping from the player's own first touch, or from the end of the
 * window when they never touch, then a 3 s hold). Score = counted taps, nothing else (rules in
 * pick.ts; how to change a line or a threshold: README.md next to this file).
 *
 * The comedy is graphics only: the doll lives in a round token (a porthole: every head frame
 * is masked to the circle once at load), his finger goes deeper into his nose as the tap rate
 * rises, boogers fly at the glass, splat, slide and pile up under the token, and every so many
 * taps a set piece plays (Yossi, the rope, the ear, mini Shimi, the sneeze, the squeegee, the
 * king, the bobble spin, the cork). The last 5 s grow one last booger on his fingertip; when
 * the sprint is over it lands on his head and the final frame (a trophy picture per rank,
 * with the tap count on a star sticker) stays until the round ends.
 *
 * Fairness: taps are stamped with their round time and applied by the pure engine at the
 * fixed step that covers that time, so frame rate does not change the score; beats are
 * started from engine events at fixed steps and animated on the kit loop's game time, so a
 * cutscene freeze stops everything and the same taps give the same beats on every phone.
 */
import { noise, sfx, tone } from '../../kit/audio';
import { createGameCanvas } from '../../kit/canvas';
import { clamp, createFx, ease, lerp } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createInput } from '../../kit/input';
import { createLoop } from '../../kit/loop';
import { createBackdrop, FR, FRAME, FRAME_NAMES, FRAME_SCALE, FRAME_TOP, HAND, loadTapArt } from './art';
import { blit, createStickerCache, loadDisplayFont, makeLayer, PAL, renderChip, renderSticker, STAR14, stickerShape } from './look';
import { drawBarWell, freeLayer, paintCounter, paintFingerprint, paintNote, paintStar } from './paint';
import { createTapEngine, rankOf, scaledThresholds, TAP } from './pick';
import { BOOGER, boogerOf, boogerTraits, buildLevel, FILLER, IDLE_BIT, ALIVE, seeded } from './schedule';

import type { Drawable } from '../../kit/assets';
import type { GameContext, GameInstance, GameModule } from '../types';
import type { FrameId } from './art';
import type { Sticker } from './look';
import type { Layer } from './paint';
import type { MilestoneId, TapPhase } from './pick';
import type { BoogerKind } from './schedule';

// ───────────────────────────── Tuning (cosmetic; the rules are in pick.ts) ─────────────────────────────

const STEP_MS = 1000 / 60;
/** The game clock catches up with the round clock when it falls this far behind. */
const RESYNC_MS = 400;
/** Taps wait for the step that covers their round time, unless the game lags more than this (a 20 fps phone lags ~130 ms). */
const FLUSH_LAG_MS = 250;
/** A touch is stamped with when the finger landed (the event's own timeStamp), at most this far back (a first frame on a slow phone can take ~1 s). */
const MAX_TOUCH_AGE_MS = 1200;
/** Live boogers on the glass (flying + sliding); a new one sends the oldest to the pile at once. */
const MAX_LIVE = 6;
/** Splat decals on the glass (a ring: the 7th replaces the oldest). */
const DECALS_N = 6;
const SNEEZE_N = 8;
const CORK_N = 20;
const FP_N = 10;
const FLY_S = 0.25;
const SPLAT_S = 0.16;
const DRIP_EVERY = 6;
const DRIP_EVERY_LAST = 3;
const NOTE_COLOR_SIZE = 34;
/** Beats queued behind a running one cut it after max(its snap, this). */
const MIN_SNAP_S = 0.7;
const SOFT_GAP_S = 2.5;
const FILLER_QUIET_S = 2.5;
const INNOCENT_GAP_MS = 900;
const PILE_ROW1 = 12;
const PILE_ROW2 = 10;
/** Booger size on the glass (share of D) and the close-up of the first one of each kind. */
const GOO_MIN = 0.14;
const GOO_SPAN = 0.04;
const INTRO_SCALE = 2;
const INTRO_S = 0.6;
/** Boogers on the glass keep off the head: an ellipse (shares of D) around the token centre, raised a little. */
const HEAD_KEEP_RX = 0.36;
const HEAD_KEEP_RY = 0.46;
const HEAD_KEEP_DY = 0.03;
/** The last-5-seconds booger on the fingertip: start and maximum size (share of D). */
const TROPHY_MIN = 0.05;
const TROPHY_MAX = 0.3;
/** Final frame: one small alive gag every this many seconds. */
const ALIVE_EVERY_S = 2;

// ───────────────────────────── Words (the owner's voice) ─────────────────────────────

const W = {
  start: 'הקישו כדי להתחיל!',
  sneak1: 'לא ראית כלום.',
  sneak2: 'מה אתה מסתכל? תקיש.',
  yawn: 'נו? יש לי הופעה בבת ים.',
  knock: 'טוק טוק. יש פה מישהו?',
  self: 'טוב. אני מתחיל לבד.',
  auto: 'התחלתי בלעדיך.',
  autoSub: 'נודר.',
  click: 'קליק!',
  shrug: 'כן, ו?',
  yossi: 'קוראים לו יוסי.',
  rope: 'מחורחר!',
  ear: 'יצא מהצד השני.',
  earSub: 'נודר.',
  mini: 'שימי בתוך שימי.',
  miniSub: 'אחשילי.',
  sneeze: 'אפצ׳י!',
  bless: 'לבריאות לי.',
  squeegee: 'ניקיתי. בערך.',
  king: 'בן פורת יוסף!',
  kingChip: 'מלך הנזלת',
  sleep: 'רק עצמתי עיניים.',
  peek: 'ששש. הוא ביישן.',
  spin: 'סיבוב חינם.',
  spinSub: 'לונה פארק.',
  cork: 'פקק באיילון.',
  corkSub: 'סוף סוף משהו זז.',
  gold: 'מטמון!',
  double: 'דאבל.',
  doubleSub: 'כמו בטוטו.',
  wow: 'וואו!',
  notMe: 'לא אני.',
  fillers: [
    ['לאט.', 'כמו האוטובוס לפתח תקווה.'],
    ['צדיק!', 'לאט ובטוח.'],
    ['בקצב של הרכבת הקלה.', 'מגיעים בסוף.'],
  ],
  lastSub: 'תן הכול!',
  ranks: ['חוטט מתלמד.', 'חוטט מוסמך.', 'דוקטור לחטטנות.', 'האף של המדינה.'],
  wait: 'תראו לשכן. מחכים לכולם.',
  names: ['יוסי', 'מוטי', 'ציפי', 'אבי', 'שימי הקטן'],
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
  /** Hand stage name as drawn: 'hidden' | 'rising' | 'nostril' | 'knuckle' | 'deep' | 'absurd' | 'beat' | 'innocent'. */
  readonly hand: string;
  readonly frame: string;
  readonly beat: string | null;
  /** Seconds into the running beat. */
  readonly beatT: number;
  readonly queuedBeats: number;
  /** The last quarter of the sprint ("last 5 seconds") is on. */
  readonly lastQuarter: boolean;
  readonly beats: readonly TapBeatLog[];
  /** Smaller things the player sees: drips, the innocence gag, soft stickers, the golden booger. */
  readonly events: readonly TapBeatLog[];
  readonly finished: boolean;
  /** Round time when the game called ctx.finish() (-1 = not yet). */
  readonly finishedAtMs: number;
  readonly sprites: {
    readonly live: number;
    readonly sneeze: number;
    readonly cork: number;
    readonly pile: number;
    readonly pileTotal: number;
    readonly fingerprints: number;
    /** Splat decals on the glass (at most 6). */
    readonly decals: number;
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

// ───────────────────────────── Entities ─────────────────────────────

const GOO_FLY = 0;
const GOO_SPLAT = 1;
const GOO_ACT = 2;
const GOO_SLIDE = 3;
const GOO_STUCK = 4;
const GOO_DRAG = 5;

interface Goo {
  live: boolean;
  kind: BoogerKind;
  st: number;
  t: number;
  /** Seconds since it landed. */
  age: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  size: number;
  rot: number;
  vrot: number;
  life: number;
  vy: number;
  stretch: number;
  serial: number;
  /** -1 no name, else index into W.names. */
  name: number;
  yossi: boolean;
  /** Sneeze booger: sticks 1 s then bakes into the glass. */
  sneeze: boolean;
  /** Drag offset along the squeegee blade. */
  drag: number;
  /** Seconds left of the close-up (the first booger of each kind is shown big). */
  intro: number;
}

interface PileMember {
  kind: BoogerKind;
  row: number;
  slot: number;
  size: number;
  rot: number;
  name: number;
  serial: number;
}

interface Bit {
  live: boolean;
  kind: BoogerKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  t: number;
  size: number;
}

interface Print {
  live: boolean;
  x: number;
  y: number;
  t: number;
  rot: number;
}

type GlassOp =
  | { readonly k: 'decal'; readonly u: number; readonly v: number; readonly s: number; readonly rot: number; readonly sx: number }
  | { readonly k: 'trail'; readonly u: number; readonly v: number; readonly len: number; readonly wd: number }
  | { readonly k: 'sprite'; readonly kind: BoogerKind; readonly u: number; readonly v: number; readonly s: number; readonly rot: number }
  | { readonly k: 'smear'; readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number; readonly off: number };

/** What the doll looks like this step: the base pose from the hand level, then gags and beats on top. */
interface Pose {
  frame: FrameId;
  /** Fingertip of the rising hand along rest (0) -> nostril (1), or -1 = no sprite hand. */
  handK: number;
  /** A beat places the fingertip itself (frame coords), overriding handK. */
  tipOn: boolean;
  tipU: number;
  tipV: number;
  sx: number;
  sy: number;
  rot: number;
  dx: number;
  dy: number;
  /** Picture only (inside the ring). */
  prot: number;
  pscale: number;
  /** Nose stretch (picture scaleY about the nostril). */
  nose: number;
  /** No tap squash (the paparazzi freeze). */
  still: boolean;
  /** The cork: the picture is not in the token. */
  headOut: boolean;
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
  onTap?(): void;
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

const HAND_IN_FRAME: ReadonlySet<number> = new Set([FR.NosePick, FR.Knuckle, FR.Deep, FR.Out, FR.Big, FR.Caught]);
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
  // the final frame (the trophy and the tap count) IS the "waiting for the others" screen
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
        milestone: (id: MilestoneId): void => onMilestone(id),
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
    const level = buildLevel(ctx.seed, ctx.durationMs, timing.tapScale, DRIP_EVERY);
    view.canvas.dataset.level = level.fingerprint;
    const rankAt = scaledThresholds(TAP.RANKS, timing.tapScale);

    // ── pre-rendered words (display font, once) ──
    const stStart = renderSticker(W.start, { flat: true, size: 30, fill: PAL.white, burst: PAL.red, shadow: PAL.redD });
    const chipRemark = (t: string): Sticker => renderChip(t, 20, PAL.white, PAL.ink);
    const ckSneak1 = chipRemark(W.sneak1);
    const ckSneak2 = chipRemark(W.sneak2);
    const ckYawn = chipRemark(W.yawn);
    const ckKnock = chipRemark(W.knock);
    const ckSleep = chipRemark(W.sleep);
    const ckPeek = chipRemark(W.peek);
    const ckSelf = renderChip(W.self, 20, PAL.cob, PAL.white);
    const stAuto = renderSticker(W.auto, { flat: true, size: 28, sub: W.autoSub, subScale: 0.8, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD });
    const stClick = renderSticker(W.click, { size: 34, fill: PAL.white, burst: PAL.red, shadow: PAL.redD });
    const stShrug = renderSticker(W.shrug, { size: 32, fill: PAL.yel, shadow: PAL.cob });
    const stYossi = renderSticker(W.yossi, { size: 28, fill: PAL.white, shadow: PAL.cob });
    const stRope = renderSticker(W.rope, { size: 34, fill: PAL.yel, burst: PAL.cob, shadow: PAL.cobD });
    const stEar = renderSticker(W.ear, { flat: true, size: 28, sub: W.earSub, subScale: 0.8, fill: PAL.white, burst: PAL.red, shadow: PAL.redD });
    const stMini = renderSticker(W.mini, { size: 28, sub: W.miniSub, subScale: 0.8, fill: PAL.yel, shadow: PAL.red });
    const stSneeze = renderSticker(W.sneeze, { size: 44, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD });
    const ckBless = chipRemark(W.bless);
    const stSqueegee = renderSticker(W.squeegee, { size: 30, fill: PAL.white, shadow: PAL.cob });
    const stKing = renderSticker(W.king, { flat: true, size: 32, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD });
    const ckKing = renderChip(W.kingChip, 13, PAL.yel, PAL.ink);
    const stSpin = renderSticker(W.spin, { size: 30, sub: W.spinSub, subScale: 0.8, fill: PAL.yel, shadow: PAL.cob });
    const stCork = renderSticker(W.cork, { flat: true, size: 30, sub: W.corkSub, subScale: 0.75, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD });
    const stGold = renderSticker(W.gold, { size: 32, fill: PAL.yel, shadow: PAL.org });
    const stDouble = renderSticker(W.double, { size: 32, sub: W.doubleSub, subScale: 0.8, fill: PAL.white, shadow: PAL.red });
    const stWow = renderSticker(W.wow, { size: 36, fill: PAL.yel, shadow: PAL.red });
    const ckNotMe = chipRemark(W.notMe);
    const ckFillers = W.fillers.map(([a, b]) => renderChip(a, 20, PAL.white, PAL.ink, null, b));
    // countdown digits 5..1 (the start window's last 5 s and the sprint's): red star stickers
    const stDigits = [1, 2, 3, 4, 5].map((d) => renderSticker(String(d), { size: 64, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD, tilt: -0.06 }));
    const stDigit5Last = renderSticker('5', { size: 64, sub: W.lastSub, subScale: 0.42, fill: PAL.yel, burst: PAL.red, shadow: PAL.redD, tilt: -0.06 });
    const stRanks = W.ranks.map((t) => renderSticker(t, { flat: true, size: 30, fill: PAL.yel, burst: PAL.cob, shadow: PAL.cobD }));
    // the final tap count: a red star sticker on the token (rendered once, at the end)
    let stScore: Sticker | null = null;
    const ckWait = renderChip(W.wait, 17, PAL.yel, PAL.ink);
    const ckNames = W.names.map((t) => renderChip(t, 12, PAL.ink, PAL.white));
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
      pileBottom: 0,
      pileH: 0,
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
      let pileBand = areaH < 300 ? clamp(0.14 * areaH, 26, 50) : clamp(0.14 * areaH, 56, 110);
      const counterH = areaH < 300 ? 44 : 56;
      let D = clamp(Math.min(w - 36, areaH - stickerBand - pileBand - counterH - 8), 60, 420);
      // the pile band must hold the pile and the two lines of name chips under the token
      const pileNeed = areaH < 300 ? 0 : 0.15 * D + 54;
      if (pileNeed > pileBand) {
        pileBand = pileNeed;
        D = clamp(Math.min(w - 36, areaH - stickerBand - pileBand - counterH - 8), 60, 420);
      }
      geo.w = w;
      geo.h = h;
      geo.top = top;
      geo.bottom = bottom;
      geo.D = D;
      geo.R = D / 2;
      geo.ring = 0.035 * D;
      geo.counterH = counterH;
      geo.counterTop = bottom - counterH;
      geo.pileBottom = geo.counterTop;
      geo.pileTop = geo.counterTop - pileBand;
      geo.pileH = pileBand;
      // spare height: 30% goes under the token (a taller pile band), the rest stays above
      const slack = Math.max(0, areaH - stickerBand - pileBand - counterH - 8 - D);
      geo.pileTop -= slack * 0.3;
      geo.pileH += slack * 0.3;
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
    const REST_U = 0.66;
    const REST_V = 1.12;
    const TIP_U = 0.535;
    const TIP_V = 0.69;
    /** Path share where the fingertip crosses the lower rim. */
    let kRim = 0.27;
    function handTipU(k: number): number {
      return lerp(REST_U, TIP_U, k);
    }
    function handTipV(k: number): number {
      return lerp(REST_V, TIP_V, k);
    }

    /** The splat decal with a hard 2.5 px ink outline (opaque, the look's sticker style), painted once. */
    function paintOutlinedSplat(): Layer {
      const S = 96;
      const o = 3;
      const sil = makeLayer(S + o * 2, S + o * 2, 2);
      const out = makeLayer(S + o * 2, S + o * 2, 2);
      if (sil.ctx && out.ctx) {
        art.splat.draw(sil.ctx, S / 2 + o, S / 2 + o, S, S);
        sil.ctx.globalCompositeOperation = 'source-in';
        sil.ctx.fillStyle = PAL.ink;
        sil.ctx.fillRect(0, 0, S + o * 2, S + o * 2);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          out.ctx.drawImage(sil.canvas, Math.cos(a) * o * 0.85, Math.sin(a) * o * 0.85, S + o * 2, S + o * 2);
        }
        art.splat.draw(out.ctx, S / 2 + o, S / 2 + o, S, S);
      }
      sil.canvas.width = 0;
      sil.canvas.height = 0;
      return { canvas: out.canvas, w: S + o * 2, h: S + o * 2 };
    }
    /** A white steam cloud with an ink outline, painted once. */
    function paintCloud(): Layer {
      const w = 44;
      const h = 30;
      const l = makeLayer(w, h, 2);
      const c = l.ctx;
      if (c) {
        const blobs: Array<[number, number, number]> = [
          [14, 18, 10],
          [24, 12, 11],
          [32, 19, 9],
        ];
        c.fillStyle = PAL.ink;
        for (const [x, y, r] of blobs) {
          c.beginPath();
          c.arc(x, y, r + 2.5, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = PAL.white;
        for (const [x, y, r] of blobs) {
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
        }
      }
      return { canvas: l.canvas, w, h };
    }

    // ── pre-rendered layers (per size) ──
    let counter: Layer | null = null;
    const print = paintFingerprint();
    const note = paintNote(NOTE_COLOR_SIZE);
    const star = paintStar(22);
    const splat = paintOutlinedSplat();
    const cloud = paintCloud();
    /** The backdrop at the screen size (one blit per frame). */
    let glass: HTMLCanvasElement | null = null;
    let pileCanvas: HTMLCanvasElement | null = null;
    let pileCtx: CanvasRenderingContext2D | null = null;
    let pileDirty = true;
    /** Splat decals on the glass: a ring of DECALS_N, drawn live (opaque, outlined), never baked. */
    const decals: Array<{ live: boolean; x: number; y: number; s: number; rot: number }> = [];
    for (let i = 0; i < DECALS_N; i++) decals.push({ live: false, x: 0, y: 0, s: 0, rot: 0 });
    let decalNext = 0;
    let decalSerial = 0;
    function addDecal(x: number, y: number, size: number): void {
      const d = decals[decalNext];
      decalNext = (decalNext + 1) % decals.length;
      if (!d) return;
      d.live = true;
      d.x = x;
      d.y = y;
      d.s = size;
      d.rot = (seeded(ctx.seed, 3, decalSerial++) - 0.5) * 3;
    }

    /** The pile layer only as tall as the pile can get: two rows of boogers. */
    function pileLayerH(): number {
      return Math.ceil(0.12 * geo.D + 0.045 * geo.D + 8);
    }
    function rebuildLayers(): void {
      const scale = Math.min(2, view.dpr);
      freeLayer(counter);
      counter = paintCounter(geo.w, geo.counterH + ctx.safeBottom, scale);
      // where the fingertip path crosses the rim
      const ry = geo.cy + geo.R - geo.ring;
      const y0 = fy_(REST_V);
      const y1 = fy_(TIP_V);
      kRim = clamp((y0 - ry) / Math.max(1, y0 - y1), 0.05, 0.6);
      if (glass) {
        glass.width = 0;
        glass.height = 0;
      }
      const gl = makeLayer(geo.w, geo.h, scale);
      glass = gl.canvas;
      if (gl.ctx) backdrop.draw(gl.ctx, geo.w, geo.h, scale, geo.cx, geo.cy);
      if (pileCanvas) {
        pileCanvas.width = 0;
        pileCanvas.height = 0;
      }
      const pl = makeLayer(geo.w, pileLayerH(), scale);
      pileCanvas = pl.canvas;
      pileCtx = pl.ctx;
      pileDirty = true;
    }


    function boogerDims(kind: BoogerKind, size: number, stretch: number): { w: number; h: number } {
      const d = art.boogers[kind];
      if (kind === BOOGER.Stretchy) return { w: size * 0.36, h: size * 0.95 * stretch };
      if (!d) return { w: size, h: size };
      return { w: size, h: (size * d.height) / d.width };
    }

    // ── state ──
    let gt = 0; // game time, s (kit loop)
    let lastScore = -1;
    let lastSfxStep = -1;
    let lastSplatStep = -100;
    let bobT = 9;
    let bobSign = 1;
    let tiltV = 0;
    let tilt = 0;
    let jab = 0;
    let jabV = 0;
    let deepFlash = 0;
    let noseK = 0;
    let twist = 0;
    let twistV = 0;
    let handK = 0;
    let waitHandK = 0;
    let waitHandTarget = 0;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let dripCount = 0;
    let dripIndex = 0;
    let flash = 0;
    let flashMax = 0.9;
    let flashDur = 0.22;
    let dim = 0;
    let finalShown = false;
    let l5Held = 0;
    let l5Count = 0;
    let l5Fired = false;
    let lastTapRound = -1;
    let innocentArmed = true;
    let innocentCount = 0;
    let lastQuarter = false;
    let quietT = 0;
    let fillersUsed = 0;
    let soloFace: FrameId | null = null;
    let soloFaceT = 0;
    let finalT = -1;
    let aliveIdx = 0;
    let aliveT = 0;
    let aliveKind = -1;
    let aliveAge = 9;
    let aliveGoo = -1;
    let nextIdleAt = timing.startWindowMs * 0.05;
    /** Seconds since the countdown digit changed (its punch-in). */
    let digitT = 9;
    let idleIdx = 0;
    let sneakSeen = 0;
    let countdownDigit = 6;
    let lastDigit = 6;
    let gooSerial = 0;
    let yossiTip = 0;
    let pileSerial = 0;
    let pileTotal = 0;
    let quarterDigit = 6;
    /** The countdown digit on the band: 1..5, or 0 = none. */
    let bandDigit = 0;

    // innocence gag: 0 none, 1 pick_out, 2 whip, 3 whistle, 4 caught
    let inno = 0;
    let innoT = 0;

    const goos: Goo[] = [];
    const mkGoo = (): Goo => ({ live: false, kind: BOOGER.Round, st: 0, t: 0, age: 0, x0: 0, y0: 0, x: 0, y: 0, tx: 0, ty: 0, size: 0, rot: 0, vrot: 0, life: 3, vy: 0, stretch: 1, serial: 0, name: -1, yossi: false, sneeze: false, drag: 0, intro: 0 });
    for (let i = 0; i < MAX_LIVE + SNEEZE_N + 2; i++) goos.push(mkGoo());
    const bits: Bit[] = [];
    for (let i = 0; i < CORK_N; i++) bits.push({ live: false, kind: BOOGER.Round, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, t: 0, size: 0 });
    const prints: Print[] = [];
    for (let i = 0; i < FP_N; i++) prints.push({ live: false, x: 0, y: 0, t: 0, rot: 0 });
    let printNext = 0;
    let printSerial = 0;

    const pile: PileMember[] = [];
    // permanent specials
    const yossi = { st: 0, x: 0, y: 0, slot: -1, wave: 0 }; // st 0 none, 1 on the glass (a Goo), 2 in the pile
    const mini = { st: 0, t: 0, x: 0, y: 0, size: 0, rot: 0, slot: -1, hop: 0 }; // 0 none, 1 in the token, 2 hopping, 3 pile
    const king = { st: 0, t: 0, x: 0, y: 0, size: 0, rot: 0, flex: 0, k0x: 0, k0y: 0 }; // 0 none, 1 growing, 2 hopping, 3 pile
    const hanger = { on: false, t: 0, x: 0, y: 0, fly: 0, x0: 0, y0: 0 };
    const golden = { st: 0, t: 0, x: 0, y: 0, x0: 0, y0: 0, tx: 0, ty: 0 }; // 0 none, 1 flying, 2 stuck
    const ear = { on: false, out: 0, wig: 0 };
    const corkHead = { st: 0, t: 0, y: 0, rot: 0 }; // 0 in, 1 up, 2 gone, 3 falling
    const squeegee = { on: false, t: 0, x: 0, y: 0, x0: 0, y0: 0, x1: 0, y1: 0, px: 0, py: 0 };
    const orbit = { t: 9 };
    const knock = { on: false, up: 0, punch: 0, cracks: 0 };
    const zzz = { t: 9 };
    const peek = { k: 0, look: 0 };
    const streak = { t: 9 };
    const slick = { a: 0 };
    const sniff = { t: 9 };

    // ── sticker band ──
    let band: { s: Sticker; t: number; life: number; chip: boolean } | null = null;
    let pendingSoft: { s: Sticker; life: number; age: number; chip: boolean } | null = null;
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
    function squelch(i: number): void {
      noise({ dur: 0.13, vol: 0.22, filter: { type: 'bandpass', freq: 760 + (i % 5) * 70, to: 170, q: 3.2 } });
      tone({ freq: 150 + (i % 4) * 18, to: 70, dur: 0.11, type: 'sine', vol: 0.24 });
    }
    function cameraClick(): void {
      noise({ dur: 0.04, vol: 0.4, filter: { type: 'highpass', freq: 2000 } });
      tone({ freq: 2000, dur: 0.03, type: 'square', vol: 0.12 });
    }
    function stretchSound(): void {
      tone({ freq: 160, to: 560, dur: 0.5, type: 'sawtooth', vol: 0.08, lowpass: 900, vibrato: { depth: 14, rate: 9 } });
    }
    function squeak(f0: number, f1: number, f2: number, dur: number): void {
      tone({ freq: f0, to: f1, dur: dur / 2, type: 'sine', vol: 0.12, vibrato: { depth: 30, rate: 9 } });
      tone({ freq: f1, to: f2, dur: dur / 2, type: 'sine', vol: 0.12, at: dur / 2, vibrato: { depth: 30, rate: 9 } });
    }
    function splatSound(p: number): void {
      if (loop.steps - lastSplatStep < 4) return;
      lastSplatStep = loop.steps;
      sfx.splat(p);
    }

    // ── fingerprints ──
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

    // ── boogers ──
    function liveCount(): number {
      let n = 0;
      for (const g of goos) if (g.live && !g.sneeze) n++;
      return n;
    }
    function freeGoo(): Goo | null {
      for (const g of goos) if (!g.live) return g;
      return null;
    }
    function landingSpot(i: number, size: number, out: { x: number; y: number }, salt = 0): void {
      const tr = boogerTraits(ctx.seed, i + salt);
      const m = 8 + size * 0.5;
      let x = m + tr.u * Math.max(1, geo.w - 2 * m);
      let y = geo.top + m + tr.v * Math.max(1, geo.pileTop - size * 0.6 - geo.top - m);
      // keep off the whole head (hat, eyes, nose, mouth): the doll stays readable and the hat
      // stays free for the final booger
      const ex = geo.cx;
      const ey = geo.cy - HEAD_KEEP_DY * geo.D;
      const rx = HEAD_KEEP_RX * geo.D + size * 0.5;
      const ry = HEAD_KEEP_RY * geo.D + size * 0.5;
      const nx = (x - ex) / rx;
      const ny = (y - ey) / ry;
      const d = Math.hypot(nx, ny);
      if (d < 1) {
        const k = d < 1e-3 ? 0 : 1 / d;
        x = d < 1e-3 ? ex + rx : ex + (x - ex) * k;
        y = d < 1e-3 ? ey : ey + (y - ey) * k;
      }
      out.x = clamp(x, m, geo.w - m);
      out.y = clamp(y, geo.top + m, geo.pileTop - size * 0.4);
    }
    const spot = { x: 0, y: 0 };
    const kindsSeen = new Set<BoogerKind>();
    function throwBooger(kind: BoogerKind, i: number, fromX: number, fromY: number, opts: { name?: number; yossi?: boolean; sneeze?: boolean; tx?: number; ty?: number; size?: number } = {}): Goo | null {
      if (!opts.sneeze) {
        // cap: the oldest one on the glass bakes into the pile at once
        while (liveCount() >= MAX_LIVE) {
          let old: Goo | null = null;
          for (const g of goos) if (g.live && !g.sneeze && !g.yossi && g.st !== GOO_FLY && (!old || g.serial < old.serial)) old = g;
          if (!old) break;
          toPile(old);
        }
      }
      const g = freeGoo();
      if (!g) return null;
      const tr = boogerTraits(ctx.seed, i);
      const size = opts.size ?? geo.D * (GOO_MIN + GOO_SPAN * tr.size);
      if (opts.tx !== undefined && opts.ty !== undefined) {
        spot.x = opts.tx;
        spot.y = opts.ty;
      } else landingSpot(i, size, spot, opts.sneeze ? 7919 : 0);
      g.live = true;
      g.kind = kind;
      g.st = GOO_FLY;
      g.t = 0;
      g.age = 0;
      g.x0 = fromX;
      g.y0 = fromY;
      g.x = fromX;
      g.y = fromY;
      g.tx = spot.x;
      g.ty = spot.y;
      g.size = size;
      g.rot = (tr.spin - 0.5) * (kind === BOOGER.Stretchy ? 0.3 : 0.8);
      g.vrot = kind === BOOGER.Stretchy ? 0 : (tr.spin - 0.5) * 14;
      g.life = 2 + 2 * tr.slide;
      g.vy = 0;
      g.stretch = 1;
      g.serial = gooSerial++;
      g.name = opts.name ?? -1;
      g.yossi = opts.yossi === true;
      g.sneeze = opts.sneeze === true;
      g.drag = 0;
      g.intro = 0;
      if (!opts.sneeze && !opts.yossi && !kindsSeen.has(kind)) {
        kindsSeen.add(kind);
        g.intro = INTRO_S;
      }
      return g;
    }

    function pileSlotX(row: number, slot: number): number {
      const n = row === 0 ? PILE_ROW1 : PILE_ROW2;
      const off = row === 0 ? 0 : 0.5;
      return ((slot + 0.5 + off * 0.8) / (n + (row === 0 ? 0 : 0.8))) * geo.w;
    }
    function pileBaseY(row: number): number {
      return geo.pileBottom + 2 - (row === 0 ? 0 : 0.045 * geo.D);
    }
    function slotTaken(row: number, slot: number): boolean {
      if (row === 0 && (slot === yossi.slot || slot === mini.slot)) return true;
      for (const m of pile) if (m.row === row && m.slot === slot) return true;
      return false;
    }
    function nearestFree(row: number, x: number): number {
      const n = row === 0 ? PILE_ROW1 : PILE_ROW2;
      let best = -1;
      let bd = Infinity;
      for (let s = 0; s < n; s++) {
        if (slotTaken(row, s)) continue;
        const d = Math.abs(pileSlotX(row, s) - x);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    }
    /** Take a pile slot near x (row 1, then row 2, then the oldest unnamed one). */
    function takeSlot(x: number): { row: number; slot: number } {
      let s = nearestFree(0, x);
      if (s >= 0) return { row: 0, slot: s };
      s = nearestFree(1, x);
      if (s >= 0) return { row: 1, slot: s };
      let old = -1;
      for (let i = 0; i < pile.length; i++) {
        const m = pile[i];
        if (m && m.name < 0 && (old < 0 || m.serial < (pile[old]?.serial ?? Infinity))) old = i;
      }
      const m = old >= 0 ? pile.splice(old, 1)[0] : undefined;
      return m ? { row: m.row, slot: m.slot } : { row: 0, slot: 0 };
    }
    let namesGiven = 1; // יוסי is given by its beat; the next three arrivals get מוטי, ציפי, אבי
    /**
     * Name chips sit on six fixed slots across the width, on two staggered lines (even slots
     * low, odd slots high), so no two chips ever overlap: יוסי 0, מוטי 1, ציפי 5, אבי 4,
     * שימי הקטן 2 and the king (מלך הנזלת) 3. A named booger stands in the pile under its chip.
     */
    const CHIP_SLOT = [0, 1, 5, 4, 2] as const;
    const KING_CHIP_SLOT = 3;
    function chipSlotX(k: number): number {
      return ((k + 0.5) / 6) * geo.w;
    }
    function chipLineY(k: number, h: number): number {
      const low = pileBaseY(0) - 0.15 * geo.D - h * 0.5;
      return k % 2 === 0 ? low : low - h * 1.1;
    }
    /** A free row-1 pile slot under the chip of name #n. */
    function namedSlot(n: number): number {
      const k = n < 0 ? KING_CHIP_SLOT : (CHIP_SLOT[n] ?? 0);
      return nearestFree(0, chipSlotX(k));
    }
    function toPile(g: Goo): void {
      g.live = false;
      pileTotal++;
      if (g.yossi) {
        yossi.st = 2;
        yossi.slot = namedSlot(0);
        if (yossi.slot < 0) yossi.slot = nearestFree(0, g.x);
        yossi.wave = 0;
        return;
      }
      let name = -1;
      let s = { row: 0, slot: -1 };
      if (namesGiven < 4) {
        const ns = namedSlot(namesGiven);
        if (ns >= 0) {
          name = namesGiven++;
          s.slot = ns;
        }
      }
      if (s.slot < 0) s = takeSlot(g.x);
      pile.push({ kind: g.kind, row: s.row, slot: s.slot, size: Math.min(g.size, 0.12 * geo.D), rot: g.rot * 0.3, name, serial: pileSerial++ });
      pileDirty = true;
    }

    function updateGoos(dt: number): void {
      const ex = geo.cx;
      const ey = geo.cy - HEAD_KEEP_DY * geo.D;
      for (const g of goos) {
        if (!g.live) continue;
        g.t += dt;
        if (g.intro > 0 && g.st !== GOO_FLY) g.intro = Math.max(0, g.intro - dt);
        switch (g.st) {
          case GOO_FLY: {
            const k = Math.min(1, g.t / FLY_S);
            const e = ease.outQuad(k);
            g.x = lerp(g.x0, g.tx, e);
            g.y = lerp(g.y0, g.ty, e) - Math.sin(Math.PI * k) * geo.D * 0.12;
            g.rot += g.vrot * dt;
            if (k >= 1) {
              g.st = GOO_SPLAT;
              g.t = 0;
              g.x = g.tx;
              g.y = g.ty;
              addDecal(g.x, g.y, g.size * 1.25);
              splatSound(0.8 + (g.serial % 5) * 0.08);
            }
            break;
          }
          case GOO_SPLAT:
            g.age += dt;
            if (g.t >= SPLAT_S) {
              g.st = g.sneeze ? GOO_STUCK : GOO_ACT;
              g.t = 0;
            }
            break;
          case GOO_STUCK:
            g.age += dt;
            // a sneeze booger sticks 1 s, then slides to the pile like any other
            if (g.sneeze && g.age >= 1 && finalT < 0) {
              g.st = GOO_SLIDE;
              g.t = 0;
              g.vy = Math.max(60, (geo.pileBottom - g.size * 0.5 - g.y) / 1.6);
            }
            break;
          case GOO_ACT: {
            g.age += dt;
            let done = true;
            if (g.yossi) done = g.t >= 0.35;
            else if (g.kind === BOOGER.Googly) {
              done = g.t >= 1.2;
              const a = Math.atan2(lastTouchY - g.y, lastTouchX - g.x);
              g.rot += (clamp(Math.cos(a) * 0.5, -0.5, 0.5) - g.rot) * Math.min(1, dt * 6);
            } else if (g.kind === BOOGER.Hairy) {
              done = g.t >= 0.7;
              g.y -= ((0.08 * geo.D) / 0.7) * dt;
              g.rot = Math.sin(g.t * 24) * 0.12;
            } else if (g.kind === BOOGER.Stretchy) {
              done = g.t >= 0.75;
              g.stretch = g.t < 0.6 ? 1 + 0.7 * (g.t / 0.6) : 0.75 + 0.25 * ((g.t - 0.6) / 0.15);
            }
            if (done) {
              g.st = GOO_SLIDE;
              g.t = 0;
              g.stretch = 1;
              const target = geo.pileBottom - g.size * 0.5;
              g.vy = Math.max(40, (target - g.y) / Math.max(0.5, g.life - g.age));
            }
            break;
          }
          case GOO_SLIDE: {
            g.age += dt;
            g.y += g.vy * dt * (1 + g.t * 0.3);
            if (g.kind !== BOOGER.Googly) g.rot *= 1 - Math.min(1, dt * 2);
            // keep off the head: slide around the keep-out ellipse
            const rx = HEAD_KEEP_RX * geo.D + g.size * 0.5;
            const ry = HEAD_KEEP_RY * geo.D + g.size * 0.5;
            const ny = (g.y - ey) / ry;
            if (Math.abs(ny) < 1) {
              const half = rx * Math.sqrt(1 - ny * ny);
              if (Math.abs(g.x - ex) < half) g.x += ((g.x >= ex ? ex + half : ex - half) - g.x) * Math.min(1, dt * 10);
            }
            if (g.y >= geo.pileBottom - g.size * 0.5) {
              if (g.yossi) {
                g.live = false;
                yossi.st = 2;
                yossi.slot = namedSlot(0);
                if (yossi.slot < 0) yossi.slot = Math.max(0, nearestFree(0, g.x));
                pileTotal++;
              } else toPile(g);
            }
            break;
          }
          case GOO_DRAG:
            break;
          default:
            break;
        }
      }
    }

    function updateBits(dt: number): void {
      for (const b of bits) {
        if (!b.live) continue;
        b.t += dt;
        b.vy += 900 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.rot += b.vr * dt;
        if (b.t >= 1) b.live = false;
      }
    }

    // ── the pile canvas (static members), redrawn when it changes ──
    function paintPile(): void {
      const c = pileCtx;
      if (!c) return;
      pileDirty = false;
      const H = pileLayerH();
      c.clearRect(0, 0, geo.w, H);
      const top = geo.pileBottom - H;
      for (let row = 1; row >= 0; row--) {
        for (const m of pile) {
          if (m.row !== row) continue;
          const d = art.boogers[m.kind];
          if (!d) continue;
          const dims = boogerDims(m.kind, m.size, 1);
          const x = pileSlotX(m.row, m.slot);
          const by = pileBaseY(m.row) - top;
          d.draw(c, x, by - dims.h / 2, dims.w, dims.h, m.rot);
        }
      }
    }

    /** Keep a name chip on screen. */
    function chipX(x: number, w: number): number {
      return clamp(x, w / 2 + 4, geo.w - w / 2 - 4);
    }

    // ── pose ──
    const pose: Pose = { frame: FR.Normal, handK: -1, tipOn: false, tipU: 0, tipV: 0, sx: 1, sy: 1, rot: 0, dx: 0, dy: 0, prot: 0, pscale: 1, nose: 0, still: false, headOut: false, label: 'hidden' };
    function resetPose(): void {
      pose.frame = FR.Normal;
      pose.handK = -1;
      pose.tipOn = false;
      pose.sx = 1;
      pose.sy = 1;
      pose.rot = 0;
      pose.dx = 0;
      pose.dy = 0;
      pose.prot = 0;
      pose.pscale = 1;
      pose.nose = 0;
      pose.still = false;
      pose.headOut = false;
      pose.label = 'hidden';
    }

    /** Faces of the start window's countdown, for the digits 1..5. */
    const COUNTDOWN_FACE: readonly FrameId[] = [FR.NosePick, FR.NosePick, FR.Angry, FR.Surprised, FR.Surprised];
    function levelPose(dt: number): void {
      const s = engine.state;
      if (s.phase === 'waiting') {
        const br = 0.01 * Math.sin(gt * Math.PI);
        pose.sx = 1 + br;
        pose.sy = 1 + br;
        waitHandK += (waitHandTarget - waitHandK) * Math.min(1, dt * 14);
        pose.handK = waitHandK;
        pose.label = waitHandK > kRim ? 'rising' : 'hidden';
        // the countdown: he gets impatient, and his finger is on its way in by itself
        if (countdownDigit <= 5) {
          pose.frame = COUNTDOWN_FACE[countdownDigit - 1] ?? FR.Surprised;
          pose.handK = -1;
          pose.label = countdownDigit <= 2 ? 'nostril' : 'hidden';
        }
        return;
      }
      if (s.phase === 'done') return;
      // The last 5 seconds: the money shot. The finger pulls a long strand to his chin, one
      // last booger grows on the fingertip with every tap, the head bobs harder and harder.
      if (lastQuarter && trophy.st === 1) {
        const k = clamp((elapsed - (s.endAt - timing.sprintMs * TAP.LAST_SHARE)) / (timing.sprintMs * TAP.LAST_SHARE), 0, 1);
        pose.frame = FR.Big;
        pose.label = 'last';
        pose.prot = Math.sin(gt * Math.PI * 2.4) * lerp(4, 12, k) * DEG;
        pose.nose = noseK;
        return;
      }
      // The hand level: only the first climb is the separate hand (L1); from the nostril on
      // the finger is in the head frames themselves (realistic, never a "shh" finger).
      const L = s.level;
      let target = 0;
      switch (L) {
        case 0:
          pose.frame = FR.Normal;
          pose.label = 'hidden';
          break;
        case 1: {
          const p = clamp((s.rateSm - 0.8) / 1.0, 0, 1);
          target = kRim + (1 - kRim) * 0.85 * p;
          pose.frame = p > 0.5 ? FR.Surprised : FR.Normal;
          pose.label = 'rising';
          break;
        }
        case 2:
          pose.frame = FR.NosePick;
          pose.label = 'nostril';
          break;
        case 3:
          pose.frame = deepFlash > 0 ? FR.Deep : FR.Knuckle;
          pose.label = 'knuckle';
          break;
        case 4:
          pose.frame = FR.Deep;
          pose.label = 'deep';
          // head thrown back a little: the picture tilts, the ring stays
          pose.prot = -6 * DEG;
          break;
        default:
          pose.frame = FR.Double;
          pose.label = 'absurd';
          pose.dx = Math.sin(gt * 97) * 0.006 * geo.D;
          pose.dy = Math.cos(gt * 83) * 0.006 * geo.D;
          break;
      }
      if (L <= 1) {
        handK += (target - handK) * Math.min(1, dt * 12);
        pose.handK = handK;
      } else handK = 1;
      pose.nose = noseK;
      pose.rot += twist * 3 * DEG;
    }

    function innocencePose(): void {
      if (inno === 0) return;
      pose.dx = 0;
      pose.dy = 0;
      pose.label = 'innocent';
      if (inno === 1) {
        pose.frame = FR.Out;
        pose.handK = -1;
      } else if (inno === 2) {
        pose.frame = FR.Whistle;
        const k = clamp(innoT / 0.15, 0, 1);
        pose.tipOn = true;
        pose.tipU = lerp(FRAME.outTipX, REST_U, ease.inQuad(k));
        pose.tipV = lerp(FRAME.outTipY, REST_V + 0.1, ease.inQuad(k));
      } else if (inno === 3) {
        pose.frame = FR.Whistle;
        pose.handK = -1;
      } else {
        pose.frame = FR.Caught;
        pose.handK = -1;
      }
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

    const nx = (): number => fx_(FRAME.nostrilX);
    const ny = (): number => fy_(FRAME.nostrilY);

    function beatSneak(): Beat {
      // hand rises rim -> nostril (1.4 s), nosepick 0.5 s, CAUGHT 0.6 s, whip out, whistle 1.2 s
      return {
        id: 'wait-sneak',
        dur: 3.85,
        snap: 0,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 1.9)) {
            sfx.pop(0.9);
            sneakSeen++;
            showRemark(sneakSeen === 1 ? ckSneak1 : ckSneak2);
          }
          if (crossed(prev, t, 2.5)) sfx.whoosh(1.2);
        },
        pose(t, p) {
          if (t < 1.4) {
            p.handK = lerp(kRim, 1, ease.inOutQuad(t / 1.4));
            p.label = 'rising';
          } else if (t < 1.9) {
            p.frame = FR.NosePick;
            p.handK = -1;
          } else if (t < 2.5) {
            p.frame = FR.Caught;
            p.handK = -1;
            p.dy = 4 * bump(t, 1.9, 2.05);
          } else if (t < 2.62) {
            p.frame = FR.Whistle;
            p.handK = lerp(1, 0, (t - 2.5) / 0.12);
          } else {
            p.frame = FR.Whistle;
            p.handK = -1;
          }
        },
        end() {
          waitHandK = 0;
        },
      };
    }
    function beatYawn(): Beat {
      return {
        id: 'wait-yawn',
        dur: 1.3,
        snap: 0,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) {
            tone({ freq: 220, to: 140, dur: 0.6, type: 'triangle', vol: 0.16 });
            showRemark(ckYawn);
          }
        },
        pose(t, p) {
          p.frame = FR.Bored;
          if (t < 0.7) {
            const k = ease.inOutQuad(t / 0.7);
            p.sy *= lerp(1, 1.08, k);
            p.sx *= lerp(1, 0.94, k);
          } else if (t < 1.0) {
            p.sy *= 0.95;
            p.sx *= 1.05;
          } else {
            const k = (t - 1.0) / 0.2;
            p.sy *= lerp(0.95, 1, clamp(k, 0, 1));
            p.sx *= lerp(1.05, 1, clamp(k, 0, 1));
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
          p.frame = t < 1.15 ? FR.Angry : FR.GlassPress;
          if (t >= 1.15) p.pscale = lerp(1, 1.06, ease.outBack(clamp((t - 1.15) / 0.25, 0, 1)));
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
            p.frame = FR.Squeeze;
            const br = Math.sin(((t - 0.2) / 0.85) * Math.PI * 2);
            p.sy *= 1 + 0.025 * br;
            p.sx *= 1 + 0.015 * br;
            p.prot = 7 * DEG * ease.inOutQuad(clamp(t / 0.8, 0, 1));
            zzz.t = t;
          } else {
            p.frame = FR.Surprised;
            p.dy = -12 * bump(t, 2.0, 2.25);
            zzz.t = 9;
          }
        },
        end() {
          zzz.t = 9;
        },
      };
    }
    function beatPeek(): Beat {
      // a little booger peeks out of his nostril, looks around and hides again; he whistles
      return {
        id: 'wait-peek',
        dur: 2.6,
        snap: 0,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0.1)) sfx.pop(1.5);
          if (crossed(prev, t, 0.6)) showRemark(ckPeek, 1.8);
          if (crossed(prev, t, 1.35)) sfx.whoosh(1.6);
        },
        pose(t, p) {
          p.label = 'beat';
          p.frame = t < 1.4 ? FR.Surprised : FR.Whistle;
          peek.k = t < 0.1 ? 0 : t < 0.45 ? ease.outBack((t - 0.1) / 0.35) : t < 1.3 ? 1 : 1 - clamp((t - 1.3) / 0.12, 0, 1);
          peek.look = t > 0.5 && t < 1.25 ? Math.sin((t - 0.5) * Math.PI * 4) * 0.35 : 0;
        },
        end() {
          peek.k = 0;
        },
      };
    }

    function beatAutoStart(): Beat {
      return {
        id: 'autostart',
        dur: 1.2,
        snap: 0.4,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) {
            fx.burst(nx(), ny(), { count: 14, speed: 380, size: 6, life: 0.6, gravity: 300, shape: 'star', colors: [PAL.yel, PAL.white] });
            sfx.go();
            haptic.bump();
            showSticker(stAuto, 1.2);
          }
        },
        pose(t, p) {
          p.frame = t < 0.12 ? FR.NosePick : FR.Knuckle;
          p.handK = -1;
          p.dy = -10 * bump(t, 0, 0.26);
          p.sy *= keys(t, [0, 0.88, 0.12, 1.05, 0.26, 1]);
          p.label = 'beat';
        },
        end() {},
      };
    }
    function beatFirst(): Beat {
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
          }
          if (crossed(prev, t, 0.5)) showSticker(stShrug, 0.9);
        },
        pose(t, p) {
          if (t < 0.5) {
            p.frame = FR.Caught;
            p.handK = -1;
            p.still = true;
            p.sx = 1;
            p.sy = 1;
            p.rot = 0;
            p.dx = 0;
            p.dy = 0;
          } else if (t < 1.0) {
            p.frame = FR.Proud;
            p.handK = -1;
            p.sy *= keys(t - 0.5, [0, 0.92, 0.13, 1.04, 0.26, 1]);
          }
          p.label = 'beat';
        },
        end() {},
      };
    }

    function beatYossi(): Beat {
      let g: Goo | null = null;
      const tip = (): { x: number; y: number } => ({ x: fx_(FRAME.outTipX), y: fy_(FRAME.outTipY) });
      return {
        id: 'yossi',
        dur: 0.8,
        snap: 0.45,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) {
            sfx.pop(1.1);
            haptic.tap();
            showSticker(stYossi, 1.3);
          }
          if (crossed(prev, t, 0.45)) flick();
        },
        pose(t, p) {
          if (t < 0.45) {
            p.frame = FR.Out;
            p.handK = -1;
            p.rot += 5 * DEG * ease.outQuad(clamp(t / 0.2, 0, 1));
            yossiTip = ease.outBack(clamp(t / 0.2, 0, 1));
          } else {
            p.frame = FR.Proud;
            yossiTip = 0;
          }
          p.label = 'beat';
        },
        end() {
          yossiTip = 0;
          flick();
        },
      };
      function flick(): void {
        if (g || yossi.st !== 0) return;
        const t0 = tip();
        const ty = geo.pileTop - 0.2 * geo.D;
        g = throwBooger(BOOGER.Round, 90_001, t0.x, t0.y, { name: 0, yossi: true, tx: Math.max(geo.D * 0.07, (geo.w - geo.D) / 2 + 0.06 * geo.D), ty, size: 0.11 * geo.D });
        if (g) {
          yossi.st = 1;
          g.life = 2.4;
        }
      }
    }

    function beatRope(): Beat {
      let pulse = 0;
      return {
        id: 'rope',
        dur: 1.1,
        snap: 0.75,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0.25)) stretchSound();
          if (crossed(prev, t, 0.75)) {
            fx.shake(8, 250);
            sfx.pop(0.8);
            sfx.splat(0.9);
            haptic.heavy();
            showSticker(stRope, 1.2);
            flingHanger();
          }
        },
        pose(t, p) {
          p.handK = -1;
          p.label = 'beat';
          if (t < 0.25) {
            p.frame = FR.Deep;
            p.sy *= 0.94;
          } else if (t < 0.75) {
            p.frame = FR.Big;
            const k = ease.inQuad((t - 0.25) / 0.5);
            p.sx *= lerp(1, 0.92, k) * (1 - pulse * 0.01);
            p.sy *= lerp(1, 1.12, k) * (1 + pulse * 0.01);
          } else {
            p.frame = t < 0.9 ? FR.Surprised : FR.Tongue;
            p.sy *= keys(t - 0.75, [0, 0.88, 0.12, 1.06, 0.3, 1]);
          }
          pulse *= 0.85;
        },
        end(cut) {
          if (cut) flingHanger();
        },
        onTap() {
          if (this.t > 0.25 && this.t < 0.75) {
            pulse = 1;
            if (oncePerStep()) tone({ freq: 500 + this.t * 300, dur: 0.04, type: 'square', vol: 0.06, lowpass: 1500 });
          }
        },
      };
    }
    function flingHanger(): void {
      if (hanger.on) return;
      hanger.on = true;
      hanger.t = 0;
      hanger.fly = 0;
      hanger.x0 = fx_(FRAME.bigTipX);
      hanger.y0 = fy_(FRAME.bigTipY);
      hanger.x = geo.w - 0.07 * geo.D;
      hanger.y = geo.top + 6;
      addDecal(hanger.x, hanger.y + 0.02 * geo.D, 0.12 * geo.D);
    }

    function beatEar(): Beat {
      return {
        id: 'ear',
        dur: 1.25,
        snap: 0.45,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0.2)) {
            sfx.pop(1.2);
            haptic.bump();
            showSticker(stEar, 1.4);
          }
          if (crossed(prev, t, 0.45)) sfx.tick(1.3);
          if (crossed(prev, t, 0.65)) sfx.tick(1.5);
        },
        pose(t, p) {
          p.handK = -1;
          p.label = 'beat';
          p.frame = t < 0.6 ? FR.Deep : FR.Caught;
          if (t < 0.2) p.rot -= 6 * DEG * ease.outQuad(t / 0.2);
          else p.rot -= 6 * DEG;
          ear.on = true;
          if (t < 0.2) ear.out = 0;
          else if (t < 0.38) ear.out = ease.outBack((t - 0.2) / 0.18);
          else if (t < 1.1) ear.out = 1;
          else ear.out = 1 - clamp((t - 1.1) / 0.12, 0, 1);
          ear.wig = t > 0.38 && t < 0.88 ? Math.sin((t - 0.38) * Math.PI * 10) * 14 * DEG : 0;
        },
        end() {
          ear.on = false;
          ear.out = 0;
        },
      };
    }

    function beatMini(): Beat {
      return {
        id: 'mini',
        dur: 2.4,
        snap: 0.9,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0.2)) {
            sfx.jump(1.2);
            mini.st = 1;
            slick.a = 1;
          }
          if (crossed(prev, t, 0.65)) {
            sfx.land(1.1);
            showSticker(stMini, 1.6);
          }
          if (crossed(prev, t, 0.75)) sfx.laugh(1.2);
          if (crossed(prev, t, 1.6)) {
            mini.st = 2;
            mini.t = 0;
            sfx.jump(1.4);
          }
        },
        pose(t, p) {
          p.handK = -1;
          p.label = 'beat';
          p.frame = t < 0.2 ? FR.Out : FR.Surprised;
          if (mini.st === 1) {
            const sx = nx();
            const sy = ny();
            const ex = fx_(0.52);
            const ey = fy_(0.93);
            const k = clamp((t - 0.2) / 0.45, 0, 1);
            mini.x = lerp(sx, ex, k);
            mini.size = lerp(0.05, 0.22, ease.outQuad(k)) * geo.D;
            let y = lerp(sy, ey, ease.inQuad(k));
            if (t > 0.65) y -= 12 * bump(t, 0.65, 0.85) + 6 * bump(t, 0.85, 0.98);
            mini.y = y - mini.size * 0.35;
            mini.rot = t > 1.0 && t < 1.4 ? Math.sin((t - 1.0) * Math.PI * 5) * 10 * DEG : 0;
          }
        },
        end() {
          if (mini.st === 1) {
            mini.st = 2;
            mini.t = 0;
          }
        },
      };
    }

    function beatSneeze(): Beat {
      return {
        id: 'sneeze',
        dur: 1.7,
        snap: 0.75,
        t: 0,
        cue(prev, t) {
          for (let i = 0; i < 3; i++) if (crossed(prev, t, i * 0.15)) tone({ freq: 300 + i * 40, to: 420 + i * 40, dur: 0.09, type: 'triangle', vol: 0.14 });
          if (crossed(prev, t, 0.45)) {
            for (let i = 0; i < SNEEZE_N; i++) {
              const kind = ([BOOGER.Round, BOOGER.Googly, BOOGER.Hairy, BOOGER.Stretchy] as const)[i % 4] ?? BOOGER.Round;
              throwBooger(kind, 50_000 + i, nx(), ny(), { sneeze: true, size: 0.13 * geo.D });
            }
            fx.shake(8, 350);
            sfx.explode();
            sfx.splat(0.7);
            haptic.heavy();
            showSticker(stSneeze, 1.1);
          }
          if (crossed(prev, t, 0.51)) sfx.splat(0.9);
          if (crossed(prev, t, 1.2)) showSticker(ckBless, 1.3, true);
        },
        pose(t, p) {
          p.handK = -1;
          p.label = 'beat';
          if (t < 0.45) {
            p.frame = FR.Squeeze;
            const k = ease.inOutQuad(t / 0.45);
            p.sx *= lerp(1, 1.1, k);
            p.sy *= lerp(1, 1.1, k);
          } else {
            const k = keys(t - 0.45, [0, 1.15, 0.12, 0.95, 0.3, 1]);
            p.sx *= k;
            p.sy *= k;
            p.frame = t < 0.85 ? FR.Surprised : FR.Happy;
          }
        },
        end() {},
      };
    }

    function beatSqueegee(): Beat {
      return {
        id: 'squeegee',
        dur: 1.0,
        snap: 0.75,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0.15)) {
            squeegee.on = true;
            squeegee.t = 0;
            // from beyond the top-right corner, through the token centre, out at the bottom-left
            squeegee.x0 = geo.cx + 0.62 * geo.D;
            squeegee.y0 = geo.cy - 0.7 * geo.D;
            squeegee.x1 = geo.cx - 0.62 * geo.D;
            squeegee.y1 = geo.cy + 0.7 * geo.D;
            squeegee.px = squeegee.x0;
            squeegee.py = squeegee.y0;
            squeak(900, 1400, 700, 0.55);
          }
          if (crossed(prev, t, 0.7)) dumpSqueegee();
        },
        pose(t, p) {
          p.handK = -1;
          p.label = 'beat';
          p.frame = t < 0.7 ? FR.Proud : FR.Wink;
        },
        end() {
          dumpSqueegee();
        },
      };
    }
    function dumpSqueegee(): void {
      if (!squeegee.on) return;
      squeegee.on = false;
      // every booger on the glass ends on the pile (the performance reset)
      for (const g of goos) {
        if (!g.live || g.yossi) continue;
        g.x = clamp(g.x, 10, geo.w - 10);
        toPile(g);
      }
      // the glass is clean again (that is the joke: "ניקיתי. בערך.")
      for (const d of decals) d.live = false;
      sfx.land(0.9);
      fx.shake(6, 200);
      haptic.bump();
      showSticker(stSqueegee, 1.2);
    }
    function updateSqueegee(dt: number): void {
      if (!squeegee.on) return;
      squeegee.t += dt;
      const k = ease.inOutCubic(clamp(squeegee.t / 0.5, 0, 1));
      const x = lerp(squeegee.x0, squeegee.x1, k);
      const y = lerp(squeegee.y0, squeegee.y1, k);
      const dx = squeegee.x1 - squeegee.x0;
      const dy = squeegee.y1 - squeegee.y0;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // blade across the direction of travel
      const bx = -uy;
      const by = ux;
      const half = 0.45 * geo.D;
      for (const g of goos) {
        if (!g.live || g.yossi || g.st === GOO_FLY) continue;
        const along = (g.x - x) * ux + (g.y - y) * uy;
        if (g.st !== GOO_DRAG) {
          if (along < 0) {
            const across = (g.x - x) * bx + (g.y - y) * by;
            if (Math.abs(across) <= half) {
              g.st = GOO_DRAG;
              g.drag = across;
            }
          }
        }
        if (g.st === GOO_DRAG) {
          g.x = x + bx * g.drag + ux * g.size * 0.4;
          g.y = y + by * g.drag + uy * g.size * 0.4;
        }
      }
      squeegee.x = x;
      squeegee.y = y;
      squeegee.px = x;
      squeegee.py = y;
    }

    function beatKing(): Beat {
      let pulse = 0;
      return {
        id: 'king',
        dur: 1.45,
        snap: 1.0,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) sfx.drumroll(1000);
          if (crossed(prev, t, 0.3)) {
            king.st = 1;
            king.t = 0;
          }
          if (crossed(prev, t, 1.0)) popKing();
        },
        pose(t, p) {
          p.handK = -1;
          p.label = 'beat';
          if (t < 0.3) {
            p.frame = FR.Deep;
            p.dx = Math.sin(t * Math.PI * 50) * 0.004 * geo.D;
          } else if (t < 1.0) {
            p.frame = FR.Big;
            const k = ease.outCubic((t - 0.3) / 0.7);
            king.size = lerp(0.08, 0.34, k) * geo.D * (1 + pulse * 0.03);
            king.x = fx_(FRAME.bigTipX);
            king.y = fy_(FRAME.bigTipY) + king.size * 0.1;
            king.rot = Math.sin(t * 22) * 7 * DEG;
          } else p.frame = FR.Proud;
          pulse *= 0.85;
        },
        end() {
          popKing();
        },
        onTap() {
          pulse = 1;
        },
      };
    }
    function popKing(): void {
      if (king.st >= 2) return;
      king.st = 2;
      king.t = 0;
      if (king.size <= 0) king.size = 0.34 * geo.D;
      if (king.x === 0) {
        king.x = fx_(FRAME.bigTipX);
        king.y = fy_(FRAME.bigTipY);
      }
      king.k0x = king.x;
      king.k0y = king.y;
      fx.confetti({ x: geo.cx, y: ny(), count: 30 });
      fx.shake(10, 350);
      sfx.success();
      sfx.cheer();
      haptic.success();
      showSticker(stKing, 1.4);
    }

    function beatSpin(): Beat {
      return {
        id: 'spin',
        dur: 1.75,
        snap: 0.85,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) sfx.whoosh(0.9);
          if (crossed(prev, t, 0.25)) {
            sfx.fall();
            streak.t = 0;
          }
          if (crossed(prev, t, 0.85)) {
            sfx.hit();
            haptic.heavy();
            orbit.t = 0;
            showSticker(stSpin, 1.3);
          }
        },
        pose(t, p) {
          p.label = 'beat';
          if (t < 0.25) {
            p.prot = -20 * DEG * ease.outQuad(t / 0.25);
            p.handK = -1;
            p.frame = FR.Surprised;
          } else if (t < 0.85) {
            p.prot = (-20 + 380 * ease.outCubic((t - 0.25) / 0.6)) * DEG;
            p.handK = -1;
            p.frame = FR.Surprised;
          } else {
            const k = t - 0.85;
            p.prot = 8 * DEG * Math.exp(-k * 4) * Math.sin(k * Math.PI * 5);
            if (k < 0.6) {
              p.frame = FR.Dizzy;
              p.handK = -1;
            }
          }
        },
        end() {},
      };
    }

    function beatCork(): Beat {
      return {
        id: 'cork',
        dur: 1.75,
        snap: 1.15,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) tone({ freq: 200, to: 900, dur: 0.5, type: 'sawtooth', vol: 0.07, lowpass: 1400 });
          if (crossed(prev, t, 0.5)) {
            corkHead.st = 1;
            corkHead.t = 0;
            corkHead.y = 0;
            corkHead.rot = 0;
            for (let i = 0; i < CORK_N; i++) {
              const b = bits[i];
              if (!b) continue;
              const a = seeded(ctx.seed, 21, i) * Math.PI * 2;
              const sp = 300 + seeded(ctx.seed, 22, i) * 520;
              b.live = true;
              b.kind = ([BOOGER.Round, BOOGER.Googly, BOOGER.Hairy, BOOGER.Stretchy] as const)[i % 4] ?? BOOGER.Round;
              b.x = geo.cx + Math.cos(a) * geo.R * 0.4;
              b.y = geo.cy + Math.sin(a) * geo.R * 0.4;
              b.vx = Math.cos(a) * sp;
              b.vy = Math.sin(a) * sp - 260;
              b.rot = 0;
              b.vr = (seeded(ctx.seed, 23, i) - 0.5) * 16;
              b.t = 0;
              b.size = (0.07 + 0.04 * seeded(ctx.seed, 24, i)) * geo.D;
            }
            fx.confetti({ x: geo.cx, y: geo.cy, count: 40 });
            flash = 1;
            flashMax = 0.5;
            flashDur = 0.15;
            fx.shake(14, 450);
            sfx.explode();
            sfx.cheer();
            haptic.heavy();
            showSticker(stCork, 1.5);
          }
          // off the disc for about half a second: up and out (0.25 s), back down (0.28 s)
          if (crossed(prev, t, 0.8)) {
            corkHead.st = 3;
            corkHead.t = 0;
          }
          if (crossed(prev, t, 1.08)) {
            corkHead.st = 0;
            sfx.land(0.8);
            haptic.bump();
            fx.burst(geo.cx, geo.cy + geo.R * 0.92, { count: 6, speed: 160, size: 7, life: 0.5, gravity: -60, colors: [PAL.white] });
          }
        },
        pose(t, p) {
          p.handK = -1;
          p.label = 'beat';
          if (t < 0.5) {
            p.frame = FR.Squeeze;
            const k = ease.inQuad(t / 0.5);
            p.sx *= lerp(1, 1.22, k);
            p.sy *= lerp(1, 1.22, k);
            p.rot += Math.sin(t * Math.PI * 40) * 2 * DEG;
          } else if (t < 1.08) {
            p.frame = FR.Squeeze;
            p.headOut = true;
          } else {
            p.frame = t < 1.6 ? FR.Dizzy : FR.Happy;
            const k = keys(t - 1.08, [0, 0.82, 0.1, 1.15, 0.22, 0.96, 0.32, 1]);
            p.sy *= k;
            p.sx *= 2 - k;
          }
        },
        end() {
          corkHead.st = 0;
        },
      };
    }

    function beatFiller(which: number): Beat {
      return {
        id: `filler-${which}`,
        dur: which === FILLER.Sniff ? 1.0 : 1.2,
        snap: 0.5,
        t: 0,
        cue(prev, t) {
          if (crossed(prev, t, 0)) {
            const ck = ckFillers[which];
            if (ck) showSticker(ck, 1.6, true);
          }
          if (which === FILLER.Sniff && crossed(prev, t, 0.3)) noise({ dur: 0.15, vol: 0.2, filter: { type: 'bandpass', freq: 400, to: 2400, q: 2 } });
        },
        pose(t, p) {
          p.label = 'beat';
          p.handK = -1;
          if (which === FILLER.EyeRoll) {
            if (t < 0.5) p.frame = FR.Bored;
          } else if (which === FILLER.Wink) {
            p.frame = FR.Wink;
            p.rot += 4 * DEG * bump(t, 0, 1.2);
          } else {
            p.frame = FR.Normal;
            sniff.t = t;
          }
        },
        end() {
          sniff.t = 9;
        },
      };
    }

    /**
     * The final frame, per rank: a trophy picture to show the person next to you. The booger
     * grown in the last 5 seconds lands on his head (the boss with its crown at the top rank),
     * the tap count sits on a red star sticker on the token, the rank on the band above.
     */
    const FINAL_FACE: readonly FrameId[] = [FR.Bored, FR.Knuckle, FR.Big, FR.Double];
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
            flashDur = 0.25;
            for (const g of goos) if (g.live && g.st !== GOO_STUCK) g.st = GOO_STUCK;
            ear.on = false;
            squeegee.on = false;
            corkHead.st = 0;
            if (king.st === 1 || king.st === 2) king.st = 3;
            if (mini.st === 1 || mini.st === 2) {
              mini.st = 3;
              placeMini();
            }
            const taps = engine.state.taps;
            finalRank = rankOf(taps, timing.tapScale);
            const st = stRanks[finalRank];
            if (st) showSticker(st, 1e9);
            stScore = renderSticker(String(taps), { size: Math.max(22, Math.round(geo.D * 0.15)), fill: PAL.yel, burst: PAL.red, shadow: PAL.redD, tilt: 0.08 });
            launchTrophy();
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
          p.handK = -1;
          p.label = 'final';
          p.frame = FINAL_FACE[finalRank] ?? FR.Proud;
          // the landing on his head squashes him; then the alive gags (a nod)
          if (t >= 0.35) p.sy *= keys(t - 0.35, [0, 0.9, 0.1, 1.05, 0.25, 1]);
          if (aliveKind === ALIVE.Nod && aliveAge < 0.8) p.prot = Math.sin((aliveAge / 0.8) * Math.PI * 2) * 5 * DEG;
        },
        end() {},
      };
    }
    let finalRank = 0;

    // ── the last-5-seconds booger (on the fingertip, then on his head) ──
    const trophy = { st: 0, size: 0, t: 0, x0: 0, y0: 0, pulse: 0 }; // 0 none, 1 growing, 2 flying to the head, 3 on the head
    function trophyGrow(): void {
      trophy.size = Math.min(TROPHY_MAX * geo.D, trophy.size + 0.005 * geo.D);
      trophy.pulse = 1;
    }
    function launchTrophy(): void {
      trophy.x0 = fx_(FRAME.bigTipX);
      trophy.y0 = fy_(FRAME.bigTipY);
      if (trophy.st === 0) trophy.size = TROPHY_MIN * geo.D;
      trophy.st = 2;
      trophy.t = 0;
      sfx.jump(1.1);
    }
    /** Where the trophy sits: on the hat (its bottom just inside the ring's top). */
    function trophyHeadY(size: number): number {
      return fy_(0.04) - size * 0.4;
    }
    function trophyKind(): BoogerKind {
      return finalRank >= 3 ? BOOGER.Boss : BOOGER.Round;
    }
    function trophySize(): number {
      return finalRank >= 3 ? Math.max(trophy.size, 0.26 * geo.D) : Math.max(trophy.size, 0.07 * geo.D);
    }

    function placeMini(): void {
      let slot = namedSlot(4);
      if (slot < 0) slot = nearestFree(0, geo.w * 0.4);
      mini.slot = slot >= 0 ? slot : 9;
      mini.size = 0.16 * geo.D;
      mini.rot = 0;
    }

    // ── engine events ──
    function onStart(auto: boolean): void {
      remark = null;
      band = null;
      if (auto) preempt(beatAutoStart());
      else preempt(beatFirst());
      waitHandK = 0;
      handK = auto ? 1 : 0;
      lastTapRound = auto ? elapsed : lastTapRound;
      persist(true);
    }

    function onTap(n: number): void {
      const p = touchPts.shift();
      if (p) {
        addPrint(p.x, p.y);
        lastTouchX = p.x;
        lastTouchY = p.y;
      }
      const s = engine.state;
      lastTapRound = s.lastTapMs;
      innocentArmed = true;
      if (lastScore !== n) {
        lastScore = n;
        ctx.setScore(n);
      }
      persist(false);
      // bobble squash + tilt, blip, haptic
      bobT = 0;
      bobSign = -bobSign;
      tiltV += bobSign * 1.5 * 9;
      if (oncePerStep()) {
        tone({ freq: 300 + 50 * Math.min(14, s.rate), dur: 0.06, type: 'triangle', vol: 0.13 });
        haptic.tap();
        if (s.level === 3) squelch(n);
      }
      if (s.level >= 2) noseK = 1;
      if (s.level === 3) deepFlash = 0.09;
      if (lastQuarter && trophy.st === 1) trophyGrow();
      if (s.level >= 4) twistV += bobSign * 9;
      if (inno === 3 || inno === 1 || inno === 2) {
        inno = 4;
        innoT = 0;
        sfx.pop(1.0);
      }
      if (mini.st === 3) mini.hop = 1;
      if (king.st === 3) king.flex = 1;
      cur?.onTap?.();
      // the drip
      dripCount++;
      if (dripCount >= (lastQuarter ? DRIP_EVERY_LAST : DRIP_EVERY)) {
        dripCount = 0;
        drip();
      }
    }
    function drip(): void {
      const i = dripIndex++;
      logEvent('drip');
      const kind = boogerOf(level, i);
      if (kind === BOOGER.Golden) {
        if (golden.st !== 0) return;
        golden.st = 1;
        golden.t = 0;
        golden.x0 = nx();
        golden.y0 = ny();
        golden.tx = 0.09 * geo.D + 8;
        golden.ty = geo.top + 0.1 * geo.D;
        golden.x = golden.x0;
        golden.y = golden.y0;
        dim = 0.4;
        sfx.coin(1.0);
        showSticker(stGold, 1.2);
        soloFace = FR.Proud;
        soloFaceT = 0.6;
        return;
      }
      throwBooger(kind, i, nx(), ny());
    }
    function onBounce(): void {
      const p = touchPts.shift();
      if (p) {
        lastTouchX = p.x;
        lastTouchY = p.y;
      }
      bobT = Math.min(bobT, 0.06);
    }
    function onLate(): void {
      const p = touchPts.shift();
      if (p) addPrint(p.x, p.y);
      if (oncePerStep()) tone({ freq: 700, to: 500, dur: 0.06, type: 'sine', vol: 0.04 });
    }
    function onMilestone(id: MilestoneId): void {
      // No new set piece in the last 5 seconds (that is the money shot): a milestone there
      // is a burst of stars and a bigger booger on the fingertip.
      if (lastQuarter) {
        logEvent(`milestone-${id}`);
        fx.burst(nx(), ny(), { count: 10, speed: 300, size: 6, life: 0.5, gravity: 400, shape: 'star', colors: [PAL.yel, PAL.white] });
        sfx.pop(1.3);
        haptic.bump();
        for (let i = 0; i < 4; i++) trophyGrow();
        return;
      }
      switch (id) {
        case 'yossi':
          enqueue(beatYossi());
          break;
        case 'rope':
          enqueue(beatRope());
          break;
        case 'ear':
          enqueue(beatEar());
          break;
        case 'mini':
          enqueue(beatMini());
          break;
        case 'sneeze':
          enqueue(beatSneeze());
          break;
        case 'squeegee':
          enqueue(beatSqueegee());
          break;
        case 'king':
          enqueue(beatKing());
          break;
        case 'spin':
          enqueue(beatSpin());
          break;
        case 'cork':
          enqueue(beatCork());
          break;
        default: {
          const never: never = id;
          throw new Error(`Unhandled milestone ${String(never)}`);
        }
      }
    }
    function onLevel(from: number, to: number): void {
      if (from >= 3 && to <= 1) triggerInnocence();
    }
    function onLast(): void {
      lastQuarter = true;
      // what is waiting does not start any more; a running set piece finishes
      while (queue.length) queue.shift()?.end(true);
      pendingSoft = null;
      inno = 0;
      trophy.st = 1;
      trophy.size = TROPHY_MIN * geo.D;
      logEvent('last');
    }
    function onDone(n: number): void {
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
      if (cur || inno !== 0 || engine.state.phase !== 'sprint') return;
      inno = 1;
      innoT = 0;
      innocentArmed = false;
      logEvent('innocent');
      innocentCount++;
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
      const cdStart = (W0 * 5) / 6;
      const notch = W0 / 6 / 5;
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
          waitHandTarget = kRim + ((1 - kRim) * (6 - d)) / 5;
          remark = d === 2 ? { s: ckSelf, t: 0, life: 2.2 } : null;
        }
        return;
      }
      // one bit every 11% of the window (3.3 s), all five before any repeats; a bit that is
      // still running pushes the next one back a little instead of skipping it
      if (elapsed >= nextIdleAt) {
        if (cur || queue.length > 0) nextIdleAt = elapsed + 300;
        else {
          nextIdleAt = elapsed + timing.startWindowMs * 0.11;
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
        case IDLE_BIT.Peek:
          return beatPeek();
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

        // springs and timers
        bobT += dt;
        tiltV += (-260 * tilt - 16 * tiltV) * dt;
        tilt += tiltV * dt;
        jabV += (-300 * jab - 20 * jabV) * dt;
        jab = clamp(jab + jabV * dt, -1.2, 0.4);
        twistV += (-300 * twist - 15 * twistV) * dt;
        twist = clamp(twist + twistV * dt, -1.5, 1.5);
        deepFlash = Math.max(0, deepFlash - dt);
        noseK = Math.max(0, noseK - dt / 0.12);
        flash = Math.max(0, flash - dt / Math.max(0.05, flashDur));
        dim = Math.max(0, dim - dt / 0.4);
        digitT += dt;
        if (soloFaceT > 0) soloFaceT -= dt;
        if (band) {
          band.t += dt;
          if (band.t >= band.life) band = null;
        }
        if (remark) {
          remark.t += dt;
          if (remark.t >= remark.life) remark = null;
        }
        if (pendingSoft) {
          pendingSoft.age += dt;
          if (pendingSoft.age > 2.5) pendingSoft = null;
          else if (!band && gt - lastSoftAt >= SOFT_GAP_S) {
            showSticker(pendingSoft.s, pendingSoft.life, pendingSoft.chip);
            logEvent('soft-sticker');
            lastSoftAt = gt;
            pendingSoft = null;
          }
        }

        // fake innocence (sprint only, never during a beat)
        if (s.phase === 'sprint') {
          if (lastQuarter) {
            // no innocence in the money shot
          } else if (inno === 0 && innocentArmed && !cur && s.lastTapMs >= 0 && elapsed - Math.max(s.lastTapMs, s.t0) > INNOCENT_GAP_MS) triggerInnocence();
          else if (inno === 0 && innocentArmed && !cur && s.lastTapMs < 0 && elapsed - s.t0 > INNOCENT_GAP_MS + 600) triggerInnocence();
        }
        if (inno !== 0) {
          innoT += dt;
          if (inno === 1 && innoT >= 0.25) {
            inno = 2;
            innoT = 0;
            sfx.whoosh(1.3);
          } else if (inno === 2 && innoT >= 0.15) {
            inno = 3;
            innoT = 0;
          } else if (inno === 4 && innoT >= 0.35) {
            inno = 0;
            innoT = 0;
          }
        }

        // L5 held: the double-finger stickers
        if (s.phase === 'sprint' && s.level >= 5 && !lastQuarter) {
          if (!cur) l5Held += dt;
          if (!l5Fired && l5Held >= 1.5) {
            l5Fired = true;
            l5Count++;
            if (l5Count === 1) softSticker(stDouble, 1.3, false);
            else if (l5Count === 2) softSticker(stWow, 1.2, false);
          }
        } else {
          l5Held = 0;
          l5Fired = false;
        }

        // slow-player fillers
        if (s.phase === 'sprint') {
          if (band || cur) quietT = 0;
          else quietT += dt;
          if (quietT >= FILLER_QUIET_S && !cur && queue.length === 0 && !lastQuarter && s.rateSm < 4 && fillersUsed < level.fillers.length && (inno === 0 || inno === 3)) {
            const f = level.fillers[fillersUsed] ?? FILLER.EyeRoll;
            fillersUsed++;
            quietT = 0;
            enqueue(beatFiller(f));
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
          }
          bandDigit = d;
        } else bandDigit = 0;
        // the last-5 booger: pulse, flight to his head
        trophy.pulse = Math.max(0, trophy.pulse - dt / 0.12);
        if (trophy.st === 2) {
          trophy.t += dt;
          if (trophy.t >= 0.35) {
            trophy.st = 3;
            trophy.t = 0;
          }
        } else if (trophy.st === 3) trophy.t += dt;

        // pose: level, innocence, solo faces, then the running beat
        resetPose();
        levelPose(dt);
        innocencePose();
        if (soloFace !== null && soloFaceT > 0 && !cur && inno === 0) {
          pose.frame = soloFace;
          pose.handK = -1;
        }
        if (cur) {
          // a set piece owns the doll: no second hand, no absurd-rate vibration
          pose.dx = 0;
          pose.dy = 0;
          cur.pose(cur.t, pose);
        }

        // entities
        updateGoos(dt);
        updateBits(dt);
        updateSqueegee(dt);
        if (hanger.on) {
          hanger.t += dt;
          hanger.fly = Math.min(1, hanger.fly + dt / 0.25);
        }
        if (golden.st === 1) {
          golden.t += dt;
          const k = clamp(golden.t / 0.5, 0, 1);
          golden.x = lerp(golden.x0, golden.tx, ease.outQuad(k));
          golden.y = lerp(golden.y0, golden.ty, k) - Math.sin(k * Math.PI) * geo.D * 0.25;
          if (golden.t > 0.05 && loop.steps % 3 === 0) fx.burst(golden.x, golden.y, { count: 1, speed: 40, size: 4, life: 0.4, gravity: 0, shape: 'star', colors: [PAL.yel, PAL.white] });
          if (k >= 1) {
            golden.st = 2;
            golden.t = 0;
            splatSound(1.2);
          }
        } else if (golden.st === 2) golden.t += dt;
        if (mini.st === 2) {
          mini.t += dt;
          if (mini.slot < 0) placeMini();
          const k = clamp(mini.t / 0.4, 0, 1);
          const tx = chipX(pileSlotX(0, mini.slot), mini.size);
          const ty = pileBaseY(0) - mini.size * 0.5;
          mini.x = lerp(mini.x, tx, k);
          mini.y = lerp(mini.y, ty, k) - Math.sin(k * Math.PI) * 30 * (1 - k);
          mini.size = lerp(mini.size, 0.16 * geo.D, k);
          if (k >= 1) {
            mini.st = 3;
            sfx.land(1.3);
          }
        }
        mini.hop = Math.max(0, mini.hop - dt / 0.15);
        if (king.st === 2) {
          king.t += dt;
          const k = clamp(king.t / 0.35, 0, 1);
          king.x = lerp(king.k0x, chipSlotX(KING_CHIP_SLOT), k);
          const ty = pileBaseY(0) - 0.26 * geo.D * 0.5 - 0.015 * geo.D;
          king.y = lerp(king.k0y, ty, k) - Math.sin(k * Math.PI) * 0.25 * geo.D;
          king.size = lerp(king.size, 0.26 * geo.D, k);
          if (k >= 1) {
            king.st = 3;
            king.t = 0;
            sfx.land(0.7);
          }
        } else if (king.st === 3) king.t += dt;
        king.flex = Math.max(0, king.flex - dt / 0.15);
        if (yossi.st === 2) yossi.wave += dt;
        if (corkHead.st === 1) {
          corkHead.t += dt;
          corkHead.y -= geo.h * 3.5 * dt;
          corkHead.rot += Math.PI * 4 * dt;
          if (corkHead.t > 0.3) corkHead.st = 2;
        } else if (corkHead.st === 3) corkHead.t += dt;
        orbit.t += dt;
        streak.t += dt;
        slick.a = Math.max(0, slick.a - dt / 2.2);
        for (const p of prints) {
          if (!p.live) continue;
          p.t += dt;
          if (p.t >= 1.5) p.live = false;
        }
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
            if (aliveKind === ALIVE.Hat) sfx.pop(0.8);
            else if (aliveKind === ALIVE.Nod) squeak(520, 420, 320, 0.2);
            else if (aliveKind === ALIVE.Slide) {
              aliveGoo = -1;
              for (let i = 0; i < goos.length; i++) {
                const g = goos[i];
                if (g?.live) {
                  aliveGoo = i;
                  if ((aliveIdx + i) % 3 === 0) break;
                }
              }
            }
          }
          if (aliveKind === ALIVE.Slide && aliveAge < 0.5) {
            const g = goos[aliveGoo];
            if (g?.live) g.y += 20 * dt;
          }
        }
        fx.update(dt);

        if (trace && loop.steps % 30 === 0 && trace.length < 400) {
          trace.push(`${Math.round(elapsed / STEP_MS)}|${s.phase}|${s.rate.toFixed(3)}|${s.level}|${s.taps}|${cur ? cur.id : '-'}|${liveCount()}`);
        }
      },
      render(): void {
        computeGeo();
        draw();
      },
    });

    // ── drawing ──
    function frameDrawable(): Drawable | undefined {
      return art.frames[pose.frame];
    }

    function drawHand(g: CanvasRenderingContext2D, tipX: number, tipY: number, mirror: boolean): void {
      const hw = 0.2 * geo.D;
      const hh = (hw * HAND.h) / HAND.w;
      g.save();
      g.translate(tipX, tipY);
      if (mirror) g.scale(-1, 1);
      g.rotate(-7 * DEG);
      art.hand.draw(g, (0.5 - HAND.tipX) * hw, hh / 2, hw, hh);
      g.restore();
    }

    function drawToken(g: CanvasRenderingContext2D): void {
      const { cx, cy, D, R } = geo;
      const p = pose;
      // tap squash (bobble) on top of the pose
      let sy = p.sy;
      let sx = p.sx;
      let rot = p.rot;
      if (!p.still) {
        const b = bobT < 0.12 ? keys(bobT, [0, 1, 0.03, 0.97, 0.08, 1.02, 0.12, 1]) : 1;
        sy *= b;
        sx *= 2 - b;
        rot += tilt * DEG;
      }
      g.save();
      g.translate(cx + p.dx, cy + p.dy);
      if (rot !== 0) g.rotate(rot);
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
      // the picture: every head frame is pre-masked to the circle (art.ts), so a plain drawImage
      // is a perfect porthole, and it stays round when the picture spins
      const turned = p.prot !== 0 || p.pscale !== 1;
      if (turned) {
        g.save();
        g.translate(cx, cy);
        g.rotate(p.prot);
        const ps = Math.min(1.065, p.pscale);
        g.scale(ps, ps);
        g.translate(-cx, -cy);
      }
      // the fingertip out of the ear goes UNDER the head (its base hides inside the ear)
      if (ear.on && ear.out > 0) {
        const fw = 0.09 * D;
        const ex = fx_(FRAME.earX) + 0.05 * D - ear.out * 0.12 * D;
        const ey = fy_(FRAME.earY);
        g.save();
        g.translate(ex, ey);
        g.rotate(-Math.PI / 2 + ear.wig);
        art.fingertip.draw(g, 0, fw * 0.9, fw * 0.9, fw * 2);
        g.restore();
      }
      const fr = frameDrawable();
      if (fr && !p.headOut) {
        const S = FRAME_SCALE * D;
        const x0 = cx - S / 2;
        const y0 = cy - FRAME_TOP * D;
        if (p.nose > 0.01) {
          const nX = nx();
          const nY = ny();
          g.save();
          g.translate(nX, nY);
          g.scale(1, 1 + 0.04 * p.nose);
          g.translate(-nX, -nY);
          g.drawImage(fr.source, x0, y0, S, S);
          g.restore();
        } else g.drawImage(fr.source, x0, y0, S, S);
      }
      // the shy booger peeking out of the nostril (waiting bit)
      if (peek.k > 0.01) {
        const b = art.boogers[BOOGER.Round];
        const sz = 0.1 * D * peek.k;
        if (b) b.draw(g, nx() + 0.01 * D, ny() + sz * 0.35, sz, sz, peek.look);
      }
      // the snot slick of mini Shimi
      if (slick.a > 0.02) {
        g.globalAlpha = slick.a;
        g.lineCap = 'round';
        g.strokeStyle = PAL.ink;
        g.lineWidth = 9;
        g.beginPath();
        g.moveTo(nx(), ny());
        g.quadraticCurveTo(fx_(0.6), fy_(0.82), fx_(0.52), fy_(0.93));
        g.stroke();
        g.strokeStyle = '#86d93a';
        g.lineWidth = 6;
        g.stroke();
        g.globalAlpha = 1;
      }
      // the sniffed drip
      if (sniff.t < 1) {
        const k = sniff.t < 0.3 ? sniff.t / 0.3 : sniff.t < 0.45 ? 1 - (sniff.t - 0.3) / 0.15 : 0;
        if (k > 0) {
          const len = 0.06 * D * k;
          g.fillStyle = '#86d93a';
          g.strokeStyle = PAL.ink;
          g.lineWidth = 2;
          g.beginPath();
          g.ellipse(nx(), ny() + len / 2, 0.012 * D, len / 2 + 2, 0, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
      }
      // Yossi on the fingertip (pick_out), before he is flicked
      if (yossiTip > 0) {
        const b = art.boogers[BOOGER.Round];
        if (b) b.draw(g, fx_(FRAME.outTipX), fy_(FRAME.outTipY) - yossiTip * 0.03 * D, yossiTip * 0.11 * D, yossiTip * 0.11 * D);
      }
      if (turned) g.restore();

      // What comes up from below the rim (the rising hand, the knocking fist, a booger growing
      // at the chin) needs the porthole: one round clip, only while one of them is on screen.
      const handOn = !p.headOut && !HAND_IN_FRAME.has(p.frame) && (p.tipOn || p.handK > kRim * 0.6);
      const kingOn = king.st === 1;
      const trophyOn = trophy.st === 1;
      const fistOn = knock.on && knock.up > 0.01;
      if (handOn || kingOn || trophyOn || fistOn) {
        g.save();
        g.beginPath();
        g.arc(cx, cy, R - geo.ring * 0.5, 0, Math.PI * 2);
        g.clip();
        if (handOn) {
          if (p.tipOn) drawHand(g, fx_(p.tipU), fy_(p.tipV), false);
          else drawHand(g, fx_(handTipU(p.handK)), fy_(handTipV(p.handK)) + jab * 0.03 * D, false);
        }
        if (kingOn) {
          const b = art.boogers[BOOGER.Boss];
          if (b) b.draw(g, king.x, king.y, king.size, king.size, king.rot);
        }
        if (trophyOn) {
          const b = art.boogers[BOOGER.Round];
          const sz = trophy.size * (1 + 0.08 * trophy.pulse);
          // hangs at the end of the strand, kept inside the porthole as it grows
          const ty = Math.min(fy_(FRAME.bigTipY) + sz * 0.15, cy + 0.43 * D - sz * 0.5);
          if (b) b.draw(g, fx_(FRAME.bigTipX) + p.prot * 0.2 * D, ty, sz, sz, Math.sin(gt * 9) * 0.15);
        }
        if (fistOn) {
          const fw = 0.34 * D * (1 + 0.14 * knock.punch);
          const fh = (fw * art.fist.height) / art.fist.width;
          art.fist.draw(g, cx + 0.25 * D, cy + R + fh * 0.5 - knock.up * (fh * 0.5 + 0.26 * D), fw, fh, -0.12);
        }
        g.restore();
      }
      // crack stars on the glass where he knocked
      if (knock.on && knock.cracks > 0) {
        // cracked glass: white lines with an ink edge, one star per knock, beside his fist
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
      if (yossiTip > 0.5) {
        const ck = ckNames[0];
        if (ck) blit(g, ck, fx_(FRAME.outTipX), fy_(FRAME.outTipY) - 0.1 * D - ck.h * 0.5, yossiTip);
      }
      // spin streaks along the ring
      if (streak.t < 0.6) {
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.beginPath();
        for (let i = 0; i < 3; i++) {
          const a0 = streak.t * 14 + (i * Math.PI * 2) / 3;
          g.moveTo(cx + Math.cos(a0) * (R - geo.ring * 1.6), cy + Math.sin(a0) * (R - geo.ring * 1.6));
          g.arc(cx, cy, R - geo.ring * 1.6, a0, a0 + 0.7);
        }
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

    function drawGoo(g: CanvasRenderingContext2D, d: Goo): void {
      const sp = art.boogers[d.kind];
      if (!sp) return;
      // the first booger of each kind arrives big (a close-up), then shrinks to its size
      const big = d.intro > 0 ? 1 + (INTRO_SCALE - 1) * (d.st === GOO_FLY ? 1 : ease.inQuad(d.intro / INTRO_S)) : 1;
      const dims = boogerDims(d.kind, d.size * big, d.stretch);
      if (d.st === GOO_FLY) {
        const k = 0.25 + 0.75 * ease.inQuad(Math.min(1, d.t / FLY_S));
        sp.draw(g, d.x, d.y, dims.w * k, dims.h * k, d.rot);
      } else {
        const s = d.st === GOO_SPLAT ? 1 - d.t / SPLAT_S : 0;
        let sx = 1 + s * 0.35;
        let sy = 1 - s * 0.25;
        if (finalT >= 0 && aliveKind === ALIVE.Blink && d.kind === BOOGER.Googly && aliveAge < 0.15) sy *= 0.8;
        if (d.kind === BOOGER.Round && d.st === GOO_SLIDE) sx *= 1 + Math.sin(d.t * 8) * 0.03;
        sp.draw(g, d.x, d.y + (dims.h * (d.stretch - 1)) / 2, dims.w * sx, dims.h * sy, d.rot);
      }
      if (d.name >= 0) {
        const ck = ckNames[d.name];
        if (ck) blit(g, ck, d.x, d.y - dims.h * 0.5 - ck.h * 0.5);
      }
      if (d.kind === BOOGER.Hairy && d.st === GOO_ACT) {
        // grumbling squiggle
        g.strokeStyle = PAL.ink;
        g.lineWidth = 2;
        g.beginPath();
        const x0 = d.x - d.size * 0.3;
        const y0 = d.y - dims.h * 0.7;
        g.moveTo(x0, y0);
        for (let i = 1; i <= 6; i++) g.lineTo(x0 + i * d.size * 0.1, y0 + (i % 2 === 0 ? -4 : 4));
        g.stroke();
      }
    }

    function drawPile(g: CanvasRenderingContext2D, hop: number): void {
      if (pileDirty) paintPile();
      const H = pileLayerH();
      if (pileCanvas && pile.length > 0) g.drawImage(pileCanvas, 0, geo.pileBottom - H - hop, geo.w, H);
      // Yossi waves from his place
      if (yossi.st === 2 && yossi.slot >= 0) {
        const d = art.boogers[BOOGER.Round];
        const s = 0.11 * geo.D;
        const x = pileSlotX(0, yossi.slot);
        const y = pileBaseY(0) - s * 0.5 - hop;
        const wave = yossi.wave < 1.2 ? Math.sin(yossi.wave * Math.PI * 3.3) * 12 * DEG : 0;
        if (d) d.draw(g, x, y, s, s, wave);
      }
      if (mini.st === 3 && mini.slot >= 0) {
        const x = chipX(pileSlotX(0, mini.slot), mini.size);
        const y = pileBaseY(0) - mini.size * 0.5 - hop - mini.hop * 6;
        art.mini.draw(g, x, y, mini.size, mini.size);
      }
      if (king.st === 3 || king.st === 2) {
        const b = art.boogers[BOOGER.Boss];
        const land = king.st === 3 ? keys(king.t, [0, 0.8, 0.1, 1.1, 0.22, 1]) : 1;
        const fl = 1 + king.flex * 0.04;
        const s = king.size * fl;
        const y = king.st === 3 ? king.y - hop : king.y;
        if (b) b.draw(g, king.x, y + (s * (1 - land)) / 2, s * (2 - land), s * land, 0);
      }
      // the name chips last, on their fixed slots (never over each other)
      const chip = (ck: Sticker | undefined, k: number): void => {
        if (ck) blit(g, ck, chipX(chipSlotX(k), ck.w), chipLineY(k, ck.h) - hop);
      };
      if (yossi.st === 2) chip(ckNames[0], CHIP_SLOT[0]);
      for (const m of pile) if (m.name > 0) chip(ckNames[m.name], CHIP_SLOT[m.name] ?? 1);
      if (mini.st === 3) chip(ckNames[4], CHIP_SLOT[4]);
      if (king.st === 3) {
        const top = king.y - king.size * 0.5 - hop;
        blit(g, ckKing, chipX(king.x, ckKing.w), Math.min(chipLineY(KING_CHIP_SLOT, ckKing.h) - hop, top - ckKing.h * 0.3));
      }
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
      if (trophy.st >= 2) {
        // the final frame: the rank sticker goes up, clear of the booger on his head
        const top = trophyHeadY(trophySize()) - trophySize() * 0.55;
        const room = Math.max(24, top - geo.top - 4);
        const f = Math.min(1.1, maxW / b.s.w, room / b.s.h);
        blit(g, b.s, geo.w / 2, geo.top + 2 + Math.max((b.s.h * f) / 2, room / 2), ease.outBack(clamp(b.t / 0.25, 0, 1)) * f);
        return;
      }
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

    /** The waiting screen's hint: a toy finger pokes Shimi's nose five times a second. */
    function drawGhost(g: CanvasRenderingContext2D): void {
      const cycle = (gt % 0.2) / 0.2;
      const press = cycle < 0.4 ? ease.inQuad(cycle / 0.4) : 1 - ease.outQuad((cycle - 0.4) / 0.6);
      const tipX = nx() + 0.02 * geo.D;
      const tipY = ny() - 0.01 * geo.D;
      const lift = (1 - press) * 0.07 * geo.D;
      const hw = 0.13 * geo.D;
      const hh = (hw * HAND.h) / HAND.w;
      g.save();
      g.translate(tipX + lift * 0.95, tipY + lift * 0.3);
      g.rotate(-1.25);
      art.hand.draw(g, (0.5 - HAND.tipX) * hw, hh / 2, hw, hh);
      g.restore();
      if (cycle < 0.5) {
        g.globalAlpha = 0.9 * (1 - cycle * 2);
        g.strokeStyle = PAL.white;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(tipX, tipY, 8 + cycle * 40, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    /** The last-5 booger flying to his head, then sitting on it (crowned at the top rank); over the band. */
    function drawTrophy(g: CanvasRenderingContext2D): void {
      if (trophy.st >= 2) {
        const kind = trophyKind();
        const b = art.boogers[kind];
        const sz = trophySize();
        const hx = geo.cx;
        const hy = trophyHeadY(sz);
        let x = hx;
        let y = hy;
        let sx = 1;
        let sy = 1;
        if (trophy.st === 2) {
          const k = clamp(trophy.t / 0.35, 0, 1);
          x = lerp(trophy.x0, hx, k);
          y = lerp(trophy.y0, hy, k) - Math.sin(k * Math.PI) * 0.35 * geo.D;
        } else {
          const land = keys(trophy.t, [0, 0.75, 0.1, 1.12, 0.24, 1]);
          sy = land;
          sx = 2 - land;
          if (aliveKind === ALIVE.Hat && aliveAge < 0.4) {
            const j = bump(aliveAge, 0, 0.4);
            y -= j * 0.06 * geo.D;
            sy *= 1 + 0.08 * j;
          }
        }
        if (b) {
          const dims = boogerDims(kind, sz, 1);
          b.draw(g, x, y + (dims.h * (1 - sy)) / 2, dims.w * sx, dims.h * sy, 0);
        }
      }
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
      // the absurd rate: speed lines around the token (outside the ring) and steam from both sides
      if (pose.label === 'absurd' && !cur) {
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
      if (pose.label === 'absurd' && !cur) {
        for (let i = 0; i < 2; i++) {
          const ph = (gt * 2.2 + i * 0.5) % 1;
          const y = fy_(0.55) - ph * 0.16 * geo.D;
          const sz = 0.8 + ph * 0.6;
          g.globalAlpha = 1 - ph * ph;
          for (const side of [-1, 1]) {
            const x = geo.cx + side * (geo.R + 0.02 * geo.D + ph * 0.04 * geo.D);
            g.drawImage(cloud.canvas, x - (cloud.w * sz) / 2, y - (cloud.h * sz) / 2, cloud.w * sz, cloud.h * sz);
          }
        }
        g.globalAlpha = 1;
      }

      // splat decals on the glass (opaque, outlined; at most DECALS_N)
      for (const d of decals) {
        if (!d.live) continue;
        g.save();
        g.translate(d.x, d.y);
        g.rotate(d.rot);
        g.drawImage(splat.canvas, -d.s / 2, -d.s / 2, d.s, d.s);
        g.restore();
      }

      // the pile under the token, hopping with every tap
      const hop = bobT < 0.1 ? 3 * Math.sin((bobT / 0.1) * Math.PI) : 0;
      drawPile(g, hop);

      // boogers on the glass
      for (const d of goos) if (d.live) drawGoo(g, d);
      if (hanger.on) {
        const b = art.boogers[BOOGER.Stretchy];
        if (b) {
          const k = hanger.fly;
          const x = lerp(hanger.x0, hanger.x, ease.outQuad(k));
          const y = lerp(hanger.y0, hanger.y, k) - Math.sin(k * Math.PI) * 40;
          const cyc = (hanger.t % 1.6) / 1.6;
          const st = k < 1 ? 1 : cyc < 0.8 ? 1 + 0.7 * ease.inOutQuad(cyc / 0.8) : 1.7 - 0.7 * ease.outBack((cyc - 0.8) / 0.2);
          const dims = boogerDims(BOOGER.Stretchy, 0.16 * geo.D, st);
          b.draw(g, x, y + dims.h / 2, dims.w, dims.h, 0);
        }
      }
      if (golden.st > 0) {
        const b = art.boogers[BOOGER.Golden];
        const s0 = 0.14 * geo.D * (golden.st === 1 ? 0.5 + 0.5 * clamp(golden.t / 0.5, 0, 1) : 1);
        // a hard yellow star burst behind it, turning slowly (a glint each second)
        if (golden.st === 2) {
          const k = 1 + 0.12 * Math.max(0, 1 - (golden.t % 1) / 0.25);
          g.save();
          g.translate(golden.x, golden.y);
          g.rotate(golden.t * 0.6);
          stickerShape(g, STAR14, -s0 * 0.85 * k, -s0 * 0.85 * k, s0 * 1.7 * k, s0 * 1.7 * k, PAL.yel, PAL.ink, 2.5);
          g.restore();
        }
        if (b) b.draw(g, golden.x, golden.y, s0, s0, 0);
      }
      for (const b of bits) {
        if (!b.live) continue;
        const sp = art.boogers[b.kind];
        if (sp) {
          const dims = boogerDims(b.kind, b.size, 1);
          sp.draw(g, b.x, b.y, dims.w, dims.h, b.rot);
        }
      }
      // mini Shimi on its way out
      if (mini.st === 1 || mini.st === 2) art.mini.draw(g, mini.x, mini.y, mini.size, mini.size, mini.rot);
      // the squeegee: a big one, across the token
      if (squeegee.on) {
        const sw = 0.9 * geo.D;
        art.squeegee.draw(g, squeegee.x, squeegee.y, sw, sw, -45 * DEG);
      }

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

      // whistling: a music note bobbing
      if (pose.frame === FR.Whistle) {
        const x = fx_(0.8);
        const y = fy_(0.4) + Math.sin(gt * 6) * 6;
        g.drawImage(note.canvas, x - note.w / 2, y - note.h / 2, note.w, note.h);
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
      // dizzy stars over the hat
      if (orbit.t < 1.2) {
        for (let i = 0; i < 5; i++) {
          const a = orbit.t * 6 + (i * Math.PI * 2) / 5;
          const x = geo.cx + Math.cos(a) * 0.3 * geo.D;
          const y = geo.cy - 0.44 * geo.D + Math.sin(a) * 0.08 * geo.D;
          g.drawImage(star.canvas, x - star.w / 2, y - star.h / 2, star.w, star.h);
        }
      }
      // the tap count on a red star sticker, on the token's lower right
      if (stScore && finalShown) {
        const k = ease.outBack(clamp((finalT - 0.35) / 0.3, 0, 1));
        const f = Math.min(1, (0.42 * geo.D) / stScore.w);
        blit(g, stScore, geo.cx + 0.34 * geo.D, geo.cy + 0.36 * geo.D, f * k);
      }
      g.restore();

      // the cork: the head picture flies over everything
      if (corkHead.st === 1 || corkHead.st === 3) {
        const fr = art.frames[FR.Squeeze];
        if (fr) {
          const S = FRAME_SCALE * geo.D;
          let y = geo.cy - FRAME_TOP * geo.D + corkHead.y;
          let rot = corkHead.rot;
          if (corkHead.st === 3) {
            const k = ease.inQuad(clamp(corkHead.t / 0.28, 0, 1));
            y = lerp(-S - 20, geo.cy - FRAME_TOP * geo.D, k);
            rot = 0;
          }
          g.save();
          g.translate(geo.cx, y + S / 2);
          g.rotate(rot);
          g.drawImage(fr.source, -S / 2, -S / 2, S, S);
          g.restore();
        }
      }

      fx.draw(g);
      drawCounter(g);
      if (s.phase === 'waiting' && !cur && countdownDigit > 5) drawGhost(g);
      drawBand(g);
      drawTrophy(g);

      // last 5 s of the sprint: a hard red frame pulses
      if (s.phase === 'sprint' && lastQuarter) {
        const k = 0.5 + 0.5 * Math.sin(gt * 14);
        g.strokeStyle = PAL.red;
        g.lineWidth = 5 + 5 * k;
        g.strokeRect(0, geo.top, w, geo.counterTop - geo.top);
      }
      if (dim > 0) {
        g.fillStyle = `rgba(22,18,14,${(0.3 * Math.min(1, dim / 0.4)).toFixed(3)})`;
        g.fillRect(0, 0, w, h);
      }
      if (flash > 0) {
        g.fillStyle = `rgba(255,255,255,${(flashMax * flash).toFixed(3)})`;
        g.fillRect(0, 0, w, h);
      }
    }

    const placeholders = [...art.frames, art.hand, art.fingertip, art.squeegee, art.splat, art.mini, ...art.boogers].filter((d) => d.isPlaceholder).map((d) => d.key);
    debugSource = (): TapDebugState => {
      const s = engine.state;
      let sneezeN = 0;
      for (const gg of goos) if (gg.live && gg.sneeze) sneezeN++;
      let corkN = 0;
      for (const b of bits) if (b.live) corkN++;
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
        hand: pose.label,
        frame: FRAME_NAMES[pose.frame] ?? '',
        beat: cur ? cur.id : null,
        beatT: cur ? cur.t : 0,
        queuedBeats: queue.length,
        lastQuarter,
        beats: beatLog.slice(),
        events: eventLog.slice(),
        finished,
        finishedAtMs,
        sprites: { live: liveCount(), sneeze: sneezeN, cork: corkN, pile: pile.length + (yossi.st === 2 ? 1 : 0) + (mini.st === 3 ? 1 : 0) + (king.st === 3 ? 1 : 0), pileTotal, fingerprints: fpN, decals: decals.filter((d) => d.live).length, fx: fx.count },
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
    void rankAt;

    computeGeo();
    // a reload: continue the sprint (or show the final frame) this phone already played
    if (resumed) {
      const st = engine.state;
      lastScore = st.taps;
      ctx.setScore(st.taps);
      savedTaps = st.taps;
      logEvent('resumed');
      if (st.phase === 'done') {
        trophy.size = TROPHY_MIN * geo.D;
        onDone(st.taps);
      } else if (st.endAt - startOffset <= timing.sprintMs * TAP.LAST_SHARE) onLast();
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
        for (const l of [counter, print, note, star, splat, cloud]) freeLayer(l);
        for (const c of [glass, pileCanvas]) {
          if (c) {
            c.width = 0;
            c.height = 0;
          }
        }
        glass = null;
        pileCanvas = null;
        pileCtx = null;
        counter = null;
        debugSource = null;
      },
    };
  },
};
