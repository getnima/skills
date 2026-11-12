// sweep-phone-plotzel: where plotzel's messages land on six phones (a rejected word, "10 שניות אחרונות!",
// the skip confirm + the shortest path): never over the ladder's words, never over the keyboard.
// Also the skip button and key sizes, and typing a step through the on-screen keys.
//
// It starts its OWN game server on PORT 8951 (stop any other first) and needs vite:
//   PARTY_SERVER_PORT=8951 PARTY_CLIENT_PORT=5351 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/sweep-phone-plotzel.cjs
// Outputs: tests/e2e/out/sweep-phone-/plotzel/
const { spawn } = require('child_process');
const path = require('path');
const S = require('./sweep-phone-lib.cjs');

const { L } = S;
const OUT = path.join(S.OUT_ROOT, 'plotzel');
const log = S.makeLog('plotzel', OUT);
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

/** Rects of the message (whatever is on in the lane), the word rows and the keyboard. */
async function geometry(p) {
  return p.evaluate(() => {
    const R = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    };
    const vis = (e) => e && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && Number(getComputedStyle(e).opacity) > 0.1;
    const toast = document.querySelector('.pz-toast');
    const rowsEls = [...document.querySelectorAll('.pz-rows > *, .pz-row')].filter(vis);
    const rows = rowsEls.map(R).filter((r) => r && r.bottom > r.top);
    const kb = R(document.querySelector('.pz-kb, .pz-keys'));
    const skip = R(document.querySelector('[data-act="skip"]'));
    return { toast: vis(toast) ? { ...R(toast), text: toast.textContent } : null, rows, kb, skip, phase: window.__plotzel && window.__plotzel.phase };
  });
}
const hit = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;

async function typeWord(p, word) {
  for (const ch of word) {
    await p.locator(`.pz-key[data-k="${ch}"]`).first().tap();
    await L.sleep(80);
  }
  await p.locator('.pz-key[data-k="ENTER"]').first().tap();
}

(async () => {
  await startServer();
  const browser = await L.launch();
  const host = S.createHost();
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    const pages = [];
    for (const k of S.ORDER) {
      const p = await S.openProfile(browser, k, log);
      await L.join(p, code, `מילים ${k}`);
      await L.exitFs(p);
      pages.push(p);
    }
    const bots = await S.addPlanBots(code, 1, () => 'בוט', () => ({ raw: 1, finalAtMs: 1000 }));
    await host.call('host:start', { gameId: 'plotzel' });
    await Promise.all(pages.map((p) => L.waitScreen(p, 'playing', 20000)));
    await L.sleep(1200);
    const check = async (p, label) => {
      const g = await geometry(p);
      await S.sweepShot(p, OUT, label, log, { allowSmall: true });
      if (!g.toast) {
        console.log(`  [plotzel] ${p.__name}/${label}: no message on (phase ${g.phase})`);
        return g;
      }
      const overRow = g.rows.some((r) => hit(r, g.toast));
      log.check(!overRow, 'plotzel-msg-over-word', `${p.__name}/${label}`, `"${g.toast.text}" (${g.toast.top}..${g.toast.bottom}) covers a word row (${g.rows.map((r) => `${r.top}..${r.bottom}`).join(' ')})`);
      log.check(!hit(g.kb, g.toast), 'plotzel-msg-over-keys', `${p.__name}/${label}`, `"${g.toast.text}" covers the keyboard`);
      return g;
    };
    // a word that is not one step away: the rejection
    await Promise.all(pages.map(async (p) => {
      await typeWord(p, 'שמשמ');
      await L.sleep(250);
      await check(p, '1-rejected');
      for (let i = 0; i < 4; i++) await p.locator('.pz-key[data-k="BACK"]').first().tap();
    }));
    // one good step on half of them
    await Promise.all(pages.filter((_, i) => i % 2).map(async (p) => {
      const path0 = await p.evaluate(() => window.__plotzel.path());
      if (path0.length > 1) await typeWord(p, path0[1]);
    }));
    // skip after 15 s, on the others
    await L.waitFor(() => pages[0].evaluate(() => window.__plotzel.skipReady), 20000, 'skip ready');
    await Promise.all(pages.filter((_, i) => i % 2 === 0).map(async (p) => {
      await p.locator('[data-act="skip"]').first().tap();
      await L.sleep(250);
      await check(p, '2-skip-armed');
      await p.locator('[data-act="skip"]').first().tap();
      await L.sleep(500);
      await check(p, '3-skip-path');
    }));
    // the last 10 s
    await L.waitFor(async () => {
      const pl = await S.playInfo(pages[0]);
      return pl && pl.leftMs < 9800;
    }, 20000, 'last 10 s');
    await L.sleep(200);
    await Promise.all(pages.map((p) => check(p, '4-last-10s')));
    const sizes = await pages[0].evaluate(() => [...document.querySelectorAll('.pz-key')].map((k) => Math.round(k.getBoundingClientRect().width)));
    console.log(`  [plotzel] se key widths ${Math.min(...sizes)}..${Math.max(...sizes)}`);
    bots.close();
  } catch (e) {
    log.issue('flow', 'plotzel', e.stack || e.message);
  } finally {
    host.close();
    await browser.close();
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  }
  process.exit(log.summary() ? 1 : 0);
})();
