// icy LOOK pass: gameplay proof, frame-time measurement and burst screenshots.
//   PARTY_CLIENT_PORT=5281 PARTY_SERVER_PORT=8881 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/look-icy.cjs proof            same seed → level hash + raw score of a fixed-input bot
//                                                 (virtual clock: exactly one game step per frame, so the
//                                                 run is bit-for-bit repeatable) on 320x568 and 430x932
//   node tests/e2e/look-icy.cjs perf [runs=3]    frame times at CPU 4x, real touches, bounce bot, 40 s round
//   node tests/e2e/look-icy.cjs shots            burst screenshots into out/look-icy/
//   node tests/e2e/look-icy.cjs sheet <before.png> <after.png>   before / after sheet
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { phoneContext, createTouch, playIcy, SIZES, startFrameRecorder, frameStats, sleep } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5281';
const OUT = path.join(__dirname, 'out', 'look-icy');
fs.mkdirSync(OUT, { recursive: true });
const MODE = process.argv[2] || 'proof';

/**
 * Virtual clock: performance.now() and requestAnimationFrame are replaced so every frame
 * advances game time by exactly one fixed step once the game exists. `window.__vtInput(frame)`
 * runs before the frame's callbacks (the bot dispatches pointer events there).
 */
const VIRTUAL = (hook) => `(() => {
  const STEP = 1000 / 60;
  let vt = 1000;
  performance.now = () => vt;
  const q = new Map(); let id = 0; let frame = 0;
  window.__vt = { get frame() { return frame; } };
  const pump = () => {
    const cbs = [...q.values()]; q.clear();
    if (window['${hook}']) { vt += STEP; frame++; if (window.__vtInput) { try { window.__vtInput(frame); } catch (e) { console.error(e); } } }
    for (const cb of cbs) { try { cb(vt); } catch (e) { console.error(e); } }
    setTimeout(pump, 1);
  };
  window.requestAnimationFrame = (cb) => { id++; q.set(id, cb); return id; };
  window.cancelAnimationFrame = (n) => { q.delete(n); };
  setTimeout(pump, 1);
})();`;

/** In-page bot for the proof: follows the motion, deterministic (reads only game state). */
const ICY_BOT = () => {
  let held = 0;
  const pe = (type, x, y) => {
    const c = document.querySelector('.pa-stage-game canvas');
    if (!c) return;
    c.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  };
  window.__vtInput = (frame) => {
    const d = window.__icy;
    if (!d || window.__party.ended) return;
    const cv = document.querySelector('.pa-stage-game canvas');
    if (cv) window.__lastIcy = cv.dataset.icy + '@' + frame;
    const s = d.state;
    if (s.mode !== 'run') return;
    // follow the motion; let go for 20 frames every 400 (so runs end and restart too)
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

async function proofOne(browser, size, seed, dur) {
  const context = await phoneContext(browser, size);
  await context.addInitScript(VIRTUAL('__icy'));
  // the bot is installed before the page loads, so it acts from the very first game frame
  await context.addInitScript(ICY_BOT);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/dev.html?game=icy&seed=${seed}&duration=${dur}`);
  await page.waitForFunction(() => !!window.__icy, null, { timeout: 20000 });
  let hook = null;
  let level = null;
  for (;;) {
    const r = await page.evaluate(() => {
      const c = document.querySelector('.pa-stage-game canvas');
      return { ended: window.__party.ended, hook: c ? c.dataset.icy : null, level: c ? c.dataset.level : null, score: window.__party.score, frame: window.__vt.frame };
    });
    if (r.hook) hook = r.hook;
    if (r.level) level = r.level;
    if (r.ended) {
      const last = await page.evaluate(() => window.__lastIcy);
      await context.close();
      return { size, seed, level, hook: last, score: r.score, frames: r.frame, errors };
    }
    await sleep(200);
  }
}

async function proof() {
  const browser = await chromium.launch();
  const out = [];
  for (const size of ['320x568', '430x932']) for (const seed of [4, 11]) out.push(await proofOne(browser, size, seed, 30000));
  for (const r of out) console.log(JSON.stringify(r));
  await browser.close();
}

async function perfOne(browser, i) {
  const size = '390x844';
  const context = await phoneContext(browser, size);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/dev.html?game=icy&seed=4&duration=40000`);
  await page.waitForFunction(() => !!window.__icy, null, { timeout: 15000 });
  await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const touch = await createTouch(context, page);
  await startFrameRecorder(page);
  const r = await playIcy(page, touch, SIZES[size], 'bounce', 7);
  const st = await frameStats(page);
  await context.close();
  return { run: i, score: r.score, runs: r.runs, best: r.bestFloor, frames: st.frames, p50: st.p50, p95: st.p95, p99: st.p99, max: st.max, errors: errors.length };
}

async function perf() {
  const runs = Number(process.argv[3] || 3);
  const browser = await chromium.launch();
  const res = [];
  for (let i = 0; i < runs; i++) {
    const r = await perfOne(browser, i);
    console.log(JSON.stringify(r));
    res.push(r);
  }
  const med = (k) => [...res.map((r) => r[k])].sort((a, b) => a - b)[Math.floor(res.length / 2)];
  console.log('MEDIAN', JSON.stringify({ p50: med('p50'), p95: med('p95'), p99: med('p99') }));
  await browser.close();
}

// ───────────────────────────── screenshots ─────────────────────────────

async function burst(page, name, ms, every = 150) {
  const n = Math.max(1, Math.round(ms / every));
  for (let i = 0; i < n; i++) {
    const t = Date.now();
    await page.screenshot({ path: path.join(OUT, `${name}-${String(i).padStart(2, '0')}.png`) });
    await sleep(Math.max(0, every - (Date.now() - t)));
  }
}

async function shotsFor(browser, size) {
  const context = await phoneContext(browser, size);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const vp = SIZES[size];
  const tag = size;
  const open = async (q) => {
    await page.goto(`${BASE}/dev.html?game=icy&seed=4&duration=75000${q || ''}`);
    await page.waitForFunction(() => !!window.__icy, null, { timeout: 15000 });
    await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
  };
  // 1. start + hint, then a little running
  await open();
  const touch = await createTouch(context, page);
  await burst(page, `${tag}-1-start`, 900, 300);
  await touch.down(1, vp.width * 0.8, vp.height * 0.6);
  await burst(page, `${tag}-2-run`, 1200, 150);
  await touch.up(1);
  // 2. a bounce bot climbs: mid climb, combos, danger line (the bot plays in the background)
  const bot = playIcy(page, touch, vp, 'bounce', 7, { maxMs: 90000 }).catch(() => null);
  const seen = {};
  const t0 = Date.now();
  while (Date.now() - t0 < 26000) {
    const s = await page.evaluate(() => {
      const d = window.__icy;
      if (!d) return null;
      const st = d.state;
      return { mode: st.mode, floor: st.runFloor, margin: st.py + 44 - st.cam, vy: st.vy, hook: document.querySelector('.pa-stage-game canvas').dataset.icy };
    });
    if (!s) break;
    if (!seen.mid && s.floor >= 12) {
      seen.mid = true;
      await burst(page, `${tag}-3-mid`, 900);
    } else if (!seen.combo && s.vy > 1250) {
      seen.combo = true;
      await burst(page, `${tag}-4-combo`, 1200);
    } else if (!seen.danger && s.mode === 'run' && s.margin < 90 && s.floor > 4) {
      seen.danger = true;
      await burst(page, `${tag}-5-danger`, 900);
    } else await sleep(40);
    if (seen.mid && seen.combo && seen.danger) break;
  }
  // 3. freeze and resume
  await page.evaluate(() => window.__party.freeze(1800));
  await sleep(200);
  await burst(page, `${tag}-6-frozen`, 900, 300);
  await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 5000 });
  await burst(page, `${tag}-7-resumed`, 600, 150);
  await page.evaluate(() => window.__party.freeze(100000));
  await bot.catch(() => null);
  // 4. zones: the look-only flag (icyLookZone) paints zone N's mood; gameplay unchanged
  for (const z of [0, 1, 2, 3]) {
    await page.goto(`${BASE}/dev.html?game=icy&seed=4&duration=75000&icyLookFloor=${[0, 25, 50, 75][z]}`);
    await page.waitForFunction(() => !!window.__icy, null, { timeout: 15000 });
    await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
    const t2 = await createTouch(context, page);
    await t2.down(1, vp.width * 0.8, vp.height * 0.6);
    await sleep(500);
    await t2.up(1);
    await t2.down(1, vp.width * 0.2, vp.height * 0.6);
    await burst(page, `${tag}-8-zone${z}`, 600, 300);
    await t2.up(1);
  }
  await context.close();
  return errors;
}

async function shots() {
  const browser = await chromium.launch();
  const sizes = (process.argv[3] || '320x568,390x844,430x932').split(',');
  for (const s of sizes) {
    const errors = await shotsFor(browser, s);
    console.log(s, errors.length ? errors : 'no errors');
  }
  await browser.close();
}

/** Two screenshots side by side with labels (rendered in a page). */
async function sheet(name, pairs) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const imgs = pairs.map(([label, file]) => ({ label, src: 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') }));
  await page.setContent(`<body style="margin:0;background:#150a33;font:800 34px system-ui;color:#fff;display:flex;gap:24px;padding:24px;align-items:flex-start">${imgs
    .map((i) => `<figure style="margin:0;text-align:center"><figcaption style="margin-bottom:12px">${i.label}</figcaption><img src="${i.src}" style="height:900px;border-radius:18px;border:4px solid #ffd23f"></figure>`)
    .join('')}</body>`);
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
  await page.setViewportSize({ width: box.w, height: box.h });
  await page.screenshot({ path: name });
  await browser.close();
}

(async () => {
  if (MODE === 'proof') await proof();
  else if (MODE === 'perf') await perf();
  else if (MODE === 'shots') await shots();
  else if (MODE === 'sheet') {
    const files = process.argv.slice(3);
    await sheet(path.join(OUT, 'before-after.png'), files.map((f, i) => [i < files.length / 2 ? 'לפני' : 'אחרי', f]));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
