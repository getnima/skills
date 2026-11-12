// Phone QA of the stage + device glue: rotating mid-game (the "turn the phone upright"
// overlay and the canvas getting its size back), a game that throws, fast phase changes
// (no double mount), and leaks over five rounds (listeners, canvases, heap).
//
// Starts its OWN fast game server on PARTY_SERVER_PORT (8812) serving a production build:
//   npx vite build --outDir /some/scratch/dist-client --emptyOutDir
//   QA_CLIENT_DIR=/some/scratch/dist-client node tests/e2e/qa-phone-stage.cjs
//
// Screenshots: tests/e2e/out/qa-phone/stage/
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PARTY_SERVER_PORT || '8812';
process.env.CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}`;
if (!process.env.QA_CLIENT_DIR) {
  console.error('set QA_CLIENT_DIR to a production build of the client (see the header)');
  process.exit(2);
}
const L = require('./qa-phone-lib.cjs');

const OUT = path.join(L.OUT_ROOT, 'stage');
const { check, done } = L.makeChecker('stage');

// Listener bookkeeping on window/document + a switch that makes the game's canvas throw.
const INIT = `(() => {
  const live = new Map();
  const key = (t, type, fn, cap) => t === window ? 'w' : t === document ? 'd' : null;
  const add = EventTarget.prototype.addEventListener;
  const rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    const k = key(this);
    if (k && fn) {
      const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
      const id = k + ':' + type + ':' + cap;
      let set = live.get(id); if (!set) live.set(id, (set = new Set()));
      set.add(fn);
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    const k = key(this);
    if (k && fn) {
      const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
      const set = live.get(k + ':' + type + ':' + cap); if (set) set.delete(fn);
    }
    return rem.call(this, type, fn, opts);
  };
  window.__listeners = () => { let n = 0; const by = {}; for (const [id, s] of live) { n += s.size; if (s.size) by[id] = s.size; } return { n, by }; };
  window.__breakCanvas = false;
  const fr = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function () {
    if (window.__breakCanvas && this.canvas.closest && this.canvas.closest('.pa-stage-game')) throw new Error('qa: game exploded');
    return fr.apply(this, arguments);
  };
  window.__maxStages = 0; window.__maxGameCanvases = 0;
  new MutationObserver(() => {
    window.__maxStages = Math.max(window.__maxStages, document.querySelectorAll('.pa-stage').length);
    window.__maxGameCanvases = Math.max(window.__maxGameCanvases, document.querySelectorAll('.pa-stage-game canvas').length);
  }).observe(document, { childList: true, subtree: true });
})();`;

let server = null;
function startServer() {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, PARTY_SERVER_PORT: PORT, PARTY_CLIENT_DIR: process.env.QA_CLIENT_DIR, PARTY_TEST_FAST: '1', PARTY_TEST_DURATION_MS: '12000' },
    stdio: 'ignore',
    detached: true,
  });
  return L.waitFor(async () => {
    try {
      return (await fetch(`${L.SERVER}/healthz`)).ok;
    } catch {
      return false;
    }
  }, 20000, 'server up');
}

async function tapN(page, n) {
  const vp = page.viewportSize();
  for (let i = 0; i < n; i++) await page.touchscreen.tap(vp.width / 2 + ((i * 37) % 80) - 40, vp.height * (0.45 + (i % 3) * 0.1));
}
const hud = (p) => p.evaluate(() => Number((document.querySelector('.pa-hud-num') || { textContent: '-1' }).textContent.replace(/,/g, '')));
const rotateOn = (p) => p.evaluate(() => {
  const el = document.querySelector('.pp-rotate');
  return !!el && getComputedStyle(el).display !== 'none';
});

async function snapshotMem(page) {
  const c = await L.cdp(page);
  await c.send('HeapProfiler.collectGarbage');
  await L.sleep(200);
  await c.send('HeapProfiler.collectGarbage');
  const { usedSize } = await c.send('Runtime.getHeapUsage'); // precise; performance.memory is bucketed
  return page.evaluate((heap) => ({
    heap,
    listeners: window.__listeners().n,
    by: window.__listeners().by,
    canvases: document.querySelectorAll('canvas').length,
    nodes: document.getElementsByTagName('*').length,
  }), usedSize);
}

(async () => {
  await startServer();
  const browser = await L.launch();
  const host = L.createHost();
  try {
    const { code } = await host.call('host:create', {});
    await host.call('host:setAutoCutscenes', { enabled: false });
    const A = await L.openPhone(browser, 'iphone14', L.PHONES.iphone14, { initScript: INIT }, check);
    await L.setSafeArea(A, 47, 34);
    const P = await L.openPhone(browser, 'pixel7', L.PHONES.pixel7, { initScript: INIT }, check);
    const T = await L.openPhone(browser, 'ipadmini', L.PHONES.ipadmini, { initScript: INIT }, check);
    await L.join(A, code, 'אייפון');
    await L.join(P, code, 'פיקסל');
    await L.join(T, code, 'טאבלט');

    // ── Android: fullscreen from the join tap, back after it is lost; iPhone: page = visible viewport ──
    check(await P.evaluate(() => !!document.fullscreenElement), 'Android: the join tap entered fullscreen');
    await P.evaluate(() => document.exitFullscreen());
    await L.sleep(300);
    await P.touchscreen.tap(200, 300);
    await L.waitFor(() => P.evaluate(() => !!document.fullscreenElement), 3000, 'fs back').catch(() => {});
    check(await P.evaluate(() => !!document.fullscreenElement), 'Android: fullscreen comes back on the next tap after it was lost');
    const fit = await A.evaluate(() => ({ app: document.getElementById('app').getBoundingClientRect().height, body: document.body.getBoundingClientRect().height, vv: visualViewport.height, ih: innerHeight }));
    check(Math.abs(fit.app - fit.vv) < 1 && Math.abs(fit.body - fit.vv) < 1, `iPhone: the page is exactly the visible viewport ${JSON.stringify(fit)}`);
    // home-screen launch: no ?room in the URL → back in the last room as the same player
    const idP = await P.evaluate(() => window.__player.snap.playerId);
    await L.exitFs(P);
    await P.goto(`${L.CLIENT}/`);
    await L.waitScreen(P, 'lobby', 8000);
    check((await P.evaluate(() => window.__player.snap.playerId)) === idP, 'opened without ?room (home screen): resumes the last room as the same player');

    // ── rotation outside a game ──
    const port14 = A.viewportSize();
    const land14 = { width: port14.height, height: port14.width };
    await L.resize(A, land14);
    await L.sleep(400);
    check(await rotateOn(A), 'lobby, phone sideways: "turn the phone" overlay');
    await A.screenshot({ path: path.join(OUT, 'iphone14-01-lobby-landscape.png') }).catch(async () => {
      require('fs').mkdirSync(OUT, { recursive: true });
      await A.screenshot({ path: path.join(OUT, 'iphone14-01-lobby-landscape.png') });
    });
    const a1 = await L.audit(A);
    check(a1.sh <= a1.H && a1.sw <= a1.W, `landscape lobby: no scroll (${a1.sw}x${a1.sh} in ${a1.W}x${a1.H})`);
    await L.resize(A, port14);
    await L.sleep(400);
    check(!(await rotateOn(A)), 'upright again: overlay gone');
    const portT = T.viewportSize();
    await L.resize(T, { width: portT.height, height: portT.width });
    await L.sleep(300);
    check(!(await rotateOn(T)), 'tablet sideways: no overlay (it fits)');
    await L.shot(T, OUT, '01-lobby-landscape', check);
    await L.resize(T, portT);
    // a focused field never shows the overlay (an open keyboard is not a rotation)
    const J = await L.openPhone(browser, 's8', L.PHONES.s8, { initScript: INIT }, check);
    await J.goto(`${L.CLIENT}/?room=${code}`);
    await L.waitScreen(J, 'join');
    await J.focus('.pp-name-input');
    await J.setViewportSize({ width: 360, height: 300 }); // keyboard: wider than tall
    await L.sleep(300);
    check(!(await rotateOn(J)), 'keyboard open (short viewport, focused field): no rotate overlay');
    await J.setViewportSize({ width: 360, height: 740 });
    await J.close();

    // ── round 1 (tap): rotate mid-game, then the game throws ──
    await host.call('host:start', { gameId: 'tap' });
    await L.waitScreen(A, 'playing', 10000);
    await L.sleep(500);
    await tapN(A, 6);
    const leftBefore = await A.evaluate(() => window.__playerPlay.leftMs);
    await L.resize(A, land14);
    await L.sleep(1500);
    check(await rotateOn(A), 'mid-game sideways: overlay on');
    check((await L.screen(A)) === 'playing' && !(await A.evaluate(() => window.__playerPlay.frozen)), 'the round keeps running under the overlay (no pause)');
    const leftLand = await A.evaluate(() => window.__playerPlay.leftMs);
    check(leftBefore - leftLand > 1000, `server clock kept going while sideways (${Math.round(leftBefore)} → ${Math.round(leftLand)})`);
    await A.screenshot({ path: path.join(OUT, 'iphone14-02-game-landscape.png') });
    await L.resize(A, port14);
    await L.sleep(600);
    const sz = await A.evaluate(() => {
      const c = document.querySelector('.pa-stage-game canvas');
      return c ? { cw: c.clientWidth, ch: c.clientHeight, w: c.width, h: c.height, iw: innerWidth, ih: innerHeight, dpr: Math.min(2, devicePixelRatio) } : null;
    });
    check(sz && sz.cw === sz.iw && sz.ch === sz.ih && Math.abs(sz.w - sz.iw * sz.dpr) <= 1 && Math.abs(sz.h - sz.ih * sz.dpr) <= 1, `upright again: the game canvas has the portrait size back ${JSON.stringify(sz)}`);
    check(!(await rotateOn(A)), 'overlay gone after turning back');
    await tapN(A, 4);
    await L.shot(A, OUT, '03-game-after-rotation', check, { allowSmall: true });

    // the game throws: friendly screen, the score reached still counts
    await tapN(P, 9);
    await L.sleep(400);
    const pScore = await hud(P);
    await P.evaluate(() => {
      window.__breakCanvas = true;
    });
    await L.waitFor(() => P.evaluate(() => !!document.querySelector('.pa-overlay.is-on')), 3000, 'crash overlay').catch(() => {});
    check(await P.evaluate(() => /נתקע/.test((document.querySelector('.pa-overlay.is-on') || {}).textContent || '')), 'a game that throws shows the friendly "stuck" screen');
    await L.shot(P, OUT, '04-game-crashed', check, { allowSmall: true });
    check(await P.evaluate(() => !!document.querySelector('.pa-hud-secs')), 'HUD (timer) still there after the crash');
    await P.evaluate(() => {
      window.__breakCanvas = false;
    });
    await L.waitFor(() => host.state().phase === 'results', 20000, 'results 1');
    const rowP = host.state().results.rows.find((r) => r.name === 'פיקסל');
    check(rowP && rowP.raw === pScore && pScore > 0, `crashed game's score counted (${rowP && rowP.raw} vs ${pScore})`);
    check(P.__errors.filter((e) => !/qa: game exploded/.test(e)).length === 0, `no other page errors on the crashed phone ${P.__errors.join(' | ')}`);
    P.__errors.length = 0;
    await host.call('host:lobby', {});
    await L.waitScreen(A, 'lobby', 5000);

    // ── fast phase changes: start → end during the intro → start again → end in the countdown → start ──
    await host.call('host:start', { gameId: 'flappy' });
    await L.sleep(300);
    await host.call('host:endRound', {});
    await host.call('host:start', { gameId: 'ninja' });
    await L.waitScreen(A, 'countdown', 5000);
    await L.sleep(200);
    await host.call('host:endRound', {});
    await L.sleep(100);
    await host.call('host:start', { gameId: 'tap' });
    await L.waitScreen(A, 'playing', 8000);
    await L.sleep(800);
    const mounts = await A.evaluate(() => ({ stages: window.__maxStages, canvases: window.__maxGameCanvases, now: document.querySelectorAll('.pa-stage').length }));
    check(mounts.stages <= 1 && mounts.canvases <= 1 && mounts.now === 1, `fast phase changes: never two stages / game canvases at once ${JSON.stringify(mounts)}`);
    await host.call('host:endRound', {});
    await L.waitFor(() => host.state().phase === 'results', 8000, 'ended');
    await host.call('host:lobby', {});
    await L.waitScreen(A, 'lobby', 5000);
    await L.sleep(500);
    check(await A.evaluate(() => document.querySelectorAll('.pa-stage').length === 0), 'stage removed once the round is gone');

    // ── leaks over five rounds ──
    const m0 = await snapshotMem(A);
    const games = ['tap', 'icy', 'flappy', 'ninja', 'tap'];
    for (let i = 0; i < games.length; i++) {
      await host.call('host:start', { gameId: games[i] });
      await L.waitScreen(A, 'playing', 10000);
      await L.sleep(500);
      await tapN(A, 10);
      await L.waitFor(() => host.state().phase === 'results', 25000, 'results');
      await L.sleep(1500);
      await host.call('host:lobby', {});
      await L.waitScreen(A, 'lobby', 5000);
      await L.sleep(400);
      const m = await snapshotMem(A);
      console.log(`[stage] after round ${i + 1} (${games[i]}): heap ${(m.heap / 1e6).toFixed(1)} MB, listeners ${m.listeners}, canvases ${m.canvases}, nodes ${m.nodes}`);
      if (i === games.length - 1) {
        check(m.listeners <= m0.listeners + 2, `window/document listeners do not grow over five rounds (${m0.listeners} → ${m.listeners}) ${JSON.stringify(m.by)}`);
        check(m.canvases === m0.canvases, `no canvas left behind (${m0.canvases} → ${m.canvases})`);
        check(m.heap < m0.heap * 1.5 + 3e6, `heap stays flat (${(m0.heap / 1e6).toFixed(1)} → ${(m.heap / 1e6).toFixed(1)} MB)`);
        check(m.nodes <= m0.nodes + 60, `DOM nodes stay flat (${m0.nodes} → ${m.nodes})`);
      }
    }
    for (const p of [A, P, T]) check(p.__errors.length === 0, `${p.__name}: no page errors ${p.__errors.slice(0, 2).join(' | ')}`);
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
