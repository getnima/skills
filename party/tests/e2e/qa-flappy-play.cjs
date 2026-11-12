// flappy: full real-length rounds with scripted players (real touch taps).
//   PARTY_CLIENT_PORT=5222 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/qa-flappy-play.cjs [durationMs=60000] [seed=11] [size=390x844] [kinds=clumsy,normal,expert]
//   kinds may carry a period: rhythm:420
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { phoneContext, createTouch, SIZES } = require('./qa-icy-lib.cjs');
const { playFlappy } = require('./qa-flappy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5222';
const OUT = path.join(__dirname, 'out', 'qa-flappy');
fs.mkdirSync(OUT, { recursive: true });
const dur = Number(process.argv[2] || 60000);
const seed = Number(process.argv[3] || 11);
const size = process.argv[4] || '390x844';
const kinds = (process.argv[5] || 'clumsy,normal,expert').split(',');

(async () => {
  const browser = await chromium.launch();
  const results = await Promise.all(
    kinds.map(async (kindArg, i) => {
      const [kind, period] = kindArg.split(':');
      const context = await phoneContext(browser, size);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`${BASE}/dev.html?game=flappy&seed=${seed}&duration=${dur}`);
      await page.waitForFunction(() => !!window.__flappy, null, { timeout: 15000 });
      const touch = await createTouch(context, page);
      const r = await playFlappy(page, touch, SIZES[size], kind, 500 + i * 31 + seed, { period: Number(period) || undefined });
      r.kind = kindArg;
      await page.screenshot({ path: path.join(OUT, `play-${kind}-end.png`), timeout: 5000 }).catch(() => {});
      r.errors = errors;
      await context.close();
      return r;
    }),
  );
  for (const r of results) console.log(JSON.stringify(r));
  await browser.close();
})();
