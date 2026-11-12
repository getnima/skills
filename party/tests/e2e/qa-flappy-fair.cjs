// flappy fairness: the same seed = the same course, the same scroll and the same flight on a
// small and a tall phone, at 60 Hz and at a throttled 20 fps, BEFORE and DURING the finale.
// Every page flies the same round with the game's own pilot (?pilot=1) and records every
// fixed step through the test hook (window.__flappy.trace): [step, mode, y, vy, dist, passed].
// The finale is pinned to 6 s of round time (?finaleAt=6000), so the comparison covers the
// gentle course, the finale's 3-2-1 and the hardening course until the pilot goes down.
//   PARTY_CLIENT_PORT=5331 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   QA_BASE=http://localhost:5331 node tests/e2e/qa-flappy-fair.cjs
const { chromium } = require('playwright');
const { phoneContext, sleep } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5331';
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
const FINALE_AT = 6000;

async function sample(browser, size, fps, seed) {
  const context = await phoneContext(browser, size);
  if (fps !== 60) await context.addInitScript(rafAt(fps));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/dev.html?game=flappy&seed=${seed}&finaleAt=${FINALE_AT}&pilot=1&trace=4000`);
  await page.waitForFunction(() => !!window.__flappy, null, { timeout: 15000 });
  const info = await page.evaluate(() => ({ layout: window.__flappy.layout }));
  // until the pilot is down (the finale kills everybody within 25 s)
  await page.waitForFunction(() => window.__flappy.mode !== 'fly', null, { timeout: 45000 });
  await sleep(150);
  const out = await page.evaluate(() => ({
    traced: window.__flappy.traced.map((r) => [...r]),
    course: window.__flappy.course(120),
    finaleStep: window.__flappy.finaleStep,
    rejoins: window.__flappy.rejoins,
    raw: window.__flappy.raw,
    run: window.__flappy.run,
    dists: [60, 359, 360, 361, 600, 1200, 1800].map((s) => window.__flappy.distAt(s)),
  }));
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
  return { size, fps, fpsSeen, ...info, ...out, errors };
}

async function sampleRetry(browser, size, fps, seed) {
  // a stall of more than 0.75 s on this shared machine makes the bird rejoin: not a fairness result, fly it again
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await sample(browser, size, fps, seed);
    if (r.rejoins === 0) return r;
    console.log(`  (${size}@${fps}: the page stalled and the bird rejoined, flying again)`);
  }
  return sample(browser, size, fps, seed);
}

(async () => {
  const browser = await chromium.launch();
  const seed = 9;
  const runs = [];
  for (const [size, fps] of [['320x568', 60], ['430x932', 60], ['320x568', 20], ['430x932', 20], ['390x844', 30], ['360x640', 60]]) {
    runs.push(await sampleRetry(browser, size, fps, seed));
  }
  const ref = runs[0];
  const finaleStep = Math.ceil(FINALE_AT / (1000 / 60) - 1e-6);
  const crash = ref.traced[ref.traced.length - 1];
  console.log('reference: steps', ref.traced.length, 'crash at step', crash[0], `(${(crash[0] / 60 - FINALE_AT / 1000).toFixed(1)} s into the finale)`, 'passed', ref.run, 'raw', ref.raw);
  check('the reference flight goes through the finale (the pilot survives the gentle course)', crash[0] > finaleStep + 300 && crash[1] === 'dead', crash);
  for (const r of runs) {
    const tag = `${r.size}@${r.fps}fps`;
    const n = Math.min(r.traced.length, ref.traced.length);
    let maxErr = 0;
    let firstDiff = -1;
    for (let i = 0; i < n; i++) {
      for (const k of [0, 2, 3, 4, 5]) {
        const e = Math.abs(r.traced[i][k] - ref.traced[i][k]);
        if (e > maxErr) maxErr = e;
        if (e > 1e-9 && firstDiff < 0) firstDiff = i;
      }
      if (r.traced[i][1] !== ref.traced[i][1] && firstDiff < 0) firstDiff = i;
    }
    const before = r.traced.filter((row) => row[0] <= finaleStep).length;
    console.log(tag, 'fps seen', r.fpsSeen, 'ahead', r.layout.ahead.toFixed(1), 'steps', r.traced.length, 'before/in finale', before, r.traced.length - before, 'maxErr', maxErr);
    check(`${tag}: same course before and in the finale (120 obstacles)`, JSON.stringify(r.course) === JSON.stringify(ref.course));
    check(`${tag}: the finale begins at the same step (${finaleStep})`, r.finaleStep === finaleStep, r.finaleStep);
    check(`${tag}: same scroll (distance at 7 moments, before and in the finale)`, JSON.stringify(r.dists) === JSON.stringify(ref.dists));
    check(`${tag}: same flight step by step until the crash, before and in the finale (${n} steps)`, r.traced.length === ref.traced.length && maxErr < 1e-9 && firstDiff < 0, { len: r.traced.length, ref: ref.traced.length, maxErr, firstDiff });
    check(`${tag}: same survival score and obstacles passed`, r.raw === ref.raw && r.run === ref.run, { raw: r.raw, run: r.run });
    check(`${tag}: sees 46-50 field units ahead (portrait fairness)`, r.layout.ahead >= 46 && r.layout.ahead <= 50, r.layout.ahead);
    check(`${tag}: no errors`, r.errors.length === 0, r.errors);
  }
  const other = await sampleRetry(browser, '390x844', 60, seed + 1);
  check('other seed = other course', JSON.stringify(other.course) !== JSON.stringify(ref.course));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
