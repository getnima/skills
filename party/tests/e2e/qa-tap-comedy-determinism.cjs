// Same seed + same touch timing on 320x568, 430x932 and 390x844 at 20 fps: the same score, the
// same beats at the same tap counts, the same drips. (The engine itself is checked step-exact
// in tests/unit/tap-pick.test.ts; here the phones' frame rate and size must not matter.)
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-comedy-determinism.cjs
const L = require('./qa-tap-comedy-lib.cjs');

const RUNS = [
  { name: '320x568', viewport: { width: 320, height: 568 } },
  { name: '430x932', viewport: { width: 430, height: 932 } },
  { name: '390x844@20fps', viewport: { width: 390, height: 844 }, fps: 20 },
];
// a regular player (7 taps/s, gaps far above the 40 ms minimum) with a pause in the middle; the last
// touch is 1.3 s before the sprint ends (a touch AT the end may arrive a frame late on a 20 fps phone)
const TIMES = [...L.steady(7, 1500, 9000, 0, 1), ...L.steady(2, 10600, 2500, 0, 2), ...L.steady(7, 13200, 6600, 0, 3)];
// (every touch lands well inside the 20 s sprint, so CDP delivery jitter at its edges cannot matter)

async function run(browser, r) {
  const { page, cdp, context, errors } = await L.openTap(browser, { viewport: r.viewport, fps: r.fps, seed: 99 });
  const s0 = await L.st(page);
  const left = await page.evaluate(() => window.__party.leftMs);
  const zero = Date.now() - (50000 - left);
  const pend = [];
  for (let i = 0; i < TIMES.length; i++) {
    const w = zero + TIMES[i] - Date.now();
    if (w > 0) await L.sleep(w);
    pend.push(L.tapAt(cdp, [{ x: s0.x + (i % 2 ? 30 : -30), y: s0.y + 40 }]));
  }
  await Promise.allSettled(pend);
  await page.waitForFunction(() => window.__tap() && window.__tap().phase === 'done', null, { timeout: 30000 });
  const s = await L.st(page);
  await context.close();
  return {
    name: r.name,
    fingerprint: s.fingerprint,
    score: s.taps,
    bounces: s.bounces,
    beats: s.beats.filter((b) => !b.id.startsWith('wait-')).map((b) => `${b.id}@${b.taps}`),
    drips: s.events.filter((e) => e.id === 'drip').map((e) => e.taps),
    errors,
  };
}

(async () => {
  const browser = await L.chromium.launch();
  const res = [];
  for (const r of RUNS) res.push(await run(browser, r));
  await browser.close();
  for (const r of res) console.log(JSON.stringify({ ...r, drips: r.drips.length }));
  const a = res[0];
  for (const r of res.slice(1)) {
    L.check(`${r.name} vs ${a.name}: same level`, r.fingerprint === a.fingerprint);
    L.check(`${r.name} vs ${a.name}: same score`, r.score === a.score, [a.score, r.score]);
    L.check(`${r.name} vs ${a.name}: same beats at the same tap counts`, JSON.stringify(r.beats) === JSON.stringify(a.beats), r.beats);
    L.check(`${r.name} vs ${a.name}: same drips`, JSON.stringify(r.drips) === JSON.stringify(a.drips));
  }
  for (const r of res) L.check(`${r.name}: no console errors`, r.errors.length === 0, r.errors.slice(0, 2));
  console.log(L.fails.length ? `\n${L.fails.length} FAILED: ${L.fails.join(', ')}` : '\nALL OK');
})();
