// Close-up of one corner of the lab's room (stacking check of the sticker and a wide hat).
const { chromium } = require('playwright');
const path = require('path');
const { BASE, OUT } = require('./avatar-room-lib.cjs');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto(`${BASE}/avatar-lab.html?view=room&look=1.11.14.9.6.11.15`);
  await p.waitForSelector('.dr .dr-rig');
  await p.waitForTimeout(2500);
  const r = await p.locator('.dr-star').boundingBox();
  await p.screenshot({ path: path.join(OUT, 'zoom-star.png'), clip: { x: r.x - 120, y: r.y - 20, width: 240, height: 180 } });
  console.log(await p.evaluate(() => [...document.querySelectorAll('.dr-stage > *')].map((e) => `${e.className}:${getComputedStyle(e).zIndex}`).join(' ')));
  await b.close();
})();
