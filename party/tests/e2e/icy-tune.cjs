// icy difficulty probe: several bot "players" in parallel, reports the floors of every run.
// node tests/e2e/icy-tune.cjs [durationMs]   (vite on :5212)
const { chromium, devices } = require('playwright');
const BASE = process.env.ICY_BASE || 'http://localhost:5212';
const DUR = Number(process.argv[2] || 40000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STRATS = {
  // random sides, random holds: a first-timer mashing
  novice: (i) => [Math.random() < 0.5 ? -1 : 1, 150 + Math.random() * 700, Math.random() * 350],
  // holds one side long, then the other
  alternator: (i) => [[1, 900, 0], [-1, 700, 0], [1, 600, 120], [-1, 1100, 0], [1, 500, 0]][i % 5],
  holdRight: () => [1, 5000, 0],
  // short taps, both sides
  tapper: (i) => [i % 3 === 0 ? -1 : 1, 90, 160],
};

async function play(browser, name, seed) {
  const context = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await context.newPage();
  const vp = page.viewportSize();
  await page.goto(`${BASE}/dev.html?game=icy&seed=${seed}&duration=${DUR}`);
  await page.waitForSelector('.pa-stage-game canvas');
  const runs = new Map();
  let last = '';
  const poll = setInterval(async () => {
    try {
      const s = await page.evaluate(() => { const c = document.querySelector('.pa-stage-game canvas'); return c ? c.dataset.icy : null; });
      if (!s) return;
      last = s;
      const [r, f] = s.split('|').map(Number);
      runs.set(r, Math.max(runs.get(r) || 0, f));
    } catch {}
  }, 100);
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < DUR - 300) {
    const [side, ms, gap] = STRATS[name](i++);
    await page.mouse.move(side < 0 ? vp.width * 0.2 : vp.width * 0.8, vp.height * 0.7);
    await page.mouse.down();
    await sleep(Math.min(ms, DUR - (Date.now() - t0)));
    await page.mouse.up();
    if (gap) await sleep(gap);
  }
  await sleep(600);
  clearInterval(poll);
  const score = await page.evaluate(() => window.__party.score);
  await context.close();
  return { name, seed, runs: [...runs.values()], last, score };
}

(async () => {
  const browser = await chromium.launch();
  const jobs = [];
  for (const name of Object.keys(STRATS)) for (const seed of [3, 11]) jobs.push(play(browser, name, seed));
  for (const r of await Promise.all(jobs)) console.log(r.name.padEnd(11), 'seed', r.seed, 'floors per run', JSON.stringify(r.runs), 'score', r.score);
  await browser.close();
})();
