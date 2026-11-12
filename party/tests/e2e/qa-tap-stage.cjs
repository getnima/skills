// The tap game and the stage, in a real browser:
//  1. ownsFinalScreen: after ctx.finish() the stage does NOT cover the game with its "סיימת!"
//     overlay (the final frame stays visible), and the stage's urgent vignette stays off while
//     the game shows its own clock;
//  2. a crash still shows the stage's crash overlay;
//  3. a reload in the middle of a round does not give a second sprint: mid-sprint it continues
//     the same sprint (same start, same taps, same end), after the sprint it opens on the final
//     frame with the same score.
// The stage is mounted directly (vite serves /src/play/stage.ts) on a clock that survives the
// reload (sessionStorage), like the real round clock does.
//   QA_BASE=http://localhost:5321 node tests/e2e/qa-tap-stage.cjs
const L = require('./qa-tap-comedy-lib.cjs');
const path = require('path');

const DUR = 10600; // window 6 s, sprint 4 s, hold 0.6 s
const OUT = L.outDir('qa-tap-stage');

const MOUNT = (dur, seed) => `
  (async () => {
    const { mountStage } = await import('/src/play/stage.ts');
    let epoch = Number(sessionStorage.getItem('qa.epoch'));
    if (!epoch) { epoch = Date.now(); sessionStorage.setItem('qa.epoch', String(epoch)); }
    window.__qa = { score: 0, finished: null, ended: null };
    const app = document.getElementById('app') || document.body;
    await mountStage({
      parent: app, gameId: 'tap', seed: ${seed}, durationMs: ${dur},
      clock: () => ({ leftMs: Math.max(0, ${dur} - (Date.now() - epoch)), frozen: false }),
      onScore: (s) => { window.__qa.score = s; },
      onFinish: (s) => { window.__qa.finished = s; },
      onEnd: (s) => { window.__qa.ended = s; },
    });
  })();`;

async function open(context, seed) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${L.BASE}/dev.html`);
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });
  await page.evaluate(MOUNT(DUR, seed));
  await page.waitForFunction(() => window.__tap && window.__tap(), null, { timeout: 20000 });
  return { page, errors };
}

const overlayOn = (page, title) =>
  page.evaluate((t) => {
    for (const o of document.querySelectorAll('.pa-overlay')) {
      if (!o.textContent.includes(t)) continue;
      const cs = getComputedStyle(o);
      return o.classList.contains('is-on') && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
    }
    return false;
  }, title);

async function tapN(page, cdp, n, gap = 160) {
  const s = await L.st(page);
  for (let i = 0; i < n; i++) {
    await L.tapAt(cdp, [{ x: s.x + (i % 2 ? 40 : -40), y: s.y + 30 }]);
    await L.sleep(gap);
  }
}

(async () => {
  const browser = await L.chromium.launch();

  // ── 1 + 2: the final frame is not covered; a crash still is ──
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const { page, errors } = await open(context, 5);
    const cdp = await context.newCDPSession(page);
    await tapN(page, cdp, 3);
    const urgentDuringSprint = await page.evaluate(() => document.querySelector('.pa-stage')?.classList.contains('is-urgent') ?? null);
    await page.waitForFunction(() => window.__tap() && window.__tap().finished, null, { timeout: 15000 });
    await L.sleep(900);
    const s = await L.st(page);
    const waitOn = await overlayOn(page, 'סיימת');
    await page.screenshot({ path: path.join(OUT, 'final-after-finish.png') });
    L.check('finish() was reported to the stage', (await page.evaluate(() => window.__qa.finished)) === s.taps, s.taps);
    L.check('the stage does not cover the final frame with "סיימת!"', waitOn === false, waitOn);
    L.check('the final frame is showing', s.beat === 'final' && s.hand === 'final', [s.beat, s.hand]);
    L.check('no stage vignette over the game clock', urgentDuringSprint === false, urgentDuringSprint);
    // crash: make the game's next frame throw
    await page.evaluate(() => {
      const orig = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...a) {
        CanvasRenderingContext2D.prototype.drawImage = orig;
        throw new Error('qa: boom');
      };
    });
    await L.sleep(500);
    const crashOn = await overlayOn(page, 'אופס');
    await page.screenshot({ path: path.join(OUT, 'crash-overlay.png') });
    L.check('a crash still shows the crash overlay', crashOn === true, crashOn);
    L.check('no page errors', errors.length === 0, errors.slice(0, 2));
    await context.close();
  }

  // ── 3a: reload mid-sprint: the same sprint continues ──
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    let { page } = await open(context, 6);
    let cdp = await context.newCDPSession(page);
    await tapN(page, cdp, 8, 150);
    const before = await L.st(page);
    await page.reload();
    await page.evaluate(() => {
      document.body.innerHTML = '<div id="app"></div>';
    });
    await page.evaluate(MOUNT(DUR, 6));
    await page.waitForFunction(() => window.__tap && window.__tap(), null, { timeout: 20000 });
    cdp = await context.newCDPSession(page);
    const after = await L.st(page);
    L.check('reload mid-sprint: still in the same sprint (same start and end)', after.phase === 'sprint' && Math.abs(after.t0 - before.t0) < 1 && Math.abs(after.endAt - before.endAt) < 1, [before.t0, after.t0, before.endAt, after.endAt, after.phase]);
    L.check('reload mid-sprint: the taps are kept (at most 4 lost to the save throttle)', after.taps >= before.taps - 4 && after.taps <= before.taps, [before.taps, after.taps]);
    await tapN(page, cdp, 3, 150);
    await page.waitForFunction(() => window.__tap() && window.__tap().phase === 'done', null, { timeout: 15000 });
    const done = await L.st(page);
    L.check('reload mid-sprint: the sprint still ends at the first start + sprint', Math.abs(done.endAt - before.endAt) < 1, [done.endAt, before.endAt]);
    await context.close();
  }

  // ── 3b: reload after the sprint: straight to the final frame, same score, no second try ──
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    let { page } = await open(context, 7);
    let cdp = await context.newCDPSession(page);
    await tapN(page, cdp, 6, 150);
    await page.waitForFunction(() => window.__tap() && window.__tap().phase === 'done', null, { timeout: 15000 });
    const before = await L.st(page);
    await page.reload();
    await page.evaluate(() => {
      document.body.innerHTML = '<div id="app"></div>';
    });
    await page.evaluate(MOUNT(DUR, 7));
    await page.waitForFunction(() => window.__tap && window.__tap(), null, { timeout: 20000 });
    cdp = await context.newCDPSession(page);
    await L.sleep(300);
    const after = await L.st(page);
    await tapN(page, cdp, 5, 120);
    const later = await L.st(page);
    const qa = await page.evaluate(() => window.__qa);
    await page.screenshot({ path: path.join(OUT, 'reload-after-final.png') });
    L.check('reload after the sprint: opens on the final frame', after.phase === 'done' && after.finished, [after.phase, after.finished]);
    L.check('reload after the sprint: same score, reported as final', after.taps === before.taps && qa.finished === before.taps && qa.score === before.taps, [before.taps, after.taps, qa]);
    L.check('reload after the sprint: taps do not start a second sprint', later.taps === before.taps && later.phase === 'done', [later.taps, later.phase]);
    await context.close();
  }

  await browser.close();
  console.log(L.fails.length ? `\n${L.fails.length} FAILED: ${L.fails.join(', ')}` : '\nALL OK');
})();
