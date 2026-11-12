// QA of "נינג׳ה תבורי": full 60 s rounds by scripted players through real CDP touch
// events, in parallel. Needs vite on :5221 (see qa-tap-lib.cjs).
//   node tests/e2e/qa-ninja-play.cjs [players|degenerate|all] [seed]
const { chromium, check, fails, sleep, outDir, mulberry, openGame, touch, party } = require('./qa-tap-lib.cjs');
const MAX_RAW = 20000; // GAMES.ninja.maxRaw in shared/protocol.ts
const OUT = outDir('qa-ninja');
const MODE = process.argv[2] || 'all';
const SEED = Number(process.argv[3] || 11);
const DURATION = Number(process.env.QA_DURATION || 60000);

/**
 * every: ms between swipes; aim: error in body radii; clear: bomb clearance in radii
 * (0 = does not care); combo: looks for lines through several; lead: how far ahead (ms)
 * the eyes predict; misjudge: chance to ignore a bomb.
 */
const STRATS = {
  // chases one fruit at a time (any one), cuts in a random direction, does not see lines
  clumsy: { every: [480, 650], aim: 0.9, clear: 1.1, combo: false, focus: 'any', lead: 60, misjudge: 0.25, lapse: 0.1 },
  // goes for the most urgent fruit, picks the best of four cut directions through it
  normal: { every: [260, 340], aim: 0.45, clear: 1.8, combo: false, focus: 'urgent', lead: 90, misjudge: 0.06, lapse: 0.03 },
  // near-optimal: fast, accurate, and patient: waits for a line through 2+ unless a fruit is about to drop
  expert: { every: [150, 185], aim: 0.2, clear: 2.3, combo: true, patient: true, lead: 100, misjudge: 0, lapse: 0 },
  // degenerate
  scribble: { scribble: true },
  still: { still: true },
  palm: { palm: true },
};

function segDist(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + dx * t - cx, ay + dy * t - cy);
}

const read = (page) =>
  page.evaluate(() => {
    const n = window.__ninja;
    const p = window.__party;
    return { ts: n ? n.targets() : [], g: n ? n.gravityPx : 0, top: n ? n.fieldTop : 0, fh: n ? n.fieldH : 0, stunned: n ? n.stunned : false, left: p.leftMs, ended: p.ended };
  });

/** A swipe as a finger does it: down, moves every ~16 ms, up. Commands are queued, not awaited one by one. */
function swipeCmds(cdp, id, pts, stepMs = 16) {
  const all = [];
  return (async () => {
    all.push(touch(cdp, 'touchStart', [{ x: pts[0].x, y: pts[0].y, id }]));
    for (let i = 1; i < pts.length; i++) {
      await sleep(stepMs);
      all.push(touch(cdp, 'touchMove', [{ x: pts[i].x, y: pts[i].y, id }]));
    }
    await sleep(stepMs);
    all.push(touch(cdp, 'touchEnd', []));
    await Promise.all(all);
  })();
}
function line(ax, ay, bx, by, n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n });
  return out;
}

function plan(st, strat, rnd, vp) {
  const lead = (strat.lead + 50) / 1000; // + the swipe's own half duration
  const pts = st.ts.map((t) => ({ ...t, px: t.x + t.vx * lead, py: t.y + t.vy * lead + 0.5 * st.g * lead * lead }));
  const lo = st.top + 20;
  const hi = st.top + st.fh - 10;
  const bombs = pts.filter((t) => t.kind === 'bomb' && rnd() >= strat.misjudge);
  const fruit = pts.filter((t) => t.kind !== 'bomb' && t.py > lo && t.py < hi && t.px > 10 && t.px < vp.width - 10);
  if (fruit.length === 0) return null;
  const R = fruit[0].r;
  const safe = (ax, ay, bx, by) => bombs.every((b) => segDist(ax, ay, bx, by, b.px, b.py) > b.r * strat.clear);
  const cands = [];
  let pool = fruit;
  if (strat.focus === 'any') pool = [fruit[Math.floor(rnd() * fruit.length)]];
  else if (strat.focus === 'urgent') pool = [fruit.reduce((a, b) => (b.py + (b.vy > 0 ? 200 : 0) > a.py + (a.vy > 0 ? 200 : 0) ? b : a))];
  // single fruit, a few directions
  for (const f of pool) {
    for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      const L = R * 1.8;
      cands.push({ ax: f.px - Math.cos(a) * L, ay: f.py - Math.sin(a) * L, bx: f.px + Math.cos(a) * L, by: f.py + Math.sin(a) * L, f });
    }
  }
  if (strat.combo) {
    for (let i = 0; i < fruit.length; i++)
      for (let j = i + 1; j < fruit.length; j++) {
        const a = fruit[i];
        const b = fruit[j];
        const d = Math.hypot(b.px - a.px, b.py - a.py) || 1;
        const ux = (b.px - a.px) / d;
        const uy = (b.py - a.py) / d;
        cands.push({ ax: a.px - ux * R * 1.6, ay: a.py - uy * R * 1.6, bx: b.px + ux * R * 1.6, by: b.py + uy * R * 1.6, f: a });
      }
  }
  let best = null;
  if (strat.focus === 'any') {
    const ok = cands.filter((c) => safe(c.ax, c.ay, c.bx, c.by));
    best = ok.length ? { ...ok[Math.floor(rnd() * ok.length)], value: 1 } : null;
  }
  for (const c of strat.focus === 'any' ? [] : cands) {
    if (!safe(c.ax, c.ay, c.bx, c.by)) continue;
    let value = 0;
    for (const f of fruit) if (segDist(c.ax, c.ay, c.bx, c.by, f.px, f.py) < f.r * 0.8) value += f.kind === 'gold' ? 5 : 1;
    // prefer the one about to fall out (lowest, falling)
    value += c.f.vy > 0 ? (c.f.py - lo) / (hi - lo) * 0.5 : 0;
    if (!best || value > best.value) best = { ...c, value };
  }
  if (!best) return null;
  if (strat.patient && best.value < 2) {
    const urgent = fruit.some((f) => f.kind === 'gold' || (f.vy > 0 && f.py > lo + (hi - lo) * 0.55));
    if (!urgent) return null;
  }
  // aim error: the whole line is off by up to `aim` radii
  const ea = rnd() * Math.PI * 2;
  const er = Math.sqrt(rnd()) * strat.aim * R;
  const ox = Math.cos(ea) * er;
  const oy = Math.sin(ea) * er;
  return { ax: best.ax + ox, ay: best.ay + oy, bx: best.bx + ox, by: best.by + oy };
}

async function play(name, page, cdp, strat, seed) {
  const rnd = mulberry(seed);
  const rng = (a, b) => a + (b - a) * rnd();
  const vp = page.viewportSize();
  let swipes = 0;
  let id = 10;
  const pending = [];
  if (strat.still) {
    await touch(cdp, 'touchStart', [{ x: vp.width / 2, y: vp.height * 0.45, id: 1 }]);
    await page.waitForFunction(() => window.__party.leftMs < 300 || window.__party.ended, null, { timeout: DURATION + 20000, polling: 200 });
    await touch(cdp, 'touchEnd', []);
    return { swipes: 0 };
  }
  if (strat.palm) {
    // a palm resting on the lower half: three wide contacts that wobble a pixel
    const base = [
      { x: vp.width * 0.3, y: vp.height * 0.7, id: 1, r: 30 },
      { x: vp.width * 0.45, y: vp.height * 0.78, id: 2, r: 30 },
      { x: vp.width * 0.6, y: vp.height * 0.72, id: 3, r: 30 },
    ];
    await touch(cdp, 'touchStart', base);
    let k = 0;
    for (;;) {
      const st = await page.evaluate(() => ({ left: window.__party.leftMs, ended: window.__party.ended }));
      if (st.ended || st.left < 300) break;
      k++;
      await touch(cdp, 'touchMove', base.map((p, i) => ({ ...p, x: p.x + ((k + i) % 3) - 1, y: p.y + ((k * 2 + i) % 3) - 1 })));
      await sleep(30);
    }
    await touch(cdp, 'touchEnd', []);
    return { swipes: 0 };
  }
  if (strat.scribble) {
    // never lifts: sweeps the whole field left-right while drifting up and down, ~1600 px/s
    await touch(cdp, 'touchStart', [{ x: 20, y: vp.height * 0.3, id: 1 }]);
    let x = 20;
    let y = vp.height * 0.3;
    let dx = 26;
    let dy = 9;
    let n = 0;
    for (;;) {
      if (n % 8 === 0) {
        const st = await page.evaluate(() => ({ left: window.__party.leftMs, ended: window.__party.ended }));
        if (st.ended || st.left < 300) break;
      }
      n++;
      x += dx;
      y += dy;
      if (x > vp.width - 15 || x < 15) dx = -dx;
      if (y > vp.height * 0.85 || y < 120) dy = -dy;
      pending.push(touch(cdp, 'touchMove', [{ x, y, id: 1 }]));
      await sleep(16);
    }
    await Promise.all(pending);
    await touch(cdp, 'touchEnd', []);
    return { swipes: n };
  }
  for (;;) {
    const t0 = Date.now();
    const st = await read(page);
    if (st.ended || st.left < 350) break;
    if (strat.lapse && rnd() < strat.lapse) {
      await sleep(rng(400, 800));
      continue;
    }
    const p = st.stunned ? null : plan(st, strat, rnd, vp);
    if (!p) {
      await sleep(25);
      continue;
    }
    // one finger: a swipe starts after the previous one lifted (CDP describes all touches at once)
    await Promise.all(pending.splice(0));
    pending.push(swipeCmds(cdp, id++, line(p.ax, p.ay, p.bx, p.by, 4)));
    swipes++;
    const wait = rng(strat.every[0], strat.every[1]);
    await sleep(Math.max(0, wait - (Date.now() - t0)));
  }
  await Promise.all(pending);
  return { swipes };
}

async function round(browser, names, opts = {}) {
  const pages = [];
  for (const [i, n] of names.entries()) {
    const device = opts.devices ? opts.devices[i] : ['iPhone 14', 'Pixel 7', 'iPhone SE', 'Galaxy S9+'][i % 4];
    pages.push({ n, device, ...(await openGame(browser, 'ninja', { device, query: `seed=${SEED}&duration=${DURATION}` })) });
  }
  await Promise.all(pages.map((p) => p.page.waitForFunction(() => !!window.__ninja)));
  const t0 = Date.now();
  const out = await Promise.all(pages.map((p, i) => play(p.n, p.page, p.cdp, STRATS[p.n], 2000 + i)));
  const res = {};
  for (const [i, p] of pages.entries()) {
    await p.page.waitForFunction(() => window.__party.ended, null, { timeout: 20000 });
    const final = (await party(p.page)).score;
    const n = await p.page.evaluate(() => {
      const d = window.__ninja;
      return { launched: d.launched, sliced: d.sliced, golds: d.golds, bombs: d.bombsHit, combo: d.comboBonus };
    });
    res[p.n] = { raw: final, ...out[i], ...n, device: p.device, errors: p.errors.length, errorText: p.errors.slice(0, 3) };
    await p.context.close();
  }
  console.log(`round of ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return res;
}

module.exports = { STRATS, play, plan, read, swipeCmds, line, segDist };

if (require.main === module)
  (async () => {
    const browser = await chromium.launch();
    const all = {};
    if (MODE === 'players' || MODE === 'all') Object.assign(all, await round(browser, ['clumsy', 'normal', 'expert']));
    if (MODE === 'degenerate' || MODE === 'all') Object.assign(all, await round(browser, ['scribble', 'still', 'palm']));
    console.table(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { raw: v.raw, swipes: v.swipes, sliced: v.sliced, golds: v.golds, bombs: v.bombs, combo: v.combo, launched: v.launched, device: v.device }])));
    const s = (k) => (all[k] ? all[k].raw : null);
    if (all.expert) {
      check('expert > normal > clumsy', s('expert') > s('normal') && s('normal') > s('clumsy'), [s('expert'), s('normal'), s('clumsy')]);
      check('expert clearly above normal (>= 1.2x)', s('expert') >= s('normal') * 1.2);
      check('normal well above zero (> 300) and >= 1.15x clumsy', s('normal') > 300 && s('normal') >= s('clumsy') * 1.15);
      check('expert far from maxRaw (< 50%)', s('expert') < MAX_RAW * 0.5, s('expert'));
    }
    if (all.scribble) {
      check('still finger scores nothing', s('still') === 0, s('still'));
      check('resting palm scores nothing', s('palm') === 0, s('palm'));
      if (all.normal) check('scribbling non-stop < normal', s('scribble') < s('normal'), [s('scribble'), s('normal')]);
    }
    for (const [k, v] of Object.entries(all)) check(`${k}: no console errors`, v.errors === 0, v.errorText);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL OK');
    process.exit(fails.length ? 1 : 0);
  })();
