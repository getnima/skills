// Profiling helper 2: cost of showing 360 avatars as they are composed (vite on 5291, 4x throttled CPU)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  for (const mode of (process.env.MODES || 'presized-240,img-240').split(',')) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${process.env.AVATAR_PORT || 5291}/avatar-lab.html?view=room`);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.RATE || 4) });
    if (process.env.SLICE) await page.evaluate((v) => { window.__SLICE = v[0]; window.__FLUSH = v[1]; }, [Number(process.env.SLICE), Number(process.env.FLUSH || 120)]);
    await cdp.send('Performance.enable');
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const r = await page.evaluate(async (mode) => {
      const A = await import('/src/avatar/index.ts');
      await A.preloadAvatarAssets();
      A.composeAvatar(A.randomLook(1, A.ITEM_IDS), { size: 48 });
      await new Promise((r) => setTimeout(r, 300));
      const looks = Array.from({ length: 120 }, (_, i) => A.randomLook(i + 3000, A.ITEM_IDS));
      const out = { mode };
      let frames = 0; let run = true;
      const t = performance.now();
      const host = document.createElement('div'); if (mode !== 'canvas-late') document.body.append(host); if (mode === 'canvas-hidden') host.style.display = 'none';
      await Promise.all(looks.flatMap((l) => (mode.endsWith('240') ? [40, 96] : [28, 40, 96]).map((s) => {
        if (mode !== 'img') {
          const c = document.createElement('canvas'); const B = A.avatarBucket(s); c.width = c.height = mode.startsWith('presized') ? B : 1; c.style.width = c.style.height = s + 'px'; if (mode.includes('contain')) c.style.contain = 'strict'; host.append(c);
          return A.avatarBitmap(l, s).then((b) => { if (c.width !== b.width) { c.width = b.width; c.height = b.height; } c.getContext('2d').drawImage(b, 0, 0); });
        }
        const i = new Image(); i.width = i.height = s; host.append(i);
        return A.avatarUrl(l, s).then((u) => new Promise((res) => { i.onload = res; i.src = u; }));
      })));
      out.resolved = performance.now() - t;
      if (mode === 'canvas-late') document.body.append(host);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.painted = performance.now() - t;
      run = false; out.frames = frames;
      return out;
    }, mode);
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    for (const k of ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration', 'LayoutCount']) r[k] = +(m1[k] - m0[k]).toFixed(3);
    console.log(JSON.stringify(r));
    await ctx.close();
  }
  await browser.close();
})();
