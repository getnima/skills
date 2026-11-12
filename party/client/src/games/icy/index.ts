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
 */
import { GAMES } from '../../../../shared/protocol';
import { sfx } from '../../kit/audio';
import { createGameCanvas, drawText, roundRectPath } from '../../kit/canvas';
import { clamp, createFx, ease, lerp } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createInput } from '../../kit/input';
import { STEP_HZ, createLoop } from '../../kit/loop';
import { COLORS, PARTY_COLORS, font } from '../../kit/theme';
import { HEAD_SHARE, drawBgPattern, loadIcyArt } from './art';
import { FLOOR_H, INNER_L, INNER_R, WALL_W, WORLD_W, buildLevel, floorAtOrBelow, isMilestone } from './level';
import { MAX_VX, R, copyBody, createBody, createEvents, stepBody } from './physics';

import type { GameContext, GameInstance, GameModule } from '../types';
import type { KitPointer } from '../../kit/input';
import type { Body } from './physics';

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

const INK = '#2b1436';

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
const DASH: number[] = [10, 8];
const NO_DASH: number[] = [];

const ZONES: ReadonlyArray<readonly [string, string]> = [
  ['#16337f', '#5ab8ff'], // icy day
  ['#3a1c78', '#ff7e6b'], // sunset
  ['#120a3d', '#7a2fb8'], // violet night
  ['#04121f', '#14857f'], // aurora
  ['#1a0530', '#ff3d8b'], // party sky
];
const ZONE_LEN = 4600;

const F_BANNER = font(40, 900);
const F_SUB = font(19, 800);
const F_COMBO = font(30, 900);
const F_COMBO_LABEL = font(14, 800);
const F_PILL = font(16, 800);
const F_HINT = font(19, 800);

type Mode = 'run' | 'dead';

interface Banner {
  text: string;
  sub: string;
  color: string;
  age: number;
  life: number;
}

export const game: GameModule = {
  id: 'icy',
  async create(ctx: GameContext): Promise<GameInstance> {
    const art = await loadIcyArt();
    const view = createGameCanvas(ctx.root);
    const input = createInput(view.canvas);
    const fx = createFx(260);
    const level = buildLevel(ctx.seed);
    view.canvas.dataset.level = level.hash;

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
    }
    layout();
    const offResize = view.onResize(layout);

    // ── the sky: two static CSS gradient layers behind the transparent canvas (the
    // current zone and the next one fading in), so the browser composites them
    // instead of the canvas filling a full-screen gradient every frame ──
    const skyA = document.createElement('div');
    const skyB = document.createElement('div');
    for (const el of [skyA, skyB]) el.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    ctx.root.prepend(skyA, skyB);
    let skyZone = -1;
    let skyMix = -1;
    // held-side glows: above the canvas, below the stage HUD, never catch touches
    const glowEls = [document.createElement('div'), document.createElement('div')] as const;
    glowEls[0].style.cssText =
      'position:absolute;left:0;top:0;bottom:0;width:min(140px,30%);pointer-events:none;opacity:0;background:linear-gradient(to right, rgba(45,226,230,0.45), rgba(45,226,230,0))';
    glowEls[1].style.cssText =
      'position:absolute;right:0;top:0;bottom:0;width:min(140px,30%);pointer-events:none;opacity:0;background:linear-gradient(to left, rgba(255,61,139,0.45), rgba(255,61,139,0))';
    ctx.root.append(glowEls[0], glowEls[1]);
    let glowShown = 0;
    const zoneCss = (z: number): string => {
      const zone = ZONES[Math.min(ZONES.length - 1, z)] ?? ZONES[0];
      return zone ? `linear-gradient(to bottom, ${zone[0]}, ${zone[1]})` : '';
    };

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

    const banner: Banner = { text: '', sub: '', color: COLORS.yellow, age: 0, life: 0 };
    function showBanner(text: string, sub: string, color: string, seconds = 1.4): void {
      banner.text = text;
      banner.sub = sub;
      banner.color = color;
      banner.age = 0;
      banner.life = Math.round(seconds * STEP_HZ);
    }

    // cached UI strings (rebuilt only when the number changes)
    let floorLabel = 'קומה 0';
    let floorLabelN = 0;
    let bestLabel = '';
    let bestLabelN = 0;
    let comboLabel = '×1';
    let comboLabelN = 1;

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
        showBanner(mega ? 'מגה קומבו!' : 'סופר קומבו!', `${comboFloors} קומות · +${comboBonus}`, mega ? COLORS.yellow : COLORS.pink, 1.6);
        if (mega) {
          fx.confetti({ count: 70, width: view.width });
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
        colors: ['#ffffff', '#cfefff', COLORS.cyan],
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
      if (delta >= 2) {
        comboJumps++;
        comboFloors += delta;
        const bonus = delta * Math.min(comboJumps, COMBO_MULT_CAP) * COMBO_POINTS;
        comboBonus += bonus;
        runBonus += bonus;
        comboTimer = COMBO_WINDOW;
        comboPop = 1;
        fx.text(sx, sy - 70 * scale, `+${bonus}`, { color: COLORS.yellow, size: 24 + Math.min(14, comboJumps * 2), rise: 70 });
        fx.burst(sx, sy, { count: 10 + Math.min(14, comboJumps * 2), shape: 'star', speed: 320, size: 6, life: 0.6 });
        sfx.coin(1 + Math.min(10, comboJumps) * 0.07);
        haptic.tap();
      } else {
        if (comboJumps > 0) endCombo();
        fx.burst(sx, sy, {
          count: 5,
          colors: ['#ffffff', '#d8f3ff'],
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
          showBanner(`קומה ${m}!`, m % 50 === 0 ? 'אגדה של קרח 🧊' : '', COLORS.yellow, 1.3);
          const ma = level.alt[m] ?? body.py;
          fx.confetti({ x: view.width / 2, y: fy(ma) });
          sfx.success();
          haptic.success();
        }
      }
      if (!recordShown && runs > 0 && bestBefore > 0 && runScore() > bestBefore) {
        recordShown = true;
        showBanner('שיא חדש!', 'הריצה הזאת הכי טובה שלך', COLORS.green, 1.3);
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
      showBanner('נפלת!', `קומה ${runFloor} · שיא ${bestFloor}`, COLORS.red, 1.1);
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
      fx.burst(wx(body.x), fy(body.py + R), { count: 18, shape: 'star', speed: 260, life: 0.5 });
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
        showBanner('מהר יותר!', '', COLORS.cyan, 1.1);
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
            colors: ['#ffffff', COLORS.cyan],
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
          showBanner('10 שניות אחרונות!', 'עוד קפיצה אחת גדולה', COLORS.orange, 1.5);
          sfx.beep();
        }
        updateSnow(dt);
        fx.update(dt);
      },
      render(alpha: number): void {
        draw(alpha);
      },
    });

    // ───────────────────────────── drawing ─────────────────────────────

    function drawBackground(c: number): void {
      const g = view.ctx;
      const zf = Math.max(0, c) / ZONE_LEN;
      const z = Math.min(ZONES.length - 1, Math.floor(zf));
      const frac = zf - Math.floor(zf);
      if (z !== skyZone) {
        skyZone = z;
        skyA.style.background = zoneCss(z);
        skyB.style.background = zoneCss(z + 1);
      }
      const mix = z + 1 < ZONES.length && frac > 0.7 ? Math.round(((frac - 0.7) / 0.3) * 50) / 50 : 0;
      if (mix !== skyMix) {
        skyMix = mix;
        skyB.style.opacity = String(mix);
      }
      g.clearRect(0, 0, view.width, view.height);
      // parallax layer, tiled vertically. The placeholder is drawn as vectors (cheap);
      // a real bg.png is blitted (one more full-screen layer: fine on a phone GPU)
      const bw = view.width;
      const bh = (bw * art.bg.height) / art.bg.width;
      let y0 = (c * scale * 0.25) % bh;
      if (y0 < 0) y0 += bh;
      for (let y = y0 - bh; y < view.height; y += bh) {
        if (art.bg.isPlaceholder) {
          g.save();
          g.translate(0, y);
          drawBgPattern(g, bw, bh);
          g.restore();
        } else art.bg.draw(g, bw / 2, y + bh / 2, bw, bh);
      }
    }

    function drawWalls(c: number): void {
      const g = view.ctx;
      const ww = WALL_W * scale;
      const th = (ww * art.wall.height) / art.wall.width;
      let y0 = (c * scale) % th;
      if (y0 < 0) y0 += th;
      for (let y = y0 - th; y < view.height; y += th) {
        art.wall.draw(g, offX + ww / 2, y + th / 2, ww, th);
        art.wall.draw(g, offX + playW - ww / 2, y + th / 2, ww, th);
      }
      // outside the tower (landscape / desktop)
      if (offX > 0.5) {
        g.fillStyle = 'rgba(8, 4, 30, 0.55)';
        g.fillRect(0, 0, offX, view.height);
        g.fillRect(offX + playW, 0, offX + 1, view.height);
      }
    }

    function drawGround(c: number): void {
      const g = view.ctx;
      const gy = bottom - (0 - c) * scale;
      if (gy > view.height + 10) return;
      // distant snowy hills behind the start
      g.fillStyle = 'rgba(220, 240, 255, 0.55)';
      g.beginPath();
      g.moveTo(offX, gy);
      g.quadraticCurveTo(offX + playW * 0.22, gy - 120 * scale, offX + playW * 0.45, gy - 30 * scale);
      g.quadraticCurveTo(offX + playW * 0.7, gy - 150 * scale, offX + playW, gy - 20 * scale);
      g.lineTo(offX + playW, gy);
      g.closePath();
      g.fill();
      g.fillStyle = '#eaf7ff';
      g.fillRect(offX, gy, playW, view.height - gy + 2);
      g.fillStyle = '#bfe3ff';
      g.fillRect(offX, gy + 10 * scale, playW, 3);
      g.fillStyle = '#ffffff';
      g.fillRect(offX, gy - 2, playW, 5);
    }

    function drawFloor(j: number, sy: number): void {
      const g = view.ctx;
      const milestone = isMilestone(j);
      const half = level.half[j] ?? 0;
      const left = wx((level.x[j] ?? 0) - half);
      const w = half * 2 * scale;
      const h = FLOOR_H * scale;
      const tile = milestone ? art.milestone : art.platform;
      // shadow
      g.fillStyle = 'rgba(10, 20, 60, 0.28)';
      roundRectPath(g, left + 3, sy + 4, w, h, h * 0.45);
      g.fill();
      g.save();
      roundRectPath(g, left, sy, w, h, h * 0.45);
      g.clip();
      const tw = (h * tile.width) / tile.height;
      const phase = (j * 37) % 64;
      for (let tx = left - (phase / 64) * tw; tx < left + w; tx += tw) tile.draw(g, tx + tw / 2, sy + h / 2, tw, h);
      g.restore();
      // icicles (placeholder look only)
      if (tile.isPlaceholder) {
        g.fillStyle = milestone ? 'rgba(255, 236, 170, 0.85)' : 'rgba(210, 240, 255, 0.85)';
        g.beginPath();
        const n = Math.max(2, Math.floor(w / (26 * scale)));
        for (let k = 0; k < n; k++) {
          const ix = left + ((k + 0.5) / n) * w + (((j * 13 + k * 7) % 9) - 4) * scale;
          const il = (6 + ((j * 7 + k * 11) % 9)) * scale;
          g.moveTo(ix - 3 * scale, sy + h - 1);
          g.lineTo(ix + 3 * scale, sy + h - 1);
          g.lineTo(ix, sy + h + il);
        }
        g.fill();
      }
      if (milestone) {
        const cx = left + w / 2;
        g.font = F_PILL;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const label = `קומה ${j}`;
        const lw = g.measureText(label).width + 22;
        g.fillStyle = INK;
        roundRectPath(g, cx - lw / 2, sy - 30, lw, 26, 13);
        g.fill();
        g.strokeStyle = COLORS.yellow;
        g.lineWidth = 2;
        g.stroke();
        g.fillStyle = COLORS.yellow;
        drawText(g, label, cx, sy - 16.5);
      }
    }

    function drawBestLine(c: number): void {
      if (runs === 0 || bestFloor <= 0 || mode === 'dead') return;
      const a = level.alt[bestFloor] ?? 0;
      const sy = bottom - (a - c) * scale - 6;
      if (sy < top - 10 || sy > view.height + 10) return;
      const g = view.ctx;
      g.strokeStyle = 'rgba(61, 220, 132, 0.9)';
      g.lineWidth = 3;
      g.setLineDash(DASH);
      g.beginPath();
      g.moveTo(offX + WALL_W * scale, sy);
      g.lineTo(offX + playW - WALL_W * scale, sy);
      g.stroke();
      g.setLineDash(NO_DASH);
      g.font = F_PILL;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = COLORS.green;
      roundRectPath(g, offX + WALL_W * scale + 6, sy - 13, 56, 26, 13);
      g.fill();
      g.fillStyle = INK;
      drawText(g, 'שיא', offX + WALL_W * scale + 34, sy);
    }

    function faceFor(): typeof art.face {
      if (mode === 'dead') return art.faceFall;
      if (body.grounded >= 0) return art.face;
      if (body.vy < -1100 || body.py + R < cam.cam + 70) return art.faceFall;
      return body.vy > 0 ? art.faceJump : art.face;
    }

    function drawPlayer(c: number, alpha: number): void {
      const g = view.ctx;
      const px = wx(lerp(prevX, body.x, alpha));
      const feet = bottom - (lerp(prevPy, body.py, alpha) - c) * scale;
      const box = (2 * R * scale) / (2 * HEAD_SHARE);
      const stretch = body.grounded < 0 ? clamp(body.vy / 3200, -0.14, 0.16) : 0;
      const sq = clamp(squash, -0.4, 0.45);
      const sw = box * (1 + sq) * (1 - stretch * 0.5);
      const sh = box * (1 - sq) * (1 + stretch);
      const cy = feet - R * scale * (sh / box);

      // streak afterimages
      if (trailLen > 0) {
        for (let k = 0; k < trailLen; k++) {
          const idx = (trailHead - 1 - k + TRAIL * 2) % TRAIL;
          const t = 1 - k / TRAIL;
          const tx = wx(trailX[idx] ?? 0);
          const ty = bottom - ((trailA[idx] ?? 0) + R - c) * scale;
          g.globalAlpha = 0.5 * t;
          art.glow.draw(g, tx, ty, box * 1.5 * t + 6, box * 1.5 * t + 6);
          g.globalAlpha = 0.22 * t;
          const color = PARTY_COLORS[(k + (steps >> 2)) % PARTY_COLORS.length] ?? COLORS.pink;
          g.fillStyle = color;
          g.beginPath();
          g.arc(tx, ty, R * scale * (0.6 + 0.4 * t), 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
      }

      // speed lines
      const speed = Math.abs(body.vx);
      if (speed > 560) {
        const back = -Math.sign(body.vx);
        g.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        g.lineWidth = 3;
        g.lineCap = 'round';
        g.beginPath();
        const len = (speed - 480) * 0.09 * scale;
        for (let k = -1; k <= 1; k++) {
          const ly = cy + k * R * 0.6 * scale;
          const lx = px + back * (R + 6 + Math.abs(k) * 6) * scale;
          g.moveTo(lx, ly);
          g.lineTo(lx + back * len, ly);
        }
        g.stroke();
      }

      // shadow on the floor below while standing
      if (body.grounded >= 0) {
        g.fillStyle = 'rgba(10, 20, 60, 0.25)';
        g.beginPath();
        g.ellipse(px, feet + 2, R * scale * (1 + sq), 4 * scale + 2, 0, 0, Math.PI * 2);
        g.fill();
      }
      const lean = (body.vx / MAX_VX) * 0.2;
      faceFor().draw(g, px, cy, sw, sh, rot + lean);
    }

    function drawHint(): void {
      if (runs > 0 || hintSteps >= HINT_STEPS) return;
      const g = view.ctx;
      const t = hintSteps / STEP_HZ;
      const fade = Math.min(1, (HINT_STEPS - hintSteps) / 24) * Math.min(1, hintSteps / 8);
      const half = view.width / 2;
      const phaseLen = 0.65;
      const side = Math.floor(t / phaseLen) % 2 === 0 ? 1 : -1;
      const pt = (t % phaseLen) / phaseLen;
      // the two halves
      g.globalAlpha = 0.16 * fade;
      g.fillStyle = side < 0 ? COLORS.cyan : '#ffffff';
      g.fillRect(0, top, half, playH);
      g.fillStyle = side > 0 ? COLORS.pink : '#ffffff';
      g.fillRect(half, top, half, playH);
      g.globalAlpha = 0.5 * fade;
      g.fillStyle = '#ffffff';
      g.fillRect(half - 1, top + 20, 2, playH - 40);
      // arrows
      const ay = top + playH * 0.55;
      const as = Math.min(46, view.width * 0.11);
      for (let s = -1; s <= 1; s += 2) {
        const on = s === side;
        const ax = half + s * view.width * 0.25 + (on ? s * 8 * Math.sin(pt * Math.PI) : 0);
        g.globalAlpha = (on ? 0.95 : 0.4) * fade;
        g.fillStyle = s < 0 ? COLORS.cyan : COLORS.pink;
        g.strokeStyle = INK;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(ax + s * as, ay);
        g.lineTo(ax - s * as * 0.4, ay - as * 0.8);
        g.lineTo(ax - s * as * 0.4, ay + as * 0.8);
        g.closePath();
        g.stroke();
        g.fill();
      }
      // ghost finger pressing the active side
      const press = pt < 0.25 ? ease.outCubic(pt / 0.25) : 1;
      const fxp = half + side * view.width * 0.25;
      const fyp = ay + as * 1.6 + (1 - press) * -26;
      g.globalAlpha = fade * 0.9 * press;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(fxp, fyp + 26, 12 + pt * 30, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = fade;
      art.finger.draw(g, fxp + 10, fyp, 64, 64, -0.25 * side);
      // one short line
      g.globalAlpha = fade;
      g.font = F_HINT;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 6;
      g.lineJoin = 'round';
      g.strokeStyle = INK;
      g.fillStyle = '#ffffff';
      drawText(g, 'החזיקו צד כדי לרוץ ולקפוץ', half, top + playH * 0.3, true);
      g.globalAlpha = 1;
    }

    /** Show which half is pushed: a glow on that edge (CSS, so it costs no canvas fill). */
    function drawHeldGlow(): void {
      // the side that pushes now (the newest finger), so two fingers never light both
      const d = mode === 'run' ? heldDir() : 0;
      if (d === glowShown) return;
      glowShown = d;
      glowEls[0].style.opacity = d < 0 ? '1' : '0';
      glowEls[1].style.opacity = d > 0 ? '1' : '0';
    }

    function drawSnow(): void {
      const g = view.ctx;
      g.fillStyle = 'rgba(255, 255, 255, 0.75)';
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
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // floor pill (top left, under the HUD)
      if (runFloor !== floorLabelN) {
        floorLabelN = runFloor;
        floorLabel = `קומה ${runFloor}`;
      }
      g.font = F_PILL;
      const pw = g.measureText(floorLabel).width + 26;
      // outside the tower when there is room (landscape / desktop), else inside its left wall
      const pxl = offX > pw + 16 ? offX - pw - 10 : offX + WALL_W * scale + 8;
      g.fillStyle = 'rgba(20, 10, 50, 0.6)';
      roundRectPath(g, pxl, top + 8, pw, 30, 15);
      g.fill();
      g.fillStyle = '#ffffff';
      drawText(g, floorLabel, pxl + pw / 2, top + 23.5);
      // best floor of the round so far (after the first fall)
      if (bestFloor > 0) {
        if (bestFloor !== bestLabelN) {
          bestLabelN = bestFloor;
          bestLabel = `שיא ${bestFloor}`;
        }
        const bw = g.measureText(bestLabel).width + 22;
        const bx = offX > pw + 16 ? offX - bw - 10 : offX + WALL_W * scale + 8;
        g.fillStyle = 'rgba(20, 10, 50, 0.6)';
        roundRectPath(g, bx, top + 44, bw, 26, 13);
        g.fill();
        g.fillStyle = COLORS.green;
        drawText(g, bestLabel, bx + bw / 2, top + 57.5);
      }

      // combo meter (top center)
      if (comboJumps > 0) {
        if (comboJumps !== comboLabelN) {
          comboLabelN = comboJumps;
          comboLabel = `×${comboJumps}`;
        }
        const cx = view.width / 2;
        const cy = top + 40 * ui;
        const s = (1 + comboPop * 0.45) * ui;
        g.save();
        g.translate(cx, cy);
        g.scale(s, s);
        g.fillStyle = COLORS.pink;
        roundRectPath(g, -52, -26, 104, 52, 18);
        g.fill();
        g.strokeStyle = '#ffffff';
        g.lineWidth = 3;
        g.stroke();
        g.fillStyle = '#ffffff';
        g.font = F_COMBO;
        drawText(g, comboLabel, 0, -5);
        g.font = F_COMBO_LABEL;
        drawText(g, 'קומבו', 0, 16);
        g.restore();
        const bw = 92 * ui;
        const by = cy + 32 * ui;
        const frac = clamp(comboTimer / COMBO_WINDOW, 0, 1);
        g.fillStyle = 'rgba(255, 255, 255, 0.25)';
        roundRectPath(g, cx - bw / 2, by, bw, 7, 3.5);
        g.fill();
        g.fillStyle = frac < 0.3 ? COLORS.red : COLORS.yellow;
        roundRectPath(g, cx - bw / 2, by, bw * frac, 7, 3.5);
        g.fill();
      }

      // banner
      if (banner.life > 0) {
        const a = banner.age;
        const pop = a < BANNER_POP ? ease.outBack(a / BANNER_POP) : 1;
        const fade = Math.min(1, (banner.life - a) / 14);
        const cx = view.width / 2;
        const cy = top + Math.max(playH * 0.3, 150 * ui);
        g.save();
        g.globalAlpha = fade;
        g.translate(cx, cy);
        g.font = F_BANNER;
        const tw = g.measureText(banner.text).width;
        const fit = Math.min(ui, (Math.min(view.width, playW + 120) - 32) / Math.max(1, tw));
        g.scale(pop * fit, pop * fit);
        g.rotate(-0.04);
        g.lineJoin = 'round';
        g.lineWidth = 10;
        g.strokeStyle = INK;
        g.fillStyle = banner.color;
        drawText(g, banner.text, 0, 0, true);
        if (banner.sub) {
          g.font = F_SUB;
          g.lineWidth = 6;
          g.fillStyle = '#ffffff';
          drawText(g, banner.sub, 0, 38, true);
        }
        g.restore();
      }
    }

    function draw(alpha: number): void {
      if (destroyed) return;
      const g = view.ctx;
      const c = lerp(prevCam, cam.cam, alpha);
      drawBackground(c);
      drawSnow();
      g.save();
      fx.applyShake(g);
      drawWalls(c);
      drawGround(c);
      // floors on screen
      const minAlt = c - (view.height - bottom) / scale - FLOOR_H - 40;
      const maxAlt = c + (bottom / scale) + 40;
      if (lowFloor > 0 && (level.alt[lowFloor] ?? 0) > minAlt) lowFloor = Math.max(0, floorAtOrBelow(level, minAlt));
      while (lowFloor < level.count - 1 && (level.alt[lowFloor + 1] ?? 0) < minAlt) lowFloor++;
      for (let j = Math.max(1, lowFloor); j < level.count; j++) {
        const a = level.alt[j] ?? 0;
        if (a > maxAlt) break;
        drawFloor(j, bottom - (a - c) * scale);
      }
      drawBestLine(c);
      if (mode === 'run') drawPlayer(c, alpha);
      g.save();
      g.translate(0, bottom + c * scale);
      fx.draw(g);
      g.restore();
      g.restore();
      if (mode === 'dead') {
        const py0 = bottom - lerp(prevPopY, popY, alpha);
        const box = (2 * R * scale) / (2 * HEAD_SHARE);
        art.faceFall.draw(g, wx(deathX), py0, box * 1.25, box * 1.25, deadSteps * 0.12);
      }
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
        const out: Record<string, boolean> = {};
        for (const [k, d] of Object.entries(art)) out[k] = !d.isPlaceholder;
        return out;
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
        if (window.__icy === debug) delete window.__icy;
      },
    };
  },
};
