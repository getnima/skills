// chaos-ninja-touch: does a real CDP touch swipe slice in ninja as well as a mouse swipe does?
// Dev harness, one phone, same seed, one run per input kind. node tests/e2e/chaos-ninja-touch.cjs
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:5341';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(kind, device, moveGap) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices[device] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${BASE}/dev.html?game=ninja&seed=7&duration=20000`);
  await page.waitForFunction(() => window.__ninja && window.__party, null, { timeout: 20000 });
  const vp = page.viewportSize();
  const t0 = Date.now();
  let swipes = 0;
  while (Date.now() - t0 < 17000) {
    const ts = await page.evaluate(() => (window.__ninja ? window.__ninja.targets() : []));
    const lead = 0.06;
    const pts = ts.map((t) => ({ ...t, px: t.x + t.vx * lead, py: t.y + (t.vy + 600) * lead }));
    const bombs = pts.filter((t) => t.kind === 'bomb');
    const f = pts.find((t) => t.kind !== 'bomb' && t.py > 140 && t.py < vp.height - 50 && bombs.every((bb) => Math.abs(bb.py - t.py) > bb.r * 2.4 || Math.abs(bb.px - t.px) > bb.r * 4));
    if (!f) { await sleep(40); continue; }
    const x0 = f.px - f.r * 1.5, x1 = f.px + f.r * 1.5, y = f.py;
    if (kind === 'touch') {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y, id: 1 }] });
      for (let k = 1; k <= 6; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * k) / 6, y, id: 1 }] }); await sleep(moveGap); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x0, y); await page.mouse.down();
      for (let k = 1; k <= 6; k++) { await page.mouse.move(x0 + ((x1 - x0) * k) / 6, y); await sleep(moveGap); }
      await page.mouse.up();
    }
    swipes++;
    await sleep(150);
  }
  const score = await page.evaluate(() => window.__party.score);
  await b.close();
  return { kind, device, moveGap, swipes, score };
}
(async () => {
  for (const [k, d, g] of [['mouse', 'iPhone SE', 10], ['touch', 'iPhone SE', 10], ['touch', 'iPhone SE', 0], ['touch', 'Pixel 7', 10]]) console.log(JSON.stringify(await run(k, d, g)));
})();
