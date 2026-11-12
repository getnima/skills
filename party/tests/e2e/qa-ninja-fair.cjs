// Fairness of tap + ninja: the same seed gives the same level on a small and a big
// phone, at 60 fps and on a slow phone at 20 fps (rAF throttled) and with CPU 4x.
// Compared through the games' step traces (window.__tapTrace / __ninjaTrace), not by eye.
// Also: ninja finger speed reads the same at 60 and 20 fps; a tap is worth the same.
//   node tests/e2e/qa-ninja-fair.cjs
const { chromium, check, fails, sleep, openGame, touch, tapAt } = require('./qa-tap-lib.cjs');

const RUN_MS = 9000;
const CONFIGS = [
  { name: '320x568@60', viewport: { width: 320, height: 568 } },
  { name: '430x932@60', viewport: { width: 430, height: 932 } },
  { name: '390x844@20fps', viewport: { width: 390, height: 844 }, fps: 20 },
  { name: '360x640@cpu4', viewport: { width: 360, height: 640 }, cpu: 4 },
];

async function traceOf(browser, game, cfg, seed) {
  const key = game === 'tap' ? '__tapTrace' : '__ninjaTrace';
  // freezeAt=0: the harness clock stands still while the game loads, like the real phone
  // (mounted during the 3-2-1, frozen until GO), so every run starts at round time 0
  const { page, context } = await openGame(browser, game, { ...cfg, query: `seed=${seed}&duration=60000&freezeAt=0&freezeMs=1500`, init: `window.${key} = [];` });
  await sleep(RUN_MS + 1500);
  const tr = await page.evaluate((k) => window[k].slice(), key);
  const extra = await page.evaluate((g) => (g === 'tap' ? document.querySelector('.pa-stage-game canvas').dataset.level : window.__ninja.signature), game);
  await context.close();
  return { tr, extra };
}

function compare(a, b) {
  // traces are sampled every 30 steps; compare the common prefix of step numbers
  const mb = new Map(b.map((l) => [l.split('|')[0], l]));
  let same = 0;
  let diff = null;
  for (const l of a) {
    const o = mb.get(l.split('|')[0]);
    if (o === undefined) continue;
    if (o === l) same++;
    else if (!diff) diff = [l, o];
  }
  return { same, diff };
}

async function speedAt(browser, cfg, pxPerS) {
  const { page, context, cdp } = await openGame(browser, 'ninja', { ...cfg, query: 'seed=3&duration=60000' });
  await sleep(500);
  const samples = [];
  const x0 = 30;
  const y = 400;
  await touch(cdp, 'touchStart', [{ x: x0, y, id: 1 }]);
  const t0 = Date.now();
  let x = x0;
  const pend = [];
  while (Date.now() - t0 < 700) {
    await sleep(16);
    x = x0 + ((Date.now() - t0) / 1000) * pxPerS;
    pend.push(touch(cdp, 'touchMove', [{ x, y, id: 1 }]));
    if (Date.now() - t0 > 250) samples.push(page.evaluate(() => window.__ninja.bladeSpeed));
  }
  await Promise.all(pend);
  const vals = await Promise.all(samples);
  const sharp = await page.evaluate(() => window.__ninja.sharpSteps);
  await touch(cdp, 'touchEnd', []);
  await context.close();
  const pos = vals.filter((v) => v > 0).sort((a, b) => a - b);
  return { speed: pos[Math.floor(pos.length / 2)] || 0, sharp };
}

(async () => {
  const browser = await chromium.launch();
  for (const game of ['tap', 'ninja']) {
    const seed = 21;
    const res = [];
    for (const cfg of CONFIGS) res.push({ cfg: cfg.name, ...(await traceOf(browser, game, cfg, seed)) });
    const ref = res[0];
    console.log(game, res.map((r) => `${r.cfg}: ${r.tr.length} samples, level ${r.extra}`).join(' | '));
    for (const r of res.slice(1)) {
      const c = compare(ref.tr, r.tr);
      check(`${game}: ${r.cfg} = ${ref.cfg} (same level id, same state at every common round step)`, r.extra === ref.extra && c.same >= 10 && c.diff === null, { same: c.same, diff: c.diff });
    }
  }

  // finger speed: the same physical swipe reads the same at 60 fps and 20 fps
  // (before the fix a 150 px/s drag cut on every move at 20 fps and never at 60 fps)
  for (const v of [150, 400, 1200]) {
    const a = await speedAt(browser, { viewport: { width: 390, height: 844 } }, v);
    const b = await speedAt(browser, { viewport: { width: 390, height: 844 }, fps: 20 }, v);
    console.log(`swipe ${v} px/s → 60fps reads ${a.speed.toFixed(0)} (${a.sharp} sharp steps), 20fps reads ${b.speed.toFixed(0)} (${b.sharp} sharp steps)`);
    check(`ninja: ${v} px/s swipe reads within 35% at 60 and 20 fps`, Math.abs(a.speed - b.speed) <= 0.35 * Math.max(a.speed, b.speed), [Math.round(a.speed), Math.round(b.speed)]);
    check(`ninja: ${v} px/s cuts at both fps or at neither`, a.sharp > 0 === b.sharp > 0 && (v < 200 ? a.sharp === 0 : a.sharp > 0), [a.sharp, b.sharp]);
  }

  // tap: one hit is +1 on both, right after start (same state), at 60 and 20 fps
  for (const fps of [0, 20]) {
    const { page, context, cdp } = await openGame(browser, 'tap', { viewport: { width: 390, height: 844 }, fps: fps || undefined, query: 'seed=21&duration=60000' });
    await page.waitForFunction(() => window.__tap && window.__tap());
    const d = await page.evaluate(() => window.__tap());
    for (let i = 0; i < 25; i++) {
      await tapAt(cdp, [{ x: d.x, y: d.y }]);
      await sleep(110);
    }
    await sleep(300);
    const e = await page.evaluate(() => window.__tap());
    check(`tap ${fps || 60} fps: 25 hits at 9/s = 31 points (19 x1 + 6 x2), all counted`, e.hits === 25 && e.score === 31, { hits: e.hits, score: e.score });
    await context.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
