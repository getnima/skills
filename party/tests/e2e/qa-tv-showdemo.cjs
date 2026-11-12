// qa-tv-showdemo: /show.html (the TV control room) opens every scene without errors.
//   PARTY_SERVER_PORT=8813 PARTY_CLIENT_PORT=5213 npx vite ; node tests/e2e/qa-tv-showdemo.cjs
const { chromium } = require('playwright');
const path = require('path');
const { sleep, outDir, checker, BASE } = require('./qa-tv-lib.cjs');

const { check, failures } = checker();
const dir = outDir('showdemo');
(async () => {
  const browser = await chromium.launch();
  try {
    for (const [scene, players] of [['playing', 30], ['results', 13], ['final', 8], ['standings', 30]]) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(`${BASE}/show.html?scene=${scene}&players=${players}&bare=1`);
      await sleep(5000);
      await page.screenshot({ path: path.join(dir, `${scene}-${players}.png`) });
      const nodes = await page.evaluate(() => document.querySelectorAll('.sh-scene').length);
      check(nodes > 0, `${scene}: a scene is on screen`);
      check(errors.length === 0, `${scene}: no console errors`, errors);
      await page.close();
    }
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    await browser.close();
  }
  console.log(failures.length === 0 ? 'qa-tv-showdemo: ALL OK' : `qa-tv-showdemo: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
