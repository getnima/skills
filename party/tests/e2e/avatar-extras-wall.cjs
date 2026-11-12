// Screenshot the lab's random wall (and the slot view) with the extras in the catalog.
// node tests/e2e/avatar-extras-wall.cjs [seed=3] [n=60]   (vite on AVATAR_PORT, default 5294)
const { chromium } = require('playwright');
const path = require('path');

const PORT = process.env.AVATAR_PORT || 5294;
(async () => {
  const [seed = '3', n = '60'] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  const outDir = path.join(__dirname, 'out', 'avatar-extras');
  await page.goto(`http://localhost:${PORT}/avatar-lab.html?view=wall&n=${n}&seed=${seed}`);
  await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.ready, null, { timeout: 120000, polling: 250 });
  await page.waitForTimeout(800);
  const wall = await page.evaluate(() => ({ ms: window.__avatarLab.wallMs, count: window.__avatarLab.wallCount, errors: window.__avatarLab.errors }));
  const extras = await page.evaluate(async (args) => {
    const s = await import('/src/avatar/index.ts');
    const c = s;
    let ears = 0, neck = 0;
    for (let i = 0; i < Number(args.n); i++) {
      const l = s.randomLook(Number(args.seed) * 1000 + i, c.ITEM_IDS);
      if (l.ears !== null && l.ears >= 301) ears++;
      if (l.neck !== null && l.neck >= 325) neck++;
    }
    return { ears, neck };
  }, { seed, n });
  await page.screenshot({ path: path.join(outDir, `wall-seed${seed}.png`), fullPage: true });
  await page.goto(`http://localhost:${PORT}/avatar-lab.html?view=slots`);
  await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.ready, null, { timeout: 120000, polling: 250 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'slots.png'), fullPage: true });
  console.log(JSON.stringify({ wall, extrasOnWall: extras, errors }));
  await browser.close();
})();
