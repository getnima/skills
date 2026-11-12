// Art slots of "שימי טאפ", without touching the files in client/public/assets/tap/:
//  1. every slot file exists, is a transparent PNG of the documented size, is light, is
//     requested by the game and no slot falls back to its placeholder;
//  2. with every /assets/tap/ request blocked, every slot falls back to its drawn placeholder
//     and the game still plays (reaches the picking phase, no page errors).
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-slots.cjs
const path = require('path');
const fs = require('fs');
const { chromium, check, fails, sleep, outDir, openGame, tapAt } = require('./qa-tap-lib.cjs');

const DIR = path.join(__dirname, '..', '..', 'client', 'public', 'assets', 'tap');
const HEADS = ['face_normal', 'face_happy', 'face_surprised', 'face_angry', 'face_tongue', 'face_wink', 'face_bored', 'face_proud', 'face_nosepick', 'pick_knuckle', 'pick_deep', 'pick_out', 'pick_big'];
const SMALL = ['hand', 'booger_round', 'booger_stretchy', 'booger_googly', 'booger_hairy', 'booger_golden', 'booger_boss'];

/** width, height, colour type of a PNG (8 = bytes 16..25 of the IHDR chunk). */
function pngInfo(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25], kb: Math.round(b.length / 1024) };
}

async function playFast(page, cdp, ms) {
  const t0 = Date.now();
  let d = null;
  while (Date.now() - t0 < ms) {
    d = await page.evaluate(() => window.__tap());
    tapAt(cdp, [{ x: d.x, y: d.y + 10 }]);
    await sleep(90);
  }
  return page.evaluate(() => window.__tap());
}

(async () => {
  const OUT = outDir('qa-tap');
  // files on disk
  for (const name of [...HEADS, ...SMALL]) {
    const f = path.join(DIR, `${name}.png`);
    const info = fs.existsSync(f) ? pngInfo(f) : null;
    const sizeOk = info && (HEADS.includes(name) ? info.w === 512 && info.h === 512 : Math.max(info.w, info.h) <= 400);
    check(`slot file ${name}.png: transparent PNG, documented size, <= 300 KB`, !!info && info.colorType === 6 && sizeOk && info.kb <= 300, info);
  }
  const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  const undocumented = [...HEADS, ...SMALL].filter((n) => !readme.includes(`${n}.png`));
  check('every slot is documented in client/public/assets/tap/README.md', undocumented.length === 0, undocumented);

  const browser = await chromium.launch();
  // 1. real art
  {
    const { page, cdp, context, errors } = await openGame(browser, 'tap', { viewport: { width: 390, height: 844 }, query: 'seed=4&duration=30000' });
    await page.waitForFunction(() => window.__tap && window.__tap());
    const d = await page.evaluate(() => window.__tap());
    const got = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => decodeURIComponent(new URL(e.name).pathname)).filter((p) => p.startsWith('/assets/tap/')));
    check('real art: no slot uses its placeholder', d.placeholders.length === 0, d.placeholders);
    const missing = [...HEADS, ...SMALL].filter((n) => !got.includes(`/assets/tap/${n}.png`));
    check('real art: every slot file is loaded', missing.length === 0, missing);
    const e = await playFast(page, cdp, 6000);
    check('real art: plays into the picking phase', e.picks >= 1, e.phase);
    await page.screenshot({ path: path.join(OUT, 'slots-1-real-art.png') });
    check('real art: no console errors', errors.length === 0, errors.slice(0, 3));
    await context.close();
  }
  // 2. every file blocked: placeholders
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await context.route('**/assets/tap/**', (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (er) => errors.push('pageerror ' + er.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    const cdp = await context.newCDPSession(page);
    const t0 = Date.now();
    await page.goto(`${process.env.QA_BASE || 'http://localhost:5221'}/dev.html?game=tap&seed=4&duration=30000`);
    await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
    await page.waitForFunction(() => window.__tap && window.__tap(), null, { timeout: 15000 });
    const d = await page.evaluate(() => window.__tap());
    check('blocked art: every slot falls back to its placeholder', d.placeholders.length === HEADS.length + SMALL.length, d.placeholders.length);
    check('blocked art: the game starts without waiting for the files (< 6 s)', Date.now() - t0 < 6000, Date.now() - t0);
    const e = await playFast(page, cdp, 6000);
    check('blocked art: still plays into the picking phase', e.picks >= 1 && e.digs > 0, [e.phase, e.digs]);
    await page.screenshot({ path: path.join(OUT, 'slots-2-placeholders.png') });
    check('blocked art: no page errors', errors.length === 0, errors.slice(0, 3));
    await context.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
