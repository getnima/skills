// icy art: a capture sequence of the hero in real play (run, jump, spin on a super jump, land), as a
// filmstrip of crops around the hero. A virtual clock steps the game one fixed step per frame, by hand,
// so every captured picture is an exact game frame; the in-page bot follows the motion (as in look-icy).
//   node tests/e2e/icy-art-capture.cjs [size=390x844] [seed=4]
// Output: tests/e2e/out/icy-art/capture/<size>-NN.png (full frames) and <size>-strip.png (crops).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { phoneContext } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5281';
const size = process.argv[2] || '390x844';
const seed = Number(process.argv[3] || 4);
const OUT = path.join(__dirname, 'out', 'icy-art', 'capture');
fs.mkdirSync(OUT, { recursive: true });

const CLOCK = () => {
  const STEP = 1000 / 60;
  let vt = 1000;
  performance.now = () => vt;
  const q = new Map();
  let id = 0;
  let frame = 0;
  window.__manual = false;
  const run = () => {
    const cbs = [...q.values()];
    q.clear();
    for (const cb of cbs) {
      try {
        cb(vt);
      } catch (e) {
        console.error(e);
      }
    }
  };
  window.__advance = (n) => {
    for (let i = 0; i < n; i++) {
      vt += STEP;
      frame++;
      if (window.__vtInput) window.__vtInput(frame);
      run();
    }
    return frame;
  };
  const pump = () => {
    if (!window.__manual) {
      if (window.__icy) {
        vt += STEP;
        frame++;
        if (window.__vtInput) window.__vtInput(frame);
      }
      run();
    }
    setTimeout(pump, 4);
  };
  window.requestAnimationFrame = (cb) => {
    id++;
    q.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (n) => q.delete(n);
  setTimeout(pump, 4);
};

// the follow-the-motion bot of look-icy.cjs (deterministic: reads only game state)
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

(async () => {
  const browser = await chromium.launch();
  const context = await phoneContext(browser, size);
  await context.addInitScript(CLOCK);
  await context.addInitScript(BOT);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/dev.html?game=icy&seed=${seed}&duration=75000`);
  await page.waitForFunction(() => !!window.__icy, null, { timeout: 20000 });
  await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
  await page.evaluate(() => {
    window.__manual = true;
  });
  const where = () =>
    page.evaluate(() => {
      const s = window.__icy.state;
      const c = document.querySelector('.pa-stage-game canvas');
      const r = c.getBoundingClientRect();
      const playW = Math.min(r.width, Math.max(260, (r.height - 60) * 0.72));
      const scale = playW / 400;
      return { s, x: r.left + (r.width - playW) / 2 + s.x * scale, y: r.top + r.height - (s.py - s.cam) * scale, scale };
    });
  const shots = [];
  const shoot = async (tag) => {
    const w = await where();
    const file = path.join(OUT, `${size}-${String(shots.length).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    shots.push({ file, tag, x: w.x, y: w.y, scale: w.scale });
  };
  // 1. run on the ground: a few frames of the stride
  let st = (await where()).s;
  let guard = 0;
  while (!(st.grounded >= 0 && Math.abs(st.vx) > 260) && guard++ < 600) {
    await page.evaluate(() => window.__advance(1));
    st = (await where()).s;
  }
  for (let i = 0; i < 4; i++) {
    await shoot('run');
    await page.evaluate(() => window.__advance(4));
  }
  // 2. a super jump (spin): wait for one, then every 3rd frame until it lands
  guard = 0;
  st = (await where()).s;
  while (!(st.vy >= 1250 && st.mode === 'run') && guard++ < 5000) {
    await page.evaluate(() => window.__advance(1));
    st = (await where()).s;
  }
  for (let i = 0; i < 14; i++) {
    await shoot(st.grounded >= 0 ? 'land' : st.vy > 0 ? 'up' : 'down');
    await page.evaluate(() => window.__advance(3));
    st = (await where()).s;
    if (st.grounded >= 0 && i > 4) {
      await shoot('land');
      break;
    }
  }
  fs.writeFileSync(path.join(OUT, `${size}-shots.json`), JSON.stringify(shots, null, 1));
  console.log(JSON.stringify({ size, shots: shots.length, tags: shots.map((s) => s.tag).join(','), errors }));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
