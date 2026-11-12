// tap + ninja on every phone size (and landscape), with the notch / home indicator insets of
// an iPhone where it has them. Screenshots of the key moments into out/qa-tap and out/qa-ninja.
// Checks: no page scroll, nothing important under the HUD or the home indicator, targets
// >= 56 px on every size, no crash in landscape.
//   node tests/e2e/qa-tap-sizes.cjs [tap|ninja|both]
const path = require('path');
const { chromium, check, fails, sleep, outDir, openGame, tapAt } = require('./qa-tap-lib.cjs');
const WHICH = process.argv[2] || 'both';
const HUD_ROW = 66; // HUD_ROW_PX in client/src/play/stage.ts (ninja checks; tap reads its hudTop from window.__tap)

const SIZES = [
  { name: '320x568', viewport: { width: 320, height: 568 } },
  { name: '375x667', viewport: { width: 375, height: 667 } },
  { name: '390x844', viewport: { width: 390, height: 844 }, safe: { top: 47, bottom: 34 } },
  { name: '430x932', viewport: { width: 430, height: 932 }, safe: { top: 59, bottom: 34 } },
  { name: '360x640', viewport: { width: 360, height: 640 } },
  { name: '412x915', viewport: { width: 412, height: 915 }, safe: { top: 24, bottom: 16 } },
  { name: 'land844x390', viewport: { width: 844, height: 390 }, safe: { left: 47, right: 47, bottom: 21 } },
];

const noScroll = (page) =>
  page.evaluate(() => {
    window.scrollTo(0, 300);
    const de = document.documentElement;
    return { y: window.scrollY, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight };
  });

async function tapSize(browser, sz) {
  const OUT = outDir('qa-tap');
  const { page, cdp, context, errors } = await openGame(browser, 'tap', { viewport: sz.viewport, safe: sz.safe, query: 'seed=4&duration=16000' });
  await page.waitForFunction(() => window.__tap && window.__tap());
  const first = await page.evaluate(() => window.__tap());
  const hud = first.hudTop;
  const bottom = sz.viewport.height - (sz.safe?.bottom || 0);
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, `size-${sz.name}-1-start.png`) });
  const start = await page.evaluate(() => window.__tap());
  check(`tap ${sz.name}: the doll's hand is visible at the start (fingertip between the HUD and the tray)`, start.handY !== null && start.handY > hud && start.handY < start.trayTop, [start.handY, hud, start.trayTop]);
  const samples = [];
  let pickShot = false;
  let frenzyShot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 14500) {
    const d = await page.evaluate(() => window.__tap && window.__tap());
    if (!d) break;
    samples.push(d);
    if (d.phase === 'picking' && d.digs > 2 && !pickShot) {
      pickShot = true;
      await page.screenshot({ path: path.join(OUT, `size-${sz.name}-2-picking.png`) });
    }
    if (d.frenzy && !frenzyShot) {
      frenzyShot = true;
      await sleep(250);
      await page.screenshot({ path: path.join(OUT, `size-${sz.name}-3-frenzy.png`) });
    }
    tapAt(cdp, [{ x: d.x, y: d.y + d.r * 0.3 }]);
    await sleep(85);
  }
  const bad = samples.filter((d) => d.y - d.r < hud - 1 || d.y + d.r > d.trayTop || d.trayTop > bottom - 50 || d.x - d.r < 0 || d.x + d.r > sz.viewport.width);
  const minR = Math.min(...samples.map((d) => d.r));
  check(`tap ${sz.name}: the head target is inside the play area (below the HUD ${hud}px, above the tray and the home bar)`, bad.length === 0, bad.slice(0, 2).map((d) => ({ x: d.x | 0, y: d.y | 0, r: d.r | 0, tray: d.trayTop | 0 })));
  check(`tap ${sz.name}: head target at least 56 px wide (min diameter ${Math.round(minR * 2)})`, minR * 2 >= 56);
  const l = await noScroll(page);
  check(`tap ${sz.name}: no page scroll`, l.y === 0 && l.sw <= l.iw && l.sh <= l.ih, l);
  check(`tap ${sz.name}: reached the picking phase`, pickShot);
  check(`tap ${sz.name}: no console errors`, errors.length === 0, errors.slice(0, 3));
  await context.close();
}

async function ninjaSize(browser, sz) {
  const OUT = outDir('qa-ninja');
  const { page, context, errors } = await openGame(browser, 'ninja', { viewport: sz.viewport, safe: sz.safe, query: 'seed=4&duration=24000' });
  await page.waitForFunction(() => !!window.__ninja);
  const hud = HUD_ROW + (sz.safe?.top || 0);
  const bottom = sz.viewport.height - (sz.safe?.bottom || 0);
  await sleep(1300);
  await page.screenshot({ path: path.join(OUT, `size-${sz.name}-1-start.png`) });
  let minR = 1e9;
  const hidden = [];
  let bombShot = false;
  let tenShot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 22000) {
    const st = await page.evaluate(() => ({ ts: window.__ninja.targets(), left: window.__party.leftMs, top: window.__ninja.fieldTop }));
    for (const t of st.ts) {
      minR = Math.min(minR, t.r);
      // at its peak a throw must be visible below the HUD and inside the screen sides
      if (Math.abs(t.vy) < 40 && (t.y - t.r * 0.6 < hud || t.x < 0 || t.x > sz.viewport.width)) hidden.push({ k: t.kind, x: t.x | 0, y: t.y | 0 });
    }
    if (!bombShot && st.ts.some((t) => t.kind === 'bomb' && t.y < bottom - 200) && st.ts.length >= 3) {
      bombShot = true;
      await page.screenshot({ path: path.join(OUT, `size-${sz.name}-2-bomb.png`) });
    }
    if (!tenShot && st.left < 9600 && st.left > 8000) {
      tenShot = true;
      await sleep(200);
      await page.screenshot({ path: path.join(OUT, `size-${sz.name}-3-last10.png`) });
    }
    await sleep(40);
  }
  check(`ninja ${sz.name}: targets at least 56 px wide (min ${Math.round(minR * 2)})`, minR * 2 >= 56);
  check(`ninja ${sz.name}: every throw is visible at its peak (not under the HUD ${hud}px)`, hidden.length === 0, hidden.slice(0, 3));
  const l = await noScroll(page);
  check(`ninja ${sz.name}: no page scroll`, l.y === 0 && l.sw <= l.iw && l.sh <= l.ih, l);
  check(`ninja ${sz.name}: no console errors`, errors.length === 0, errors.slice(0, 3));
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const sz of SIZES) {
    if (WHICH !== 'ninja') await tapSize(browser, sz);
    if (WHICH !== 'tap') await ninjaSize(browser, sz);
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
