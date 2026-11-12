// QA look: screenshots of icy / flappy on every phone size (dev harness).
//   PARTY_CLIENT_PORT=5222 npx vite    then    node tests/e2e/qa-icy-look.cjs [icy|flappy] [tag]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.env.QA_BASE || 'http://localhost:5222';
const GAME = process.argv[2] || 'icy';
const TAG = process.argv[3] || 'look';
const OUT = path.join(__dirname, 'out', GAME === 'icy' ? 'qa-icy' : 'qa-flappy', TAG);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIZES = [
  { name: '320x568', w: 320, h: 568, mobile: true },
  { name: '375x667', w: 375, h: 667, mobile: true },
  { name: '390x844', w: 390, h: 844, mobile: true },
  { name: '430x932', w: 430, h: 932, mobile: true },
  { name: '360x640', w: 360, h: 640, mobile: true },
  { name: '412x915', w: 412, h: 915, mobile: true },
  { name: '844x390', w: 844, h: 390, mobile: true },
];

(async () => {
  const browser = await chromium.launch();
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}/dev.html?game=${GAME}&seed=3&duration=75000`);
    await page.waitForSelector('.pa-stage-game canvas');
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, `${s.name}-a.png`) });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
    // a little play: hold right 1.2s, then left 1s
    if (GAME === 'icy') {
      await touch('touchStart', s.w * 0.8, s.h * 0.6);
      await sleep(1200);
      await page.screenshot({ path: path.join(OUT, `${s.name}-b.png`) });
      await touch('touchEnd');
      await touch('touchStart', s.w * 0.2, s.h * 0.6);
      await sleep(1000);
      await touch('touchEnd');
    } else {
      for (let i = 0; i < 6; i++) {
        await touch('touchStart', s.w * 0.5, s.h * 0.6);
        await touch('touchEnd');
        await sleep(330);
      }
      await page.screenshot({ path: path.join(OUT, `${s.name}-b.png`) });
    }
    await sleep(2500);
    await page.screenshot({ path: path.join(OUT, `${s.name}-c.png`) });
    const l = await page.evaluate(() => {
      window.scrollTo(0, 200);
      const de = document.documentElement;
      return { scrollY: window.scrollY, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight, icy: document.querySelector('.pa-stage-game canvas')?.dataset.icy };
    });
    console.log(s.name, JSON.stringify(l), errors.length ? errors : '');
    await ctx.close();
  }
  await browser.close();
})();
