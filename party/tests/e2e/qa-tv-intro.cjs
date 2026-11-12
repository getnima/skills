// qa-tv-intro: the intro (and the 3-2-1 after it) is readable from its very first frame,
// even when the intro is short (PARTY_TEST_FAST=1: 1.5 s intro, 1.5 s countdown).
// On the first animation frame the intro is in the DOM, every text element must be
// fully opaque (no fade-in) and on screen; a screenshot is taken right away.
//
//   PARTY_SERVER_PORT=8813 PARTY_TEST_FAST=1 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8813 PARTY_CLIENT_PORT=5213 npx vite
//   node tests/e2e/qa-tv-intro.cjs
const { chromium } = require('playwright');
const path = require('path');
const { sleep, outDir, checker, openHost, waitPhase, scriptedPhones } = require('./qa-tv-lib.cjs');

const { check, failures } = checker();
const dir = outDir('intro');

/** Watch every frame: the first frame `sel` exists, record the effective opacity of its texts. */
const watchFirstFrame = (page, sel, parts) =>
  page.evaluate(
    ({ sel, parts }) => {
      window.__first = null;
      const eff = (el) => {
        let o = 1;
        for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
        return o;
      };
      const tick = () => {
        const root = document.querySelector(sel);
        if (root) {
          window.__first = parts.map((p) => {
            const el = root.querySelector(p);
            if (!el) return { p, missing: true };
            const r = el.getBoundingClientRect();
            return { p, op: +eff(el).toFixed(2), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight };
          });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { sel, parts },
  );

(async () => {
  const browser = await chromium.launch();
  let phones = null;
  try {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
    ]) {
      const { ctx, page, errors, code } = await openHost(browser, { viewport: { width: w, height: h } });
      phones = await scriptedPhones(code, ['דנה', 'Yossi'], (i, t) => t / 30);
      await page.mouse.click(w / 2, 40);
      await watchFirstFrame(page, '[data-testid=intro]', ['.hs-intro-round', '.hs-intro-emoji', '.hs-intro-title', '.hs-howto', '.hs-intro-foot']);
      await page.keyboard.press('KeyN');
      await page.waitForFunction(() => window.__first !== null, null, { timeout: 8000 });
      await page.screenshot({ path: path.join(dir, `${w}x${h}-intro-first.png`) });
      const first = await page.evaluate(() => window.__first);
      for (const f of first) {
        check(!f.missing && f.op >= 0.99, `${w}x${h} intro first frame: ${f.p} fully opaque (${f.op})`, f);
        check(!f.missing && f.top >= 0 && f.bottom <= f.vh && f.h > 0, `${w}x${h} intro first frame: ${f.p} on screen`, f);
      }
      await watchFirstFrame(page, '[data-testid=countdown]', ['.hs-countdown-game', '.hs-countdown-hint']);
      await waitPhase(page, 'countdown', 10000);
      await page.waitForFunction(() => window.__first !== null, null, { timeout: 8000 });
      await page.screenshot({ path: path.join(dir, `${w}x${h}-countdown-first.png`) });
      for (const f of await page.evaluate(() => window.__first)) check(!f.missing && f.op >= 0.99, `${w}x${h} countdown first frame: ${f.p} fully opaque (${f.op})`, f);
      await waitPhase(page, 'playing', 10000);
      check(errors.length === 0, `${w}x${h}: no console errors`, errors);
      phones.stop();
      phones = null;
      await ctx.close();
    }
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    if (phones) phones.stop();
    await browser.close();
  }
  console.log(failures.length === 0 ? 'qa-tv-intro: ALL OK' : `qa-tv-intro: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
