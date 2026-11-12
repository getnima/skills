// icy fairness: same seed = same tower and the same physics on a small and a tall
// phone, at 60 Hz and at a throttled 20 fps. Checked step by step through the test
// hook (window.__icy.trace), not by eye.
//   PARTY_CLIENT_PORT=5222 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/qa-icy-fair.cjs
const { chromium } = require('playwright');
const { phoneContext, createTouch, sleep, SIZES } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5222';
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}

/** requestAnimationFrame at `fps` (a slow phone / a throttled tab). */
function rafAt(fps) {
  return `(() => {
    const ms = 1000 / ${fps};
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), ms);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  })();`;
}

async function sample(browser, size, fps, seed) {
  const context = await phoneContext(browser, size);
  if (fps !== 60) await context.addInitScript(rafAt(fps));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/dev.html?game=icy&seed=${seed}&duration=30000`);
  await page.waitForFunction(() => !!window.__icy, null, { timeout: 15000 });
  await sleep(300);
  const vp = SIZES[size];
  const touch = await createTouch(context, page);
  const info = await page.evaluate(() => {
    window.__icy.trace(600);
    const c = document.querySelector('.pa-stage-game canvas');
    return { level: c.dataset.level, follow: window.__icy.state.follow };
  });
  // hold right 1.6 s, slide the same finger to the left half 1.2 s, let go
  await touch.down(1, vp.width * 0.8, vp.height * 0.6);
  await sleep(1600);
  await touch.move(1, vp.width * 0.2, vp.height * 0.6);
  await sleep(1200);
  await touch.up(1);
  await sleep(400);
  const traced = await page.evaluate(() => window.__icy.traced.map((r) => [...r]));
  // the predictor (same physics, no frames at all) from a fresh start
  await context.close();
  return { size, fps, ...info, traced, errors };
}

/** The part of the trace while the right side was held, from the first held step. */
function heldRight(traced) {
  const i0 = traced.findIndex((r) => r[1] === 1);
  const out = [];
  for (let i = i0; i >= 0 && i < traced.length && traced[i][1] === 1; i++) out.push(traced[i]);
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const seed = 5;
  const runs = [];
  for (const [size, fps] of [['320x568', 60], ['430x932', 60], ['320x568', 20], ['430x932', 20], ['390x844', 30]]) {
    runs.push(await sample(browser, size, fps, seed));
  }
  const other = await (async () => {
    const context = await phoneContext(browser, '390x844');
    const page = await context.newPage();
    await page.goto(`${BASE}/dev.html?game=icy&seed=${seed + 1}&duration=30000`);
    await page.waitForFunction(() => !!window.__icy);
    const level = await page.evaluate(() => document.querySelector('.pa-stage-game canvas').dataset.level);
    await context.close();
    return level;
  })();
  const ref = runs[0];
  const refHeld = heldRight(ref.traced);
  console.log('reference', ref.size, ref.fps, 'level', ref.level, 'held steps', refHeld.length, 'follow', ref.follow);
  check('other seed = other tower', other !== ref.level, [other, ref.level]);
  for (const r of runs) {
    const h = heldRight(r.traced);
    const n = Math.min(h.length, refHeld.length);
    let firstDiff = -1;
    let maxErr = 0;
    for (let i = 0; i < n; i++) {
      for (const k of [2, 3, 4, 5, 6]) {
        const e = Math.abs(h[i][k] - refHeld[i][k]);
        if (e > maxErr) maxErr = e;
        if (e > 1e-6 && firstDiff < 0) firstDiff = i;
      }
    }
    const jumps = h.filter((row, i) => i > 0 && row[5] > 0 && h[i - 1][5] <= 0).length;
    const apex = Math.max(...h.map((row) => row[3]));
    console.log(r.size, r.fps + 'fps', 'held steps', h.length, 'compared', n, 'jumps', jumps, 'apex', apex.toFixed(2), 'maxErr', maxErr);
    check(`${r.size}@${r.fps}: same tower`, r.level === ref.level, [r.level, ref.level]);
    check(`${r.size}@${r.fps}: same camera follow`, r.follow === ref.follow, [r.follow, ref.follow]);
    check(`${r.size}@${r.fps}: identical trajectory step by step (${n} steps)`, n >= 60 && firstDiff < 0, { firstDiff, maxErr });
    check(`${r.size}@${r.fps}: no errors`, r.errors.length === 0, r.errors);
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
