// Quick look: node tests/e2e/avatar-core-shot.cjs "<query>" <name> [width] [fullPage=1]
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.AVATAR_PORT || 5291;
(async () => {
  const [q = 'view=items', name = 'shot', width = '1400', full = '1'] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/avatar-lab.html?${q}`);
  await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.ready, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const out = path.join(__dirname, 'out', 'avatar-core', `${name}.png`);
  await page.screenshot({ path: out, fullPage: full === '1' });
  console.log(out, JSON.stringify(await page.evaluate(() => window.__avatarLab)), errors);
  await browser.close();
})();
