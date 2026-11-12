// Screenshot of a lab view: node tests/e2e/avatar-hats-lab.cjs "<query>" <name> [width]
// Writes tests/e2e/out/avatar-hats/<name>.png. Needs vite on AVATAR_PORT (default 5292).
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.AVATAR_PORT || 5292;
(async () => {
  const [q = 'view=slots', name = 'lab', width = '1400'] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://localhost:${PORT}/avatar-lab.html?${q}`);
  await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.ready, null, { timeout: 120000, polling: 250 });
  await page.waitForTimeout(800);
  const out = path.join(__dirname, 'out', 'avatar-hats', `${name}.png`);
  await page.screenshot({ path: out, fullPage: true });
  const rep = await page.evaluate(() => window.__avatarLab);
  console.log(out, JSON.stringify({ wallMs: rep.wallMs, wallCount: rep.wallCount, errors: rep.errors }), errors.length ? errors : 'no console errors / 404s');
  await browser.close();
})();
