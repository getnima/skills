// narration-intros: each of the five games' intro screen on the TV with the hosts' banter pair, at 1920x1080
// and 1280x720: both lines are said, the hosts cover nothing (title, instructions, round tag, prize, players,
// progress bar, 3-2-1), no console errors. One fresh room per game, one scripted phone in it.
// Needs the REAL intro timing (27 s + the 3-2-1): the server of narration-room.cjs.
//   BASE_URL=http://localhost:5279 SERVER_URL=http://localhost:8879 node tests/e2e/narration-intros.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { scriptedPhones } = require('./qa-tv-lib.cjs');

const BASE = (process.env.BASE_URL || 'http://localhost:5279').replace(/\/+$/, '');
const OUT = path.join(__dirname, 'out', 'host-poses', 'intros');
fs.mkdirSync(OUT, { recursive: true });
const GAMES = ['tap', 'icy', 'flappy', 'plotzel', 'ninja'];
const failures = [];
const check = (ok, msg, extra) => {
  console.log(ok ? '  ok  ' : '  FAIL', msg, !ok && extra !== undefined ? JSON.stringify(extra).slice(0, 500) : '');
  if (!ok) failures.push(msg);
};

const covered = (page) =>
  page.evaluate(() => {
    const nr = document.querySelector('[data-testid=narrator]');
    if (!nr) return null;
    const img = nr.querySelector('.nr-pic');
    const r = img.getBoundingClientRect();
    const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * k;
    const pic = { left: r.left + (r.width - w) / 2, right: r.left + (r.width + w) / 2, top: r.bottom - img.naturalHeight * k, bottom: r.bottom };
    const mine = [pic, nr.querySelector('.nr-bubble').getBoundingClientRect()];
    const out = [];
    for (const sel of ['.hs-intro-round', '.hs-intro-title', '.hs-howto-text', '.hs-intro-start', '.hs-intro-foot > *', '.hs-intro-emoji', '.hs-progress', '.hs-countdown-num', '.hs-countdown-game', '.hs-countdown-hint']) {
      for (const el of document.querySelectorAll(sel)) {
        // a line of text is judged by its letters (a heading's block box is as wide as its container)
        let b = el.getBoundingClientRect();
        if (/title|text|hint/.test(sel)) {
          const range = document.createRange();
          range.selectNodeContents(el);
          b = range.getBoundingClientRect();
        }
        if (b.width < 2) continue;
        if (mine.some((m) => Math.min(m.right, b.right) - Math.max(m.left, b.left) > 4 && Math.min(m.bottom, b.bottom) - Math.max(m.top, b.top) > 4)) out.push(sel);
      }
    }
    return { moment: nr.dataset.moment, host: nr.dataset.host, out };
  });

(async () => {
  const browser = await chromium.launch();
  for (const [W, H] of [
    [1920, 1080],
    [1280, 720],
  ]) {
    for (const game of GAMES) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H } });
      const tv = await ctx.newPage();
      const errors = [];
      tv.on('pageerror', (e) => errors.push(e.message));
      tv.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      let phones = null;
      try {
        await tv.goto(`${BASE}/host.html`);
        await tv.evaluate(() => localStorage.clear());
        await tv.goto(`${BASE}/host.html`);
        await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 30000 });
        const code = await tv.evaluate(() => window.__host.state().code);
        phones = await scriptedPhones(code, ['נועה'], () => null);
        await tv.waitForFunction(() => window.__host.state().players.length === 1, null, { timeout: 15000 });
        await tv.waitForTimeout(1700);
        await tv.click(`[data-testid=game-${game}]`);
        await tv.waitForFunction(() => window.__host.state().phase === 'intro' && !window.__host.state().cutscene, null, { timeout: 30000 });
        const seen = [];
        for (let beat = 0; beat < 2; beat++) {
          await tv.waitForFunction(
            (n) => {
              const el = document.querySelector('[data-testid=narrator]');
              return el && !el.classList.contains('is-leaving') && window.__narrator.log().filter((b) => b.moment.startsWith('intro_')).length > n;
            },
            beat,
            { timeout: 15000, polling: 50 },
          );
          await tv.waitForTimeout(900);
          await tv.screenshot({ path: path.join(OUT, `${game}-${W}-${beat === 0 ? 'a' : 'b'}.png`) });
          const c = await covered(tv);
          seen.push(c);
          check(c !== null && c.out.length === 0, `${game} ${W}x${H} line ${beat + 1}: covers nothing`, c);
        }
        check(seen.every((c) => c && c.moment === `intro_${game}`) && seen[0].host === 'a' && seen[1].host === 'b', `${game} ${W}x${H}: A sets up, B answers`, seen);
        check(errors.length === 0, `${game} ${W}x${H}: no console errors`, errors.slice(0, 3));
      } catch (e) {
        failures.push(`${game} ${W}: ${e.message}`);
        console.log('  FAIL', game, W, e.message);
        await tv.screenshot({ path: path.join(OUT, `${game}-${W}-crash.png`) }).catch(() => undefined);
      } finally {
        if (phones) phones.stop();
        await ctx.close();
      }
    }
  }
  await browser.close();
  console.log(failures.length === 0 ? `\nPASS (${OUT})` : `\nFAIL ${failures.length}: ${failures.join(' | ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
