// Quick look at one URL of the show demo. Usage: node show-smoke.cjs "<query>" <name> [w] [h] [waitMs] [js]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [query = '', name = 'smoke', w = '1920', h = '1080', wait = '3000', js = ''] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await page.goto(`http://localhost:5204/show.html?${query}`);
  await page.waitForSelector('.sh-scene');
  if (js) await page.evaluate(js);
  await page.waitForTimeout(Number(wait));
  await page.screenshot({ path: path.join(__dirname, 'out', 'show', `${name}.png`) });
  console.log(JSON.stringify({ errors, state: await page.evaluate(() => window.__show.state()) }));
  await browser.close();
})();
