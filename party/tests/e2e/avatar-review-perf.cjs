// 60 (and 120) random looks composed at 40 + 96 px on a 4x throttled CPU; cache memory; picture bytes over the wire.
// node tests/e2e/avatar-review-perf.cjs   (vite on AVATAR_PORT, default 5296)
const { chromium } = require('playwright');
const PORT = process.env.AVATAR_PORT || 5296;
(async () => {
  const browser = await chromium.launch();
  for (const n of [60, 60, 60, 120]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let bytes = 0, pics = 0;
    page.on('response', async (r) => { if (/\/assets\/shimi\//.test(r.url())) { pics++; bytes += Number(r.headers()['content-length'] || 0); } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(`http://localhost:${PORT}/avatar-lab.html?view=wall&n=${n}&seed=${5 + n}`);
    await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.ready, null, { timeout: 180000, polling: 250 });
    const r = await page.evaluate(() => window.__avatarLab);
    console.log(JSON.stringify({ n, wallMs: Math.round(r.wallMs), composeMs: Math.round(r.wallComposeMs), bitmaps: r.cache.bitmaps, bitmapMB: +(r.cache.bitmapBytes / 1048576).toFixed(2), urlMB: +(r.cache.urlBytes / 1048576).toFixed(2), pictures: pics, pictureKB: Math.round(bytes / 1024) }));
    await page.close();
  }
  await browser.close();
})();
