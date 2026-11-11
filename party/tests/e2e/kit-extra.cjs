// Kit extras: real-file slots (art + audio), crash handling, score throttle. Needs vite on :5201.
const { chromium, devices } = require('playwright');
const path = require('path');
const BASE = process.env.KIT_BASE || 'http://localhost:5201';
const OUT = path.join(__dirname, 'out', 'kit');
let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra !== undefined ? JSON.stringify(extra) : ''}`); if (!ok) failed++; };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/dev.html?kit=1`);
  await page.waitForSelector('.dv-art-cell img');
  await page.touchscreen.tap(200, 30);

  const assets = await page.evaluate(async () => {
    const a = await import('/src/kit/assets.ts');
    const art = await a.loadAssets('host', [
      { key: 'prize', file: 'prize.png', size: 120, fit: 'cover', round: true, placeholder: a.crownPainter },
      { key: 'missing', file: 'nope.png', size: 80, placeholder: a.facePainter('wink') },
    ]);
    for (const k of ['prize', 'missing']) { const i = new Image(); i.src = art[k].url; i.width = 120; i.style.cssText = 'position:fixed;top:300px;left:' + (k === 'prize' ? 20 : 180) + 'px;z-index:99'; document.body.append(i); }
    return { prize: [art.prize.isPlaceholder, art.prize.url, art.prize.width], missing: [art.missing.isPlaceholder, art.missing.url.slice(0, 22)], none: a.assetFileUrl('host', 'zzz.png') };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'extra-1-assets.png') });
  check('real file found by base name (.png slot -> .jpg file)', assets.prize[0] === false && assets.prize[1] === '/assets/host/prize.jpg', assets);
  check('missing file -> placeholder data URL, no request', assets.missing[0] === true && assets.missing[1].startsWith('data:image/png') && assets.none === null);

  const music = await page.evaluate(async () => {
    const m = await import('/src/kit/music.ts');
    const has = m.hasTrackFile('kit-selftest');
    m.playTrack('kit-selftest', { volume: 0.5 });
    await new Promise((r) => setTimeout(r, 400));
    const playing = m.isTrackPlaying('kit-selftest');
    m.playTrack('kit-selftest');
    await new Promise((r) => setTimeout(r, 1500));
    const afterEnd = m.isTrackPlaying('kit-selftest');
    m.playTrack('kit-selftest', { loop: true });
    await new Promise((r) => setTimeout(r, 300));
    m.stopTrack();
    await new Promise((r) => setTimeout(r, 600));
    return { has, playing, afterEnd, afterStop: m.isTrackPlaying('kit-selftest') };
  });
  check('audio file slot plays, ends, restarts, stops', music.has && music.playing && !music.afterEnd && !music.afterStop, music);

  const crash = await page.evaluate(async () => {
    const s = await import('/src/play/stage.ts');
    const l = await import('/src/kit/loop.ts');
    const run = async (mod, ms) => {
      const t0 = performance.now(); const log = { scores: [], end: null, finish: null };
      const stage = await s.mountStageWith({ parent: document.getElementById('app'), gameId: 'tap', seed: 1, durationMs: ms,
        clock: () => ({ leftMs: Math.max(0, ms - (performance.now() - t0)), frozen: false }),
        onScore: (v) => log.scores.push([Math.round(performance.now() - t0), v]), onFinish: (v) => { log.finish = v; }, onEnd: (v) => { log.end = (log.end === null ? '' : log.end + '+') + v; } }, async () => mod);
      await new Promise((r) => setTimeout(r, ms + 500));
      log.overlay = document.querySelector('.pa-overlay.is-on .pa-overlay-title')?.textContent ?? null;
      log.paused = l.isKitPaused();
      window.__shot = stage;
      return { log, stage };
    };
    const a = await run({ id: 'tap', create() { throw new Error('boom in create'); } }, 800);
    a.stage.destroy();
    const b = await run({ id: 'tap', create(ctx) { ctx.setScore(7); const loop = l.createLoop({ update() { if (loop.steps > 10) throw new Error('boom in update'); } }); loop.start(); return { destroy() { loop.stop(); } }; } }, 900);
    b.stage.destroy();
    const c = await run({ id: 'tap', create(ctx) { let n = 0; const loop = l.createLoop({ update() { ctx.setScore(++n); if (n === 30) ctx.finish(); } }); loop.start(); return { destroy() { loop.stop(); } }; } }, 1500);
    return { a: a.log, b: b.log, c: { ...c.log, scores: c.log.scores.length, first: c.log.scores.slice(0, 3), last: c.log.scores.at(-1) } };
  });
  await page.screenshot({ path: path.join(OUT, 'extra-2-finished-then-ended.png') });
  check('create() throws: friendly error, onEnd once with 0', crash.a.end === '0' && crash.a.overlay && crash.a.overlay.includes('אופס'), crash.a);
  check('update() throws: friendly error, onEnd once with last score', crash.b.end === '7' && crash.b.overlay && crash.b.overlay.includes('אופס') && !crash.b.paused, crash.b);
  check('score throttled (~250ms) and last value flushed; finish() reported', crash.c.scores >= 4 && crash.c.scores <= 9 && String(crash.c.last[1]) === crash.c.end && crash.c.finish === 30, crash.c);

  // screenshots of the two overlays
  await page.evaluate(async () => {
    window.__shot.destroy();
    const s = await import('/src/play/stage.ts');
    const t0 = performance.now();
    window.__st = await s.mountStageWith({ parent: document.getElementById('app'), gameId: 'tap', seed: 1, durationMs: 60000, clock: () => ({ leftMs: 60000 - (performance.now() - t0), frozen: false }), onScore() {}, onEnd() {} },
      async () => ({ id: 'tap', create(ctx) { ctx.setScore(1234); ctx.finish(); return { destroy() {} }; } }));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'extra-3-waiting.png') });
  await page.evaluate(async () => {
    window.__st.destroy();
    const s = await import('/src/play/stage.ts');
    const t0 = performance.now();
    window.__st = await s.mountStageWith({ parent: document.getElementById('app'), gameId: 'tap', seed: 1, durationMs: 60000, clock: () => ({ leftMs: 60000 - (performance.now() - t0), frozen: false }), onScore() {}, onEnd() {} },
      async () => ({ id: 'tap', create(ctx) { ctx.setScore(42); throw new Error('boom'); } }));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'extra-4-crash.png') });
  const real = errors.filter((e) => !/boom|game crashed|\[kit\]/.test(e));
  check('no unexpected console errors / 4xx', real.length === 0, real.slice(0, 5));
  await browser.close();
  console.log(failed ? `${failed} FAILED` : 'ALL OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
