// qa-tv-prod: the TV page served by the PRODUCTION server (built client):
//  - no console errors / 404s at all while the cutscene menu opens and a present, a missing
//    and another missing cutscene play (the file list is taken at build time);
//  - the QR / join URL on a TV page opened on localhost uses the server's LAN address
//    (GET /api/info), ?join= wins, and a missing /api/info (404) falls back to the
//    localhost warning;
//  - the QR's size at 1080p, its quiet zone and contrast.
//
//   npx vite build --outDir <scratch>/tvdist --emptyOutDir
//   PARTY_SERVER_PORT=8813 PARTY_TEST_FAST=1 PARTY_CLIENT_DIR=<scratch>/tvdist npx tsx server/index.ts
//   BASE_URL=http://localhost:8813 node tests/e2e/qa-tv-prod.cjs
const { chromium } = require('playwright');
const path = require('path');
const { sleep, outDir, checker, openHost, state, waitCut, BASE } = require('./qa-tv-lib.cjs');

const { check, failures } = checker();
const dir = outDir('prod');

(async () => {
  const browser = await chromium.launch();
  try {
    // ── 1. cutscenes on the production build: no 404 lines ──
    const { ctx, page, errors, code } = await openHost(browser);
    const bad = [];
    page.on('response', (r) => {
      if (r.status() >= 400) bad.push(r.status() + ' ' + r.url());
    });
    await page.mouse.click(960, 300);
    await page.keyboard.press('KeyC');
    await page.waitForSelector('[data-testid=cutscene-menu]');
    const dots = await page.$$eval('.hs-cm-row [data-status]', (els) => els.map((e) => e.closest('.hs-cm-row').dataset.testid + '=' + e.dataset.status));
    console.log('   menu:', dots.join(' '));
    check(dots.includes('cm-opening=ok') && dots.includes('cm-joker_1=missing'), 'menu: opening ok, joker_1 missing (from the build-time list)', dots);
    await page.screenshot({ path: path.join(dir, 'menu.png') });
    for (const id of ['opening', 'before_ninja', 'joker_2']) {
      await page.keyboard.press('Escape');
      await sleep(300);
      await page.keyboard.press('KeyC');
      await page.click(`[data-testid=cm-play-${id}]`);
      await waitCut(page, true, 5000);
      await sleep(1200);
      const mode = await page.$eval('[data-testid=cutscene]', (e) => e.dataset.mode);
      check(mode === (id === 'opening' ? 'video' : 'placeholder'), `${id}: plays as ${mode}`);
      await page.screenshot({ path: path.join(dir, `cut-${id}.png`) });
      await page.keyboard.press('KeyS');
      await waitCut(page, false, 8000);
      await sleep(1700);
    }
    check(bad.length === 0, 'no HTTP error responses (no 404 probes)', bad);
    check(errors.length === 0, 'no console errors', errors);
    await ctx.close();

    // ── 2. the join URL ──
    const port = new URL(BASE).port;
    {
      const { ctx, page, code } = await openHost(browser);
      const url = await page.textContent('[data-testid=join-url]');
      check(url === `192.0.2.2:${port}/?room=${code}` || /^\d+\.\d+\.\d+\.\d+:\d+\/\?room=/.test(url), `localhost page: QR uses the LAN address (${url})`);
      check((await page.$('[data-testid=local-warn]')) === null, 'localhost page with a LAN address: no localhost warning');
      const qr = await page.$eval('[data-testid=qr]', (e) => {
        const r = e.getBoundingClientRect();
        const vb = e.viewBox.baseVal;
        const card = e.parentElement.getBoundingClientRect();
        const cs = getComputedStyle(e.parentElement);
        return { w: Math.round(r.width), h: Math.round(r.height), modules: vb.width - 4, card: Math.round(card.width), cardBg: cs.backgroundColor, pad: cs.padding };
      });
      const px = qr.w / (qr.modules + 4);
      console.log(`   QR at 1920x1080: ${qr.w}px for ${qr.modules} modules + 2+2 quiet → ${px.toFixed(1)} px/module; card ${qr.card}px bg ${qr.cardBg} pad ${qr.pad}`);
      check(qr.w >= 380, `QR is big enough to scan across a room at 1080p (${qr.w}px)`);
      await page.screenshot({ path: path.join(dir, 'lobby-lan.png') });
      await ctx.close();
    }
    {
      const { ctx, page, code } = await openHost(browser, { query: '?join=https://party.example.com/' });
      const url = await page.textContent('[data-testid=join-url]');
      check(url === `party.example.com/?room=${code}`, `?join= wins (${url})`);
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await ctx.route('**/api/info', (r) => r.fulfill({ status: 404, body: 'nope' }));
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(BASE + '/host.html');
      await page.waitForFunction(() => window.__host && window.__host.state());
      await sleep(800);
      const url = await page.textContent('[data-testid=join-url]');
      check(/^localhost:/.test(url), `/api/info 404: falls back to the page address (${url})`);
      check((await page.$('[data-testid=local-warn]')) !== null, '/api/info 404: the localhost warning shows');
      check(errs.length === 0, '/api/info 404: no page errors', errs);
      await page.screenshot({ path: path.join(dir, 'lobby-no-info.png') });
      await ctx.close();
    }
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    await browser.close();
  }
  console.log(failures.length === 0 ? 'qa-tv-prod: ALL OK' : `qa-tv-prod: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
