// Profiling helper: where does a wall of avatars spend its time? (vite on 5291, 4x throttled CPU)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${process.env.AVATAR_PORT || 5291}/avatar-lab.html?view=room`);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.RATE || 4) });
  const r = await page.evaluate(async () => {
    const A = await import('/src/avatar/index.ts');
    let t = performance.now();
    await A.preloadAvatarAssets();
    const out = { preload: performance.now() - t };
    const looks = Array.from({ length: 120 }, (_, i) => A.randomLook(i + 3000, A.ITEM_IDS));
    t = performance.now();
    A.composeAvatar(looks[0], { size: 48 });
    out.firstCompose = performance.now() - t;
    t = performance.now();
    looks.forEach((l) => { A.composeAvatar(l, { size: 48 }); A.composeAvatar(l, { size: 96 }); });
    out.compose240 = performance.now() - t;
    t = performance.now();
    await Promise.all(looks.flatMap((l) => [A.avatarUrl(l, 28), A.avatarUrl(l, 40), A.avatarUrl(l, 96)]));
    out.urls = performance.now() - t;
    t = performance.now();
    await Promise.all(looks.flatMap((l) => [A.avatarUrl(l, 28), A.avatarUrl(l, 40), A.avatarUrl(l, 96)]));
    out.urlsCached = performance.now() - t;
    out.cache = A.avatarCacheStats();
    return out;
  });
  console.log(r);
  await browser.close();
})();
