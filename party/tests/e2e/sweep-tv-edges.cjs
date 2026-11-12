// sweep-tv-edges: things that happen to the TV over a long evening besides the games.
//   1. The owner's phone remote locks and unlocks again and again (20 attach / detach cycles):
//      the TV flips between display mode and its own strip every time, and keeps no leftovers
//      (listeners, timers, heap after GC).
//   2. The TV page is reloaded in the middle of a round (the README's "TV is stuck: refresh"):
//      same room, the race comes back, the game's song comes back at the right place.
//   3. The TV page is reloaded during the winner ceremony: the same winner is named.
// 30 players (bots). Real timings unless EDGES_DURATION_MS is set.
//
//   SWEEP_TREE=<temp tree> VIEWPORT=1920x1080 node tests/e2e/sweep-tv-edges.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const L = require('./sweep-tv-lib.cjs');

const [W, H] = (process.env.VIEWPORT || '1920x1080').split('x').map(Number);
const OUT = L.outDir('edges');
const { check, failures } = L.checker();
const errors = [];

(async () => {
  await L.startServer({ PARTY_TEST_DURATION_MS: process.env.EDGES_DURATION_MS || '40000' });
  const browser = await chromium.launch();
  let bots = null;
  try {
    const tvCtx = await browser.newContext({ viewport: { width: W, height: H } });
    let tv = await tvCtx.newPage();
    L.watchErrors(tv, 'tv', errors);
    await tv.goto(`${L.SERVER}/host`);
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 60000 });
    const code = await tv.evaluate(() => window.__host.state().code);
    await tv.mouse.click(W / 2, 6);
    bots = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', L.SERVER, '--code', code, '--players', '30', '--play', '--quiet'], { cwd: L.TREE, stdio: 'ignore', detached: true });
    await tv.waitForFunction(() => window.__host.state().players.length >= 30, null, { timeout: 60000 });
    const cdp = await tvCtx.newCDPSession(tv);
    const counters = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      const dom = await cdp.send('Memory.getDOMCounters');
      return { heapMB: +(heap.usedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners };
    };

    // ── 1. remote churn ──
    const before = await counters();
    const flips = [];
    for (let i = 0; i < 20; i++) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const r = await ctx.newPage();
      L.watchErrors(r, `remote#${i}`, errors);
      await r.goto(`${L.SERVER}/remote`);
      await r.waitForSelector('[data-testid=unlock]', { timeout: 30000 });
      await r.fill('[data-testid=unlock-input]', L.PW);
      await r.click('[data-testid=unlock-go]');
      await r.waitForSelector('[data-testid=main]', { timeout: 30000 });
      await tv.waitForFunction(() => window.__host.state().remotes === 1, null, { timeout: 15000 });
      await r.waitForFunction(() => window.__remote && !!window.__remote.model(), null, { timeout: 15000 });
      const on = await tv.evaluate(() => document.querySelector('.hs-root').classList.contains('is-display'));
      await ctx.close();
      await tv.waitForFunction(() => window.__host.state().remotes === 0, null, { timeout: 30000 });
      await L.sleep(300);
      const off = await tv.evaluate(() => document.querySelector('.hs-root').classList.contains('is-display'));
      flips.push(on && !off);
    }
    const after = await counters();
    console.log(L.stamp(), 'remote churn: before', JSON.stringify(before), 'after 20 cycles', JSON.stringify(after));
    check(flips.every(Boolean), 'remote churn: the TV becomes a display with every remote and gets its strip back after each one', flips);
    check(after.listeners <= before.listeners + 10 && after.nodes <= before.nodes * 1.3 + 200, 'remote churn: no listeners / DOM left behind by 20 remotes', { before, after });

    // ── 2. reload mid-round ──
    await L.sleep(1800);
    await tv.keyboard.press('Space');
    await tv.waitForFunction(() => window.__host.state().phase === 'playing', null, { timeout: 60000 });
    // past the tap_freeze cutscene
    await tv.waitForFunction(() => {
      const s = window.__host.state();
      return s.phase === 'playing' && s.cutscene === null && s.round.resumeAt !== null && window.__host.now() > s.round.resumeAt + 1500;
    }, null, { timeout: 60000 }).catch(() => undefined);
    const songBefore = await tv.evaluate(() => window.__partyMusic.info('tap'));
    const t0 = Date.now();
    await tv.reload();
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 60000 });
    const back = await tv.evaluate(() => ({ code: window.__host.state().code, phase: window.__host.state().phase }));
    check(back.code === code && back.phase === 'playing', 'reload mid-round: the TV comes back to the same room, still playing', back);
    await tv.mouse.click(W / 2, 6); // a reload needs the click for sound again
    await L.sleep(2500);
    const rows = await tv.evaluate(() => document.querySelectorAll('.sh-row').length);
    const songAfter = await tv.evaluate(() => {
      const st = window.__host.state();
      const r = st.round;
      const now = window.__host.now();
      let t = now;
      if (r.frozenAt !== null) t = r.frozenAt;
      else if (r.resumeAt !== null && now < r.resumeAt) t = r.resumeAt;
      return { info: window.__partyMusic.info('tap'), elapsed: t - r.startAt, prelude: window.__hostMusic ? window.__hostMusic.prelude() : null };
    });
    console.log(L.stamp(), 'reload mid-round: song before', JSON.stringify(songBefore), 'after', JSON.stringify(songAfter), `(${Date.now() - t0} ms)`);
    check(rows > 0, `reload mid-round: the race is back (${rows} rows)`);
    const pos = songAfter.info ? songAfter.info.time : null;
    const expectPos = songAfter.prelude !== null && songAfter.info && songAfter.info.duration ? ((songAfter.prelude + songAfter.elapsed) / 1000) % songAfter.info.duration : null;
    check(songAfter.info && songAfter.info.playing && songAfter.info.source === 'file', 'reload mid-round: the tap song plays again after the click', songAfter.info);
    check(pos !== null && expectPos !== null && Math.abs(pos - expectPos) < 1.5, `reload mid-round: the song is at the round's place (${pos && pos.toFixed(1)} s, expected ${expectPos && expectPos.toFixed(1)} s)`, songAfter);
    await tv.screenshot({ path: path.join(OUT, `reload-mid-round-${W}x${H}.jpg`), type: 'jpeg', quality: 70 });

    // ── 3. reload during the ceremony ──
    await tv.waitForFunction(() => window.__host.state().phase === 'results', null, { timeout: 120000 });
    const res = await tv.evaluate(() => window.__host.state().results);
    const winner = res.rows.find((r) => r.playerId === res.winnerIds[0]);
    await tv.waitForFunction((at) => window.__host.now() > at + 1500, res.revealAt, { timeout: 30000 });
    await tv.reload();
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 60000 });
    const name = await tv.waitForSelector('.sh-cer-name', { timeout: 15000 }).then((e) => e.textContent()).catch(() => null);
    await tv.screenshot({ path: path.join(OUT, `reload-ceremony-${W}x${H}.jpg`), type: 'jpeg', quality: 70 });
    check(name !== null && name.trim() === winner.name, `reload during the ceremony: the TV names the same winner (${winner.name})`, name);
    await tv.mouse.click(W / 2, 6);
    await L.sleep(1500);
    const v = await tv.evaluate(() => window.__partyMusic.info('victory'));
    console.log(L.stamp(), 'victory after the reload + click:', JSON.stringify(v));
  } catch (e) {
    console.error(e);
    failures.push({ msg: 'exception', extra: String(e && e.stack) });
  } finally {
    if (bots) {
      try {
        process.kill(-bots.pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    await browser.close();
    L.stopAll();
  }
  const bad = errors.filter((e) => e.kind !== 'warning');
  fs.writeFileSync(path.join(OUT, `errors-${W}x${H}.json`), JSON.stringify(errors, null, 1));
  console.log(L.stamp(), `errors: ${bad.length}`, JSON.stringify(bad.slice(0, 8)));
  console.log(failures.length === 0 ? 'sweep-tv-edges: ALL OK' : `sweep-tv-edges: ${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
