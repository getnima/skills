// Tap game ("שימי טאפ") check, played like a player. Needs vite on TAP_BASE (default :5211;
// PARTY_CLIENT_PORT=5211 npx vite). Usage: node tests/e2e/tap-play.cjs [full]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.env.TAP_BASE || 'http://localhost:5211';
const OUT = path.join(__dirname, 'out', 'tap');
fs.mkdirSync(OUT, { recursive: true });
const FULL = process.argv.includes('full');
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, device, query, extra = {}) {
  const context = await browser.newContext({ ...device, ...extra });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await page.goto(`${BASE}/dev.html?${query}`);
  await page.waitForSelector('.pa-stage-game canvas');
  // import the very module instance the registry loaded (vite adds ?t= after edits)
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.includes('/src/games/tap/index.ts')));
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/src/games/tap/index.ts')).pop();
    window.__tapMod = await import(url);
  });
  await page.waitForFunction(() => window.__tapMod.tapDebug() !== null);
  return { context, page, errors };
}
const dbg = (page) => page.evaluate(() => window.__tapMod.tapDebug());
const party = (page) => page.evaluate(() => ({ score: window.__party.score, ended: window.__party.ended, frozen: window.__party.frozen, leftMs: window.__party.leftMs }));

/** A human-ish player: looks at the face, reacts ~120 ms later, ~7 taps/s, a bit of aim jitter. */
async function bot(page, ms, onTick, human = false) {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    const d = await dbg(page);
    if (!d) break;
    last = d;
    if (onTick) await onTick(d);
    await sleep(human ? 150 : 70);
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * d.r * (human ? 1.05 : 0.7);
    await page.touchscreen.tap(d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr);
    await sleep(40);
  }
  return last;
}

async function scripted(page) {
  // slow and exact: 10 taps on the face 400 ms apart (2.5/s never fills the meter), then 2 misses
  // in a corner: 10 x 1 - 2 = 8, whatever the frame rate or the timing jitter
  const d = await dbg(page);
  for (let i = 0; i < 10; i++) {
    await page.touchscreen.tap(d.x + (i % 5) * 6 - 12, d.y + (i % 3) * 6 - 6);
    await sleep(400);
  }
  await page.touchscreen.tap(4, d.hudTop + 6);
  await sleep(300);
  await page.touchscreen.tap(4, d.hudTop + 8);
  await sleep(150);
  return dbg(page);
}

async function run(name, device) {
  const browser = await chromium.launch();
  const { page, errors } = await open(browser, device, 'game=tap&seed=7&duration=30000');
  const shot = (f) => page.screenshot({ path: path.join(OUT, `${name}-${f}.png`) });
  await sleep(350);
  await shot('1-hint');

  const s1 = await scripted(page);
  check(`${name} scripted score (10 slow taps, 2 misses = 8)`, s1.score === 8 && s1.misses === 2 && s1.hits === 10 && s1.phase !== 'picking' && s1.picks === 0, s1);
  check(`${name} HUD score == game score`, (await party(page)).score === s1.score);
  await shot('2-after-scripted');

  let pickShot = false;
  let bigShot = false;
  let frozeOnce = false;
  const end = await bot(page, 40_000, async (d) => {
    if (d.phase === 'picking' && d.digs > 4 && !pickShot) {
      pickShot = true;
      await shot('3-picking');
    }
    if (d.bigActive && !bigShot) {
      bigShot = true;
      await shot('4-big');
    }
    if (!frozeOnce && d.elapsedMs > 14_000) {
      frozeOnce = true;
      await page.evaluate(() => window.__party.freeze(3000));
      await sleep(300);
      const a = await dbg(page);
      for (let i = 0; i < 10; i++) await page.touchscreen.tap(a.x, a.y);
      await sleep(1200);
      const b = await dbg(page);
      await shot('5-frozen');
      check(`${name} freeze: game time and meter stand still`, a.elapsedMs === b.elapsedMs && a.meter === b.meter, [a.elapsedMs, b.elapsedMs, a.meter, b.meter]);
      check(`${name} freeze: nothing scores, no booger moves`, a.score === b.score && a.hits === b.hits && a.glass === b.glass && a.pile === b.pile);
      await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 6000 });
      await sleep(500);
      const c = await dbg(page);
      check(`${name} freeze: resumes`, c.elapsedMs > b.elapsedMs && c.elapsedMs - b.elapsedMs < 900, [b.elapsedMs, c.elapsedMs]);
    }
    if (d.elapsedMs > 23_500 && d.elapsedMs < 24_200) await shot('6-frenzy');
  });
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 15_000 });
  const p = await party(page);
  await shot('7-end');
  check(`${name} round ended with the game's score`, end && p.score >= end.score && p.score <= end.score + 40, { party: p.score, game: end && end.score });
  check(`${name} saw the picking phase and a BIG booger`, pickShot && bigShot, { pickShot, bigShot });
  check(`${name} no console errors`, errors.length === 0, errors.slice(0, 5));
  console.log(`${name} final`, JSON.stringify(end));
  await browser.close();
}

async function determinism() {
  const browser = await chromium.launch();
  const levels = [];
  const scores = [];
  for (const seed of [7, 7, 8]) {
    const { page, context } = await open(browser, devices['Pixel 7'], `game=tap&seed=${seed}&duration=30000`);
    levels.push(await page.evaluate(() => document.querySelector('.pa-stage-game canvas').dataset.level));
    scores.push((await scripted(page)).score);
    await context.close();
  }
  check('same seed = same level', levels[0] === levels[1], levels);
  check('other seed = other level', levels[0] !== levels[2], levels);
  check('same input = same score', scores[0] === scores[1] && scores[1] === scores[2], scores);
  await browser.close();
}

async function small() {
  const browser = await chromium.launch();
  for (const [name, vp] of [['360', { width: 360, height: 640 }], ['land', { width: 844, height: 390 }], ['desk', { width: 1280, height: 720 }]]) {
    const { page, context } = await open(browser, devices['Pixel 7'], 'game=tap&seed=3&duration=30000', { viewport: vp });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `size-${name}-1.png`) });
    const d = await dbg(page);
    check(`${name}: head target inside the field`, d.x - d.r >= 0 && d.x + d.r <= vp.width && d.y - d.r >= d.hudTop - 1 && d.y + d.r <= d.trayTop, d);
    await bot(page, 9_000, async (s) => {
      if (s.picking && s.digs === 5) {
        await page.screenshot({ path: path.join(OUT, `size-${name}-2-pick.png`) });
      }
    });
    const l = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));
    check(`${name}: no scroll`, l.sw <= l.iw && l.sh <= l.ih, l);
    await context.close();
  }
  await browser.close();
}

async function full() {
  // a 60 s round by a decent bot: where does a good player land?
  const browser = await chromium.launch();
  const { page } = await open(browser, devices['Pixel 7'], 'game=tap&seed=11');
  const end = await bot(page, 70_000);
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 15_000 });
  console.log('60s sharp bot', JSON.stringify(end), 'final', (await party(page)).score);
  const p2 = (await open(browser, devices['iPhone 14'], 'game=tap&seed=11')).page;
  const end2 = await bot(p2, 70_000, null, true);
  await p2.waitForFunction(() => window.__party.ended, null, { timeout: 15_000 });
  console.log('60s human-ish bot', JSON.stringify(end2), 'final', (await party(p2)).score);
  await browser.close();
}

(async () => {
  if (FULL) await full();
  else {
    await run('iphone14', devices['iPhone 14']);
    await run('pixel7', devices['Pixel 7']);
    await determinism();
    await small();
  }
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
