// Phone QA: first load on a bad party Wi-Fi. Slow 3G (2 s RTT, 400 kbit/s) + 4x CPU
// throttling: time until the join button works, what the join screen downloads (no game
// code), the game chunk prefetched during the intro, and join → lobby time.
//
// Starts its OWN fast game server on PARTY_SERVER_PORT (8812) serving a production build:
//   npx vite build --outDir /some/scratch/dist-client --emptyOutDir
//   QA_CLIENT_DIR=/some/scratch/dist-client node tests/e2e/qa-phone-perf.cjs
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PARTY_SERVER_PORT || '8812';
process.env.CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}`;
if (!process.env.QA_CLIENT_DIR) {
  console.error('set QA_CLIENT_DIR to a production build of the client (see the header)');
  process.exit(2);
}
const L = require('./qa-phone-lib.cjs');
const { check, done } = L.makeChecker('perf');

const SLOW3G = { offline: false, latency: 2000, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 };

(async () => {
  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, PARTY_SERVER_PORT: PORT, PARTY_CLIENT_DIR: process.env.QA_CLIENT_DIR, PARTY_TEST_FAST: '', PARTY_TEST_DURATION_MS: '8000' },
    stdio: 'ignore',
    detached: true,
  });
  await L.waitFor(async () => {
    try {
      return (await fetch(`${L.SERVER}/healthz`)).ok;
    } catch {
      return false;
    }
  }, 20000, 'server up');
  const browser = await L.launch();
  const host = L.createHost();
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    for (const name of ['pixel7', 'se320']) {
      const p = await L.openPhone(browser, name, L.PHONES[name], {}, check);
      const c = await L.cdp(p);
      await c.send('Network.enable');
      await c.send('Network.setCacheDisabled', { cacheDisabled: true });
      await c.send('Network.emulateNetworkConditions', SLOW3G);
      await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const reqs = [];
      let bytes = 0;
      c.on('Network.requestWillBeSent', (e) => reqs.push({ url: e.request.url.replace(L.CLIENT, ''), t: Date.now() }));
      c.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
      const t0 = Date.now();
      await p.goto(`${L.CLIENT}/?room=${code}`, { waitUntil: 'commit', timeout: 60000 });
      await L.waitFor(() => p.evaluate(() => {
        const b = document.querySelector('.pp-btn-go');
        return window.__player && window.__player.screen === 'join' && b && !b.disabled;
      }), 60000, 'join ready');
      const tti = Date.now() - t0;
      const joinReqs = reqs.map((r) => r.url);
      const gameAtJoin = joinReqs.filter((u) => /\/assets\/(tap|icy|flappy|plotzel|ninja)-/.test(u));
      console.log(`[perf] ${name}: join usable after ${tti} ms on slow 3G + 4x CPU, ${joinReqs.length} requests, ${Math.round(bytes / 1024)} KB on the wire`);
      check(tti < 12000, `${name}: join screen usable in ${tti} ms (< 12 s on slow 3G, 4x CPU)`);
      check(gameAtJoin.length === 0, `${name}: the join screen loads no game code (${gameAtJoin.join(', ')})`);
      await p.fill('.pp-name-input', name);
      const t1 = Date.now();
      await p.tap('.pp-btn-go');
      await L.waitScreen(p, 'lobby', 30000);
      console.log(`[perf] ${name}: join → lobby ${Date.now() - t1} ms`);
      check(Date.now() - t1 < 8000, `${name}: join → lobby in ${Date.now() - t1} ms`);
      p.__reqs = reqs;
    }
    // the intro prefetches the game: by the countdown the chunk is there
    const pages = browser.contexts().map((x) => x.pages()[0]);
    await host.call('host:start', { gameId: 'ninja' });
    const tStart = Date.now();
    await Promise.all(pages.map((p) => L.waitScreen(p, 'intro', 15000)));
    await Promise.all(pages.map((p) => L.waitScreen(p, ['countdown', 'playing'], 20000)));
    for (const p of pages) {
      const r = p.__reqs.find((x) => /\/assets\/ninja-/.test(x.url));
      check(r && r.t - tStart < 7000, `${p.__name}: game chunk requested during the intro (${r ? r.t - tStart : 'never'} ms after start)`);
    }
    await Promise.all(pages.map((p) => L.waitScreen(p, 'playing', 20000)));
    await L.sleep(1500);
    for (const p of pages) {
      const ok = await p.evaluate(() => !!document.querySelector('.pa-stage-game canvas'));
      check(ok, `${p.__name}: the game is on screen right after GO on slow 3G`);
    }
  } catch (err) {
    check(false, 'flow: ' + err.message);
    console.error(err);
  } finally {
    host.close();
    await browser.close();
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  }
  process.exit(done() ? 1 : 0);
})();
