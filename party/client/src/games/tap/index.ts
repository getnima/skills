/**
 * שימי טאפ: mash the big face. It changes expressions, hops around more and
 * more as the round goes on, and now and then picks its nose: taps in that
 * window are worth a flat +5. Consecutive hits build a combo (x2 at 20, x3 at
 * 40) that multiplies the normal +1; a tap that misses the face breaks it and
 * costs 1 point. Counted hits are capped at HIT_RATE per second (all fingers).
 *
 * All gameplay time is kit loop game time (the level is precomputed from the
 * seed in schedule.ts), so a cutscene freeze needs no code here.
 */
import { GAMES } from '../../../../shared/protocol';
import { noise, sfx, tone } from '../../kit/audio';
import { createGameCanvas, drawText, roundRectPath } from '../../kit/canvas';
import { clamp, createFx, ease, lerp } from '../../kit/fx';
import { haptic } from '../../kit/haptics';
import { createInput } from '../../kit/input';
import { createLoop } from '../../kit/loop';
import { COLORS, font } from '../../kit/theme';
import { HEAD_RADIUS, loadTapArt } from './art';
import { buildLevel } from './schedule';

import type { KitPointer } from '../../kit/input';
import type { GameContext, GameInstance, GameModule } from '../types';
import type { Hop, PickWindow } from './schedule';

// ───────────────────────────── Tuning ─────────────────────────────

const MAX_RAW = GAMES.tap.maxRaw;
const PICK_POINTS = 5;
const COMBO_STEP = 20;
const MAX_MULT = 3;
/**
 * Counted hits per second (all fingers together) and burst size. A fast human taps
 * 8-10 times a second with one finger; above ~12/s it is a multi-finger slap, which
 * then scores like the fastest single finger, not 2x it (measured: qa-tap-play.cjs).
 */
const HIT_RATE = 12;
const HIT_BURST = 4;
/** A tap that misses the face costs this much (never below 0): slapping the whole screen loses. */
const MISS_COST = 1;
const HOP_S = 0.3;
const TUTORIAL_MS = 2_600;
/** Bottom strip for the combo meter. */
const METER_H = 74;
const SIDE_PAD = 12;

// ───────────────────────────── Static strings / options (no per-tap allocation) ─────────────────────────────

const PLUS: readonly string[] = Array.from({ length: Math.max(PICK_POINTS, MAX_MULT) + 1 }, (_, i) => `+${i}`);
const MULT_LABEL: readonly string[] = ['', 'x1', 'x2', 'x3'];
const MULT_COLOR: readonly string[] = [COLORS.cyan, COLORS.cyan, COLORS.pink, COLORS.yellow];
const T_PICK = 'מחטט!';
const T_FRENZY = 'שימי משתולל!';
const T_BREAK = 'קומבו נשבר!';
const T_HINT = 'הקישו מהר!';
const T_MISS = '-1';
const COMBO_LABELS: string[] = [];
function comboLabel(n: number): string {
  if (n < 400) {
    const cached = COMBO_LABELS[n];
    if (cached !== undefined) return cached;
    const s = `קומבו ${n}`;
    COMBO_LABELS[n] = s;
    return s;
  }
  return `קומבו ${n}`;
}

const F_METER = font(17, 900);
const F_BADGE = font(20, 900);
const F_CALLOUT = font(30, 900);
const F_PICK_BADGE = font(24, 900);
const F_FRENZY = font(40, 900);
const F_HINT = font(22, 900);

const BURST_HIT = { count: 6, speed: 300, size: 4, life: 0.45, gravity: 600 } as const;
const BURST_PICK = { count: 10, speed: 420, size: 6, life: 0.6, gravity: 500, shape: 'star', colors: [COLORS.yellow, '#ffffff', COLORS.orange] } as const;
const BURST_MISS = { count: 5, speed: 140, size: 4, life: 0.35, gravity: 0, colors: ['#9b8cc4', '#6c5b99'] } as const;
const BURST_DUST = { count: 12, speed: 260, size: 5, life: 0.45, gravity: 300, angle: -Math.PI / 2, spread: Math.PI * 1.3, colors: ['#c9b8ff', '#ffffff'] } as const;
const BURST_PICK_START = { count: 26, speed: 520, size: 7, life: 0.8, gravity: 200, shape: 'star', colors: [COLORS.yellow, COLORS.green, '#ffffff'] } as const;
const TEXT_HIT = [
  { color: '#ffffff', size: 28, rise: 70, life: 0.7 },
  { color: '#ffffff', size: 28, rise: 70, life: 0.7 },
  { color: COLORS.pink, size: 32, rise: 80, life: 0.75 },
  { color: COLORS.yellow, size: 36, rise: 90, life: 0.8 },
] as const;
const TEXT_PICK = { color: COLORS.yellow, size: 44, rise: 110, life: 0.9 } as const;
const TEXT_MISS = { color: '#ff6b7d', size: 24, rise: 40, life: 0.55 } as const;
const TEXT_MULT = { color: COLORS.yellow, size: 56, rise: 90, life: 1.2 } as const;

// ───────────────────────────── Debug (tests) ─────────────────────────────

export interface TapDebugState {
  readonly fingerprint: string;
  readonly elapsedMs: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly picking: boolean;
  readonly combo: number;
  readonly mult: number;
  readonly score: number;
  readonly hits: number;
  readonly misses: number;
  readonly picks: number;
  readonly hops: number;
}

let debugSource: (() => TapDebugState) | null = null;

declare global {
  interface Window {
    /** Read-only state of the running tap game for test scripts (like __flappy / __ninja). */
    __tap?: () => TapDebugState | null;
  }
}

/** Live state of the running tap game, for automated checks. Null when none runs. */
export function tapDebug(): TapDebugState | null {
  return debugSource ? debugSource() : null;
}

// ───────────────────────────── Game ─────────────────────────────

interface Ripple {
  x: number;
  y: number;
  t: number;
  hit: boolean;
  live: boolean;
}

export const game: GameModule = {
  id: 'tap',
  async create(ctx: GameContext): Promise<GameInstance> {
    const level = buildLevel(ctx.seed, ctx.durationMs);
    const art = await loadTapArt();
    const view = createGameCanvas(ctx.root);
    view.canvas.dataset.level = level.fingerprint;
    const input = createInput(view.canvas);
    const fx = createFx(260);

    // Round time already gone when we start (slow load / late join), snapped to whole steps.
    const startOffset = clamp(Math.round((ctx.durationMs - ctx.timeLeftMs()) / (1000 / 60)) * (1000 / 60), 0, ctx.durationMs);

    // ── state ──
    let score = 0;
    let combo = 0;
    let mult = 1;
    let hits = 0;
    let misses = 0;
    let tokens = HIT_BURST;
    let picksSeen = 0;
    let hopsSeen = 0;

    let exprIdx = 0;
    let pickIdx = 0;
    let hopIdx = 0;
    let expr = 0;
    let picking: PickWindow | null = null;
    let pickAge = 0; // s since the pick began
    let frenzy = false;
    let frenzyAge = 99; // s since the frenzy began

    // face pose, normalized: u/v 0..1 in the free area, scale ~1
    let fromU = 0.5;
    let fromV = 0.5;
    let fromS = 1;
    let toU = 0.5;
    let toV = 0.5;
    let toS = 1;
    let hopT = 1;
    let squash = 0;
    let squashV = 0;
    let tilt = 0;
    let tiltV = 0;
    let exprPop = 0;
    let multFlash = 0;
    let breakFlash = 0;
    let meterFill = 0;
    let lastSfxStep = -1;
    let tutorialAlpha = 1;
    let elapsed = startOffset;
    let leftMs = ctx.timeLeftMs();
    let destroyed = false;

    // geometry (recomputed every step and every render)
    const geo = { x: 0, y: 0, r: 0, baseR: 0, lift: 0, top: 0, bottom: 0, left: 0, right: 0 };

    const ripples: Ripple[] = [];
    for (let i = 0; i < 16; i++) ripples.push({ x: 0, y: 0, t: 0, hit: false, live: false });
    let rippleNext = 0;

    function computeGeo(): void {
      const w = view.width;
      const h = view.height;
      const top = ctx.hudHeight + 10;
      const bottom = Math.max(top + 120, h - ctx.safeBottom - METER_H);
      const left = SIDE_PAD;
      const right = Math.max(left + 120, w - SIDE_PAD);
      const fw = right - left;
      const fh = bottom - top;
      const baseR = clamp(Math.min(fw * 0.42, fh * 0.31), 48, 210);
      const k = hopT >= 1 ? 1 : ease.outCubic(hopT);
      const u = lerp(fromU, toU, k);
      const v = lerp(fromV, toV, k);
      const s = lerp(fromS, toS, k);
      const r = baseR * s;
      const m = r * 1.06;
      const spanX = Math.max(0, fw - 2 * m);
      const spanY = Math.max(0, fh - 2 * m);
      // livelier as the round goes on: a little dance in the frenzy
      const dance = frenzy ? Math.sin(elapsed * 0.011) * r * 0.07 : 0;
      const lift = hopT >= 1 ? 0 : Math.sin(Math.PI * hopT) * baseR * 0.32;
      geo.x = left + m + u * spanX + dance + (spanX === 0 ? (fw - 2 * m) / 2 : 0);
      geo.y = top + m + v * spanY - lift + (spanY === 0 ? (fh - 2 * m) / 2 : 0);
      geo.r = r;
      geo.baseR = baseR;
      geo.lift = lift;
      geo.top = top;
      geo.bottom = bottom;
      geo.left = left;
      geo.right = right;
    }

    // ── sounds ──
    function pickStartSound(): void {
      noise({ dur: 0.18, vol: 0.22, filter: { type: 'bandpass', freq: 900, to: 300, q: 2 } });
      tone({ freq: 660, dur: 0.12, type: 'square', vol: 0.09, at: 0.05 });
      tone({ freq: 990, dur: 0.18, type: 'square', vol: 0.09, at: 0.15 });
      tone({ freq: 1320, dur: 0.25, type: 'triangle', vol: 0.12, at: 0.26 });
    }
    function breakSound(): void {
      tone({ freq: 420, to: 160, dur: 0.32, type: 'sawtooth', vol: 0.1, lowpass: 1400 });
    }

    // ── events of the level ──
    function startPick(p: PickWindow): void {
      picking = p;
      pickAge = 0;
      picksSeen++;
      computeGeo();
      fx.burst(geo.x, geo.y, BURST_PICK_START);
      fx.shake(5, 250);
      squashV -= 6;
      pickStartSound();
      haptic.bump();
    }

    function endPick(): void {
      picking = null;
      exprPop = 1;
    }

    function startHop(hp: Hop, animate: boolean): void {
      computeGeo();
      const k = hopT >= 1 ? 1 : ease.outCubic(hopT);
      fromU = lerp(fromU, toU, k);
      fromV = lerp(fromV, toV, k);
      fromS = lerp(fromS, toS, k);
      toU = hp.u;
      toV = hp.v;
      toS = hp.scale;
      hopsSeen++;
      if (!animate) {
        fromU = toU;
        fromV = toV;
        fromS = toS;
        hopT = 1;
        return;
      }
      hopT = 0;
      fx.burst(geo.x, geo.y + geo.r * 0.9, BURST_DUST);
      sfx.jump(0.9 + (hopsSeen % 4) * 0.08);
    }

    function land(): void {
      computeGeo();
      squashV += 7;
      fx.burst(geo.x, geo.y + geo.r * 0.95, BURST_DUST);
      sfx.land(1);
    }

    // ── taps ──
    function spawnRipple(x: number, y: number, hit: boolean): void {
      const rp = ripples[rippleNext];
      rippleNext = (rippleNext + 1) % ripples.length;
      if (!rp) return;
      rp.x = x;
      rp.y = y;
      rp.t = 0;
      rp.hit = hit;
      rp.live = true;
    }

    function onHit(p: KitPointer): void {
      if (tokens < 1) {
        // faster than any human: a bounce, no points
        squashV += 1.5;
        return;
      }
      tokens -= 1;
      hits++;
      combo++;
      const nextMult = Math.min(MAX_MULT, 1 + Math.floor(combo / COMBO_STEP));
      // the combo multiplies the normal +1; a nose-pick tap is a flat +5
      const pts = picking ? PICK_POINTS : nextMult;
      score = Math.min(MAX_RAW, score + pts);
      ctx.setScore(score);

      squashV += picking ? 5.5 : 4;
      tiltV += (Math.random() - 0.5) * 6; // cosmetic wobble
      spawnRipple(p.x, p.y, true);
      const textY = Math.max(ctx.hudHeight + 120, p.y - 30);
      if (picking) {
        fx.burst(p.x, p.y, BURST_PICK);
        fx.text(p.x, textY, PLUS[pts] ?? '+', TEXT_PICK);
      } else {
        fx.burst(p.x, p.y, BURST_HIT);
        fx.text(p.x, textY, PLUS[pts] ?? '+', TEXT_HIT[nextMult] ?? TEXT_HIT[1]);
      }

      const step = loop.steps;
      if (step !== lastSfxStep) {
        lastSfxStep = step;
        if (picking) sfx.coin(1 + Math.min(combo, 60) * 0.006);
        else sfx.pop(1 + Math.min(combo, 60) * 0.012);
        haptic.tap();
      }

      if (nextMult > mult) {
        mult = nextMult;
        multFlash = 1;
        computeGeo();
        fx.text(view.width / 2, geo.bottom - 10, MULT_LABEL[mult] ?? 'x3', TEXT_MULT);
        fx.confetti({ x: view.width / 2, y: geo.bottom, count: 40 });
        fx.shake(7, 300);
        sfx.success();
        haptic.success();
      }
      mult = nextMult;
    }

    function onMiss(p: KitPointer): void {
      misses++;
      spawnRipple(p.x, p.y, false);
      fx.burst(p.x, p.y, BURST_MISS);
      if (score > 0) {
        score = Math.max(0, score - MISS_COST);
        ctx.setScore(score);
        fx.text(p.x, Math.max(ctx.hudHeight + 24, p.y - 24), T_MISS, TEXT_MISS);
      }
      if (combo >= 5) {
        breakFlash = 1;
        fx.text(view.width / 2, geo.bottom - 4, T_BREAK, { color: COLORS.red, size: 26, rise: 50, life: 0.9 });
        breakSound();
        if (combo >= COMBO_STEP) {
          fx.shake(6, 220);
          haptic.fail();
        }
      } else {
        sfx.tap(0.55);
      }
      combo = 0;
      mult = 1;
    }

    input.onDown((p) => {
      if (destroyed || p.y < ctx.hudHeight) return;
      computeGeo();
      const dx = p.x - geo.x;
      const dy = p.y - geo.y;
      const reach = geo.r * 1.06;
      if (dx * dx + dy * dy <= reach * reach) onHit(p);
      else onMiss(p);
    });

    // ── loop ──
    const loop = createLoop({
      update(dt: number): void {
        elapsed = startOffset + loop.timeMs;
        leftMs = ctx.timeLeftMs();
        tokens = Math.min(HIT_BURST, tokens + HIT_RATE * dt);

        // level events
        const exprs = level.exprs;
        let e = exprs[exprIdx];
        while (e && e.at <= elapsed) {
          expr = e.expr;
          if (!picking) exprPop = 1;
          exprIdx++;
          e = exprs[exprIdx];
        }

        if (picking && elapsed >= picking.end) {
          endPick();
          pickIdx++;
        }
        let pk = level.picks[pickIdx];
        while (!picking && pk && elapsed >= pk.end) {
          pickIdx++; // missed entirely (late start)
          pk = level.picks[pickIdx];
        }
        if (!picking && pk && elapsed >= pk.start) startPick(pk);

        let hp = level.hops[hopIdx];
        while (hp && hp.at <= elapsed) {
          const nextHop = level.hops[hopIdx + 1];
          startHop(hp, !(nextHop && nextHop.at <= elapsed));
          hopIdx++;
          hp = nextHop;
        }

        if (!frenzy && elapsed >= level.frenzyFrom) {
          frenzy = true;
          frenzyAge = 0;
          fx.shake(9, 450);
          sfx.go();
          haptic.bump();
        }

        // motion
        if (hopT < 1) {
          hopT = Math.min(1, hopT + dt / HOP_S);
          if (hopT >= 1) land();
        }
        // springs: squash (+ = wide and flat) and tilt
        squashV += (-320 * squash - 16 * squashV) * dt;
        squash += squashV * dt;
        tiltV += (-260 * tilt - 14 * tiltV) * dt;
        tilt += tiltV * dt;
        exprPop = Math.max(0, exprPop - dt * 5);
        multFlash = Math.max(0, multFlash - dt * 1.6);
        breakFlash = Math.max(0, breakFlash - dt * 2.2);
        if (picking) pickAge += dt;
        frenzyAge += dt;

        const target = mult >= MAX_MULT ? 1 : (combo % COMBO_STEP) / COMBO_STEP;
        meterFill += (target - meterFill) * Math.min(1, dt * 14);

        const tutorialOn = elapsed - startOffset < TUTORIAL_MS && hits < 3;
        tutorialAlpha = tutorialOn ? Math.min(1, tutorialAlpha + dt * 4) : Math.max(0, tutorialAlpha - dt * 4);

        for (const rp of ripples) {
          if (!rp.live) continue;
          rp.t += dt;
          if (rp.t > 0.4) rp.live = false;
        }

        fx.update(dt);
        computeGeo();
      },
      render(): void {
        computeGeo();
        draw();
      },
    });

    // ── drawing ──
    function draw(): void {
      const g = view.ctx;
      const w = view.width;
      const h = view.height;
      const t = loop.timeMs / 1000;
      view.clear();

      // backdrop (cover)
      const bg = art.background;
      const cover = Math.max(w / bg.width, h / bg.height);
      bg.draw(g, w / 2, h / 2, bg.width * cover, bg.height * cover);
      if (frenzy) {
        // red pulse, faster in the last seconds
        const speed = leftMs < 5_000 ? 14 : 7;
        g.globalAlpha = 0.1 + 0.08 * Math.sin(t * speed);
        g.fillStyle = COLORS.red;
        g.fillRect(0, 0, w, h);
        g.globalAlpha = 1;
      }
      if (picking) {
        g.globalAlpha = 0.16 + 0.06 * Math.sin(t * 18);
        g.fillStyle = COLORS.yellow;
        g.fillRect(0, 0, w, h);
        g.globalAlpha = 1;
      }

      g.save();
      fx.applyShake(g);

      const { x, y, r } = geo;
      const box = r / HEAD_RADIUS;

      // sunburst behind the face
      g.globalAlpha = picking ? 0.85 : frenzy ? 0.45 : 0.3;
      art.rays.draw(g, x, y, r * 3.3, r * 3.3, t * (picking ? 1.6 : 0.35));
      g.globalAlpha = 1;

      // glow ring while picking
      if (picking) {
        const pulse = 1 + 0.06 * Math.sin(t * 16);
        art.glow.draw(g, x, y, r * 2.75 * pulse, r * 2.75 * pulse);
      }

      // shadow on the "floor" under the face
      const floorY = y + geo.lift + r * 1.02;
      const shadowK = 1 - geo.lift / (geo.baseR * 0.6);
      g.globalAlpha = clamp(shadowK, 0.3, 1);
      art.shadow.draw(g, x, floorY, r * 1.7 * shadowK, r * 0.42 * shadowK);
      g.globalAlpha = 1;

      // the face: breathing + squash and stretch + tilt
      const life = frenzy ? 0.05 : 0.025;
      const breathe = 1 + Math.sin(t * (frenzy ? 9 : 3.2)) * life + exprPop * 0.07;
      const sq = clamp(squash * 0.06, -0.22, 0.22);
      const sx = breathe * (1 + sq);
      const sy = breathe * (1 - sq);
      const wiggle = picking ? Math.sin(t * 30) * 0.06 : 0;
      const face = picking ? art.nosepick : (art.faces[expr] ?? art.faces[0]);
      if (face) {
        g.save();
        g.translate(x, y + r * 0.9);
        g.rotate(clamp(tilt * 0.05, -0.3, 0.3) + wiggle);
        g.scale(sx, sy);
        face.draw(g, 0, -r * 0.9, box, box);
        g.restore();
      }

      // nose-pick: countdown ring + callout
      if (picking) drawPickUi(g, x, y, r, t);

      // tap ripples
      g.lineWidth = 4;
      for (const rp of ripples) {
        if (!rp.live) continue;
        const k = rp.t / 0.4;
        g.globalAlpha = 1 - k;
        g.strokeStyle = rp.hit ? (picking ? COLORS.yellow : '#ffffff') : '#8f80bd';
        g.beginPath();
        g.arc(rp.x, rp.y, 10 + k * (rp.hit ? 46 : 28), 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;

      g.restore();
      fx.draw(g);

      drawMeter(g, w);
      if (frenzyAge < 1.8) drawFrenzyBanner(g, w);
      if (tutorialAlpha > 0) drawTutorial(g, t);
    }

    function drawPickUi(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: number): void {
      const p = picking;
      if (!p) return;
      const frac = clamp(1 - (elapsed - p.start) / (p.end - p.start), 0, 1);
      g.lineCap = 'round';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(43, 20, 54, 0.45)';
      g.beginPath();
      g.arc(x, y, r * 1.14, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = COLORS.yellow;
      g.beginPath();
      g.arc(x, y, r * 1.14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      g.stroke();

      // callout pill: above the face when there is room, else below
      const pillW = 196;
      const pillH = 52;
      let py = y - r * 1.14 - pillH / 2 - 14;
      if (py - pillH / 2 < geo.top) py = Math.min(y + r * 1.14 + pillH / 2 + 14, geo.bottom - pillH / 2);
      const pop = pickAge < 0.35 ? ease.outBack(pickAge / 0.35) : 1 + Math.sin(t * 12) * 0.04;
      const px = clamp(x, pillW / 2 + 6, view.width - pillW / 2 - 6);
      g.save();
      g.translate(px, py);
      g.scale(pop, pop);
      g.rotate(Math.sin(t * 9) * 0.05);
      g.fillStyle = 'rgba(20, 6, 40, 0.35)';
      roundRectPath(g, -pillW / 2 + 3, -pillH / 2 + 5, pillW, pillH, pillH / 2);
      g.fill();
      g.fillStyle = COLORS.pink;
      roundRectPath(g, -pillW / 2, -pillH / 2, pillW, pillH, pillH / 2);
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#ffffff';
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      g.font = F_CALLOUT;
      drawText(g, T_PICK, 22, 2);
      // ×5 badge on the left end
      g.fillStyle = COLORS.yellow;
      g.beginPath();
      g.arc(-pillW / 2 + 30, 0, 24, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#2b1436';
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = '#2b1436';
      g.font = F_PICK_BADGE;
      drawText(g, 'x5', -pillW / 2 + 30, 2);
      g.restore();
    }

    function drawMeter(g: CanvasRenderingContext2D, w: number): void {
      const barW = Math.min(w - 48, 340);
      const barH = 16;
      const cx = w / 2;
      const barY = view.height - ctx.safeBottom - 22;
      const x0 = cx - barW / 2;
      const color = MULT_COLOR[mult] ?? COLORS.cyan;

      // label row (RTL): multiplier badge at the right end, then the combo count
      g.textBaseline = 'middle';
      g.font = F_METER;
      g.textAlign = 'right';
      g.fillStyle = breakFlash > 0 ? COLORS.red : 'rgba(255, 255, 255, 0.92)';
      drawText(g, comboLabel(combo), x0 + barW - 60, barY - 25);

      const pop = 1 + multFlash * 0.5;
      g.save();
      g.translate(x0 + barW - 24, barY - 26);
      g.scale(pop, pop);
      g.fillStyle = color;
      roundRectPath(g, -24, -14, 48, 28, 14);
      g.fill();
      g.fillStyle = '#2b1436';
      g.font = F_BADGE;
      g.textAlign = 'center';
      drawText(g, MULT_LABEL[mult] ?? 'x1', 0, 1);
      g.restore();

      // bar
      g.fillStyle = 'rgba(10, 3, 30, 0.55)';
      roundRectPath(g, x0, barY - barH / 2, barW, barH, barH / 2);
      g.fill();
      const fillW = Math.max(barH, barW * clamp(meterFill, 0, 1));
      if (meterFill > 0.01) {
        g.fillStyle = color;
        roundRectPath(g, x0, barY - barH / 2, fillW, barH, barH / 2);
        g.fill();
        g.fillStyle = 'rgba(255, 255, 255, 0.35)';
        roundRectPath(g, x0 + 4, barY - barH / 2 + 3, Math.max(0, fillW - 8), 4, 2);
        g.fill();
      }
      g.lineWidth = 2;
      g.strokeStyle = breakFlash > 0 ? COLORS.red : 'rgba(255, 255, 255, 0.4)';
      roundRectPath(g, x0, barY - barH / 2, barW, barH, barH / 2);
      g.stroke();
    }

    function drawFrenzyBanner(g: CanvasRenderingContext2D, w: number): void {
      const k = frenzyAge / 1.8;
      const inK = clamp(frenzyAge / 0.3, 0, 1);
      const s = ease.outBack(inK) * (1 + 0.04 * Math.sin(frenzyAge * 20));
      g.save();
      g.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      g.translate(w / 2, geo.top + 46);
      g.rotate(-0.06);
      g.scale(s, s);
      g.fillStyle = COLORS.red;
      roundRectPath(g, -150, -32, 300, 64, 18);
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = COLORS.yellow;
      g.stroke();
      g.fillStyle = '#ffffff';
      g.font = F_FRENZY;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      drawText(g, T_FRENZY, 0, 3);
      g.restore();
    }

    function drawTutorial(g: CanvasRenderingContext2D, t: number): void {
      const { x, y, r } = geo;
      const cycle = (t % 0.55) / 0.55;
      // finger comes down, presses, lifts
      const press = cycle < 0.35 ? ease.inQuad(cycle / 0.35) : 1 - ease.outQuad((cycle - 0.35) / 0.65);
      const tipX = x + r * 0.42;
      const tipY = y + r * 0.42;
      g.save();
      g.globalAlpha = tutorialAlpha;
      if (cycle >= 0.35 && cycle < 0.85) {
        const k = (cycle - 0.35) / 0.5;
        g.globalAlpha = tutorialAlpha * (1 - k);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 5;
        g.beginPath();
        g.arc(tipX, tipY, 12 + k * 40, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = tutorialAlpha;
      }
      const hand = art.hand;
      const s = 1 - press * 0.1;
      const hw = hand.width * s;
      const hh = hand.height * s;
      // fingertip is 6% from the top of the sprite
      art.hand.draw(g, tipX, tipY - (1 - press) * 26 + hh * 0.44, hw, hh, -0.25);

      // short hint under the face
      const hy = Math.min(y + r * 1.1 + 28, geo.bottom - 20);
      g.font = F_HINT;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(20, 6, 40, 0.8)';
      g.fillStyle = '#ffffff';
      drawText(g, T_HINT, x, hy, true);
      g.restore();
    }

    debugSource = (): TapDebugState => ({
      fingerprint: level.fingerprint,
      elapsedMs: elapsed,
      x: geo.x,
      y: geo.y,
      r: geo.r,
      picking: picking !== null,
      combo,
      mult,
      score,
      hits,
      misses,
      picks: picksSeen,
      hops: hopsSeen,
    });

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
        debugSource = null;
      },
    };
  },
};
