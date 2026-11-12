// The fluent nose pick of the tap game: the picture follows the tap rate smoothly.
//  1. A ramp of tap rates (1.5, 3, 5, 8, 12 taps/s, then a stop) on a production round, the
//     picture sampled on every rendered frame: the depth and the clip position never jump
//     (no frame pops), a still face never pops in or out (only the camera flash and the final
//     frame change it at once, under the white flash), the hand goes deeper with the rate and
//     drops when the player stops.
//  2. A strip of frozen shots of the token along the ramp (OUT/strip-*.png; composed by
//     tests/e2e/qa-tap-fluent-strip.py into OUT/strip.png).
//  3. A recording of 4 s of fast tapping at 390x844, frame by frame on a virtual clock (OUT/rec/NNN.png at
//     25 fps of game time; turned into OUT/picking.webp by the strip script).
//   QA_BASE=http://localhost:5331 node tests/e2e/qa-tap-fluent.cjs [all|check|record]
const L = require('./qa-tap-comedy-lib.cjs');
const path = require('path');
const fs = require('fs');

const WHICH = process.argv[2] || 'all';
const OUT = L.outDir('tap-fluent');
const HIDE = '.pa-veil,.dv-freeze{display:none!important}';
// the ramp, in round time (the first tap at 1.5 s starts the sprint)
const RAMP = [
  { hz: 1.5, from: 1500, ms: 2600, label: '1.5/s' },
  { hz: 3, from: 4100, ms: 2400, label: '3/s' },
  { hz: 5, from: 6500, ms: 2400, label: '5/s' },
  { hz: 8, from: 8900, ms: 2400, label: '8/s' },
  { hz: 12, from: 11300, ms: 2600, label: '12/s' },
];
const STOP_AT = 13900;
const SHOTS = [2600, 3600, 4800, 5800, 7200, 8300, 9600, 10700, 12000, 13200, 14250, 14700, 15400];

const SAMPLER = `(() => {
  window.__fl = [];
  const tick = () => {
    const s = window.__tap && window.__tap();
    if (s) window.__fl.push({ e: s.elapsedMs, d: s.depth, c: s.clip, st: s.still, w: s.stillW, b: s.beat, bt: s.beatT, f: s.frame, h: s.hand, lvl: s.level, rate: s.rateSm });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

async function check(browser) {
  const { page, cdp, context, errors } = await L.openTap(browser, { viewport: { width: 390, height: 844 }, seed: 6 });
  await page.evaluate(SAMPLER);
  const times = RAMP.flatMap((r, i) => L.steady(r.hz, r.from, r.ms, 0.08, 30 + i));
  const tapping = L.tapSchedule(page, cdp, times);
  const strip = [];
  for (const at of SHOTS) {
    await L.untilElapsed(page, at);
    await page.evaluate(() => window.__party.freeze(1200));
    await L.sleep(80);
    await page.addStyleTag({ content: HIDE });
    const s = await L.st(page);
    const R = s.r;
    const clip = { x: Math.max(0, s.x - R * 1.08), y: Math.max(0, s.y - R * 1.08), width: Math.min(390, R * 2.16), height: R * 2.16 };
    const file = path.join(OUT, `strip-${String(strip.length).padStart(2, '0')}.png`);
    await page.screenshot({ path: file, clip });
    const ramp = [...RAMP].reverse().find((r) => s.elapsedMs >= r.from);
    strip.push({ file, at, label: s.elapsedMs >= STOP_AT ? 'stopped' : ramp ? ramp.label : '-', rate: +s.rateSm.toFixed(1), depth: +s.depth.toFixed(2), clip: +s.clip.toFixed(1), frame: s.frame, hand: s.hand, taps: s.taps });
    await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 5000 });
  }
  await tapping;
  await L.untilElapsed(page, 16500);
  const fl = await page.evaluate(() => window.__fl);
  await context.close();
  fs.writeFileSync(path.join(OUT, 'strip.json'), JSON.stringify(strip, null, 1));

  // per game step (1/60 s): the biggest change of the depth, the clip position and a still's weight
  let worstD = 0;
  let worstC = 0;
  let worstW = 0;
  let worstAt = null;
  for (let i = 1; i < fl.length; i++) {
    const a = fl[i - 1];
    const b = fl[i];
    const steps = (b.e - a.e) / (1000 / 60);
    if (steps < 0.5) continue; // frozen or the same step
    // the camera flash and the final frame switch the picture at once, under a white flash
    if ((b.b === 'first' && b.bt < 0.05) || (b.b === 'final' && b.bt < 0.05) || (a.b !== 'final' && b.b === 'final')) continue;
    if (a.b === null && b.b === 'first') continue;
    const dd = Math.abs(b.d - a.d) / steps;
    const dc = Math.abs(b.c - a.c) / steps;
    const dw = a.st === b.st ? Math.abs(b.w - a.w) / steps : 0;
    if (dd > worstD) worstD = dd;
    if (dc > worstC) {
      worstC = dc;
      worstAt = { a, b };
    }
    if (dw > worstW) worstW = dw;
  }
  const phase = (from, to) => fl.filter((x) => x.e >= from && x.e < to && !x.b);
  const mean = (arr, k) => (arr.length ? arr.reduce((s, x) => s + x[k], 0) / arr.length : -1);
  const late = (r) => phase(r.from + r.ms * 0.5, r.from + r.ms);
  const depths = RAMP.map((r) => +mean(late(r), 'd').toFixed(2));
  const stop = phase(STOP_AT + 1500, STOP_AT + 2500);
  const deepest = Math.max(...phase(11300, STOP_AT).map((x) => x.d));
  console.log(JSON.stringify({ samples: fl.length, worstDepthPerStep: +worstD.toFixed(3), worstClipFramesPerStep: +worstC.toFixed(2), worstStillWeightPerStep: +worstW.toFixed(3), meanDepthByRate: depths, deepest: +deepest.toFixed(2), depthAfterStop: +mean(stop, 'd').toFixed(2), worstAt }));
  L.check('the depth never jumps (at most 0.045 per 1/60 s)', worstD <= 0.045, worstD);
  L.check('the clip never pops (at most 8 clip frames of 96 per 1/60 s, about three of the 40 kept frames)', worstC <= 8, worstC);
  L.check('a still face never pops (it crossfades: at most 0.13 of its weight per 1/60 s)', worstW <= 0.13, worstW);
  L.check('the faster the taps, the deeper the finger', depths.every((d, i) => i === 0 || d > depths[i - 1] || (d >= 0.95 && depths[i - 1] >= 0.9)), depths);
  L.check('slow taps keep the hand low (fingertip not yet in at 1.5/s)', depths[0] < 0.35, depths[0]);
  L.check('fast taps put the finger all the way in (at least 0.9 at 12/s)', deepest >= 0.9, deepest);
  L.check('when the player stops, the hand comes out and drops', mean(stop, 'd') < 0.15, mean(stop, 'd'));
  L.check('no console errors', errors.length === 0, errors.slice(0, 2));
}

// A virtual clock for the recording: performance.now and requestAnimationFrame run only when the
// script steps them, so every captured frame is exactly 1/25 s of game time later than the one
// before, whatever the load on this machine (a phone at 25 fps would show these same frames).
const VCLOCK = `(() => {
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  let manual = false;
  let vt = 0;
  let id = 1e6;
  const q = new Map();
  performance.now = () => (manual ? vt : realNow());
  window.requestAnimationFrame = (cb) => {
    if (!manual) return realRaf(cb);
    id++;
    q.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (n) => {
    q.delete(n);
    realCancel(n);
  };
  let pid = 500;
  window.__vt = {
    start() {
      vt = realNow();
      manual = true;
    },
    step(ms) {
      vt += ms;
      const cbs = [...q.values()];
      q.clear();
      for (const cb of cbs) cb(vt);
    },
    tap(x, y) {
      const c = document.querySelector('.pa-stage-game canvas');
      const o = { pointerId: pid++, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true };
      c.dispatchEvent(new PointerEvent('pointerdown', o));
      c.dispatchEvent(new PointerEvent('pointerup', o));
    },
  };
})();`;

async function record(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(VCLOCK);
  const page = await context.newPage();
  await page.goto(`${L.BASE}/dev.html?game=tap&seed=8&duration=53000`);
  await page.waitForFunction(() => window.__tap && window.__tap());
  await page.addStyleTag({ content: '.dv-tools{display:none!important}' });
  await page.evaluate(() => window.__vt.start());
  const s0 = await L.st(page);
  // a fast two-thumb player: from round time 1.5 s, 1 s of build-up at 6/s, then 11/s
  const times = [...L.steady(6, 1500, 1000, 0.1, 41), ...L.steady(11, 2500, 6500, 0.1, 42)];
  const FRAME_MS = 40;
  const FROM = 3300;
  const TO = FROM + 4000;
  const dir = path.join(OUT, 'rec');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let i = 0;
  let n = 0;
  let e = s0.elapsedMs;
  while (e < TO) {
    // the touches due in this frame, then one frame of game time
    const due = [];
    while (i < times.length && times[i] <= e + FRAME_MS) due.push(i++);
    for (const k of due) await page.evaluate(([x, y]) => window.__vt.tap(x, y), [s0.x + (k % 2 ? 40 : -40), s0.y + s0.r * 0.3]);
    await page.evaluate((ms) => window.__vt.step(ms), FRAME_MS);
    e = (await L.st(page)).elapsedMs;
    if (e >= FROM) await page.screenshot({ path: path.join(dir, `${String(n++).padStart(3, '0')}.png`) });
  }
  const s = await L.st(page);
  await context.close();
  fs.writeFileSync(path.join(OUT, 'picking.json'), JSON.stringify({ frames: dir, fps: 1000 / FRAME_MS, n, taps: s.taps, depth: s.depth }));
  console.log('recorded', n, 'frames of', FRAME_MS, 'ms into', dir, 'taps', s.taps);
}

(async () => {
  const browser = await L.chromium.launch();
  if (WHICH === 'all' || WHICH === 'check') await check(browser);
  if (WHICH === 'all' || WHICH === 'record') await record(browser);
  await browser.close();
  console.log(L.fails.length ? `\n${L.fails.length} FAILED: ${L.fails.join(', ')}` : '\nALL OK');
})();
