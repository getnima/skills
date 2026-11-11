// Flappy check. Needs vite on :5213 (PARTY_CLIENT_PORT=5213 npx vite).
//   node tests/e2e/flappy-play.cjs [device-filter]
const { chromium, devices } = require('playwright');
const path = require('path');
const BASE = process.env.FLAPPY_BASE || 'http://localhost:5213';
const OUT = path.join(__dirname, 'out', 'flappy');
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (page) =>
  page.evaluate(() => {
    const f = window.__flappy;
    const p = window.__party;
    if (!f || !p) return null;
    return { mode: f.mode, run: f.run, best: f.best, runs: f.runs, y: f.birdY, vy: f.vy, dist: f.dist, steps: f.steps, next: f.next, score: p.score, ended: p.ended, frozen: p.frozen, leftMs: p.leftMs };
  });
const layout = (page) =>
  page.evaluate(() => {
    window.scrollTo(0, 200);
    const de = document.documentElement;
    return { scrollY: window.scrollY, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight };
  });

/**
 * Bot: taps when the face sinks below its aim point. `skill` 0..1: lower =
 * sloppier aim, more random late / missed taps (a first-timer).
 */
async function botFor(page, vp, ms, skill, onTick) {
  const end = Date.now() + ms;
  let lastTap = 0;
  let last = null;
  let rnd = 12345 + Math.round(skill * 1000);
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  while (Date.now() < end) {
    const s = await st(page);
    if (!s || s.ended) return last;
    last = s;
    if (onTick && (await onTick(s))) return s;
    if (s.mode === 'hover' || s.mode === 'glide' || s.mode === 'fly') {
      const n = s.next;
      const ahead = n.x < 30 ? n.gapY + n.gap * 0.18 : 48;
      const sloppy = (1 - skill) * (rand() - 0.5) * 22;
      const aim = ahead + sloppy;
      const minGap = 150 + (1 - skill) * 220 * rand();
      if (s.mode !== 'fly' || (s.y > aim && s.vy > -25 && Date.now() - lastTap > minGap)) {
        if (s.mode === 'fly' || rand() < 0.15) {
          const x = 40 + Math.round(rand() * (vp.width - 80));
          const y = Math.round(vp.height * (0.3 + rand() * 0.5));
          if (page.useMouse) await page.mouse.click(x, y);
          else await page.touchscreen.tap(x, y);
          lastTap = Date.now();
        }
      }
    }
    await sleep(8);
  }
  return (await st(page)) || last;
}

async function run(name, device, extra) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...device, ...(extra || {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  const vp = page.viewportSize();
  const shot = (f) => page.screenshot({ path: path.join(OUT, `${name}-${f}.png`) });

  await page.goto(`${BASE}/dev.html?game=flappy&seed=7&duration=30000`);
  await page.waitForFunction(() => !!window.__flappy, null, { timeout: 8000 });
  await sleep(900);
  let s = await st(page);
  check(`${name} starts hovering`, s.mode === 'hover' && s.dist === 0, s.mode);
  await shot('1-hint');
  const course1 = await page.evaluate(() => window.__flappy.course(30));
  let l = await layout(page);
  check(`${name} no scroll`, l.scrollY === 0 && l.sw <= l.iw && l.sh <= l.ih, l);

  // play sloppy first: a first-timer
  let shotMid = false;
  let shotDead = false;
  let shotBanner = false;
  let froze = false;
  s = await botFor(page, vp, 40000, name.includes('pixel') ? 0.55 : 0.9, async (t) => {
    if (!shotMid && t.mode === 'fly' && t.run >= 2) {
      shotMid = true;
      await shot('2-mid');
    }
    if (!shotDead && t.mode === 'dead') {
      shotDead = true;
      await sleep(60);
      await shot('3-dead');
    }
    if (!shotBanner && t.run === 5) {
      shotBanner = true;
      await sleep(150);
      await shot('4-streak');
    }
    if (!froze && t.mode === 'fly' && t.run >= 1 && t.next.x < 14 && t.next.x > 4) {
      froze = true;
      await page.evaluate(() => window.__party.freeze(2500));
      await sleep(250);
      const a = await st(page);
      for (let i = 0; i < 12; i++) await page.touchscreen.tap(100 + i * 10, 300);
      await sleep(1200);
      const b = await st(page);
      await shot('5-frozen');
      check(`${name} freeze: frozen`, a.frozen && b.frozen);
      check(`${name} freeze: bird + world stand still`, a.y === b.y && a.dist === b.dist && a.steps === b.steps && a.vy === b.vy, [a.y, b.y, a.dist, b.dist, a.steps, b.steps]);
      check(`${name} freeze: clock stands still`, a.leftMs === b.leftMs, [a.leftMs, b.leftMs]);
      await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 5000 });
      const c = await st(page);
      await sleep(250);
      const d = await st(page);
      // right after the thaw it is still where it froze, then moves on at the normal pace
      check(`${name} freeze: resumes from the same spot`, c.steps - b.steps <= 3 && Math.abs(c.dist - b.dist) < 1.5, [b.dist, c.dist, c.steps - b.steps]);
      check(`${name} freeze: then runs again`, d.steps > c.steps + 5 && (d.dist > c.dist || d.mode !== 'fly'), [c.steps, d.steps]);
    }
    return false;
  });
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 15000 });
  await sleep(100);
  const fin = await page.evaluate(() => ({ score: window.__party.score, best: window.__flappy ? window.__flappy.best : null }));
  const pre = s;
  console.log(`  ${name} runs: ${JSON.stringify(pre && pre.runs)} final score ${fin.score}`);
  check(`${name} round ended, score = best run`, pre && fin.score === Math.max(0, ...pre.runs.filter((x) => typeof x === 'number')), { fin, runs: pre && pre.runs });
  await shot('6-end');
  check(`${name} froze once`, froze);

  // determinism: same seed same course, other seed differs
  await page.goto(`${BASE}/dev.html?game=flappy&seed=7&duration=8000`);
  await page.waitForFunction(() => !!window.__flappy);
  const course2 = await page.evaluate(() => window.__flappy.course(30));
  await page.goto(`${BASE}/dev.html?game=flappy&seed=8&duration=8000`);
  await page.waitForFunction(() => !!window.__flappy);
  const course3 = await page.evaluate(() => window.__flappy.course(30));
  check(`${name} same seed = same course`, JSON.stringify(course1) === JSON.stringify(course2));
  check(`${name} other seed = other course`, JSON.stringify(course1) !== JSON.stringify(course3));
  check(`${name} no console errors`, errors.length === 0, errors.slice(0, 5));
  await browser.close();
}

async function overCard(name, device) {
  // stay alive until the last 1.7s, then let go: the round ends on the best-run card
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const vp = page.viewportSize();
  await page.goto(`${BASE}/dev.html?game=flappy&seed=3&duration=9000`);
  await page.waitForFunction(() => !!window.__flappy);
  let deadShot = false;
  await botFor(page, vp, 12000, 1, async (t) => {
    if (!deadShot && t.mode === 'dead') {
      deadShot = true;
      await page.screenshot({ path: path.join(OUT, `${name}-8-dead.png`) });
    }
    return t.leftMs < 1950;
  });
  await page.waitForFunction(() => window.__flappy && window.__flappy.mode === 'over', null, { timeout: 4000 }).catch(() => undefined);
  await sleep(300);
  const s = await st(page);
  check(`${name} over card shown`, s && s.mode === 'over', s && s.mode);
  await page.screenshot({ path: path.join(OUT, `${name}-7-over.png`) });
  if (!deadShot) {
    // a death on purpose for the screenshot: never tap after a respawn
    await page.goto(`${BASE}/dev.html?game=flappy&seed=3&duration=20000`);
    await page.waitForFunction(() => !!window.__flappy);
    await page.touchscreen.tap(200, 400);
    await page.waitForFunction(() => window.__flappy.mode === 'dead', null, { timeout: 8000 });
    await sleep(120);
    await page.screenshot({ path: path.join(OUT, `${name}-8-dead.png`) });
  }
  await browser.close();
}

async function desktop() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.useMouse = true;
  await page.goto(`${BASE}/dev.html?game=flappy&seed=7&duration=20000`);
  await page.waitForFunction(() => !!window.__flappy);
  await botFor(page, { width: 1280, height: 720 }, 6000, 1);
  await page.screenshot({ path: path.join(OUT, 'desktop-mid.png') });
  const land = await (await browser.newContext({ ...devices['iPhone 14 landscape'] })).newPage();
  await land.goto(`${BASE}/dev.html?game=flappy&seed=7&duration=20000`);
  await land.waitForFunction(() => !!window.__flappy);
  await botFor(land, land.viewportSize(), 5000, 1);
  await land.screenshot({ path: path.join(OUT, 'landscape-mid.png') });
  await browser.close();
}

(async () => {
  const filter = process.argv[2] || '';
  const list = [
    ['iphone14', devices['iPhone 14']],
    ['pixel7', devices['Pixel 7']],
    ['small360', { ...devices['Pixel 7'], viewport: { width: 360, height: 640 }, screen: { width: 360, height: 640 } }],
  ];
  for (const [n, d] of list) if (n.includes(filter)) await run(n, d);
  if ('over'.includes(filter) || filter === '') await overCard('iphone14', devices['iPhone 14']);
  if ('desktop'.includes(filter) || filter === '') await desktop();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
