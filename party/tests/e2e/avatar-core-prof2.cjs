// Profiling helper 2: cost of showing 360 avatars as they are composed (vite on 5291, 4x throttled CPU)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  for (const mode of ['canvas', 'img']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${process.env.AVATAR_PORT || 5291}/avatar-lab.html?view=room`);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.RATE || 4) });
    const r = await page.evaluate(async (mode) => {
      const A = await import('/src/avatar/index.ts');
      await A.preloadAvatarAssets();
      A.composeAvatar(A.randomLook(1, A.ITEM_IDS), { size: 48 });
      await new Promise((r) => setTimeout(r, 300));
      const looks = Array.from({ length: 120 }, (_, i) => A.randomLook(i + 3000, A.ITEM_IDS));
      const out = { mode };
      let frames = 0; let run = true;
      const count = () => { frames++; if (run) requestAnimationFrame(count); };
      requestAnimationFrame(count);
      const t = performance.now();
      const host = document.createElement('div'); document.body.append(host);
      await Promise.all(looks.flatMap((l) => [28, 40, 96].map((s) => {
        if (mode === 'canvas') {
          const c = document.createElement('canvas'); c.width = 1; c.height = 1; c.style.width = c.style.height = s + 'px'; host.append(c);
          return A.avatarBitmap(l, s).then((b) => { c.width = b.width; c.height = b.height; c.getContext('2d').drawImage(b, 0, 0); });
        }
        const i = new Image(); i.width = i.height = s; host.append(i);
        return A.avatarUrl(l, s).then((u) => new Promise((res) => { i.onload = res; i.src = u; }));
      })));
      out.resolved = performance.now() - t;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.painted = performance.now() - t;
      run = false; out.frames = frames;
      return out;
    }, mode);
    console.log(r);
    await ctx.close();
  }
  await browser.close();
})();
