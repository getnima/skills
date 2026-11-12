// Frame times of the tap game under a CPU throttle, played by a fast two-thumb bot (about
// 11 taps/s through real CDP touches) for a whole round, so the glass ends at its fullest.
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-comedy-perf.cjs [cpuRate] [durationMs] [label]
const { chromium, sleep, openGame, pct, tapAt } = require('./qa-tap-lib.cjs');

const CPU = Number(process.argv[2] || 4);
const DURATION = Number(process.argv[3] || 50000);
const LABEL = process.argv[4] || 'run';

const RECORD = `(() => {
  const orig = window.requestAnimationFrame.bind(window);
  window.__ft = []; let last = 0;
  const tick = (now) => { if (last) window.__ft.push([now - last, window.__party ? window.__party.leftMs : 0]); last = now; orig(tick); };
  orig(tick);
})();`;

(async () => {
  const browser = await chromium.launch();
  const { page, cdp, context, errors } = await openGame(browser, 'tap', { device: 'iPhone 14', cpu: CPU, init: RECORD, query: `seed=11&duration=${DURATION}` });
  await page.waitForFunction(() => window.__tap && window.__tap());
  const tgt = await page.evaluate(() => {
    const s = window.__tap();
    return { x: s.x, y: s.y };
  });
  // play: two thumbs alternating, ~11 taps/s, from round time 1 s to the end
  const t0 = Date.now();
  let n = 0;
  while (true) {
    const st = await page.evaluate(() => ({ left: window.__party.leftMs, ended: window.__party.ended }));
    if (st.ended || st.left < 300) break;
    const due = t0 + n * 91;
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);
    const side = n % 2 === 0 ? -1 : 1;
    void tapAt(cdp, [{ x: tgt.x + side * 30, y: tgt.y + 20 }]);
    n++;
  }
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 30000 });
  const ft = await page.evaluate(() => window.__ft);
  const score = await page.evaluate(() => window.__party.score);
  await context.close();
  await browser.close();
  const all = ft.filter(([, left]) => left > 0 && left < DURATION).map(([d]) => d);
  const busy = ft.filter(([, left]) => left > 0 && left < 15000).map(([d]) => d);
  console.log(
    JSON.stringify({
      label: LABEL,
      cpu: CPU,
      durationMs: DURATION,
      taps: n,
      score,
      frames: all.length,
      p50: +pct(all, 50).toFixed(1),
      p95: +pct(all, 95).toFixed(1),
      p99: +pct(all, 99).toFixed(1),
      last15p50: +pct(busy, 50).toFixed(1),
      last15p95: +pct(busy, 95).toFixed(1),
      last15p99: +pct(busy, 99).toFixed(1),
      errors: errors.slice(0, 3),
    }),
  );
})();
