// sweep-phone-flappyidle: four phones of different sizes that never tap in the same flappy round.
// Same seed, same physics, no input: do they fall at the same distance (same raw, same "passed N")?
// The games sweep saw "עברת מכשול אחד" on some idle phones and "עברת 0 מכשולים" on others.
//
// It starts its OWN game server on PORT 8951 (stop any other first) and needs vite:
//   PARTY_SERVER_PORT=8951 PARTY_CLIENT_PORT=5351 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/sweep-phone-flappyidle.cjs      (CPU=4 throttles every phone, ROUNDS=2)
// Outputs: tests/e2e/out/sweep-phone-/flappyidle/
const { spawn } = require('child_process');
const path = require('path');
const S = require('./sweep-phone-lib.cjs');

const { L } = S;
const OUT = path.join(S.OUT_ROOT, 'flappyidle');
const log = S.makeLog('flappyidle', OUT);
const PORT = 8951;
const CPU = Number(process.env.CPU || 1);
const ROUNDS = Number(process.env.ROUNDS || 2);

let server = null;
async function startServer() {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, PORT: String(PORT), PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '30000' },
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

(async () => {
  await startServer();
  const browser = await L.launch();
  const host = S.createHost();
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    const keys = ['se', 'ip14', 'promax', 'pixel7', 's8', 'a412'];
    const pages = [];
    for (const k of keys) {
      const p = await S.openProfile(browser, k, log);
      await L.join(p, code, `idle ${k}`);
      await L.exitFs(p);
      if (CPU > 1) await (await L.cdp(p)).send('Emulation.setCPUThrottlingRate', { rate: CPU });
      pages.push(p);
    }
    // one bot stays in the air until 20 s so the round does not end with the phones
    const bots = await S.addPlanBots(code, 2, (i) => `בוט ${i + 1}`, (g, i) => ({ raw: 9000 + i, finalAtMs: 22000 + i * 1000 }));
    for (let r = 0; r < ROUNDS; r++) {
      await host.call('host:start', { gameId: 'flappy' });
      await Promise.all(pages.map((p) => L.waitScreen(p, 'playing', 20000)));
      await Promise.all(pages.map((p) => L.waitFor(() => p.evaluate(() => window.__flappy && window.__flappy.mode !== 'fly'), 15000, 'crash').catch(() => null)));
      await L.sleep(1500);
      const res = [];
      for (const p of pages) {
        const f = await p.evaluate(() => {
          const g = window.__flappy;
          return g ? { mode: g.mode, raw: g.raw, run: g.run, dist: +g.dist.toFixed(2), steps: g.steps, rejoins: g.rejoins, layout: g.layout } : null;
        }).catch(() => null);
        const passed = await p.evaluate(() => {
          const el = [...document.querySelectorAll('#app *')].find((e) => /עברת/.test(e.textContent || '') && e.children.length === 0);
          return el ? el.textContent.trim() : null;
        }).catch(() => null);
        res.push({ k: p.__key, ...f, passed });
        await S.sweepShot(p, OUT, `r${r + 1}-out`, log, { allowSmall: true });
      }
      console.log(`[flappyidle] round ${r + 1} (cpu ${CPU}x):`);
      for (const x of res) console.log(`   ${x.k.padEnd(7)} raw ${x.raw} run ${x.run} dist ${x.dist} steps ${x.steps} rejoins ${x.rejoins} "${x.passed}" U ${x.layout && x.layout.U.toFixed(2)} ahead ${x.layout && x.layout.ahead.toFixed(1)}`);
      const raws = new Set(res.map((x) => x.raw));
      log.check(raws.size === 1, 'flappy-idle-diverge', `round ${r + 1}`, `idle phones fell at different distances: ${res.map((x) => `${x.k}=${x.raw}/${x.passed}`).join(', ')}`);
      await host.call('host:endRound', {}).catch(() => {});
      await L.waitFor(() => host.state().phase === 'results', 10000, 'results').catch(() => {});
      const rows = host.state().results ? host.state().results.rows.map((x) => `${x.name}:${x.raw}#${x.roundRank}`).join(' ') : '';
      console.log(`   server rows: ${rows}`);
      await host.call('host:lobby', {}).catch(() => {});
      await Promise.all(pages.map((p) => L.waitScreen(p, 'lobby', 20000).catch(() => null)));
    }
    bots.close();
  } catch (e) {
    log.issue('flow', 'flappyidle', e.stack || e.message);
  } finally {
    host.close();
    await browser.close();
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  }
  process.exit(log.summary() ? 1 : 0);
})();
