// host-smoke: open the TV host page and take a lobby screenshot.
const { chromium } = require('playwright');
const OUT = __dirname + '/out/host';
const URL = process.env.HOST_URL || 'http://localhost:5203/host.html';
(async () => {
  const browser = await chromium.launch();
  const w = Number(process.env.W || 1920), h = Number(process.env.H || 1080);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto(URL + (process.env.Q || ''));
  await page.waitForSelector('[data-testid=room-code]', { timeout: 10000 });
  await page.waitForTimeout(1200);
  const code = await page.textContent('[data-testid=room-code]');
  await page.screenshot({ path: `${OUT}/${process.env.NAME || 'smoke'}.png` });
  const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));
  console.log(JSON.stringify({ code, scroll, logs }));
  await browser.close();
})();
