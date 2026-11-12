# Game kit

Everything a mini game needs. Canvas 2D, no framework. Import from `../../kit/<file>`.
Try things at `/dev.html` (games), `/dev.html?game=demo` (the example below), `/dev.html?kit=1` (all placeholder art + all sounds).

## Rules (read these first)

1. **Game time = fixed steps of the kit loop.** Put all logic in `update(dt)` (`dt` is always 1/60 s). Never use `Date.now()`, `performance.now()`, `setTimeout`, `setInterval` or your own `requestAnimationFrame` for gameplay: use `loop.after` / `loop.every` / `loop.timeMs` / `fx.tween`.
2. **Freeze.** During a cutscene the stage calls `setKitPaused(true)`: loops keep calling `render` (the frozen frame) but not `update`, loop timers and fx stand still, and input drops everything (pointers that were down get `onUp` with `cancelled: true`). A game that follows rule 1 needs no code for this. Implement `GameInstance.setPaused` only for what the kit does not own (CSS animations, `<video>`, your own timers). The stage also covers the game with a veil that swallows touches, so DOM buttons are safe too.
3. **Randomness = `createRng(ctx.seed)`.** Never `Math.random()` for anything that affects the level or the score (every phone must get the same level).
4. **Round time** is `ctx.timeLeftMs()`; the stage owns the clock and the HUD. Do not draw your own timer or score. Keep gameplay below `ctx.hudHeight` and above `ctx.safeBottom`.
5. **Score**: `ctx.setScore(n)` whenever it changes (rounded to an integer ≥ 0; the stage throttles the network). The last value is final. `ctx.finish()` only when nothing more can be gained.
6. **Art = slots** (`loadAssets`). Never draw a face inline in the game when it should be replaceable tomorrow: declare a slot with a placeholder painter.
7. **`destroy()`** must stop the loop, dispose input and canvas, and be idempotent. An exception inside `update` / `render` / an input handler is caught by the kit and ends the game with a friendly screen (the score is kept).
8. Canvas text is LTR (so `+5` is not drawn as `5+`): draw Hebrew with `drawText()`. Use `roundRectPath()`, not `ctx.roundRect` (missing on iOS 15).
9. Bind `createInput` to the **canvas**, not to a container that also holds DOM buttons (pointer capture would eat their clicks).

## API

### loop.ts
- `createLoop({ update(dt), render?(alpha) }): Loop` fixed 60Hz update, render every frame with interpolation `alpha` (0..1), frame dt clamped to 100ms, sleeps while the tab is hidden.
- `loop.start()` / `loop.stop()` (stop is final and drops timers) / `loop.running`
- `loop.timeMs` game time in ms / `loop.steps` fixed steps done
- `loop.after(ms, fn): cancel` once, after `ms` of game time / `loop.every(ms, fn): cancel` repeating
- `STEP_S` (1/60), `STEP_MS`, `STEP_HZ`
- `setKitPaused(paused)` / `isKitPaused()` the global freeze switch (the stage drives it; games only read it)
- `onKitPause(fn): off` notified on freeze changes
- `setKitErrorHandler(fn)` / `reportKitError(err)` stage plumbing

### canvas.ts
- `createGameCanvas(root): GameCanvas` fills `root`, DPR-aware (capped at 2), follows resize / rotation.
- `view.ctx` (draw in CSS px) / `view.width` / `view.height` (read every frame) / `view.dpr` / `view.canvas`
- `view.onResize((w, h) => …): off` / `view.clear()` / `view.dispose()`
- `drawText(ctx, text, x, y, stroke?)` fillText with automatic RTL for Hebrew
- `roundRectPath(ctx, x, y, w, h, r)` rounded-rect path (includes beginPath)

### input.ts
- `createInput(target): Input` Pointer Events, multi-touch, coordinates in CSS px relative to `target` (= canvas space).
- `input.onDown(fn): off` / `input.onMove(fn): off` (only while down) / `input.onUp(fn): off`; handlers get a `KitPointer`
- `KitPointer`: `id, x, y, prevX, prevY, startX, startY, downAt, type, cancelled`
- `input.pointers` (Map of pointers that are down) / `input.isDown()` / `input.dispose()`

### rng.ts
- `createRng(seed): Rng`
- `rng.next()` float [0,1) / `rng.float(min, max)` / `rng.int(min, max)` inclusive / `rng.pick(array)` / `rng.chance(p)` / `rng.shuffle(array)` new array
- `rng.fork(label)` independent stream that depends only on the seed and the label (`fork('level')`, `fork('colors')`)

### assets.ts
- `loadAssets(group, slots): Promise<Record<key, Drawable>>` slot = `{ key, file, size, height?, fit?: 'contain' | 'cover', round?, placeholder }`. Uses `client/public/assets/<group>/<file>` when it exists (same base name with .png / .webp / .jpg / .jpeg / .svg also matches), else the placeholder. Never rejects, a missing file costs nothing. (A production build must be re-run after files are added.)
- `Drawable`: `draw(ctx, cx, cy, w?, h?, rotation?)` **centered** on (cx, cy) / `width` / `height` / `isPlaceholder` / `url` (for `<img src>`, CSS) / `source` (canvas)
- `paintDrawable(key, painter, width, height?)` a Drawable from a painter, sync, no file lookup
- `assetFileUrl(group, file): string | null` URL of the real file if present (sync, for DOM code)
- `Painter = (ctx, w, h) => void` draws into the box (0,0)-(w,h)
- `facePainter(expression?, color?)` generic cartoon face; `FACE_EXPRESSIONS` = normal, happy, surprised, angry, tongue, wink, nose-pick, dead, laughing, shocked
- `drawFace(ctx, cx, cy, r, expression?, color?)` the same face drawn live (procedural, not replaceable: prefer slots)
- `bombPainter`, `crownPainter`, `starPainter(color?)`
- `shade(hex, amount)` lighten (>0) / darken (<0) a `#rrggbb`

### fx.ts
- `createFx(maxParticles = 500): Fx` call `fx.update(dt)` in update and `fx.draw(ctx)` in render.
- `fx.burst(x, y, { count, colors, speed, size, life, gravity, angle, spread, shape: 'dot' | 'square' | 'star' })`
- `fx.confetti({ count, width })` rain from the top, or `{ x, y }` to shoot up from a point
- `fx.text(x, y, '+10', { color, size, life, rise })` floating text
- `fx.shake(strength, ms?)` then `fx.applyShake(ctx)` inside `save()` / `restore()`; `fx.shakeX` / `fx.shakeY` for DOM
- `fx.tween({ ms, from?, to?, ease?, delay?, update(v), done? }): cancel` game-time tween
- `fx.clear()` / `fx.count`
- `ease.linear | inQuad | outQuad | inOutQuad | inCubic | outCubic | inOutCubic | outBack | outElastic | outBounce`, `clamp(v, min, max)`, `lerp(a, b, t)`

### audio.ts (synth, no files; silent until the first touch, which unlocks it automatically)
- `sfx.tap(p) pop(p) coin(p) whoosh(p) slice(p) jump(p) land(p) hit() explode() splat(p) fart(variant?, p?) success() fail() tick(p) beep() go() drumroll(ms?) fanfare() cheer() boo() laugh(p) fall() key(p)`; `p` = pitch multiplier (default 1), e.g. `sfx.pop(1 + combo * 0.06)`. `fart` variants: 0 short, 1 long, 2 squeaker, 3 wet; none = they take turns.
- `unlockAudio()` call from a gesture (also done automatically on the first pointerdown / keydown)
- While the page is hidden (locked phone, another app) the AudioContext is suspended and song files are paused; both come back when the page is visible again (iOS may need the next tap).
- `setMuted(bool)` / `isMuted()` / `onMuteChange(fn): off` (persisted in localStorage)
- Building blocks for custom sounds: `tone({ freq, to?, dur, type?, vol?, at?, attack?, vibrato?, lowpass? })`, `noise({ dur, vol?, at?, filter? })`, `midiHz(note)`, `getAudioContext()`, `getAudioOutput()`, `whenAudioReady(fn)`, `playFanfare(at?)`

### music.ts (song slots; not game time, keeps playing through a freeze)
- `playTrack(name, { loop?, volume?, fallback?: 'victory' | 'fanfare' | 'none', startAt? })` plays `client/public/audio/<name>.mp3` (or .m4a / .ogg / .wav / .webm) when it exists, else the synth fallback (default: 'victory' for names starting with "victory", 'fanfare' for "fanfare…", else 'none'). Restarts when already playing. Never throws. `startAt` (seconds, or a function returning seconds) is read when the sound really begins (after loading, and after the first click when autoplay was blocked); a looped track wraps it around the file's length, a one-shot that would start past its end stays silent.
- `stopTrack(name?, fadeMs = 400)` no name = all
- `isTrackPlaying(name)` / `hasTrackFile(name)` / `findTrackFile(name)` (the real file name, e.g. `'tap.ogg'`, or null)
- `pauseTrack(name, fadeMs = 200)` / `resumeTrack(name, fadeMs = 200)` pause where it is and continue from the same position. Independent of the page-hidden pause: a track paused here is not resumed by the page becoming visible, and one resumed while the page is hidden waits for it to be visible.
- `setTrackVolume(name, volume, fadeMs = 400)` ramps the level (a paused track takes it when it resumes)
- `getTrackInfo(name)` → `{ source, playing, paused, hidden, time, duration, volume, level, loop, muted, stopping }` or null
- Tests: `window.__partyMusic` → `started`, `playing(name)`, `info(name)`, `live()` (fading tracks too), `stats()` (tracks / elements / pending timers, for leak checks)
- **The victory song**: drop the real one at `client/public/audio/victory.mp3`. The TV's per-game songs and their levels: `client/public/audio/README.md`.

### haptics.ts
- `haptic.tap() bump() heavy() success() fail()` / `vibrate(pattern)` / `setHapticsEnabled(bool)` (no-op on iPhone)

### mobile.ts
- `initMobileViewport()` idempotent lock-down (pinch, double-tap zoom, context menu, pull-to-refresh, bounce) + keeps `--app-h`
- `enterFullscreen(): Promise<void>` from a gesture / `keepAwake(): Promise<void>` / `isStandalone()` / `getSafeArea(): { top, right, bottom, left }`

### theme.ts / base.css
- `COLORS` (bg, bg2, panel, ink, dim, pink, yellow, cyan, green, red, purple, orange, blue), `PARTY_COLORS`, `FONT`, `font(px, weight = 800)` for `ctx.font`
- `base.css` (import once per entry): page lock-down, the same colors as `--c-*`, safe areas `--sat --sar --sab --sal`, `--app-h`, `--font`. Opt-in scrolling: `class="kit-scroll"`.

### Stage (`client/src/play/stage.ts`)
- `mountStage(opts): Promise<Stage>` per `games/types.ts` (HUD, clock, freeze, score throttle, end). `mountStageWith(opts, load)` takes the game module directly. The stage imports `base.css` and calls `initMobileViewport()` itself.

## Example: a complete tiny game

This is `client/src/dev/demo-game.ts`, playable at `/dev.html?game=demo`.

```ts
import { bombPainter, facePainter, loadAssets } from '../kit/assets';
import { sfx } from '../kit/audio';
import { createGameCanvas } from '../kit/canvas';
import { createFx, lerp } from '../kit/fx';
import { haptic } from '../kit/haptics';
import { createInput } from '../kit/input';
import { createLoop } from '../kit/loop';
import { createRng } from '../kit/rng';
import { COLORS } from '../kit/theme';

import type { GameContext, GameInstance, GameModule } from '../games/types';

interface Thing {
  x: number;
  y: number;
  prevY: number;
  vy: number;
  bomb: boolean;
}

export const game: GameModule = {
  id: 'tap',
  async create(ctx: GameContext): Promise<GameInstance> {
    const view = createGameCanvas(ctx.root);
    const input = createInput(view.canvas);
    const fx = createFx();
    const rng = createRng(ctx.seed).fork('spawn');
    // Real art: client/public/assets/demo/face.png etc. Missing = placeholder.
    const art = await loadAssets('demo', [
      { key: 'face', file: 'face.png', size: 76, placeholder: facePainter('happy') },
      { key: 'bomb', file: 'bomb.png', size: 76, placeholder: bombPainter },
    ]);
    const things: Thing[] = [];
    let score = 0;

    const loop = createLoop({
      update(dt: number): void {
        for (let i = things.length - 1; i >= 0; i--) {
          const t = things[i];
          if (!t) continue;
          t.prevY = t.y;
          t.y += t.vy * dt;
          if (t.y > view.height + 60) things.splice(i, 1);
        }
        fx.update(dt);
      },
      render(alpha: number): void {
        const g = view.ctx;
        view.clear();
        g.save();
        fx.applyShake(g);
        for (const t of things) (t.bomb ? art.bomb : art.face).draw(g, t.x, lerp(t.prevY, t.y, alpha));
        g.restore();
        fx.draw(g);
      },
    });

    // Game-time timer: stands still during a freeze, unlike setInterval.
    loop.every(420, () => {
      const y = ctx.hudHeight - 40;
      things.push({ x: rng.float(50, view.width - 50), y, prevY: y, vy: rng.float(160, 320), bomb: rng.chance(0.2) });
    });

    input.onDown((p) => {
      for (let i = things.length - 1; i >= 0; i--) {
        const t = things[i];
        if (!t || Math.hypot(t.x - p.x, t.y - p.y) > 48) continue;
        things.splice(i, 1);
        if (t.bomb) {
          score = Math.max(0, score - 5);
          fx.shake(14, 400);
          fx.burst(t.x, t.y, { count: 24, colors: [COLORS.orange, COLORS.yellow, '#444'], speed: 420 });
          fx.text(t.x, t.y, '-5', { color: COLORS.red });
          sfx.explode();
          haptic.heavy();
        } else {
          score += 1;
          fx.burst(t.x, t.y, { shape: 'star' });
          fx.text(t.x, t.y, '+1', { color: COLORS.yellow });
          sfx.pop(1 + (score % 8) * 0.05);
          haptic.tap();
        }
        ctx.setScore(score);
        return;
      }
    });

    loop.start();
    return {
      destroy(): void {
        loop.stop();
        input.dispose();
        view.dispose();
      },
    };
  },
};
```

## Testing a game

`PARTY_CLIENT_PORT=<port> npx vite`, then `/dev.html?game=<id>&seed=1&duration=20000` (add `&freezeAt=5000&freezeMs=4000` for an automatic freeze, or press ❄️). Automation: `window.__party = { score, ended, gameId, frozen, leftMs, freeze(ms) }`. A full example run is `tests/e2e/kit-harness.cjs`.
