// flappy (one life) in the dev harness: the start, freeze / resume, taps while frozen, input
// edge cases, the crash and the "out" view, the finale banner through a freeze, destroy.
// Real touches through CDP where a finger matters; the game's pilot (?pilot=1) elsewhere.
//   PARTY_CLIENT_PORT=5331 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   QA_BASE=http://localhost:5331 node tests/e2e/qa-flappy-life.cjs
const { chromium } = require('playwright');
const { phoneContext, createTouch, sleep, SIZES } = require('./qa-icy-lib.cjs');
const BASE = process.env.QA_BASE || 'http://localhost:5331';
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const S = (page) =>
  page.evaluate(() => {
    const f = window.__flappy;
    const p = window.__party;
    return f ? { mode: f.mode, y: f.birdY, vy: f.vy, dist: f.dist, steps: f.steps, run: f.run, raw: f.raw, hint: f.hint, rejoins: f.rejoins, cd: f.countdown, inMs: f.finaleInMs, out: f.out, frozen: p.frozen, ended: p.ended, score: p.score } : null;
  });
const same = (a, b) => a && b && ['mode', 'y', 'vy', 'dist', 'steps', 'run', 'raw'].every((k) => a[k] === b[k]);

async function open(browser, q, size = '390x844') {
  const context = await phoneContext(browser, size);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/dev.html?game=flappy&seed=21${q}`);
  await page.waitForFunction(() => !!window.__flappy, null, { timeout: 15000 });
  const touch = await createTouch(context, page);
  return { context, page, errors, touch, vp: SIZES[size] };
}
const until = (page, fn, arg, ms = 12000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 'raf' });

(async () => {
  const browser = await chromium.launch();

  // ── the start: the bird hangs for 1.5 s (the hint is up), then falls; no tap = out ──
  {
    const { context, page, errors } = await open(browser, '');
    const a = await S(page);
    check('at GO the bird hangs in the air with the "tap to fly" hint', a.mode === 'fly' && a.vy === 0 && a.hint > 0.9, a);
    await until(page, () => window.__flappy.steps >= 60);
    const b = await S(page);
    check('it still hangs after 1 s without a tap (the course already scrolls)', b.vy === 0 && b.dist > 25 && b.mode === 'fly', b);
    await until(page, () => window.__flappy.mode !== 'fly');
    const c = await S(page);
    check('no tap: it falls after 1.5 s and is out before the first obstacle (2-3 s)', c.steps > 110 && c.steps < 185 && c.run === 0, { steps: c.steps, run: c.run });
    await until(page, () => window.__flappy.mode === 'out' && window.__flappy.out !== null);
    const d = await S(page);
    check('the end card: "!נפלת" and the obstacles passed; solo: no place, no field', /נפלת/.test(d.out.verdict) && d.out.place === '' && d.out.air === '' && d.out.names.length === 0, d.out);
    check('the score is the survival distance in tenths and stays', d.raw > 300 && d.raw < 900 && d.score === d.raw, { raw: d.raw, score: d.score });
    await sleep(2500);
    const e = await S(page);
    check('one life: no restart, the round goes on for the others (not ended on this phone)', e.mode === 'out' && e.raw === d.raw && e.ended === false, e.mode);
    check('start / out: no errors', errors.length === 0, errors);
    await context.close();
  }

  // ── taps: a tap flies, a tap on the HUD strip flies, two fingers are one flap per step, taps when out do nothing ──
  {
    const { context, page, errors, touch, vp } = await open(browser, '');
    await touch.tap(vp.width / 2, vp.height / 2);
    await until(page, () => window.__flappy.vy !== 0);
    const a = await S(page);
    check('a tap flies and hides the hint', a.vy < 0 || a.y < 42, { vy: a.vy, y: a.y });
    await until(page, () => window.__flappy.vy > 20);
    await touch.tap(vp.width / 2, 20);
    await until(page, () => window.__flappy.vy < 0, null, 3000).catch(() => {});
    check('a tap on the HUD strip flies too', (await S(page)).vy < 20);
    await until(page, () => window.__flappy.vy > 20);
    await touch.down(1, vp.width * 0.3, vp.height * 0.5);
    await touch.down(2, vp.width * 0.7, vp.height * 0.6);
    await touch.up(1);
    await touch.up(2);
    await sleep(60);
    const c = await S(page);
    check('two fingers at once = a flap, no error', c.vy < 20 && c.mode === 'fly', c.vy);
    check('the hint is gone in flight', c.hint < 0.05, c.hint);
    await until(page, () => window.__flappy.mode === 'out', null, 20000);
    const o1 = await S(page);
    for (let i = 0; i < 8; i++) await touch.tap(vp.width / 2, vp.height * 0.6);
    await sleep(400);
    const o2 = await S(page);
    check('taps when out do nothing', o2.mode === 'out' && o2.raw === o1.raw);
    check('taps: no errors', errors.length === 0, errors);
    await context.close();
  }

  // ── freeze / resume in flight (the pilot flies): nothing moves, taps are dropped, it continues exactly ──
  for (const [name, at] of [['in the gentle course', 240], ['during the finale 3-2-1', 430], ['in the finale', 700]]) {
    const { context, page, errors, touch, vp } = await open(browser, '&pilot=1&finaleAt=8000&field=3');
    await until(page, (s) => window.__flappy.steps >= s, at, 20000);
    await page.evaluate(() => { window.__flappy.trace(0); window.__party.freeze(2500); });
    await sleep(200);
    const a = await S(page);
    for (let i = 0; i < 6; i++) await touch.tap(vp.width / 2, vp.height / 2);
    await sleep(900);
    const b = await S(page);
    check(`freeze ${name}: nothing moves, taps are dropped`, a.frozen && same(a, b), { a: [a.steps, a.raw], b: [b.steps, b.raw] });
    if (a.inMs !== null) check(`freeze ${name}: the finale clock stands still`, Math.abs(a.inMs - b.inMs) < 0.01, [a.inMs, b.inMs]);
    if (name.includes('3-2-1')) check(`freeze ${name}: the banner and the digit stay as they were`, a.cd !== '' && a.cd === b.cd, [a.cd, b.cd]);
    await page.evaluate(() => window.__flappy.trace(30));
    await until(page, () => !window.__party.frozen && window.__flappy.traced.length >= 20);
    const t = await page.evaluate(() => window.__flappy.traced.map((r) => [...r]));
    check(`freeze ${name}: continues with the very next step, same height, no rejoin`, t[0][0] === a.steps + 1 && Math.abs(t[0][2] - a.y) < 2 && (await S(page)).rejoins === 0, { first: t[0], frozenAt: a.steps, y: a.y });
    check(`freeze ${name}: no errors`, errors.length === 0, errors);
    await context.close();
  }

  // ── the finale in a small field: a fixed 20 s; banner without a number for a solo flight ──
  {
    const { context, page, errors } = await open(browser, '&pilot=1&field=1');
    await until(page, () => window.__flappy.steps > 10);
    const a = await S(page);
    check('2 in the field: the finale is known from GO, at 20 s of round time', a.inMs !== null && Math.abs(a.inMs - 20000) < 1500, a.inMs);
    check('field of 2: no errors', errors.length === 0, errors);
    await context.close();
  }

  // ── destroy: the harness' back button tears the game down ──
  {
    const { context, page, errors } = await open(browser, '&pilot=1');
    await until(page, () => window.__flappy.steps > 120);
    await page.evaluate(() => document.querySelector('[data-act=back]').click()).catch(() => {});
    await sleep(600);
    check('destroy: the hook and the overlay are gone', await page.evaluate(() => !window.__flappy && document.querySelector('.fl-out') === null));
    check('destroy: no errors', errors.length === 0, errors);
    await context.close();
  }

  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
