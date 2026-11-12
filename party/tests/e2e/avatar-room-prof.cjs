// Where does tap latency go on a 4x-throttled CPU? Logs pointerdown -> click -> DOM per tap and long tasks.
const { chromium } = require('playwright');
const { BASE } = require('./avatar-room-lib.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/avatar-lab.html?view=wall&n=1`);
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="host" style="position:fixed;inset:0"></div>';
    const m = await import('/src/avatar/dressing-mount.ts');
    const av = await import('/src/avatar/index.ts');
    window.__room = m.mountDressingRoom(document.querySelector('#host'), {
      look: av.decodeLook('1.0.0.0.0.0.0'),
      name: 'דנה',
      onChange() {},
      onDone() {},
    });
  });
  await sleep(4000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    window.__log = [];
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({
      entryTypes: ['longtask'],
    });
    let cur = null;
    document.addEventListener('pointerdown', (e) => (cur = { down: e.timeStamp }), true);
    document.addEventListener('click', () => cur && (cur.click = performance.now()), true);
    document.addEventListener('click', () => cur && (cur.clickEnd = performance.now()), false);
    new MutationObserver(() => {
      if (cur && cur.click && !cur.dom) {
        cur.dom = performance.now();
        window.__log.push(cur);
        cur = null;
      }
    }).observe(document.querySelector('.dr-shelf'), { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] });
  });
  for (let i = 0; i < 10; i++) {
    const t = await page.$$eval('.dr-shelf .dr-tile', (els) =>
      els.slice(0, 4).map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }),
    );
    await page.touchscreen.tap(t[i % 4].x, t[i % 4].y);
    await sleep(500);
  }
  const r = await page.evaluate(() => ({
    log: window.__log.map((c) => ({
      toClick: Math.round(c.click - c.down),
      handler: Math.round(c.clickEnd - c.click),
      toDom: Math.round(c.dom - c.down),
    })),
    long: window.__long,
  }));
  console.log(JSON.stringify(r.log));
  console.log('long tasks', JSON.stringify(r.long.slice(-30)));
  await browser.close();
})();
