// flappy: freeze (mid-flap, mid-fall, crash beat, the hover after a crash, first /
// last second), taps while frozen, restart that cannot be mis-tapped into a crash,
// input edge cases, destroy / create lifecycle. Real touches through CDP.
//   PARTY_CLIENT_PORT=5222 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/qa-flappy-life.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { phoneContext, createTouch, sleep, SIZES } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5222';
const OUT = path.join(__dirname, 'out', 'qa-flappy', 'life');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const S = (page) =>
  page.evaluate(() => {
    const f = window.__flappy;
    return f ? { mode: f.mode, y: f.birdY, vy: f.vy, dist: f.dist, steps: f.steps, run: f.run, best: f.best, runs: f.runs.length, frozen: window.__party.frozen } : null;
  });
const same = (a, b) => a && b && ['mode', 'y', 'vy', 'dist', 'steps', 'run'].every((k) => a[k] === b[k]);

async function open(browser, q, size = '390x844') {
  const context = await phoneContext(browser, size);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/dev.html?game=flappy&seed=21${q}`);
  await page.waitForFunction(() => !!window.__flappy, null, { timeout: 15000 });
  const touch = await createTouch(context, page);
  return { context, page, errors, touch, vp: SIZES[size] };
}
const waitFor = (page, fn, arg, ms = 8000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' });

/** Keep the bird in the air: tap whenever it sinks below the middle (no reaction delay). */
function keepFlying(page, touch, vp) {
  let stop = false;
  const run = (async () => {
    while (!stop) {
      const s = await S(page).catch(() => null);
      if (s && !s.frozen && (s.mode === 'hover' || (s.mode === 'fly' && s.y > 50 && s.vy > 0))) await touch.tap(vp.width / 2, vp.height * 0.6);
      await sleep(15);
    }
  })();
  return async () => {
    stop = true;
    await run;
  };
}

async function freezeWhen(browser, name, cond, q = '&duration=40000') {
  const { context, page, errors, touch, vp } = await open(browser, q);
  const stopFlying = keepFlying(page, touch, vp);
  await waitFor(page, cond, null, 20000);
  await page.evaluate(() => window.__party.freeze(2200));
  await stopFlying();
  await sleep(120);
  const a = await S(page);
  // taps during the freeze must do nothing, now or later
  for (let i = 0; i < 4; i++) {
    await touch.tap(vp.width * 0.5, vp.height * 0.5);
    await sleep(120);
  }
  await sleep(500);
  const b = await S(page);
  await page.screenshot({ path: path.join(OUT, `freeze-${name}.png`) });
  check(`freeze ${name}: nothing moves, taps ignored`, a.frozen && same(a, b), { a, b });
  await page.evaluate(() => window.__flappy.trace(40));
  await waitFor(page, () => !window.__party.frozen, null, 6000);
  await sleep(400);
  const traced = await page.evaluate(() => window.__flappy.traced.map((r) => [...r]));
  if (a.mode === 'fly' && traced.length && traced[0][1] === 'fly') {
    // no flap after the resume: the same gravity steps as the game, from the frozen state
    const P = await page.evaluate(() => window.__flappy.phys);
    let y = a.y;
    let vy = a.vy;
    let maxErr = 0;
    let n = 0;
    for (const row of traced) {
      if (row[1] !== 'fly') break;
      vy = Math.min(P.maxFall, vy + P.gravity * (1 / 60));
      y += vy * (1 / 60);
      maxErr = Math.max(maxErr, Math.abs(row[2] - y), Math.abs(row[3] - vy));
      n++;
    }
    check(`freeze ${name}: resumes from the same height and speed, no queued flap (${n} steps)`, n >= 5 && maxErr < 1e-6 && traced[0][0] === a.steps + 1, { maxErr, first: traced[0], frozenStep: a.steps });
  } else {
    check(`freeze ${name}: continues after the resume`, traced.length > 0 && traced[0][0] === a.steps + 1, { first: traced[0], frozenStep: a.steps, mode: a.mode });
  }
  check(`freeze ${name}: no errors`, errors.length === 0, errors);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();

  await freezeWhen(browser, 'mid-flap', () => window.__flappy.mode === 'fly' && window.__flappy.vy < -30);
  await freezeWhen(browser, 'mid-fall', () => window.__flappy.mode === 'fly' && window.__flappy.vy > 40);
  // no taps: the first run starts on a tap, then the bird falls to the ground
  {
    const { context, page, errors, touch, vp } = await open(browser, '&duration=40000');
    await touch.tap(vp.width / 2, vp.height / 2);
    await waitFor(page, () => window.__flappy.mode === 'dead', null, 8000);
    await sleep(120);
    await page.evaluate(() => window.__party.freeze(2000));
    await sleep(100);
    const a = await S(page);
    await touch.tap(vp.width / 2, vp.height / 2);
    await sleep(1200);
    const b = await S(page);
    await page.screenshot({ path: path.join(OUT, 'freeze-crash.png') });
    check('freeze crash beat: nothing moves', a.mode === 'dead' && same(a, b), { a, b });
    await waitFor(page, () => !window.__party.frozen, null, 6000);
    await waitFor(page, () => window.__flappy.mode === 'hover', null, 3000);
    await sleep(700);
    const c = await S(page);
    check('after a crash the next run hovers until a tap (tap during the freeze did not start it)', c.mode === 'hover' && c.dist === 0, c);
    // freeze during that hover
    await page.evaluate(() => window.__party.freeze(1500));
    await sleep(100);
    const d = await S(page);
    await touch.tap(vp.width / 2, vp.height / 2);
    await sleep(800);
    const e = await S(page);
    check('freeze in the hover: nothing moves, tap ignored', d.mode === 'hover' && same(d, e), { d, e });
    await waitFor(page, () => !window.__party.frozen, null, 6000);
    await sleep(300);
    check('hover after the freeze still waits for a tap', (await S(page)).mode === 'hover');
    check('crash / hover freeze: no errors', errors.length === 0, errors);
    await context.close();
  }

  // first and last second
  for (const [name, q] of [['first-second', '&duration=30000&freezeAt=500&freezeMs=2000'], ['last-second', '&duration=10000&freezeAt=9300&freezeMs=2000']]) {
    const { context, page, errors, touch, vp } = await open(browser, q);
    const stopFlying = keepFlying(page, touch, vp);
    await waitFor(page, () => window.__party.frozen, null, 15000);
    await stopFlying();
    await sleep(150);
    const a = await S(page);
    await touch.tap(vp.width / 2, vp.height / 2);
    await sleep(900);
    const b = await S(page);
    check(`freeze ${name}: nothing moves`, same(a, b), { a, b });
    await waitFor(page, () => !window.__party.frozen, null, 6000);
    if (name === 'last-second') {
      await waitFor(page, () => window.__party.ended, null, 5000);
      check('freeze last second: the round ends after the resume, game torn down', await page.evaluate(() => window.__party.ended && !window.__flappy));
    }
    check(`freeze ${name}: no errors`, errors.length === 0, errors);
    await context.close();
  }

  // restart cannot be mis-tapped into a crash: mash through a crash and the respawn
  {
    const { context, page, errors, touch, vp } = await open(browser, '&duration=40000');
    await touch.tap(vp.width / 2, vp.height / 2);
    await waitFor(page, () => window.__flappy.mode === 'dead', null, 8000);
    const t0 = Date.now();
    let respawnAt = 0;
    let modeAfter = null;
    let diedAgainAfter = null;
    while (Date.now() - t0 < 5000) {
      await touch.tap(vp.width * 0.5, vp.height * 0.5);
      const s = await S(page);
      if (!respawnAt && s.mode !== 'dead') {
        respawnAt = Date.now();
        modeAfter = s.mode;
      }
      if (respawnAt && s.mode === 'dead' && diedAgainAfter === null) diedAgainAfter = Date.now() - respawnAt;
      await sleep(80);
    }
    check('mashing through a crash: the respawn never crashes at once (>= 1.5 s)', respawnAt > 0 && (diedAgainAfter === null || diedAgainAfter >= 1500), { modeAfter, diedAgainAfter });
    check('mashing: no errors', errors.length === 0, errors);
    await context.close();
  }

  // the "tap to fly" hint comes back after a crash and goes away on the first tap, even a very fast one
  {
    const { context, page, errors, touch, vp } = await open(browser, '&duration=40000');
    await touch.tap(vp.width / 2, vp.height / 2);
    await waitFor(page, () => window.__flappy.mode === 'dead', null, 8000);
    await waitFor(page, () => window.__flappy.mode === 'hover', null, 3000);
    await touch.tap(vp.width / 2, vp.height / 2); // within a frame or two of the respawn
    await sleep(700);
    const fast = await page.evaluate(() => ({ mode: window.__flappy.mode, hint: window.__flappy.hint }));
    await page.screenshot({ path: path.join(OUT, 'hint-after-fast-tap.png') });
    check('a tap right after the respawn hides the hint (no stuck finger in flight)', fast.mode === 'fly' && fast.hint < 0.02, fast);
    await waitFor(page, () => window.__flappy.mode === 'dead', null, 8000);
    await waitFor(page, () => window.__flappy.mode === 'hover', null, 3000);
    await sleep(600);
    const back = await page.evaluate(() => window.__flappy.hint);
    check('the hint shows again while hovering after a crash', back > 0.8, back);
    check('hint: no errors', errors.length === 0, errors);
    await context.close();
  }

  // input edge cases: a touch from before the round; a cancelled touch; two fingers; the HUD
  {
    const context = await phoneContext(browser, '390x844');
    const page = await context.newPage();
    const touch = await createTouch(context, page);
    // the game module arrives 1.5 s late (slow Wi-Fi), so the finger surely lands before the game exists
    await context.route('**/src/games/flappy/index.ts*', async (route) => {
      await sleep(1500);
      await route.continue();
    });
    await page.goto(`${BASE}/dev.html?game=flappy&seed=21&duration=30000`);
    await sleep(300);
    const early = await page.evaluate(() => !window.__flappy);
    await touch.down(7, 200, 500);
    await page.waitForFunction(() => !!window.__flappy, null, { timeout: 15000 });
    await sleep(400);
    await touch.move(7, 210, 480);
    await sleep(100);
    await touch.up(7);
    await sleep(300);
    const a = await S(page);
    check('a touch held from before the round does not start the run', early && a.mode === 'hover', { early, mode: a.mode });
    await touch.down(1, 200, 500);
    await touch.cancel();
    await sleep(100);
    const b = await S(page);
    check('a touch that is cancelled still counts as the tap it began as (flap on down)', b.mode === 'fly', b.mode);
    await waitFor(page, () => window.__flappy.vy > 20, null, 3000);
    const vy0 = (await S(page)).vy;
    await touch.down(1, 100, 600);
    await touch.down(2, 300, 600);
    await sleep(40);
    await touch.up(1);
    await touch.up(2);
    const c = await S(page);
    check('two fingers at once = flaps, no error', c.vy < 0 && vy0 > 0, { vy0, vy: c.vy });
    await waitFor(page, () => window.__flappy.vy > 20, null, 3000);
    await touch.tap(200, 20);
    await sleep(40);
    const d = await S(page);
    check('a tap on the HUD strip flaps too', d.vy < 0, d.vy);
    await context.close();
  }

  // lifecycle
  {
    const context = await phoneContext(browser, '390x844');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/dev.html`);
    const cdp = await context.newCDPSession(page);
    const listeners = async () => {
      let n = 0;
      for (const expr of ['window', 'document']) {
        const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
        const { listeners: l } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
        n += l.length;
      }
      return n;
    };
    await page.evaluate(() => {
      window.__rafCount = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { window.__rafCount++; return raf(cb); };
    });
    const before = await listeners();
    const res = await page.evaluate(async () => {
      const { game } = await import('/src/games/flappy/index.ts');
      const out = [];
      for (let round = 0; round < 5; round++) {
        const root = document.createElement('div');
        root.style.cssText = 'position:fixed;inset:0';
        document.body.appendChild(root);
        const ctx = { root, seed: 3, durationMs: 60000, timeLeftMs: () => 50000, isPaused: () => false, hudHeight: 56, safeBottom: 0, setScore() {}, finish() {} };
        const t0 = performance.now();
        const inst = await game.create(ctx);
        const created = performance.now() - t0;
        await new Promise((r) => setTimeout(r, 400));
        const hook = !!window.__flappy;
        inst.destroy();
        inst.destroy();
        const raf0 = window.__rafCount;
        await new Promise((r) => setTimeout(r, 300));
        out.push({ created: Math.round(created), hook, hookAfter: !!window.__flappy, canvases: root.querySelectorAll('canvas').length, rafAfterDestroy: window.__rafCount - raf0 });
        root.remove();
      }
      return out;
    });
    const after = await listeners();
    console.log('lifecycle', JSON.stringify(res), 'listeners', before, after);
    check('lifecycle: destroy twice is safe, create again works (5 rounds)', res.length === 5 && res.every((r) => r.hook && !r.hookAfter && r.canvases === 0), res);
    check('lifecycle: no animation frames after destroy', res.every((r) => r.rafAfterDestroy === 0), res.map((r) => r.rafAfterDestroy));
    check('lifecycle: no window/document listeners left', after <= before, { before, after });
    check('lifecycle: create does not get slower', res[4].created < Math.max(250, res[0].created * 3), res.map((r) => r.created));
    check('lifecycle: no errors', errors.length === 0, errors);
    await context.close();
  }

  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(' | ')}` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
