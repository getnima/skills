// icy art: CPU cost of every frame, old look against new look, on EXACTLY the same game frames.
// The virtual clock of look-icy.cjs (one fixed step per frame) and its deterministic bot drive both
// trees through the same 1800 steps; the real time spent inside each frame's callbacks (update +
// draw) is recorded with the real clock. CPU throttled 4x, 390x844, runs interleaved old / new so
// the noise of a shared machine falls on both.
//   node tests/e2e/icy-art-cost.cjs [pairs=3] [frames=1800]
// Old tree: QA_OLD (default http://localhost:5282); new tree: QA_BASE (default http://localhost:5281).
const { chromium } = require('playwright');
const { phoneContext, sleep } = require('./qa-icy-lib.cjs');
const NEW = process.env.QA_BASE || 'http://localhost:5281';
const OLD = process.env.QA_OLD || 'http://localhost:5282';
const pairs = Number(process.argv[2] || 3);
const FRAMES = Number(process.argv[3] || 1800);

const CLOCK = () => {
  const real = performance.now.bind(performance);
  const STEP = 1000 / 60;
  let vt = 1000;
  performance.now = () => vt;
  const q = new Map();
  let id = 0;
  let frame = 0;
  window.__cost = [];
  window.__vt = { get frame() { return frame; } };
  const pump = () => {
    const cbs = [...q.values()];
    q.clear();
    const live = !!window.__icy;
    if (live) {
      vt += STEP;
      frame++;
      if (window.__vtInput) {
        try {
          window.__vtInput(frame);
        } catch (e) {
          console.error(e);
        }
      }
    }
    const a = real();
    for (const cb of cbs) {
      try {
        cb(vt);
      } catch (e) {
        console.error(e);
      }
    }
    if (live) window.__cost.push(real() - a);
    setTimeout(pump, 0);
  };
  window.requestAnimationFrame = (cb) => {
    id++;
    q.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (n) => q.delete(n);
  setTimeout(pump, 0);
};

const BOT = () => {
  let held = 0;
  const pe = (type, x, y) => {
    const c = document.querySelector('.pa-stage-game canvas');
    if (!c) return;
    c.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  };
  window.__vtInput = (frame) => {
    const d = window.__icy;
    if (!d || window.__party.ended) return;
    const s = d.state;
    if (s.mode !== 'run') return;
    let want = s.vx < -40 ? -1 : s.vx > 40 ? 1 : held || 1;
    if (frame % 400 > 380) want = 0;
    if (want === held) return;
    const w = innerWidth;
    const h = innerHeight;
    if (held !== 0) pe('pointerup', held < 0 ? w * 0.2 : w * 0.8, h * 0.6);
    held = want;
    if (want !== 0) pe('pointerdown', want < 0 ? w * 0.2 : w * 0.8, h * 0.6);
  };
};

function stats(d) {
  const s = [...d].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { n: d.length, mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(3), p50: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(1), over16: d.filter((v) => v > 16.7).length };
}

async function one(browser, base, label) {
  const context = await phoneContext(browser, '390x844');
  await context.addInitScript(CLOCK);
  await context.addInitScript(BOT);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/dev.html?game=icy&seed=4&duration=${Math.round((FRAMES / 60) * 1000) + 5000}`);
  await page.waitForFunction(() => !!window.__icy, null, { timeout: 60000, polling: 100 });
  await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (;;) {
    const n = await page.evaluate(() => window.__cost.length);
    if (n >= FRAMES) break;
    await sleep(250);
  }
  const d = await page.evaluate((n) => window.__cost.slice(10, n), FRAMES);
  const hook = await page.evaluate(() => document.querySelector('.pa-stage-game canvas')?.dataset.icy);
  await context.close();
  const st = stats(d);
  const out = { label, hook, ...st, errors: errors.length };
  console.log(JSON.stringify(out));
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const res = { old: [], new: [] };
  for (let i = 0; i < pairs; i++) {
    const first = i % 2 === 0 ? ['old', OLD] : ['new', NEW];
    const second = i % 2 === 0 ? ['new', NEW] : ['old', OLD];
    res[first[0]].push(await one(browser, first[1], first[0]));
    res[second[0]].push(await one(browser, second[1], second[0]));
  }
  const med = (list, k) => [...list.map((r) => r[k])].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  for (const k of ['old', 'new']) console.log('MEDIAN', k, JSON.stringify({ mean: med(res[k], 'mean'), p50: med(res[k], 'p50'), p90: med(res[k], 'p90'), p95: med(res[k], 'p95'), p99: med(res[k], 'p99'), over16: med(res[k], 'over16') }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
