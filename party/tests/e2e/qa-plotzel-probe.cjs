// Quick probe of the embed under each stand-in failure: state + screenshots over time.
//   node tests/e2e/qa-plotzel-probe.cjs [route...]     (vite :5223, stand-in :5233)
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.PZ_BASE || 'http://localhost:5223';
const SITE = process.env.PZ_SITE || 'http://127.0.0.1:5233';
const OUT = path.join(__dirname, 'out', 'qa-plotzel', 'probe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['ok', 'nobridge', 'xfo', 'csp', 'hang', 'slow', 'tall', 'input', 'evil'];

(async () => {
  const browser = await chromium.launch();
  for (const route of routes) {
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await context.newPage();
    const log = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`));
    page.on('popup', () => log.push('POPUP opened'));
    page.on('dialog', (d) => {
      log.push(`DIALOG ${d.type()} ${d.message()}`);
      void d.dismiss();
    });
    const url = `${BASE}/dev.html?game=plotzel&seed=7&duration=60000&plotzel=embed&plotzelUrl=${encodeURIComponent(`${SITE}/${route}`)}`;
    await page.goto(url);
    for (const t of [1000, 3000, 7000, 10000]) {
      await sleep(t - (t === 1000 ? 0 : [1000, 3000, 7000, 10000][[1000, 3000, 7000, 10000].indexOf(t) - 1]));
      const st = await page.evaluate(() => {
        const w = document.querySelector('.pze, .pz');
        return {
          mode: w ? w.dataset.plotzel : null,
          state: w ? w.dataset.state : null,
          url: location.href.slice(0, 40),
          covers: [...document.querySelectorAll('.pze-cover.is-on')].map((c) => c.className),
        };
      });
      console.log(route, t, JSON.stringify(st));
      await page.screenshot({ path: path.join(OUT, `${route}-${t}.png`) });
    }
    console.log(route, 'log', log.filter((l) => !l.startsWith('debug')).slice(0, 8));
    await context.close();
  }
  await browser.close();
})();
