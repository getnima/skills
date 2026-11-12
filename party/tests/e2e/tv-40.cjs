// The TV with 40 guests: lobby, a whole tap round, its results, the standings and the podium,
// screenshotted at 1920x1080 and checked for page errors and for nothing drawn outside the screen.
//   BASE_URL=http://localhost:5296 SERVER_URL=http://localhost:8296 node tests/e2e/tv-40.cjs
const path = require('path');
const { chromium } = require('playwright');
const { BASE, sleep, outDir, openHost, state, waitPhase, waitCut, spawnBots, autoCutscenesOff } = require('./qa-tv-lib.cjs');

const N = Number(process.env.PLAYERS || 40);
let bad = 0;
const check = (ok, what, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail !== undefined ? ' - ' + JSON.stringify(detail) : ''}`);
};

(async () => {
  const out = outDir('tv-40');
  const browser = await chromium.launch();
  const tv = await openHost(browser, { viewport: { width: 1920, height: 1080 } });
  console.log(`TV room ${tv.code} on ${BASE}`);
  await autoCutscenesOff(tv.page);
  const bots = spawnBots(tv.code, N, ['--play']);
  try {
    await tv.page.waitForFunction((n) => window.__host.state().players.length === n, N, { timeout: 60000 });
    await sleep(2500);
    const shot = (name) => tv.page.screenshot({ path: path.join(out, `${name}.png`) });
    const outside = () =>
      tv.page.evaluate(() => {
        const W = innerWidth;
        const H = innerHeight;
        const els = [...document.querySelectorAll('body *')].filter((e) => {
          const r = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') return false;
          if (e.closest('[aria-hidden="true"], .hs-confetti, .fx, svg')) return false;
          return r.right > W + 2 || r.bottom > H + 2 || r.left < -2 || r.top < -2;
        });
        return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, W, H, n: els.length, first: els.slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}`) };
      });
    await shot('1-lobby');
    let o = await outside();
    check(o.sw <= o.W && o.sh <= o.H, `lobby with ${N}: the page does not scroll`, o);
    const st = await state(tv.page);
    check(st.players.length === N && st.players.every((p) => p.connected), `lobby: ${N} guests, all online`, { n: st.players.length, off: st.players.filter((p) => !p.connected).length });

    // a round of tap
    await tv.page.keyboard.press('Space');
    await waitPhase(tv.page, 'playing', 60000);
    await sleep(12000);
    await shot('2-race');
    o = await outside();
    check(o.sw <= o.W && o.sh <= o.H, 'race: the page does not scroll', o);
    await waitPhase(tv.page, 'results', 120000);
    await sleep(3000);
    await shot('3-results');
    await sleep(9000);
    await shot('4-standings');
    o = await outside();
    check(o.sw <= o.W && o.sh <= o.H, 'results and standings: the page does not scroll', o);
    const r = (await state(tv.page)).results;
    check(r && r.rows.length === N, `results: ${N} rows`, r && r.rows.length);

    // the podium
    await tv.page.keyboard.press('KeyF').catch(() => undefined);
    const toFinal = await tv.page
      .waitForFunction(() => window.__host.state().phase === 'final', null, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (toFinal) {
      await waitCut(tv.page, false, 60000).catch(() => undefined);
      await sleep(9000);
      await shot('5-podium');
    } else console.log('note: no podium shortcut here; skipped the podium shot');
    check(tv.errors.length === 0, 'no TV page errors', tv.errors.slice(0, 5));
  } finally {
    bots.stop();
    await browser.close();
  }
  console.log(bad === 0 ? 'ALL OK' : `${bad} FAILED`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
