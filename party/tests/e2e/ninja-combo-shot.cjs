// ninja: play with the bot until a combo lands and screenshot the callout. Needs vite on :5215.
const { chromium, devices } = require('playwright');
const path = require('path');
const { botMove, ninja, OUT } = require('./ninja-play.cjs');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  await page.goto('http://localhost:5215/dev.html?game=ninja&seed=21&duration=60000');
  await page.waitForFunction(() => !!window.__ninja);
  const vp = page.viewportSize();
  for (let i = 0; i < 2000; i++) {
    const before = (await ninja(page)).comboBonus;
    await botMove(page, vp);
    const n = await ninja(page);
    if (n.comboBonus > before) {
      await page.screenshot({ path: path.join(OUT, 'combo-callout.png') });
      console.log('combo shot', n.comboBonus, n.score);
      break;
    }
    if (await page.evaluate(() => window.__party.ended)) break;
  }
  await browser.close();
})();
