// icy: fall, death beat, second run with the best line. vite on :5212.
const { chromium, devices } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, 'out', 'icy');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5212/dev.html?game=icy&seed=9&duration=40000');
  await page.waitForSelector('.pa-stage-game canvas');
  const vp = page.viewportSize();
  const icy = () => page.evaluate(() => document.querySelector('.pa-stage-game canvas')?.dataset.icy);
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < 5000) {
    await page.mouse.move(i % 2 ? vp.width * 0.2 : vp.width * 0.8, 500); await page.mouse.down(); await sleep(700); await page.mouse.up(); i++;
  }
  console.log('climbed', await icy());
  // stop playing: the floors scroll away
  let shots = 0;
  for (let k = 0; k < 200 && shots < 3; k++) {
    await sleep(60);
    const v = await icy();
    if (v && v.startsWith('1|')) {
      await page.screenshot({ path: path.join(OUT, `death-${shots}.png`) });
      shots++;
      await sleep(220);
    }
  }
  console.log('after fall', await icy(), 'score', await page.evaluate(() => window.__party.score));
  await sleep(1200);
  for (let k = 0; k < 4; k++) { await page.mouse.move(vp.width * 0.8, 500); await page.mouse.down(); await sleep(600); await page.mouse.up(); await page.mouse.move(vp.width * 0.2, 500); await page.mouse.down(); await sleep(600); await page.mouse.up(); }
  await page.screenshot({ path: path.join(OUT, 'death-run2.png') });
  console.log('run2', await icy(), 'score', await page.evaluate(() => window.__party.score), 'errors', errors);
  await browser.close();
})();
