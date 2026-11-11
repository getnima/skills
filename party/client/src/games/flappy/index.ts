/**
 * פלאפי תבורי: tap-to-flap through microphone stands.
 *
 * All gameplay is in field units (see course.ts) and advances only in the kit
 * loop's fixed steps, so a cutscene freeze stops it exactly where it is.
 * The raw score is the best run of the round (the live run counts).
 */
import { paintDrawable, starPainter } from '../../kit/assets';
import { noise, sfx, tone } from '../../kit/audio';
import { createGameCanvas, drawText, roundRectPath } from '../../kit/canvas';
import { clamp, createFx, ease, lerp } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createInput } from '../../kit/input';
import { createLoop } from '../../kit/loop';
import { COLORS, font } from '../../kit/theme';
import { GAMES } from '../../../../shared/protocol';
import { loadFlappyArt, SLOT_SIZES } from './art';
import { createCourse, FIELD, PHYS, speedAt } from './course';

import type { GameContext, GameInstance, GameModule } from '../types';
import type { Obstacle } from './course';

type Mode = 'hover' | 'fly' | 'dead' | 'glide' | 'over';

interface FlappyDebug {
  readonly mode: Mode;
  readonly run: number;
  readonly best: number;
  readonly runs: readonly number[];
  readonly birdY: number;
  readonly vy: number;
  readonly dist: number;
  readonly steps: number;
  /** Next obstacle not yet passed. */
  readonly next: { readonly x: number; readonly gapY: number; readonly gap: number };
  /** First n obstacles of the course (for determinism checks). */
  course(n: number): Array<{ x: number; gapY: number; gap: number }>;
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

const DEAD_MS = 720;
const GLIDE_MS = 1100;
const RESPAWN_MIN_LEFT_MS = 1300;
const HOVER_Y = FIELD * 0.42;
const MAX_FEATHERS = 48;
const FEATHER_COLORS = ['#ffffff', '#fff3c4', '#ffd6ea', '#ffffff'] as const;
const MAX_RAW = GAMES.flappy.maxRaw;

const STREAK_WORDS: ReadonlyArray<readonly [number, string]> = [
  [5, 'יפה!'],
  [10, 'אש!'],
  [15, 'מטורף!'],
  [20, 'אגדה!'],
  [30, 'בלתי נתפס!'],
  [40, 'מלאך אמיתי!'],
];

function streakWord(n: number): string {
  let word = 'יפה!';
  for (const [at, w] of STREAK_WORDS) if (n >= at) word = w;
  return word;
}

/** Distance from a point to a rectangle (0 inside). */
function circleHitsRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number): boolean {
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export const game: GameModule = {
  id: 'flappy',
  async create(ctx: GameContext): Promise<GameInstance> {
    const art = await loadFlappyArt();
    const view = createGameCanvas(ctx.root);
    const input = createInput(view.canvas);
    const fx = createFx(260);
    const course = createCourse(ctx.seed);
    const sparkle = paintDrawable('sparkle', starPainter('#ffe680'), 32);

    // ── layout (CSS px), recomputed from the view each step / frame ──
    const L = { W: 0, H: 0, top: 0, groundTop: 0, groundH: 0, playH: 0, U: 1, birdX: 0, sized: '' };
    const fonts = { counter: '', best: '', banner: '', hint: '', card: '', cardBig: '' };
    function measure(): void {
      const W = view.width;
      const H = view.height;
      const key = `${W}x${H}`;
      if (key === L.sized) return;
      L.sized = key;
      L.W = W;
      L.H = H;
      L.top = Math.min(ctx.hudHeight + 4, H * 0.3);
      L.groundH = Math.round(clamp(H * 0.085, 40, 80));
      L.groundTop = H - ctx.safeBottom - L.groundH;
      L.playH = Math.max(120, L.groundTop - L.top);
      L.U = L.playH / FIELD;
      L.birdX = Math.round(clamp(Math.min(W * 0.3, 34 * L.U + 20), 60, W * 0.45));
      fonts.counter = font(Math.round(L.playH * 0.3), 900);
      fonts.best = font(15, 800);
      fonts.banner = font(Math.round(clamp(W * 0.11, 30, 56)), 900);
      fonts.hint = font(Math.round(clamp(W * 0.062, 20, 28)), 900);
      fonts.card = font(Math.round(clamp(W * 0.06, 18, 26)), 800);
      fonts.cardBig = font(Math.round(clamp(W * 0.2, 56, 110)), 900);
    }
    measure();

    // ── state (field units / seconds) ──
    let mode: Mode = 'hover';
    let birdY = HOVER_Y;
    let prevY = birdY;
    let vy = 0;
    let dist = 0;
    let prevDist = 0;
    let groundScroll = 0;
    let prevGroundScroll = 0;
    let tilt = 0;
    let prevTilt = 0;
    let knockX = 0; // units, bird pushed back on a bonk
    let prevKnockX = 0;
    let knockVx = 0;
    let modeT = 0; // seconds in the current mode
    let bobT = 0;
    let wingT = 0;
    let flapBoost = 0;
    let flapFaceT = 0;
    let flapQueued = false;
    let nextIdx = 0;
    let run = 0;
    let best = 0;
    let bestAtRunStart = 0;
    let newBestShown = false;
    let runIndex = 0;
    const runs: number[] = [];
    let landed = false;
    // tweened cosmetics
    let sqX = 1;
    let sqY = 1;
    let birdScale = 1;
    let counterPop = 1;
    let flash = 0;
    let hintAlpha = 1;
    let passGlow = 0;
    let passGlowIdx = -1;
    let bannerText = '';
    let bannerColor: string = COLORS.yellow;
    let bannerT = 0;
    let bannerMax = 1;
    let destroyed = false;

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
        g.strokeStyle = 'rgba(120,90,180,0.6)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(-f.size * 1.15, 0);
        g.lineTo(f.size * 0.9, 0);
        g.stroke();
        g.restore();
      }
      g.globalAlpha = 1;
    }

    function banner(text: string, color: string, ms = 1100): void {
      bannerText = text;
      bannerColor = color;
      bannerMax = ms / 1000;
      bannerT = bannerMax;
    }

    function setBest(v: number): void {
      const next = Math.min(MAX_RAW, v);
      if (next <= best) return;
      best = next;
      ctx.setScore(best);
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

    // ── lifecycle of runs ──
    function startRun(): void {
      runIndex++;
      run = 0;
      dist = 0;
      prevDist = 0;
      nextIdx = 0;
      birdY = HOVER_Y;
      prevY = birdY;
      vy = 0;
      tilt = 0;
      prevTilt = 0;
      knockX = 0;
      prevKnockX = 0;
      knockVx = 0;
      landed = false;
      bestAtRunStart = best;
      newBestShown = false;
      mode = 'glide';
      modeT = 0;
      bobT = 0;
      passGlowIdx = -1;
      // cosmetic entrance
      birdScale = 0.2;
      fx.tween({ ms: 380, from: 0.2, to: 1, ease: ease.outBack, update: (v) => (birdScale = v) });
      flash = 0.45;
      fx.tween({ ms: 260, from: 0.45, to: 0, update: (v) => (flash = v) });
      fx.burst(L.birdX, L.top + birdY * L.U, { count: 14, colors: ['#ffffff', COLORS.yellow, COLORS.cyan], speed: 220, size: 4, life: 0.45, gravity: 0, shape: 'star' });
      sfx.whoosh(1.3);
    }

    function die(hitGround: boolean): void {
      mode = 'dead';
      modeT = 0;
      landed = hitGround;
      runs.push(run);
      setBest(run);
      const bx = L.birdX;
      const by = L.top + birdY * L.U;
      spawnFeathers(bx, by, 16, 360);
      fx.burst(bx, by, { count: 10, colors: ['#ffffff', COLORS.yellow], speed: 300, size: 4, life: 0.4, shape: 'star' });
      fx.shake(Math.max(8, L.U * 2.2), 280);
      bonkSound();
      if (!hitGround) {
        vy = -38;
        knockVx = -16;
        loop.after(160, () => {
          if (mode === 'dead' && !landed) sfx.fall();
        });
      } else {
        vy = 0;
        sqX = 1.35;
        sqY = 0.65;
        fx.tween({ ms: 320, from: 0, to: 1, ease: ease.outElastic, update: (v) => { sqX = lerp(1.35, 1, v); sqY = lerp(0.65, 1, v); } });
      }
      haptic.bump();
      flapBoost = 0;
    }

    function flap(): void {
      if (mode === 'hover') {
        fx.tween({ ms: 300, from: hintAlpha, to: 0, update: (v) => (hintAlpha = v) });
      }
      mode = 'fly';
      vy = PHYS.flapVy;
      flapBoost = 1;
      flapFaceT = 0.18;
      fx.tween({ ms: 260, from: 0, to: 1, ease: ease.outBack, update: (v) => { sqX = lerp(0.8, 1, v); sqY = lerp(1.24, 1, v); } });
      const bx = L.birdX;
      const by = L.top + birdY * L.U;
      fx.burst(bx - PHYS.radius * L.U * 0.6, by + PHYS.radius * L.U * 0.7, {
        count: 5,
        colors: ['rgba(255,255,255,0.9)', '#ffe9f3'],
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
      run++;
      setBest(run);
      passGlowIdx = o.i;
      passGlow = 1;
      counterPop = 1.25;
      fx.tween({ ms: 300, from: 1.25, to: 1, ease: ease.outCubic, update: (v) => (counterPop = v) });
      const gx = L.birdX;
      const gy = L.top + o.gapY * L.U;
      fx.burst(gx, gy, { count: 9, colors: [COLORS.yellow, '#ffffff', COLORS.pink], speed: 240, size: 4, life: 0.45, gravity: 120, shape: 'star' });
      fx.text(gx + 4, L.top + birdY * L.U - PHYS.radius * L.U - 10, '+1', { color: COLORS.yellow, size: 28, rise: 50 });
      sfx.coin(1 + Math.min(run, 24) * 0.025);
      if (run % 5 === 0) {
        banner(streakWord(run), run % 10 === 0 ? COLORS.cyan : COLORS.yellow);
        fx.confetti({ x: L.W / 2, y: L.groundTop, count: 36 });
        sfx.success();
        haptic.success();
      } else if (!newBestShown && bestAtRunStart > 0 && run === bestAtRunStart + 1) {
        newBestShown = true;
        banner('שיא חדש!', COLORS.pink);
        sfx.success();
        haptic.success();
      }
    }

    function collides(): boolean {
      const r = PHYS.hitRadius;
      const bx = knockX;
      const hw = PHYS.headW * 0.42;
      const hh = PHYS.headH * 0.78;
      const pw = PHYS.poleW / 2;
      const from = Math.max(0, nextIdx - 1);
      for (let i = from; i <= nextIdx + 1; i++) {
        const o = course.get(i);
        const ox = o.x - dist;
        if (ox - PHYS.headW > bx + r || ox + PHYS.headW < bx - r) continue;
        const gapTop = o.gapY - o.gap / 2;
        const gapBot = o.gapY + o.gap / 2;
        // heads (the dome's rounded top is covered by the circle test's corners)
        if (circleHitsRect(bx, birdY, r, ox - hw, gapTop - hh, hw * 2, hh)) return true;
        if (circleHitsRect(bx, birdY, r, ox - hw, gapBot, hw * 2, hh)) return true;
        // poles
        if (circleHitsRect(bx, birdY, r, ox - pw, -400, pw * 2, gapTop - hh + 400)) return true;
        if (circleHitsRect(bx, birdY, r, ox - pw, gapBot + hh, pw * 2, 400)) return true;
      }
      return false;
    }

    // ── fixed step ──
    function step(dt: number): void {
      measure();
      prevY = birdY;
      prevDist = dist;
      prevGroundScroll = groundScroll;
      prevTilt = tilt;
      prevKnockX = knockX;
      modeT += dt;
      bobT += dt;

      const wantFlap = flapQueued;
      flapQueued = false;

      switch (mode) {
        case 'hover': {
          birdY = HOVER_Y + Math.sin(bobT * 4.2) * 1.6;
          groundScroll += speedAt(0) * dt;
          tilt += (0 - tilt) * 0.2;
          if (wantFlap) flap();
          break;
        }
        case 'glide': {
          birdY = HOVER_Y + Math.sin(bobT * 4.2) * 1.4;
          const sp = speedAt(dist);
          dist += sp * dt;
          groundScroll += sp * dt;
          tilt += (0 - tilt) * 0.2;
          if (wantFlap) flap();
          else if (modeT * 1000 >= GLIDE_MS) {
            mode = 'fly';
            modeT = 0;
            vy = 0;
          }
          break;
        }
        case 'fly': {
          if (wantFlap) flap();
          vy = Math.min(PHYS.maxFall, vy + PHYS.gravity * dt);
          birdY += vy * dt;
          if (birdY < PHYS.radius * 0.6) {
            birdY = PHYS.radius * 0.6;
            if (vy < 0) vy = 0;
          }
          const sp = speedAt(dist);
          dist += sp * dt;
          groundScroll += sp * dt;
          const target = clamp(vy / PHYS.maxFall, -0.42, 1) * (vy > 0 ? 1.15 : 1);
          tilt += (target - tilt) * (vy > 0 ? 0.09 : 0.3);
          // passes
          for (;;) {
            const o = course.get(nextIdx);
            if (o.x - dist < -PHYS.poleW / 2 - PHYS.hitRadius) {
              pass(o);
              nextIdx++;
            } else break;
          }
          if (birdY + PHYS.hitRadius >= FIELD) {
            birdY = FIELD - PHYS.hitRadius;
            die(true);
          } else if (collides()) {
            die(false);
          }
          break;
        }
        case 'dead': {
          knockX += knockVx * dt;
          knockVx *= 1 - 5 * dt;
          if (!landed) {
            vy = Math.min(PHYS.maxFall * 1.2, vy + PHYS.gravity * 1.1 * dt);
            birdY += vy * dt;
            tilt += 9 * dt;
            const floor = FIELD - PHYS.radius * 0.85;
            if (birdY >= floor) {
              birdY = floor;
              landed = true;
              vy = 0;
              sfx.land(0.8);
              fx.burst(L.birdX + knockX * L.U, L.groundTop, { count: 8, colors: ['#ffffff', COLORS.pink], speed: 160, size: 3, life: 0.35, angle: -Math.PI / 2, spread: 2.2 });
              spawnFeathers(L.birdX + knockX * L.U, L.groundTop - 4, 5, 160);
            }
          } else {
            tilt += (Math.PI * 0.5 - tilt) * 0.15;
          }
          if (modeT * 1000 >= DEAD_MS) {
            if (ctx.timeLeftMs() > RESPAWN_MIN_LEFT_MS) startRun();
            else {
              mode = 'over';
              modeT = 0;
              bannerT = 0;
            }
          }
          break;
        }
        case 'over': {
          tilt += (Math.PI * 0.5 - tilt) * 0.15;
          break;
        }
        default: {
          const _exhaustive: never = mode;
          throw new Error(`Unhandled mode: ${String(_exhaustive)}`);
        }
      }

      // wings
      flapBoost = Math.max(0, flapBoost - dt * 3.2);
      wingT += dt * (mode === 'dead' || mode === 'over' ? 0 : 11 + flapBoost * 26);
      flapFaceT = Math.max(0, flapFaceT - dt);
      passGlow = Math.max(0, passGlow - dt * 2.4);
      if (bannerT > 0) bannerT = Math.max(0, bannerT - dt);
      updateFeathers(dt);
      fx.update(dt);
    }

    // ── drawing ──
    const g = view.ctx;

    function drawBackground(): void {
      const bg = art.background;
      const s = Math.max(L.W / bg.width, L.H / bg.height);
      bg.draw(g, L.W / 2, L.H / 2, bg.width * s, bg.height * s);
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

    function drawObstacles(d: number): void {
      const U = L.U;
      const headW = PHYS.headW * U;
      const headH = PHYS.headH * U;
      const poleW = PHYS.poleW * U;
      const minX = -L.birdX / U - PHYS.headW;
      const maxX = (L.W - L.birdX) / U + PHYS.headW;
      for (let i = Math.max(0, nextIdx - 3); ; i++) {
        const o = course.get(i);
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
          g.strokeStyle = COLORS.yellow;
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
      const bx = L.birdX + lerp(prevKnockX, knockX, alpha) * U;
      const by = L.top + lerp(prevY, birdY, alpha) * U;
      const rot = lerp(prevTilt, tilt, alpha);
      const dead = mode === 'dead' || mode === 'over';
      g.save();
      g.translate(bx, by);
      g.rotate(rot);
      g.scale(sqX * birdScale, sqY * birdScale);
      // wings behind the face
      const wa = dead ? 0.7 : Math.sin(wingT) * (0.45 + flapBoost * 0.35) - 0.15;
      const ww = r * 1.55;
      const wh = r * 1.16;
      for (let side = -1; side <= 1; side += 2) {
        g.save();
        g.translate(side * r * 0.72, -r * 0.1);
        g.scale(side, 1);
        g.rotate(-wa);
        art.wing.draw(g, ww / 2, 0, ww, wh);
        g.restore();
      }
      const face = dead ? art.face_dead : flapFaceT > 0 ? art.face_flap : art.face;
      const D = r * 2.18;
      face.draw(g, 0, 0, D, D);
      // halo (tilts off when dead)
      const hw = r * 1.45;
      const hh = hw * (SLOT_SIZES.halo.h / SLOT_SIZES.halo.w);
      const hy = -r * 1.22 + (dead ? -r * 0.15 : Math.sin(bobT * 5) * r * 0.06);
      art.halo.draw(g, dead ? r * 0.35 : 0, hy, hw, hh, dead ? 0.5 : 0);
      g.restore();

      if (dead) {
        // dizzy stars
        const t = modeT;
        for (let i = 0; i < 3; i++) {
          const a = t * 7 + (i * Math.PI * 2) / 3;
          const sx = bx + Math.cos(a) * r * 1.1;
          const sy = by - r * 1.1 + Math.sin(a) * r * 0.35;
          sparkle.draw(g, sx, sy, r * 0.62, r * 0.62, a);
        }
      }
    }

    function drawCounter(): void {
      if (mode === 'hover') return;
      g.save();
      g.font = fonts.counter;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const cx = L.W / 2;
      const cy = L.top + L.playH * 0.34;
      g.translate(cx, cy);
      g.scale(counterPop, counterPop);
      g.fillStyle = 'rgba(255,255,255,0.13)';
      g.fillText(String(run), 0, 0);
      g.restore();
    }

    function drawBest(): void {
      if (best <= 0) return;
      const text = `שיא ${best}`;
      g.font = fonts.best;
      g.textBaseline = 'middle';
      const w = g.measureText(text).width + 22;
      const h = 26;
      const x = L.W - 10 - w;
      const y = L.top + 4;
      g.fillStyle = 'rgba(12, 5, 32, 0.55)';
      roundRectPath(g, x, y, w, h, 13);
      g.fill();
      g.fillStyle = COLORS.yellow;
      g.textAlign = 'center';
      drawText(g, text, x + w / 2, y + h / 2 + 1);
    }

    function drawBanner(): void {
      if (bannerT <= 0 || bannerText === '') return;
      const age = bannerMax - bannerT;
      const pop = age < 0.25 ? ease.outBack(age / 0.25) : 1;
      const fade = clamp(bannerT / 0.3, 0, 1);
      g.save();
      g.globalAlpha = fade;
      g.translate(L.W / 2, L.top + L.playH * 0.16);
      g.scale(pop, pop);
      g.rotate(-0.06);
      g.font = fonts.banner;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 8;
      g.strokeStyle = '#1b0c33';
      g.fillStyle = bannerColor;
      drawText(g, bannerText, 0, 0, true);
      g.restore();
    }

    function drawHint(): void {
      if (hintAlpha <= 0.01) return;
      const t = bobT % 1.1;
      const press = t < 0.18 ? ease.outQuad(t / 0.18) : t < 0.4 ? 1 - ease.inOutQuad((t - 0.18) / 0.22) : 0;
      const U = L.U;
      const r = PHYS.radius * U;
      const fx0 = L.birdX + r * 2.6;
      const fy0 = L.top + birdY * U + r * 3.2;
      g.save();
      g.globalAlpha = hintAlpha;
      // ripple
      if (t > 0.12 && t < 0.9) {
        const k = (t - 0.12) / 0.78;
        g.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.85})`;
        g.lineWidth = 4 * (1 - k) + 1;
        g.beginPath();
        g.arc(fx0, fy0, r * (0.4 + k * 1.6), 0, Math.PI * 2);
        g.stroke();
      }
      // ghost hand: pointing finger, fist, thumb
      const fy = fy0 + press * r * 0.25 + r * 0.2;
      const fw = r * 0.8;
      const fh = r * 2.2;
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.strokeStyle = '#1b0c33';
      g.lineWidth = 3;
      g.lineJoin = 'round';
      // fist behind the finger
      const px = fx0 - fw * 0.5;
      const py = fy + fh * 0.62;
      const pw = fw * 2.5;
      const ph = fh * 0.82;
      roundRectPath(g, px, py, pw, ph, fw * 0.75);
      g.fill();
      g.stroke();
      // folded fingers
      g.strokeStyle = 'rgba(27,12,51,0.45)';
      g.lineWidth = 2;
      for (let k = 1; k <= 2; k++) {
        g.beginPath();
        g.moveTo(px + pw * (0.36 + k * 0.2), py + ph * 0.08);
        g.lineTo(px + pw * (0.36 + k * 0.2), py + ph * 0.42);
        g.stroke();
      }
      g.strokeStyle = '#1b0c33';
      g.lineWidth = 3;
      // thumb
      roundRectPath(g, px - fw * 0.55, py + ph * 0.18, fw * 1.25, fw * 0.75, fw * 0.37);
      g.fill();
      g.stroke();
      // the finger
      roundRectPath(g, fx0 - fw / 2, fy, fw, fh, fw / 2);
      g.fill();
      g.stroke();
      roundRectPath(g, fx0 - fw * 0.28, fy + fw * 0.16, fw * 0.56, fw * 0.5, fw * 0.24);
      g.fillStyle = 'rgba(255, 61, 139, 0.4)';
      g.fill();
      // words
      g.font = fonts.hint;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 6;
      g.strokeStyle = '#1b0c33';
      g.fillStyle = '#ffffff';
      const ty = Math.min(L.groundTop - 30, fy + fh + ph + r * 1.4);
      drawText(g, 'הקישו כדי לעוף', L.W / 2, ty, true);
      g.restore();
    }

    function drawOver(): void {
      if (mode !== 'over') return;
      const k = clamp(modeT / 0.35, 0, 1);
      const s = ease.outBack(k);
      const cw = Math.min(L.W - 48, 320);
      const ch = cw * 0.68;
      const cx = L.W / 2;
      const cy = L.top + L.playH * 0.42;
      g.save();
      g.globalAlpha = k;
      g.translate(cx, cy);
      g.scale(s, s);
      g.fillStyle = 'rgba(20, 8, 52, 0.88)';
      g.strokeStyle = COLORS.yellow;
      g.lineWidth = 4;
      roundRectPath(g, -cw / 2, -ch / 2, cw, ch, 24);
      g.fill();
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = COLORS.dim;
      g.font = fonts.card;
      drawText(g, 'השיא שלך בסיבוב', 0, -ch * 0.27);
      g.fillStyle = COLORS.yellow;
      g.font = fonts.cardBig;
      g.fillText(String(best), 0, ch * 0.1);
      g.restore();
    }

    const loop = createLoop({
      update: step,
      render(alpha: number): void {
        measure();
        const d = lerp(prevDist, dist, alpha);
        const gs = lerp(prevGroundScroll, groundScroll, alpha);
        g.clearRect(0, 0, L.W, L.H);
        drawBackground();
        g.save();
        fx.applyShake(g);
        const skyH = L.playH * 0.3;
        drawTiledX(art.skyline, L.groundTop - skyH + 2, skyH, gs * L.U * 0.25);
        drawCounter();
        drawObstacles(d);
        drawBird(alpha);
        drawTiledX(art.ground, L.groundTop, L.groundH, gs * L.U);
        if (L.H > L.groundTop + L.groundH) {
          g.fillStyle = '#1a0b3d';
          g.fillRect(0, L.groundTop + L.groundH, L.W, L.H - L.groundTop - L.groundH);
        }
        drawFeathers(g);
        g.restore();
        fx.draw(g);
        drawBanner();
        drawBest();
        if (mode === 'hover' || hintAlpha > 0.01) drawHint();
        drawOver();
        if (flash > 0) {
          g.fillStyle = `rgba(255,255,255,${flash})`;
          g.fillRect(0, 0, L.W, L.H);
        }
      },
    });

    input.onDown(() => {
      if (mode === 'hover' || mode === 'glide' || mode === 'fly') flapQueued = true;
    });

    window.__flappy = {
      get mode(): Mode {
        return mode;
      },
      get run(): number {
        return run;
      },
      get best(): number {
        return best;
      },
      get runs(): readonly number[] {
        return [...runs, ...(mode === 'dead' || mode === 'over' ? [] : [run])];
      },
      get birdY(): number {
        return birdY;
      },
      get vy(): number {
        return vy;
      },
      get dist(): number {
        return dist;
      },
      get steps(): number {
        return loop.steps;
      },
      get next(): { x: number; gapY: number; gap: number } {
        const o = course.get(nextIdx);
        return { x: o.x - dist, gapY: o.gapY, gap: o.gap };
      },
      course(n: number): Array<{ x: number; gapY: number; gap: number }> {
        const out: Array<{ x: number; gapY: number; gap: number }> = [];
        for (let i = 0; i < n; i++) {
          const o = course.get(i);
          out.push({ x: o.x, gapY: o.gapY, gap: o.gap });
        }
        return out;
      },
    };

    loop.start();

    return {
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        loop.stop();
        input.dispose();
        view.dispose();
        fx.clear();
        if (window.__flappy) delete window.__flappy;
      },
    };
  },
};
