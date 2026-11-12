// sweep-phone-mebar: the me bar's ▲/▼ badge after it was hidden by a game.
// Two phones (iPhone SE, Pro Max) + 2 bots. Round 1: SE wins. Round 2: Pro Max wins and overtakes
// (SE ▼1, Pro Max ▲1, shown in the results). Round 3: nobody's place can have changed yet, so the
// badge must stay away during the freeze (the bar comes back over the cutscene) and in the
// "sending" beat (the round is still hidden). The badge is sampled every 100 ms; a badge with
// opacity > 0.5 is "shown".
//
// It starts its OWN game server on PORT 8951 (stop any other first) and needs vite:
//   PARTY_SERVER_PORT=8951 PARTY_CLIENT_PORT=5351 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/sweep-phone-mebar.cjs
// Outputs: tests/e2e/out/sweep-phone-/mebar/
const { spawn } = require('child_process');
const path = require('path');
const S = require('./sweep-phone-lib.cjs');

const { L } = S;
const OUT = path.join(S.OUT_ROOT, 'mebar');
const log = S.makeLog('mebar', OUT);
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

async function badge(p) {
  return p.evaluate(() => {
    const bar = document.querySelector('.pp-mebar');
    const b = document.querySelector('.pp-mebar .pp-mb-move');
    if (!bar || !b || getComputedStyle(bar).display === 'none') return null;
    const o = Number(getComputedStyle(b).opacity);
    return o > 0.5 ? `${b.textContent} (opacity ${o.toFixed(2)}) on ${window.__player.screen}` : null;
  }).catch(() => null);
}
async function watch(p, ms) {
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const b = await badge(p);
    if (b) seen.add(b.replace(/\(opacity [0-9.]+\) /, ''));
    await L.sleep(100);
  }
  return [...seen];
}

(async () => {
  await startServer();
  const browser = await L.launch();
  const host = S.createHost();
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    const a = await S.openProfile(browser, 'se', log);
    const b = await S.openProfile(browser, 'promax', log);
    await L.join(a, code, 'אלף');
    await L.join(b, code, 'בית');
    await L.exitFs(a);
    await L.exitFs(b);
    const bots = await S.addPlanBots(code, 2, (i) => `בוט ${i + 1}`, (g, i) => ({ raw: 1 + i, finalAtMs: 800 }));
    const tap = async (p, n) => {
      for (let i = 0; i < n; i++) {
        await S.touchTap(p, 160 + ((i * 37) % 60), p.viewportSize().height * 0.6);
        await L.sleep(120);
      }
    };
    const round = async (na, nb, freeze) => {
      await host.call('host:start', { gameId: 'tap' });
      await L.waitScreen(a, 'playing', 20000);
      await L.waitScreen(b, 'playing', 20000);
      await L.sleep(500);
      const taps = Promise.all([tap(a, na), tap(b, nb)]);
      let seenFreeze = null;
      if (freeze) {
        await L.sleep(1500);
        await host.call('host:cutscene', { id: 'joker_1' });
        await L.sleep(300);
        const [fa, fb] = await Promise.all([watch(a, 2500), watch(b, 2500)]);
        await S.sweepShot(a, OUT, 'r3-freeze', log, { allowSmall: true });
        await S.sweepShot(b, OUT, 'r3-freeze', log, { allowSmall: true });
        await host.call('host:cutsceneEnd', {});
        seenFreeze = { a: fa, b: fb };
      }
      await taps;
      // the round ends when everybody is done: watch the "sending" beat and the suspense
      await Promise.all([a, b].map((p) => L.waitScreen(p, ['sending', 'suspense'], 40000)));
      const [sa, sb] = await Promise.all([watch(a, 2500), watch(b, 2500)]);
      await Promise.all([a, b].map((p) => L.waitScreen(p, ['win', 'reveal', 'results'], 20000)));
      await L.sleep(1200);
      for (const p of [a, b]) {
        if ((await L.screen(p)) === 'win') await p.locator('.pp-win .pp-btn').first().tap().catch(() => {});
        else if ((await L.screen(p)) === 'reveal') await p.locator('.pp-reveal').first().tap().catch(() => {});
      }
      await Promise.all([a, b].map((p) => L.waitScreen(p, 'results', 20000)));
      const [ra, rb] = await Promise.all([watch(a, 1500), watch(b, 1500)]);
      await host.call('host:lobby', {});
      await Promise.all([a, b].map((p) => L.waitScreen(p, 'lobby', 20000)));
      await L.sleep(4000); // every badge animation is over
      return { freeze: seenFreeze, sending: { a: sa, b: sb }, results: { a: ra, b: rb } };
    };
    const r1 = await round(30, 8, false);
    console.log('[mebar] round 1', JSON.stringify(r1));
    const r2 = await round(0, 40, false);
    console.log('[mebar] round 2', JSON.stringify(r2));
    const st = host.state().players.map((p) => `${p.name}#${p.rank}`).join(' ');
    console.log('[mebar] standings after round 2', st);
    const r3 = await round(10, 10, true);
    console.log('[mebar] round 3', JSON.stringify(r3));
    for (const [who, k] of [['se', 'a'], ['promax', 'b']]) {
      log.check(r3.freeze[k].length === 0, 'stale-badge-freeze', who, `round 3 freeze, nothing moved yet, the me bar shows ${r3.freeze[k].join(' / ')}`);
      log.check(r3.sending[k].length === 0, 'stale-badge-sending', who, `round 3 just ended (hidden), the me bar shows ${r3.sending[k].join(' / ')}`);
    }
    bots.close();
  } catch (e) {
    log.issue('flow', 'mebar', e.stack || e.message);
  } finally {
    host.close();
    await browser.close();
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  }
  process.exit(log.summary() ? 1 : 0);
})();
