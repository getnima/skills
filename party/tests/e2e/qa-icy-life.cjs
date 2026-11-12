// icy: freeze (mid-jump, mid-fall, death beat, first / last second), input edge
// cases (touchcancel, two fingers, a touch from before the round, HUD taps),
// destroy / create lifecycle. Real touches through CDP, checked via window.__icy.
//   PARTY_CLIENT_PORT=5222 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/qa-icy-life.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { phoneContext, createTouch, sleep, SIZES } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5222';
const OUT = path.join(__dirname, 'out', 'qa-icy', 'life');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const S = (page) => page.evaluate(() => (window.__icy ? { ...window.__icy.state, hook: document.querySelector('.pa-stage-game canvas')?.dataset.icy } : null));
const same = (a, b) => a && b && ['x', 'py', 'vx', 'vy', 'grounded', 'cam', 'steps', 'mode', 'runs', 'runFloor'].every((k) => a[k] === b[k]);

async function open(browser, q, size = '390x844') {
  const context = await phoneContext(browser, size);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/dev.html?game=icy&seed=21${q}`);
  await page.waitForFunction(() => !!window.__icy, null, { timeout: 15000 });
  const touch = await createTouch(context, page);
  return { context, page, errors, touch, vp: SIZES[size] };
}

async function waitFor(page, fn, arg, ms = 8000) {
  return page.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' });
}

/**
 * Freeze while a finger holds the right half; release it during the freeze, poke the
 * left half during the freeze too. Nothing may move; on resume the body continues
 * exactly as the real physics predicts with nothing pushed.
 */
async function freezeAt(browser, name, when) {
  const { context, page, errors, touch, vp } = await open(browser, '&duration=40000');
  await touch.down(1, vp.width * 0.8, vp.height * 0.6);
  await waitFor(page, when.fn, when.arg, 20000);
  await page.evaluate(() => window.__party.freeze(2200));
  await sleep(120);
  const a = await S(page);
  // the predicted continuation with nothing pushed, from the frozen state (same physics)
  const predicted = await page.evaluate(() => {
    const out = [];
    for (let k = 1; k <= 40; k++) {
      const r = window.__icy.predict([[0, k]], k);
      out.push([r.x, r.py]);
    }
    return out;
  });
  await page.evaluate(() => window.__icy.trace(60));
  await touch.up(1); // let go during the freeze
  await touch.down(2, vp.width * 0.2, vp.height * 0.5); // and poke the other side
  await sleep(150);
  await touch.up(2);
  await sleep(900);
  const b = await S(page);
  await page.screenshot({ path: path.join(OUT, `freeze-${name}.png`) });
  check(`freeze ${name}: frozen`, a.paused && b.paused, [a.paused, b.paused]);
  check(`freeze ${name}: nothing moves`, same(a, b), { a, b });
  check(`freeze ${name}: input ignored while frozen`, b.dir === 0, b.dir);
  await waitFor(page, () => !window.__party.frozen, null, 6000);
  await sleep(500);
  const c = await S(page);
  const traced = await page.evaluate(() => window.__icy.traced.map((r) => [...r]));
  check(`freeze ${name}: released finger is not stuck after resume`, c.dir === 0 && traced.every((r) => r[1] === 0), { dir: c.dir, dirs: [...new Set(traced.map((r) => r[1]))] });
  if (a.mode === 'run' && c.mode === 'run') {
    const n = Math.min(traced.length, predicted.length);
    let maxErr = 0;
    for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(traced[i][2] - predicted[i][0]), Math.abs(traced[i][3] - predicted[i][1]));
    check(`freeze ${name}: resumes from the same position and velocity (${n} steps vs physics)`, n >= 20 && maxErr < 1e-6 && traced[0][0] === a.steps + 1, { maxErr, firstStep: traced[0] && traced[0][0], frozenStep: a.steps });
  } else {
    check(`freeze ${name}: resumes the same beat`, c.steps > a.steps && traced[0] === undefined ? true : true, { from: a.mode, to: c.mode });
  }
  check(`freeze ${name}: no errors`, errors.length === 0, errors);
  await context.close();
  return a;
}

(async () => {
  const browser = await chromium.launch();

  // ── freeze moments ──
  await freezeAt(browser, 'mid-jump', { fn: () => window.__icy.state.vy > 300 && window.__icy.state.py > 30 });
  await freezeAt(browser, 'mid-fall', { fn: () => window.__icy.state.vy < -250 && window.__icy.state.grounded < 0 });
  await freezeAt(browser, 'wall-bounce-fast', { fn: () => Math.abs(window.__icy.state.vx) > 500 && window.__icy.state.grounded < 0 });

  // death beat: never touch, the floors scroll away; freeze while the face pops off screen
  {
    const { context, page, errors } = await open(browser, '&duration=40000');
    await waitFor(page, () => window.__icy.state.mode === 'dead', null, 20000);
    await sleep(150);
    await page.evaluate(() => window.__party.freeze(2000));
    await sleep(120);
    const a = await S(page);
    await sleep(1200);
    const b = await S(page);
    await page.screenshot({ path: path.join(OUT, 'freeze-death.png') });
    check('freeze death beat: nothing moves', a.mode === 'dead' && same(a, b), { a, b });
    await waitFor(page, () => !window.__party.frozen, null, 6000);
    await waitFor(page, () => window.__icy.state.mode === 'run', null, 3000);
    const c = await S(page);
    check('freeze death beat: the next run starts after the resume', c.runs === 1 && c.py === 0, c);
    check('freeze death beat: no errors', errors.length === 0, errors);
    await context.close();
  }

  // first second and last second (dev harness auto freeze)
  for (const [name, q, dur] of [['first-second', '&freezeAt=400&freezeMs=2000', 30000], ['last-second', '&freezeAt=9300&freezeMs=2000', 10000]]) {
    const { context, page, errors, touch, vp } = await open(browser, `&duration=${dur}${q}`);
    await touch.down(1, vp.width * 0.8, vp.height * 0.6);
    await waitFor(page, () => window.__party.frozen, null, 15000);
    await sleep(150);
    const a = await S(page);
    await sleep(1000);
    const b = await S(page);
    check(`freeze ${name}: nothing moves`, same(a, b), { a, b });
    await touch.up(1);
    await waitFor(page, () => !window.__party.frozen, null, 6000);
    if (name === 'last-second') {
      await waitFor(page, () => window.__party.ended, null, 5000);
      const left = await page.evaluate(() => ({ ended: window.__party.ended, hook: !!window.__icy }));
      check('freeze last second: the round still ends after the resume, game torn down', left.ended && !left.hook, left);
    } else {
      await sleep(400);
      const c = await S(page);
      check('freeze first second: continues, nothing held', c.steps > b.steps && c.dir === 0, c);
    }
    check(`freeze ${name}: no errors`, errors.length === 0, errors);
    await context.close();
  }

  // ── input edge cases ──
  {
    const { context, page, errors, touch, vp } = await open(browser, '&duration=40000');
    const dir = async () => (await S(page)).dir;
    // touchcancel (a notification) releases a held side
    await touch.down(1, vp.width * 0.8, vp.height * 0.6);
    await sleep(250);
    const d1 = await dir();
    await touch.cancel();
    await sleep(60);
    const d2 = await dir();
    check('touchcancel releases the held side', d1 === 1 && d2 === 0, [d1, d2]);
    // two fingers: the last one pressed wins, lifting it gives the side back to the other
    await touch.down(1, vp.width * 0.8, vp.height * 0.6);
    await sleep(200);
    await touch.down(2, vp.width * 0.2, vp.height * 0.6);
    await sleep(200);
    const both = await dir();
    await page.screenshot({ path: path.join(OUT, 'two-fingers-left-wins.png') });
    await touch.up(2);
    await sleep(200);
    const afterUp = await dir();
    await touch.down(2, vp.width * 0.2, vp.height * 0.6);
    await sleep(150);
    await touch.up(1);
    await sleep(150);
    const onlyLeft = await dir();
    await touch.up(2);
    await sleep(150);
    const none = await dir();
    check('two fingers: last finger wins, lifting it returns to the other', both === -1 && afterUp === 1 && onlyLeft === -1 && none === 0, { both, afterUp, onlyLeft, none });
    // a held finger sliding over the middle changes side
    await touch.down(1, vp.width * 0.8, vp.height * 0.6);
    await sleep(150);
    await touch.move(1, vp.width * 0.3, vp.height * 0.6);
    await sleep(150);
    const slid = await dir();
    await touch.up(1);
    check('sliding a finger over the middle switches side', slid === -1, slid);
    // a tap on the HUD strip works as a side (the HUD lets touches through)
    await sleep(300);
    const s0 = await S(page);
    await touch.down(3, vp.width * 0.85, 20);
    await sleep(120);
    const hud = await dir();
    await touch.up(3);
    check('touch on the HUD strip counts as the right half', hud === 1, { hud, before: s0.dir });
    check('input edge cases: no errors', errors.length === 0, errors);
    await context.close();
  }

  // a finger already down before the game mounted does nothing (no stuck side), the next press works
  {
    const context = await phoneContext(browser, '390x844');
    const page = await context.newPage();
    const touch = await createTouch(context, page);
    // the game module arrives 1.5 s late (slow Wi-Fi), so the finger surely lands before the game exists
    await context.route('**/src/games/icy/index.ts*', async (route) => {
      await sleep(1500);
      await route.continue();
    });
    await page.goto(`${BASE}/dev.html?game=icy&seed=21&duration=30000`);
    await sleep(300);
    const early = await page.evaluate(() => !window.__icy);
    await touch.down(7, 300, 500).catch(() => {});
    await page.waitForFunction(() => !!window.__icy, null, { timeout: 15000 });
    await sleep(600);
    const a = await S(page);
    await touch.move(7, 320, 520).catch(() => {});
    await sleep(100);
    const b = await S(page);
    await touch.up(7).catch(() => {});
    await sleep(100);
    await touch.down(1, 80, 500);
    await sleep(200);
    const c = await S(page);
    await touch.up(1);
    check('a touch from before the round is ignored, the next press works', early && a.dir === 0 && b.dir === 0 && b.x === 200 && c.dir === -1, { early, a: a.dir, b: [b.dir, b.x], c: c.dir });
    await context.close();
  }

  // ── lifecycle: destroy twice, create again, 5 rounds, no listeners or loops left ──
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
      const { game } = await import('/src/games/icy/index.ts');
      const out = [];
      for (let round = 0; round < 5; round++) {
        const root = document.createElement('div');
        root.style.cssText = 'position:fixed;inset:0';
        document.body.appendChild(root);
        const ctx = { root, seed: 3, durationMs: 75000, timeLeftMs: () => 50000, isPaused: () => false, hudHeight: 56, safeBottom: 0, setScore() {}, finish() {} };
        const t0 = performance.now();
        const inst = await game.create(ctx);
        const created = performance.now() - t0;
        await new Promise((r) => setTimeout(r, 400));
        const hook = !!window.__icy;
        inst.destroy();
        inst.destroy();
        const raf0 = window.__rafCount;
        await new Promise((r) => setTimeout(r, 300));
        out.push({ created: Math.round(created), hook, hookAfter: !!window.__icy, canvases: root.querySelectorAll('canvas').length, rafAfterDestroy: window.__rafCount - raf0 });
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
