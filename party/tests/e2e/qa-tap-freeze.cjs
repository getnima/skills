// Freeze + input edge cases of tap and ninja, through real CDP touches.
//   node tests/e2e/qa-tap-freeze.cjs [tap|ninja|both]
// tap: freeze in the first second, mid-combo, inside a nose-pick window, in the last second;
//      taps while frozen; a finger held across a freeze; a touch made before GO; taps on the HUD;
//      a resting palm; touchcancel.
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

/** Freeze for `ms`, check that nothing moves and taps score nothing, then that it continues from the same point. */
async function tapFreezeCheck(page, cdp, label, ms = 2500) {
  await page.evaluate((m) => window.__party.freeze(m), ms);
  await sleep(120);
  const a = await tapState(page);
  const pa = await party(page);
  for (let i = 0; i < 8; i++) {
    await tapAt(cdp, [{ x: a.x, y: a.y }]);
    await sleep(60);
  }
  await sleep(700);
  const b = await tapState(page);
  const pb = await party(page);
  check(`tap ${label}: frozen: game time, face, score, combo, pick state stand still; taps dropped`, pa.frozen && a.elapsedMs === b.elapsedMs && a.x === b.x && a.y === b.y && a.score === b.score && a.combo === b.combo && a.picking === b.picking && a.hits === b.hits && a.misses === b.misses && pa.leftMs === pb.leftMs, { a: [a.elapsedMs, a.score, a.combo, a.picking, pa.leftMs], b: [b.elapsedMs, b.score, b.combo, b.picking, pb.leftMs] });
  await page.waitForFunction(() => !window.__party.frozen, null, { timeout: ms + 3000 });
  await sleep(40);
  const c = await tapState(page);
  check(`tap ${label}: resumes where it stopped (combo kept, clock continues)`, c.combo === b.combo && c.elapsedMs >= b.elapsedMs && c.elapsedMs - b.elapsedMs < 400, { before: [b.elapsedMs, b.combo], after: [c.elapsedMs, c.combo] });
  return { a, b, c };
}

async function tapSuite(browser) {
  // freezeAt=0: frozen from the start for 2 s (like the phone during the 3-2-1)
  const { page, cdp, context, errors } = await openGame(browser, 'tap', { device: 'iPhone SE', query: 'seed=5&duration=60000&freezeAt=0&freezeMs=2000' });
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

  // mid-combo: 25 hits then freeze, the combo (x2) survives
  for (let i = 0; i < 25; i++) {
    const f = await tapState(page);
    if (f.picking) break;
    await tapAt(cdp, [{ x: f.x, y: f.y }]);
    await sleep(100);
  }
  const mid = await tapFreezeCheck(page, cdp, 'mid-combo');
  check('tap mid-combo: combo >= 20 (x2) kept through the freeze', mid.c.combo >= 20 && mid.c.mult >= 2, mid.c);

  // a finger held across a freeze: down on the face, freeze, lift during the freeze, nothing extra
  {
    const f = await tapState(page);
    await touch(cdp, 'touchStart', [{ x: f.x, y: f.y, id: 2 }]);
    await sleep(50);
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
    await sleep(80);
    await tapAt(cdp, [{ x: f.x, y: f.y }]);
    await sleep(80);
    const g = await tapState(page);
    check('tap: touchcancel leaves the game working', g.hits >= f.hits + 1 && errors.length === 0, { before: f.hits, after: g.hits });
  }

  // palm: a big contact resting at the bottom, while another finger taps the face
  {
    const f = await tapState(page);
    const vp = page.viewportSize();
    await touch(cdp, 'touchStart', [{ x: vp.width * 0.5, y: vp.height - 30, id: 9, r: 40 }]);
    const p1 = await tapState(page);
    for (let i = 0; i < 10; i++) {
      const q = await tapState(page);
      // with this Chromium's CDP, touchStart presses the listed new points and touchEnd lifts the listed ones
      await touch(cdp, 'touchStart', [{ x: q.x, y: q.y, id: 20 + i }]);
      await touch(cdp, 'touchEnd', [{ x: q.x, y: q.y, id: 20 + i }]);
      await sleep(110);
    }
    await touch(cdp, 'touchEnd', []);
    const p2 = await tapState(page);
    check('tap: a resting palm costs one miss at most; taps beside it all count', p2.misses - f.misses <= 1 && p2.hits - p1.hits === 10, { misses: p2.misses - f.misses, hits: p2.hits - p1.hits });
  }

  // inside a nose-pick window: freeze in the middle of it, the window keeps its remaining time
  {
    const p = await waitTap(page, (s) => s.picking, 40000);
    await sleep(350);
    await page.screenshot({ path: path.join(OUT, 'freeze-0-nosepick.png') });
    const r = await tapFreezeCheck(page, cdp, 'inside a nose-pick window');
    check('tap nose-pick: still picking right after the freeze (window did not expire while frozen)', r.c.picking === true, r.c);
    // taps after resume in the window are +5
    const before = await tapState(page);
    if (before.picking) {
      await tapAt(cdp, [{ x: before.x, y: before.y }]);
      await sleep(60);
      const after = await tapState(page);
      check('tap nose-pick: a tap right after the resume is +5', !after.picking || after.score - before.score === 5, [before.score, after.score]);
    }
    void p;
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
