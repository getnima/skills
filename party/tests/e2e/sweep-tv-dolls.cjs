// sweep-tv-dolls: how long the 30 dressed dolls take to appear on the TV lobby with a COLD cache
// (a fresh browser context: no HTTP cache, no avatar cache) under a 4x CPU slowdown, at
// 1920x1080 and 1280x720. Two cases, each with and without a "cloud" network (60 ms RTT, 25 Mbit/s,
// the laptop talking to a server in Belgium):
//   A. "guests pour in": the TV is already up (cold), 30 guests join in a burst; time from the
//      30th join until every chip's doll is drawn (data-drawn=1 and its <img> decoded).
//   B. "TV refresh": 30 guests are already in; the TV page is (re)loaded cold; time from the
//      navigation until every doll is drawn (and until the first chip shows).
// Every case runs twice (the machine is shared); both numbers are reported.
//
//   SWEEP_TREE=<temp tree> node tests/e2e/sweep-tv-dolls.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');
const L = require('./sweep-tv-lib.cjs');

const OUT = L.outDir('dolls');
const { check, failures } = L.checker();
const errors = [];
const results = [];
const N = 30;
const RUNS = Number(process.env.RUNS || 2);

async function joinMany(code, n, prefix) {
  const socks = [];
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const s = io(L.SERVER, { transports: ['websocket'], forceNew: true });
      await new Promise((res, rej) => {
        s.once('connect', res);
        s.once('connect_error', rej);
      });
      const ack = await new Promise((res) => s.emit('player:join', { code, name: `${prefix} ${i + 1}` }, res));
      if (!ack.ok) throw new Error('join failed ' + JSON.stringify(ack));
      socks.push(s);
    }),
  );
  return { close: () => socks.forEach((s) => s.close()) };
}

/**
 * Installed before the app runs: a rAF watcher that stamps (performance.now(), ms since the
 * navigation) when the room first has `n` players, the first chip, the first drawn doll, and
 * every doll drawn with its picture decoded.
 */
const DOLL_WATCH = (n) => {
  const w = { fullAt: null, firstChip: null, firstDoll: null, all: null };
  window.__dolls = w;
  const tick = () => {
    const st = window.__host && window.__host.state && window.__host.state();
    if (w.fullAt === null && st && st.players.length >= n) w.fullAt = performance.now();
    const chips = document.querySelectorAll('.hs-chip-av');
    if (chips.length > 0 && w.firstChip === null) w.firstChip = performance.now();
    let done = 0;
    for (const el of chips) {
      const img = el.querySelector('img');
      if (el.getAttribute('data-drawn') === '1' && img && img.complete && img.naturalWidth > 0) done++;
    }
    if (done > 0 && w.firstDoll === null) w.firstDoll = performance.now();
    if (w.fullAt !== null && chips.length >= n && done >= n) {
      w.all = performance.now();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const waitDolls = async (page, sinceFull) => {
  await page.waitForFunction(() => window.__dolls && window.__dolls.all !== null, null, { timeout: 120000, polling: 250 }).catch(() => undefined);
  const w = await page.evaluate(() => window.__dolls);
  const base = sinceFull ? w.fullAt : 0;
  const r = (v) => (v === null || base === null ? null : Math.round(v - base));
  return { allMs: r(w.all), firstChipMs: sinceFull ? null : r(w.firstChip), firstDollMs: r(w.firstDoll), fullAtMs: Math.round(w.fullAt || 0) };
};

async function cold(browser, vp, net) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(DOLL_WATCH, N);
  const page = await ctx.newPage();
  L.watchErrors(page, `tv ${vp.width}x${vp.height}`, errors);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: (25e6 / 8), uploadThroughput: (10e6 / 8) });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return { ctx, page, cdp };
}

(async () => {
  await L.startServer({});
  const browser = await chromium.launch();
  try {
    for (const vp of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      for (const net of [false, true]) {
        for (let run = 1; run <= RUNS; run++) {
          const tag = `${vp.width}x${vp.height}${net ? ' cloud-net' : ''} run ${run}`;
          // ── A: the TV is up, guests pour in ──
          {
            const { ctx, page } = await cold(browser, vp, net);
            const navAt = Date.now();
            await page.goto(`${L.SERVER}/host`);
            await page.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 120000 });
            const bootMs = Date.now() - navAt;
            const code = await page.evaluate(() => window.__host.state().code);
            await L.sleep(1500);
            const g = await joinMany(code, N, 'אורח');
            await page.waitForFunction((n) => window.__host.state().players.length >= n, N, { timeout: 60000 });
            const r = await waitDolls(page, true);
            await page.screenshot({ path: path.join(OUT, `A-${tag.replace(/\W+/g, '_')}.jpg`), type: 'jpeg', quality: 70 });
            const stats = await page.evaluate(() => ({ imgs: document.images.length }));
            results.push({ case: 'A pour-in', tag, bootMs, ...r, ...stats });
            console.log(L.stamp(), `A pour-in ${tag}: TV online ${bootMs} ms; all ${N} dolls ${r.allMs} ms after the 30th join (first doll ${r.firstDollMs} ms)`);
            // ── B: the same room, the TV page reloaded cold (a fresh context with the TV's key) ──
            const keys = await page.evaluate(() => ({ code: localStorage.getItem('party.host.code'), key: localStorage.getItem('party.host.key') }));
            await ctx.close();
            const c2 = await cold(browser, vp, net);
            await c2.ctx.addInitScript((k) => {
              try {
                localStorage.setItem('party.host.code', k.code);
                localStorage.setItem('party.host.key', k.key);
              } catch {
                // ignore
              }
            }, keys);
            const nav2 = Date.now();
            await c2.page.goto(`${L.SERVER}/host`, { timeout: 120000 });
            const r2 = await waitDolls(c2.page, false); // from the navigation start (performance.timeOrigin)
            const same = await c2.page.evaluate(() => window.__host.state().code);
            await c2.page.screenshot({ path: path.join(OUT, `B-${tag.replace(/\W+/g, '_')}.jpg`), type: 'jpeg', quality: 70 });
            results.push({ case: 'B reload', tag, wallMs: Date.now() - nav2, sameRoom: same === keys.code, ...r2 });
            console.log(L.stamp(), `B reload  ${tag}: same room ${same === keys.code}; first chip ${r2.firstChipMs} ms, first doll ${r2.firstDollMs} ms, all ${N} dolls ${r2.allMs} ms after navigation`);
            await c2.ctx.close();
            g.close();
            await L.sleep(1500);
          }
        }
      }
    }
  } catch (e) {
    console.error(e);
    failures.push({ msg: 'exception', extra: String(e && e.stack) });
  } finally {
    await browser.close();
    L.stopAll();
  }
  for (const r of results) {
    if (r.allMs === null) check(false, `${r.case} ${r.tag}: every doll appeared within 120 s`, r);
  }
  const worst = (c) => Math.max(...results.filter((r) => r.case === c && r.allMs !== null).map((r) => r.allMs));
  console.log(L.stamp(), `worst A pour-in ${worst('A pour-in')} ms, worst B reload ${worst('B reload')} ms`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 1));
  const bad = errors.filter((e) => e.kind !== 'warning');
  console.log(L.stamp(), `errors: ${bad.length}`, JSON.stringify(bad.slice(0, 8)));
  console.log(failures.length === 0 ? 'sweep-tv-dolls: done' : `sweep-tv-dolls: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
