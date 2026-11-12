// Walls of random looks from the lab (?view=wall): the 40 px and 96 px walls per seed.
// node tests/e2e/avatar-review-wall.cjs <tag> <seed...>   (vite on AVATAR_PORT, default 5296)
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.AVATAR_PORT || 5296;
(async () => {
  const [tag = 'wall', ...seeds] = process.argv.slice(2);
  const browser = await chromium.launch();
  for (const seed of seeds.length ? seeds : ['1']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://localhost:${PORT}/avatar-lab.html?view=wall&n=${process.env.N || 60}&seed=${seed}`);
    await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.ready, null, { timeout: 120000, polling: 250 });
    const rep = await page.evaluate(() => ({ ms: window.__avatarLab.wallMs, cache: window.__avatarLab.cache }));
    for (const s of ['40', '96']) {
      const out = path.join(__dirname, 'out', 'avatar-review', `${tag}-seed${seed}-${s}.png`);
      await (await page.$(`[data-wall="${s}"]`)).screenshot({ path: out });
      console.log(out);
    }
    console.log(JSON.stringify(rep), errors.length ? errors : 'no errors');
    await page.close();
  }
  await browser.close();
})();
