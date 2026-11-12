// icy art: quick look. Opens the dev harness at one phone size, holds a side for a moment and
// saves a few screenshots into tests/e2e/out/icy-art/peek/.
//   node tests/e2e/icy-art-peek.cjs [size=390x844] [query=&icyLookFloor=0] [tag=peek] [holdMs=900]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { phoneContext, createTouch, SIZES, sleep } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5281';
const size = process.argv[2] || '390x844';
const query = process.argv[3] || '';
const tag = process.argv[4] || 'peek';
const hold = Number(process.argv[5] || 900);
const OUT = path.join(__dirname, 'out', 'icy-art', 'peek');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await phoneContext(browser, size);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/dev.html?game=icy&seed=4&duration=75000${query}`);
  await page.waitForFunction(() => !!window.__icy, null, { timeout: 15000 });
  await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
  const vp = SIZES[size];
  const touch = await createTouch(context, page);
  await sleep(2700);
  await page.screenshot({ path: path.join(OUT, `${tag}-${size}-0.png`) });
  await touch.down(1, vp.width * 0.8, vp.height * 0.6);
  for (let i = 1; i <= 4; i++) {
    await sleep(hold / 4);
    await page.screenshot({ path: path.join(OUT, `${tag}-${size}-${i}.png`) });
  }
  await touch.up(1);
  await touch.down(1, vp.width * 0.2, vp.height * 0.6);
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, `${tag}-${size}-5.png`) });
  await touch.up(1);
  console.log(JSON.stringify({ size, query, art: await page.evaluate(() => window.__icy.art), look: await page.evaluate(() => window.__icy.look), errors }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
