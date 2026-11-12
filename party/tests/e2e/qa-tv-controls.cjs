// qa-tv-controls: every host control and keyboard shortcut, and that none of them can be
// triggered by accident (double Space, a bounce, a stray E).
//
//   PARTY_SERVER_PORT=8813 PARTY_TEST_DURATION_MS=20000 npx tsx server/index.ts   (real intro / countdown)
//   PARTY_SERVER_PORT=8813 PARTY_CLIENT_PORT=5213 npx vite
//   node tests/e2e/qa-tv-controls.cjs
const { chromium } = require('playwright');
const path = require('path');
const { autoCutscenesOff, sleep, outDir, checker, openHost, state, waitPhase, waitCut, scriptedPhones } = require('./qa-tv-lib.cjs');

const { check, failures } = checker();
const dir = outDir('controls');

(async () => {
  const browser = await chromium.launch();
  let phones = null;
  try {
    const { page, errors, code } = await openHost(browser);
    const phase = async () => (await state(page)).phase;
    const shot = (name) => page.screenshot({ path: path.join(dir, `${name}.png`) });

    // ── sound is blocked until the first click: an obvious banner ──
    const lock = await page.$('[data-testid=audio-lock]');
    check(lock !== null && (await lock.isVisible()), 'sound-blocked banner visible before the first click');
    await shot('01-audio-locked');
    await page.mouse.click(960, 8);
    await sleep(1300);
    check((await page.$('[data-testid=audio-lock]')) === null, 'banner gone after the first click');

    // (the tap game's automatic cutscene would cover the round right when E is tested)
    await autoCutscenesOff(page);
    phones = await scriptedPhones(code, ['דנה', 'Yossi', 'מיכל'], (i, t) => (t / 30) * (i + 1));
    await page.waitForFunction(() => window.__host.state().players.length === 3);
    await sleep(1700);

    // ── Space in the lobby starts the next game ──
    await page.keyboard.press('Space');
    await waitPhase(page, 'intro', 5000);
    check(true, 'Space in the lobby starts the next game');
    const hint = await page.textContent('[data-testid=next-hint]');
    check(/מתחיל לבד/.test(hint), `intro: the strip says what happens next (${hint})`);
    await page.keyboard.press('Space');
    await sleep(400);
    check((await phase()) === 'intro', 'Space during the intro does nothing');

    // ── E in the intro cancels at once; Space right after does not start a game ──
    await sleep(1600);
    await page.keyboard.press('KeyE');
    await waitPhase(page, 'lobby', 5000);
    await page.keyboard.press('Space');
    await sleep(500);
    check((await phase()) === 'lobby', 'Space right after the round was cancelled is ignored (key guard)');
    await sleep(1200);
    await page.keyboard.press('KeyN');
    await waitPhase(page, 'intro', 5000);
    check(true, 'N starts the next game once the guard is over');

    // ── E while playing needs a second press ──
    await waitPhase(page, 'playing', 20000);
    await sleep(2500);
    await page.keyboard.press('KeyE');
    await sleep(300);
    check((await phase()) === 'playing', 'one E while playing does not end the round');
    const armedLabel = await page.textContent('[data-testid=btn-end]');
    check(/לחצו שוב/.test(armedLabel), `the end button asks for a second press (${armedLabel.trim()})`);
    await shot('02-end-armed');
    await sleep(4000);
    check(!/לחצו שוב/.test(await page.textContent('[data-testid=btn-end]')), 'the second-press request expires');
    await page.keyboard.press('KeyE');
    await page.keyboard.press('KeyE');
    await sleep(400);
    check((await phase()) === 'playing', 'a double tap of E (bounce) does not end the round');
    await sleep(300);
    await page.keyboard.press('KeyE');
    await waitPhase(page, 'results', 6000);
    check(true, 'E, then E again after a moment, ends the round');

    // ── results: Space-Space does not skip the ceremony, let alone start the next game ──
    await sleep(1600);
    await page.keyboard.press('Space');
    await sleep(90);
    await page.keyboard.press('Space');
    await sleep(500);
    check((await phase()) === 'results', 'Space-Space during the suspense stays on the results');
    await shot('03-results-skip-armed');
    const label = await page.textContent('[data-testid=btn-primary]');
    check(/לחצו שוב/.test(label), `the main button now asks "sure?" (${label.trim()})`);
    await page.keyboard.press('Space');
    await waitPhase(page, 'lobby', 4000);
    check(true, 'a deliberate second Space skips to the lobby');
    await page.keyboard.press('Space');
    await sleep(300);
    await page.keyboard.press('Space');
    await sleep(500);
    check((await phase()) === 'lobby', 'Space-Space right after landing in the lobby does not start a game');
    await shot('04-lobby-after-skip');

    // ── a double click counts once: its 2nd click must not hit the next screen's button ──
    // (double click "next game": the 1st click starts it, the 2nd would land on "cancel round")
    await sleep(1600);
    const roundsBefore = (await state(page)).played.length;
    await page.dblclick('[data-testid=btn-primary]');
    await sleep(800);
    check((await phase()) === 'intro', 'a double click on "next game" starts the game once and does not cancel it');
    await page.keyboard.press('KeyE');
    await waitPhase(page, 'lobby', 5000);
    await sleep(300);
    // a plain click right after the screen changed is a real click (no hidden time window)
    await page.click('[data-testid=btn-primary]');
    await waitPhase(page, 'intro', 5000);
    check(true, 'a single click right after the screen changed works');
    await page.keyboard.press('KeyE');
    await waitPhase(page, 'lobby', 5000);
    check((await state(page)).played.length === roundsBefore, 'cancelled rounds are not counted as played');

    // ── M mute, C cutscene menu, Escape, auto switch, S skip ──
    const muteIcon = async () => (await page.textContent('[data-testid=btn-mute]')).trim();
    const m0 = await muteIcon();
    await page.keyboard.press('KeyM');
    await sleep(200);
    const m1 = await muteIcon();
    await page.keyboard.press('KeyM');
    await sleep(200);
    check(m0 !== m1 && (await muteIcon()) === m0, `M toggles mute (${m0} → ${m1} → back)`);
    await page.keyboard.press('KeyC');
    await page.waitForSelector('[data-testid=cutscene-menu]');
    const auto0 = (await state(page)).autoCutscenes;
    await page.click('[data-testid=auto-switch]');
    await sleep(400);
    check((await state(page)).autoCutscenes === !auto0, 'the auto-cutscenes switch flips the room setting');
    await page.click('[data-testid=auto-switch]');
    await sleep(300);
    await shot('05-cutscene-menu');
    await page.keyboard.press('Space');
    await sleep(300);
    check((await phase()) === 'lobby', 'Space with the cutscene menu open does nothing');
    await page.keyboard.press('Escape');
    await sleep(300);
    check((await page.$('[data-testid=cutscene-menu]')) === null, 'Escape closes the cutscene menu');
    await page.keyboard.press('KeyC');
    await page.click('[data-testid=cm-play-joker_2]');
    await waitCut(page, true);
    await sleep(800);
    await page.keyboard.press('KeyS');
    await waitCut(page, false, 3000);
    check(true, 'S skips the cutscene');

    // ── ☰ menu: calm mode, reset with confirm (Escape cancels, Enter confirms) ──
    await page.click('[data-testid=btn-more]');
    await page.waitForSelector('[data-testid=more-menu]');
    const calm0 = await page.evaluate(() => localStorage.getItem('party.show.calm'));
    await page.click('[data-testid=more-menu] [role=switch]');
    await sleep(200);
    const calm1 = await page.evaluate(() => localStorage.getItem('party.show.calm'));
    check(calm0 !== calm1, `calm mode switch is stored (${calm0} → ${calm1})`);
    await page.click('[data-testid=more-menu] [role=switch]');
    await page.keyboard.press('Escape');
    await sleep(300);

    // ── kick: click a chip, confirm ──
    await page.click('[data-testid=chip] >> nth=2');
    await page.waitForSelector('[data-testid=confirm]');
    await page.keyboard.press('Escape');
    await sleep(300);
    check((await state(page)).players.length === 3, 'Escape on the kick dialog keeps the player');
    await page.click('[data-testid=chip] >> nth=2');
    await page.waitForSelector('[data-testid=confirm]');
    await page.keyboard.press('Enter');
    await sleep(300);
    check((await state(page)).players.length === 3 && (await page.$('[data-testid=confirm]')) !== null, 'an Enter in the first moment of a dialog is ignored (Enter-Enter is not a decision)');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(600);
    check((await state(page)).players.length === 2, 'Enter on the kick dialog removes the player');
    check((await phase()) === 'lobby', 'Enter on a dialog does not also start a game');

    // ── reset after a played round ──
    await sleep(1600);
    await page.keyboard.press('KeyN');
    await waitPhase(page, 'playing', 20000);
    await sleep(2000);
    await page.click('[data-testid=btn-end]');
    await sleep(600);
    await shot('06a-end-click-armed');
    await page.click('[data-testid=btn-end]');
    await waitPhase(page, 'results', 6000).catch(async (e) => {
      await shot('06b-end-click-failed');
      console.log('   state', JSON.stringify(await state(page)).slice(0, 300), await page.textContent('[data-testid=strip]'));
      throw e;
    });
    // R replays the ceremony; the button text tells the host the ceremony is still on
    await sleep(1000);
    await page.keyboard.press('KeyR');
    await sleep(500);
    check((await phase()) === 'results', 'R replays without leaving the results');
    // wait out the ceremony: the main button turns into a normal "continue"
    await page.waitForFunction(() => !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 30000 });
    await shot('06-results-after-ceremony');
    await page.keyboard.press('Space');
    await waitPhase(page, 'lobby', 4000);
    check(true, 'after the ceremony one Space continues');
    // ── the early podium asks first; Enter-Enter on the podium does not reset the night ──
    await sleep(1600);
    const box = async (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(','); });
    const boxBefore = await box('[data-testid=btn-final]');
    await page.click('[data-testid=btn-final]');
    await sleep(700);
    check((await phase()) === 'lobby' && /לחצו שוב/.test(await page.textContent('[data-testid=btn-final]')), 'one click on the early podium only asks "sure?"');
    const boxArmed = await box('[data-testid=btn-final]');
    check(boxArmed === boxBefore, `the armed button keeps its place and size, so the second press lands on it (${boxBefore} → ${boxArmed})`);
    const strip = await page.evaluate(() => { const m = document.querySelector('.hs-strip-main').getBoundingClientRect(); return [...document.querySelectorAll('.hs-strip-main > .hs-btn')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= m.left - 1 && r.right <= m.right + 1; }); });
    check(strip, 'the strip buttons stay inside the middle of the strip (nothing covers the tools)');
    await shot('07a-early-final-armed');
    await page.click('[data-testid=btn-final]');
    await waitPhase(page, 'final', 5000);
    check(true, 'a second click goes to the podium');
    await waitCut(page, false, 20000);
    await sleep(1700);
    const totalsAtFinal = (await state(page)).players.map((p) => p.total).join(',');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=confirm]', { timeout: 3000 });
    await page.keyboard.press('Enter');
    await sleep(150);
    await page.keyboard.press('Enter');
    await sleep(150);
    await page.keyboard.press('Space');
    await sleep(600);
    const fin = await state(page);
    check(fin.phase === 'final' && fin.players.map((p) => p.total).join(',') === totalsAtFinal, 'Enter-Enter-Enter-Space on the podium does not reset the competition');
    await shot('07b-final-reset-confirm');
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.click('[data-testid=btn-lobby]');
    await waitPhase(page, 'lobby', 5000);
    check((await state(page)).played.length > 0, 'from the podium back to the lobby, the games played are kept');
    const playedBefore = (await state(page)).played.length;
    await page.click('[data-testid=btn-reset]');
    await page.waitForSelector('[data-testid=confirm]');
    await shot('07-reset-confirm');
    await page.keyboard.press('Escape');
    await sleep(300);
    check(playedBefore > 0 && (await state(page)).played.length === playedBefore, `Escape cancels the reset (${playedBefore} games kept)`);
    await page.click('[data-testid=btn-reset]');
    await page.click('[data-testid=confirm-yes]');
    await sleep(600);
    const st = await state(page);
    check(st.played.length === 0 && st.players.every((p) => p.total === 0), 'reset zeroes the competition and keeps the players');

    // ── F: fullscreen (headless may refuse; it must not throw) ──
    await page.keyboard.press('KeyF');
    await sleep(300);
    check(errors.length === 0, 'no console errors', errors);
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    if (phones) phones.stop();
    await browser.close();
  }
  console.log(failures.length === 0 ? 'qa-tv-controls: ALL OK' : `qa-tv-controls: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
