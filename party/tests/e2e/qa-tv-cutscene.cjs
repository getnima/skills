// qa-tv-cutscene: the TV cutscene player with real .webm clips of different lengths and
// aspect ratios (with and without audio), a missing file, a broken file, skip, a TV reload
// mid-video (seeks to the right place) and a clip longer than CUTSCENE_MAX_MS.
// The clips are made with ffmpeg into a scratch folder and served by Playwright routes;
// ?testCutscenes= tells the page they exist (the real list is taken at build time).
//
//   PARTY_SERVER_PORT=8813 PARTY_TEST_DURATION_MS=20000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8813 PARTY_CLIENT_PORT=5213 npx vite
//   node tests/e2e/qa-tv-cutscene.cjs          (LONG=1 also waits out the 90 s cap)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sleep, outDir, checker, openHost, state, waitCut } = require('./qa-tv-lib.cjs');

const { check, failures } = checker();
const dir = outDir('cutscene');
const CLIPS = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-tv-clips-'));

function ff(args) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}
function makeClips() {
  const vp9 = ['-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'realtime', '-cpu-used', '8'];
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=6', ...vp9, path.join(CLIPS, 'portrait6.webm')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=840x360:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', ...vp9, '-c:a', 'libopus', '-shortest', path.join(CLIPS, 'wide3.webm')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', ...vp9, '-c:a', 'libopus', '-shortest', path.join(CLIPS, 'land12.webm')]);
  ff(['-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=10:duration=100', '-c:v', 'libvpx-vp9', '-b:v', '60k', '-deadline', 'realtime', '-cpu-used', '8', path.join(CLIPS, 'long100.webm')]);
  fs.writeFileSync(path.join(CLIPS, 'broken.webm'), Buffer.from(Array.from({ length: 50000 }, (_, i) => (i * 7919) % 256)));
}

const video = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('[data-testid=cutscene-video]');
    const c = document.querySelector('[data-testid=cutscene]');
    return {
      mode: c ? c.dataset.mode : null,
      src: v ? v.dataset.src : null,
      t: v ? +v.currentTime.toFixed(2) : null,
      dur: v ? v.duration : null,
      paused: v ? v.paused : null,
      muted: v ? v.muted : null,
      fit: v ? getComputedStyle(v).objectFit : null,
      rect: v ? (({ width, height }) => ({ width, height }))(v.getBoundingClientRect()) : null,
    };
  });

async function play(page, id) {
  await page.keyboard.press('KeyC');
  await page.click(`[data-testid=cm-play-${id}]`);
  await waitCut(page, true);
}

(async () => {
  makeClips();
  const browser = await chromium.launch();
  try {
    const query = '?testCutscenes=joker_1.webm,joker_2.webm,before_podium.webm,before_ninja.webm';
    const { ctx, page, errors } = await openHost(browser, { query });
    const map = { 'joker_1.webm': 'portrait6.webm', 'joker_2.webm': 'wide3.webm', 'before_podium.webm': 'broken.webm', 'before_ninja.webm': 'long100.webm' };
    await ctx.route('**/cutscenes/*.webm', (route) => {
      const name = decodeURIComponent(route.request().url().split('/').pop().split('?')[0]);
      const file = map[name];
      if (!file) return route.continue();
      // like the real servers (express static, vite): byte ranges, so the player can seek
      const body = fs.readFileSync(path.join(CLIPS, file));
      const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] || '');
      if (!range) return route.fulfill({ status: 200, body, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' } });
      const a = Number(range[1]);
      const b = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      return route.fulfill({
        status: 206,
        body: body.subarray(a, b + 1),
        contentType: 'video/webm',
        headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${body.length}`, 'Cache-Control': 'no-store' },
      });
    });
    await page.mouse.click(960, 8); // the first click unlocks sound

    // ── a portrait clip without audio: plays letterboxed, ends by itself ──
    const t0 = Date.now();
    await play(page, 'joker_1');
    await sleep(1500);
    let v = await video(page);
    check(v.mode === 'video' && !v.paused && v.t > 0.3, 'portrait 6 s clip (no audio) plays', v);
    check(v.fit === 'contain', `the clip is shown whole (object-fit ${v.fit})`);
    await page.screenshot({ path: `${dir}/01-portrait.png` });
    await waitCut(page, false, 15000);
    const took = Date.now() - t0;
    check(took > 5500 && took < 9500, `it ends by itself after its length (${took} ms)`);

    // ── a wide clip with audio, sound on after the first click ──
    await sleep(500);
    await play(page, 'joker_2');
    await sleep(1000);
    v = await video(page);
    check(v.mode === 'video' && !v.paused && v.muted === false, 'wide 3 s clip plays with sound', v);
    await page.screenshot({ path: `${dir}/02-wide.png` });
    await waitCut(page, false, 10000);

    // ── skip ──
    await sleep(500);
    await play(page, 'joker_1');
    await sleep(1000);
    await page.keyboard.press('KeyS');
    await waitCut(page, false, 3000);
    check(true, 'S skips a playing video');

    // ── a broken file: the placeholder card, no hang, no console errors ──
    await sleep(500);
    const tb = Date.now();
    await play(page, 'before_podium');
    await page.waitForFunction(() => document.querySelector('[data-testid=cutscene]')?.dataset.mode === 'placeholder', null, { timeout: 12000 });
    check(Date.now() - tb < 3000, `a broken file falls back to the card at once (${Date.now() - tb} ms)`);
    await page.screenshot({ path: `${dir}/03-broken.png` });
    await waitCut(page, false, 10000);

    // ── a missing file (opened without the test list): the card, and not one request ──
    // (the TV's preloader does ask for the videos that are in the build; only the missing one must cost nothing)
    const page2 = await ctx.newPage();
    const asked = [];
    page2.on('request', (r) => {
      if (/\/cutscenes\/joker_2\./i.test(r.url())) asked.push(r.url());
    });
    const errs2 = [];
    page2.on('console', (m) => m.type() === 'error' && errs2.push(m.text()));
    await page2.goto(page.url().split('?')[0]);
    await page2.waitForFunction(() => window.__host && window.__host.status() === 'online');
    await page2.keyboard.press('KeyC');
    await page2.waitForSelector('[data-testid=cutscene-menu]');
    const dots = await page2.$$eval('.hs-dot', (els) => els.map((e) => e.dataset.status));
    check(dots.length === 6 && dots.every((d) => d === 'ok' || d === 'missing'), `cutscene menu knows each file at once (${dots.join(',')})`);
    await page2.click('[data-testid=cm-play-joker_2]');
    await page2.waitForFunction(() => document.querySelector('[data-testid=cutscene]')?.dataset.mode === 'placeholder', null, { timeout: 5000 });
    await page2.screenshot({ path: `${dir}/04-missing.png` });
    await page2.waitForFunction(() => !window.__host.state().cutscene, null, { timeout: 10000 });
    check(asked.length === 0 && errs2.length === 0, `a missing video costs no request and no console error (${asked.length} requests, ${errs2.length} errors)`, { asked, errs2 });
    await page2.close();
    await page.bringToFront();

    // ── reload mid-video: the video continues where the room is ──
    map['joker_1.webm'] = 'land12.webm';
    await sleep(800);
    await play(page, 'joker_1');
    const startedAt = (await state(page)).cutscene.startedAt;
    await sleep(5000);
    await page.reload();
    await page.waitForFunction(() => {
      const v = document.querySelector('[data-testid=cutscene-video]');
      return v && v.currentTime > 0 && !v.paused;
    }, null, { timeout: 10000 });
    const at = await page.evaluate(() => window.__host.now());
    v = await video(page);
    const expect = (at - startedAt) / 1000;
    check(Math.abs(v.t - expect) < 1.2, `after a reload the video is at ${v.t}s, the room at ${expect.toFixed(2)}s`);
    await page.screenshot({ path: `${dir}/05-after-reload.png` });
    await waitCut(page, false, 12000);
    const total = (await page.evaluate(() => window.__host.now())) - startedAt;
    check(total < 14500, `and it still ends with the clip (${total} ms after it began)`);

    // ── the tab in the background: no animation frames at all; the placeholder card still ends on time ──
    {
      // its own context: its own room, so no other TV can end the cutscene for it
      const ctx3 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page3 = await ctx3.newPage();
      await page3.goto(page.url().split('?')[0]);
      await page3.waitForFunction(() => window.__host && window.__host.status() === 'online');
      await sleep(1700);
      await page3.keyboard.press('KeyC');
      await page3.click('[data-testid=cm-play-joker_2]');
      await page3.waitForFunction(() => document.querySelector('[data-testid=cutscene]')?.dataset.mode === 'placeholder', null, { timeout: 5000 });
      const tb = Date.now();
      // what a hidden tab does: requestAnimationFrame never calls back
      await page3.evaluate(() => {
        window.requestAnimationFrame = () => 0;
      });
      await page3.waitForFunction(() => !window.__host.state().cutscene, null, { timeout: 15000 });
      const bt = Date.now() - tb;
      check(bt < 6000, `in a background tab the placeholder card still ends on time (${bt} ms)`);
      await ctx3.close();
    }

    // ── longer than CUTSCENE_MAX_MS (90 s): the server ends it, the TV lets go ──
    if (process.env.LONG === '1') {
      await page.mouse.click(960, 8);
      await sleep(500);
      const tl = Date.now();
      await play(page, 'before_ninja');
      await sleep(3000);
      v = await video(page);
      check(v.mode === 'video' && v.dur > 95, `100 s clip plays (${v.dur}s)`);
      await waitCut(page, false, 100000);
      const lt = Date.now() - tl;
      check(lt > 88000 && lt < 95000, `the room ends a too-long clip at the cap (${lt} ms)`);
      await sleep(500);
      check((await page.$('[data-testid=cutscene]')) === null, 'and the TV video is gone');
    }

    const real = errors.filter((e) => !/Failed to load resource/.test(e) || !/cutscenes/.test(e));
    check(real.length === 0, 'no console errors on the TV', errors);
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    await browser.close();
    fs.rmSync(CLIPS, { recursive: true, force: true });
  }
  console.log(failures.length === 0 ? 'qa-tv-cutscene: ALL OK' : `qa-tv-cutscene: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
