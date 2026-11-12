// sweep-phone-back: the "back" gesture in the middle of a game.
// Android's edge swipe (and iOS Safari's) is a history back. A guest slicing in ninja or holding a
// side in icy starts touches at the screen edge. The page keeps no history entry of its own
// (only replaceState), so "back" leaves the game. Here: a phone opened from another page (the QR
// scanner / a chat link = a previous history entry), back in the middle of the round, forward again
// after 1.5 s. What does the guest get back?
//
// It starts its OWN game server on PORT 8951 (stop any other first) and needs vite:
//   PARTY_SERVER_PORT=8951 PARTY_CLIENT_PORT=5351 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/sweep-phone-back.cjs
// Outputs: tests/e2e/out/sweep-phone-/back/
const { spawn } = require('child_process');
const path = require('path');
const S = require('./sweep-phone-lib.cjs');

const { L } = S;
const OUT = path.join(S.OUT_ROOT, 'back');
const log = S.makeLog('back', OUT);
const PORT = 8951;

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
    const p = await S.openProfile(browser, 'pixel7', log);
    // the page the guest came from (a chat message with the link, the QR scanner's web view)
    await p.goto(`${L.CLIENT}/manifest.webmanifest`);
    await L.join(p, code, 'חוזר אחורה');
    await L.exitFs(p);
    const hist = await p.evaluate(() => history.length);
    const guard = await p.evaluate(() => typeof window.onpopstate === 'function' || typeof window.onbeforeunload === 'function');
    console.log(`[back] history.length ${hist}, popstate/beforeunload handler on window: ${guard}`);
    const bots = await S.addPlanBots(code, 2, (i) => `בוט ${i + 1}`, (g, i) => (g === 'flappy' ? { raw: 9000 + i, finalAtMs: 25000 } : { raw: 1 + i, finalAtMs: 1000 }));
    for (const game of ['ninja', 'icy', 'flappy']) {
      await host.call('host:start', { gameId: game });
      await L.waitScreen(p, 'playing', 20000);
      if (game === 'flappy') await p.evaluate(() => window.__flappy && window.__flappy.autopilot(true)).catch(() => {});
      await L.sleep(4000);
      const before = await S.playInfo(p);
      await S.sweepShot(p, OUT, `${game}-1-before-back`, log, { allowSmall: true });
      const url = p.url();
      const t0 = Date.now();
      await p.goBack({ timeout: 10000 }).catch((e) => console.log('[back] goBack', e.message.split('\n')[0]));
      const away = p.url();
      await L.sleep(1500);
      await p.goForward({ timeout: 15000 }).catch((e) => console.log('[back] goForward', e.message.split('\n')[0]));
      if (p.url() !== url) await p.goto(url);
      await L.waitFor(async () => ['playing', 'late', 'sending', 'suspense', 'results', 'win', 'reveal'].includes(await L.screen(p)), 20000, 'back in').catch(() => {});
      await L.sleep(1500);
      if (game === 'flappy') await p.evaluate(() => window.__flappy && window.__flappy.autopilot(true)).catch(() => {});
      const scr = await L.screen(p);
      const after = await S.playInfo(p);
      const fl = game === 'flappy' ? await p.evaluate(() => window.__flappy && { mode: window.__flappy.mode, raw: window.__flappy.raw }).catch(() => null) : null;
      await S.sweepShot(p, OUT, `${game}-2-after-back`, log, { allowSmall: true });
      console.log(`[back] ${game}: back went to ${away.replace(L.CLIENT, '')}; ${Date.now() - t0} ms later the phone shows "${scr}" (score before ${before && before.score}, after ${after && after.score}${fl ? `, flappy ${JSON.stringify(fl)}` : ''})`);
      log.check(away === url, 'back-leaves-game', `${game}`, `one back gesture in the middle of ${game} leaves the game page (went to ${away.replace(L.CLIENT, '')}); after coming straight back the phone shows "${scr}"`);
      await host.call('host:endRound', {}).catch(() => {});
      await L.waitFor(() => host.state().phase === 'results', 10000, 'results').catch(() => {});
      await host.call('host:lobby', {}).catch(() => {});
      await L.waitScreen(p, 'lobby', 20000).catch(() => {});
    }
    bots.close();
  } catch (e) {
    log.issue('flow', 'back', e.stack || e.message);
  } finally {
    host.close();
    await browser.close();
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  }
  process.exit(log.summary() ? 1 : 0);
})();
