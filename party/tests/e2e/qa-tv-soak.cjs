// qa-tv-soak: the TV page left open for a long party (default 30 min) with 30 bots playing
// round after round (5 games, the podium, a new competition, again). Every minute it samples
// the DOM size, the JS heap, live timers and the leftovers of the funny layer; during races it
// measures the frame time (requestAnimationFrame deltas) under a 4x CPU slowdown.
//
//   PARTY_SERVER_PORT=8813 PARTY_TEST_DURATION_MS=20000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8813 PARTY_CLIENT_PORT=5213 npx vite        (or BASE_URL=<built app>)
//   MINUTES=30 node tests/e2e/qa-tv-soak.cjs
const { chromium } = require('playwright');
const path = require('path');
const { sleep, outDir, checker, openHost, state, spawnBots } = require('./qa-tv-lib.cjs');

const MINUTES = Number(process.env.MINUTES || 30);
const PLAYERS = Number(process.env.PLAYERS || 30);
const { check, failures } = checker();
const dir = outDir('soak');

/** Counts live intervals / timeouts / rAF callbacks (installed before the app runs). */
const COUNTERS = () => {
  const live = new Set();
  const liveT = new Set();
  const si = window.setInterval.bind(window);
  const ci = window.clearInterval.bind(window);
  const st = window.setTimeout.bind(window);
  const ct = window.clearTimeout.bind(window);
  window.setInterval = (fn, ms, ...a) => {
    const id = si(fn, ms, ...a);
    live.add(id);
    return id;
  };
  window.clearInterval = (id) => {
    live.delete(id);
    ci(id);
  };
  window.setTimeout = (fn, ms, ...a) => {
    const id = st(
      (...b) => {
        liveT.delete(id);
        if (typeof fn === 'function') fn(...b);
      },
      ms,
      ...a,
    );
    liveT.add(id);
    return id;
  };
  window.clearTimeout = (id) => {
    liveT.delete(id);
    ct(id);
  };
  window.__timers = () => ({ intervals: live.size, timeouts: liveT.size });
};

const sample = (page) =>
  page.evaluate(() => ({
    phase: window.__host.state().phase,
    nodes: document.getElementsByTagName('*').length,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    ...window.__timers(),
    stickers: document.querySelectorAll('.sh-sticker, .sh-fun-sticker, [class*=sticker]').length,
    canvases: document.querySelectorAll('canvas').length,
    audios: document.querySelectorAll('audio, video').length,
  }));

/** rAF deltas for `ms`: p50 / p95 / worst frame and fps. */
const frames = (page, ms) =>
  page.evaluate(
    (dur) =>
      new Promise((res) => {
        const d = [];
        let last = performance.now();
        const t0 = last;
        const step = (t) => {
          d.push(t - last);
          last = t;
          if (t - t0 < dur) requestAnimationFrame(step);
          else {
            d.sort((a, b) => a - b);
            const q = (p) => +d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(1);
            res({ n: d.length, fps: +((d.length * 1000) / dur).toFixed(1), p50: q(0.5), p95: q(0.95), worst: q(1) });
          }
        };
        requestAnimationFrame(step);
      }),
    ms,
  );

(async () => {
  const browser = await chromium.launch();
  let bots = null;
  const samples = [];
  const fps = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.addInitScript(COUNTERS);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push('console ' + m.text()));
    const base = (process.env.BASE_URL || 'http://localhost:5213').replace(/\/+$/, '');
    await page.goto(base + '/host.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(base + '/host.html');
    await page.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 20000 });
    const code = await page.evaluate(() => window.__host.state().code);
    bots = spawnBots(code, PLAYERS, ['--play', '--churn', '0.02']);
    await page.waitForFunction((n) => window.__host.state().players.length >= n, PLAYERS, { timeout: 30000 });
    await page.mouse.click(960, 300);
    const cdp = await ctx.newCDPSession(page);

    const t0 = Date.now();
    let nextSample = 0;
    let rounds = 0;
    let competitions = 0;
    let lastPhase = '';
    let phaseSince = Date.now();
    while (Date.now() - t0 < MINUTES * 60_000) {
      const st = await state(page);
      if (st.phase !== lastPhase) {
        lastPhase = st.phase;
        phaseSince = Date.now();
        if (st.phase === 'playing') {
          rounds++;
          // the race under a 4x slower CPU, after the first seconds
          await sleep(4000);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          const f = await frames(page, 5000);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
          fps.push({ round: rounds, game: st.round && st.round.gameId, ...f });
          console.log(`   race ${rounds} (${st.round && st.round.gameId}) 4x CPU: ${f.fps} fps, p50 ${f.p50} ms, p95 ${f.p95} ms, worst ${f.worst} ms`);
          if (rounds % 5 === 1) await page.screenshot({ path: path.join(dir, `race-${rounds}.png`) });
        }
      }
      const idle = Date.now() - phaseSince;
      if (st.cutscene) {
        // let the TV play it
      } else if (st.phase === 'lobby' && idle > 2500) {
        await page.keyboard.press('Space');
      } else if (st.phase === 'results' && idle > 22000) {
        await page.keyboard.press('Space');
      } else if (st.phase === 'final' && idle > 20000) {
        await page.screenshot({ path: path.join(dir, `final-${competitions}.png`) });
        competitions++;
        await page.keyboard.press('Enter');
        await sleep(1000);
        await page.keyboard.press('Enter');
      }
      if (Date.now() - t0 >= nextSample) {
        nextSample += 60_000;
        const s = { min: Math.round((Date.now() - t0) / 60000), ...(await sample(page)) };
        samples.push(s);
        console.log('  ', JSON.stringify(s));
      }
      await sleep(500);
    }
    await page.screenshot({ path: path.join(dir, 'end.png') });
    console.log(`   ${rounds} rounds, ${competitions} competitions in ${MINUTES} min`);
    // compare like with like: lobby samples at the start vs the end
    const lob = samples.filter((s) => s.phase === 'lobby' || s.phase === 'results');
    const first = samples[1] || samples[0];
    const last = samples[samples.length - 1];
    const maxNodes = Math.max(...samples.map((s) => s.nodes));
    const maxInt = Math.max(...samples.map((s) => s.intervals));
    check(maxNodes < 3000, `DOM stays small (max ${maxNodes} elements)`);
    check(maxInt <= Math.max(12, (first ? first.intervals : 0) + 4), `no growing intervals (start ${first && first.intervals}, max ${maxInt})`);
    check(last.timeouts < 200, `no pile of timeouts (${last.timeouts} at the end)`);
    if (first && first.heapMB !== null) check(last.heapMB < first.heapMB * 2.5 + 20, `JS heap does not keep growing (${first.heapMB} → ${last.heapMB} MB)`);
    const slow = fps.filter((f) => f.fps < 28);
    check(fps.length > 0 && slow.length <= Math.ceil(fps.length * 0.2), `races keep about 30 fps under 4x CPU (${fps.length - slow.length}/${fps.length} at 28+ fps)`, slow);
    check(errors.length === 0, 'no console errors', errors.slice(0, 5));
    console.log('   lobby/results samples:', lob.map((s) => s.nodes).join(' '));
  } catch (e) {
    console.error(e);
    failures.push(String(e));
  } finally {
    if (bots) bots.stop();
    await browser.close();
  }
  console.log(failures.length === 0 ? 'qa-tv-soak: ALL OK' : `qa-tv-soak: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
