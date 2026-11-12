// Every phone size for icy and flappy, with the notch / home-indicator insets of the
// tall iPhones emulated (CDP Emulation.setSafeAreaInsetsOverride): no page scroll, no
// errors, screenshots of the hint, mid-play and after a fall for a human to look at.
//   PARTY_CLIENT_PORT=5222 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/qa-icy-sizes.cjs [icy|flappy|both]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { phoneContext, createTouch, sleep, SIZES } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5222';
const which = process.argv[2] || 'both';
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
// [size, safe top, safe bottom]
const CASES = [
  ['320x568', 20, 0],
  ['375x667', 20, 0],
  ['390x844', 47, 34],
  ['430x932', 59, 34],
  ['360x640', 24, 0],
  ['412x915', 32, 16],
  ['844x390', 0, 21],
];

async function one(browser, game, [size, top, bottom]) {
  const OUT = path.join(__dirname, 'out', `qa-${game}`, 'sizes');
  fs.mkdirSync(OUT, { recursive: true });
  const context = await phoneContext(browser, size);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, bottom, left: 0, right: 0 } });
  const hook = game === 'icy' ? '__icy' : '__flappy';
  await page.goto(`${BASE}/dev.html?game=${game}&seed=6&duration=40000`);
  await page.waitForFunction((h) => !!window[h], hook, { timeout: 15000 });
  const vp = SIZES[size];
  const touch = await createTouch(context, page);
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, `${size}-1-start.png`) });
  if (game === 'icy') {
    for (let i = 0; i < 6; i++) {
      await touch.down(1, vp.width * (i % 2 ? 0.2 : 0.8), vp.height * 0.6);
      await sleep(450);
      await touch.up(1);
    }
    await page.screenshot({ path: path.join(OUT, `${size}-2-play.png`) });
    await page.waitForFunction(() => window.__icy.state.mode === 'dead', null, { timeout: 25000 }).catch(() => {});
    await sleep(250);
    await page.screenshot({ path: path.join(OUT, `${size}-3-fall.png`) });
  } else {
    for (let i = 0; i < 8; i++) {
      await touch.tap(vp.width / 2, vp.height / 2);
      await sleep(420);
    }
    await page.screenshot({ path: path.join(OUT, `${size}-2-play.png`) });
    await page.waitForFunction(() => window.__flappy.mode === 'dead', null, { timeout: 15000 }).catch(() => {});
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, `${size}-3-fall.png`) });
    const l = await page.evaluate(() => window.__flappy.layout);
    check(`flappy ${size}: field below the HUD, ground above the home indicator`, l.top >= 56 + top - 0.5 || l.top >= vp.height * 0.29, { fieldTop: l.top, hud: 56 + top });
    check(`flappy ${size}: ground above the home indicator`, l.groundTop <= vp.height - bottom - 30, { groundTop: l.groundTop, limit: vp.height - bottom });
  }
  const lay = await page.evaluate(() => {
    window.scrollTo(0, 300);
    const de = document.documentElement;
    return { scrollY: window.scrollY, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight };
  });
  check(`${game} ${size}: no page scroll`, lay.scrollY === 0 && lay.sw <= lay.iw && lay.sh <= lay.ih, lay);
  check(`${game} ${size}: no errors`, errors.length === 0, errors);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const game of which === 'both' ? ['icy', 'flappy'] : [which]) for (const c of CASES) await one(browser, game, c);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
