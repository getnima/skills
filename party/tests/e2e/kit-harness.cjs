// Kit / stage / dev-harness check. Needs vite on :5201 (PARTY_CLIENT_PORT=5201 npx vite).
const { chromium, devices } = require('playwright');
const path = require('path');
const BASE = process.env.KIT_BASE || 'http://localhost:5201';
const OUT = path.join(__dirname, 'out', 'kit');
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const party = (page) => page.evaluate(() => ({ score: window.__party.score, ended: window.__party.ended, frozen: window.__party.frozen, leftMs: window.__party.leftMs }));
const layout = (page) =>
  page.evaluate(() => {
    window.scrollTo(0, 200);
    const de = document.documentElement;
    let wide = 0;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5)) wide++;
    }
    return { scrollY: window.scrollY, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight, wide };
  });
const noScroll = (l) => l.scrollY === 0 && l.sw <= l.iw && l.sh <= l.ih && l.wide === 0;
const canvasHash = (page) => page.evaluate(() => { const c = document.querySelector('.pa-stage-game canvas'); return c ? c.toDataURL().length + ':' + c.toDataURL().slice(-400) : null; });

async function tapUntilScore(page, vp, min) {
  for (let i = 0; i < 1500; i++) {
    const x = 40 + ((i * 53) % (vp.width - 80));
    const y = 140 + ((i * 97) % (vp.height - 260));
    await page.touchscreen.tap(x, y);
    if (i % 5 === 4 && (await party(page)).score >= min) return;
  }
}

async function run(name, device) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  const vp = page.viewportSize();
  const shot = (f) => page.screenshot({ path: path.join(OUT, `${name}-${f}.png`) });

  // 1. index
  await page.goto(`${BASE}/dev.html`);
  await page.waitForSelector('.dv-card');
  await shot('1-index');
  check(`${name} index: 6 cards`, (await page.locator('.dv-card').count()) === 6);
  let l = await layout(page);
  check(`${name} index: no scroll / overflow`, noScroll(l), l);

  // 2. demo game (kit loop + input + fx) with a manual freeze
  await page.goto(`${BASE}/dev.html?game=demo&seed=7&duration=26000`);
  await page.waitForSelector('.pa-stage-game canvas');
  await tapUntilScore(page, vp, 2);
  let s = await party(page);
  check(`${name} demo: scored by tapping`, s.score >= 2, s);
  await shot('2-demo-midgame');
  l = await layout(page);
  check(`${name} demo: no scroll / overflow`, noScroll(l), l);

  await page.evaluate(() => window.__party.freeze(3500));
  await sleep(400);
  const f1 = await party(page);
  const h1 = await canvasHash(page);
  for (let i = 0; i < 25; i++) await page.touchscreen.tap(40 + i * 12, 200 + i * 15); // dropped
  await sleep(900);
  const f2 = await party(page);
  const h2 = await canvasHash(page);
  await shot('3-demo-frozen');
  check(`${name} demo: frozen flag + HUD state`, f1.frozen && f2.frozen && (await page.locator('.pa-stage.is-frozen').count()) === 1, f2);
  check(`${name} demo: time stands still while frozen`, f1.leftMs === f2.leftMs, [f1.leftMs, f2.leftMs]);
  check(`${name} demo: score stands still while frozen (taps dropped)`, f1.score === f2.score, [f1.score, f2.score]);
  check(`${name} demo: frame stands still while frozen`, h1 !== null && h1 === h2);
  await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 6000 });
  await sleep(700);
  const r1 = await party(page);
  const h3 = await canvasHash(page);
  check(`${name} demo: time continues after the freeze`, r1.leftMs < f2.leftMs && r1.leftMs > f2.leftMs - 1500, [f2.leftMs, r1.leftMs]);
  check(`${name} demo: frame moves again`, h3 !== h2);
  await tapUntilScore(page, vp, r1.score + 1);
  const r2 = await party(page);
  check(`${name} demo: scoring works again`, r2.score !== r1.score, [r1.score, r2.score]);

  await page.waitForFunction(() => window.__party.leftMs < 3600 && window.__party.leftMs > 0, null, { timeout: 40000 });
  await sleep(120);
  await shot('4-demo-last-seconds');
  check(`${name} demo: urgency cue`, (await page.locator('.pa-stage.is-urgent').count()) === 1);
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 8000 });
  await sleep(500);
  await shot('5-demo-end');
  s = await party(page);
  const shown = await page.locator('.dv-end-score').textContent();
  check(`${name} demo: end screen shows final score`, s.ended && Number(shown.replace(/,/g, '')) === s.score, { shown, s });
  check(`${name} demo: game torn down`, (await page.locator('.pa-stage-game canvas').count()) === 0);
  l = await layout(page);
  check(`${name} end: no scroll / overflow`, noScroll(l), l);
  await page.locator('[data-act=again]').tap();
  await page.waitForSelector('.pa-stage-game canvas');
  check(`${name} again: restarts`, !(await party(page)).ended);

  // 3. every placeholder game through the registry, with ?freezeAt
  for (const id of ['tap', 'icy', 'flappy', 'plotzel', 'ninja']) {
    await page.goto(`${BASE}/dev.html?game=${id}&seed=1&duration=5000&freezeAt=1500&freezeMs=1500`);
    await page.waitForSelector('.pa-hud');
    await page.waitForFunction(() => window.__party && window.__party.gameId, null, { timeout: 5000 });
    for (let i = 0; i < 6; i++) await page.touchscreen.tap(vp.width / 2, vp.height / 2);
    const before = await party(page);
    await page.waitForFunction(() => window.__party.frozen, null, { timeout: 5000 });
    const a = await party(page);
    for (let i = 0; i < 6; i++) await page.touchscreen.tap(vp.width / 2, vp.height / 2);
    await sleep(600);
    const b = await party(page);
    if (id === 'tap') await shot('6-tap-frozen');
    check(`${name} ${id}: scored ${before.score}, frozen at 1500ms of round time, nothing moves`, before.score > 0 && a.leftMs === 3500 && b.leftMs === 3500 && a.score === b.score, { a, b });
    await page.waitForFunction(() => window.__party.ended, null, { timeout: 9000 });
    const e = await party(page);
    check(`${name} ${id}: ended with score kept`, e.ended && e.score >= b.score, e);
  }
  await shot('7-ninja-end');

  // 4. gallery: art + sounds + victory track
  await page.goto(`${BASE}/dev.html?kit=1`);
  await page.waitForSelector('.dv-art-cell img');
  await shot('8-gallery');
  for (const act of ['sfx-tap', 'sfx-fart', 'fart-3', 'sfx-drumroll', 'sfx-fanfare', 'sfx-laugh', 'sfx-boo', 'sfx-explode', 'victory']) {
    await page.locator(`[data-act="${act}"]`).scrollIntoViewIfNeeded();
    await page.locator(`[data-act="${act}"]`).tap();
    await sleep(60);
  }
  await sleep(600);
  const audio = await page.evaluate(async () => {
    const a = await import('/src/kit/audio.ts');
    const m = await import('/src/kit/music.ts');
    const ctx = a.getAudioContext();
    const an = ctx.createAnalyser();
    a.getAudioOutput().connect(an);
    const buf = new Float32Array(an.fftSize);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 50));
      an.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
    }
    const playing = m.isTrackPlaying('victory');
    m.stopTrack(undefined, 200);
    await new Promise((r) => setTimeout(r, 700));
    an.getFloatTimeDomainData(buf);
    let after = 0;
    for (const v of buf) after = Math.max(after, Math.abs(v));
    a.setMuted(true); const muted = a.isMuted(); a.setMuted(false);
    m.playTrack('nope'); m.playTrack('nope', { fallback: 'fanfare' }); m.stopTrack('nope', 0);
    return { state: ctx.state, peak, playing, after, stillPlaying: m.isTrackPlaying('victory'), muted, file: m.hasTrackFile('victory') };
  });
  check(`${name} audio: victory synth audible, stopTrack fades to silence`, audio.state === 'running' && audio.peak > 0.02 && audio.playing && audio.after < 0.001 && !audio.stillPlaying && audio.muted, audio);
  l = await layout(page);
  check(`${name} gallery: page itself does not scroll`, l.scrollY === 0 && l.sw <= l.iw && l.sh <= l.ih, l);

  check(`${name}: no console errors / warnings / 4xx`, errors.length === 0, errors.slice(0, 6));
  await browser.close();
}

(async () => {
  await run('iphone14', devices['iPhone 14']);
  await run('pixel7', devices['Pixel 7']);
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
