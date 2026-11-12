// sweep-phone-tapfreeze: does a freeze (cutscene) move the tap game's auto-start?
// One phone that never taps (Galaxy S8 profile). Round A: no freeze. Round B: a freeze at 6 s of
// round time for FREEZE_MS. The tap engine's phase / t0 / elapsed are sampled every 250 ms next to
// the server's round time (from the host's state). The auto-start must land at the end of the start
// window (startWindowMs) of ROUND time in both rounds.
//
// It starts its OWN game server on PORT 8951 (stop any other first) and needs vite:
//   PARTY_SERVER_PORT=8951 PARTY_CLIENT_PORT=5351 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/sweep-phone-tapfreeze.cjs         (DURATION=30000 FREEZE_MS=2500 CPU=1)
// Outputs: tests/e2e/out/sweep-phone-/tapfreeze/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const S = require('./sweep-phone-lib.cjs');

const { L } = S;
const OUT = path.join(S.OUT_ROOT, 'tapfreeze');
const log = S.makeLog('tapfreeze', OUT);
const PORT = 8951;
const DURATION = Number(process.env.DURATION || 30000);
const FREEZE_MS = Number(process.env.FREEZE_MS || 2500);
const FREEZE_AT = Number(process.env.FREEZE_AT || 6000);
const CPU = Number(process.env.CPU || 1);

let server = null;
async function startServer() {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, PORT: String(PORT), PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: String(DURATION) },
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
  let skew = 0;
  host.socket.on('state', (st) => (skew = st.serverNow - Date.now()));
  const elapsed = () => {
    const r = host.state() && host.state().round;
    if (!r) return null;
    return (r.frozenAt !== null ? r.frozenAt : r.resumeAt !== null && Date.now() + skew < r.resumeAt ? r.resumeAt : Date.now() + skew) - r.startAt;
  };
  const out = {};
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    const p = await S.openProfile(browser, 's8', log);
    await L.join(p, code, 'לא נוגע');
    await L.exitFs(p);
    if (CPU > 1) await (await L.cdp(p)).send('Emulation.setCPUThrottlingRate', { rate: CPU });
    const bots = await S.addPlanBots(code, 1, () => 'בוט', () => ({ raw: 3, finalAtMs: 1000 }));
    for (const withFreeze of [false, true]) {
      const tag = withFreeze ? 'freeze' : 'plain';
      await host.call('host:start', { gameId: 'tap' });
      await L.waitScreen(p, 'playing', 20000);
      const samples = [];
      let froze = false;
      let flip = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 28000) {
        const e = elapsed();
        const t = await p.evaluate(() => {
          const d = window.__tap && window.__tap();
          return d ? { phase: d.phase, t0: d.t0, auto: d.auto, el: Math.round(d.elapsedMs), win: d.startWindowMs, sprint: d.sprintMs, endAt: d.endAt, taps: d.taps } : null;
        }).catch(() => null);
        const pl = await S.playInfo(p);
        if (t) samples.push({ round: e === null ? null : Math.round(e), ...t, leftMs: pl && Math.round(pl.leftMs), frozen: pl && pl.frozen });
        if (t && t.phase !== 'waiting' && flip === null) flip = { round: e, ...t, leftMs: pl && pl.leftMs };
        if (withFreeze && !froze && e !== null && e >= FREEZE_AT) {
          froze = true;
          await host.call('host:cutscene', { id: 'joker_1' });
          await L.sleep(FREEZE_MS);
          await host.call('host:cutsceneEnd', {});
        }
        if (host.state().phase !== 'playing') break;
        await L.sleep(250);
      }
      out[tag] = { flip, samples };
      const win = flip ? flip.win : null;
      console.log(`[tapfreeze] ${tag}: sprint began at round time ${flip && Math.round(flip.round)} ms (engine elapsed ${flip && flip.el}, t0 ${flip && flip.t0}, auto ${flip && flip.auto}); window ${win} ms`);
      if (flip) log.check(flip.auto && Math.abs(flip.t0 - win) < 400 && Math.abs(flip.round - win) < 1200, 'tap-autostart-time', tag, `auto-start at round time ${Math.round(flip.round)} ms, engine t0 ${flip.t0} / elapsed ${flip.el}, window ${win} ms`);
      await S.sweepShot(p, OUT, `${tag}-end`, log, { allowSmall: true });
      await host.call('host:endRound', {}).catch(() => {});
      await L.waitFor(() => host.state().phase === 'results', 15000, 'results').catch(() => {});
      await host.call('host:lobby', {}).catch(() => {});
      await L.waitScreen(p, 'lobby', 20000).catch(() => {});
    }
    bots.close();
  } catch (e) {
    log.issue('flow', 'tapfreeze', e.stack || e.message);
  } finally {
    fs.writeFileSync(path.join(OUT, 'samples.json'), JSON.stringify(out, null, 1));
    host.close();
    await browser.close();
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  }
  process.exit(log.summary() ? 1 : 0);
})();
