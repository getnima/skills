// qa-tv-tour: the TV host page through every scene, for several head counts, each scene
// photographed at 1920x1080, 1280x720, 1440x900 (MacBook 16:10) and 3840x2160.
// Scripted phones (tests/e2e/qa-tv-lib.cjs) so the winner case is exact:
//   1 → one winner        2 → two-way tie (and a tie for first on the podium)
//   3 → three-way tie     4 → nobody scored, then a round with a tie for third
//   8 → odd names         13 → 5-digit scores, one far ahead
//   30 → wild jumps       60 → full room
//
// Needs REAL intro / countdown timing (the scenes must last long enough to photograph):
//   PARTY_SERVER_PORT=8813 PARTY_TEST_DURATION_MS=20000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8813 PARTY_CLIENT_PORT=5213 npx vite
//   node tests/e2e/qa-tv-tour.cjs [counts]   e.g. node tests/e2e/qa-tv-tour.cjs 1,2,8
// Screenshots: tests/e2e/out/qa-tv/tour-<count>/.
const { chromium } = require('playwright');
const path = require('path');
const { sleep, outDir, checker, openHost, state, waitPhase, waitCut, scriptedPhones } = require('./qa-tv-lib.cjs');

const SIZES = [
  [1920, 1080],
  [1280, 720],
  [1440, 900],
  [3840, 2160],
];
const COUNTS = (process.argv[2] || '1,2,3,4,8,13,30,60').split(',').map(Number);
const { check, failures } = checker();

const ODD_NAMES = ['אלכסנדרה בן דו', 'Maximilian Abc', '🦄 יוני', '🔥🔥🔥', 'דנה DJ 2000', 'Mr. כהן', 'דנה', 'דנה'];

function namesFor(n) {
  if (n === 8) return ODD_NAMES;
  return Array.from({ length: n }, (_, i) => (i % 4 === 0 ? `שחקן ${i + 1}` : i % 4 === 1 ? `Guest ${i + 1}` : i % 4 === 2 ? `נועה ${i + 1}` : `😎 טל ${i + 1}`));
}

/** score(i, elapsedMs, roundIndex) per head count. */
function scoreFor(n) {
  switch (n) {
    case 1:
      return (i, t) => t / 50;
    case 2:
    case 3:
      return (i, t) => Math.floor(t / 400) * 7; // everyone the same: a tie
    case 4:
      // round 0: nobody scores; round 1: 100 / 80 / 50 / 50 → a tie for third
      return (i, t, r) => (r === 0 ? null : [100, 80, 50, 50][i] * Math.min(1, t / 8000));
    case 13:
      return (i, t) => (i === 0 ? Math.min(99_999, t * 6) : i < 4 ? 0 : (t / 20) * (i % 5));
    case 30:
      return () => Math.round(Math.random() * 4000);
    default:
      return (i, t) => (t / 30) * (1 + 0.3 * Math.sin(t / 900 + i)) + i;
  }
}

/** Layout checks of one screenshot: no scroll, the scene's text is inside the window and not clipped mid-word. */
const layoutCheck = (page) =>
  page.evaluate(() => {
    const de = document.documentElement;
    const W = innerWidth;
    const H = innerHeight;
    const out = { sw: de.scrollWidth, sh: de.scrollHeight, W, H, outside: [] };
    const sel = '.hs-intro-title, .hs-intro-text, .hs-countdown-num, .sh-cer-name, .sh-cer-kicker, .sh-champ-name, .sh-pod-name, .sh-banner-text, .hs-code, .hs-qr-card, .sh-aside-title, .sh-mystery-text, .sh-nobody-a, .hs-primary, .sh-ring';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // an entrance / exit animation in flight (a pop that overshoots, the ceremony flying out) is not a layout
      let moving = false;
      for (let e = el, d = 0; e && d < 6 && !moving; e = e.parentElement, d++) {
        moving = e.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity);
      }
      if (moving) continue;
      // gone (faded out, kept in the DOM): not on screen
      let op = 1;
      for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      if (op < 0.05) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      if (r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2) out.outside.push(`${el.className} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    // on the podium the commentator's bubble never covers a name or a score
    out.covered = [];
    const bub = document.querySelector('.sh-final .sh-comm.is-on .sh-comm-bubble');
    if (bub) {
      const b = bub.getBoundingClientRect();
      for (const el of document.querySelectorAll('.sh-pod-name, .sh-pod-total, .sh-pod-also')) {
        const r = el.getBoundingClientRect();
        if (Math.min(b.right, r.right) - Math.max(b.left, r.left) > 2 && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 2) out.covered.push(el.textContent);
      }
    }
    // a strip button whose label is cut ("…") is unreadable for the host
    out.cut = [...document.querySelectorAll('.hs-strip-main .hs-btn-label')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
    return out;
  });

(async () => {
  const browser = await chromium.launch();
  try {
    for (const n of COUNTS) {
      console.log(`── ${n} player(s) ──`);
      const dir = outDir(`tour-${n}`);
      const { ctx, page, errors, code } = await openHost(browser, { viewport: { width: 1920, height: 1080 } });
      let k = 0;
      // short scenes (a 3 s countdown) are photographed at fewer sizes; 4K is a JPEG (a 4K PNG takes a second)
      const shoot = async (scene, sizes = SIZES) => {
        k++;
        for (const [w, h] of sizes) {
          await page.setViewportSize({ width: w, height: h });
          await sleep(w > 3000 ? 500 : 350);
          const big = w > 3000;
          await page.screenshot({ path: path.join(dir, `${String(k).padStart(2, '0')}-${scene}-${w}x${h}.${big ? 'jpg' : 'png'}`), type: big ? 'jpeg' : 'png', quality: big ? 80 : undefined });
          const l = await layoutCheck(page);
          check(l.sw <= l.W && l.sh <= l.H && l.outside.length === 0, `${n}p ${scene} ${w}x${h}: no scroll, text inside the screen`, l);
          check(l.cut.length === 0, `${n}p ${scene} ${w}x${h}: no strip label cut short`, l.cut);
          check(l.covered.length === 0, `${n}p ${scene} ${w}x${h}: the commentator covers no podium name`, l.covered);
        }
        await page.setViewportSize({ width: 1920, height: 1080 });
      };
      const phones = await scriptedPhones(code, namesFor(n), scoreFor(n));
      await page.mouse.click(960, 40);
      await page.waitForFunction((x) => window.__host.state().players.length >= x, n, { timeout: 20000 });
      await sleep(900);
      await shoot('lobby');
      if (n === 1 || n === 60) {
        const qr = await page.evaluate(() => {
          const card = document.querySelector('.hs-qr-card').getBoundingClientRect();
          const svg = document.querySelector('[data-testid=qr]');
          const r = svg.getBoundingClientRect();
          const vb = svg.viewBox.baseVal;
          return { card: [Math.round(card.width), Math.round(card.height)], svg: Math.round(r.width), modules: vb.width - 4, modulePx: +(r.width / vb.width).toFixed(1), url: document.querySelector('[data-testid=join-url]').textContent };
        });
        console.log('   QR at 1080p:', JSON.stringify(qr));
        check(qr.modulePx >= 8, `QR modules are at least 8 px at 1080p (${qr.modulePx})`, qr);
      }

      const rounds = n === 4 ? 2 : 1;
      for (let r = 0; r < rounds; r++) {
        // the intro title must be readable on its very first frame: watch for it before starting
        await page.evaluate(() => {
          window.__introFirst = null;
          const look = () => {
            const el = document.querySelector('.hs-intro-title');
            if (!el || window.__introFirst) return false;
            const box = el.closest('.hs-intro');
            const op = (x) => Number(getComputedStyle(x).opacity);
            const r = el.getBoundingClientRect();
            window.__introFirst = { opacity: Math.min(op(el), op(box)), textOpacity: op(el.nextElementSibling), h: Math.round(r.height), text: el.textContent };
            return true;
          };
          const mo = new MutationObserver(() => {
            if (look()) mo.disconnect();
          });
          mo.observe(document.body, { childList: true, subtree: true });
        });
        await page.keyboard.press('KeyN');
        await waitPhase(page, 'intro', 10000);
        const first = await page.evaluate(() => window.__introFirst);
        check(first !== null && first.opacity === 1 && first.textOpacity === 1 && first.h > 50, `${n}p intro: title and instructions readable on the first frame`, first);
        await sleep(800);
        await shoot(`intro-r${r}`, [SIZES[0], SIZES[2], SIZES[1]]);
        await page.waitForFunction(() => ['countdown', 'playing'].includes(window.__host.state().phase), null, { timeout: 15000 });
        if ((await state(page)).phase === 'countdown') {
          await sleep(200);
          await shoot(`countdown-r${r}`, [SIZES[0]]);
        }
        await waitPhase(page, 'playing', 10000);
        await sleep(4000);
        await shoot(`race-r${r}`);
        if (r === 0) {
          // a cutscene freezes the race; after it, the resume 3-2-1
          // an automatic cutscene may be on screen (tap_freeze): let it finish, then play one by hand
          for (let tries = 0; tries < 5; tries++) {
            await waitCut(page, false, 20000);
            await page.keyboard.press('KeyC');
            if (await page.waitForSelector('[data-testid=cm-play-joker_1]', { timeout: 1500 }).catch(() => null)) break;
          }
          await page.click('[data-testid=cm-play-joker_1]');
          await waitCut(page, true);
          await sleep(1200);
          await shoot(`cutscene-r${r}`, [SIZES[0]]);
          await waitCut(page, false, 20000);
          await sleep(300);
          // the frozen race under the 3-2-1
          const frozen = await page.evaluate(() => document.querySelector('.sh-playing').classList.contains('is-frozen') && !!document.querySelector('[data-testid=resume]'));
          check(frozen, `${n}p: race frozen under the resume 3-2-1`);
          await shoot(`resume-r${r}`, [SIZES[0], SIZES[2]]);
        }
        await waitPhase(page, 'results', 40000);
        await sleep(2500);
        await shoot(`suspense-r${r}`);
        const st = await state(page);
        const winners = st.results.winnerIds.length;
        console.log(`   round ${r}: ${winners} winner(s)`);
        await page.waitForFunction(() => document.querySelector('.sh-results--ceremony'), null, { timeout: 15000 });
        await sleep(3500);
        await shoot(`ceremony-r${r}-w${winners}`);
        await page.waitForFunction(() => document.querySelector('.sh-results--standings'), null, { timeout: 20000 });
        await sleep(4500);
        await shoot(`standings-r${r}`);
        await page.keyboard.press('Space');
        await waitPhase(page, 'lobby', 10000);
        await sleep(1700);
        await shoot(`lobby-after-r${r}`);
      }
      // the early podium asks "sure?" first
      await page.click('[data-testid=btn-final]');
      await sleep(700);
      check((await state(page)).phase === 'lobby', `${n}p: one click on the early podium only asks`);
      await page.click('[data-testid=btn-final]');
      await waitPhase(page, 'final', 10000);
      await page.waitForSelector('.sh-champ', { timeout: 30000 });
      await sleep(2500);
      await shoot('final-champion');
      if (n > 3) {
        await sleep(6000);
        await shoot('final-table');
      }
      check(errors.length === 0, `${n}p: no console errors`, errors);
      phones.stop();
      await ctx.close();
    }
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    await browser.close();
  }
  console.log(failures.length === 0 ? 'qa-tv-tour: ALL OK' : `qa-tv-tour: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
