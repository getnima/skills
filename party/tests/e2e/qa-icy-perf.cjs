// Performance: a full real-length round of icy or flappy with CPU throttled 4x
// (a cheap Android), a player bot playing, every frame interval recorded.
//   PARTY_CLIENT_PORT=5222 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/qa-icy-perf.cjs [icy|flappy] [size=360x640] [throttle=4]
const { chromium } = require('playwright');
const { phoneContext, createTouch, playIcy, SIZES, startFrameRecorder, frameStats } = require('./qa-icy-lib.cjs');
const { playFlappy } = require('./qa-flappy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5222';
const game = process.argv[2] || 'icy';
const size = process.argv[3] || '360x640';
const rate = Number(process.argv[4] || 4);

(async () => {
  const browser = await chromium.launch();
  const context = await phoneContext(browser, size);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dur = game === 'icy' ? 75000 : 60000;
  await page.goto(`${BASE}/dev.html?game=${game}&seed=4&duration=${dur}`);
  await page.waitForFunction((g) => !!window[g === 'icy' ? '__icy' : '__flappy'], game, { timeout: 15000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const touch = await createTouch(context, page);
  await startFrameRecorder(page);
  const r = game === 'icy' ? await playIcy(page, touch, SIZES[size], 'bounce', 7) : await playFlappy(page, touch, SIZES[size], 'normal', 7);
  const st = await frameStats(page);
  console.log(JSON.stringify({ game, size, throttle: rate, score: r.score, runs: r.runs, ...st, errors }));
  const ok = st.p95 <= 34 && errors.length === 0;
  console.log(ok ? 'ok   p95 under ~33 ms' : 'FAIL p95 over 33 ms or errors');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
