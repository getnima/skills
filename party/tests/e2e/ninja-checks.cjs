// ninja: determinism, small screens, multi-touch, still finger, landscape.
// Needs vite on :5215. node tests/e2e/ninja-checks.cjs
const { chromium, devices } = require('playwright');
const path = require('path');
const { botMove, swipe, ninja, party, targets, check, fails, sleep, OUT, BASE } = require('./ninja-play.cjs');

async function open(browser, ctxOpts, query) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/dev.html?game=ninja&${query}`);
  await page.waitForSelector('.pa-stage-game canvas');
  await page.waitForFunction(() => !!window.__ninja);
  return { context, page, errors };
}

/** Fixed, non-reactive input: the same zigzag swipes at the same moments. */
async function scripted(page, vp, untilMs) {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < untilMs) {
    // lock each swipe to game time (fixed steps), not to wall time
    await page.waitForFunction((n) => window.__ninja.steps >= n, 30 + i * 22, { polling: 'raf' });
    const y = vp.height * (0.3 + 0.1 * (i % 4));
    if (i % 2 === 0) await swipe(page, 20, y, vp.width - 20, y - 40, 10);
    else await swipe(page, vp.width - 20, y, 20, y + 40, 10);
    i++;
  }
}

async function cdpTouch(page, cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
}

async function main() {
  const browser = await chromium.launch();
  const iphone = devices['iPhone 14'];

  // ── 1. same seed = same level, other seed = other level; same scripted input ≈ same score ──
  const runs = [];
  for (const seed of [7, 7, 8]) {
    // freezeAt=0: the harness clock stands still while the game loads, like the real phone
    // (mounted during the 3-2-1, frozen until GO), so every run starts at round time 0 however
    // long its pictures took to load; the scripted swipes are locked to game steps
    const { context, page } = await open(browser, { ...iphone }, `seed=${seed}&duration=14000&freezeAt=0&freezeMs=1500`);
    const vp = page.viewportSize();
    const sched = await page.evaluate(() => JSON.stringify(window.__ninja.schedule(40)));
    await scripted(page, vp, 9000);
    await page.waitForFunction(() => window.__party.ended, null, { timeout: 15000 });
    const n = await ninja(page);
    runs.push({ seed, sched, sig: n.signature, score: (await party(page)).score, sliced: n.sliced, bombs: n.bombsHit });
    await context.close();
  }
  console.log(runs.map((r) => ({ seed: r.seed, sig: r.sig, score: r.score, sliced: r.sliced, bombs: r.bombs })));
  check('same seed: same schedule', runs[0].sched === runs[1].sched && runs[0].sig === runs[1].sig);
  check('other seed: other schedule', runs[0].sched !== runs[2].sched && runs[0].sig !== runs[2].sig);
  check('same seed + same scripted input: same score (±1 slice)', Math.abs(runs[0].score - runs[1].score) <= 10, [runs[0].score, runs[1].score]);

  // ── 2. positions depend only on round time: an auto-freeze snapshot matches across runs ──
  // (compared by round time, elapsedMs: the harness clock runs while the game loads, so the
  // number of steps since the game started depends on how long this run's load took)
  const snaps = [];
  for (let k = 0; k < 2; k++) {
    const { context, page } = await open(browser, { ...devices['Pixel 7'] }, `seed=11&duration=20000&freezeAt=4000&freezeMs=6000`);
    await page.waitForFunction(() => window.__party.frozen, null, { timeout: 8000 });
    await sleep(400);
    const n = await ninja(page);
    snaps.push(n);
    if (k === 0) await page.screenshot({ path: path.join(OUT, 'auto-freeze.png') });
    await context.close();
  }
  console.log(snaps.map((s) => [s.steps, Math.round(s.elapsedMs), s.snapshot]));
  check('auto-freeze: same throws in the air at the same round time (±3 steps)', Math.abs(snaps[0].elapsedMs - snaps[1].elapsedMs) <= 50 && snaps[0].active === snaps[1].active, snaps.map((s) => [s.steps, Math.round(s.elapsedMs)]));

  // ── 3. 360x640 fits ──
  {
    const { context, page, errors } = await open(browser, { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'seed=3&duration=20000');
    const vp = page.viewportSize();
    await sleep(1400);
    await page.screenshot({ path: path.join(OUT, 'small-1-hint.png') });
    const t0 = Date.now();
    let shot = false;
    while (Date.now() - t0 < 14000) {
      const r = await botMove(page, vp);
      if (!shot && Date.now() - t0 > 8000 && r !== 'none') {
        shot = true;
        await page.screenshot({ path: path.join(OUT, 'small-2-mid.png') });
      }
      if (r === 'none' || r === 'blocked') await sleep(40);
    }
    const l = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));
    check('360x640: no overflow', l.sw <= l.iw && l.sh <= l.ih, l);
    check('360x640: scores', (await party(page)).score > 0);
    check('360x640: no errors', errors.length === 0, errors);
    await context.close();
  }

  // ── 4. multi-touch: two fingers, two blades; a still finger cuts nothing ──
  {
    const { context, page, errors } = await open(browser, { ...devices['Pixel 7'] }, 'seed=5&duration=40000');
    const cdp = await context.newCDPSession(page);
    // still finger: hold on a throw's path without moving
    await page.waitForFunction(() => window.__ninja.targets().some((t) => t.y < innerHeight * 0.7), null, { timeout: 8000 });
    const [t] = await targets(page);
    const before = await ninja(page);
    await cdpTouch(page, cdp, 'touchStart', [[t.x, t.y - 30]]);
    await sleep(900);
    await cdpTouch(page, cdp, 'touchEnd', []);
    const after = await ninja(page);
    check('still finger cuts nothing', after.sliced === before.sliced, [before.sliced, after.sliced]);

    // two fingers at once on two different throws
    let ok = false;
    for (let attempt = 0; attempt < 30 && !ok; attempt++) {
      const ts = (await targets(page)).filter((q) => q.kind !== 'bomb' && q.y > 150 && q.y < 760 && Math.abs(q.vy) < 420);
      const bombs = (await targets(page)).filter((q) => q.kind === 'bomb');
      const pair = ts.length >= 2 ? [ts[0], ts.find((q) => Math.abs(q.x - ts[0].x) > 90)] : [];
      if (!pair[1] || bombs.length) { await sleep(150); continue; }
      const [a, b] = pair;
      const s0 = (await ninja(page)).sliced;
      const pts = (k) => [[a.x - 70 + k * 28, a.y + a.vy * 0.03], [b.x + 70 - k * 28, b.y + b.vy * 0.03]];
      await cdpTouch(page, cdp, 'touchStart', pts(0));
      for (let k = 1; k <= 5; k++) { await cdpTouch(page, cdp, 'touchMove', pts(k)); await sleep(16); }
      await page.screenshot({ path: path.join(OUT, 'multitouch.png') });
      await cdpTouch(page, cdp, 'touchEnd', []);
      const s1 = (await ninja(page)).sliced;
      console.log('multitouch attempt', attempt, s1 - s0);
      if (s1 - s0 >= 2) ok = true;
      await sleep(200);
    }
    check('two fingers slice two throws in one gesture', ok);
    check('multi-touch: no errors', errors.length === 0, errors);
    await context.close();
  }

  // ── 5. landscape phone and a desktop window do not break ──
  for (const [name, opts] of [
    ['landscape', { ...devices['iPhone 14 landscape'] }],
    ['desktop', { viewport: { width: 1280, height: 720 } }],
  ]) {
    const { context, page, errors } = await open(browser, opts, 'seed=9&duration=20000');
    const vp = page.viewportSize();
    const t0 = Date.now();
    while (Date.now() - t0 < 9000) {
      const r = await botMove(page, vp);
      if (r === 'none' || r === 'blocked') await sleep(40);
    }
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    check(`${name}: plays, no errors`, errors.length === 0 && (await party(page)).score > 0, errors);
    await context.close();
  }

  await browser.close();
}

main()
  .then(() => {
    console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall ok');
    process.exit(fails.length ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
