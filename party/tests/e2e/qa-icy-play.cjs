// icy: full real-length rounds with three scripted players (real touch events).
//   PARTY_CLIENT_PORT=5222 npx vite
//   node tests/e2e/qa-icy-play.cjs [durationMs=75000] [seed=11] [size=390x844] [kinds=clumsy,normal,expert]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { phoneContext, createTouch, playIcy, SIZES } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5222';
const OUT = path.join(__dirname, 'out', 'qa-icy');
fs.mkdirSync(OUT, { recursive: true });
const dur = Number(process.argv[2] || 75000);
const seed = Number(process.argv[3] || 11);
const size = process.argv[4] || '390x844';
const kinds = (process.argv[5] || 'clumsy,normal,expert').split(',');

(async () => {
  const browser = await chromium.launch();
  const results = await Promise.all(
    kinds.map(async (kind, i) => {
      const context = await phoneContext(browser, size);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`${BASE}/dev.html?game=icy&seed=${seed}&duration=${dur}`);
      await page.waitForFunction(() => !!window.__icy, null, { timeout: 15000 });
      const touch = await createTouch(context, page);
      // "rhythm:600" = alternate sides every 600 ms
      const [k, period] = kind.split(':');
      const r = await playIcy(page, touch, SIZES[size], k, 1000 + i * 77 + seed, { period: Number(period) || 450 });
      if (period) r.kind = kind;
      await page.screenshot({ path: path.join(OUT, `play-${kind}-end.png`), timeout: 5000 }).catch((e) => console.log(kind, 'screenshot failed', e.message.split('\n')[0]));
      r.errors = errors;
      await context.close();
      return r;
    }),
  );
  for (const r of results) console.log(JSON.stringify(r));
  await browser.close();
})();
