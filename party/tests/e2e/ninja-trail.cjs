// ninja: look at the blade trail and a combo callout mid-swipe. Needs vite on :5215.
const { chromium, devices } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, 'out', 'ninja');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
  await page.goto('http://localhost:5215/dev.html?game=ninja&seed=7&duration=60000');
  await page.waitForFunction(() => !!window.__ninja);
  for (let i = 0; i < 1200; i++) {
    const ts = await page.evaluate(() => window.__ninja.targets());
    const fr = ts.filter((t) => t.kind !== 'bomb' && t.y > 160 && t.y < 700 && Math.abs(t.vy) < 520);
    if (fr.length >= 3 && !ts.some((t) => t.kind === 'bomb')) {
      fr.sort((a, b) => a.x - b.x);
      const pts = fr.map((t) => [t.x, t.y + t.vy * 0.03]);
      const x0 = pts[0][0] - 60, x1 = pts[pts.length - 1][0] + 60;
      const yAt = (x) => { let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p; return best[1]; };
      // swipe in the background, screenshot while the finger is still moving
      const moving = (async () => {
        await page.mouse.move(x0, yAt(x0));
        await page.mouse.down();
        for (let k = 1; k <= 24; k++) { const x = x0 + ((x1 - x0) * k) / 24; await page.mouse.move(x, yAt(x)); await sleep(12); }
        for (let k = 1; k <= 10; k++) { await page.mouse.move(x1 - k * 12, yAt(x1) + k * 14); await sleep(12); }
        await page.mouse.up();
      })();
      await sleep(260);
      await page.screenshot({ path: path.join(OUT, 'trail-combo.png') });
      await moving;
      console.log('combo', await page.evaluate(() => ({ c: window.__ninja.comboBonus, s: window.__ninja.score })));
      break;
    }
    await sleep(30);
  }
  await browser.close();
})();
