// QA of "שימי טאפ": full 60 s rounds by scripted players through real CDP touch
// events, in parallel. Needs vite on :5221 (see qa-tap-lib.cjs).
//   node tests/e2e/qa-tap-play.cjs [players|degenerate|all] [seed]
// Prints each player's raw score; checks the spread and the degenerate strategies.
const { chromium, check, fails, sleep, outDir, mulberry, openGame, tapAt, touch, party } = require('./qa-tap-lib.cjs');
const GAMES_MAXRAW = 5000; // GAMES.tap.maxRaw in shared/protocol.ts
const OUT = outDir('qa-tap');
const MODE = process.argv[2] || 'all';
const SEED = Number(process.argv[3] || 11);
const DURATION = Number(process.env.QA_DURATION || 60000);

/**
 * Strategy = how often to tap, how late the eyes are (reaction), aim jitter (in face radii),
 * and how many fingers per tap. A tap aims where the face WAS `reaction` ms ago.
 */
const STRATS = {
  clumsy: { every: [200, 300], reaction: 380, aim: 1.3, lapse: 0.05, lapseMs: [500, 900] },
  normal: { every: [135, 175], reaction: 260, aim: 0.95, lapse: 0.02, lapseMs: [300, 500] },
  expert: { every: [95, 115], reaction: 170, aim: 0.6, lapse: 0, lapseMs: [0, 0] },
  // degenerate
  mash5: { every: [230, 270], fingers: 5, anywhere: true },
  mash5face: { every: [230, 270], fingers: 5, reaction: 200, aim: 0.75 },
  hold: { hold: true },
  pickonly: { every: [95, 115], reaction: 170, aim: 0.6, onlyPick: true },
};

async function play(name, page, cdp, strat, rndSeed) {
  const rnd = mulberry(rndSeed);
  const rng = (a, b) => a + (b - a) * rnd();
  const hist = [];
  const vp = page.viewportSize();
  let taps = 0;
  let last = null;
  const pending = [];
  if (strat.hold) {
    const d = await page.evaluate(() => window.__tap());
    await touch(cdp, 'touchStart', [{ x: d.x, y: d.y, id: 7 }]);
  }
  for (;;) {
    const t0 = Date.now();
    const st = await page.evaluate(() => ({ d: window.__tap ? window.__tap() : null, ended: window.__party.ended, left: window.__party.leftMs }));
    // stop just before time-up: a queued tap landing on the harness end screen would press "again"
    if (st.ended || !st.d || st.left < 250) {
      if (!st.ended && st.left >= 250) console.log(name, 'stopped early', JSON.stringify(st));
      break;
    }
    hist.push({ t: t0, d: st.d });
    last = st.d;
    while (hist.length > 2 && hist[1].t <= t0 - (strat.reaction || 0)) hist.shift();
    const seen = hist[0].d;
    if (strat.hold) {
      await sleep(200);
      continue;
    }
    if (strat.lapse && rnd() < strat.lapse) {
      await sleep(rng(strat.lapseMs[0], strat.lapseMs[1]));
      continue;
    }
    const wait = rng(strat.every[0], strat.every[1]);
    if (strat.onlyPick && !st.d.picking) {
      await sleep(30);
      continue;
    }
    const pts = [];
    const n = strat.fingers || 1;
    for (let i = 0; i < n; i++) {
      if (strat.anywhere) pts.push({ x: rng(4, vp.width - 4), y: rng(4, vp.height - 4) });
      else {
        const a = rnd() * Math.PI * 2;
        const rr = Math.sqrt(rnd()) * seen.r * strat.aim;
        pts.push({ x: seen.x + Math.cos(a) * rr, y: seen.y + Math.sin(a) * rr });
      }
    }
    pending.push(tapAt(cdp, pts));
    if (pending.length > 50) await Promise.all(pending.splice(0, 25));
    taps += n;
    const spent = Date.now() - t0;
    await sleep(Math.max(0, wait - spent));
  }
  await Promise.all(pending).catch(() => undefined);
  if (strat.hold) await touch(cdp, 'touchEnd', []);
  return { taps, hits: last ? last.hits : 0, misses: last ? last.misses : 0, picks: last ? last.picks : 0 };
}

async function round(browser, names, opts = {}) {
  const pages = [];
  for (const [i, n] of names.entries()) {
    const device = ['iPhone 14', 'Pixel 7', 'iPhone SE', 'Galaxy S9+', 'iPhone 14 Pro Max', 'Pixel 5', 'iPhone 12'][i % 7];
    pages.push({ n, device, ...(await openGame(browser, 'tap', { device, query: `seed=${SEED}&duration=${DURATION}` })) });
  }
  await Promise.all(pages.map((p) => p.page.waitForFunction(() => window.__tap && window.__tap() !== null)));
  const t0 = Date.now();
  const tapsBy = await Promise.all(pages.map((p, i) => play(p.n, p.page, p.cdp, STRATS[p.n], 1000 + i)));
  const res = {};
  for (const [i, p] of pages.entries()) {
    await p.page.waitForFunction(() => window.__party.ended, null, { timeout: 20000 }).catch(async (e) => {
      await p.page.screenshot({ path: `${OUT}/stuck-${p.n}.png` });
      console.log(p.n, 'not ended', await p.page.evaluate(() => JSON.stringify({ party: window.__party, tap: window.__tap && window.__tap(), body: document.body.innerText.slice(0, 200) })), p.errors);
      throw e;
    });
    const final = (await party(p.page)).score;
    const d = await p.page.evaluate(() => window.__tapLast || null);
    res[p.n] = { raw: final, ...tapsBy[i], device: p.device, errors: p.errors.length };
    await p.page.screenshot({ path: `${OUT}/round-${p.n}-end.png` });
    await p.context.close();
  }
  console.log(`round of ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(res));
  return res;
}

module.exports = { STRATS, play };

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  const all = {};
  if (MODE === 'players' || MODE === 'all') Object.assign(all, await round(browser, ['clumsy', 'normal', 'expert']));
  if (MODE === 'degenerate' || MODE === 'all') Object.assign(all, await round(browser, ['mash5', 'mash5face', 'hold', 'pickonly']));
  console.table(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { raw: v.raw, taps: v.taps, hits: v.hits, misses: v.misses, device: v.device }])));
  const s = (k) => (all[k] ? all[k].raw : null);
  if (all.expert) {
    check('expert > normal > clumsy', s('expert') > s('normal') && s('normal') > s('clumsy'), [s('expert'), s('normal'), s('clumsy')]);
    check('expert clearly above normal (>= 1.25x)', s('expert') >= s('normal') * 1.25);
    check('normal well above zero and above clumsy (>= 1.4x)', s('normal') > 200 && s('normal') >= s('clumsy') * 1.4);
    check('expert far from maxRaw (< 70%)', s('expert') < GAMES_MAXRAW * 0.7, s('expert'));
  }
  if (all.mash5) {
    check('hold scores nothing', s('hold') <= 5, s('hold'));
    if (all.normal) check('mash 5 fingers anywhere < normal', s('mash5') < s('normal'), [s('mash5'), s('normal')]);
    if (all.expert) {
      check('pick-only < expert/2', s('pickonly') < s('expert') / 2, [s('pickonly'), s('expert')]);
      check('5 fingers on the face <= 1.5x expert', s('mash5face') <= s('expert') * 1.5, [s('mash5face'), s('expert')]);
    }
    check('5 fingers on the face below maxRaw*0.8', s('mash5face') < GAMES_MAXRAW * 0.8, s('mash5face'));
  }
  for (const [k, v] of Object.entries(all)) check(`${k}: no console errors`, v.errors === 0);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})();
