// host-edge: refresh during a cutscene (video + placeholder), kick, server restart -> lost room.
const { chromium } = require('playwright');
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out/host');
const HOST = process.env.HOST_URL || 'http://localhost:5203/host.html';
const SERVER = process.env.SERVER_URL || 'http://localhost:8803';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (n, ok, x) => console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x !== undefined ? ' ' + JSON.stringify(x) : ''}`);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const bots = [];
  try {
    await page.goto(HOST);
    await page.evaluate(() => localStorage.clear());
    await page.goto(HOST);
    await page.waitForSelector('[data-testid=room-code]');
    const code = (await page.textContent('[data-testid=room-code]')).trim();
    bots.push(spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', SERVER, '--code', code, '--players', '4', '--hold', '--prefix', 'רון', '--quiet'], { cwd: ROOT, stdio: 'ignore', detached: true }));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=chip]').length >= 4, null, { timeout: 20000 });

    // kick
    await page.locator('[data-testid=chip]').first().click();
    await page.waitForSelector('[data-testid=confirm]');
    await sleep(300);
    await page.screenshot({ path: `${OUT}/80-kick-confirm.png` });
    await page.click('[data-testid=confirm-yes]');
    await page.waitForFunction(() => window.__host.state().players.length === 3, null, { timeout: 5000 });
    check('kick removes the player', true);

    // refresh in the middle of a real video: no user gesture after reload -> muted + unmute button, seeks
    await page.keyboard.press('KeyC');
    await page.click('[data-testid=cm-play-opening]');
    await page.waitForFunction(() => !!window.__host.state().cutscene);
    await sleep(1800);
    await page.reload();
    await page.waitForSelector('[data-testid=cutscene-video]', { timeout: 8000 });
    await page.waitForFunction(() => { const v = document.querySelector('[data-testid=cutscene-video]'); return v && v.currentTime > 0.2; }, null, { timeout: 8000 });
    const t = await page.evaluate(() => document.querySelector('[data-testid=cutscene-video]').currentTime);
    check('re-attached video resumes near where it was (not from 0)', t > 1.5, t);
    await sleep(200);
    await page.screenshot({ path: `${OUT}/81-reattach-video.png` });
    const unmute = await page.locator('[data-testid=cutscene-unmute]').count();
    console.log('unmute button shown after reload:', unmute === 1);
    await page.waitForFunction(() => !window.__host.state().cutscene, null, { timeout: 8000 });
    check('re-attached cutscene ends', true);

    // refresh during a placeholder
    await page.keyboard.press('KeyC');
    await page.click('[data-testid=cm-play-joker_2]');
    await page.waitForSelector('[data-testid=cutscene-placeholder]');
    await sleep(1500);
    await page.reload();
    await page.waitForSelector('[data-testid=cutscene-placeholder]', { timeout: 8000 });
    const t0 = Date.now();
    await page.waitForFunction(() => !window.__host.state().cutscene, null, { timeout: 8000 });
    check('re-attached placeholder ends with the remaining time', Date.now() - t0 < 3500, Date.now() - t0);

    // skip with S
    await page.keyboard.press('KeyC');
    await page.click('[data-testid=cm-play-opening]');
    await page.waitForSelector('[data-testid=cutscene-video]');
    await sleep(500);
    await page.keyboard.press('KeyS');
    await page.waitForFunction(() => !window.__host.state().cutscene, null, { timeout: 3000 });
    check('S skips the cutscene', true);

    // auto switch
    await page.keyboard.press('KeyC');
    await page.click('[data-testid=auto-switch]');
    await page.waitForFunction(() => window.__host.state().autoCutscenes === false, null, { timeout: 3000 });
    check('auto switch turns automatic cutscenes off', true);
    await page.keyboard.press('Escape');

    // server restart -> the room is gone -> new room + banner
    // the server of SERVER_URL (only a test server: this kills whatever listens on its port)
    const port = new URL(SERVER).port || '80';
    execSync(`fuser -k ${port}/tcp || true`);
    await page.waitForSelector('[data-testid=offline]', { timeout: 15000 });
    await sleep(500);
    await page.screenshot({ path: `${OUT}/82-offline.png` });
    spawn('npx', ['tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: port, PARTY_TEST_FAST: '1' }, stdio: 'ignore', detached: true }).unref();
    await page.waitForSelector('[data-testid=lost-room]', { timeout: 30000 });
    await sleep(800);
    const code2 = (await page.textContent('[data-testid=room-code]')).trim();
    check('a new room after a server restart', code2 !== code, { code, code2 });
    await page.screenshot({ path: `${OUT}/83-lost-room.png` });
  } catch (e) {
    console.log('ERROR', e.message);
    await page.screenshot({ path: `${OUT}/89-edge-error.png` }).catch(() => {});
  } finally {
    for (const b of bots) try { process.kill(-b.pid, 'SIGKILL'); } catch {}
    await browser.close();
    process.exit(0);
  }
})();
