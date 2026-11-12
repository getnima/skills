// qa-tv-race: the live race on the TV with many players never lets two rows overlap,
// and never lets a row touch the "rotating places" label, at any moment.
// Scripted phones whose places swap constantly; a burst of screenshots every ~100 ms
// for 6 s, with a geometry check on every one.
//
//   PARTY_SERVER_PORT=8813 PARTY_TEST_FAST=1 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8813 PARTY_CLIENT_PORT=5213 npx vite
//   node tests/e2e/qa-tv-race.cjs            (COUNTS=13,30,60  VIEW=1920x1080  SHOTS=1)
const { chromium } = require('playwright');
const { sleep, outDir, checker, openHost, waitPhase, scriptedPhones, raceGeometry, raceOverlapFrames, startScreencast } = require('./qa-tv-lib.cjs');

const COUNTS = (process.env.COUNTS || '13,30,60').split(',').map(Number);
const [VW, VH] = (process.env.VIEW || '1920x1080').split('x').map(Number);
const SHOTS = process.env.SHOTS !== '0';
const { check, failures } = checker();

(async () => {
  const browser = await chromium.launch();
  try {
    for (const n of COUNTS) {
      const dir = outDir(`race-${n}-${VW}x${VH}`);
      const { ctx, page, errors, code } = await openHost(browser, { viewport: { width: VW, height: VH } });
      const names = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? `Player ${i + 1}` : i % 3 === 1 ? `שחקן ${i + 1}` : `🎉 דנה ${i + 1}`));
      // places swap all the time: everyone grows at a similar pace, with waves that cross
      const phones = await scriptedPhones(code, names, (i, t) => (t / 40) * (1 + 0.35 * Math.sin(t / 650 + i * 1.7)) + (i % 5));
      await page.mouse.click(VW / 2, 40);
      await page.keyboard.press('KeyN');
      await waitPhase(page, 'playing', 20000);
      await sleep(1500);
      const stop = SHOTS ? await startScreencast(page, dir, 100) : null;
      const r = await raceOverlapFrames(page, 6000);
      const frames = stop ? await stop() : 0;
      console.log(`   ${n}: ${r.frames} animation frames checked, ${frames} screenshots, order changed ${r.orders}x`, r.examples.join('; '));
      check(r.bad === 0, `${n} players ${VW}x${VH}: no overlapping rows / label on any of ${r.frames} frames over 6 s`, r.examples);
      check(r.orders >= 3, `${n} players: the board really re-ordered during the burst (${r.orders})`);
      check(!SHOTS || frames >= 30, `${n} players: burst screenshots (${frames} in 6 s, one per compositor frame, at most every 100 ms)`);
      const rowsShown = (await raceGeometry(page)).rows.length;
      check(rowsShown === Math.min(n, n <= 12 ? 12 : 10), `${n} players: ${rowsShown} rows on screen`);
      const l = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight }));
      check(l.sw <= l.w && l.sh <= l.h, `${n} players: no page scroll`, l);
      check(errors.length === 0, `${n} players: no console errors`, errors);
      phones.stop();
      await ctx.close();
    }
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    await browser.close();
  }
  console.log(failures.length === 0 ? 'qa-tv-race: ALL OK' : `qa-tv-race: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
