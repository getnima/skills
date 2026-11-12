// icy art: frame cost, old look against new look, interleaved (the machine is shared and noisy).
// Two dev servers: the new tree (default http://localhost:5281) and a snapshot of the tree from
// before the art pass (default http://localhost:5282). Each round: CPU throttled 4x, 390x844,
// real touches, the bounce bot, a 40 s round. Measured per frame:
//   - the frame interval (requestAnimationFrame to requestAnimationFrame), vsync-quantised;
//   - the time spent inside the game's own frame callback (update + draw calls), in ms.
//   node tests/e2e/icy-art-perf.cjs [pairs=3] [durationMs=40000] [size=390x844]
const { chromium } = require('playwright');
const { phoneContext, createTouch, playIcy, SIZES } = require('./qa-icy-lib.cjs');
const NEW = process.env.QA_BASE || 'http://localhost:5281';
const OLD = process.env.QA_OLD || 'http://localhost:5282';
const pairs = Number(process.argv[2] || 3);
const dur = Number(process.argv[3] || 40000);
const size = process.argv[4] || '390x844';

// wraps requestAnimationFrame: per frame, the summed time of every callback that ran in it
const TIMER = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__cost = [];
  window.__gap = [];
  let frameT = -1;
  let acc = 0;
  let last = -1;
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      if (t !== frameT) {
        if (frameT >= 0) window.__cost.push(acc);
        if (last >= 0) window.__gap.push(t - last);
        last = t;
        frameT = t;
        acc = 0;
      }
      const a = performance.now();
      try {
        cb(t);
      } finally {
        acc += performance.now() - a;
      }
    });
};

function stats(d) {
  const s = [...d].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const mean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
  return { n: d.length, mean: +mean.toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(1) };
}

async function one(browser, base, label) {
  const context = await phoneContext(browser, size);
  await context.addInitScript(TIMER);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/dev.html?game=icy&seed=4&duration=${dur}`);
  await page.waitForFunction(() => !!window.__icy, null, { timeout: 20000 });
  await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const touch = await createTouch(context, page);
  await page.evaluate(() => {
    window.__cost.length = 0;
    window.__gap.length = 0;
  });
  const r = await playIcy(page, touch, SIZES[size], 'bounce', 7);
  const d = await page.evaluate(() => ({ cost: window.__cost.slice(5), gap: window.__gap.slice(5) }));
  await context.close();
  const gap = stats(d.gap);
  const cost = stats(d.cost);
  const out = { label, score: r.score, best: r.bestFloor, frames: gap.n, gapMean: gap.mean, gapP50: gap.p50, gapP95: gap.p95, gapP99: gap.p99, over25: +((d.gap.filter((v) => v > 25).length / Math.max(1, d.gap.length)) * 100).toFixed(1), costMean: cost.mean, costP50: cost.p50, costP95: cost.p95, costP99: cost.p99, costMax: cost.max, errors: errors.length };
  console.log(JSON.stringify(out));
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const res = { old: [], new: [] };
  for (let i = 0; i < pairs; i++) {
    res.old.push(await one(browser, OLD, 'old'));
    res.new.push(await one(browser, NEW, 'new'));
  }
  const med = (list, k) => [...list.map((r) => r[k])].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  for (const k of ['old', 'new']) {
    console.log('MEDIAN', k, JSON.stringify({ frames: med(res[k], 'frames'), gapMean: med(res[k], 'gapMean'), gapP95: med(res[k], 'gapP95'), gapP99: med(res[k], 'gapP99'), over25: med(res[k], 'over25'), costMean: med(res[k], 'costMean'), costP95: med(res[k], 'costP95'), costP99: med(res[k], 'costP99') }));
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
