// Look of "שימי טאפ": burst screenshots of every key moment on three phone sizes into
// tests/e2e/out/qa-tap-art/. Each moment is caught by freezing the round (the frozen frame is
// exactly the game at that instant), screenshotted, then the round continues.
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-look.cjs [320x568,390x844,430x932]
const path = require('path');
const { chromium, check, fails, sleep, outDir, openGame, tapAt } = require('./qa-tap-lib.cjs');
const OUT = outDir('qa-tap-art');
const SIZES = (process.argv[2] || '320x568,390x844,430x932').split(',');
const SAFE = { '390x844': { top: 47, bottom: 34 }, '430x932': { top: 59, bottom: 34 } };

async function look(browser, size) {
  const [w, h] = size.split('x').map(Number);
  const { page, cdp, context, errors } = await openGame(browser, 'tap', { viewport: { width: w, height: h }, safe: SAFE[size], query: 'seed=4&duration=60000' });
  await page.waitForFunction(() => window.__tap && window.__tap());
  // the freeze is only our camera here: hide the harness banner and the stage's dimming veil
  const hide = await page.addStyleTag({ content: '.dv-freeze,.pa-veil{display:none!important}' });
  const st = () => page.evaluate(() => window.__tap());
  const shots = [];
  async function snap(name, burst = 1) {
    await page.evaluate(() => window.__party.freeze(700));
    await sleep(60);
    for (let i = 0; i < burst; i++) {
      const f = path.join(OUT, `${size}-${name}${burst > 1 ? '-' + i : ''}.png`);
      await page.screenshot({ path: f });
      shots.push(f);
    }
    await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 3000 });
  }
  /** tap every `every` ms until pred; then snap */
  async function until(pred, every, name, timeout = 25000) {
    const t0 = Date.now();
    for (;;) {
      const d = await st();
      if (pred(d)) {
        if (name) await snap(name);
        return d;
      }
      if (Date.now() - t0 > timeout) {
        console.log(size, 'missed', name, JSON.stringify({ phase: d.phase, frame: d.frame, meter: d.meter }));
        return d;
      }
      if (every) tapAt(cdp, [{ x: d.x + 4, y: d.y + d.r * 0.25 }]);
      await sleep(every || 30);
    }
  }
  await sleep(700);
  await snap('01-start-hint');
  await until((d) => d.frame === 'face_bored', 0, '02-bored', 6000);
  await until((d) => d.meter > 0.25, 260, '03-hand-low');
  await until((d) => d.meter > 0.55, 200, '04-hand-mid');
  await until((d) => d.meter > 0.85 || d.phase === 'picking', 150, '05-hand-high');
  await until((d) => d.frame === 'face_nosepick' || d.digs > 0, 110, '06-finger-enters');
  await until((d) => d.frame === 'pick_deep' && d.digs > 3, 100, '07-deep-picking');
  await until((d) => d.bigActive, 100, '');
  await sleep(380);
  await snap('08-big-stretch');
  await until((d) => !d.bigActive, 100, '09-big-pop');
  await until((d) => d.frame === 'pick_out', 0, '10-finger-out', 4000);
  await until((d) => d.frame !== 'pick_out' && d.phase !== 'picking', 0, '11-hand-sinks', 3000);
  // play on: boogers on the glass and the pile after 40 s
  await until((d) => d.elapsedMs > 40000, 105, '12-pile-40s', 60000);
  await until((d) => d.frenzy && d.elapsedMs > 46000, 100, '13-frenzy', 15000);
  // frozen, as the player sees it (the harness' banner stands in for the real freeze screen)
  await hide.evaluate((n) => n.remove());
  await page.evaluate(() => window.__party.freeze(1500));
  await sleep(200);
  await page.screenshot({ path: path.join(OUT, `${size}-14-frozen.png`) });
  shots.push(path.join(OUT, `${size}-14-frozen.png`));
  const d = await st();
  check(`look ${size}: no console errors`, errors.length === 0, errors.slice(0, 3));
  console.log(size, JSON.stringify({ score: d.score, digs: d.digs, big: d.bigBoogers, pile: d.pile, glass: d.glass, shots: shots.length }));
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const s of SIZES) await look(browser, s);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
