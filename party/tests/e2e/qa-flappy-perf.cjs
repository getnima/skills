// flappy performance for the phone that is flying: frame intervals under a throttled CPU
// (4x = a cheap Android), with an outside player tapping (real touches), for `ms` of flight.
//   PARTY_CLIENT_PORT=5331 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   QA_BASE=http://localhost:5331 node tests/e2e/qa-flappy-perf.cjs [size=360x640] [throttle=4] [ms=25000] [query='&field=8']
// query '&pilot=1&field=8': the game's own pilot flies instead (through the finale).
// The page is restarted when the bird goes down before `ms`, so the numbers are always of
// a flying phone. Prints one JSON line; exit 1 when p95 is over 34 ms.
const { chromium } = require('playwright');
const { phoneContext, createTouch, SIZES, sleep } = require('./qa-icy-lib.cjs');
const { playFlappy } = require('./qa-flappy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5331';
const size = process.argv[2] || '360x640';
const rate = Number(process.argv[3] || 4);
const ms = Number(process.argv[4] || 25000);
const query = process.argv[5] || '';

(async () => {
  const browser = await chromium.launch();
  const frames = [];
  const errors = [];
  let flights = 0;
  let seed = 4;
  while (frames.length === 0 || ms - frames.reduce((a, b) => a + b, 0) > 800) {
    const context = await phoneContext(browser, size);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/dev.html?game=flappy&seed=${seed++}&duration=90000${query}`);
    await page.waitForFunction(() => !!window.__flappy, null, { timeout: 15000 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const touch = await createTouch(context, page);
    await sleep(300);
    await page.evaluate(() => {
      window.__frames = [];
      window.__rec = true;
      let last = performance.now();
      const f = (t) => {
        if (!window.__rec) return;
        window.__frames.push(t - last);
        last = t;
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    const left = ms - frames.reduce((a, b) => a + b, 0);
    if (/pilot=1/.test(query)) {
      // the game's own pilot flies (its look-ahead runs inside the frame: the numbers are on the safe side)
      const t0 = Date.now();
      for (;;) {
        const st = await page.evaluate(() => (window.__flappy ? window.__flappy.mode : null));
        if (process.env.QA_LOG) console.log(Date.now() - t0, st);
        if (Date.now() - t0 >= left || st !== "fly") break;
        await sleep(100);
      }
    } else await playFlappy(page, touch, SIZES[size], 'expert', 7 + flights, { maxMs: left });
    // only the frames of the flight: the crash and what follows are another screen
    frames.push(...(await page.evaluate(() => { window.__rec = false; return window.__frames.slice(5, -3); })));
    flights++;
    await context.close();
    if (flights > 30) break;
  }
  const s = [...frames].sort((a, b) => a - b);
  const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
  const st = { size, throttle: rate, flights, frames: frames.length, seconds: +(frames.reduce((a, b) => a + b, 0) / 1000).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +s[s.length - 1].toFixed(1), over34: frames.filter((v) => v > 34).length, over50: frames.filter((v) => v > 50).length, errors };
  console.log(JSON.stringify(st));
  const ok = st.p95 <= 34 && errors.length === 0;
  console.log(ok ? 'ok   p95 under ~33 ms' : 'FAIL p95 over 33 ms or errors');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
