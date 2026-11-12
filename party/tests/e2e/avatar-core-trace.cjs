// Profiling helper 3: a Chrome trace of the wall view, summed by event name (vite on 5291, 4x CPU)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.RATE || 4) });
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'blink', 'cc', 'gpu'] });
  await page.goto(`http://localhost:${process.env.AVATAR_PORT || 5291}/avatar-lab.html?view=wall&n=${process.env.N || 120}&seed=3`);
  await page.waitForFunction(() => window.__avatarLab && window.__avatarLab.wallMs !== null, null, { timeout: 120000, polling: 250 });
  const lab = await page.evaluate(() => window.__avatarLab);
  const buf = await browser.stopTracing();
  const events = JSON.parse(buf.toString()).traceEvents;
  const sum = {};
  for (const e of events) if (e.ph === 'X' && e.dur) { const k = `${e.name}`; (sum[k] = sum[k] || { ms: 0, n: 0, cpu: 0 }); sum[k].ms += e.dur / 1000; sum[k].cpu += (e.tdur || 0) / 1000; sum[k].n++; }
  console.log('wallMs', lab.wallMs, 'compose', lab.wallComposeMs);
  console.log(Object.entries(sum).sort((a, b) => b[1].ms - a[1].ms).slice(0, 28).map(([k, v]) => `${v.ms.toFixed(0).padStart(7)} ms wall ${v.cpu.toFixed(0).padStart(6)} ms cpu  x${String(v.n).padStart(5)}  ${k}`).join('\n'));
  await browser.close();
})();
