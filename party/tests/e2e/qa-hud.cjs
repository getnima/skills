// QA of the phone's live place HUD (top of the game) and the "me bar" (bottom of every other screen).
//
//   PARTY_SERVER_PORT=8891 PARTY_TEST_FAST=1 PARTY_TEST_DURATION_MS=20000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8891 PARTY_CLIENT_PORT=5301 npx vite
//   node tests/e2e/qa-hud.cjs [flow|games|perf] (default: flow)
//
//   flow   TV host page + 3 real phones (320x568, 390x844, 412x915) + ~10 bots, two rounds:
//          live place / count / chase text against the latest `scores` message every 300 ms,
//          ▲ on an overtake, the late joiner, a cutscene freeze, a reload mid-round, the me bar
//          against the TV standings between rounds, nothing new during the suspense (60 ms poll),
//          no page scroll, no me bar over a button, nothing under the home indicator. Screenshots.
//   games  all five games inside the real stage at 320x568, 360x640, 390x844 (full flow, bots
//          playing): mid-play screenshots, HUD bottom == ctx.hudHeight, Plotzel board + keyboard fit.
//   perf   ninja frame times under 4x CPU throttle on one phone with 29 playing bots (30 players).
//
// SERVER_URL / CLIENT_URL override http://localhost:8891 / http://localhost:5301.
process.env.SERVER_URL = process.env.SERVER_URL || 'http://localhost:8891';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5301';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const L = require('./qa-phone-lib.cjs');

const OUT = path.join(__dirname, 'out', 'qa-hud');
const ROOT = path.join(__dirname, '../..');
const MODE = process.argv[2] || 'flow';
const { check, done } = L.makeChecker(`hud-${MODE}`);
fs.mkdirSync(OUT, { recursive: true });

/** Bots that join `code` and play every round (tests/load/bots.ts --play). */
function spawnBots(code, n, prefix) {
  const child = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', L.SERVER, '--code', code, '--players', String(n), '--play', '--prefix', prefix, '--quiet'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  return {
    kill() {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
    },
  };
}

async function waitPlayers(host, n, ms = 30000) {
  await L.waitFor(() => (host.state() && host.state().players.length >= n ? true : false), ms, `${n} players in the room`);
}

// ───────────────────────────── perf ─────────────────────────────

async function perf() {
  const browser = await L.launch();
  const host = L.createHost();
  let bots = null;
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    const p = await L.openPhone(browser, 'perf390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, {}, check);
    await L.join(p, code, 'מודד');
    bots = spawnBots(code, 29, 'בוט');
    await waitPlayers(host, 30);
    const c = await L.cdp(p);
    await c.send('Performance.enable');
    await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const runs = [];
    for (let round = 0; round < 2; round++) {
      await host.call('host:start', { gameId: 'ninja' });
      await L.waitScreen(p, 'playing', 30000);
      await L.sleep(2500);
      const m0 = await c.send('Performance.getMetrics');
      const frames = await p.evaluate(
        (ms) =>
          new Promise((resolve) => {
            const out = [];
            let last = performance.now();
            const t0 = last;
            let updates = 0;
            const hook = window.__playerPlay;
            let seen = hook && hook.scoresMsgs !== undefined ? hook.scoresMsgs : null;
            function f(t) {
              out.push(t - last);
              last = t;
              if (seen !== null && window.__playerPlay && window.__playerPlay.scoresMsgs !== seen) {
                updates++;
                seen = window.__playerPlay.scoresMsgs;
              }
              if (t - t0 < ms) requestAnimationFrame(f);
              else resolve({ out, updates });
            }
            requestAnimationFrame(f);
          }),
        10000,
      );
      const m1 = await c.send('Performance.getMetrics');
      const mv = (m, k) => (m.metrics.find((x) => x.name === k) || { value: 0 }).value;
      const d = (k) => mv(m1, k) - mv(m0, k);
      const sorted = [...frames.out].sort((a, b) => a - b);
      const q = (x) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))];
      const mean = frames.out.reduce((a, b) => a + b, 0) / frames.out.length;
      const r = {
        frames: frames.out.length,
        meanMs: +mean.toFixed(2),
        p50: +q(0.5).toFixed(2),
        p95: +q(0.95).toFixed(2),
        p99: +q(0.99).toFixed(2),
        over33: frames.out.filter((x) => x > 33.4).length,
        layouts: d('LayoutCount'),
        layoutMs: +(d('LayoutDuration') * 1000).toFixed(1),
        styleRecalcs: d('RecalcStyleCount'),
        styleMs: +(d('RecalcStyleDuration') * 1000).toFixed(1),
        scriptMs: +(d('ScriptDuration') * 1000).toFixed(1),
        hudUpdatesSeen: frames.updates,
      };
      console.log(`[perf] round ${round + 1}:`, JSON.stringify(r));
      runs.push(r);
      await host.call('host:endRound', {});
      await L.waitFor(() => host.state().phase === 'results', 10000, 'results');
      await L.sleep(1000);
    }
    fs.writeFileSync(path.join(OUT, `perf-${process.env.PERF_TAG || 'run'}.json`), JSON.stringify(runs, null, 2));
  } catch (err) {
    check(false, 'perf: ' + err.message);
    console.error(err);
  } finally {
    if (bots) bots.kill();
    host.close();
    await browser.close();
  }
}

(async () => {
  if (MODE === 'perf') await perf();
  else throw new Error('unknown mode ' + MODE);
  process.exit(done() ? 1 : 0);
})();
