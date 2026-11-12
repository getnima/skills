// The room as the lab shows it (/avatar-lab.html?view=room, a 430 x 760 box on a desktop page), untouched.
const { chromium } = require('playwright');
const path = require('path');
const { BASE, OUT } = require('./avatar-room-lib.cjs');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${BASE}/avatar-lab.html?view=room&look=1.11.14.9.6.11.15`);
  await p.waitForSelector('.dr .dr-rig');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: path.join(OUT, 'lab-desktop.png'), fullPage: true });
  console.log('errors', errs);
  await b.close();
})();
