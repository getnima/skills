const { chromium } = require('playwright');
const L = require('./qa-tv-lib.cjs');
(async () => {
  const b = await chromium.launch();
  const { page, code } = await L.openHost(b);
  const names = Array.from({ length: 60 }, (_, i) => 'P' + i);
  const ph = await L.scriptedPhones(code, names, (i, t) => (t / 40) * (1 + 0.35 * Math.sin(t / 650 + i * 1.7)) + (i % 5));
  await page.mouse.click(960, 40);
  await page.keyboard.press('KeyN');
  await L.waitPhase(page, 'playing', 20000);
  await L.sleep(1000);
  const r = await page.evaluate(() => new Promise((res) => {
    const out = []; const t0 = performance.now();
    const step = () => {
      const rows = document.querySelectorAll('.sh-row').length;
      let vis = 0;
      for (const e of document.querySelectorAll('.sh-row-enter')) { const s = getComputedStyle(e); if (Number(s.opacity) > 0.55) vis++; }
      const list = document.querySelector('.sh-list'); const lo = list ? getComputedStyle(list).opacity : '-';
      out.push([Math.round(performance.now() - t0), rows, vis, lo]);
      if (performance.now() - t0 < 8000) requestAnimationFrame(step); else res(out);
    };
    requestAnimationFrame(step);
  }));
  const bad = r.filter((x) => x[2] < 5);
  console.log('frames', r.length, 'low-visibility frames', bad.length, JSON.stringify(bad.slice(0, 30)));
  ph.stop(); await b.close();
})();
