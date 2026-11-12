// qa-tv-room: a real room end to end. The TV page and 4 real phone pages (touch, phone size)
// join, play two games (the tap game with its automatic cutscene, then flappy, the
// elimination round) and go to the podium. No console error on any of the 5 pages;
// screenshots of the TV at each step.
//
//   PORT=8881 PARTY_TEST_FAST=1 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8881 PARTY_CLIENT_PORT=5291 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   BASE_URL=http://localhost:5291 node tests/e2e/qa-tv-room.cjs
// Screenshots: tests/e2e/out/qa-tv-room/.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || 'http://localhost:5291').replace(/\/+$/, '');
const OUT = path.join(__dirname, 'out', 'qa-tv-room');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg, extra) => {
  console.log(ok ? '  ok  ' : '  FAIL', msg, !ok && extra !== undefined ? JSON.stringify(extra).slice(0, 500) : '');
  if (!ok) failures.push(msg);
};
const NAMES = ['דנה', 'Yossi', 'מיכל', 'רון'];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${label} console ${m.text()}`);
    });
  };
  let tapping = null;
  try {
    const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const tv = await tvCtx.newPage();
    watch(tv, 'tv');
    await tv.goto(BASE + '/host.html');
    await tv.evaluate(() => localStorage.clear());
    await tv.goto(BASE + '/host.html');
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 30000 });
    const code = await tv.evaluate(() => window.__host.state().code);
    await tv.mouse.click(960, 8);
    let n = 0;
    const shot = (name) => tv.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
    const phase = () => tv.evaluate(() => window.__host.state().phase);
    const waitPhase = (p, ms = 40000) => tv.waitForFunction((x) => window.__host.state().phase === x, p, { timeout: ms });

    // four phones join through the real join screen
    const phones = [];
    for (const name of NAMES) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      watch(page, `phone ${name}`);
      await page.goto(`${BASE}/?room=${code}&dress=0`);
      await page.waitForSelector('.pp-name-input', { timeout: 20000 });
      await page.fill('.pp-name-input', name);
      await page.locator('.pp-btn-go').tap();
      phones.push({ name, page });
    }
    await tv.waitForFunction(() => window.__host.state().players.length === 4, null, { timeout: 20000 });
    await tv.waitForFunction(() => [...document.querySelectorAll('.hs-chip-av')].every((el) => el.getAttribute('data-drawn') === '1'), null, { timeout: 15000 }).catch(() => undefined);
    await sleep(1500);
    await shot('lobby-4');
    check((await tv.locator('[data-testid=chip]').count()) === 4, 'the TV shows the 4 guests with their dolls');

    // the phones tap away whenever their round is on (taps in the middle: Shimi in the tap game, a flap in flappy)
    let on = true;
    tapping = (async () => {
      while (on) {
        await Promise.all(
          phones.map(async (ph, i) => {
            const screen = await ph.page.evaluate(() => (window.__player ? window.__player.screen : null)).catch(() => null);
            if (screen !== 'playing') return;
            // in flappy the first two phones stop flapping early: they fall, the others stay up
            if (ph.stopAt !== undefined && Date.now() > ph.stopAt) return;
            await ph.page.touchscreen.tap(195 + (i - 1.5) * 20, 470).catch(() => undefined);
          }),
        );
        await sleep(120);
      }
    })();

    // game 1: the tap game (Space = the next game)
    await tv.keyboard.press('Space');
    await waitPhase('intro');
    await sleep(500);
    await shot('intro-tap');
    await waitPhase('playing');
    await sleep(2500);
    await shot('live-tap');
    await waitPhase('results', 60000);
    await tv.waitForSelector('.sh-results--ceremony', { timeout: 20000 });
    await sleep(3200);
    await shot('ceremony-tap');
    const cer = await tv.textContent('.sh-cer-name');
    check(NAMES.includes(cer.trim()), `the ceremony names a guest (${cer.trim()})`);
    await tv.waitForSelector('.sh-results--standings', { timeout: 20000 });
    await sleep(2500);
    await shot('standings-tap');
    await tv.keyboard.press('Space');
    await waitPhase('lobby');
    await sleep(1800);
    await shot('lobby-between');

    // game 2: flappy (elimination)
    phones[0].stopAt = Number.POSITIVE_INFINITY;
    await tv.click('[data-testid=game-flappy]');
    await waitPhase('playing', 20000);
    const t0 = Date.now();
    phones[0].stopAt = t0 + 1500;
    phones[1].stopAt = t0 + 3000;
    await tv.waitForFunction(() => document.querySelectorAll('[data-testid=race-card].is-out').length >= 1, null, { timeout: 30000 }).catch(() => undefined);
    await sleep(600);
    await shot('live-flappy');
    const fl = await tv.evaluate(() => ({ inAir: document.querySelectorAll('[data-testid=race-card] .pc-mark--in').length, out: document.querySelectorAll('[data-testid=race-card] .pc-mark--out').length, numbers: document.querySelectorAll('[data-testid=race-card] .sh-odo').length }));
    check(fl.inAir + fl.out === 4 && fl.numbers === 0, 'flappy on the TV: each guest is "באוויר" or "בחוץ", no distance', fl);
    await waitPhase('results', 120000);
    await tv.waitForSelector('.sh-results--ceremony', { timeout: 20000 });
    await sleep(3200);
    await shot('ceremony-flappy');
    await tv.waitForFunction(() => !/מדלג/.test(document.querySelector('[data-testid=btn-primary]').textContent), null, { timeout: 30000 });
    await tv.keyboard.press('Space');
    await waitPhase('lobby');
    await sleep(1800);

    // the podium (not every game was played: a second press confirms)
    await tv.click('[data-testid=btn-final]');
    await sleep(700);
    await tv.click('[data-testid=btn-final]');
    await waitPhase('final');
    await tv.waitForFunction(() => !window.__host.state().cutscene, null, { timeout: 20000 });
    await tv.waitForSelector('.sh-champ', { timeout: 30000 });
    await sleep(2500);
    await shot('podium');
    check((await phase()) === 'final', 'the room reached the podium');
    on = false;
    await tapping;
    tapping = null;
    for (const ph of phones) await ph.page.screenshot({ path: path.join(OUT, `phone-${ph.name}.png`) });
  } catch (e) {
    console.error(e);
    failures.push(String(e && e.message).split('\n')[0]);
  } finally {
    await browser.close();
  }
  const unique = [...new Set(errors)];
  check(unique.length === 0, 'no console error on the TV or the 4 phones', unique.slice(0, 6));
  console.log(failures.length === 0 ? 'qa-tv-room: ALL OK' : `qa-tv-room: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
