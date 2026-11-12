// qa-tv-timing: the round-winner ceremony lands on results.revealAt (server time), also after
// a TV reload during the suspense and after a cutscene that pushed revealAt; "replay" works;
// the victory song starts once per ceremony, stops when the host moves on and never plays
// under the final song.
//
//   PARTY_SERVER_PORT=8813 PARTY_TEST_DURATION_MS=20000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8813 PARTY_CLIENT_PORT=5213 npx vite
//   node tests/e2e/qa-tv-timing.cjs
const { chromium } = require('playwright');
const path = require('path');
const { sleep, outDir, checker, openHost, state, waitPhase, waitCut, scriptedPhones, BASE } = require('./qa-tv-lib.cjs');

const { check, failures } = checker();
const dir = outDir('timing');
const TOL = 200; // ms; a frame or two on a loaded machine

/** Install an observer: server time at which the blackout (the reveal beat) first appears. */
const watchReveal = (page) =>
  page.evaluate(() => {
    window.__revealSeen = null;
    const look = () => {
      if (window.__revealSeen === null && document.querySelector('.sh-results--blackout, .sh-results--ceremony')) {
        window.__revealSeen = window.__host.now();
        return true;
      }
      return false;
    };
    const tick = () => {
      if (!look()) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const revealSeen = (page) => page.waitForFunction(() => window.__revealSeen, null, { timeout: 30000 }).then((h) => h.jsonValue());
const music = (page) => page.evaluate(() => ({ victory: window.__partyMusic.started.filter((n) => n === 'victory').length, final: window.__partyMusic.started.filter((n) => n === 'final').length, vPlaying: window.__partyMusic.playing('victory'), fPlaying: window.__partyMusic.playing('final') }));

async function endRoundNow(page) {
  await page.keyboard.press('KeyE');
  await sleep(600);
  await page.keyboard.press('KeyE');
  await waitPhase(page, 'results', 8000);
}

(async () => {
  const browser = await chromium.launch();
  let phones = null;
  try {
    let { page, errors, code, ctx } = await openHost(browser);
    await page.mouse.click(960, 300);
    phones = await scriptedPhones(code, ['דנה', 'Yossi', 'מיכל'], (i, t) => (t / 30) * (i + 1));
    await page.waitForFunction(() => window.__host.state().players.length === 3);
    await sleep(1700);

    // ── 1. plain round: the ceremony lands on revealAt ──
    await page.keyboard.press('KeyN');
    await waitPhase(page, 'playing', 20000);
    await sleep(3000);
    await watchReveal(page);
    await endRoundNow(page);
    let st = await state(page);
    let seen = await revealSeen(page);
    check(Math.abs(seen - st.results.revealAt) < TOL, `ceremony lands on revealAt (off by ${Math.round(seen - st.results.revealAt)} ms)`);
    await sleep(2500);
    let mu = await music(page);
    check(mu.victory === 1 && mu.vPlaying, `victory song started once and is playing (${JSON.stringify(mu)})`);
    await page.screenshot({ path: path.join(dir, '01-ceremony.png') });

    // ── 2. replay: R brings the reveal back 5 s later, the song starts once more ──
    await page.waitForSelector('.sh-results--standings', { timeout: 20000 });
    await watchReveal(page);
    const rAt = await page.evaluate(() => window.__host.now());
    await page.keyboard.press('KeyR');
    seen = await revealSeen(page);
    check(Math.abs(seen - (rAt + 5000)) < 400, `replay: the reveal comes again about 5 s later (${Math.round(seen - rAt)} ms)`);
    await sleep(2000);
    mu = await music(page);
    check(mu.victory === 2 && mu.vPlaying, `replay: the song starts exactly once more (${JSON.stringify(mu)})`);
    await page.waitForFunction(() => !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 30000 });
    await page.keyboard.press('Space');
    await waitPhase(page, 'lobby', 5000);
    await sleep(1200);
    mu = await music(page);
    check(!mu.vPlaying, `moving on to the lobby stops the victory song (${JSON.stringify(mu)})`);

    // ── 3. reload during the suspense: still lands on revealAt ──
    await sleep(600);
    await page.keyboard.press('KeyN');
    await waitPhase(page, 'playing', 20000);
    await sleep(3000);
    await endRoundNow(page);
    st = await state(page);
    await sleep(Math.max(0, st.results.revealAt - (await page.evaluate(() => window.__host.now())) - 4500));
    await page.reload();
    await page.waitForFunction(() => window.__host && window.__host.state() && window.__host.state().phase === 'results', null, { timeout: 15000 });
    await watchReveal(page);
    seen = await revealSeen(page);
    st = await state(page);
    check(Math.abs(seen - st.results.revealAt) < TOL, `after a TV reload mid-suspense the ceremony still lands on revealAt (off by ${Math.round(seen - st.results.revealAt)} ms)`);
    await page.mouse.click(960, 300);
    await sleep(2500);
    mu = await music(page);
    check(mu.victory === 1 && mu.vPlaying, `after the reload the song plays once (${JSON.stringify(mu)})`);

    // ── 4. a cutscene during the suspense pushes revealAt; the ceremony follows it ──
    await page.waitForFunction(() => !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 30000 });
    await page.keyboard.press('Space');
    await waitPhase(page, 'lobby', 5000);
    await sleep(1700);
    await page.keyboard.press('KeyN');
    await waitPhase(page, 'playing', 20000);
    await sleep(3000);
    await endRoundNow(page);
    const before = (await state(page)).results.revealAt;
    await sleep(1500);
    await watchReveal(page);
    await page.keyboard.press('KeyC');
    await page.click('[data-testid=cm-play-joker_1]');
    await waitCut(page, true);
    await waitCut(page, false, 20000);
    const after = (await state(page)).results.revealAt;
    check(after - before > 3000, `the cutscene pushed revealAt by ${after - before} ms`);
    seen = await revealSeen(page);
    check(Math.abs(seen - after) < TOL, `the ceremony lands on the pushed revealAt (off by ${Math.round(seen - after)} ms)`);

    // ── 5. final: the victory song is gone before the champion song ──
    await sleep(1500);
    await page.click('[data-testid=btn-final]').catch(async () => {
      // results phase: the podium is reached from the lobby
      await page.waitForFunction(() => !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 30000 });
      await page.keyboard.press('Space');
      await waitPhase(page, 'lobby', 5000);
      await page.click('[data-testid=btn-final]');
    });
    await waitPhase(page, 'final', 8000);
    await page.waitForFunction(() => window.__partyMusic.started.includes('final'), null, { timeout: 40000 });
    mu = await music(page);
    check(mu.fPlaying && !mu.vPlaying, `the champion song plays alone (${JSON.stringify(mu)})`);
    await page.screenshot({ path: path.join(dir, '02-final.png') });
    await page.click('[data-testid=btn-lobby]');
    await waitPhase(page, 'lobby', 5000);
    await sleep(1000);
    mu = await music(page);
    check(!mu.fPlaying, 'leaving the podium stops the champion song');
    check(errors.length === 0, 'no console errors', errors);
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    if (phones) phones.stop();
    await browser.close();
  }
  console.log(failures.length === 0 ? 'qa-tv-timing: ALL OK' : `qa-tv-timing: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
