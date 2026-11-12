// QA of "שימי טאפ": full rounds by scripted players through real CDP touch events.
// Needs vite (QA_BASE, default :5221; e.g. PARTY_CLIENT_PORT=5321 npx vite --config tests/e2e/qa-icy-vite.config.mjs).
//   node tests/e2e/qa-tap-play.cjs players|degenerate|all [seed] [WxH] [fps]
//   node tests/e2e/qa-tap-play.cjs fair [seed]       same scripted taps at 60 Hz and 20 fps, 320x568 and 430x932
// Prints each player's raw score, time in the picking phase, digs and BIG boogers.
const { chromium, check, fails, sleep, outDir, mulberry, openGame, tapAt, touch, party } = require('./qa-tap-lib.cjs');
const GAMES_MAXRAW = 300; // GAMES.tap.maxRaw in shared/protocol.ts
const OUT = outDir('qa-tap');
const MODE = process.argv[2] || 'all';
const SEED = Number(process.argv[3] || 11);
const VP = (process.argv[4] || '').split('x').map(Number);
const FPS = Number(process.argv[5] || 0);
const DURATION = Number(process.env.QA_DURATION || 60000);

/**
 * Strategy = tap interval (ms), fingers per tap, aim (in head radii), where to tap.
 * clumsy: ~3 taps/s, irregular, lapses, an excited flurry now and then.
 */
const STRATS = {
  clumsy: { every: [260, 520], lapse: 0.06, lapseMs: [500, 1000], flurry: 0.04, flurryEvery: [170, 230], flurryLen: [6, 13], aim: 1.05 },
  normal: { every: [150, 185], lapse: 0.02, lapseMs: [300, 500], aim: 0.8 },
  expert: { every: [95, 105], lapse: 0, lapseMs: [0, 0], aim: 0.6 },
  // degenerate
  mash5: { every: [230, 270], fingers: 5, anywhere: true },
  mash5face: { every: [230, 270], fingers: 5, aim: 0.8 },
  hold: { hold: true },
  hud: { every: [95, 105], onHud: true },
};

async function play(name, page, cdp, strat, rndSeed) {
  const rnd = mulberry(rndSeed);
  const rng = (a, b) => a + (b - a) * rnd();
  const vp = page.viewportSize();
  let taps = 0;
  let last = null;
  let flurry = 0;
  const pending = [];
  const head = await page.evaluate(() => window.__tap());
  if (strat.hold) await touch(cdp, 'touchStart', [{ x: head.x, y: head.y, id: 7 }]);
  for (;;) {
    const t0 = Date.now();
    const st = await page.evaluate(() => ({ d: window.__tap ? window.__tap() : null, ended: window.__party.ended, left: window.__party.leftMs }));
    // stop just before time-up: a queued tap landing on the harness end screen would press "again"
    if (st.ended || !st.d || st.left < 250) break;
    last = st.d;
    if (strat.hold) {
      await sleep(200);
      continue;
    }
    if (strat.lapse && flurry === 0 && rnd() < strat.lapse) {
      await sleep(rng(strat.lapseMs[0], strat.lapseMs[1]));
      continue;
    }
    let wait = rng(strat.every[0], strat.every[1]);
    if (strat.flurry) {
      if (flurry > 0) {
        flurry--;
        wait = rng(strat.flurryEvery[0], strat.flurryEvery[1]);
      } else if (rnd() < strat.flurry) flurry = Math.round(rng(strat.flurryLen[0], strat.flurryLen[1]));
    }
    const pts = [];
    const n = strat.fingers || 1;
    for (let i = 0; i < n; i++) {
      if (strat.onHud) pts.push({ x: rng(10, vp.width - 10), y: rng(4, Math.max(6, st.d.hudTop - 6)) });
      else if (strat.anywhere) pts.push({ x: rng(4, vp.width - 4), y: rng(st.d.hudTop + 4, vp.height - 4) });
      else {
        const a = rnd() * Math.PI * 2;
        const rr = Math.sqrt(rnd()) * st.d.r * strat.aim;
        pts.push({ x: st.d.x + Math.cos(a) * rr, y: st.d.y + Math.sin(a) * rr });
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
  return { taps, last };
}

const DEVICES = ['iPhone 14', 'Pixel 7', 'iPhone SE', 'Galaxy S9+', 'iPhone 14 Pro Max', 'Pixel 5', 'iPhone 12'];

async function finish(p, name) {
  await p.page.waitForFunction(() => window.__party.ended, null, { timeout: 20000 });
  const final = (await party(p.page)).score;
  await p.page.screenshot({ path: `${OUT}/round-${name}-end.png` });
  await p.context.close();
  return final;
}

async function round(browser, names, opts = {}) {
  const pages = [];
  for (const [i, n] of names.entries()) {
    const o = VP[0] ? { viewport: { width: VP[0], height: VP[1] } } : { device: DEVICES[i % DEVICES.length] };
    pages.push({ n, ...(await openGame(browser, 'tap', { ...o, fps: FPS || undefined, query: `seed=${SEED}&duration=${DURATION}` })) });
  }
  await Promise.all(pages.map((p) => p.page.waitForFunction(() => window.__tap && window.__tap() !== null)));
  const t0 = Date.now();
  const runs = await Promise.all(pages.map((p, i) => play(p.n, p.page, p.cdp, STRATS[p.n], 1000 + i)));
  const res = {};
  for (const [i, p] of pages.entries()) {
    const raw = await finish(p, p.n);
    const d = runs[i].last || {};
    res[p.n] = { raw, taps: runs[i].taps, hits: d.hits, misses: d.misses, bounces: d.bounces, pickS: +((d.pickingMs || 0) / 1000).toFixed(1), digs: d.digs, big: d.bigBoogers, picks: d.picks, errors: p.errors.length };
  }
  console.log(`round of ${((Date.now() - t0) / 1000).toFixed(1)} s`, opts.label || '', JSON.stringify(res));
  return res;
}

/** The same scripted tap timeline (ms after GO) at 60 Hz and at 20 fps, on two screen sizes. */
async function fair(browser) {
  const r = mulberry(4242);
  const timeline = [];
  let t = 400;
  // 2 s slow, 8 s at 7/s, 2 s pause, 6 s at 9/s, 3 s at 4/s: rises, picks, exits, picks again
  while (t < 2400) (timeline.push(t), (t += 330 + r() * 60));
  while (t < 10400) (timeline.push(t), (t += 135 + r() * 20));
  t += 2000;
  while (t < 18400) (timeline.push(t), (t += 105 + r() * 15));
  while (t < 21400) (timeline.push(t), (t += 240 + r() * 30));
  const out = [];
  for (const vp of [{ width: 320, height: 568 }, { width: 430, height: 932 }]) {
    for (const fps of [0, 20]) {
      const g = await openGame(browser, 'tap', { viewport: vp, fps: fps || undefined, query: `seed=${SEED}&duration=24000&freezeAt=0&freezeMs=1500` });
      await g.page.waitForFunction(() => window.__tap && window.__tap() && window.__party.frozen);
      const d = await g.page.evaluate(() => window.__tap());
      await g.page.waitForFunction(() => !window.__party.frozen, null, { polling: 4, timeout: 5000 });
      const go = Date.now();
      const pend = [];
      for (const at of timeline) {
        const w = go + at - Date.now();
        if (w > 0) await sleep(w);
        pend.push(tapAt(g.cdp, [{ x: d.x + 6, y: d.y + 12 }]));
      }
      await Promise.all(pend);
      await g.page.waitForFunction(() => window.__party.ended, null, { timeout: 15000 });
      const e = await g.page.evaluate(() => window.__party.score);
      out.push({ vp: `${vp.width}x${vp.height}`, fps: fps || 60, score: e, errors: g.errors.length });
      await g.context.close();
    }
  }
  console.table(out);
  const scores = out.map((o) => o.score);
  const spread = Math.max(...scores) - Math.min(...scores);
  check('fair: same scripted taps -> same score on 320x568 / 430x932 at 60 Hz / 20 fps (within 1%)', spread <= Math.max(2, Math.max(...scores) * 0.01), scores);
  check('fair: no console errors', out.every((o) => o.errors === 0));
  return out;
}

module.exports = { STRATS, play };

if (require.main === module)
  (async () => {
    const browser = await chromium.launch();
    if (MODE === 'fair') {
      await fair(browser);
      await browser.close();
      console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
      process.exit(fails.length ? 1 : 0);
    }
    const all = {};
    if (MODE === 'players' || MODE === 'all') Object.assign(all, await round(browser, ['clumsy', 'normal', 'expert']));
    if (MODE === 'degenerate' || MODE === 'all') Object.assign(all, await round(browser, ['mash5', 'mash5face', 'hold', 'hud']));
    console.table(all);
    const s = (k) => (all[k] ? all[k].raw : null);
    if (all.expert) {
      check('expert > normal > clumsy > 0', s('expert') > s('normal') && s('normal') > s('clumsy') && s('clumsy') > 0, [s('expert'), s('normal'), s('clumsy')]);
      check('expert clearly above normal (>= 1.25x)', s('expert') >= s('normal') * 1.25);
      check('normal clearly above clumsy (>= 2x), clumsy clearly above zero (> 80)', s('normal') >= s('clumsy') * 2 && s('clumsy') > 80);
      check('expert far from maxRaw (< 60%)', s('expert') < GAMES_MAXRAW * 0.6, s('expert'));
      check('clumsy reaches the picking phase now and then', (all.clumsy.picks || 0) >= 1, all.clumsy.picks);
    }
    if (all.mash5) {
      check('hold scores nothing (one tap at most)', s('hold') <= 1, s('hold'));
      check('taps only on the HUD score nothing', s('hud') === 0 && (all.hud.hits || 0) === 0 && (all.hud.misses || 0) === 0, s('hud'));
      if (all.expert) {
        check('mash 5 fingers anywhere < normal', s('mash5') < s('normal'), [s('mash5'), s('normal')]);
        check('5 fingers on the face < one fast finger (expert)', s('mash5face') < s('expert'), [s('mash5face'), s('expert')]);
      }
    }
    for (const [k, v] of Object.entries(all)) check(`${k}: no console errors`, v.errors === 0);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
    process.exit(fails.length ? 1 : 0);
  })();
