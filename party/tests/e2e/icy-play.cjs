// icy game check. Needs vite on :5212 (PARTY_CLIENT_PORT=5212 npx vite).
// node tests/e2e/icy-play.cjs [quick]
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.env.ICY_BASE || 'http://localhost:5212';
const OUT = path.join(__dirname, 'out', 'icy');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`);
  if (!ok) fails.push(name);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const party = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.pa-stage-game canvas');
    return { score: window.__party.score, ended: window.__party.ended, frozen: window.__party.frozen, leftMs: window.__party.leftMs, icy: c ? c.dataset.icy : null, level: c ? c.dataset.level : null };
  });
const layout = (page) =>
  page.evaluate(() => {
    window.scrollTo(0, 200);
    const de = document.documentElement;
    return { scrollY: window.scrollY, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight };
  });

// A player bot: holds one side, switches sides on a fixed rhythm (real time).
async function hold(page, vp, side, ms) {
  const x = side < 0 ? vp.width * 0.2 : vp.width * 0.8;
  await page.mouse.move(x, vp.height * 0.7);
  await page.mouse.down();
  await sleep(ms);
  await page.mouse.up();
}

async function botPlay(page, vp, totalMs, pattern) {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < totalMs) {
    if (await page.evaluate(() => window.__party.ended)) return;
    const [side, ms, gap] = pattern[i % pattern.length];
    await hold(page, vp, side, ms);
    if (gap) await sleep(gap);
    i++;
  }
}

const PATTERN = [
  [1, 900, 0],
  [-1, 700, 0],
  [1, 600, 120],
  [-1, 1100, 0],
  [1, 500, 0],
];

async function run(name, device, opts = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...device, ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  const vp = page.viewportSize();
  const shot = (f) => page.screenshot({ path: path.join(OUT, `${name}-${f}.png`) });
  const dur = opts.duration || 30000;
  await page.goto(`${BASE}/dev.html?game=icy&seed=${opts.seed || 7}&duration=${dur}`);
  await page.waitForSelector('.pa-stage-game canvas');
  let lastIcy = null;
  let shotDeath = false;
  const poll = setInterval(async () => {
    try {
      const v = await page.evaluate(() => { const c = document.querySelector('.pa-stage-game canvas'); return c ? c.dataset.icy : null; });
      if (v) {
        if (lastIcy && v.split('|')[0] !== lastIcy.split('|')[0] && !shotDeath) { shotDeath = true; shot('6b-death'); }
        lastIcy = v;
      }
    } catch {}
  }, 50);
  await sleep(500);
  await shot('1-hint');
  await sleep(1000);
  await shot('2-hint-b');
  const l = await layout(page);
  check(`${name}: no scroll`, l.scrollY === 0 && l.sw <= l.iw && l.sh <= l.ih, l);
  const start = await party(page);
  await botPlay(page, vp, 4000, PATTERN);
  await shot('3-action');
  let s = await party(page);
  console.log(name, 'after 4s', s);
  await botPlay(page, vp, 5000, PATTERN);
  await shot('4-action');
  s = await party(page);
  console.log(name, 'after 9s', s);
  // freeze in the middle of action: hold, freeze, keep holding
  await page.mouse.move(vp.width * 0.8, vp.height * 0.7);
  await page.mouse.down();
  await sleep(300);
  await page.evaluate(() => window.__party.freeze(2500));
  await sleep(300);
  const f1 = await party(page);
  const h1 = await page.evaluate(() => document.querySelector('.pa-stage-game canvas').toDataURL().length);
  await sleep(1200);
  const f2 = await party(page);
  const h2 = await page.evaluate(() => document.querySelector('.pa-stage-game canvas').toDataURL().length);
  await shot('5-frozen');
  await page.mouse.up();
  check(`${name}: frozen stands still`, f1.frozen && f2.frozen && f1.leftMs === f2.leftMs && f1.icy === f2.icy && h1 === h2, [f1, f2, h1, h2]);
  await page.waitForFunction(() => !window.__party.frozen, null, { timeout: 6000 });
  await botPlay(page, vp, 3000, PATTERN);
  await shot('6-after-freeze');
  s = await party(page);
  console.log(name, 'after freeze', s);
  await botPlay(page, vp, Math.max(0, dur - 14500), PATTERN);
  await page.waitForFunction(() => window.__party.ended, null, { timeout: 15000 });
  clearInterval(poll);
  s = await party(page);
  s.icy = lastIcy;
  await shot('7-end');
  const parts = (s.icy || '').split('|').map(Number);
  console.log(name, 'final', s, parts);
  check(`${name}: round ended, score>0`, s.ended && s.score > 0, s);
  check(`${name}: score == best run`, parts[4] === s.score && s.score === Math.max(parts[3], parts[1] * 10 + parts[2]), [parts, s.score]);
  check(`${name}: no errors`, errors.length === 0, errors);
  await browser.close();
  return { start, final: s };
}

async function determinism() {
  const browser = await chromium.launch();
  const look = async (seed) => {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();
    await page.goto(`${BASE}/dev.html?game=icy&seed=${seed}&duration=9000`);
    await page.waitForSelector('.pa-stage-game canvas');
    const level = await page.evaluate(() => document.querySelector('.pa-stage-game canvas').dataset.level);
    // no input at all: the floors scroll away and the run ends at floor 0
    let icy = null;
    for (let i = 0; i < 80; i++) {
      await sleep(100);
      const v = await page.evaluate(() => { const c = document.querySelector('.pa-stage-game canvas'); return c ? c.dataset.icy : null; });
      if (v) icy = v;
    }
    await context.close();
    return { level, icy };
  };
  const [a, b, c] = await Promise.all([look(42), look(42), look(43)]);
  console.log('determinism', a, b, c);
  check('same seed = same tower', a.level === b.level && a.icy === b.icy, [a, b]);
  check('other seed = other tower', a.level !== c.level, [a.level, c.level]);
  await browser.close();
}

async function landscape() {
  const browser = await chromium.launch();
  for (const [name, opts] of [['landscape', { ...devices['Pixel 7 landscape'] }], ['desktop', { viewport: { width: 1280, height: 720 } }]]) {
    const context = await browser.newContext(opts);
    const page = await context.newPage();
    await page.goto(`${BASE}/dev.html?game=icy&seed=5&duration=9000`);
    await page.waitForSelector('.pa-stage-game canvas');
    const vp = page.viewportSize();
    await botPlay(page, vp, 3500, PATTERN);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await context.close();
  }
  await browser.close();
}

(async () => {
  const quick = process.argv[2] === 'quick';
  await determinism();
  const a = await run('iphone14', devices['iPhone 14']);
  if (!quick) {
    await run('pixel7', devices['Pixel 7'], { duration: 20000 });
    await run('small360', devices['Pixel 7'], { viewport: { width: 360, height: 640 }, duration: 16000 });
    await landscape();
  }
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
