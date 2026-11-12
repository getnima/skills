// Regression check (QA finding "slow phones throw away honest taps"): an honest two-thumb
// player at 11 taps/s must score the same on a fast phone and under a 4x CPU throttle. Taps
// are stamped with the pointer event's own time (when the finger landed), not with when the
// busy main thread got round to handling them, so bunched delivery does not trip the
// minimum gap between taps.
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-stamp.cjs [cpu=4] [hz=11]
const L = require('./qa-tap-comedy-lib.cjs');

const CPU = Number(process.argv[2] || 4);
const HZ = Number(process.argv[3] || 11);
const DUR = 53000;

async function run(browser, cpu) {
  const { page, cdp, context, errors } = await L.openTap(browser, { viewport: { width: 390, height: 844 }, duration: DUR, seed: 3, cpu });
  const s0 = await L.st(page);
  const left = await page.evaluate(() => window.__party.leftMs);
  const roundZero = Date.now() - (DUR - left);
  const times = [];
  for (let t = 1000; t < 21000; t += 1000 / HZ) times.push(Math.round(t));
  let i = 0;
  for (const t of times) {
    const wait = roundZero + t - Date.now();
    if (wait > 0) await L.sleep(wait);
    const side = i++ % 2 === 0 ? -1 : 1;
    void L.tapAt(cdp, [{ x: s0.x + side * 50, y: s0.y + 20 }]);
  }
  await page.waitForFunction(() => window.__tap && window.__tap() && window.__tap().phase === 'done', null, { timeout: 60000 });
  const s = await L.st(page);
  await context.close();
  return { cpu, sent: times.length, touches: s.touches, score: s.taps, bounces: s.bounces, late: s.late, t0: s.t0, errors: errors.slice(0, 2) };
}

(async () => {
  const browser = await L.chromium.launch();
  const fast = await run(browser, 1);
  const slow = await run(browser, CPU);
  await browser.close();
  console.log(JSON.stringify(fast));
  console.log(JSON.stringify(slow));
  L.check(`cpu ${CPU}: within 3% of the unthrottled score`, slow.score >= fast.score * 0.97, [slow.score, fast.score]);
  L.check(`cpu ${CPU}: under 2% of the touches bounced`, slow.bounces <= slow.touches * 0.02, [slow.bounces, slow.touches]);
  console.log(L.fails.length ? `\n${L.fails.length} FAILED: ${L.fails.join(', ')}` : '\nALL OK');
})();
