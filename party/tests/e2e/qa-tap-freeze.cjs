// Freeze + input edge cases of tap and ninja, through real CDP touches.
//   node tests/e2e/qa-tap-freeze.cjs [tap|ninja|both]
// tap: freeze in the first second, mid-combo, with the hand half way up, mid-dig, mid BIG booger
//      stretch, with boogers sliding down the glass, in the last second: the state and the pixels
//      stand still, taps do nothing, the meter does not drain, and it resumes exactly; a finger held
//      across a freeze; a touch made before GO; taps on the HUD; a resting palm; touchcancel.
// ninja: freeze mid-swipe, during the bomb stun, in the first and last second; touchcancel;
//      a fast swipe that jumps over a fruit between two move events; a touch made before GO.
const path = require('path');
const { chromium, check, fails, sleep, outDir, openGame, touch, tapAt } = require('./qa-tap-lib.cjs');
const OUT = outDir('qa-tap');
const OUTN = outDir('qa-ninja');
const WHICH = process.argv[2] || 'both';

const tapState = (page) => page.evaluate(() => window.__tap && window.__tap());
const party = (page) => page.evaluate(() => ({ score: window.__party.score, frozen: window.__party.frozen, leftMs: window.__party.leftMs, ended: window.__party.ended }));
const nState = (page) =>
  page.evaluate(() => {
    const n = window.__ninja;
    return { elapsed: n.elapsedMs, sliced: n.sliced, bombs: n.bombsHit, score: n.score, stunned: n.stunned, snap: n.snapshot(), steps: n.steps };
  });

async function waitTap(page, pred, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    const d = await tapState(page);
    if (d && pred(d)) return d;
    if (Date.now() - t0 > timeout) throw new Error('waitTap timeout');
    await sleep(20);
  }
}

/** Tap the face every `every` ms until pred(state) holds; returns that state. */
async function spamUntil(page, cdp, pred, every = 100, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    const d = await tapState(page);
    if (d && pred(d)) return d;
    if (Date.now() - t0 > timeout) throw new Error('spamUntil timeout ' + JSON.stringify(d));
    tapAt(cdp, [{ x: d.x + 5, y: d.y + 15 }]);
    await sleep(every);
  }
}

const SAME_KEYS = ['elapsedMs', 'meter', 'phase', 'score', 'digs', 'bigBoogers', 'bigActive', 'hits', 'misses', 'bounces', 'combo', 'glass', 'pile', 'handY', 'frame', 'queued', 'pickingMs'];
const diffKeys = (a, b) => SAME_KEYS.filter((k) => a[k] !== b[k]);

/**
 * Freeze for `ms`; the state (meter included) and the game's pixels must stand still and taps
 * must do nothing; after the freeze it continues from the same point.
 */
async function tapFreezeCheck(page, cdp, label, ms = 2500, slug = '') {
  await page.evaluate((m) => window.__party.freeze(m), ms);
  await sleep(150);
  const a = await tapState(page);
  const pa = await party(page);
  const vp = page.viewportSize();
  const clip = { x: 0, y: a.hudTop, width: vp.width, height: vp.height - a.hudTop };
  const shotA = await page.screenshot({ clip });
  for (let i = 0; i < 8; i++) {
    await tapAt(cdp, [{ x: a.x, y: a.y }]);
    await sleep(60);
  }
  await sleep(600);
  const b = await tapState(page);
  const pb = await party(page);
  const shotB = await page.screenshot({ clip });
  if (slug) await page.screenshot({ path: path.join(OUT, `freeze-${slug}.png`) });
  const moved = diffKeys(a, b);
  check(`tap ${label}: frozen: game time, meter, phase, digs, boogers, hand stand still; taps dropped`, pa.frozen && moved.length === 0 && pa.leftMs === pb.leftMs, { moved, a: [a.elapsedMs, a.meter, a.phase, a.score, a.glass], b: [b.elapsedMs, b.meter, b.phase, b.score, b.glass] });
  check(`tap ${label}: frozen frame is pixel-identical (nothing moves)`, shotA.equals(shotB));
  await page.waitForFunction(() => !window.__party.frozen, null, { timeout: ms + 3000 });
  const c = await tapState(page);
  check(`tap ${label}: resumes where it stopped (meter, digs, combo kept, clock continues)`, c.elapsedMs >= b.elapsedMs && c.elapsedMs - b.elapsedMs < 400 && c.digs >= b.digs && c.score >= b.score && Math.abs(c.meter - b.meter) < 0.3, { before: [b.elapsedMs, b.meter, b.digs, b.combo], after: [c.elapsedMs, c.meter, c.digs, c.combo] });
  return { a, b, c };
}

async function tapSuite(browser) {
  // freezeAt=0: frozen from the start for 2 s (like the phone during the 3-2-1)
  const { page, cdp, context, errors } = await openGame(browser, 'tap', { device: 'iPhone SE', query: 'seed=5&duration=60000&freezeAt=0&freezeMs=2000' });
  await page.addStyleTag({ content: '.dv-freeze{display:none!important}' });
  await page.waitForFunction(() => window.__tap && window.__tap() && window.__party.frozen);
  // a touch made before GO, held through GO, then lifted: nothing
  const d0 = await tapState(page);
  await touch(cdp, 'touchStart', [{ x: d0.x, y: d0.y, id: 1 }]);
  await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 5000 });
  await sleep(200);
  await touch(cdp, 'touchMove', [{ x: d0.x + 3, y: d0.y + 2, id: 1 }]);
  await touch(cdp, 'touchEnd', []);
  let d = await tapState(page);
  check('tap: a finger put down before GO scores nothing', d.hits === 0 && d.misses === 0 && d.score === 0, d);

  // taps on the HUD: ignored (no miss, no combo break)
  for (let i = 0; i < 5; i++) await tapAt(cdp, [{ x: 40 + i * 50, y: 20 }]);
  await sleep(100);
  d = await tapState(page);
  check('tap: taps on the HUD are ignored', d.hits === 0 && d.misses === 0, d);

  // first second: freeze right away
  for (let i = 0; i < 3; i++) await tapAt(cdp, [{ x: d.x, y: d.y }]);
  await tapFreezeCheck(page, cdp, 'first second');

  // the hand half way up: ~4 taps/s until the meter is in the middle
  await spamUntil(page, cdp, (s) => s.phase === 'rising' && s.meter > 0.42 && s.meter < 0.75, 230);
  const half = await tapFreezeCheck(page, cdp, 'hand half way up', 2500, '1-hand-half');
  check('tap hand half way: the meter did not drain during the freeze', half.a.meter === half.b.meter && half.a.handY === half.b.handY, [half.a.meter, half.b.meter]);

  // mid-dig: spam until the finger is in and digging, freeze right after a dig
  await spamUntil(page, cdp, (s) => s.phase === 'picking' && s.digs >= 3 && !s.bigActive, 95);
  const dig = await tapFreezeCheck(page, cdp, 'mid-dig', 2500, '2-mid-dig');
  check('tap mid-dig: still picking right after the freeze (did not slip out while frozen)', dig.c.phase === 'picking', dig.c.phase);

  // mid BIG booger stretch
  await spamUntil(page, cdp, (s) => s.bigActive, 95, 40000);
  await sleep(250);
  const big = await tapFreezeCheck(page, cdp, 'mid BIG booger stretch', 2500, '3-big-stretch');
  check('tap BIG booger: the stretch kept its place through the freeze', big.c.bigActive || big.c.bigBoogers === big.b.bigBoogers, big.c);

  // mid-combo: the combo survives a freeze
  const mc = await spamUntil(page, cdp, (s) => s.combo >= 22, 100);
  const comb = await tapFreezeCheck(page, cdp, 'mid-combo');
  check('tap mid-combo: combo >= 20 (x2) kept through the freeze', comb.c.combo >= 20 && comb.c.mult >= 2, [mc.combo, comb.c.combo]);

  // boogers sliding down the glass: stop tapping, let them slide a moment, freeze
  await sleep(700);
  const sl = await waitTap(page, (s) => s.glass > 0, 5000);
  const slide = await tapFreezeCheck(page, cdp, 'boogers sliding', 2500, '4-sliding');
  check('tap sliding: boogers were on the glass during the freeze', slide.a.glass > 0, sl.glass);

  // a finger held across a freeze: down on the face, freeze, lift during the freeze, nothing extra
  {
    const f = await tapState(page);
    await touch(cdp, 'touchStart', [{ x: f.x, y: f.y, id: 2 }]);
    await sleep(80);
    const s1 = await tapState(page);
    await page.evaluate(() => window.__party.freeze(1500));
    await sleep(300);
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 4000 });
    await sleep(100);
    const s2 = await tapState(page);
    check('tap: a finger held across a freeze counts once (its down), the lift during the freeze nothing', s2.hits === s1.hits && s2.misses === s1.misses && s2.score === s1.score, { s1: [s1.hits, s1.score], s2: [s2.hits, s2.score] });
  }

  // touchcancel (a notification): down + cancel = the down counted, nothing else breaks
  {
    const f = await tapState(page);
    await touch(cdp, 'touchStart', [{ x: f.x, y: f.y, id: 3 }]);
    await touch(cdp, 'touchCancel', []);
    await sleep(120);
    await tapAt(cdp, [{ x: f.x, y: f.y }]);
    await sleep(120);
    const g = await tapState(page);
    check('tap: touchcancel leaves the game working', g.hits >= f.hits + 1 && errors.length === 0, { before: f.hits, after: g.hits });
  }

  // palm: a big contact resting on the tray, while another finger taps the face
  {
    const f = await tapState(page);
    const vp = page.viewportSize();
    await touch(cdp, 'touchStart', [{ x: vp.width * 0.5, y: vp.height - 30, id: 9, r: 40 }]);
    await sleep(60);
    const p1 = await tapState(page);
    for (let i = 0; i < 10; i++) {
      const q = await tapState(page);
      // with this Chromium's CDP, touchStart presses the listed new points and touchEnd lifts the listed ones
      await touch(cdp, 'touchStart', [{ x: q.x, y: q.y, id: 20 + i }]);
      await touch(cdp, 'touchEnd', [{ x: q.x, y: q.y, id: 20 + i }]);
      await sleep(130);
    }
    await touch(cdp, 'touchEnd', []);
    await sleep(60);
    const p2 = await tapState(page);
    check('tap: a resting palm costs one miss at most; taps beside it all count', p2.misses - f.misses <= 1 && p2.hits - p1.hits === 10, { misses: p2.misses - f.misses, hits: p2.hits - p1.hits });
  }

  // last second
  await page.waitForFunction(() => window.__party.leftMs < 900, null, { timeout: 60000, polling: 50 });
  await tapFreezeCheck(page, cdp, 'last second', 2000);
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 5000 });
  check('tap: no console errors', errors.length === 0, errors.slice(0, 3));
  await context.close();
}

async function ninjaFreeze(page, cdp, label, ms = 2000, during) {
  await page.evaluate((m) => window.__party.freeze(m), ms);
  await sleep(100);
  const a = await nState(page);
  if (during) await during();
  await sleep(600);
  const b = await nState(page);
  check(`ninja ${label}: frozen: throws stand still, nothing scores, stun keeps its time`, a.snap === b.snap && a.elapsed === b.elapsed && a.score === b.score && a.sliced === b.sliced && a.stunned === b.stunned, { a: [a.elapsed, a.score, a.stunned], b: [b.elapsed, b.score, b.stunned] });
  await page.waitForFunction(() => !window.__party.frozen, null, { timeout: ms + 3000 });
  await sleep(30);
  const c = await nState(page);
  check(`ninja ${label}: continues where it stopped`, c.elapsed >= b.elapsed && c.elapsed - b.elapsed < 300, [b.elapsed, c.elapsed]);
  return { a, b, c };
}

/** Wait for a fruit near its peak (slow) in a comfortable spot, return it. */
async function waitFruit(page, kind = 'fruit', timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    const ts = await page.evaluate(() => window.__ninja.targets());
    const vp = page.viewportSize();
    const bombs = ts.filter((t) => t.kind === 'bomb');
    const f = ts.find((t) => t.kind === kind && Math.abs(t.vy) < 220 && t.y > 140 && t.y < vp.height - 120 && t.x > 60 && t.x < vp.width - 60 && bombs.every((b) => Math.hypot(b.x - t.x, b.y - t.y) > t.r * 4));
    if (f) return { f, ts };
    if (Date.now() - t0 > timeout) return null;
    await sleep(15);
  }
}

async function ninjaSuite(browser) {
  const { page, cdp, context, errors } = await openGame(browser, 'ninja', { device: 'Pixel 7', query: 'seed=9&duration=60000&freezeAt=0&freezeMs=2000' });
  await page.waitForFunction(() => !!window.__ninja && window.__party.frozen);
  const vp = page.viewportSize();
  // a finger put down before GO and dragged after GO across the first fruit: no cut
  await touch(cdp, 'touchStart', [{ x: 20, y: vp.height * 0.4, id: 1 }]);
  await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 5000 });
  const w0 = await waitFruit(page);
  if (w0) {
    const f = w0.f;
    for (let i = 0; i <= 8; i++) await touch(cdp, 'touchMove', [{ x: 20 + ((vp.width - 40) * i) / 8, y: f.y, id: 1 }]);
  }
  await touch(cdp, 'touchEnd', []);
  let s = await nState(page);
  check('ninja: a finger put down before GO cuts nothing after GO', s.sliced === 0 && s.score === 0, s);

  // first second (of play) freeze
  await ninjaFreeze(page, cdp, 'first second');

  // a fast swipe that jumps over a fruit between two moves: start 3R left, ONE move to 3R right
  {
    const w = await waitFruit(page);
    const before = await nState(page);
    const f = w.f;
    await touch(cdp, 'touchStart', [{ x: f.x - f.r * 3, y: f.y, id: 5 }]);
    await touch(cdp, 'touchMove', [{ x: f.x + f.r * 3, y: f.y + 2, id: 5 }]);
    await touch(cdp, 'touchEnd', []);
    await sleep(80);
    const after = await nState(page);
    check('ninja: a swipe that jumps over a fruit in one move still cuts it (segment test)', after.sliced === before.sliced + 1, { before: before.sliced, after: after.sliced, fruit: f });
  }

  // freeze mid-swipe: down + half a swipe, freeze, the rest of the swipe during and after the freeze cuts nothing
  {
    const w = await waitFruit(page);
    const f = w.f;
    await touch(cdp, 'touchStart', [{ x: f.x - f.r * 4, y: f.y, id: 6 }]);
    await touch(cdp, 'touchMove', [{ x: f.x - f.r * 2.5, y: f.y, id: 6 }]);
    await sleep(20);
    const r = await ninjaFreeze(page, cdp, 'mid-swipe', 1800, async () => {
      // the hand keeps going while the TV plays
      await touch(cdp, 'touchMove', [{ x: f.x, y: f.y, id: 6 }]);
      await touch(cdp, 'touchMove', [{ x: f.x + f.r * 3, y: f.y, id: 6 }]);
    });
    await touch(cdp, 'touchMove', [{ x: f.x - f.r * 3, y: f.y, id: 6 }]);
    await touch(cdp, 'touchMove', [{ x: f.x + f.r * 3, y: f.y, id: 6 }]);
    await touch(cdp, 'touchEnd', []);
    await sleep(80);
    const after = await nState(page);
    check('ninja mid-swipe: the held finger is cancelled by the freeze and cuts nothing after it', after.sliced === r.c.sliced, { atResume: r.c.sliced, after: after.sliced });
  }

  // touchcancel mid-swipe: what was not cut yet stays uncut
  {
    const w = await waitFruit(page);
    const before = await nState(page);
    const f = w.f;
    await touch(cdp, 'touchStart', [{ x: f.x - f.r * 4, y: f.y, id: 7 }]);
    await touch(cdp, 'touchMove', [{ x: f.x - f.r * 3, y: f.y, id: 7 }]);
    await touch(cdp, 'touchCancel', []);
    await sleep(100);
    const after = await nState(page);
    check('ninja: touchcancel mid-swipe cuts nothing, game keeps running', after.sliced === before.sliced && after.elapsed > before.elapsed && errors.length === 0, { before: before.sliced, after: after.sliced });
  }

  // bomb stun: cut a bomb on purpose, freeze inside the stun
  {
    let hit = false;
    const t0 = Date.now();
    while (!hit && Date.now() - t0 < 30000) {
      const ts = await page.evaluate(() => window.__ninja.targets());
      const b = ts.find((t) => t.kind === 'bomb' && Math.abs(t.vy) < 300 && t.y > 140 && t.y < vp.height - 120);
      if (b) {
        await touch(cdp, 'touchStart', [{ x: b.x - b.r * 2, y: b.y, id: 8 }]);
        await touch(cdp, 'touchMove', [{ x: b.x + b.r * 2, y: b.y, id: 8 }]);
        await touch(cdp, 'touchEnd', []);
        await sleep(60);
        hit = (await nState(page)).stunned;
      } else await sleep(20);
    }
    check('ninja: cut a bomb on purpose (stunned)', hit);
    if (hit) {
      await page.screenshot({ path: path.join(OUTN, 'freeze-1-stun.png') });
      const st0 = await nState(page);
      await ninjaFreeze(page, cdp, 'during the bomb stun', 2500);
      const st1 = await nState(page);
      check('ninja stun: still stunned right after a 2.5 s freeze (stun is 1.2 s of game time)', st1.stunned === true, { before: st0.stunned, after: st1.stunned });
    }
  }

  // last second
  await page.waitForFunction(() => window.__party.leftMs < 900, null, { timeout: 60000, polling: 50 });
  await ninjaFreeze(page, cdp, 'last second', 1500);
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 5000 });
  check('ninja: no console errors', errors.length === 0, errors.slice(0, 3));
  await context.close();
}

/** The page stalls 3 s mid-round (locked phone / another app): the game catches up with the round clock. */
async function sleepSuite(browser, game) {
  const { page, cdp, context, errors } = await openGame(browser, game, { device: 'iPhone 14', query: 'seed=6&duration=60000' });
  await page.waitForFunction((g) => (g === 'tap' ? window.__tap && window.__tap() : !!window.__ninja), game);
  await sleep(3000);
  // the main thread stalls for 3 s (what a locked phone / app switch does to rAF): the kit
  // loop clamps that frame to 100 ms, so without a catch-up the game would be 2.9 s behind
  await page.evaluate(() => {
    const t = performance.now();
    while (performance.now() - t < 3000) {
      /* stall */
    }
  });
  await sleep(500);
  const r = await page.evaluate((g) => {
    const el = g === 'tap' ? window.__tap().elapsedMs : window.__ninja.elapsedMs;
    return { game: el, round: 60000 - window.__party.leftMs, active: g === 'ninja' ? window.__ninja.active : 0 };
  }, game);
  check(`${game}: after the page slept 3 s the game clock is back in step with the round clock (±150 ms)`, Math.abs(r.round - r.game) < 150, r);
  if (game === 'ninja') check('ninja: no flood of throws after the sleep (<= 8 in the air)', r.active <= 8, r.active);
  check(`${game} sleep: no console errors`, errors.length === 0, errors.slice(0, 3));
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  if (WHICH !== 'ninja') await sleepSuite(browser, 'tap');
  if (WHICH !== 'tap') await sleepSuite(browser, 'ninja');
  if (WHICH !== 'ninja') await tapSuite(browser);
  if (WHICH !== 'tap') await ninjaSuite(browser);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
