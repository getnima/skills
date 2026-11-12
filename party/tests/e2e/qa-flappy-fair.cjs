// flappy fairness: same seed = same course on a small and a tall phone, and the same
// flap, fall and scroll (field units) at 60 Hz and at a throttled 20 fps. Checked step
// by step through the test hook (window.__flappy.trace), not by eye. Also: how far
// ahead each phone sees (window.__flappy.layout.ahead, field units).
//   PARTY_CLIENT_PORT=5222 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/qa-flappy-fair.cjs
const { chromium } = require('playwright');
const { phoneContext, createTouch, sleep, SIZES } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5222';
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
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
  await page.goto(`${BASE}/dev.html?game=flappy&seed=${seed}&duration=30000`);
  await page.waitForFunction(() => !!window.__flappy, null, { timeout: 15000 });
  await sleep(500);
  const vp = SIZES[size];
  const touch = await createTouch(context, page);
  const info = await page.evaluate(() => ({ course: window.__flappy.course(40), layout: window.__flappy.layout }));
  await page.evaluate(() => window.__flappy.trace(400));
  // one tap, then nothing: the bird flaps once and falls to the ground
  await touch.tap(vp.width / 2, vp.height / 2);
  await page.waitForFunction(() => window.__flappy.mode === 'dead', null, { timeout: 10000 });
  await sleep(200);
  const traced = await page.evaluate(() => window.__flappy.traced.map((r) => [...r]));
  const fpsSeen = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          if (performance.now() - t0 < 1000) requestAnimationFrame(f);
          else res(n);
        };
        requestAnimationFrame(f);
      }),
  );
  await context.close();
  return { size, fps, fpsSeen, ...info, traced, errors };
}

/** From the first flying step to the crash: [steps since the flap, y - y0, vy, dist]. */
function flight(traced) {
  const i0 = traced.findIndex((r) => r[1] === 'fly');
  const out = [];
  if (i0 < 0) return out;
  const y0 = traced[i0][2];
  for (let i = i0; i < traced.length && traced[i][1] === 'fly'; i++) out.push([i - i0, traced[i][2] - y0, traced[i][3], traced[i][4]]);
  // the crash step itself
  const last = traced.find((r, i) => i > i0 && r[1] === 'dead');
  if (last) out.push(['crash', last[2] - y0, last[3], last[4]]);
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const seed = 9;
  const runs = [];
  for (const [size, fps] of [['320x568', 60], ['430x932', 60], ['320x568', 20], ['430x932', 20], ['390x844', 30], ['375x667', 60], ['360x640', 60], ['412x915', 60], ['844x390', 60]]) {
    runs.push(await sample(browser, size, fps, seed));
  }
  const ref = runs[0];
  const refF = flight(ref.traced);
  console.log('reference flight steps', refF.length, 'crash', JSON.stringify(refF[refF.length - 1]));
  for (const r of runs) {
    const f = flight(r.traced);
    const sameCourse = JSON.stringify(r.course) === JSON.stringify(ref.course);
    let maxErr = 0;
    const n = Math.min(f.length, refF.length);
    const errBy = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      // the crash row's y is the ground line (absolute), so only its step and dist count
      for (const k of f[i][0] === 'crash' ? [3] : [1, 2, 3]) {
        const e = Math.abs(f[i][k] - refF[i][k]);
        errBy[k] = Math.max(errBy[k], e);
        maxErr = Math.max(maxErr, e);
      }
    }
    if (maxErr > 0 && process.env.QA_LOG) console.log('errBy [_, y-y0, vy, dist]', errBy, 'first rows', JSON.stringify(f.slice(0, 3)), JSON.stringify(refF.slice(0, 3)));
    const tag = `${r.size}@${r.fps}fps`;
    console.log(tag, 'fps seen', r.fpsSeen, 'ahead', r.layout.ahead.toFixed(1), 'U', r.layout.U.toFixed(2), 'flight', f.length, 'maxErr', maxErr);
    check(`${tag}: same course`, sameCourse);
    check(`${tag}: same flap, fall and scroll step by step until the crash (${n} steps)`, f.length === refF.length && n > 20 && maxErr < 1e-9, { len: f.length, ref: refF.length, maxErr });
    if (r.size !== '844x390') check(`${tag}: sees 46-50 field units ahead (portrait fairness)`, r.layout.ahead >= 46 && r.layout.ahead <= 50, r.layout.ahead);
    check(`${tag}: no errors`, r.errors.length === 0, r.errors);
  }
  const other = await (async () => {
    const context = await phoneContext(browser, '390x844');
    const page = await context.newPage();
    await page.goto(`${BASE}/dev.html?game=flappy&seed=${seed + 1}&duration=30000`);
    await page.waitForFunction(() => !!window.__flappy);
    const c = await page.evaluate(() => window.__flappy.course(40));
    await context.close();
    return c;
  })();
  check('other seed = other course', JSON.stringify(other) !== JSON.stringify(ref.course));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
