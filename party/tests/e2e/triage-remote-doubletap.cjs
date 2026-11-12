// triage-remote-doubletap (copy of chaos-remote-doubletap.cjs, triage ports and output): the owner double-taps the remote's big button. Does the second tap of
// ONE double tap leak into the NEXT screen? Sweeps the gap between the two taps.
//   A. results (ceremony over) -> double-tap "continue": the next game must NOT start.
//   B. lobby, game picked = ninja -> double-tap "start": the automatic before_ninja video must NOT be skipped.
//   C. lobby -> double-tap "next": no "cancel the round?" sheet should be left open.
//
//   PORT=8941 PARTY_TEST_FAST=1 PARTY_TEST_DURATION_MS=10000 npx tsx server/index.ts
//   PARTY_SERVER_PORT=8941 PARTY_CLIENT_PORT=5341 npx vite --config tests/e2e/qa-icy-vite.config.mjs
//   node tests/e2e/chaos-remote-doubletap.cjs        -> tests/e2e/out/chaos-/doubletap.json
'use strict';
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out', 'triage-');
const BASE = process.env.BASE_URL || 'http://localhost:5391';
const SERVER = process.env.SERVER_URL || 'http://localhost:8991';
const PW = process.env.PARTY_REMOTE_PASSWORD || 'kioso3tbh';
const GAPS = (process.env.GAPS || '150,300').split(',').map(Number);
const { io } = require(path.join(ROOT, 'node_modules/socket.io-client'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hhmm = () => new Date().toISOString().slice(11, 23);
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(50);
  }
}

(async () => {
  const browser = await chromium.launch();
  const out = { continue: [], beforeNinja: [], next: [] };
  let bots = null;
  let obs = null;
  try {
    const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const tv = await tvCtx.newPage();
    await tv.goto(BASE + '/host.html');
    await tv.evaluate(() => localStorage.clear());
    await tv.goto(BASE + '/host.html');
    await tv.waitForFunction(() => window.__host && window.__host.state() && window.__host.status() === 'online', null, { timeout: 30000 });
    const code = await tv.evaluate(() => window.__host.state().code);
    await tv.mouse.click(960, 60);
    // the server's truth + a host socket to set up each trial quickly (a second remote)
    let last = null;
    const trans = [];
    obs = io(SERVER, { transports: ['websocket'], forceNew: true });
    obs.on('state', (s) => {
      const k = `${s.phase}${s.cutscene ? '+' + s.cutscene.id : ''}`;
      if (!last || k !== `${last.phase}${last.cutscene ? '+' + last.cutscene.id : ''}`) trans.push({ t: s.serverNow, k });
      last = s;
    });
    await new Promise((res, rej) => obs.emit('remote:attach', { password: PW, code }, (a) => (a.ok ? res() : rej(new Error(a.error)))));
    const host = (ev, req = {}) => new Promise((res) => obs.emit(ev, req, res));
    bots = spawn('npx', ['tsx', 'tests/load/bots.ts', '--url', SERVER, '--code', code, '--players', '3', '--play', '--quiet'], { cwd: ROOT, stdio: 'ignore', detached: true });
    await waitFor(() => last && last.players.length >= 3, 30000, 'bots');

    const rctx = await browser.newContext({ ...devices['iPhone 13'] });
    const r = await rctx.newPage();
    await r.goto(BASE + '/remote.html');
    await r.fill('[data-testid=unlock-input]', PW);
    await r.locator('[data-testid=unlock-go]').tap();
    await r.waitForSelector('[data-testid=main]', { timeout: 20000 });
    await waitFor(() => r.evaluate(() => window.__remote.tv() === 'online' && !!window.__remote.model()), 15000, 'remote ready');

    async function closeSheets() {
      for (const id of ['confirm-no', 'more-close', 'cutscenes-close', 'players-close']) {
        if (await r.locator(`[data-testid=${id}]`).isVisible().catch(() => false)) await r.locator(`[data-testid=${id}]`).tap().catch(() => undefined);
      }
    }
    async function doubleTap(gap) {
      await closeSheets();
      const b = r.locator('[data-testid=big]');
      await waitFor(() => b.isEnabled(), 15000, 'big enabled');
      const before = { action: await b.getAttribute('data-action'), n: trans.length };
      const box = await b.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const seen = [];
      const watch = { on: true };
      const w = (async () => {
        while (watch.on) {
          const a = await r.evaluate(() => {
            const e = document.querySelector('[data-testid=big]');
            return e ? e.dataset.action + (e.disabled ? '(off)' : '') : '-';
          }).catch(() => '?');
          if (seen[seen.length - 1] !== a) seen.push(a);
          await sleep(25);
        }
      })();
      const t0 = Date.now();
      await r.touchscreen.tap(x, y);
      await sleep(gap);
      await r.touchscreen.tap(x, y);
      await sleep(2500);
      watch.on = false;
      await w;
      const sheet = await r.locator('[data-testid=confirm]').isVisible().catch(() => false);
      const after = trans.slice(before.n).map((t) => ({ ms: t.t - t0, k: t.k }));
      if (sheet) await closeSheets();
      return { gap, first: before.action, big: seen, after, sheet };
    }
    async function toLobby() {
      if (last.cutscene) await host('host:cutsceneEnd');
      await sleep(300);
      if (['intro', 'countdown', 'playing'].includes(last.phase)) await host('host:endRound');
      await waitFor(() => last.cutscene === null && ['lobby', 'results', 'final'].includes(last.phase), 15000, 'between');
      if (last.phase !== 'lobby') await host('host:lobby');
      await waitFor(() => last.phase === 'lobby', 8000, 'lobby');
      await sleep(600);
    }
    const ceremonyOver = () =>
      waitFor(() => r.evaluate(() => {
        const m = window.__remote.model();
        const c = m && m.actions.find((a) => a.id === 'continue');
        return m && m.phase === 'results' && c && c.enabled && c.confirm === undefined;
      }), 60000, 'ceremony over');

    // D (ONLY=podium). The last game's results -> double-tap "podium": before_podium must NOT be skipped.
    if (process.env.ONLY === 'podium') {
      out.podium = [];
      for (const gap of GAPS) {
        await toLobby();
        await host('host:reset');
        await waitFor(() => last.phase === 'lobby' && last.played.length === 0, 8000, 'reset');
        for (const g of ['tap', 'icy', 'flappy', 'plotzel', 'ninja']) {
          await host('host:start', { gameId: g });
          await waitFor(() => last.round && last.round.gameId === g, 8000, 'start ' + g);
          if (last.cutscene) await host('host:cutsceneEnd');
          await waitFor(() => last.phase === 'playing' && last.cutscene === null, 20000, 'playing ' + g);
          await sleep(1200);
          await host('host:endRound');
          await waitFor(() => last.phase === 'results', 8000, 'results ' + g);
          if (g !== 'ninja') await host('host:lobby');
        }
        await waitFor(() => r.evaluate(() => {
          const m = window.__remote.model();
          const c = m && m.actions.find((a) => a.id === 'podium');
          return m && m.phase === 'results' && m.primary === 'podium' && c && c.enabled && c.confirm === undefined;
        }), 60000, 'ceremony over (podium)');
        await sleep(800);
        const t = await doubleTap(gap);
        const on = t.after.find((x) => x.k.includes('before_podium'));
        const off = on ? t.after.find((x) => x.ms > on.ms && !x.k.includes('before_podium')) : null;
        t.videoMs = on && off ? off.ms - on.ms : null;
        t.videoSkipped = t.videoMs !== null && t.videoMs < 3000;
        out.podium.push(t);
        console.log(hhmm(), 'D before_podium', JSON.stringify(t));
      }
      console.log('podium -> before_podium skipped:', `${out.podium.filter((t) => t.videoSkipped).length}/${out.podium.length}`, out.podium.map((t) => `${t.gap}ms:${t.videoSkipped ? 'SKIPPED' : t.videoMs}`).join(' '));
      GAPS.length = 0; // skip A-C
    }
    // A. continue
    for (const gap of GAPS) {
      await toLobby();
      await host('host:start', { gameId: 'tap' });
      await waitFor(() => last.phase === 'playing' && last.cutscene === null, 20000, 'playing');
      await sleep(1500);
      await host('host:endRound');
      await waitFor(() => last.phase === 'results', 8000, 'results');
      await ceremonyOver();
      await sleep(800);
      const t = await doubleTap(gap);
      t.startedNextGame = t.after.some((x) => x.k.startsWith('intro'));
      out.continue.push(t);
      console.log(hhmm(), 'A continue', JSON.stringify(t));
    }
    // B. start ninja (picked), the 'before' video
    for (const gap of GAPS) {
      await toLobby();
      await host('host:reset'); // the automatic video fires once per competition
      await waitFor(() => last.phase === 'lobby' && last.played.length === 0, 8000, 'reset');
      await sleep(800);
      await closeSheets();
      await r.locator('[data-testid=pick-ninja]').tap();
      await sleep(400);
      const t = await doubleTap(gap);
      const on = t.after.find((x) => x.k.includes('before_ninja'));
      const off = on ? t.after.find((x) => x.ms > on.ms && !x.k.includes('before_ninja')) : null;
      t.videoMs = on && off ? off.ms - on.ms : null;
      t.videoSkipped = t.videoMs !== null && t.videoMs < 3000; // the placeholder of a missing video lasts 4000 ms
      out.beforeNinja.push(t);
      console.log(hhmm(), 'B before_ninja', JSON.stringify(t));
    }
    // C. next from the lobby
    for (const gap of GAPS) {
      await toLobby();
      await host('host:reset');
      await waitFor(() => last.phase === 'lobby' && last.played.length === 0, 8000, 'reset');
      await sleep(800);
      const t = await doubleTap(gap);
      out.next.push(t);
      console.log(hhmm(), 'C next', JSON.stringify(t));
    }
  } catch (e) {
    console.error('run stopped', e);
    out.error = String(e && e.message);
  } finally {
    if (bots) {
      try {
        process.kill(-bots.pid);
      } catch {
        // gone
      }
    }
    if (obs) obs.disconnect();
    fs.writeFileSync(path.join(OUT, 'doubletap.json'), JSON.stringify(out, null, 1));
    const sum = (list, f) => `${list.filter(f).length}/${list.length}`;
    console.log('continue -> next game started:', sum(out.continue, (t) => t.startedNextGame), out.continue.map((t) => `${t.gap}ms:${t.startedNextGame ? 'STARTED' : 'ok'}`).join(' '));
    console.log('start ninja -> before_ninja skipped:', sum(out.beforeNinja, (t) => t.videoSkipped), out.beforeNinja.map((t) => `${t.gap}ms:${t.videoSkipped ? 'SKIPPED' : t.videoMs}`).join(' '));
    console.log('next -> sheet left open:', sum(out.next, (t) => t.sheet), out.next.map((t) => `${t.gap}ms:${t.sheet ? 'SHEET' : 'ok'}`).join(' '));
    await browser.close();
    process.exit(0);
  }
})();
