// host-sizes: the host page at phone-mirror portrait and 1280x720, fresh room + bots.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out/host');
const HOST = process.env.HOST_URL || 'http://localhost:5203/host.html';
const SERVER = process.env.SERVER_URL || 'http://localhost:8803';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const bots = [];
  try {
    for (const [w, h, tag] of [[390, 844, 'p390'], [1280, 720, 'l1280']]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 });
      const page = await ctx.newPage();
      await page.goto(HOST);
      await page.waitForSelector('[data-testid=room-code]');
      const code = (await page.textContent('[data-testid=room-code]')).trim();
      const b = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', SERVER, '--code', code, '--players', '14', '--play', '--prefix', 'מאיה', '--quiet'], { cwd: ROOT, stdio: 'ignore', detached: true });
      bots.push(b);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=chip]').length >= 14, null, { timeout: 20000 });
      await sleep(900);
      await page.screenshot({ path: `${OUT}/70-${tag}-lobby.png` });
      const sc = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth, innerHeight]);
      console.log(tag, 'scroll', JSON.stringify(sc));
      await page.click('[data-testid=btn-primary]');
      await page.waitForFunction(() => window.__host.state().phase === 'intro');
      await sleep(700);
      await page.screenshot({ path: `${OUT}/71-${tag}-intro.png` });
      await page.waitForFunction(() => window.__host.state().phase === 'playing', null, { timeout: 10000 });
      await sleep(3000);
      await page.screenshot({ path: `${OUT}/72-${tag}-playing.png` });
      // the tap round carries an automatic cutscene in the middle (tap_freeze): give it its time
      await page.waitForFunction(() => window.__host.state().phase === 'results', null, { timeout: 60000 });
      const r = await page.evaluate(() => window.__host.state().results.revealAt - window.__host.now());
      await sleep(Math.max(0, r) + 2000);
      await page.screenshot({ path: `${OUT}/73-${tag}-ceremony.png` });
      // "continue" during the ceremony only arms itself: wait for the ceremony to end
      await page.waitForFunction(() => !/מדלג/.test((document.querySelector('[data-testid=btn-primary]') || {}).textContent || ''), null, { timeout: 30000 });
      await page.click('[data-testid=btn-primary]');
      await page.waitForFunction(() => window.__host.state().phase === 'lobby');
      await sleep(1200);
      await page.screenshot({ path: `${OUT}/74-${tag}-lobby-between.png` });
      const sc2 = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth, innerHeight]);
      console.log(tag, 'scroll2', JSON.stringify(sc2));
      await ctx.close();
    }
  } catch (e) {
    console.log('ERROR', e.message);
  } finally {
    for (const b of bots) try { process.kill(-b.pid, 'SIGKILL'); } catch {}
    await browser.close();
    process.exit(0);
  }
})();
