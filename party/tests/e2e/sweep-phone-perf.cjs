// sweep-phone-perf: frame time of every game on the Galaxy S8 profile (360x740) under a 4x CPU
// throttle (and once at 1x for reference), in a real room of 20 (19 socket bots), with input.
// Frame time = the gap between requestAnimationFrame callbacks during play (the first second skipped).
// Flags any game whose p95 is over 50 ms.
//
// It starts its OWN game server on PORT 8951 (stop any other first) and needs vite:
//   PARTY_SERVER_PORT=8951 PARTY_CLIENT_PORT=5351 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/sweep-phone-perf.cjs            (RATES=4 to skip the 1x pass, GAMES=tap,icy)
//
// Outputs: tests/e2e/out/sweep-phone-/perf/ (frames.json, a screenshot per game, findings.jsonl)
// Caveat: headless Chromium draws canvas in software, on a shared machine: absolute numbers are
// pessimistic; compare games with each other and with the 1x pass.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./sweep-phone-lib.cjs');

const { L } = S;
const OUT = path.join(S.OUT_ROOT, 'perf');
const log = S.makeLog('perf', OUT);
const PORT = 8951;
const ROOT = path.join(__dirname, '../..');
const RATES = (process.env.RATES || '4,1').split(',').map(Number);
const GAMES = (process.env.GAMES || 'tap,icy,flappy,plotzel,ninja').split(',');
const MEASURE_MS = Number(process.env.MEASURE_MS || 14000);

let server = null;
async function startServer() {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '26000' },
    stdio: 'ignore',
    detached: true,
  });
  await L.waitFor(async () => {
    try {
      return (await fetch(`http://localhost:${PORT}/healthz`)).ok;
    } catch {
      return false;
    }
  }, 30000, 'server up');
}

const SAMPLER = `(() => {
  const s = { d: [], last: 0, on: true, long: 0, longMs: 0 };
  window.__ft = s;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!s.on) return; s.long++; s.longMs += e.duration; } }).observe({ type: 'longtask', buffered: false });
  } catch {}
  const f = (t) => { if (!s.on) return; if (s.last) s.d.push(t - s.last); s.last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
})()`;

function stats(d) {
  const a = d.slice().sort((x, y) => x - y);
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const mean = a.reduce((x, y) => x + y, 0) / (a.length || 1);
  return { n: a.length, mean: +mean.toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +a[a.length - 1].toFixed(1), over50: a.filter((x) => x > 50).length, fps: +(1000 / mean).toFixed(1) };
}

async function play(p, game, stopAt) {
  const W = p.viewportSize().width;
  const H = p.viewportSize().height;
  let i = 0;
  while (Date.now() < stopAt) {
    i++;
    try {
      if (game === 'tap') {
        await S.touchTap(p, W / 2 + ((i * 37) % 80) - 40, H * 0.6);
        await L.sleep(150);
      } else if (game === 'icy') {
        const x = i % 2 ? W * 0.2 : W * 0.8;
        await S.touchDown(p, x, H * 0.7, 5);
        await L.sleep(500 + (i % 3) * 200);
        await S.touchUp(p, x, H * 0.7, 5);
        await L.sleep(80);
      } else if (game === 'flappy') {
        await L.sleep(300);
      } else if (game === 'plotzel') {
        const keys = await p.$$('.pz-key[data-k]');
        if (keys.length) {
          const k = keys[(i * 7) % keys.length];
          const kk = await k.getAttribute('data-k');
          if (kk !== 'ENTER') await k.tap();
          if (i % 4 === 0) await p.locator('.pz-key[data-k="BACK"]').first().tap();
        }
        await L.sleep(250);
      } else if (game === 'ninja') {
        const st = await p.evaluate(() => (window.__ninja ? window.__ninja.targets() : [])).catch(() => []);
        const f = st.find((t) => t.kind !== 'bomb');
        if (f) await S.swipe(p, S.line(f.x - f.r * 1.8, f.y, f.x + f.r * 1.8, f.y, 4));
        else await S.swipe(p, S.line(W * 0.2, H * 0.5, W * 0.8, H * 0.45, 4));
        await L.sleep(250);
      }
    } catch {
      await L.sleep(200);
    }
  }
}

(async () => {
  await startServer();
  const browser = await L.launch();
  const host = S.createHost();
  const results = {};
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    const p = await S.openProfile(browser, 's8', log);
    await L.join(p, code, 'מדידה');
    await L.exitFs(p);
    const bots = await S.addPlanBots(code, 19, (i) => `בוט ${i + 1}`, (game, i) => (game === 'flappy' ? { raw: 5 + i, finalAtMs: 2000 + i * 300 } : { raw: 1 + i, finalAtMs: 1500 + i * 100 }));
    const c = await L.cdp(p);
    for (const rate of RATES) {
      await c.send('Emulation.setCPUThrottlingRate', { rate });
      for (const game of GAMES) {
        p.__label = `${game}@${rate}x`;
        await host.call('host:start', { gameId: game });
        await L.waitScreen(p, 'playing', 30000);
        await L.sleep(1000);
        if (game === 'flappy') await p.evaluate(() => window.__flappy && window.__flappy.autopilot(true)).catch(() => {});
        await p.evaluate(SAMPLER);
        const t0 = Date.now();
        const load0 = os.loadavg()[0];
        let flappySplit = null;
        if (game === 'flappy') {
          // fly (autopilot) for half, then crash and watch the out view
          await L.sleep(MEASURE_MS / 2);
          flappySplit = await p.evaluate(() => window.__ft.d.length);
          await p.evaluate(() => window.__flappy && window.__flappy.autopilot(false)).catch(() => {});
          await L.sleep(MEASURE_MS / 2);
        } else await play(p, game, t0 + MEASURE_MS);
        const d = await p.evaluate(() => {
          window.__ft.on = false;
          return { d: window.__ft.d, long: window.__ft.long, longMs: Math.round(window.__ft.longMs) };
        });
        await S.sweepShot(p, OUT, `${game}-${rate}x`, log, { allowSmall: true });
        const st = stats(d.d);
        const rec = { ...st, longTasks: d.long, longMs: d.longMs, load: +load0.toFixed(2), loadEnd: +os.loadavg()[0].toFixed(2), screen: await L.screen(p) };
        if (flappySplit !== null) {
          rec.fly = stats(d.d.slice(0, flappySplit));
          rec.outView = stats(d.d.slice(flappySplit));
        }
        if (game === 'flappy') rec.note = 'fly half with the test autopilot (window.__flappy.autopilot), then the out view';
        results[`${game}@${rate}x`] = rec;
        console.log(`[perf ${S.stamp()}] ${game} @${rate}x: ${JSON.stringify(rec)}`);
        if (rate === 4) log.check(st.p95 <= 50, 'frame-p95>50ms', `${game}@4x`, `p95 ${st.p95} ms (p50 ${st.p50}, p99 ${st.p99}, max ${st.max}, ${st.over50}/${st.n} frames over 50 ms, ${d.long} long tasks, load ${load0.toFixed(1)})`);
        if (rate === 4 && rec.fly) log.check(rec.fly.p95 <= 50 && rec.outView.p95 <= 50, 'frame-p95>50ms', `flappy-parts@4x`, `fly p95 ${rec.fly.p95}, out view p95 ${rec.outView.p95}`);
        await host.call('host:endRound', {}).catch(() => {});
        await L.waitFor(() => host.state().phase === 'results', 10000, 'results').catch(() => {});
        await L.sleep(2500);
        await host.call('host:lobby', {}).catch(() => {});
        await L.waitScreen(p, 'lobby', 30000).catch(() => {});
        await L.sleep(800);
      }
    }
    await c.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    bots.close();
  } catch (e) {
    log.issue('flow', 'perf', e.stack || e.message);
  } finally {
    fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({ when: new Date().toISOString(), cpus: os.cpus().length, results }, null, 1));
    host.close();
    await browser.close();
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  }
  process.exit(log.summary() ? 1 : 0);
})();
