// qa-tv-edge: the TV under nasty situations.
//  A. the lead changes every 250 ms for 12 s: the big effects (screen flash, crown hop,
//     stickers, commentator lines) stay rate limited and no line repeats in the round;
//  B. nobody scores all night: the "nobody" round and a podium that still names one champion;
//  C. the server restarts under the TV: the lost-room banner, one click, a new room.
//
//   PARTY_SERVER_PORT=8813 PARTY_TEST_DURATION_MS=20000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8813 PARTY_CLIENT_PORT=5213 npx vite
//   RESTART_CMD="<command that restarts the server on 8813>" node tests/e2e/qa-tv-edge.cjs
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const { sleep, outDir, checker, openHost, state, waitPhase, waitCut, scriptedPhones } = require('./qa-tv-lib.cjs');

const { check, failures } = checker();
const dir = outDir('edge');

/** Count the big effects from inside the page. */
const FX_PROBE = () => {
  window.__fx = { flash: 0, crown: 0, stickers: 0, lines: [] };
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (...a) {
    const c = typeof this.className === 'string' ? this.className : '';
    if (c.includes('sh-fx-flash')) window.__fx.flash++;
    if (c.includes('sh-crown')) window.__fx.crown++;
    return orig.apply(this, a);
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('sh-sticker')) window.__fx.stickers++;
      if (m.type === 'characterData' || m.type === 'childList') {
        const b = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (b && b.classList && b.classList.contains('sh-comm-bubble')) {
          const t = b.textContent;
          if (t && window.__fx.lines[window.__fx.lines.length - 1] !== t) window.__fx.lines.push(t);
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
};

(async () => {
  const browser = await chromium.launch();
  let phones = null;
  try {
    // ── A. a leader change every 250 ms ──
    {
      const { ctx, page, errors, code } = await openHost(browser);
      phones = await scriptedPhones(code, ['דנה', 'Yossi', 'מיכל', 'Ron', 'שירה', 'Avi'], (i, t) => {
        const turn = Math.floor(t / 250) % 2;
        const base = t / 10;
        return i < 2 ? base + (i === turn ? 40 : 0) : base * (0.3 + i * 0.1);
      });
      await page.evaluate(FX_PROBE);
      await page.mouse.click(960, 40);
      await page.keyboard.press('KeyN');
      await waitPhase(page, 'playing', 20000);
      await sleep(500);
      await page.evaluate(() => (window.__fx = { flash: 0, crown: 0, stickers: 0, lines: [] }));
      await sleep(12000);
      const fx = await page.evaluate(() => window.__fx);
      console.log('   12 s of a new leader every 250 ms:', JSON.stringify({ ...fx, lines: fx.lines.length }));
      console.log('   lines:', fx.lines.join(' | '));
      check(fx.flash <= 12, `screen flashes rate limited (${fx.flash} in 12 s, under 1/s, far from the 3/s photosensitivity line)`);
      check(fx.crown <= 8, `crown hops rate limited (${fx.crown} in 12 s; the leader changed ~48 times)`);
      check(fx.stickers <= 40, `stickers rate limited (${fx.stickers} in 12 s)`);
      check(fx.lines.length <= 6, `commentator lines readable, not a stream (${fx.lines.length} in 12 s)`);
      check(new Set(fx.lines).size === fx.lines.length, 'no line repeats within the round');
      await page.screenshot({ path: path.join(dir, 'A-leader-every-250ms.png') });
      check(errors.length === 0, 'A: no console errors', errors);
      phones.stop();
      phones = null;
      await ctx.close();
    }

    // ── B. nobody scores: the "nobody" ceremony and a podium that everybody shares ──
    {
      const { ctx, page, errors, code } = await openHost(browser);
      phones = await scriptedPhones(code, ['דנה', 'Yossi', 'מיכל', 'Ron'], () => null);
      await page.mouse.click(960, 40);
      await page.keyboard.press('KeyN');
      await waitPhase(page, 'playing', 20000);
      await sleep(1500);
      await page.keyboard.press('KeyE');
      await sleep(700);
      await page.keyboard.press('KeyE');
      await waitPhase(page, 'results', 8000);
      const st = await state(page);
      check(st.results.winnerIds.length === 0, 'nobody scored: no winner');
      await page.waitForSelector('.sh-results--ceremony', { timeout: 15000 });
      await sleep(2500);
      await page.screenshot({ path: path.join(dir, 'B-nobody-ceremony.png') });
      await page.waitForFunction(() => !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 30000 });
      await page.keyboard.press('Space');
      await waitPhase(page, 'lobby', 5000);
      await sleep(1700);
      await page.click('[data-testid=btn-final]');
      await sleep(700);
      await page.click('[data-testid=btn-final]');
      await waitPhase(page, 'final', 5000);
      await waitCut(page, false, 20000);
      await page.waitForSelector('.sh-champ', { timeout: 30000 });
      await sleep(1500);
      const kicker = await page.textContent('.sh-champ-kicker');
      const names = await page.textContent('.sh-champ-name');
      // strict ranks (no ties): everyone on 0 is ordered by the server, and the podium still names ONE champion
      const st0 = await state(page);
      const first = [...st0.players].sort((a, b) => a.rank - b.rank)[0];
      check(!/תיקו/.test(kicker) && !/\+\d/.test(names) && names.trim() === first.name, `everyone on 0: one champion, the server's rank 1 (${kicker} / ${names})`);
      await page.screenshot({ path: path.join(dir, 'B-final-all-zero.png') });
      check(errors.length === 0, 'B: no console errors', errors);
      phones.stop();
      phones = null;

      // ── C. the server restarts under the TV ──
      if (process.env.RESTART_CMD) {
        const before = (await state(page)).code;
        execSync(process.env.RESTART_CMD, { stdio: 'ignore', shell: '/bin/bash' });
        await page.waitForSelector('[data-testid=lost-room]', { timeout: 30000 });
        await sleep(800);
        await page.screenshot({ path: path.join(dir, 'C-lost-room.png') });
        const after = await state(page);
        check(after.code !== before && after.phase === 'lobby', `lost room ${before}: a new room ${after.code} is open at once`);
        const qr = await page.$('[data-testid=qr]');
        check(qr !== null, 'the new room shows its QR');
        await page.click('[data-testid=lost-room] button');
        await sleep(400);
        check((await page.$('[data-testid=lost-room]')) === null, 'one click on "הבנתי" clears the banner');
        await page.screenshot({ path: path.join(dir, 'C-new-room.png') });
      }
      await ctx.close();
    }
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    if (phones) phones.stop();
    await browser.close();
  }
  console.log(failures.length === 0 ? 'qa-tv-edge: ALL OK' : `qa-tv-edge: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
