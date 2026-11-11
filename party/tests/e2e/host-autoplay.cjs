// host-autoplay: when the browser refuses sound (autoplay policy), a cutscene plays muted with a one-click unmute.
// Headless Chromium ignores --autoplay-policy, so the refusal is simulated: play() with sound rejects with
// NotAllowedError until the page has had a click.
const { chromium } = require('playwright');
const OUT = __dirname + '/out/host';
const HOST = process.env.HOST_URL || 'http://localhost:5203/host.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    let gesture = false;
    window.addEventListener('pointerdown', () => { gesture = true; }, true);
    const real = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.muted && !gesture) return Promise.reject(new DOMException('no sound without a gesture', 'NotAllowedError'));
      return real.call(this);
    };
  });
  try {
    await page.goto(HOST);
    await page.waitForSelector('[data-testid=room-code]');
    await page.keyboard.press('KeyC');
    await page.click('[data-testid=cm-play-opening]');
    await page.waitForFunction(() => !!window.__host.state().cutscene);
    await sleep(500);
    await page.reload();
    await page.waitForSelector('[data-testid=cutscene-unmute]', { timeout: 8000 });
    const muted = await page.evaluate(() => document.querySelector('[data-testid=cutscene-video]').muted);
    console.log('PASS unmute button shown; video muted =', muted);
    await sleep(300);
    await page.screenshot({ path: `${OUT}/84-autoplay-unmute.png` });
    await page.click('[data-testid=cutscene-unmute]', { force: true });
    await sleep(300);
    const after = await page.evaluate(() => ({ muted: document.querySelector('[data-testid=cutscene-video]')?.muted, btn: !!document.querySelector('[data-testid=cutscene-unmute]') }));
    console.log('after click', JSON.stringify(after));
  } catch (e) {
    console.log('FAIL', e.message);
  } finally {
    await browser.close();
  }
})();
