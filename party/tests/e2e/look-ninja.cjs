// ninja LOOK pass: gameplay proof, frame-time measurement and burst screenshots.
//   PARTY_CLIENT_PORT=5281 PARTY_SERVER_PORT=8881 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/look-ninja.cjs proof           schedule signature + raw score of a fixed-input bot (virtual
//                                                  clock: one game step per frame, bit-for-bit repeatable)
//   node tests/e2e/look-ninja.cjs perf [runs=3]   frame times at CPU 4x, real touches, expert bot, 40 s round
//   node tests/e2e/look-ninja.cjs shots           burst screenshots into out/look-ninja/
//   node tests/e2e/look-ninja.cjs sheet <before...> <after...>
process.env.QA_BASE = process.env.QA_BASE || 'http://localhost:5281';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { openGame, sleep, pct, touch } = require('./qa-tap-lib.cjs');
const BASE = process.env.QA_BASE;
const OUT = path.join(__dirname, 'out', 'look-ninja');
fs.mkdirSync(OUT, { recursive: true });
const MODE = process.argv[2] || 'proof';

/** Virtual clock: one fixed game step per frame once the game exists (see look-icy.cjs). */
const VIRTUAL = `(() => {
  const STEP = 1000 / 60;
  let vt = 1000;
  performance.now = () => vt;
  const q = new Map(); let id = 0; let frame = 0;
  window.__vt = { get frame() { return frame; } };
  const pump = () => {
    const cbs = [...q.values()]; q.clear();
    if (window.__ninja) { vt += STEP; frame++; if (window.__vtInput) { try { window.__vtInput(frame); } catch (e) { console.error(e); } } }
    for (const cb of cbs) { try { cb(vt); } catch (e) { console.error(e); } }
    setTimeout(pump, 1);
  };
  window.requestAnimationFrame = (cb) => { id++; q.set(id, cb); return id; };
  window.cancelAnimationFrame = (n) => { q.delete(n); };
  setTimeout(pump, 1);
})();`;

/** Deterministic in-page bot: every 14 frames a 6-frame horizontal swipe through the lowest fruit (and its row). */
const NINJA_BOT = () => {
  let plan = null;
  let pid = 1;
  const pe = (type, x, y) => {
    const c = document.querySelector('.pa-stage-game canvas');
    if (!c) return;
    c.dispatchEvent(new PointerEvent(type, { pointerId: pid, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  };
  window.__vtInput = (frame) => {
    const d = window.__ninja;
    if (!d || window.__party.ended) return;
    if (plan) {
      const k = frame - plan.f0;
      if (k <= 6) pe('pointermove', plan.ax + ((plan.bx - plan.ax) * k) / 6, plan.y);
      else {
        pe('pointerup', plan.bx, plan.y);
        plan = null;
        pid++;
      }
      return;
    }
    if (frame % 14 !== 0) return;
    const ts = d.targets().filter((t) => t.kind !== 'bomb' && t.y > d.fieldTop + 30 && t.y < innerHeight - 30);
    if (!ts.length) return;
    ts.sort((a, b) => b.y - a.y || a.id - b.id);
    const t = ts[0];
    const row = ts.filter((o) => Math.abs(o.y - t.y) < t.r);
    const minX = Math.min(...row.map((o) => o.x)) - t.r * 1.8;
    const maxX = Math.max(...row.map((o) => o.x)) + t.r * 1.8;
    const ltr = frame % 28 === 0;
    plan = { f0: frame, ax: ltr ? minX : maxX, bx: ltr ? maxX : minX, y: t.y };
    pe('pointerdown', plan.ax, plan.y);
  };
};

async function proofOne(browser, w, h, seed, dur) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(VIRTUAL);
  await context.addInitScript(NINJA_BOT);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/dev.html?game=ninja&seed=${seed}&duration=${dur}`);
  await page.waitForFunction(() => !!window.__ninja, null, { timeout: 20000 });
  const sched = await page.evaluate(() => {
    const s = JSON.stringify(window.__ninja.schedule(1000));
    let hh = 2166136261;
    for (let i = 0; i < s.length; i++) hh = Math.imul(hh ^ s.charCodeAt(i), 16777619) >>> 0;
    return { signature: window.__ninja.signature, throws: window.__ninja.throws, scheduleHash: hh.toString(16) };
  });
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 300000, polling: 300 });
  const n = await page.evaluate(() => {
    const d = window.__ninja;
    return { score: d.score, sliced: d.sliced, golds: d.golds, bombsHit: d.bombsHit, comboBonus: d.comboBonus, launched: d.launched, steps: d.steps, party: window.__party.score };
  });
  await context.close();
  return { size: `${w}x${h}`, seed, ...sched, ...n, errors };
}

async function proof() {
  const browser = await chromium.launch();
  for (const [w, h] of [[320, 568], [430, 932]]) for (const seed of [7, 11]) console.log(JSON.stringify(await proofOne(browser, w, h, seed, 30000)));
  await browser.close();
}

// ───────────────────────────── perf ─────────────────────────────

const RECORD = `(() => {
  const orig = window.requestAnimationFrame.bind(window);
  window.__ft = []; let last = 0;
  const tick = (now) => { if (last) window.__ft.push([now - last, window.__party ? window.__party.leftMs : 0]); last = now; orig(tick); };
  orig(tick);
})();`;

async function perfOne(browser, i, dur) {
  const ninjaBot = require('./qa-ninja-play.cjs');
  const { page, cdp, context, errors } = await openGame(browser, 'ninja', { device: 'iPhone 14', cpu: 4, init: RECORD, query: `seed=11&duration=${dur}` });
  await page.waitForFunction(() => !!window.__ninja);
  await ninjaBot.play('expert', page, cdp, ninjaBot.STRATS.expert, 77);
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 20000 });
  const ft = await page.evaluate(() => window.__ft);
  const score = await page.evaluate(() => window.__party.score);
  await context.close();
  const all = ft.filter(([, left]) => left > 0 && left < dur).map(([d]) => d);
  const busy = ft.filter(([, left]) => left > 0 && left < 15000).map(([d]) => d);
  return { run: i, score, frames: all.length, p50: +pct(all, 50).toFixed(1), p95: +pct(all, 95).toFixed(1), p99: +pct(all, 99).toFixed(1), busyP95: +pct(busy, 95).toFixed(1), busyP99: +pct(busy, 99).toFixed(1), errors: errors.length };
}

async function perf() {
  const runs = Number(process.argv[3] || 3);
  const browser = await chromium.launch();
  const res = [];
  for (let i = 0; i < runs; i++) {
    const r = await perfOne(browser, i, 40000);
    console.log(JSON.stringify(r));
    res.push(r);
  }
  const med = (k) => [...res.map((r) => r[k])].sort((a, b) => a - b)[Math.floor(res.length / 2)];
  console.log('MEDIAN', JSON.stringify({ p50: med('p50'), p95: med('p95'), p99: med('p99'), busyP95: med('busyP95'), busyP99: med('busyP99') }));
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

const targets = (page) => page.evaluate(() => (window.__ninja ? { ts: window.__ninja.targets(), stunned: window.__ninja.stunned, left: window.__party.leftMs, ended: window.__party.ended, top: window.__ninja.fieldTop } : null));

/** A swipe as real touches, one move every ~16 ms like a finger (moves are queued, not awaited one by one). */
async function swipe(page, cdp, id, ax, ay, bx, by, n = 8, onStep) {
  const pend = [touch(cdp, 'touchStart', [{ x: ax, y: ay, id }])];
  for (let i = 1; i <= n; i++) {
    await sleep(16);
    pend.push(touch(cdp, 'touchMove', [{ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n, id }]));
    if (onStep) await onStep(i);
  }
  await sleep(16);
  pend.push(touch(cdp, 'touchEnd', []));
  await Promise.all(pend);
}

async function shotsFor(browser, w, h) {
  const tag = `${w}x${h}`;
  const { page, cdp, context, errors } = await openGame(browser, 'ninja', { viewport: { width: w, height: h }, query: 'seed=11&duration=45000' });
  await page.waitForFunction(() => !!window.__ninja);
  let id = 10;
  const seen = {};
  // the first throw (and the hint)
  await page.waitForFunction(() => window.__ninja.active > 0, null, { timeout: 5000 });
  await sleep(450);
  await burst(page, `${tag}-1-first`, 600, 150);
  for (;;) {
    const st = await targets(page);
    if (!st || st.ended) break;
    const fruit = st.ts.filter((t) => t.kind !== 'bomb' && t.y > st.top + 40 && t.y < h - 60);
    const bombs = st.ts.filter((t) => t.kind === 'bomb');
    const gold = st.ts.find((t) => t.kind === 'gold' && t.y < h - 80);
    if (gold && !seen.gold) {
      seen.gold = true;
      await burst(page, `${tag}-4-gold`, 450, 150);
    }
    const bombAir = bombs.find((b) => b.y > st.top + 60 && b.y < h * 0.7);
    if (bombAir && !seen.bombAir) {
      seen.bombAir = true;
      await burst(page, `${tag}-5-bomb-air`, 450, 150);
      continue;
    }
    if (st.left < 10000 && !seen.last) {
      seen.last = true;
      await burst(page, `${tag}-7-last10`, 600, 150);
    }
    if (st.left < 20000 && !seen.stun && bombAir && Math.abs(bombAir.vy) < 400) {
      seen.stun = true;
      await swipe(page, cdp, id++, bombAir.x - bombAir.r * 1.7, bombAir.y, bombAir.x + bombAir.r * 1.7, bombAir.y, 6);
      await burst(page, `${tag}-6-stun`, 900, 150);
      continue;
    }
    if (st.stunned || fruit.length === 0) {
      await sleep(30);
      continue;
    }
    // the lowest fruit and its row, unless a bomb sits on the line
    fruit.sort((a, b) => b.y - a.y);
    const t = fruit[0];
    const row = fruit.filter((o) => Math.abs(o.y - t.y) < t.r * 1.4).sort((a, b) => a.x - b.x);
    const lead = 0.07;
    const y = t.y + t.vy * lead;
    const ax = row[0].x - t.r * 1.8;
    const bx = row[row.length - 1].x + t.r * 1.8;
    const blocked = bombs.some((b) => Math.abs(b.y - y) < b.r * 2.4 && b.x > ax - b.r && b.x < bx + b.r);
    if (blocked) {
      await sleep(30);
      continue;
    }
    const multi = row.length >= 2 && !seen.multi;
    if (multi) seen.multi = true;
    // mid-swipe: the shot is started while the finger keeps moving (not awaited), so it catches the live trail
    let shotP = null;
    const midShot = async (i) => {
      if (i === 4) shotP = page.screenshot({ path: path.join(OUT, `${tag}-2-multi-mid.png`) });
    };
    await swipe(page, cdp, id++, ax, y, bx, y - 20, multi ? 12 : 8, multi ? midShot : null);
    if (shotP) await shotP;
    if (multi) await burst(page, `${tag}-2-multi`, 450, 150);
    else if (!seen.splat && (await page.evaluate(() => window.__ninja.sliced)) >= 6) {
      seen.splat = true;
      await burst(page, `${tag}-3-splats`, 900, 150);
    }
    if (!seen.freeze && st.left < 30000 && st.left > 25000) {
      seen.freeze = true;
      await page.evaluate(() => window.__party.freeze(1600));
      await sleep(150);
      await burst(page, `${tag}-8-frozen`, 900, 300);
      await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 5000 });
      await burst(page, `${tag}-9-resumed`, 450, 150);
    }
    await sleep(60);
  }
  await context.close();
  return { seen, errors };
}

async function shots() {
  const browser = await chromium.launch();
  const sizes = (process.argv[3] || '320x568,390x844,430x932').split(',');
  for (const s of sizes) {
    const [w, h] = s.split('x').map(Number);
    console.log(s, JSON.stringify(await shotsFor(browser, w, h)));
  }
  await browser.close();
}

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
