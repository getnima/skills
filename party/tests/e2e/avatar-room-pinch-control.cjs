// Control for the pinch check in avatar-room.cjs: the same emulated pinch outside the room (on the
// lab's own card, no lock-down) must zoom, inside the room it must not.
const { chromium } = require('playwright');
const { BASE } = require('./avatar-room-lib.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pinch(cdp, cx, cy) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 20, y: cy, id: 1 }, { x: cx + 20, y: cy, id: 2 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 20 - i * 9, y: cy - i * 3, id: 1 }, { x: cx + 20 + i * 9, y: cy + i * 3, id: 2 }] });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
}
(async () => {
  const b = await chromium.launch();
  for (const where of ['outside', 'inside']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/avatar-lab.html?view=room`);
    await page.waitForSelector('.dr .dr-rig');
    await sleep(800);
    const cdp = await ctx.newCDPSession(page);
    const box = await page.locator(where === 'outside' ? '.lab-card' : '.dr-stage').first().boundingBox();
    await pinch(cdp, box.x + box.width / 2, box.y + Math.min(box.height / 2, 120));
    console.log(where, 'scale', await page.evaluate(() => visualViewport.scale));
    await ctx.close();
  }
  await b.close();
})();
