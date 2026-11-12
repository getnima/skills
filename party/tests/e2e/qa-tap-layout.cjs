// Layout of the tap game at phone sizes (and a phone on its side with a notch): the bands
// (sticker band, token, pile, counter) stay in order below the HUD and above the home
// indicator, the token is a whole circle on screen. Screenshots of the sprint and the final
// frame at each size.
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-layout.cjs
const L = require('./qa-tap-comedy-lib.cjs');
const path = require('path');

const OUT = L.outDir('qa-tap-layout');
const SIZES = [
  { name: '320x568', viewport: { width: 320, height: 568 } },
  { name: '390x844', viewport: { width: 390, height: 844 }, safe: { top: 47, bottom: 34 } },
  { name: '430x932', viewport: { width: 430, height: 932 }, safe: { top: 59, bottom: 34 } },
  { name: '844x390', viewport: { width: 844, height: 390 }, safe: { top: 0, bottom: 21, left: 47, right: 47 } },
];
const DUR = 10600;

(async () => {
  const browser = await L.chromium.launch();
  for (const sz of SIZES) {
    const { page, cdp, context, errors } = await L.openTap(browser, { viewport: sz.viewport, duration: DUR, seed: 12, safe: sz.safe });
    const times = L.steady(9, 400, 4300, 0.2, 2);
    await L.tapSchedule(page, cdp, times);
    await page.waitForFunction(() => window.__tap() && window.__tap().phase === 'done' && window.__tap().beatT > 1, null, { timeout: 20000 });
    await page.addStyleTag({ content: '.pa-veil,.dv-freeze{display:none!important}' });
    await page.screenshot({ path: path.join(OUT, `${sz.name}-final.png`) });
    const s = await L.st(page);
    const l = s.layout;
    const R = s.r;
    console.log(JSON.stringify({ size: sz.name, layout: l, r: R, x: s.x, y: s.y }));
    L.check(`${sz.name}: the token is below the HUD`, s.y - R >= l.top - 1, [s.y - R, l.top]);
    L.check(`${sz.name}: the sticker band is not upside down`, l.bandBottom >= l.bandTop - 0.5, [l.bandTop, l.bandBottom]);
    L.check(`${sz.name}: the token is a whole circle on screen`, s.x - R >= 0 && s.x + R <= l.w && s.y + R <= l.pileTop + 1, [s.x - R, s.x + R, s.y + R, l.pileTop]);
    L.check(`${sz.name}: pile above the counter, counter above the home indicator`, l.pileTop <= l.counterTop && l.counterTop <= l.bottom, [l.pileTop, l.counterTop, l.bottom]);
    L.check(`${sz.name}: no console errors`, errors.length === 0, errors.slice(0, 2));
    await context.close();
  }
  await browser.close();
  console.log(L.fails.length ? `\n${L.fails.length} FAILED: ${L.fails.join(', ')}` : '\nALL OK');
})();
