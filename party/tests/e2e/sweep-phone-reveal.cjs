// sweep-phone-reveal: can a guest tap away the "who won" moment (RevealScreen, onClick on .pp-reveal)?
// The games sweep's tap on .pp-reveal timed out on some phones (Playwright: not actionable). Here two
// phones lose a round to a bot; on the reveal screen we look at what is under the finger in a few
// places, try a real touch tap there, and check that the screen moves on to the results.
//
// It starts its OWN game server on PORT 8951 (stop any other first) and needs vite:
//   PARTY_SERVER_PORT=8951 PARTY_CLIENT_PORT=5351 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/sweep-phone-reveal.cjs
// Outputs: tests/e2e/out/sweep-phone-/reveal/
const { spawn } = require('child_process');
const path = require('path');
const S = require('./sweep-phone-lib.cjs');

const { L } = S;
const OUT = path.join(S.OUT_ROOT, 'reveal');
const log = S.makeLog('reveal', OUT);
const PORT = 8951;

let server = null;
async function startServer() {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, PORT: String(PORT), PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '8000' },
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
      await L.join(p, code, `צופה ${k}`);
      await L.exitFs(p);
      pages.push(p);
    }
    const bots = await S.addPlanBots(code, 1, () => 'בוט מנצח', () => ({ raw: 50, finalAtMs: 500 }));
    for (const game of ['ninja', 'plotzel']) {
      await host.call('host:start', { gameId: game });
      await Promise.all(pages.map((p) => L.waitScreen(p, 'reveal', 40000)));
      await L.sleep(600);
      for (const [i, p] of pages.entries()) {
        const vp = p.viewportSize();
        const probe = await p.evaluate(([w, h]) => {
          const pts = [[w / 2, h / 2], [w / 2, h * 0.25], [w / 2, h * 0.75], [w * 0.15, h * 0.5]];
          return pts.map(([x, y]) => {
            const e = document.elementFromPoint(x, y);
            const inReveal = !!(e && e.closest('.pp-reveal'));
            return `${Math.round(x)},${Math.round(y)}: ${e ? e.tagName + '.' + String(e.className).slice(0, 30) : 'none'}${inReveal ? '' : ' (OUTSIDE the reveal)'}`;
          });
        }, [vp.width, vp.height]);
        const anim = await p.evaluate(() => document.querySelector('.pp-reveal').getAnimations({ subtree: true }).filter((a) => a.playState === 'running').map((a) => `${a.animationName || a.constructor.name}@${a.effect && a.effect.target ? String(a.effect.target.className).slice(0, 20) : ''}`).slice(0, 8));
        let err = null;
        try {
          await p.locator('.pp-reveal').first().tap({ timeout: 3000, trial: true });
        } catch (e) {
          err = e.message.split('\n').filter((l) => /intercept|stable|visible|retrying|waiting/.test(l)).slice(-3).join(' / ');
        }
        // a real finger, where the guest would tap (a quarter from the bottom, the middle and the top)
        const where = i % 2 ? 0.5 : 0.75;
        await S.touchTap(p, vp.width / 2, vp.height * where);
        await L.sleep(400);
        const after = await L.screen(p);
        console.log(`[reveal ${game}] ${p.__name}: under finger ${JSON.stringify(probe)}; running animations ${JSON.stringify(anim)}; playwright tap: ${err || 'actionable'}; after a touch at ${where * 100}% height: ${after}`);
        log.check(after === 'results', 'reveal-not-dismissable', `${p.__name}/${game}`, `tapped the who-won moment at ${where * 100}% height, still "${after}"`);
        if (err) log.issue('reveal-not-actionable', `${p.__name}/${game}`, err);
      }
      await host.call('host:lobby', {});
      await Promise.all(pages.map((p) => L.waitScreen(p, 'lobby', 20000)));
    }
    bots.close();
  } catch (e) {
    log.issue('flow', 'reveal', e.stack || e.message);
  } finally {
    host.close();
    await browser.close();
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  }
  process.exit(log.summary() ? 1 : 0);
})();
